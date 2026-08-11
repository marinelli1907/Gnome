// Gnome — Stripe webhook: turns Payment-Link checkouts into plan upgrades and
// paid listing boosts. Gnome never touches card data; Stripe hosts checkout.
//
// Flow (M10-lite):
//   /pricing links out to Stripe Payment Links with ?client_reference_id=
//     <market_id>            → subscription checkout upgrades markets.plan
//     boost_<listing_id>     → one-off payment creates a 7-day promotion
//   Cancellations downgrade the market back to 'free'.
//
// Secrets (supabase secrets set ...):
//   STRIPE_SECRET_KEY      rk_live_... restricted key (Checkout Sessions: Read)
//   STRIPE_WEBHOOK_SECRET  whsec_...   (from the webhook endpoint in Stripe)
//   STRIPE_PRICE_GROWER    price_...   (Grower monthly price id)
//   STRIPE_PRICE_FARM      price_...   (Farm monthly price id)
//   STRIPE_PRICE_BOOST     price_...   (one-off 7-day boost price id, optional)
//   STRIPE_PRICE_LOCATION_ADDON  price_... (extra pickup location, per-unit monthly)
//   STRIPE_PRICE_SEED_SUB        price_... (Seed Drop subscription price id)
//
// Deploy with verify_jwt OFF — Stripe authenticates via the signature header.
// Webhook endpoint URL: https://<ref>.supabase.co/functions/v1/stripe-webhook
// Events to send: checkout.session.completed, customer.subscription.updated,
//                 customer.subscription.deleted, invoice.paid,
//                 invoice.payment_failed

import Stripe from 'npm:stripe';
import { createClient } from 'npm:@supabase/supabase-js@2';

const BOOST_DAYS = 7;

Deno.serve(async (req: Request) => {
  // Accept the dashboard-entered casing variants too (secrets can't be renamed),
  // and trim — dashboard paste can carry a stray newline/space that breaks HMAC.
  const secretKey = (Deno.env.get('STRIPE_SECRET_KEY') ?? Deno.env.get('Stripe_Secret_Key'))?.trim();
  const webhookSecret = (
    Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? Deno.env.get('Stripe_Webhook_Secret')
  )?.trim();
  if (!secretKey || !webhookSecret) {
    return new Response('Stripe not configured', { status: 503 });
  }

  const stripe = new Stripe(secretKey);
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await req.text(),
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (e) {
    // Log the secret's *shape* (never its value) so a mis-pasted or wrong-endpoint
    // whsec is diagnosable from the function logs alone.
    const shape = /^whsec_[A-Za-z0-9]+$/.test(webhookSecret)
      ? `format ok, length ${webhookSecret.length}`
      : `UNEXPECTED FORMAT, length ${webhookSecret.length}`;
    console.error(
      `signature verification failed (secret ${shape}):`,
      e instanceof Error ? e.message : e,
    );
    return new Response('Bad signature', { status: 400 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Replay idempotency: insert-first on the event id — a redelivered event is
  // acknowledged without touching entitlements again (0068.stripe_events).
  {
    const { error: dupErr } = await admin
      .from('stripe_events')
      .insert({ id: event.id, type: event.type });
    if (dupErr) {
      if (dupErr.code === '23505') {
        console.log(`replay of ${event.id} (${event.type}) — skipped`);
        return new Response(JSON.stringify({ received: true, replay: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      console.error('stripe_events insert:', dupErr);
    }
  }

  const planForPrice = (priceId: string | null | undefined): 'grower' | 'farm' | null => {
    if (!priceId) return null;
    if (priceId === Deno.env.get('STRIPE_PRICE_GROWER')) return 'grower';
    if (priceId === Deno.env.get('STRIPE_PRICE_FARM')) return 'farm';
    return null;
  };

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const ref = session.client_reference_id ?? '';

        if (session.mode === 'payment' && ref.startsWith('seed_')) {
          // Seed Drop Starter: verified payment → create the order (idempotent
          // on session id) → snapshot the profile → run the deterministic
          // selection engine. AI never touches this path.
          const buyerId = ref.slice('seed_'.length);
          const { data: prof } = await admin
            .from('seed_profiles').select('*').eq('user_id', buyerId).maybeSingle();
          const { data: order, error: oerr } = await admin
            .from('seed_orders')
            .insert({
              user_id: buyerId,
              product: 'starter',
              packet_count: 6,
              status: 'paid',
              stripe_session_id: session.id,
              amount_cents: session.amount_total ?? null,
              profile_snapshot: prof ?? {},
            })
            .select('id')
            .single();
          if (oerr) {
            // 23505 = duplicate webhook delivery for the same session — done.
            if (!oerr.message.includes('duplicate')) console.error('seed order insert:', oerr);
            break;
          }
          const { data: reserved, error: gerr } = await admin
            .rpc('generate_seed_drop', { p_order: order.id });
          if (gerr) console.error('generate_seed_drop:', gerr);
          console.log(`seed drop order ${order.id}: ${reserved ?? '?'} packets reserved`);
          break;
        }

        if (session.mode === 'payment' && ref.startsWith('boost_')) {
          // One-off paid boost → 7-day promotion (source 'manual': the M7
          // trigger reserves 'paid' for a future in-app flow; service-role
          // 'manual' inserts are the sanctioned admin path).
          const listingId = ref.slice('boost_'.length);
          const { data: listing } = await admin
            .from('listings')
            .select('id,market_id')
            .eq('id', listingId)
            .maybeSingle();
          if (!listing?.market_id) break;
          await admin.from('listing_promotions').insert({
            listing_id: listing.id,
            market_id: listing.market_id,
            source: 'manual',
            status: 'active',
            starts_at: new Date().toISOString(),
            ends_at: new Date(Date.now() + BOOST_DAYS * 864e5).toISOString(),
            price_cents: session.amount_total ?? null,
            currency: (session.currency ?? 'usd').toUpperCase(),
          });
          console.log(`boost activated for listing ${listingId}`);
          break;
        }

        if (session.mode === 'subscription' && ref) {
          const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
          const addonPrice = Deno.env.get('STRIPE_PRICE_LOCATION_ADDON');
          const seedSubPrice = Deno.env.get('STRIPE_PRICE_SEED_SUB');

          // Seed Drop subscription checkout: ref = seedsub_<subscription row id>
          if (ref.startsWith('seedsub_')) {
            if (!seedSubPrice || !items.data.some((i) => i.price?.id === seedSubPrice)) {
              // Configuration gap — error out (releases idempotency in catch)
              // so Stripe retries until STRIPE_PRICE_SEED_SUB is set right.
              throw new Error(`seedsub checkout ${session.id} but STRIPE_PRICE_SEED_SUB unset/mismatched`);
            }
            const subRowId = ref.slice('seedsub_'.length);
            await admin.from('seed_drop_subscriptions').update({
              status: 'active',
              next_order_date: new Date().toISOString().slice(0, 10),
              stripe_customer_id: String(session.customer ?? ''),
              stripe_subscription_id: String(session.subscription ?? ''),
            }).eq('id', subRowId);
            console.log(`seed drop subscription ${subRowId} activated`);
            break;
          }

          const plan = planForPrice(
            items.data.find((i) => planForPrice(i.price?.id))?.price?.id,
          );
          // Extra pickup locations ride the same subscription as quantity on
          // the add-on price. Entitlement = webhook-verified quantity only.
          const addonQty = addonPrice
            ? items.data.find((i) => i.price?.id === addonPrice)?.quantity ?? 0
            : 0;
          if (!plan && !addonQty) { console.error('unknown price on session', session.id); break; }

          const patch: Record<string, unknown> = {};
          if (plan) patch.plan = plan;
          if (addonQty) patch.extra_pickup_locations = addonQty;
          await admin.from('markets').update(patch).eq('id', ref);
          await admin.from('market_subscriptions').insert({
            market_id: ref,
            plan: plan ?? 'free',
            kind: plan ? 'plan' : 'addon',
            provider: 'stripe',
            customer_id: String(session.customer ?? ''),
            subscription_id: String(session.subscription ?? ''),
            status: 'active',
          });
          if (plan) {
            // A plan change through a Payment Link creates a NEW subscription —
            // cancel any prior plan sub so the seller isn't double-billed and a
            // later cancellation of the old sub can't clobber the new plan.
            const { data: priors } = await admin
              .from('market_subscriptions')
              .select('subscription_id')
              .eq('market_id', ref).eq('kind', 'plan')
              .neq('subscription_id', String(session.subscription ?? ''))
              .in('status', ['active', 'trialing', 'past_due']);
            for (const prior of priors ?? []) {
              try {
                await stripe.subscriptions.cancel(prior.subscription_id);
              } catch (err) {
                console.error(`cancel prior sub ${prior.subscription_id}:`, err);
              }
              await admin.from('market_subscriptions')
                .update({ status: 'canceled' })
                .eq('subscription_id', prior.subscription_id);
            }
          }
          // Keep restricted/active location flags consistent with the new cap.
          await admin.rpc('reconcile_pickup_locations', { p_market: ref });
          console.log(`market ${ref}: plan=${plan ?? 'unchanged'} addons=${addonQty}`);
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const active = sub.status === 'active' || sub.status === 'trialing';

        // Seed Drop subscription lifecycle mirrors Stripe state.
        const { data: seedRow } = await admin
          .from('seed_drop_subscriptions')
          .select('id,status')
          .eq('stripe_subscription_id', sub.id)
          .maybeSingle();
        if (seedRow) {
          const next =
            event.type === 'customer.subscription.deleted' ? 'cancelled'
            : active ? 'active'
            : sub.status === 'past_due' || sub.status === 'unpaid' ? 'payment_failed'
            : sub.status === 'paused' ? 'paused'
            : 'incomplete';
          await admin.from('seed_drop_subscriptions')
            .update({ status: next }).eq('id', seedRow.id);
          console.log(`seed sub ${seedRow.id} → ${next} (${sub.status})`);
          break;
        }

        const { data: row } = await admin
          .from('market_subscriptions')
          .select('market_id,plan,kind')
          .eq('subscription_id', sub.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!row) break;
        await admin
          .from('market_subscriptions')
          .update({
            status: sub.status,
            current_period_start: new Date(sub.items.data[0]?.current_period_start * 1000).toISOString(),
            current_period_end: new Date(sub.items.data[0]?.current_period_end * 1000).toISOString(),
          })
          .eq('subscription_id', sub.id);

        const addonPrice2 = Deno.env.get('STRIPE_PRICE_LOCATION_ADDON');
        const carriesAddon = !!addonPrice2 && sub.items.data.some((i) => i.price?.id === addonPrice2);
        const addonQty2 = active && carriesAddon
          ? sub.items.data.find((i) => i.price?.id === addonPrice2)?.quantity ?? 0
          : 0;

        if (row.kind === 'addon') {
          // Add-on-only subscription: only the extras entitlement moves.
          await admin.from('markets')
            .update({ extra_pickup_locations: addonQty2 })
            .eq('id', row.market_id);
          await admin.rpc('reconcile_pickup_locations', { p_market: row.market_id });
          console.log(`market ${row.market_id} addon sub → extras=${addonQty2} (${sub.status})`);
          break;
        }

        // Plan subscription. Downgrade only when no OTHER active plan sub
        // exists (a plan change created a replacement before the old one died).
        if (!active) {
          const { data: survivor } = await admin
            .from('market_subscriptions')
            .select('subscription_id')
            .eq('market_id', row.market_id).eq('kind', 'plan')
            .neq('subscription_id', sub.id)
            .in('status', ['active', 'trialing'])
            .limit(1)
            .maybeSingle();
          if (survivor) {
            console.log(`market ${row.market_id}: old plan sub ${sub.status}, newer plan sub survives — no downgrade`);
            break;
          }
        }
        const patch2: Record<string, unknown> = { plan: active ? row.plan : 'free' };
        // Extras ride this sub only when it actually carries the addon price
        // (combined checkout); an addon bought on its own sub is untouched.
        if (carriesAddon || !active) {
          // On full downgrade extras die with the plan; a separate addon sub's
          // deleted event will also zero them, harmlessly.
          patch2.extra_pickup_locations = active ? addonQty2 : 0;
        }
        await admin.from('markets').update(patch2).eq('id', row.market_id);
        // Non-destructive: over-cap locations flip to plan_restricted, never deleted.
        await admin.rpc('reconcile_pickup_locations', { p_market: row.market_id });
        console.log(`market ${row.market_id} → ${active ? row.plan : 'free'} (${sub.status})`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as unknown as { subscription?: string | { id: string } };
        const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        if (!subId) break;
        const { data: seedRow } = await admin
          .from('seed_drop_subscriptions')
          .select('id').eq('stripe_subscription_id', subId).maybeSingle();
        if (seedRow) {
          await admin.from('seed_drop_subscriptions')
            .update({ status: 'payment_failed' }).eq('id', seedRow.id);
          console.log(`seed sub ${seedRow.id} → payment_failed`);
        }
        break;
      }

      case 'invoice.paid': {
        // A paid Seed Drop subscription invoice generates the next box through
        // the deterministic engine (reserves real packet inventory).
        const invoice = event.data.object as unknown as { subscription?: string | { id: string } };
        const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        if (!subId) break;
        const { data: seedRow } = await admin
          .from('seed_drop_subscriptions')
          .select('id,status,next_order_date')
          .eq('stripe_subscription_id', subId).maybeSingle();
        if (!seedRow) {
          // Stripe doesn't guarantee ordering: the first invoice.paid can beat
          // checkout.session.completed (which links stripe_subscription_id).
          // If this invoice is for the seed price, error out so Stripe retries
          // after the link lands; other subs' invoices are acked normally.
          const seedPrice2 = Deno.env.get('STRIPE_PRICE_SEED_SUB');
          const inv = event.data.object as unknown as {
            lines?: { data?: { price?: { id?: string } }[] };
          };
          const isSeedInvoice = !!seedPrice2
            && !!inv.lines?.data?.some((l) => l.price?.id === seedPrice2);
          if (isSeedInvoice) {
            throw new Error(`invoice.paid for seed sub ${subId} arrived before checkout linked it — retry`);
          }
          break;
        }
        if (seedRow.status === 'cancelled' || seedRow.status === 'paused') {
          // Paused/cancelled boxes never ship on autopilot; billing state is
          // reconciled by the subscription lifecycle events.
          console.log(`seed sub ${seedRow.id} is ${seedRow.status} — no box generated`);
          break;
        }
        if (seedRow.status !== 'active') {
          await admin.from('seed_drop_subscriptions')
            .update({ status: 'active' }).eq('id', seedRow.id);
        }
        {
          const { data: orderId, error: genErr } = await admin
            .rpc('generate_seed_subscription_order', { p_sub: seedRow.id, p_paid: true });
          if (genErr) throw new Error(`generate_seed_subscription_order: ${genErr.message}`);
          console.log(`seed sub ${seedRow.id}: order ${orderId} generated`);
        }
        break;
      }

      default:
        break; // acknowledge everything else
    }
  } catch (e) {
    console.error('webhook handling error:', e);
    // Release the idempotency claim — otherwise Stripe's automatic retry hits
    // the 23505 branch and the event's side effects are lost forever.
    await admin.from('stripe_events').delete().eq('id', event.id);
    return new Response('Handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
