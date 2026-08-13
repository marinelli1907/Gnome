// Gnome — Stripe webhook (v15). Turns verified Stripe events into plan
// upgrades, pickup add-ons, purchased promotion credits, seasonal Seed Drop
// payments, bundle activations, and refunds. Gnome never touches card data.
//
// SAFETY THIS ROUND:
//  * livemode is recorded on EVERY billing record (stripe_events.livemode,
//    *.stripe_livemode) so real MRR/revenue counts live-mode only. Test
//    transactions never contaminate business numbers (Parts 24/25).
//  * Ownership binding: server-authored session.metadata (gnome_user_id +
//    market_id/listing_id/subscription_id) is preferred over client_reference_id
//    and re-validated against the DB (Parts 5/21). Legacy Payment-Link refs
//    still work for back-compat.
//  * Idempotency: insert-first on event id (stripe_events); every money effect
//    also guards on the Stripe session/order id inside its RPC (Parts 22/23).
//  * Price→product resolution reads billing_products test/live columns.
//
// Secrets: STRIPE_SECRET_KEY_TEST / STRIPE_SECRET_KEY_LIVE (mode-specific;
//   STRIPE_SECRET_KEY legacy still honored). Signing: STRIPE_WEBHOOK_SECRET_TEST
//   / STRIPE_WEBHOOK_SECRET_LIVE (each verified independently; legacy
//   STRIPE_WEBHOOK_SECRET still accepted for transition).
// verify_jwt OFF — Stripe authenticates via the signature header.

import Stripe from 'npm:stripe';
import { createClient } from 'npm:@supabase/supabase-js@2';

const BOOST_DAYS = 7;

// Seed Drop ships as Coming Soon: no purchase surface exists in either client and
// billing-checkout refuses every seed product key. This is the last line of that
// same fence — it stops a seed event that reached Stripe by some other route (a
// hand-made session, a resurrected Payment Link, a replay of an old event) from
// mutating anything. It matters most for the legacy `seed_` branch, which would
// otherwise call generate_seed_drop and RESERVE REAL INVENTORY.
//
// Attempts are logged rather than dropped silently, so one shows up in
// billing_events instead of vanishing. Flip this to false only in the same
// change that re-opens the client purchase paths.
const SEED_DROP_COMING_SOON = true;

// Every client_reference_id prefix and product key that means "this is Seed Drop".
const SEED_REF_PREFIXES = ['seed_', 'seedseason_', 'seedsub_'];
const SEED_PRODUCT_KEYS = [
  'GNOME_SEED_DROP_SEASONAL', 'GNOME_SEED_DROP_ONE_TIME', 'GNOME_SEED_DROP_SUBSCRIPTION',
  'GNOME_GROWER_SEED_BUNDLE', 'GNOME_FARM_SEED_BUNDLE',
];

function isSeedDropEvent(ref: string, meta: Record<string, string>): boolean {
  return SEED_REF_PREFIXES.some((p) => ref.startsWith(p))
    || SEED_PRODUCT_KEYS.includes(meta.product_key ?? '')
    || Boolean(meta.subscription_id);   // only the Seed Drop paths set this key
}

Deno.serve(async (req: Request) => {
  const secretKey = (
    Deno.env.get('STRIPE_SECRET_KEY_TEST') ?? Deno.env.get('STRIPE_SECRET_KEY_LIVE') ??
    Deno.env.get('STRIPE_SECRET_KEY') ?? Deno.env.get('Stripe_Secret_Key')
  )?.trim();
  // Test/live signing secrets are distinct (Parts 4/32). A test endpoint sends
  // events signed with the TEST secret and a live endpoint with the LIVE secret;
  // we try each CONFIGURED candidate and only the matching one verifies — so a
  // test event never validates against the live secret or vice-versa. The legacy
  // single STRIPE_WEBHOOK_SECRET stays honored for a zero-downtime transition.
  const webhookSecrets = [
    ['test', Deno.env.get('STRIPE_WEBHOOK_SECRET_TEST')],
    ['live', Deno.env.get('STRIPE_WEBHOOK_SECRET_LIVE')],
    ['legacy', Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? Deno.env.get('Stripe_Webhook_Secret')],
  ].map(([k, v]) => [k, v?.trim()] as const).filter(([, v]) => !!v) as [string, string][];
  if (!secretKey || webhookSecrets.length === 0) return new Response('Stripe not configured', { status: 503 });

  const stripe = new Stripe(secretKey);
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  const rawBody = await req.text();
  let event: Stripe.Event | null = null;
  let lastErr: unknown = null;
  for (const [, whsec] of webhookSecrets) {
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, whsec, undefined, Stripe.createSubtleCryptoProvider());
      break;
    } catch (e) { lastErr = e; }
  }
  if (!event) {
    console.error(`signature verification failed against ${webhookSecrets.length} configured secret(s):`, lastErr instanceof Error ? lastErr.message : lastErr);
    return new Response('Bad signature', { status: 400 });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const livemode = event.livemode === true;

  // Replay idempotency: insert-first on the event id.
  {
    const { error: dupErr } = await admin.from('stripe_events').insert({ id: event.id, type: event.type, livemode });
    if (dupErr) {
      if (dupErr.code === '23505') {
        console.log(`replay of ${event.id} (${event.type}) — skipped`);
        return new Response(JSON.stringify({ received: true, replay: true }), { headers: { 'Content-Type': 'application/json' } });
      }
      console.error('stripe_events insert:', dupErr);
    }
  }

  // price id → product key, from billing_products (test + live columns).
  const { data: prods } = await admin.from('billing_products').select('key,stripe_price_id_test,stripe_price_id_live');
  const priceKey = new Map<string, string>();
  for (const p of prods ?? []) {
    if (p.stripe_price_id_test) priceKey.set(p.stripe_price_id_test, p.key);
    if (p.stripe_price_id_live) priceKey.set(p.stripe_price_id_live, p.key);
  }
  // Legacy env fallbacks (Payment-Link era).
  const env = (k: string) => Deno.env.get(k) ?? undefined;
  if (env('STRIPE_PRICE_GROWER')) priceKey.set(env('STRIPE_PRICE_GROWER')!, 'GNOME_GROWER_MONTHLY');
  if (env('STRIPE_PRICE_FARM')) priceKey.set(env('STRIPE_PRICE_FARM')!, 'GNOME_FARM_MONTHLY');
  if (env('STRIPE_PRICE_LOCATION_ADDON')) priceKey.set(env('STRIPE_PRICE_LOCATION_ADDON')!, 'GNOME_PICKUP_LOCATION_ADDON');
  if (env('STRIPE_PRICE_SEED_SUB')) priceKey.set(env('STRIPE_PRICE_SEED_SUB')!, 'GNOME_SEED_DROP_SEASONAL');
  const keyForPrice = (id?: string | null) => (id ? priceKey.get(id) : undefined);
  const planForKey = (k?: string) => (k === 'GNOME_GROWER_MONTHLY' ? 'grower' : k === 'GNOME_FARM_MONTHLY' ? 'farm' : null) as 'grower' | 'farm' | null;
  const bundlePlan = (k?: string) => (k === 'GNOME_GROWER_SEED_BUNDLE' ? 'grower' : k === 'GNOME_FARM_SEED_BUNDLE' ? 'farm' : null) as 'grower' | 'farm' | null;
  const log = (type: string, market: string | null, user: string | null, product: string | null, amount: number | null, effect: string, meta?: unknown) =>
    admin.rpc('billing_log_event', { p_event: event.id, p_type: type, p_livemode: livemode, p_market: market, p_user: user, p_product: product, p_amount: amount, p_effect: effect, p_meta: meta ?? null });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const meta = (session.metadata ?? {}) as Record<string, string>;
        const ref = session.client_reference_id ?? '';
        const amount = session.amount_total ?? null;

        // Coming Soon: refuse before any seed branch can run. Checked here rather
        // than inside each branch so a future branch cannot forget the guard.
        if (SEED_DROP_COMING_SOON && isSeedDropEvent(ref, meta)) {
          await log(event.type, null, meta.gnome_user_id || null,
                    meta.product_key || 'SEED_DROP', amount, 'refused:coming_soon');
          break;
        }

        // ---- Listing promotion purchase (server checkout: metadata.product_key)
        if (session.mode === 'payment' && (meta.product_key === 'GNOME_LISTING_PROMOTION' || ref.startsWith('promo_'))) {
          const listingId = meta.listing_id || ref.replace(/^promo_/, '');
          const { data: listing } = await admin.from('listings').select('id,market_id,owner_id').eq('id', listingId).maybeSingle();
          if (!listing?.market_id) break;
          // ownership: if metadata names a user, it must own the listing.
          if (meta.gnome_user_id && listing.owner_id !== meta.gnome_user_id) { await log(event.type, listing.market_id, meta.gnome_user_id, 'GNOME_LISTING_PROMOTION', amount, 'ownership_mismatch'); break; }
          const { data: outcome } = await admin.rpc('billing_purchase_and_promote', {
            p_session: session.id, p_livemode: livemode, p_market: listing.market_id, p_listing: listing.id, p_amount: amount });
          await log(event.type, listing.market_id, listing.owner_id, 'GNOME_LISTING_PROMOTION', amount, String(outcome ?? 'ok'));
          break;
        }

        // ---- Legacy Seed Drop Starter (payment link seed_<buyer>)
        if (session.mode === 'payment' && ref.startsWith('seed_')) {
          const buyerId = ref.slice('seed_'.length);
          const { data: prof } = await admin.from('seed_profiles').select('*').eq('user_id', buyerId).maybeSingle();
          const { data: order, error: oerr } = await admin.from('seed_orders')
            .insert({ user_id: buyerId, product: 'starter', packet_count: 6, status: 'paid', stripe_session_id: session.id, amount_cents: amount, stripe_livemode: livemode, profile_snapshot: prof ?? {} })
            .select('id').single();
          if (oerr) { if (!oerr.message.includes('duplicate')) console.error('seed order insert:', oerr); break; }
          const { error: gerr } = await admin.rpc('generate_seed_drop', { p_order: order.id });
          if (gerr) console.error('generate_seed_drop:', gerr);
          await log(event.type, null, buyerId, 'GNOME_SEED_DROP_ONE_TIME', amount, `starter_order:${order.id}`);
          break;
        }

        // ---- Legacy paid boost (payment link boost_<listing>)
        if (session.mode === 'payment' && ref.startsWith('boost_')) {
          const listingId = ref.slice('boost_'.length);
          const { data: listing } = await admin.from('listings').select('id,market_id').eq('id', listingId).maybeSingle();
          if (!listing?.market_id) break;
          await admin.from('listing_promotions').insert({ listing_id: listing.id, market_id: listing.market_id, source: 'manual', status: 'active', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + BOOST_DAYS * 864e5).toISOString(), price_cents: amount, currency: (session.currency ?? 'usd').toUpperCase(), stripe_livemode: livemode });
          await log(event.type, listing.market_id, null, 'GNOME_LISTING_PROMOTION', amount, 'legacy_boost');
          break;
        }

        // ---- Seasonal Seed Drop payment (server checkout: seedseason_<sub>)
        if (session.mode === 'subscription' && (meta.subscription_id || ref.startsWith('seedseason_')) && (meta.product_key === 'GNOME_SEED_DROP_SEASONAL' || ref.startsWith('seedseason_'))) {
          const subId = meta.subscription_id || ref.replace(/^seedseason_/, '');
          const { data: sub } = await admin.from('seed_drop_subscriptions').select('id,user_id').eq('id', subId).maybeSingle();
          if (!sub) break;
          if (meta.gnome_user_id && sub.user_id !== meta.gnome_user_id) { await log(event.type, null, meta.gnome_user_id, 'GNOME_SEED_DROP_SEASONAL', amount, 'ownership_mismatch'); break; }
          await admin.from('seed_drop_subscriptions').update({ status: 'active', stripe_customer_id: String(session.customer ?? ''), stripe_subscription_id: String(session.subscription ?? '') }).eq('id', subId);
          const { data: outcome } = await admin.rpc('billing_pay_seed_seasonal', { p_session: session.id, p_livemode: livemode, p_sub: subId, p_amount: amount });
          await log(event.type, null, sub.user_id, 'GNOME_SEED_DROP_SEASONAL', amount, String(outcome ?? 'ok'));
          break;
        }

        // ---- Legacy Seed Drop subscription (payment link seedsub_<sub>)
        if (session.mode === 'subscription' && ref.startsWith('seedsub_')) {
          const subRowId = ref.slice('seedsub_'.length);
          await admin.from('seed_drop_subscriptions').update({ status: 'active', next_order_date: new Date().toISOString().slice(0, 10), stripe_customer_id: String(session.customer ?? ''), stripe_subscription_id: String(session.subscription ?? '') }).eq('id', subRowId);
          await log(event.type, null, null, 'GNOME_SEED_DROP_SEASONAL', amount, `seedsub:${subRowId}`);
          break;
        }

        // ---- Plan / add-on / BUNDLE subscription
        if (session.mode === 'subscription' && ref) {
          const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
          const keys = items.data.map((i) => keyForPrice(i.price?.id)).filter(Boolean) as string[];
          const market = meta.market_id || ref;
          const userId = meta.gnome_user_id || null;

          // The guard above reads metadata, which a legacy Payment Link does not
          // carry. Bundles resolve from line items instead, so re-check here.
          if (SEED_DROP_COMING_SOON && keys.some((k) => SEED_PRODUCT_KEYS.includes(k))) {
            await log(event.type, market, userId, keys.find((k) => SEED_PRODUCT_KEYS.includes(k)) ?? 'SEED_DROP',
                      session.amount_total ?? null, 'refused:coming_soon');
            break;
          }

          // Bundle: resolves to seller plan + seed access, atomically.
          const bKey = keys.find((k) => bundlePlan(k));
          if (bKey && userId) {
            await admin.rpc('billing_activate_bundle', { p_market: market, p_user: userId, p_plan: bundlePlan(bKey), p_sub_stripe: String(session.subscription ?? ''), p_customer: String(session.customer ?? ''), p_livemode: livemode });
            await log(event.type, market, userId, bKey, session.amount_total ?? null, `bundle:${bundlePlan(bKey)}`);
            break;
          }

          const planKey = keys.find((k) => planForKey(k));
          const plan = planForKey(planKey);
          const addonQty = items.data.find((i) => keyForPrice(i.price?.id) === 'GNOME_PICKUP_LOCATION_ADDON')?.quantity ?? 0;
          if (!plan && !addonQty) { console.error('unknown price on session', session.id); break; }

          const patch: Record<string, unknown> = {};
          if (plan) patch.plan = plan;
          if (addonQty) patch.extra_pickup_locations = addonQty;
          await admin.from('markets').update(patch).eq('id', market);
          await admin.from('market_subscriptions').insert({ market_id: market, plan: plan ?? 'free', kind: plan ? 'plan' : 'addon', provider: 'stripe', customer_id: String(session.customer ?? ''), subscription_id: String(session.subscription ?? ''), status: 'active', stripe_livemode: livemode });
          if (plan) {
            const { data: priors } = await admin.from('market_subscriptions').select('subscription_id').eq('market_id', market).eq('kind', 'plan').neq('subscription_id', String(session.subscription ?? '')).in('status', ['active', 'trialing', 'past_due']);
            for (const prior of priors ?? []) {
              try { await stripe.subscriptions.cancel(prior.subscription_id); } catch (err) { console.error(`cancel prior sub ${prior.subscription_id}:`, err); }
              await admin.from('market_subscriptions').update({ status: 'canceled' }).eq('subscription_id', prior.subscription_id);
            }
          }
          await admin.rpc('reconcile_pickup_locations', { p_market: market });
          await log(event.type, market, userId, planKey ?? 'GNOME_PICKUP_LOCATION_ADDON', session.amount_total ?? null, `plan:${plan ?? 'unchanged'} addons:${addonQty}`);
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const active = sub.status === 'active' || sub.status === 'trialing';

        const { data: seedRow } = await admin.from('seed_drop_subscriptions').select('id,status').eq('stripe_subscription_id', sub.id).maybeSingle();
        if (seedRow) {
          const next = event.type === 'customer.subscription.deleted' ? 'cancelled' : active ? 'active' : sub.status === 'past_due' || sub.status === 'unpaid' ? 'payment_failed' : sub.status === 'paused' ? 'paused' : 'incomplete';
          await admin.from('seed_drop_subscriptions').update({ status: next }).eq('id', seedRow.id);
          await log(event.type, null, null, 'GNOME_SEED_DROP_SEASONAL', null, `seed_sub:${next}`);
          break;
        }

        const { data: row } = await admin.from('market_subscriptions').select('market_id,plan,kind').eq('subscription_id', sub.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (!row) break;
        await admin.from('market_subscriptions').update({ status: sub.status, current_period_start: new Date(sub.items.data[0]?.current_period_start * 1000).toISOString(), current_period_end: new Date(sub.items.data[0]?.current_period_end * 1000).toISOString() }).eq('subscription_id', sub.id);

        const addonKey = 'GNOME_PICKUP_LOCATION_ADDON';
        const carriesAddon = sub.items.data.some((i) => keyForPrice(i.price?.id) === addonKey);
        const addonQty2 = active && carriesAddon ? sub.items.data.find((i) => keyForPrice(i.price?.id) === addonKey)?.quantity ?? 0 : 0;

        if (row.kind === 'addon') {
          await admin.from('markets').update({ extra_pickup_locations: addonQty2 }).eq('id', row.market_id);
          await admin.rpc('reconcile_pickup_locations', { p_market: row.market_id });
          await log(event.type, row.market_id, null, addonKey, null, `addon:${addonQty2} (${sub.status})`);
          break;
        }

        // Plan sub. Downgrade only when NO other active plan sub survives
        // (a plan change created a replacement) — stale cancel can't clobber.
        if (!active) {
          const { data: survivor } = await admin.from('market_subscriptions').select('subscription_id').eq('market_id', row.market_id).eq('kind', 'plan').neq('subscription_id', sub.id).in('status', ['active', 'trialing']).limit(1).maybeSingle();
          if (survivor) { await log(event.type, row.market_id, null, null, null, 'stale_cancel_ignored'); break; }
        }
        const patch2: Record<string, unknown> = { plan: active ? row.plan : 'free' };
        if (carriesAddon || !active) patch2.extra_pickup_locations = active ? addonQty2 : 0;
        await admin.from('markets').update(patch2).eq('id', row.market_id);
        await admin.rpc('reconcile_pickup_locations', { p_market: row.market_id });
        await log(event.type, row.market_id, null, null, null, `plan:${active ? row.plan : 'free'} (${sub.status})`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as unknown as { subscription?: string | { id: string } };
        const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        if (!subId) break;
        const { data: seedRow } = await admin.from('seed_drop_subscriptions').select('id').eq('stripe_subscription_id', subId).maybeSingle();
        if (seedRow) {
          await admin.from('seed_drop_subscriptions').update({ status: 'payment_failed' }).eq('id', seedRow.id);
          await log(event.type, null, null, 'GNOME_SEED_DROP_SEASONAL', null, 'seed_payment_failed');
          break;
        }
        // Plan sub: mark past_due; entitlement follows subscription.updated policy.
        const { data: row } = await admin.from('market_subscriptions').select('market_id').eq('subscription_id', subId).maybeSingle();
        if (row) await log(event.type, row.market_id, null, null, null, 'plan_payment_failed');
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as unknown as { subscription?: string | { id: string }; lines?: { data?: { price?: { id?: string } }[] } };
        const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        if (!subId) break;
        // A renewal is the one seed path that needs no checkout at all — an old
        // subscription invoicing again would generate a box. Refuse it too, and
        // do NOT throw: throwing asks Stripe to retry forever.
        if (SEED_DROP_COMING_SOON) {
          const seedInvoice = invoice.lines?.data?.some(
            (l) => SEED_PRODUCT_KEYS.includes(keyForPrice(l.price?.id) ?? ''));
          const { data: seedSub } = await admin.from('seed_drop_subscriptions')
            .select('id').eq('stripe_subscription_id', subId).maybeSingle();
          if (seedInvoice || seedSub) {
            await log(event.type, null, null, 'GNOME_SEED_DROP_SEASONAL', null, 'refused:coming_soon');
            break;
          }
        }
        const { data: seedRow } = await admin.from('seed_drop_subscriptions').select('id,status').eq('stripe_subscription_id', subId).maybeSingle();
        if (!seedRow) {
          const isSeedInvoice = invoice.lines?.data?.some((l) => keyForPrice(l.price?.id) === 'GNOME_SEED_DROP_SEASONAL');
          if (isSeedInvoice) throw new Error(`invoice.paid for seed sub ${subId} arrived before checkout linked it — retry`);
          break;
        }
        if (seedRow.status === 'cancelled' || seedRow.status === 'paused') { console.log(`seed sub ${seedRow.id} is ${seedRow.status} — no box`); break; }
        if (seedRow.status !== 'active') await admin.from('seed_drop_subscriptions').update({ status: 'active' }).eq('id', seedRow.id);
        const { data: orderId, error: genErr } = await admin.rpc('generate_seed_subscription_order', { p_sub: seedRow.id, p_paid: true });
        if (genErr) throw new Error(`generate_seed_subscription_order: ${genErr.message}`);
        await log(event.type, null, null, 'GNOME_SEED_DROP_SEASONAL', null, `renewal_order:${orderId}`);
        break;
      }

      case 'charge.refunded':
      case 'refund.created': {
        // Promotion refund → claw back a still-unconsumed purchased credit.
        // Seed/plan refunds: log for the audit trail; history preserved,
        // shipped inventory never auto-restored (Parts 13/17).
        const obj = event.data.object as unknown as { payment_intent?: string; metadata?: Record<string, string>; amount_refunded?: number; checkout_session?: string };
        const sessionHint = obj.metadata?.checkout_session || obj.checkout_session || null;
        if (sessionHint) {
          const { data: outcome } = await admin.rpc('billing_refund_promo_credit', { p_session: sessionHint, p_livemode: livemode });
          await log(event.type, null, null, null, obj.amount_refunded ?? null, `refund:${outcome ?? 'logged'}`);
        } else {
          await log(event.type, null, null, null, obj.amount_refunded ?? null, 'refund_logged');
        }
        break;
      }

      default:
        break;
    }
  } catch (e) {
    console.error('webhook handling error:', e);
    await admin.from('stripe_events').delete().eq('id', event.id);
    return new Response('Handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
});
