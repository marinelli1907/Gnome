// Gnome — billing QA/admin tool (owner-only). The actions that make the Stripe
// TEST-mode round-trip possible without ever touching the wrong account:
//
//   { action: "identity" }            read-only account confirmation. Reads
//     STRIPE_SECRET_KEY_TEST; if unset → { configured:false }. If set, calls
//     Stripe GET /v1/account and returns { account_id, business_name, livemode }
//     so the operator can CONFIRM it is Gnome (and NOT live) before anything is
//     created. The secret itself is never returned.
//   { action: "ensure_products" }     create/reuse the 7 canonical TEST
//     products+prices (metadata gnome_product_key + environment=test) and
//     persist the test price ids into billing_products. Sets a tax_code, which
//     this account requires because Stripe Tax / managed payments is enabled.
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

const CANON: { key: string; amount: number; recurring?: 'month' | 'year' }[] = [
  { key: 'GNOME_GROWER_MONTHLY', amount: 999, recurring: 'month' },
  { key: 'GNOME_FARM_MONTHLY', amount: 2999, recurring: 'month' },
  { key: 'GNOME_PICKUP_LOCATION_ADDON', amount: 500, recurring: 'month' },
  { key: 'GNOME_LISTING_PROMOTION', amount: 399 }, // one-time
  { key: 'GNOME_SEED_DROP_SEASONAL', amount: 2499, recurring: 'month' }, // Gnome enforces seasonal cadence
  { key: 'GNOME_GROWER_SEED_BUNDLE', amount: 19900, recurring: 'year' },
  { key: 'GNOME_FARM_SEED_BUNDLE', amount: 42900, recurring: 'year' },
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
        await admin.from('billing_products').update({ stripe_product_id_test: productId, stripe_price_id_test: priceId }).eq('key', p.key);
        results[p.key] = priceId;
      }
      return json(200, { ok: true, account_id: acct.id, configured: results });
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
