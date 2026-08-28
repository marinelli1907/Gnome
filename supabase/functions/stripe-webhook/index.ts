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
//  * The API CLIENT follows the event (§13). Signature verification proves the
//    event is genuine and tells us its mode; the secret key used for every
//    subsequent Stripe REST call is then re-resolved from event.livemode, so a
//    live event is never answered by the test account.
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
  const envKey = (name: string) => Deno.env.get(name)?.trim() || undefined;
  const testKey = envKey('STRIPE_SECRET_KEY_TEST');
  const liveKey = envKey('STRIPE_SECRET_KEY_LIVE');
  const legacyKey = envKey('STRIPE_SECRET_KEY') ?? envKey('Stripe_Secret_Key');

  // Which mode a key PROVES it belongs to. Stripe secret and restricted keys
  // carry the mode in the prefix (sk_test_ / rk_test_ / sk_live_ / rk_live_);
  // anything else proves nothing and is treated as unknown rather than assumed.
  const modeOf = (k?: string): 'live' | 'test' | null =>
    /^(sk|rk)_live_/.test(k ?? '') ? 'live' : /^(sk|rk)_test_/.test(k ?? '') ? 'test' : null;

  // The key for ONE mode, or undefined. Deliberately never falls through to the
  // other mode's key: the mode-specific variable is used unless its own prefix
  // proves it holds the OPPOSITE mode's secret (a misfiled secret would put the
  // crossover straight back), and the legacy single key — which predates the
  // split and could be either mode — is only usable when its prefix proves it.
  const keyForMode = (want: 'live' | 'test'): string | undefined => {
    const named = want === 'live' ? liveKey : testKey;
    if (named && modeOf(named) !== (want === 'live' ? 'test' : 'live')) return named;
    if (legacyKey && modeOf(legacyKey) === want) return legacyKey;
    return undefined;
  };

  // Verification does not care WHICH key this is: constructEventAsync is an HMAC
  // over the raw body and the SIGNING secret and never consults the API key. So
  // any configured key can build the verifier, and the mode-matched client is
  // constructed afterwards, from the event's own livemode. Same precedence as
  // before, so "Stripe not configured" still means exactly what it used to.
  const anyKey = testKey ?? liveKey ?? legacyKey;
  // Test/live signing secrets are distinct (Parts 4/32). A test endpoint sends
  // events signed with the TEST secret and a live endpoint with the LIVE secret;
  // we try each CONFIGURED candidate and only the matching one verifies — so a
  // test event never validates against the live secret or vice-versa. The legacy
  // single STRIPE_WEBHOOK_SECRET stays honored for a zero-downtime transition.
  let webhookSecrets = [
    ['test', Deno.env.get('STRIPE_WEBHOOK_SECRET_TEST')],
    ['live', Deno.env.get('STRIPE_WEBHOOK_SECRET_LIVE')],
    ['legacy', Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? Deno.env.get('Stripe_Webhook_Secret')],
  ].map(([k, v]) => [k, v?.trim()] as const).filter(([, v]) => !!v) as [string, string][];
  // The SAME value in both mode slots proves neither mode — the plausible
  // migration mistake is copying the old single secret into both new variables.
  // Left as-is, every genuine live event would verify at the first (test) slot
  // and the consistency gate below would 400 it forever. Collapsed to one
  // legacy-labeled entry, which verifies fine and constrains nothing.
  {
    const testSecret = webhookSecrets.find(([k]) => k === 'test')?.[1];
    const liveSecret = webhookSecrets.find(([k]) => k === 'live')?.[1];
    if (testSecret && testSecret === liveSecret) {
      webhookSecrets = ([['legacy', testSecret]] as [string, string][])
        .concat(webhookSecrets.filter(([k]) => k !== 'test' && k !== 'live'));
    }
  }
  if (!anyKey || webhookSecrets.length === 0) return new Response('Stripe not configured', { status: 503 });

  const verifier = new Stripe(anyKey);
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  const rawBody = await req.text();
  let event: Stripe.Event | null = null;
  let verifiedBy: string | null = null;
  let lastErr: unknown = null;
  for (const [label, whsec] of webhookSecrets) {
    try {
      event = await verifier.webhooks.constructEventAsync(rawBody, signature, whsec, undefined, Stripe.createSubtleCryptoProvider());
      verifiedBy = label;
      break;
    } catch (e) { lastErr = e; }
  }
  if (!event) {
    console.error(`signature verification failed against ${webhookSecrets.length} configured secret(s):`, lastErr instanceof Error ? lastErr.message : lastErr);
    return new Response('Bad signature', { status: 400 });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const livemode = event.livemode === true;

  // event.livemode is only as trustworthy as the secret that verified it. Each
  // signing secret is minted by ONE mode's endpoint, so an event verified by the
  // TEST secret claiming livemode:true is not a Stripe event — it is a forgery
  // or a swapped-secret misconfiguration, and either way acting on its word
  // would let the LOW-trust test signing secret select the LIVE key and write
  // live-flagged money rows. Refused as a bad signature is refused: 400, before
  // anything is written. The legacy single secret predates the split and proves
  // neither mode, so it constrains nothing — same standing as the legacy key.
  if ((verifiedBy === 'test' && livemode) || (verifiedBy === 'live' && !livemode)) {
    console.error(`event ${event.id} livemode=${livemode} contradicts the ${verifiedBy} signing secret that verified it — refused`);
    return new Response('Event mode contradicts signing secret', { status: 400 });
  }

  // ---- the Stripe API client is chosen by the EVENT, not by what is configured
  // Signature verification already proved this event came from Stripe and told
  // us which mode minted it; that is the only trustworthy mode signal there is,
  // and it is what every REST call below must be made with.
  //
  // Before this, the client was built from `TEST ?? LIVE ?? legacy`, so it was a
  // TEST client whenever a test key existed at all. A genuine LIVE event still
  // verified — the live signing secret is a separate secret, checked
  // independently — and then entered the handler, where every branch that asks
  // Stripe a question asked the WRONG ACCOUNT: listLineItems for a live session
  // returns nothing in test, so a paid plan resolved to "unknown price" and the
  // upgrade was dropped; cancelling a prior live subscription silently failed,
  // leaving the seller billed twice. A wrong-account answer to a money question
  // is worse than no answer, because it looks like an answer.
  const secretKey = keyForMode(livemode ? 'live' : 'test');
  // Nullable ON PURPOSE, and the refusal for a missing key does not live here.
  // Exactly two statements in this handler ask Stripe a question — listLineItems
  // and subscriptions.cancel, both inside the plan/bundle subscription branch —
  // and every other branch works entirely from the signed event payload and our
  // own database, with the event's own livemode written to every row. Refusing
  // the WHOLE event up here would turn a two-call-site requirement into a
  // kill switch: after go-live key hygiene (live key configured, test key
  // retired) every TEST event — overage payments, refunds, subscription
  // lifecycle — would be dropped for want of a key none of them use. The
  // subscription branch performs its own refusal, before any of its writes.
  const stripe = secretKey ? new Stripe(secretKey) : null;

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
  // Internal enum values, which are NOT the customer-facing names. Since 0126,
  // 'farm' is customer-facing Farm and 'sponsor' is the retired Legacy Farm
  // comp rung kept for legacy events.
  const planForKey = (k?: string) => (k === 'GNOME_GROWER_MONTHLY' ? 'grower' : k === 'GNOME_FARM_MONTHLY' ? 'farm' : k === 'GNOME_SPONSOR_MONTHLY' ? 'sponsor' : null) as 'grower' | 'farm' | 'sponsor' | null;
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

        // ---- $0.99 listing overage (publish or renewal) --------------------
        // Placed ahead of every other payment branch because it is the only one
        // whose effect is an ENTITLEMENT rather than an immediate mutation: the
        // authorization is marked paid, and the listing itself is published
        // later by the seller, when the 0104 trigger consumes it.
        //
        // Idempotency is mark_authorization_paid's job, not this branch's — it
        // only matches a row still 'pending', so a replayed event updates
        // nothing and reports false. Two guards sit on top of the outer
        // stripe_events replay check because a delayed webhook and a retry can
        // arrive by different paths.
        if (session.mode === 'payment' && meta.overage_intent) {
          const { data: auth } = await admin.from('listing_publish_authorizations')
            .select('id,market_id,intent,status').eq('stripe_session_id', session.id).maybeSingle();

          if (!auth) {
            // The pending row is written at checkout time, so its absence means
            // this session did not originate here. Never create one now: an
            // authorization conjured from webhook metadata alone would let
            // anyone who can forge a session grant themselves a publish.
            await log(event.type, meta.market_id || null, meta.gnome_user_id || null,
                      meta.product_key || null, amount, 'overage:unknown_session');
            break;
          }
          if (auth.status === 'consumed') {
            await log(event.type, auth.market_id, meta.gnome_user_id || null,
                      meta.product_key || null, amount, 'overage:already_consumed');
            break;
          }

          // Mode truth, from event.livemode and nothing else. billing-checkout
          // stamped this row from the key it resolved when the session was
          // created; this is Stripe's own confirmation of the same fact, and it
          // is the value 0124's consumption guard compares against the platform
          // mode before letting the authorization fund a publish.
          //
          // It is a separate statement because mark_authorization_paid's
          // signature is (p_session, p_payment_intent) — 0124 adds the column
          // without touching the function, and that function is owned by the SQL
          // layer. Scoped by the UNIQUE stripe_session_id, so it can only reach
          // this one row, and to rows still 'pending' — the same guard that makes
          // mark_authorization_paid report false on a replay, so a replayed or
          // out-of-order event cannot rewrite the mode of an authorization that
          // has already been paid, consumed or refunded. That ordering is why the
          // stamp runs BEFORE the row is moved to 'paid'.
          const { error: modeErr } = await admin.from('listing_publish_authorizations')
            .update({ stripe_livemode: livemode })
            .eq('stripe_session_id', session.id).eq('status', 'pending');
          if (modeErr) console.error(`stamp stripe_livemode on ${session.id}:`, modeErr);

          const { data: became } = await admin.rpc('mark_authorization_paid', {
            p_session: session.id,
            p_payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
          });
          await log(event.type, auth.market_id, meta.gnome_user_id || null,
                    meta.product_key || null, amount,
                    became === true ? `overage_paid:${auth.intent}` : 'overage:replay_ignored');
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
          // The ONE branch that must ask Stripe a question (line items below,
          // prior-subscription cancel further down), so the ONE branch a missing
          // mode-matched key refuses. Order matters on all three counts:
          //   - nothing in this branch has been written yet, so refusing here
          //     leaves no partial effect;
          //   - the dedupe row is DELETED before returning — same shape as the
          //     handler-error path below — so the retry is not skipped as a
          //     replay once the owner configures the key;
          //   - 503, not 200: Stripe retries with backoff for days, which is
          //     the automatic recovery a dropped plan purchase deserves. The
          //     refusal is logged to billing_events either way, and that log
          //     call's own failure is at least printed — a dropped live payment
          //     must never be an empty log line.
          if (!stripe) {
            console.error(`no ${livemode ? 'live' : 'test'}-mode Stripe key configured — ${event.id} (${event.type}) refused for retry, NOT processed`);
            const { error: logErr } = await log(event.type, meta.market_id || ref || null,
              meta.gnome_user_id || null, meta.product_key || null, amount, 'refused:no_key_for_mode');
            if (logErr) console.error(`billing_log_event(no_key_for_mode) for ${event.id}:`, logErr);
            // The 503-retry design stands or falls on this delete: a surviving
            // dedupe row turns the retry into `replay:true` 200 and the purchase
            // is dropped for good. So the delete is checked, retried once, and a
            // double failure is logged as loudly as this function can log —
            // the 503 still goes out either way, because refusing to answer is
            // strictly better than acknowledging an event that was not handled.
            let { error: delErr } = await admin.from('stripe_events').delete().eq('id', event.id);
            if (delErr) ({ error: delErr } = await admin.from('stripe_events').delete().eq('id', event.id));
            if (delErr) console.error(`CRITICAL: dedupe row for ${event.id} could not be deleted after no_key_for_mode refusal — the Stripe retry will be skipped as a replay; resend the event manually once the key is configured:`, delErr);
            return new Response('No Stripe key configured for this event mode', { status: 503 });
          }
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
          await admin.from('market_subscriptions').insert({
            market_id: market, user_id: userId, plan: plan ?? 'free', kind: plan ? 'plan' : 'addon',
            provider: 'stripe', billing_source: 'STRIPE', customer_id: String(session.customer ?? ''),
            subscription_id: String(session.subscription ?? ''), external_product_id: planKey ?? 'GNOME_PICKUP_LOCATION_ADDON',
            external_transaction_id: String(session.subscription ?? ''), original_transaction_id: session.id,
            status: 'active', environment: livemode ? 'PRODUCTION' : 'TEST', started_at: new Date().toISOString(),
            last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString(), stripe_livemode: livemode,
          });
          if (plan) {
            // Only priors minted in THIS event's mode: the client below can only
            // cancel subscriptions in its own account, so a cross-mode row would
            // fail the cancel and then be recorded as canceled anyway — the DB
            // saying "stopped" about a subscription Stripe is still charging.
            // Test events also match rows from before the column existed (NULL:
            // this platform has never taken a live payment, so every legacy row
            // is test-era); live events match only rows that PROVED live.
            const priorsQ = admin.from('market_subscriptions').select('subscription_id')
              .eq('market_id', market).eq('kind', 'plan')
              .neq('subscription_id', String(session.subscription ?? ''))
              .in('status', ['active', 'trialing', 'past_due']);
            const { data: priors } = livemode
              ? await priorsQ.eq('stripe_livemode', true)
              : await priorsQ.or('stripe_livemode.eq.false,stripe_livemode.is.null');
            for (const prior of priors ?? []) {
              // 'canceled' is written when it is TRUE: the cancel succeeded, or
              // Stripe says the subscription no longer exists. Any other failure
              // leaves the row alone — a transient error must not record a
              // subscription as stopped while Stripe keeps charging it; the
              // customer.subscription.deleted event converges it later instead.
              try {
                await stripe.subscriptions.cancel(prior.subscription_id);
                await admin.from('market_subscriptions').update({ status: 'canceled' }).eq('subscription_id', prior.subscription_id);
              } catch (err) {
                console.error(`cancel prior sub ${prior.subscription_id}:`, err);
                if ((err as { code?: string })?.code === 'resource_missing') {
                  await admin.from('market_subscriptions').update({ status: 'canceled' }).eq('subscription_id', prior.subscription_id);
                }
              }
            }
          }
          await admin.rpc('reconcile_pickup_locations', { p_market: market });
          await log(event.type, market, userId, planKey ?? 'GNOME_PICKUP_LOCATION_ADDON', session.amount_total ?? null, `plan:${plan ?? 'unchanged'} addons:${addonQty}`);

          // ---- promo redemption ------------------------------------------
          // Recorded HERE, on Stripe's confirmation, rather than optimistically
          // at checkout: an abandoned session would otherwise burn a redemption
          // and, for a capped campaign, deny it to somebody who would have paid.
          //
          // The campaign id comes from server-authored session metadata, never
          // from anything the customer supplied, and record_promo_redemption is
          // ON CONFLICT (stripe_session_id) DO NOTHING, so a replay inserts
          // nothing. amount_total is 0 during a 100%-off period, so the discount
          // is taken from Stripe's own total_details rather than inferred.
          if (meta.promo_campaign_id && userId) {
            const discounted = session.total_details?.amount_discount ?? null;
            const { data: recorded } = await admin.rpc('record_promo_redemption', {
              p_campaign: meta.promo_campaign_id,
              p_user: userId,
              p_market: market,
              p_plan: plan,
              p_session: session.id,
              p_subscription: String(session.subscription ?? '') || null,
              p_customer: String(session.customer ?? '') || null,
              p_discount_cents: discounted,
            });
            await log(event.type, market, userId, planKey ?? null, discounted,
                      recorded === true
                        ? `promo_redeemed:${meta.promo_code ?? meta.promo_campaign_id}`
                        : 'promo_redemption:replay_ignored');
          }
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

        const { data: row } = await admin.from('market_subscriptions').select('market_id,plan,kind,user_id').eq('subscription_id', sub.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (!row) break;
        const periodStart = sub.items.data[0]?.current_period_start ? new Date(sub.items.data[0].current_period_start * 1000).toISOString() : null;
        const periodEnd = sub.items.data[0]?.current_period_end ? new Date(sub.items.data[0].current_period_end * 1000).toISOString() : null;
        await admin.from('market_subscriptions').update({
          user_id: row.user_id, billing_source: 'STRIPE', status: sub.status,
          environment: livemode ? 'PRODUCTION' : 'TEST', current_period_start: periodStart,
          current_period_end: periodEnd, expires_at: periodEnd, cancel_at_period_end: sub.cancel_at_period_end,
          last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString(), stripe_livemode: livemode,
        }).eq('subscription_id', sub.id);

        const addonKey = 'GNOME_PICKUP_LOCATION_ADDON';
        const carriesAddon = sub.items.data.some((i) => keyForPrice(i.price?.id) === addonKey);
        const addonQty2 = active && carriesAddon ? sub.items.data.find((i) => keyForPrice(i.price?.id) === addonKey)?.quantity ?? 0 : 0;

        if (row.kind === 'addon') {
          await admin.from('markets').update({ extra_pickup_locations: addonQty2 }).eq('id', row.market_id);
          await admin.rpc('reconcile_pickup_locations', { p_market: row.market_id });
          await log(event.type, row.market_id, null, addonKey, null, `addon:${addonQty2} (${sub.status})`);
          break;
        }

        // Recompute from every verified provider. A stale Stripe cancellation
        // cannot erase a surviving Apple, Google Play, or complimentary plan.
        await admin.rpc('reconcile_market_paid_plan', { p_market: row.market_id });
        if (carriesAddon || !active) await admin.from('markets').update({ extra_pickup_locations: active ? addonQty2 : 0 }).eq('id', row.market_id);
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
