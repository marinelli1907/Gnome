import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

const collectSources = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(directory, entry.name);
  if (entry.isDirectory() && ['.next', 'node_modules'].includes(entry.name)) return [];
  if (entry.isDirectory()) return collectSources(target);
  return statSync(target).isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
});

const mobileFiles = ['app', 'components', 'lib']
  .flatMap((directory) => collectSources(path.join(root, 'expo', directory)))
  .filter((file) => !/\.test\.(?:ts|tsx)$/.test(file));
const shippedMobileSources = mobileFiles
  .map((file) => `\n/* ${path.relative(root, file)} */\n${readFileSync(file, 'utf8')}`)
  .join('\n');

const upgrade = read('expo/app/upgrade.tsx');
const subscriptions = read('expo/lib/nativeSubscriptions.ts');
const promote = read('expo/app/promote/[listingId].tsx');
const checkout = read('supabase/functions/billing-checkout/index.ts');
const assistant = read('supabase/functions/gnome-assistant/index.ts');
const webSources = collectSources(path.join(root, 'web'))
  .map((file) => `\n/* ${path.relative(root, file)} */\n${readFileSync(file, 'utf8')}`)
  .join('\n');

// Guideline 3.1.1: the shipped native source has no Gnome-controlled code,
// coupon, Stripe overage, purchased boost-credit, or checkout-return mechanism.
assert.doesNotMatch(
  shippedMobileSources,
  /promo_code|preview_promo|FOUNDING3|capture_my_referral|my_referral_program|referral_code|coupon_code/iu,
  'the shipped mobile source must not contain a customer code path that grants paid digital access',
);
assert.doesNotMatch(
  shippedMobileSources,
  /\$0\.99|purchaseOverage|GNOME_LISTING_(?:PUBLISH|RENEWAL|PROMOTION)|promote_listing_purchased/iu,
  'the shipped mobile source must not offer or redeem standalone paid digital listing actions',
);
assert.doesNotMatch(
  shippedMobileSources,
  /functions\.invoke\(['"]billing-checkout|gnome:\/\/checkout-(?:success|cancelled)|openStripeSubscriptionPortal|createPlanCheckout|finishPlanCheckout/iu,
  'the shipped mobile source must not call or return from external digital checkout',
);
assert.doesNotMatch(
  shippedMobileSources,
  /claim_prepared_market|concierge_claim_preview|claim-market/iu,
  'the shipped mobile source must not redeem a concierge token that can activate paid-plan access',
);
assert.equal(existsSync(path.join(root, 'expo/lib/billing.ts')), false, 'the native Stripe billing client must be absent');
assert.equal(existsSync(path.join(root, 'expo/lib/digitalPurchase.ts')), false, 'the retired native digital-purchase gate must be absent');
assert.equal(existsSync(path.join(root, 'expo/app/checkout-success.tsx')), false, 'the native checkout success route must be absent');
assert.equal(existsSync(path.join(root, 'expo/app/checkout-cancelled.tsx')), false, 'the native checkout cancel route must be absent');
assert.equal(existsSync(path.join(root, 'expo/app/claim-market.tsx')), false, 'the entitlement-bearing native claim route must be absent');

// Pro/Farm still use verified StoreKit products, including pending-state denial
// and restore. Removing Stripe must not weaken the existing server verification.
assert.match(upgrade, /const usesNativeSubscriptions = Platform\.OS === 'ios';/u);
assert.match(upgrade, /if \(!usesNativeSubscriptions \|\| checkoutPlan/iu);
assert.match(upgrade, /await native\.purchase\(target\);/u);
assert.match(upgrade, />Restore purchases</u);
assert.match(subscriptions, /purchase\.purchaseState==='pending'[\s\S]*return;/u);
assert.match(subscriptions, /supabase\.functions\.invoke\('subscription-sync'/u);
assert.doesNotMatch(subscriptions, /promoCode|FOUNDING3|foundingEligibility/iu);

// Included plan credits remain; externally purchased promotion credits cannot
// be displayed or consumed by the native app.
assert.match(promote, /source: 'plan_credit'/u);
assert.match(promote, /Extra promotions are not sold in the app\.|They are not sold in the app\./u);
assert.doesNotMatch(promote, /purchased_balance|usePromotePurchased|promotePurchased|purchased credit/iu);
assert.match(assistant, /const digitalPurchasesAvailable = appPlatform === 'web';/u);
assert.match(assistant, /NATIVE PURCHASE POLICY:[\s\S]*Do not mention standalone paid publishes/iu);
const chatSystem = assistant.slice(assistant.indexOf('const CHAT_SYSTEM'), assistant.indexOf('const VISION_PROMPT'));
assert.doesNotMatch(chatSystem, /\$0\.99/u, 'the base assistant prompt must not leak web-only overage pricing to native callers');

// Defense in depth: the Edge Function rejects every missing/native platform
// before allowance, promo, product, mode, portal, or Stripe work.
const webOnlyGate = checkout.indexOf("if (body.platform !== 'web')");
const marketLookup = checkout.indexOf("admin.from('markets')");
const overageLookup = checkout.indexOf('if (OVERAGE_KEYS.has(key))');
const productLookup = checkout.indexOf("admin.from('billing_products')");
const promoPreview = checkout.indexOf("if (body.action === 'preview_promo')");
const stripeSecret = checkout.indexOf("Deno.env.get('STRIPE_SECRET_KEY_");
const stripeSession = checkout.indexOf('stripe.checkout.sessions.create');
assert.ok(webOnlyGate >= 0, 'billing-checkout must have a fail-closed web-only gate');
for (const [name, index] of [
  ['market lookup', marketLookup],
  ['overage lookup', overageLookup],
  ['product lookup', productLookup],
  ['promo preview', promoPreview],
  ['Stripe secret resolution', stripeSecret],
  ['Stripe session creation', stripeSession],
]) {
  assert.ok(index > webOnlyGate, `${name} must occur after the web-only gate`);
}
assert.match(checkout, /error: 'DIGITAL_CHECKOUT_WEB_ONLY'/u);
assert.doesNotMatch(checkout, /gnome:\/\/checkout-(?:success|cancelled)/iu);
assert.match(checkout, /success_url: `\$\{base\}\/my\?checkout=success`/u);
assert.match(checkout, /cancel_url: `\$\{base\}\/my\?checkout=cancelled`/u);

// Every retained Stripe caller lives in Next.js and explicitly opts into the
// server's web-only contract. Missing platform fails closed.
const callPattern = /functions\.invoke\('billing-checkout'/gu;
const calls = [...webSources.matchAll(callPattern)];
assert.ok(calls.length > 0, 'expected retained web billing-checkout callers');
for (const call of calls) {
  const snippet = webSources.slice(call.index, call.index + 700);
  assert.match(snippet, /platform\s*:\s*['"]web['"]/u, 'every web digital checkout call must identify itself as web');
}

// Venmo, PayPal, Cash App, and Zelle are physical-order handoff helpers. They
// do not call billing-checkout or any entitlement/publish RPC.
const marketOps = read('expo/lib/marketops.ts');
assert.match(marketOps, /venmo\.com|paypal\.me|cash\.app/iu);
assert.doesNotMatch(marketOps, /billing-checkout|subscription-sync|my_plan_entitlements|publish_listing|renew_listing/iu);

console.log('Apple paid-digital compliance static checks: PASS');
