import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const subscriptions = fs.readFileSync(path.join(root, 'lib/nativeSubscriptions.ts'), 'utf8');
const upgrade = fs.readFileSync(path.join(root, 'app/upgrade.tsx'), 'utf8');

const pendingGuard = subscriptions.indexOf("if (purchase.purchaseState==='pending')");
const backendSync = subscriptions.indexOf("supabase.functions.invoke('subscription-sync'");
assert.ok(pendingGuard >= 0, 'pending purchases must have an explicit guard');
assert.ok(
  pendingGuard < backendSync,
  'pending purchases must be rejected before the backend entitlement sync',
);
assert.match(
  subscriptions,
  /purchase\.purchaseState==='pending'[\s\S]*Access starts only after the store confirms it\.[\s\S]*return;/,
);

assert.doesNotMatch(
  upgrade,
  /Promo code|Enter promo code|FOUNDING3|previewPlanPromo|nativeFounding|promoCode/i,
  'the iOS plan screen must not expose a non-IAP promo-code redemption path',
);
assert.match(
  upgrade,
  /await native\.purchase\(target\);/,
  'native subscription checkout must go directly through the store product',
);
assert.doesNotMatch(
  subscriptions,
  /promoCode|FOUNDING3|foundingEligibility/i,
  'the native subscription client must not accept a Gnome-controlled offer code',
);
assert.match(
  upgrade,
  /const usesNativeSubscriptions = Platform\.OS === 'ios';/,
  'Android must not be treated as a native subscription checkout platform in this release',
);
assert.match(
  upgrade,
  /useNativeSubscriptions\(userId\?\?undefined,refreshPlan,usesNativeSubscriptions\)/,
  'Android must not initialize native store activity from the plan screen',
);
assert.match(
  upgrade,
  /if \(!usesNativeSubscriptions \|\| checkoutPlan/,
  'the upgrade action must refuse every platform except the enabled native store surface',
);
assert.doesNotMatch(
  upgrade,
  /billing-checkout|openAuthSessionAsync|openStripeSubscriptionPortal|createPlanCheckout|finishPlanCheckout/iu,
  'the native plan screen must contain no external digital checkout fallback',
);
assert.equal(fs.existsSync(path.join(root, 'lib/billing.ts')), false, 'the mobile Stripe billing client must be absent');
assert.equal(fs.existsSync(path.join(root, 'app/checkout-success.tsx')), false, 'the mobile checkout success route must be absent');
assert.equal(fs.existsSync(path.join(root, 'app/checkout-cancelled.tsx')), false, 'the mobile checkout cancel route must be absent');
assert.match(
  upgrade,
  /native\.products\[productId\]\?\.displayPrice/,
  'the subscription screen must prefer StoreKit-localized prices',
);
assert.match(upgrade, />Restore purchases</, 'the subscription screen must keep a restore control');
assert.match(
  upgrade,
  /nativeWebUrl\('\/terms'\)[\s\S]*>Terms of Use</,
  'the subscription screen must link to the Terms of Use',
);
assert.match(
  upgrade,
  /nativeWebUrl\('\/privacy'\)[\s\S]*>Privacy Policy</,
  'the subscription screen must link to the Privacy Policy',
);
