// Gnome — billing QA/admin tool (owner-only). Two safe actions that make the
// Stripe TEST-mode round-trip possible without ever touching the wrong account:
//
//   { action: "identity" }
//     Reads STRIPE_SECRET_KEY_TEST. If unset → { configured:false }. If set →
//     calls Stripe GET /v1/account (read-only) and returns { account_id,
//     business_name, livemode } so the operator can CONFIRM it is the Gnome
//     account (and NOT live) before anything is created. No secret is returned.
//
//   { action: "ensure_products", confirm_account_id: "acct_..." }
//     Creates or REUSES the seven canonical TEST products/prices (metadata
//     gnome_product_key + environment=test) and persists the returned TEST
//     price ids into billing_products.stripe_*_test. HARD GUARDS: refuses
//     unless the live-payments gate is OFF, the key's account livemode is
//     false (a test key), AND confirm_account_id matches the key's real
//     account id — so it can never run against a mismatched/live account.
//     Live columns are never touched.
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

    if (action === 'ensure_products') {
      // Gate: never on a live account, never when live payments are enabled,
      // and only when the operator has confirmed THIS account id.
      const { data: cfg } = await admin.from('billing_config').select('payments_live_enabled').limit(1).maybeSingle();
      if (cfg?.payments_live_enabled === true) return json(409, { error: 'LIVE_GATE_ON', message: 'Refusing: live payments are enabled.' });
      if (identity.livemode) return json(409, { error: 'LIVE_ACCOUNT', message: 'Refusing: key resolves to a live account.' });
      if (String(body.confirm_account_id ?? '') !== acct.id) {
        return json(409, { error: 'ACCOUNT_UNCONFIRMED', message: 'Pass confirm_account_id equal to the identity account_id after verifying it is Gnome.', account_id: acct.id });
      }

      const results: Record<string, string> = {};
      for (const p of CANON) {
        // Reuse: find an existing test product tagged with this key.
        let productId: string | null = null;
        try {
          const found = await stripe.products.search({ query: `metadata['gnome_product_key']:'${p.key}' AND active:'true'`, limit: 1 });
          productId = found.data[0]?.id ?? null;
        } catch { /* search index may lag; fall through to create */ }
        if (!productId) {
          const prod = await stripe.products.create({ name: `Gnome ${p.key}`, metadata: { gnome_product_key: p.key, environment: 'test' } });
          productId = prod.id;
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

    return json(400, { error: 'UNKNOWN_ACTION' });
  } catch (e) {
    console.error('billing-admin:', e);
    return json(500, { error: 'BILLING_ADMIN_FAILED', detail: String(e).slice(0, 200) });
  }
});
