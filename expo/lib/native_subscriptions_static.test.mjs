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

assert.match(
  upgrade,
  /const nativePromo = target === 'grower' && nativeFounding \? promoCode : undefined;/,
  'FOUNDING3 must be scoped to Pro and never leak into a Farm checkout',
);
assert.ok(
  (upgrade.match(/setNativeFounding\(null\)/g) ?? []).length >= 3,
  'changing or reapplying promo input must clear stale native offer state',
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
  /if \(!canBuyDigitalInApp\) return;/,
  'the checkout function must refuse Android even if a hidden call site regresses',
);
