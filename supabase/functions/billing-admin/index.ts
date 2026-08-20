// Gnome — billing QA/admin tool (owner-only). The actions that make the Stripe
// TEST-mode round-trip possible without ever touching the wrong account:
//
//   { action: "identity" }            read-only account confirmation. Reads
//     STRIPE_SECRET_KEY_TEST; if unset → { configured:false }. If set, calls
//     Stripe GET /v1/account and returns { account_id, business_name, livemode }
//     so the operator can CONFIRM it is Gnome (and NOT live) before anything is
//     created. The secret itself is never returned.
//   { action: "ensure_products" }     create/reuse the canonical TEST
//     products+prices (metadata gnome_product_key + environment=test) and
//     persist the test price ids into billing_products — updating ONLY the id
//     columns on existing rows (pricing stays the migrations' to own), and
//     inserting the full migration-seed shape for a key never seeded, so a
//     clean environment ends up configured instead of silently unchanged. Sets
//     a tax_code, which this account requires because Stripe Tax / managed
//     payments is enabled.
//   { action: "webhook_status" }      read-only: which signing secrets are
//     configured (booleans only, never values) and which endpoints exist.
//   { action: "ensure_webhook" }      create/update the TEST endpoint with the
//     exact URL + event set. The signing secret is neither stored nor returned;
//     secrets belong in Supabase project secrets, entered by the owner.
//   { action: "inspect_session" }     read-only: what a cs_test_ session bound.
//   { action: "cancel_subscription" } QA: cancel a TEST subscription.
//   { action: "refund_payment" }      QA: refund a TEST checkout payment.
//
// Every MUTATING action shares one guard: refuse unless the live-payments gate
// is OFF, the key's account is livemode:false, AND confirm_account_id matches
// the key's real account id — so nothing can ever run against a live or
// mismatched account. Live columns are never touched.
//
// This is billing infrastructure, not a user feature. Never exposes secrets.
import Stripe from 'npm:stripe';
import { createClient } from 'npm:@supabase/supabase-js@2';

// The catalogue ensure_products provisions in TEST. The paid-publishing keys
// matter most: GNOME_LISTING_PUBLISH and GNOME_LISTING_RENEWAL are the $0.99
// overages billing-checkout resolves every paid publish to. Since 0126,
// GNOME_FARM_MONTHLY is customer-facing Farm and GNOME_SPONSOR_MONTHLY is the
// retired Legacy Farm comp rung, so a clean TEST catalogue must keep sponsor
// inactive.
//
// kind/description/currency/active are carried here, not just the amount,
// because a key that has never been seeded (a partially-built environment) is
// INSERTED whole. They mirror the migration seeds verbatim (0083 §product keys,
// 0124 §4, 0126 §retirement — including the bundles' active=false) so a rebuilt
// environment and a migrated one describe the same SKU identically rather than
// drifting apart by one word. On rows that already EXIST these fields are never written: the
// migrations are the pricing authority, and this action's writes are limited to
// the per-environment Stripe test ids it exists to provision.
const CANON: {
  key: string;
  amount: number;
  kind: 'subscription' | 'one_time' | 'addon';
  description: string;
  active: boolean;
  recurring?: 'month' | 'year';
}[] = [
  { key: 'GNOME_GROWER_MONTHLY', amount: 999, kind: 'subscription', description: 'Grower plan, monthly', active: true, recurring: 'month' },
  { key: 'GNOME_FARM_MONTHLY', amount: 2999, kind: 'subscription', description: 'Farm plan, monthly', active: true, recurring: 'month' },
  // Retired by 0126 — customer-facing "Farm" is GNOME_FARM_MONTHLY at $29.99.
  // active:false here matters: this CATALOG's insert path is what a clean
  // environment gets, and a reseed must not resurrect a retired $99 SKU into
  // a live checkout allowlist (that exact resurrection was a review finding).
  { key: 'GNOME_SPONSOR_MONTHLY', amount: 9900, kind: 'subscription', description: 'Legacy Farm (retired 0126; internal comp rung only)', active: false, recurring: 'month' },
  { key: 'GNOME_PICKUP_LOCATION_ADDON', amount: 500, kind: 'addon', description: 'Extra pickup location, per unit monthly', active: true, recurring: 'month' },
  { key: 'GNOME_LISTING_PROMOTION', amount: 399, kind: 'one_time', description: 'Featured listing promotion, 7 days', active: true },
  { key: 'GNOME_LISTING_PUBLISH', amount: 99, kind: 'one_time', description: 'Publish one additional listing beyond the monthly allowance', active: true },
  { key: 'GNOME_LISTING_RENEWAL', amount: 99, kind: 'one_time', description: 'Renew one expired listing for a further 7 days', active: true },
  { key: 'GNOME_SEED_DROP_SEASONAL', amount: 2499, kind: 'subscription', description: 'Seasonal Seed Drop, per season', active: true, recurring: 'month' }, // Gnome enforces seasonal cadence
  { key: 'GNOME_GROWER_SEED_BUNDLE', amount: 19900, kind: 'subscription', description: 'Grower + Seed Drop bundle, annual', active: false, recurring: 'year' },
  { key: 'GNOME_FARM_SEED_BUNDLE', amount: 42900, kind: 'subscription', description: 'Farm + Seed Drop bundle, annual', active: false, recurring: 'year' },
];

Deno.serve(async (req: Request) => {
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return json(401, { error: 'UNAUTHENTICATED' });
    const { data: member } = await admin.from('admin_users').select('role,status').eq('user_id', uid).maybeSingle();
    if (!member || member.status !== 'active' || !['OWNER', 'SUPER_ADMIN'].includes(member.role)) return json(403, { error: 'OWNER_ONLY' });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? 'identity');
    const key = Deno.env.get('STRIPE_SECRET_KEY_TEST')?.trim();

    if (!key) return json(200, { configured: false, message: 'STRIPE_SECRET_KEY_TEST not set — owner config required.' });
    // A test key must start sk_test_ / rk_test_. Refuse anything that looks live.
    if (!/^(sk|rk)_test_/.test(key)) return json(400, { configured: true, error: 'NOT_A_TEST_KEY', message: 'STRIPE_SECRET_KEY_TEST is not a test-mode key.' });

    const stripe = new Stripe(key);
    const acct = await stripe.accounts.retrieve();
    const identity = {
      configured: true,
      account_id: acct.id,
      business_name: acct.business_profile?.name ?? acct.settings?.dashboard?.display_name ?? null,
      livemode: (acct as unknown as { livemode?: boolean }).livemode ?? false,
    };

    if (action === 'identity') return json(200, identity);

    // Shared gate for every MUTATING action: never on a live account, never
    // when live payments are enabled, and only when the operator has confirmed
    // THIS account id. Returns a Response to short-circuit, or null to proceed.
    const guard = async (): Promise<Response | null> => {
      const { data: cfg } = await admin.from('billing_config').select('payments_live_enabled').limit(1).maybeSingle();
      if (cfg?.payments_live_enabled === true) return json(409, { error: 'LIVE_GATE_ON', message: 'Refusing: live payments are enabled.' });
      if (identity.livemode) return json(409, { error: 'LIVE_ACCOUNT', message: 'Refusing: key resolves to a live account.' });
      if (String(body.confirm_account_id ?? '') !== acct.id) {
        return json(409, { error: 'ACCOUNT_UNCONFIRMED', message: 'Pass confirm_account_id equal to the identity account_id after verifying it is Gnome.', account_id: acct.id });
      }
      return null;
    };

    if (action === 'ensure_products') {
      const blocked = await guard();
      if (blocked) return blocked;

      // A valid Stripe tax_code is required when the account has Stripe Tax /
      // managed payments enabled. txcd_10000000 = "General - Electronically
      // Supplied Services" (fits the SaaS plans); the owner can refine per-
      // product tax codes before going live.
      const TAX_CODE = 'txcd_10000000';
      const results: Record<string, string> = {};
      // A failed DB write is reported, not swallowed. The bug this action had
      // was precisely a write that failed to say so.
      const dbErrors: Record<string, string> = {};
      // Rows whose DB amount contradicts CANON (and therefore the test price
      // just minted): reported, never rewritten. See the write comment below.
      const priceDrift: Record<string, string> = {};
      for (const p of CANON) {
        // Reuse: find an existing test product tagged with this key.
        let productId: string | null = null;
        try {
          const found = await stripe.products.search({ query: `metadata['gnome_product_key']:'${p.key}' AND active:'true'`, limit: 1 });
          productId = found.data[0]?.id ?? null;
        } catch { /* search index may lag; fall through to create */ }
        if (!productId) {
          const prod = await stripe.products.create({ name: `Gnome ${p.key}`, tax_code: TAX_CODE, metadata: { gnome_product_key: p.key, environment: 'test' } });
          productId = prod.id;
        } else {
          // Ensure an already-created product carries the tax code.
          try { await stripe.products.update(productId, { tax_code: TAX_CODE }); } catch { /* best-effort */ }
        }
        // Reuse a matching price; else create one.
        let priceId: string | null = null;
        const prices = await stripe.prices.list({ product: productId, active: true, limit: 20 });
        priceId = prices.data.find((pr) =>
          pr.unit_amount === p.amount &&
          ((p.recurring && pr.recurring?.interval === p.recurring) || (!p.recurring && !pr.recurring)))?.id ?? null;
        if (!priceId) {
          const price = await stripe.prices.create({
            product: productId, currency: 'usd', unit_amount: p.amount,
            ...(p.recurring ? { recurring: { interval: p.recurring } } : {}),
            metadata: { gnome_product_key: p.key, environment: 'test' },
          });
          priceId = price.id;
        }
        // Two-step, not a blanket UPSERT, because the two starting points call
        // for different writes. An EXISTING row gets ONLY the test Stripe ids —
        // pricing (kind/description/amount/currency) belongs to the migrations,
        // and a blanket upsert would silently revert any DB-side correction to
        // whatever this file said, making a QA tool a second pricing authority.
        // A MISSING key (a partially-built environment; the original defect was
        // `.update()` matching no row, recording nothing, and answering ok:true
        // while checkout returned UNKNOWN_PRODUCT) is inserted whole, in the
        // migration seed's exact shape — `active` included, so the bundles the
        // migrations ship INACTIVE cannot come back active via the default.
        //
        // If the existing row's amount disagrees with CANON, that is REPORTED
        // (price_drift below), never rewritten: the Stripe test price minted
        // above matches CANON, so a drifted row now points at a price whose
        // amount it contradicts — a fact the operator must resolve in a
        // migration, not something this action may paper over.
        //
        // The live columns are never touched — this action is TEST-only by every
        // guard above, and the service role is what carries the write privilege
        // 0124 revoked from anon/authenticated.
        const { data: updated, error: updErr } = await admin.from('billing_products')
          .update({ stripe_product_id_test: productId, stripe_price_id_test: priceId })
          .eq('key', p.key)
          .select('key,unit_amount_cents');
        if (updErr) { dbErrors[p.key] = updErr.message; continue; }
        if (!updated || updated.length === 0) {
          const { error: insErr } = await admin.from('billing_products').insert({
            key: p.key,
            kind: p.kind,
            description: p.description,
            unit_amount_cents: p.amount,
            currency: 'usd',
            active: p.active,
            stripe_product_id_test: productId,
            stripe_price_id_test: priceId,
          });
          if (insErr) { dbErrors[p.key] = insErr.message; continue; }
        } else if (updated[0].unit_amount_cents !== p.amount) {
          priceDrift[p.key] = `db=${updated[0].unit_amount_cents} canon=${p.amount}`;
        }
        results[p.key] = priceId;
      }
      // A failed DB write fails the RESPONSE, not just a field in it: every
      // programmatic caller (res.ok, supabase-js functions.invoke) reads the
      // status, and 200-with-errors is exactly the silent-success shape this
      // action was fixed to stop producing. Keys whose write failed are absent
      // from `configured` — a price id the DB does not carry is not configured.
      const failed = Object.keys(dbErrors).length > 0;
      return json(failed ? 500 : 200, {
        ok: !failed,
        account_id: acct.id,
        configured: results,
        ...(Object.keys(priceDrift).length ? { price_drift: priceDrift } : {}),
        ...(failed ? { db_errors: dbErrors } : {}),
      });
    }

    if (action === 'webhook_status') {
      // READ-ONLY diagnosis of the webhook leg. Reports which signing secrets
      // are CONFIGURED (booleans only — never the values) and which Stripe test
      // endpoints exist for this project. Creates and changes nothing.
      const wbase = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
      const expectedUrl = `${wbase}/functions/v1/stripe-webhook`;
      const list = await stripe.webhookEndpoints.list({ limit: 100 });
      return json(200, {
        ok: true,
        account_id: acct.id,
        expected_url: expectedUrl,
        signing_secrets_configured: {
          test: !!Deno.env.get('STRIPE_WEBHOOK_SECRET_TEST')?.trim(),
          live: !!Deno.env.get('STRIPE_WEBHOOK_SECRET_LIVE')?.trim(),
          legacy: !!(Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? Deno.env.get('Stripe_Webhook_Secret'))?.trim(),
        },
        endpoints: list.data.map((e) => ({
          id: e.id, url: e.url, status: e.status,
          matches_expected: e.url === expectedUrl,
          enabled_events: e.enabled_events,
        })),
      });
    }

    if (action === 'ensure_webhook') {
      const blocked = await guard();
      if (blocked) return blocked;

      // Create the TEST endpoint with exactly the right URL and event set, so
      // the owner's only remaining step is copying the signing secret from the
      // Stripe dashboard into the STRIPE_WEBHOOK_SECRET_TEST project secret.
      // The generated secret is deliberately NOT stored and NOT returned here —
      // secrets belong in Supabase project secrets, entered by the owner.
      const wbase = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
      const url = `${wbase}/functions/v1/stripe-webhook`;
      const enabled_events = [
        'checkout.session.completed', 'customer.subscription.updated',
        'customer.subscription.deleted', 'invoice.paid',
        'invoice.payment_failed', 'charge.refunded',
      ];
      const list = await stripe.webhookEndpoints.list({ limit: 100 });
      const existing = list.data.find((e) => e.url === url) ?? null;
      if (existing) {
        await stripe.webhookEndpoints.update(existing.id, { enabled_events, disabled: false });
        return json(200, { ok: true, endpoint_id: existing.id, created: false, url, enabled_events, reveal_secret_at: `https://dashboard.stripe.com/test/webhooks/${existing.id}` });
      }
      const ep = await stripe.webhookEndpoints.create({ url, enabled_events, description: 'Gnome (test) — Supabase stripe-webhook', metadata: { gnome: 'true', environment: 'test' } });
      return json(200, { ok: true, endpoint_id: ep.id, created: true, url, enabled_events, reveal_secret_at: `https://dashboard.stripe.com/test/webhooks/${ep.id}` });
    }

    if (action === 'inspect_session') {
      // READ-ONLY. Proves what billing-checkout actually bound into a session:
      // amount, mode, and the server-authored ownership metadata the webhook
      // re-validates. No card data exists here and no secret is returned.
      const id = String(body.session_id ?? '');
      if (!/^cs_test_/.test(id)) return json(400, { error: 'TEST_SESSIONS_ONLY' });
      const s = await stripe.checkout.sessions.retrieve(id, { expand: ['line_items'] });
      return json(200, {
        ok: true, id: s.id, mode: s.mode, livemode: s.livemode,
        status: s.status, payment_status: s.payment_status,
        subscription: typeof s.subscription === 'string' ? s.subscription : s.subscription?.id ?? null,
        customer: typeof s.customer === 'string' ? s.customer : s.customer?.id ?? null,
        amount_total: s.amount_total, currency: s.currency,
        client_reference_id: s.client_reference_id, metadata: s.metadata,
        line_items: (s.line_items?.data ?? []).map((li) => ({ price: li.price?.id, quantity: li.quantity, amount: li.amount_total })),
      });
    }

    if (action === 'cancel_subscription') {
      // QA only: cancel a TEST subscription so the real
      // customer.subscription.deleted branch can be exercised end-to-end.
      const blocked = await guard();
      if (blocked) return blocked;
      const subId = String(body.subscription_id ?? '');
      if (!/^sub_/.test(subId)) return json(400, { error: 'BAD_SUBSCRIPTION_ID' });
      const sub = await stripe.subscriptions.retrieve(subId);
      if (sub.livemode) return json(409, { error: 'LIVE_OBJECT', message: 'Refusing: not a test subscription.' });
      const cancelled = await stripe.subscriptions.cancel(subId);
      return json(200, { ok: true, id: cancelled.id, status: cancelled.status, livemode: cancelled.livemode });
    }

    if (action === 'refund_payment') {
      // QA only: refund a TEST checkout payment so the real charge.refunded
      // branch (promotion-credit clawback) can be exercised end-to-end.
      const blocked = await guard();
      if (blocked) return blocked;
      const id = String(body.session_id ?? '');
      if (!/^cs_test_/.test(id)) return json(400, { error: 'TEST_SESSIONS_ONLY' });
      const s = await stripe.checkout.sessions.retrieve(id);
      if (s.livemode) return json(409, { error: 'LIVE_OBJECT' });
      const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
      if (!pi) return json(400, { error: 'NO_PAYMENT_INTENT', message: 'Session has no payment_intent (subscription invoices refund via the charge).' });
      // Tag the refund with the originating session so the webhook can find the
      // credit to claw back (it reads metadata.checkout_session).
      const refund = await stripe.refunds.create({ payment_intent: pi, metadata: { checkout_session: s.id } });
      return json(200, { ok: true, refund_id: refund.id, status: refund.status, amount: refund.amount, livemode: refund.livemode });
    }

    return json(400, { error: 'UNKNOWN_ACTION' });
  } catch (e) {
    console.error('billing-admin:', e);
    return json(500, { error: 'BILLING_ADMIN_FAILED', detail: String(e).slice(0, 200) });
  }
});
