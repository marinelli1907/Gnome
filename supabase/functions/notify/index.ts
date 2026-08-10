// Gnome push-notification Edge Function.
//
// Three events, all invoked by the app (best-effort — the core loop persists
// without push):
//   { event: 'claim',    claimId }     -> push the listing owner (new claim)
//   { event: 'approved', claimId }     -> push the claimer (claim approved)
//   { event: 'offer_created', listingId } -> V1.1 matching: find active Wanted
//        posts (same category, within radius, not owned by the offer's owner,
//        last 30 days), log `wanted_matched` events, and push each wanted owner.
//
// Recipient tokens are read with the service role, so they're never exposed to
// clients. Deploy: `supabase functions deploy notify`.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MATCH_RADIUS_MILES = 10; // V1.1 wanted-post matching radius
const MATCH_WINDOW_DAYS = 30;

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    if (payload.event === 'offer_created') {
      return await handleOfferCreated(admin, req, payload.listingId);
    }
    if (payload.event === 'message') {
      return await handleMessage(admin, req, payload.claimId, payload.preview);
    }
    if (ORDER_EVENTS[payload.event]) {
      return await handleOrderEvent(admin, req, payload.event, payload.orderId);
    }
    if (payload.event === 'grow_log_update' || payload.event === 'plot_owner_note') {
      return await handleGrowLogEvent(admin, req, payload.event, payload.claimId);
    }
    return await handleClaim(admin, req, payload.event, payload.claimId);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

// --- claim / approved -------------------------------------------------------
async function handleClaim(admin: any, req: Request, event: string, claimId: string) {
  if (!event || !claimId) return json({ error: 'event and claimId required' }, 400);

  // The caller must be the party who actually performed the action — otherwise
  // any authenticated user could spray "new claim"/"approved" pushes at
  // arbitrary users by iterating claim ids.
  const callerId = await callerFrom(admin, req);
  if (!callerId) return json({ error: 'unauthenticated' }, 401);

  const { data: claim, error } = await admin
    .from('claims')
    .select('id, claimer_id, listing:listings(title, owner_id)')
    .eq('id', claimId)
    .single();
  if (error || !claim) return json({ error: 'claim not found' }, 404);

  const listing = claim.listing;
  const title = listing?.title ?? 'your listing';

  let recipientId: string;
  let message: { title: string; body: string };
  if (event === 'claim') {
    // Only the claimer announces their own claim to the owner.
    if (callerId !== claim.claimer_id) return json({ error: 'not your claim' }, 403);
    recipientId = listing.owner_id;
    message = { title: 'New claim 🍅', body: `Someone wants "${title}". Approve or decline in Gnome.` };
  } else {
    // Only the listing owner announces an approval to the claimer.
    if (callerId !== listing?.owner_id) return json({ error: 'not your listing' }, 403);
    recipientId = claim.claimer_id;
    message = { title: 'Claim approved ✅', body: `You're approved for "${title}". Arrange pickup with your neighbor.` };
  }

  const sent = await pushToUser(admin, recipientId, message, { claimId, event });
  return json({ sent });
}

// --- message -> push the other party ---------------------------------------
async function handleMessage(admin: any, req: Request, claimId: string, preview: string) {
  if (!claimId) return json({ error: 'claimId required' }, 400);

  // Identify the sender from their JWT (not from the client payload).
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: u } = await admin.auth.getUser(token);
  const senderId = u?.user?.id;
  if (!senderId) return json({ error: 'unauthenticated' }, 401);

  const { data: claim, error } = await admin
    .from('claims')
    .select('id, claimer_id, listing:listings(owner_id)')
    .eq('id', claimId)
    .single();
  if (error || !claim) return json({ error: 'claim not found' }, 404);

  const ownerId = claim.listing?.owner_id;
  const claimerId = claim.claimer_id;
  if (senderId !== ownerId && senderId !== claimerId) {
    return json({ error: 'not a party to this claim' }, 403);
  }
  const recipientId = senderId === ownerId ? claimerId : ownerId;

  const body = (preview ?? '').slice(0, 80) || 'You have a new message.';
  const sent = await pushToUser(
    admin,
    recipientId,
    { title: 'New message about your Gnome pickup', body },
    { claimId, event: 'message' },
  );
  return json({ sent });
}

// --- offer_created -> match wanted posts -----------------------------------
async function handleOfferCreated(admin: any, req: Request, listingId: string) {
  if (!listingId) return json({ error: 'listingId required' }, 400);

  const callerId = await callerFrom(admin, req);
  if (!callerId) return json({ error: 'unauthenticated' }, 401);

  const { data: offer, error } = await admin
    .from('listings')
    .select('id, title, category, lat, lng, owner_id, kind, fulfilled_by_listing_id')
    .eq('id', listingId)
    .single();
  if (error || !offer || offer.kind !== 'offer') {
    return json({ error: 'offer not found' }, 404);
  }
  // Only the offer's owner may trigger match notifications for it.
  if (callerId !== offer.owner_id) return json({ error: 'not your listing' }, 403);

  const sinceIso = new Date(Date.now() - MATCH_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: wanted } = await admin
    .from('listings')
    .select('id, title, owner_id, lat, lng')
    .eq('kind', 'wanted')
    .eq('status', 'active')
    .eq('category', offer.category)
    .neq('owner_id', offer.owner_id)
    .gte('created_at', sinceIso);

  let matches = (wanted ?? []).filter((w: any) => {
    // Always match the explicitly linked wanted post ("I Have This"); otherwise
    // require it to be within the match radius (skip if either side lacks coords).
    if (offer.fulfilled_by_listing_id && w.id === offer.fulfilled_by_listing_id) return true;
    if (offer.lat == null || offer.lng == null || w.lat == null || w.lng == null) return false;
    return milesBetween(offer.lat, offer.lng, w.lat, w.lng) <= MATCH_RADIUS_MILES;
  });

  // Don't push wanted owners who have a block relationship (either direction)
  // with the offer's owner — a block must silence match notifications too.
  if (matches.length) {
    const { data: blocks } = await admin
      .from('user_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${offer.owner_id},blocked_id.eq.${offer.owner_id}`);
    if (blocks?.length) {
      const blockedWith = new Set<string>();
      for (const b of blocks) {
        blockedWith.add(b.blocker_id === offer.owner_id ? b.blocked_id : b.blocker_id);
      }
      matches = matches.filter((w: any) => !blockedWith.has(w.owner_id));
    }
  }

  let sent = 0;
  for (const w of matches) {
    await admin.from('events').insert({
      event_type: 'wanted_matched',
      user_id: w.owner_id,
      listing_id: w.id,
      metadata: { offer_id: offer.id },
    });
    sent += await pushToUser(
      admin,
      w.owner_id,
      {
        title: 'Someone nearby may have what you want 🌱',
        body: `Someone nearby posted "${offer.title}" that may match your Wanted post.`,
      },
      { offerId: offer.id, wantedId: w.id, event: 'wanted_matched' },
    );
  }
  return json({ matched: matches.length, pushed: sent });
}

// --- market pickup orders ---------------------------------------------------
// sender: which party may fire the event; recipient gets the push.
const ORDER_EVENTS: Record<string, { sender: 'buyer' | 'seller' | 'either'; title: string; body: (o: any, name: string) => string }> = {
  pickup_request:       { sender: 'buyer',  title: 'New pickup request 🧺', body: (o, n) => `${n} wants to pick up ${fmtWindow(o)} — ${o.item_count} item${o.item_count === 1 ? '' : 's'}, $${(o.subtotal_cents / 100).toFixed(2)}.` },
  pickup_confirmed:     { sender: 'either', title: 'Pickup confirmed ✅', body: (o) => `Your pickup is set for ${fmtWindow(o)}.` },
  pickup_time_proposed: { sender: 'seller', title: 'Different time proposed 🕐', body: (o) => `The seller suggested ${fmtWindow(o, true)} instead. Accept or pick another time.` },
  pickup_cancelled:     { sender: 'either', title: 'Pickup cancelled', body: () => `A pickup order was cancelled. Details in Gnome.` },
  pickup_ready:         { sender: 'seller', title: 'Order ready 🧺', body: (o) => `Your order is packed and ready for ${fmtWindow(o)}.` },
  buyer_on_the_way:     { sender: 'buyer',  title: 'On the way 🚗', body: (o, n) => `${n} is on the way for the ${fmtWindow(o)} pickup.` },
  buyer_arrived:        { sender: 'buyer',  title: 'Arrived 👋', body: (o, n) => `${n} has arrived for pickup.` },
};

function fmtWindow(o: any, proposed = false): string {
  const iso = proposed ? o.proposed_start : (o.confirmed_start ?? o.requested_start);
  if (!iso) return 'the scheduled time';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: o.timezone || 'America/New_York',
  });
}

async function handleOrderEvent(admin: any, req: Request, event: string, orderId: string) {
  if (!orderId) return json({ error: 'orderId required' }, 400);
  const callerId = await callerFrom(admin, req);
  if (!callerId) return json({ error: 'unauthenticated' }, 401);

  const { data: order, error } = await admin
    .from('market_orders')
    .select('id, buyer_id, market_id, status, requested_start, confirmed_start, proposed_start, timezone, subtotal_cents, market:markets(owner_id, name)')
    .eq('id', orderId)
    .single();
  if (error || !order) return json({ error: 'order not found' }, 404);

  const sellerId = order.market?.owner_id;
  const spec = ORDER_EVENTS[event];
  const callerIsBuyer = callerId === order.buyer_id;
  const callerIsSeller = callerId === sellerId;
  if (!callerIsBuyer && !callerIsSeller) return json({ error: 'not a party to this order' }, 403);
  if (spec.sender === 'buyer' && !callerIsBuyer) return json({ error: 'buyer-only event' }, 403);
  if (spec.sender === 'seller' && !callerIsSeller) return json({ error: 'seller-only event' }, 403);

  const recipientId = callerIsBuyer ? sellerId : order.buyer_id;
  const { count } = await admin
    .from('market_order_items')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId);
  const { data: callerProfile } = await admin
    .from('profiles').select('name').eq('id', callerId).single();

  const o = { ...order, item_count: count ?? 0 };
  const sent = await pushToUser(
    admin, recipientId,
    { title: spec.title, body: spec.body(o, callerProfile?.name ?? 'A neighbor') },
    { orderId, event },
  );
  return json({ sent });
}

// --- grow log ----------------------------------------------------------------
async function handleGrowLogEvent(admin: any, req: Request, event: string, claimId: string) {
  if (!claimId) return json({ error: 'claimId required' }, 400);
  const callerId = await callerFrom(admin, req);
  if (!callerId) return json({ error: 'unauthenticated' }, 401);

  const { data: claim, error } = await admin
    .from('claims')
    .select('id, claimer_id, listing:listings(owner_id, title)')
    .eq('id', claimId)
    .single();
  if (error || !claim) return json({ error: 'claim not found' }, 404);
  const ownerId = claim.listing?.owner_id;

  let recipientId: string; let msg: { title: string; body: string };
  if (event === 'grow_log_update') {
    // Grower posted → tell the plot owner.
    if (callerId !== claim.claimer_id) return json({ error: 'grower-only event' }, 403);
    recipientId = ownerId;
    msg = { title: 'Grow Log update 🌱', body: `New progress on "${claim.listing?.title ?? 'your plot'}".` };
  } else {
    // Owner note → tell the grower.
    if (callerId !== ownerId) return json({ error: 'owner-only event' }, 403);
    recipientId = claim.claimer_id;
    msg = { title: 'Note from your plot owner 📝', body: `New note on "${claim.listing?.title ?? 'your plot'}".` };
  }
  const sent = await pushToUser(admin, recipientId, msg, { claimId, event });
  return json({ sent });
}

// --- helpers ----------------------------------------------------------------
/** The authenticated caller's user id from their JWT (never from the payload). */
async function callerFrom(admin: any, req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data?.user?.id ?? null;
}

async function pushToUser(
  admin: any,
  userId: string,
  message: { title: string; body: string },
  data: Record<string, unknown>,
): Promise<number> {
  const { data: tokens } = await admin
    .from('device_tokens')
    .select('token')
    .eq('user_id', userId);
  if (!tokens?.length) return 0;

  const messages = tokens.map((t: { token: string }) => ({
    to: t.token,
    sound: 'default',
    title: message.title,
    body: message.body,
    data,
  }));
  await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  return messages.length;
}

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
