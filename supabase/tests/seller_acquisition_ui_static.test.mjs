import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const admin = read('admin/App.tsx');
const assist = read('expo/app/market/assistance.tsx');
const upgrade = read('expo/app/upgrade.tsx');
const webPricing = read('web/app/pricing/PricingCTA.tsx');
const webClaim = read('web/app/claim-market/ClaimMarketClient.tsx');
const webImport = read('web/app/my/import/ImportClient.tsx');
const conciergeFunction = read('supabase/functions/seller-concierge/index.ts');

assert.match(admin, /SellerConcierge/u);
assert.match(admin, /Chat with Boon/u);
assert.match(admin, /admin_grant_plan_v2/u);
assert.match(admin, /admin_market_entitlements_v2/u);
assert.match(admin, /admin_promo_campaigns_v2/u);
assert.match(admin, /admin_prepare_concierge_entitlement/u);
assert.match(admin, /Begins at claim/u);
assert.match(admin, /Bound to the current secure invitation/u);
assert.equal(
  existsSync(fileURLToPath(new URL('../../expo/app/claim-market.tsx', import.meta.url))),
  false,
  'entitlement-bearing concierge claim must remain web-only',
);
assert.match(assist, /'OFF'.*'SUPPORT'.*'MANAGED'/su);
assert.doesNotMatch(upgrade, /Promo code|Have a code\?|FOUNDING3|preview_promo/iu);
assert.equal(
  existsSync(fileURLToPath(new URL('../../expo/lib/billing.ts', import.meta.url))),
  false,
  'native external digital checkout must remain absent',
);
assert.match(webPricing, /promo/iu);
assert.match(webPricing, /platform:\s*'web'/u);
assert.match(webClaim, /verify_concierge_email/u);
assert.match(webClaim, /session\.access_token/u);
assert.match(webClaim, /claim_prepared_market/u);
assert.match(webClaim, /AccountReadinessPanel/u);
assert.match(webClaim, /seller_concierge_cases/u);
assert.match(webClaim, /claimed_market_id/u);
assert.match(webClaim, /\?claimed=/u);
assert.match(webClaim, /This Market has already been claimed/u);
assert.match(webClaim, /Review my Market/u);
assert.match(webClaim, /\/my\/import\?case=/u);
assert.doesNotMatch(webClaim, /if \(!token\) \{\s*setLoading\(false\)/u);
assert.match(webImport, /concierge_case_id/u);
assert.match(webImport, /Review your prepared listings/u);
assert.match(conciergeFunction, /https:\/\/gnomefarmersmarket\.com\/claim-market/u);
console.log('seller acquisition UI static checks: PASS');
