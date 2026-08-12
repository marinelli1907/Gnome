// Gnome — server-side Stripe Checkout Session creator (replaces generic
// Payment Links). SECURITY: the caller's identity comes from the JWT; the
// Market/listing/subscription is resolved from the DB as OWNED BY that user.
// A client can never say "credit this to Market B" — ownership is bound
// server-side into session metadata that the webhook re-validates (Parts 5,21).
//
// MODE + LIVE GATE (Part 29): mode follows billing_config. Test mode uses
// STRIPE_SECRET_KEY_TEST; live mode uses STRIPE_SECRET_KEY_LIVE and is only
// reachable when the owner has flipped payments_live_enabled=true. Default is
// TEST — Gnome will not create a live session otherwise, even with a live key.
//
// Secrets (server-side only; never shipped to any client):
//   STRIPE_SECRET_KEY_TEST   sk_test_...
//   STRIPE_SECRET_KEY_LIVE   sk_live_...   (unused until the owner enables live)
//   GNOME_PUBLIC_URL         https://gnomefarmersmarket.com  (return/cancel base)
import Stripe from 'npm:stripe';
import { createClient } from 'npm:@supabase/supabase-js@2';

type Body = {
  product_key: string;
  listing_id?: string;      // GNOME_LISTING_PROMOTION
  subscription_id?: string; // GNOME_SEED_DROP_SEASONAL (seed_drop_subscriptions row)
  quantity?: number;        // GNOME_PICKUP_LOCATION_ADDON
};

const SUBSCRIPTION_KEYS = new Set([
  'GNOME_GROWER_MONTHLY', 'GNOME_FARM_MONTHLY', 'GNOME_PICKUP_LOCATION_ADDON',
  'GNOME_SEED_DROP_SEASONAL', 'GNOME_GROWER_SEED_BUNDLE', 'GNOME_FARM_SEED_BUNDLE',
]);

Deno.serve(async (req: Request) => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return json(401, { error: 'UNAUTHENTICATED' });

    const body = (await req.json().catch(() => ({}))) as Body;
    const key = String(body.product_key ?? '');
    const { data: product } = await admin.from('billing_products').select('*').eq('key', key).maybeSingle();
    if (!product || !product.active) return json(400, { error: 'UNKNOWN_PRODUCT' });

    // Mode + live gate.
    const { data: cfg } = await admin.from('billing_config').select('payments_live_enabled').limit(1).maybeSingle();
    const live = cfg?.payments_live_enabled === true;
    const mode = live ? 'live' : 'test';
    const secretKey = (live ? Deno.env.get('STRIPE_SECRET_KEY_LIVE') : Deno.env.get('STRIPE_SECRET_KEY_TEST'))?.trim();
    const priceId = live ? product.stripe_price_id_live : product.stripe_price_id_test;
    if (!secretKey) return json(503, { error: 'STRIPE_KEY_MISSING', message: `STRIPE_SECRET_KEY_${mode.toUpperCase()} not set — owner config required.` });
    if (!priceId) return json(503, { error: 'PRICE_MISSING', message: `No ${mode} price configured for ${key}.` });

    // The caller's OWN market (owner_id = uid). Never a client-supplied id.
    const { data: market } = await admin.from('markets').select('id,owner_id').eq('owner_id', uid).limit(1).maybeSingle();

    const base = (Deno.env.get('GNOME_PUBLIC_URL') ?? 'https://gnomefarmersmarket.com').replace(/\/$/, '');
    const meta: Record<string, string> = { gnome_user_id: uid, product_key: key, mode };
    let clientRef = '';
    let checkoutMode: 'subscription' | 'payment' = SUBSCRIPTION_KEYS.has(key) ? 'subscription' : 'payment';
    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = { price: priceId, quantity: 1 };

    if (key === 'GNOME_LISTING_PROMOTION') {
      const listingId = String(body.listing_id ?? '');
      const { data: listing } = await admin.from('listings').select('id,market_id,owner_id').eq('id', listingId).maybeSingle();
      if (!listing || listing.owner_id !== uid) return json(403, { error: 'NOT_YOUR_LISTING' });
      meta.listing_id = listing.id; meta.market_id = listing.market_id;
      clientRef = `promo_${listing.id}`;
    } else if (key === 'GNOME_SEED_DROP_SEASONAL') {
      const subId = String(body.subscription_id ?? '');
      const { data: sub } = await admin.from('seed_drop_subscriptions').select('id,user_id').eq('id', subId).maybeSingle();
      if (!sub || sub.user_id !== uid) return json(403, { error: 'NOT_YOUR_SUBSCRIPTION' });
      meta.subscription_id = sub.id;
      clientRef = `seedseason_${sub.id}`;
    } else {
      // plan / addon / bundle — must own a Market.
      if (!market) return json(403, { error: 'NO_MARKET', message: 'Post once to create your Market first.' });
      meta.market_id = market.id;
      clientRef = market.id;
      if (key === 'GNOME_PICKUP_LOCATION_ADDON') {
        lineItem.quantity = Math.max(1, Math.min(20, Number(body.quantity ?? 1)));
      }
    }

    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.create({
      mode: checkoutMode,
      line_items: [lineItem],
      client_reference_id: clientRef,
      metadata: meta,                    // server-authored ownership binding
      success_url: `${base}/account?checkout=success`,
      cancel_url: `${base}/account?checkout=cancelled`,
      allow_promotion_codes: false,
    });

    return json(200, { url: session.url, mode });
  } catch (e) {
    console.error('billing-checkout:', e);
    return json(500, { error: 'CHECKOUT_FAILED', detail: String(e).slice(0, 200) });
  }
});
