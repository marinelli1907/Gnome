import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260825160000_growth_referrals.sql');
const admin = read('admin/App.tsx');
const qr = read('web/app/q/[code]/route.ts');
const appLayout = read('expo/app/_layout.tsx');
const appProfile = read('expo/app/(tabs)/profile.tsx');
const webLayout = read('web/app/layout.tsx');
const webMobileNav = read('web/app/components/MobileNav.tsx');
const webLogin = read('web/app/login/LoginClient.tsx');
const checkout = read('supabase/functions/billing-checkout/index.ts');
const boardroom = read('supabase/functions/boardroom/index.ts');

for (const deferredRoute of [
  'expo/app/referrals.tsx',
  'web/app/referrals/page.tsx',
  'web/app/referrals/ReferralsClient.tsx',
  'web/app/components/ReferralCapture.tsx',
]) {
  assert.equal(existsSync(new URL(`../../${deferredRoute}`, import.meta.url)), false);
}
for (const customerSurface of [appLayout, appProfile, webLayout, webMobileNav, webLogin, qr]) {
  assert.doesNotMatch(customerSurface, /\/referrals|capture_my_referral|resolve_market_qr_referral/iu);
}
assert.match(admin, /GrowthOperations/u);
assert.match(admin, /Gemma/u);
assert.match(admin, /Marty/u);
assert.match(admin, /admin_set_concierge_acquisition/u);
assert.match(qr, /resolve_market_qr/u);
assert.match(checkout, /conversion_behavior/u);
assert.match(checkout, /payment_method_collection/u);
assert.match(boardroom, /referral_growth_summary_service/u);
assert.match(boardroom, /Gemma/u);
assert.match(boardroom, /Marty/u);
assert.match(migration, /SELF_REFERRAL_NOT_ALLOWED/u);
assert.match(migration, /DUPLICATE_PHONE_REFERRAL_NOT_ALLOWED/u);
assert.match(migration, /idempotency_key text not null unique/u);
assert.match(migration, /payments_live_enabled/u);
assert.doesNotMatch(migration, /payments_live_enabled\s*=\s*true/u);

console.log('referral growth cross-surface static checks: PASS');
