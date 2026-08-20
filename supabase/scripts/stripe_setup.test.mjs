#!/usr/bin/env node
//
// Tests stripe_setup.mjs against a stub Stripe API. No network, no key, no account touched.
//
//   node supabase/scripts/stripe_setup.test.mjs
//
// The property under test is the one that matters: rerunning must not create duplicates. A setup
// script that quietly creates a second $0.99 price every time someone runs it is worse than no
// script, because the duplicate is invisible until revenue is reconciled.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'stripe_setup.mjs');

const GROWER = 'prod_V3cXpuwyxPKCdi';

// A stub that starts empty and records every write, so "did it create anything?" is answerable.
function makeStub({ preexisting }) {
  const created = [];
  const prices = new Map(preexisting.prices ?? []);
  const coupons = new Map(preexisting.coupons ?? []);
  const promos = new Map(preexisting.promos ?? []);

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET') {
      if (url.pathname === `/v1/products/${GROWER}`) {
        return send(200, { id: GROWER, name: 'Gnome Grower' });
      }
      if (url.pathname === '/v1/prices') {
        const k = url.searchParams.get('lookup_keys[]');
        const hit = prices.get(k);
        return send(200, { data: hit ? [hit] : [] });
      }
      if (url.pathname.startsWith('/v1/coupons/')) {
        const id = url.pathname.split('/').pop();
        const c = coupons.get(id);
        return c ? send(200, c) : send(404, { error: { message: 'No such coupon' } });
      }
      if (url.pathname === '/v1/promotion_codes') {
        const code = url.searchParams.get('code');
        const p = promos.get(code);
        return send(200, { data: p ? [p] : [] });
      }
      return send(404, { error: { message: `stub: unhandled GET ${url.pathname}` } });
    }

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const params = new URLSearchParams(body);
      created.push({ path: url.pathname, params: Object.fromEntries(params) });
      if (url.pathname === '/v1/products') {
        return send(200, { id: `prod_new_${created.length}`, name: params.get('name') });
      }
      if (url.pathname === '/v1/prices') {
        const p = {
          id: `price_new_${created.length}`,
          product: params.get('product'),
          unit_amount: Number(params.get('unit_amount')),
          lookup_key: params.get('lookup_key'),
        };
        prices.set(p.lookup_key, p);
        return send(200, p);
      }
      if (url.pathname === '/v1/coupons') {
        const c = {
          id: params.get('id'),
          percent_off: Number(params.get('percent_off')),
          duration: params.get('duration'),
          duration_in_months: Number(params.get('duration_in_months')),
          applies_to: { products: [params.get('applies_to[products][0]')] },
        };
        coupons.set(c.id, c);
        return send(200, c);
      }
      if (url.pathname === '/v1/promotion_codes') {
        const p = { id: 'promo_new', code: params.get('code'), active: true, times_redeemed: 0 };
        promos.set(p.code, p);
        return send(200, p);
      }
      return send(404, { error: { message: `stub: unhandled POST ${url.pathname}` } });
    });
  });

  return { server, created, prices, coupons, promos };
}

function run(port, args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], {
      env: {
        ...process.env,
        STRIPE_SECRET_KEY: 'sk_test_stub0000',
        STRIPE_API_BASE: `http://127.0.0.1:${port}/v1`,
      },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  — ${detail}`}`);
};

async function withStub(preexisting, fn) {
  const stub = makeStub({ preexisting });
  await new Promise((r) => stub.server.listen(0, '127.0.0.1', r));
  const port = stub.server.address().port;
  try { return await fn(port, stub); } finally { stub.server.close(); }
}

console.log('\nstripe_setup.mjs against a stub API\n');

// 1. Dry run on an empty account creates nothing.
await withStub({}, async (port, stub) => {
  const { out } = await run(port, []);
  check('dry run creates nothing', stub.created.length === 0, `${stub.created.length} writes`);
  check('dry run reports the work as pending', (out.match(/\?/g) ?? []).length >= 4);
  check('dry run says nothing was created', out.includes('Nothing was created'));
});

// 2. --apply on an empty account creates each object exactly once.
await withStub({}, async (port, stub) => {
  const { out } = await run(port, ['--apply']);
  const posts = (path) => stub.created.filter((c) => c.path === path).length;
  check('creates 1 product (credit)', posts('/v1/products') === 1, `${posts('/v1/products')}`);
  // Without a tax code every checkout fails at payment time under Managed Payments, which is on by
  // default for this account — so this is a purchase-blocking omission, not metadata hygiene.
  check('every product carries a tax code',
    stub.created.filter((c) => c.path === '/v1/products').every((c) => c.params.tax_code === 'txcd_10000000'),
    stub.created.filter((c) => c.path === '/v1/products').map((c) => c.params.tax_code).join(','));
  check('creates 2 prices', posts('/v1/prices') === 2, `${posts('/v1/prices')}`);
  check('creates 1 coupon', posts('/v1/coupons') === 1, `${posts('/v1/coupons')}`);
  check('creates 1 promotion code', posts('/v1/promotion_codes') === 1, `${posts('/v1/promotion_codes')}`);

  const coupon = stub.created.find((c) => c.path === '/v1/coupons')?.params ?? {};
  check('coupon is 100% off', coupon.percent_off === '100', coupon.percent_off);
  check('coupon repeats for 3 months',
    coupon.duration === 'repeating' && coupon.duration_in_months === '3',
    `${coupon.duration}/${coupon.duration_in_months}`);
  // Stripe silently drops applies_to on coupon create — verified against the real account, and
  // against a raw curl, so it is not an encoding fault. Sending it anyway would be worse than
  // useless: it reads as a restriction that does not exist. Plan eligibility is enforced
  // server-side in billing-checkout instead, so the assertion is that we do NOT send it.
  check('coupon does not claim a Stripe-level product restriction',
    coupon['applies_to[products][0]'] === undefined, coupon['applies_to[products][0]']);
  check('coupon records its intended plan as metadata',
    coupon['metadata[gnome_applicable_plan]'] === 'grower',
    coupon['metadata[gnome_applicable_plan]']);

  const amounts = stub.created.filter((c) => c.path === '/v1/prices').map((c) => c.params.unit_amount).sort();
  check('prices are 99, 99', JSON.stringify(amounts) === JSON.stringify(['99', '99']),
    amounts.join(','));

  const keys = stub.created.filter((c) => c.path === '/v1/prices').map((c) => c.params.lookup_key).sort();
  check('lookup keys are the two expected',
    JSON.stringify(keys) === JSON.stringify(['gnome_listing_publish', 'gnome_listing_renewal']),
    keys.join(','));
  check('emits billing_products SQL', out.includes('insert into public.billing_products'));
  check('SQL targets the test columns, not live',
    out.includes('stripe_price_id_test') && !out.includes('stripe_price_id_live'));
});

// 3. THE ONE THAT MATTERS: rerunning against a populated account creates nothing.
await withStub({
  prices: [
    ['gnome_listing_publish', { id: 'price_a', product: 'prod_credit', unit_amount: 99, lookup_key: 'gnome_listing_publish' }],
    ['gnome_listing_renewal', { id: 'price_b', product: 'prod_credit', unit_amount: 99, lookup_key: 'gnome_listing_renewal' }],
  ],
  coupons: [['FOUNDING3', {
    id: 'FOUNDING3', percent_off: 100, duration: 'repeating', duration_in_months: 3,
    applies_to: { products: [GROWER] },
  }]],
  promos: [['FOUNDING3', { id: 'promo_x', code: 'FOUNDING3', active: true, times_redeemed: 4 }]],
}, async (port, stub) => {
  const { out, code } = await run(port, ['--apply']);
  check('rerun creates NOTHING', stub.created.length === 0, `${stub.created.length} writes`);
  check('rerun reports 0 created', /0 created/.test(out), out.match(/\d+ created/)?.[0]);
  check('rerun reuses all five objects', (out.match(/= /g) ?? []).length >= 5);
  check('rerun exits clean', code === 0, `exit ${code}`);
  check('rerun still emits SQL with the existing ids',
    out.includes('price_a') && out.includes('price_b'));
});

// 4. A price that exists at the wrong amount is reported, never silently mutated.
await withStub({
  prices: [['gnome_listing_publish',
    { id: 'price_wrong', product: 'prod_credit', unit_amount: 199, lookup_key: 'gnome_listing_publish' }]],
}, async (port, stub) => {
  const { out, code } = await run(port, ['--apply']);
  check('wrong-amount price is flagged', /EXISTS AT 199 NOT 99/.test(out));
  check('wrong-amount price is not overwritten',
    !stub.created.some((c) => c.path === '/v1/prices' && c.params.lookup_key === 'gnome_listing_publish'));
  check('warnings make the script exit non-zero', code === 1, `exit ${code}`);
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\nstripe setup: ${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
