// Gnome — server-side Stripe Checkout Session creator (replaces generic
// Payment Links). SECURITY: the caller's identity comes from the JWT; the
// Market/listing is resolved from the DB as OWNED BY that user.
// A client can never say "credit this to Market B" — ownership is bound
// server-side into session metadata that the webhook re-validates (Parts 5,21).
//
// MODE + LIVE GATE (Part 29): mode follows billing_config. Test mode uses
// STRIPE_SECRET_KEY_TEST; live mode uses STRIPE_SECRET_KEY_LIVE and is only
// reachable when the owner has flipped payments_live_enabled=true. Default is
// TEST — Gnome will not create a live session otherwise, even with a live key.
//
// SEED DROP IS OFF. The Seed Drop ships as an announcement only — no price, no
// date, no purchase. Every seed key is refused here before anything is read
// from billing_products and long before Stripe is called, so an active product
// row, a configured test price, or a hand-rolled request cannot reach checkout.
// Mirrors supabase/functions/_shared/seed_drop_gate.ts; that file explains why
// this copy is inline, and the regression suite fails if the two disagree.
//
// PROMOTIONS: Stripe is the discount MECHANIC; Gnome decides ELIGIBILITY.
// Stripe cannot express "this coupon is only for the Pro plan" — verified
// against the account, a coupon created with applies_to[products][0] comes back
// with applies_to absent and stays absent on retrieve. FOUNDING3 is therefore an
// unrestricted 100%-off coupon at the Stripe layer, so every eligibility rule is
// enforced here via promo_validate() before a session exists, and sessions are
// created with allow_promotion_codes:false so a customer cannot type a code into
// Stripe's own UI and route around that check.
//
// $0.99 OVERAGES: the client does NOT choose publish vs renewal and does not
// choose the price. It asks to pay for a listing action; the server decides
// which action that is from the listing's own history, refuses outright if the
// seller still has free allowance, and picks the canonical price itself.
//
// Secrets (server-side only; never shipped to any client):
//   STRIPE_SECRET_KEY_TEST   sk_test_...
//   STRIPE_SECRET_KEY_LIVE   sk_live_...   (unused until the owner enables live)
//   GNOME_PUBLIC_URL         https://gnomefarmersmarket.com  (return/cancel base)
import Stripe from 'npm:stripe';
import { createClient } from 'npm:@supabase/supabase-js@2';

type Body = {
  product_key: string;
  listing_id?: string; // GNOME_LISTING_PROMOTION, and the overage keys
  quantity?: number;   // GNOME_PICKUP_LOCATION_ADDON
  promo_code?: string; // subscription keys only
  // 'app' asks for the mobile deep-link return pair instead of the web URLs. The VALUES are
  // server constants either way — the client chooses between two fixed pairs and can never
  // supply a URL of its own, so checkout cannot be pointed anywhere Gnome does not control.
  platform?: 'app' | 'web';
};

// Deny-by-default. Only these keys may reach Stripe; anything else is refused
// whatever billing_products says, so a renamed or newly added seed key opens
// nothing by accident.
const CHECKOUT_ALLOWED_KEYS = new Set([
  'GNOME_GROWER_MONTHLY', 'GNOME_FARM_MONTHLY', 'GNOME_SPONSOR_MONTHLY',
  'GNOME_LISTING_PROMOTION', 'GNOME_PICKUP_LOCATION_ADDON',
  'GNOME_LISTING_PUBLISH', 'GNOME_LISTING_RENEWAL',
]);

const SUBSCRIPTION_KEYS = new Set([
  'GNOME_GROWER_MONTHLY', 'GNOME_FARM_MONTHLY', 'GNOME_SPONSOR_MONTHLY',
  'GNOME_PICKUP_LOCATION_ADDON',
]);

// The two $0.99 keys are interchangeable on the way IN: whichever the client
// sends, the server re-derives the real one. Listed together so the request can
// be recognised as an overage before that resolution happens.
const OVERAGE_KEYS = new Set(['GNOME_LISTING_PUBLISH', 'GNOME_LISTING_RENEWAL']);

// Plan a subscription key grants, as the INTERNAL enum. Customer-facing names
// differ and must never be used for this: 'farm' is customer-facing "Max" and
// 'sponsor' is customer-facing "Farm".
const PLAN_FOR_KEY: Record<string, string> = {
  GNOME_GROWER_MONTHLY: 'grower',   // Pro
  GNOME_FARM_MONTHLY: 'farm',       // Max
  GNOME_SPONSOR_MONTHLY: 'sponsor', // Farm
};

const SEED_DROP_KEYS = new Set([
  'GNOME_SEED_DROP_SEASONAL', 'GNOME_SEED_DROP_ONE_TIME', 'GNOME_SEED_DROP_SUBSCRIPTION',
  'GNOME_GROWER_SEED_BUNDLE', 'GNOME_FARM_SEED_BUNDLE',
]);

// Flip to false only together with: 0089 applied, a live price configured, and
// the state/supplier clearances the compliance memos require.
const SEED_DROP_COMING_SOON = true;
const SEED_DROP_COMING_SOON_MESSAGE =
  'The Gnome Seed Drop is Coming Soon. It cannot be purchased yet — no price, no date, no checkout. Nothing has been charged.';

// Matched on the upper-cased key and on a SEED substring, so casing, padding,
// and any future GNOME_*_SEED_* key land on the explicit refusal rather than a
// generic error. Deny-by-default catches whatever this misses.
const isSeedDropKey = (key: string) =>
  SEED_DROP_KEYS.has(key) || key.includes('SEED');

// Customer-facing sentences for each promo_validate reason. The reasons
// themselves stay coarse on purpose — a missing code and an inactive code both
// answer INVALID_CODE so that comparing responses cannot enumerate which
// campaigns exist.
const PROMO_MESSAGE: Record<string, string> = {
  INVALID_CODE: 'That code isn’t valid.',
  NOT_STARTED: 'That code isn’t active yet.',
  EXPIRED: 'That code has expired.',
  WRONG_PLAN: 'That code doesn’t apply to this plan.',
  FULLY_REDEEMED: 'That code has been fully claimed.',
  ALREADY_REDEEMED: 'You’ve already used that code.',
  NOT_NEW_CUSTOMER: 'That code is for new subscribers only.',
  NOT_CONFIGURED: 'That code isn’t ready to use yet.',
  NO_CODE: 'Enter a code first.',
};

// Browser callers (web plan/boost purchases, the Ask Gnome $0.99 renewal leg) are
// cross-origin, so the preflight must be answered and every response must carry the
// header — same posture as ask-gnome/gnome-assistant. Mobile invokes are unaffected.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    if (!uid) return json(401, { error: 'UNAUTHENTICATED' });

    // Normalize before deciding anything: String() collapses arrays/objects to
    // something the checks can reason about, and the case/padding fold means a
    // request cannot dodge the gate by reshaping the key.
    const body = (await req.json().catch(() => ({}))) as Body;
    let key = String(body.product_key ?? '').trim().toUpperCase();

    if (SEED_DROP_COMING_SOON && isSeedDropKey(key)) {
      return json(403, { error: 'SEED_DROP_COMING_SOON', message: SEED_DROP_COMING_SOON_MESSAGE, product_key: key });
    }
    if (!CHECKOUT_ALLOWED_KEYS.has(key)) return json(400, { error: 'UNKNOWN_PRODUCT' });

    // The caller's OWN market (owner_id = uid). Never a client-supplied id.
    const { data: market } = await admin.from('markets').select('id,owner_id').eq('owner_id', uid).limit(1).maybeSingle();

    // ---- $0.99 overage: the server decides what is being bought -----------
    // Done BEFORE the product is read, because the key the client sent is not
    // the key that will be charged. Sending GNOME_LISTING_RENEWAL for a listing
    // that has never been published resolves to a publish, at the publish price.
    let overageIntent: string | null = null;
    let overageListing: string | null = null;
    if (OVERAGE_KEYS.has(key)) {
      if (!market) return json(403, { error: 'NO_MARKET', message: 'Post once to create your Market first.' });
      overageListing = body.listing_id ? String(body.listing_id) : null;

      if (overageListing) {
        // A renewal names a listing, and it must be the caller's own.
        const { data: l } = await admin.from('listings').select('id,owner_id,market_id')
          .eq('id', overageListing).maybeSingle();
        if (!l || l.owner_id !== uid) return json(403, { error: 'NOT_YOUR_LISTING' });
      }

      const { data: need } = await admin.rpc('listing_overage_required', {
        p_market: market.id, p_listing: overageListing,
      });
      const row = Array.isArray(need) ? need[0] : need;
      if (!row) return json(500, { error: 'ALLOWANCE_UNRESOLVED' });

      // Refusing to take money the seller does not owe is the point of this
      // check, not a side effect. ALREADY_AUTHORIZED means they paid and have
      // not spent it — send them back to publishing rather than charging twice.
      if (row.required !== true) {
        return json(409, {
          error: 'NO_PAYMENT_REQUIRED',
          reason: row.reason,
          intent: row.intent,
          message: row.reason === 'ALREADY_AUTHORIZED'
            ? 'You’ve already paid for this — go ahead and publish.'
            : 'You still have listings included this period.',
        });
      }
      key = String(row.product_key);        // server's choice, not the client's
      overageIntent = String(row.intent);
    }

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

    const base = (Deno.env.get('GNOME_PUBLIC_URL') ?? 'https://gnomefarmersmarket.com').replace(/\/$/, '');
    const meta: Record<string, string> = { gnome_user_id: uid, product_key: key, mode };
    let clientRef = '';
    const checkoutMode: 'subscription' | 'payment' = SUBSCRIPTION_KEYS.has(key) ? 'subscription' : 'payment';
    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = { price: priceId, quantity: 1 };
    const discounts: Stripe.Checkout.SessionCreateParams.Discount[] = [];

    if (key === 'GNOME_LISTING_PROMOTION') {
      const listingId = String(body.listing_id ?? '');
      const { data: listing } = await admin.from('listings').select('id,market_id,owner_id').eq('id', listingId).maybeSingle();
      if (!listing || listing.owner_id !== uid) return json(403, { error: 'NOT_YOUR_LISTING' });
      meta.listing_id = listing.id; meta.market_id = listing.market_id;
      clientRef = `promo_${listing.id}`;
    } else if (overageIntent) {
      meta.market_id = market!.id;
      meta.overage_intent = overageIntent;
      if (overageListing) meta.listing_id = overageListing;
      clientRef = `overage_${market!.id}`;
    } else {
      // plan / addon — must own a Market.
      if (!market) return json(403, { error: 'NO_MARKET', message: 'Post once to create your Market first.' });
      meta.market_id = market.id;
      clientRef = market.id;
      if (key === 'GNOME_PICKUP_LOCATION_ADDON') {
        lineItem.quantity = Math.max(1, Math.min(20, Number(body.quantity ?? 1)));
      }
    }

    // ---- promo codes: eligibility decided here, never by Stripe ------------
    const rawPromo = String(body.promo_code ?? '').trim();
    if (rawPromo) {
      const plan = PLAN_FOR_KEY[key];
      // Only plan subscriptions carry campaigns. Refusing here rather than
      // silently ignoring the code means a seller never believes a discount was
      // applied to a $0.99 publish or a pickup add-on when it was not.
      if (!plan) {
        return json(400, { error: 'PROMO_NOT_APPLICABLE', message: 'That code doesn’t apply to this purchase.' });
      }
      const { data: v } = await admin.rpc('promo_validate', {
        p_code: rawPromo, p_plan: plan, p_user: uid,
      });
      const res = Array.isArray(v) ? v[0] : v;
      if (!res || res.ok !== true) {
        const reason = String(res?.reason ?? 'INVALID_CODE');
        return json(400, {
          error: 'PROMO_REJECTED', reason,
          message: PROMO_MESSAGE[reason] ?? PROMO_MESSAGE.INVALID_CODE,
        });
      }
      // Exactly one discount, chosen by the server. Stripe rejects `discounts`
      // together with allow_promotion_codes, which is a second reason stacking
      // cannot happen even if a future edit tries to allow both.
      discounts.push({ promotion_code: String(res.stripe_promotion_code_id) });
      meta.promo_campaign_id = String(res.campaign_id);
      meta.promo_code = String(rawPromo).toUpperCase();
    }

    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.create({
      mode: checkoutMode,
      line_items: [lineItem],
      client_reference_id: clientRef,
      metadata: meta,                    // server-authored ownership binding
      // Subscription metadata is copied onto the subscription itself so the
      // webhook can still attribute a redemption on later invoice events, when
      // the original session is long gone.
      ...(checkoutMode === 'subscription' ? { subscription_data: { metadata: meta } } : {}),
      // /account does not exist and never has — a customer who paid landed on a
      // 404 the instant the charge went through. /my is the seller dashboard and
      // the only page where the thing they just bought becomes visible.
      ...(body.platform === 'app'
        ? {
            // The Expo client opens checkout in an auth session that closes on this scheme.
            // Return is a SIGNAL, never proof: the app reconciles by re-asking the server
            // whether payment is still owed before publishing anything.
            success_url: 'gnome://checkout-success',
            cancel_url: 'gnome://checkout-cancelled',
          }
        : {
            success_url: `${base}/my?checkout=success`,
            cancel_url: `${base}/my?checkout=cancelled`,
          }),
      // Stripe refuses allow_promotion_codes and discounts in the same request —
      // verified against the API, and it refuses even when the flag is FALSE:
      //   "You may only specify one of these parameters: allow_promotion_codes, discounts."
      // So the flag is sent only when there is no server-chosen discount. That
      // is safe rather than a compromise: allow_promotion_codes DEFAULTS to
      // false, so omitting it still leaves the customer unable to type a code
      // into Stripe's own UI — which they must not be able to do, because
      // FOUNDING3 is unrestricted at the Stripe layer and typing it against Max
      // or Farm would hand those out free.
      ...(discounts.length ? { discounts } : { allow_promotion_codes: false }),
      // A $0.99 payment must expire rather than linger: an abandoned session
      // that could be completed days later would authorize a publish long after
      // the seller's allowance had already reset.
      ...(checkoutMode === 'payment'
        ? { expires_at: Math.floor(Date.now() / 1000) + 30 * 60 }
        : {}),
    });

    // The pending authorization is written BEFORE the customer pays, keyed on
    // the session. That is what makes a delayed webhook safe — confirmation
    // updates a row that already exists instead of racing an insert against a
    // retry. A pending row authorizes nothing on its own.
    if (overageIntent) {
      await admin.rpc('create_publish_authorization', {
        p_market: market!.id,
        p_intent: overageIntent,
        p_listing: overageListing,
        p_session: session.id,
        p_amount_cents: product.unit_amount_cents ?? 99,
      });
    }

    return json(200, { url: session.url, mode, product_key: key, intent: overageIntent });
  } catch (e) {
    console.error('billing-checkout:', e);
    return json(500, { error: 'CHECKOUT_FAILED', detail: String(e).slice(0, 200) });
  }
});
