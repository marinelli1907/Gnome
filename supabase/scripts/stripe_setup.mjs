#!/usr/bin/env node
//
// Idempotent Stripe setup for the listing-allowance monetization model.
//
//   STRIPE_SECRET_KEY=sk_test_... node supabase/scripts/stripe_setup.mjs
//   STRIPE_SECRET_KEY=sk_test_... node supabase/scripts/stripe_setup.mjs --apply
//
// Without --apply it only inspects and reports what it WOULD do. Nothing is created.
//
// The secret is read from the environment and never printed, never logged, and never accepted as a
// command-line argument — argv lands in shell history and in `ps` output for every other user on
// the machine. Only the key's mode (test/live) and last 4 characters are ever displayed.
//
// SAFE TO RERUN. Every object is looked up before it is created:
//   prices    by lookup_key, which Stripe guarantees unique per account
//   products  resolved from a found price, never searched by name
//   coupon    by its deterministic id FOUNDING3
//   promo     by listing promotion_codes with code=FOUNDING3
// A second run reports "reuse" for everything and creates nothing.
//
// The price lookup_key is the idempotency anchor rather than the Search API, which is eventually
// consistent — searching straight after a create can miss the object and produce the duplicate this
// script exists to avoid.

// Overridable so the flow can be exercised against a local stub in tests. Defaults to the real API;
// nothing in normal use should set it.
const API = process.env.STRIPE_API_BASE ?? 'https://api.stripe.com/v1';
const KEY = process.env.STRIPE_SECRET_KEY ?? '';
const APPLY = process.argv.includes('--apply');
const ALLOW_LIVE = process.env.ALLOW_LIVE === '1';

if (!KEY) {
  console.error('STRIPE_SECRET_KEY is not set.\n' +
    'Export it in your shell (it is in the Supabase edge-function secrets as\n' +
    'STRIPE_SECRET_KEY_TEST) and re-run. Do not pass it as an argument.');
  process.exit(2);
}
const LIVE = KEY.startsWith('sk_live') || KEY.startsWith('rk_live');
if (LIVE && !ALLOW_LIVE) {
  console.error('Refusing to run against a LIVE key.\n' +
    'This creates products, prices and a 100%-off coupon. Do it in test mode first,\n' +
    'verify a real checkout, and only then re-run with ALLOW_LIVE=1 if you truly intend to.');
  process.exit(2);
}

// The Grower product the FOUNDING3 coupon is restricted to. Verified present in
// billing_products.stripe_product_id_test for GNOME_GROWER_MONTHLY.
const GROWER_PRODUCT = process.env.GROWER_PRODUCT_ID ?? 'prod_V3cXpuwyxPKCdi';

// ---------------------------------------------------------------------------
// Stripe form encoding: nested keys become metadata[x] and applies_to[products][0].
// ---------------------------------------------------------------------------
function encode(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') parts.push(encode(item, `${key}[${i}]`));
        else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`);
      });
    } else if (typeof v === 'object') {
      parts.push(encode(v, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

async function stripe(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20',
    },
    body: body ? encode(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error ?? {};
    // 404 on a GET is a legitimate "not found" for the callers below.
    if (res.status === 404 && method === 'GET') return null;
    throw new Error(`${res.status} ${err.type ?? ''} ${err.message ?? JSON.stringify(json)}`);
  }
  return json;
}

const log = [];
function note(action, kind, name, id, detail = '') {
  log.push({ action, kind, name, id, detail });
  const mark = action === 'reuse' ? '=' : action === 'create' ? '+' : action === 'would' ? '?' : '!';
  console.log(`  ${mark} ${kind.padEnd(14)} ${name.padEnd(30)} ${id ?? ''} ${detail}`);
}

// ---------------------------------------------------------------------------
// A price identified by lookup_key, creating its product only when absent.
// ---------------------------------------------------------------------------
// reuseProductId attaches this price to an existing product instead of creating another. Without it
// two prices that are meant to share a product each create their own, and a fresh account ends up
// with two identically-named "Gnome Listing Credit" products — which looks fine in the dashboard and
// splits the reporting this arrangement exists to keep together.
async function ensurePrice({ lookupKey, productName, gnomeKey, unitAmount, recurring, description, reuseProductId }) {
  const found = await stripe('GET', `/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&limit=1&expand[]=data.product`);
  const existing = found?.data?.[0];

  if (existing) {
    const prod = existing.product;
    const prodId = typeof prod === 'string' ? prod : prod.id;
    if (existing.unit_amount !== unitAmount) {
      note('WARN', 'price', lookupKey, existing.id,
        `EXISTS AT ${existing.unit_amount} NOT ${unitAmount} — left alone; Stripe prices are immutable, create a new lookup_key`);
    } else {
      note('reuse', 'price', lookupKey, existing.id, `${prodId} ${unitAmount}`);
    }
    return { priceId: existing.id, productId: prodId, created: false };
  }

  if (!APPLY) {
    note('would', 'price', lookupKey, null, `create ${unitAmount} + product "${productName}"`);
    return { priceId: null, productId: null, created: false };
  }

  let product;
  if (reuseProductId) {
    product = { id: reuseProductId };
    note('reuse', 'product', productName, product.id, 'shared with the sibling price');
  } else {
    product = await stripe('POST', '/products', {
      name: productName,
      description,
      // REQUIRED, not cosmetic. Managed Payments is enabled by default on this account, and it
      // refuses any checkout line item whose product has no tax code:
      //   "the product tax code is missing ... required for Managed Payments"
      // A product created without one looks fine in the dashboard and then fails at the moment a
      // customer tries to pay. txcd_10000000 (General - Electronically Supplied Services) matches
      // what the existing Gnome products already use.
      tax_code: 'txcd_10000000',
      metadata: { gnome_key: gnomeKey, managed_by: 'stripe_setup.mjs' },
    });
    note('create', 'product', productName, product.id);
  }

  const price = await stripe('POST', '/prices', {
    product: product.id,
    unit_amount: unitAmount,
    currency: 'usd',
    lookup_key: lookupKey,
    ...(recurring ? { recurring: { interval: recurring } } : {}),
    metadata: { gnome_key: gnomeKey },
  });
  note('create', 'price', lookupKey, price.id, `${product.id} ${unitAmount}`);
  return { priceId: price.id, productId: product.id, created: true };
}

// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nStripe setup — mode ${LIVE ? 'LIVE' : 'TEST'}, key ****${KEY.slice(-4)}, ` +
              `${APPLY ? 'APPLYING' : 'DRY RUN (pass --apply to create)'}\n`);

  // The coupon restriction target must exist, or FOUNDING3 would silently apply to every plan.
  const grower = await stripe('GET', `/products/${GROWER_PRODUCT}`);
  if (!grower) {
    console.error(`\nGrower product ${GROWER_PRODUCT} not found on this account.\n` +
      'FOUNDING3 must be restricted to it; without the restriction a 100%-off coupon would apply\n' +
      'to Farm and retired Legacy Farm too. If you are on a different Stripe account, set GROWER_PRODUCT_ID.');
    process.exit(1);
  }
  note('reuse', 'product', 'Grower/Pro (restrict)', grower.id, grower.name);

  console.log('\n$0.99 listing credits');
  // Two prices under ONE product. The customer always pays $0.99; the split exists so Stripe's own
  // reporting separates new-publish revenue from renewal revenue, which the analytics spec asks for
  // by name. Our own ledger records intent as well, but reconciling against Stripe is easier when
  // the two do not have to be disentangled from metadata.
  const publish = await ensurePrice({
    lookupKey: 'gnome_listing_publish',
    productName: 'Gnome Listing Credit',
    gnomeKey: 'GNOME_LISTING_PUBLISH',
    unitAmount: 99,
    description: 'Publish one additional listing beyond the monthly included allowance.',
  });
  const renewal = await ensurePrice({
    lookupKey: 'gnome_listing_renewal',
    productName: 'Gnome Listing Credit',
    gnomeKey: 'GNOME_LISTING_RENEWAL',
    unitAmount: 99,
    description: 'Renew one expired listing for a further 7 days.',
    // Share the product the publish price just resolved to, whether that was found or created.
    reuseProductId: publish.productId,
  });

  console.log('\nSubscriptions');
  console.log('  = owned by migrations/billing-admin: GNOME_FARM_MONTHLY is Farm; GNOME_SPONSOR_MONTHLY is retired Legacy Farm');

  console.log('\nFOUNDING3');
  //
  // PLAN RESTRICTION IS NOT ENFORCED BY STRIPE. Verified 2026-08-16 against this account: creating a
  // coupon with applies_to[products][0] returns 200 with applies_to absent from the response, and it
  // is still absent on retrieve. Not an encoding fault — a raw curl behaves identically. Stripe
  // accepts the parameter and silently drops it.
  //
  // So FOUNDING3 is an UNRESTRICTED 100%-off coupon at the Stripe layer. Anything that lets a
  // customer attach it to a checkout session attaches it to ANY plan, including the sellable Farm
  // tier or the retired Legacy Farm rung.
  //
  // Eligibility therefore has to be Gnome's job, enforced server-side in billing-checkout against
  // promotion_campaigns.applicable_plan before the code is ever passed to Stripe. That is where the
  // spec wanted it regardless — Gnome holds the campaign metadata for eligibility, reporting and
  // abuse prevention; Stripe only supplies the discount mechanics.
  //
  // Do not "fix" this by re-adding applies_to. It will appear to work and will not.
  let coupon = await stripe('GET', '/coupons/FOUNDING3');
  if (coupon) {
    const okPct = coupon.percent_off === 100;
    const okDur = coupon.duration === 'repeating' && coupon.duration_in_months === 3;
    note(okPct && okDur ? 'reuse' : 'WARN', 'coupon', 'FOUNDING3', coupon.id,
      `${coupon.percent_off}% ${coupon.duration}/${coupon.duration_in_months}mo` +
      (okPct && okDur ? ' — plan eligibility enforced server-side, not here' : ' UNEXPECTED SHAPE'));
  } else if (APPLY) {
    coupon = await stripe('POST', '/coupons', {
      id: 'FOUNDING3',
      percent_off: 100,
      duration: 'repeating',
      duration_in_months: 3,
      name: 'Founding Seller — 3 months free',
      metadata: {
        gnome_campaign: 'FOUNDING3',
        gnome_applicable_plan: 'grower',
        managed_by: 'stripe_setup.mjs',
      },
    });
    note('create', 'coupon', 'FOUNDING3', coupon.id, '100% repeating/3mo');
  } else {
    note('would', 'coupon', 'FOUNDING3', null, '100% off, repeating 3 months');
  }

  const promos = await stripe('GET', '/promotion_codes?code=FOUNDING3&limit=1');
  const promo = promos?.data?.[0];
  if (promo) {
    note('reuse', 'promotion_code', 'FOUNDING3', promo.id,
      `active=${promo.active} redeemed=${promo.times_redeemed}`);
  } else if (APPLY && coupon) {
    const created = await stripe('POST', '/promotion_codes', {
      coupon: 'FOUNDING3',
      code: 'FOUNDING3',
      active: true,
      metadata: { gnome_campaign: 'FOUNDING3' },
    });
    note('create', 'promotion_code', 'FOUNDING3', created.id, 'active');
  } else {
    note('would', 'promotion_code', 'FOUNDING3', null, 'code FOUNDING3 on coupon FOUNDING3');
  }

  // -------------------------------------------------------------------------
  // billing_products SQL is printed, never executed. Applying it is a separate,
  // deliberate step against a database this script has no credentials for.
  // -------------------------------------------------------------------------
  const col = LIVE ? 'live' : 'test';
  const rows = [
    ['GNOME_LISTING_PUBLISH',  'one_time',      99,  'Publish one additional listing beyond the monthly allowance', publish],
    ['GNOME_LISTING_RENEWAL',  'one_time',      99,  'Renew one expired listing for a further 7 days',              renewal],
  ].filter(([, , , , r]) => r.priceId);

  // Postgres string literals are single-quoted; a double-quoted value is an IDENTIFIER, so
  // JSON.stringify here emitted SQL that failed on execution. Escape by doubling any apostrophe.
  const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

  if (rows.length) {
    console.log(`\n-- Apply to Supabase to make these purchasable (${col} columns):`);
    for (const [key, kind, cents, desc, r] of rows) {
      console.log(
`insert into public.billing_products
  (key, kind, description, unit_amount_cents, currency, active,
   stripe_product_id_${col}, stripe_price_id_${col})
values ('${key}', '${kind}', ${lit(desc)}, ${cents}, 'usd', true,
        '${r.productId}', '${r.priceId}')
on conflict (key) do update set
  stripe_product_id_${col} = excluded.stripe_product_id_${col},
  stripe_price_id_${col}   = excluded.stripe_price_id_${col},
  unit_amount_cents        = excluded.unit_amount_cents,
  active                   = true,
  updated_at               = now();`);
    }
  }

  const warns = log.filter((l) => l.action === 'WARN');
  console.log(`\n${APPLY ? 'Applied' : 'Dry run'}: ` +
    `${log.filter((l) => l.action === 'create').length} created, ` +
    `${log.filter((l) => l.action === 'reuse').length} reused, ` +
    `${log.filter((l) => l.action === 'would').length} pending, ` +
    `${warns.length} warning(s).`);
  if (warns.length) {
    console.log('\nWarnings need a human — Stripe prices and coupons are immutable, so a mismatch');
    console.log('cannot be edited in place. Create a new lookup_key, or delete and recreate.');
    process.exitCode = 1;
  }
  if (!APPLY) console.log('\nNothing was created. Re-run with --apply.');
}

main().catch((e) => {
  // Belt and braces: never let a thrown error carry the key into the output.
  console.error('\nFailed:', String(e.message ?? e).replace(KEY, '****'));
  process.exit(1);
});
