import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260825160000_growth_referrals.sql');
const app = read('expo/app/referrals.tsx');
const web = read('web/app/referrals/ReferralsClient.tsx');
const admin = read('admin/App.tsx');
const qr = read('web/app/q/[code]/route.ts');
const checkout = read('supabase/functions/billing-checkout/index.ts');
const boardroom = read('supabase/functions/boardroom/index.ts');

for (const surface of [app, web]) {
  assert.match(surface, /Each qualified seller/iu);
  assert.match(surface, /3 qualified/iu);
  assert.match(surface, /5 qualified/iu);
  assert.match(surface, /10 qualified/iu);
  assert.match(surface, /25 and 50/iu);
  assert.match(surface, /capture_my_referral/u);
}
assert.match(admin, /GrowthOperations/u);
assert.match(admin, /Gemma/u);
assert.match(admin, /Marty/u);
assert.match(admin, /admin_set_concierge_acquisition/u);
assert.match(qr, /resolve_market_qr_referral/u);
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
