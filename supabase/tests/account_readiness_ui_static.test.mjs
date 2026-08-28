import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const webPanel = read('web/app/components/AccountReadinessPanel.tsx');
const webApi = read('web/lib/accountReadiness.ts');
const nativeScreen = read('expo/app/account-ready.tsx');
const nativeApi = read('expo/lib/accountReadiness.ts');

for (const [surface, source] of [
  ['web', webPanel],
  ['native', nativeScreen],
]) {
  assert.match(source, /age18:\s*false/iu, `${surface}: age confirmation must default unchecked`);
  assert.match(source, /terms:\s*false/iu, `${surface}: Terms must default unchecked`);
  assert.match(source, /privacy:\s*false/iu, `${surface}: Privacy must default unchecked`);
  assert.match(source, /marketplaceRules:\s*false/iu, `${surface}: Marketplace Rules must default unchecked`);
  assert.match(source, /I confirm I am 18 or older/iu, `${surface}: 18+ confirmation must be visible`);
  assert.match(source, /['"]\/terms['"]/u, `${surface}: Terms link is required`);
  assert.match(source, /['"]\/privacy['"]/u, `${surface}: Privacy link is required`);
  assert.match(source, /['"]\/trust['"]/u, `${surface}: Marketplace Rules link is required`);
  assert.match(source, /!consent\.age18\s*\|\|\s*!consent\.terms\s*\|\|\s*!consent\.privacy\s*\|\|\s*!consent\.marketplaceRules/u,
    `${surface}: acceptance must remain disabled until every confirmation is checked`);
  assert.match(source, /setEmailCooldown\(60\)/u, `${surface}: email resend cooldown must start at 60 seconds`);
  assert.match(source, /verifyEmailCode\(/u, `${surface}: legacy email verification must require the emailed code`);
  assert.match(source, /acceptCurrentAccountPolicies\(consent\)/u, `${surface}: UI must forward the user's actual consent`);
  assert.doesNotMatch(source, /Verify your phone|Verified mobile phone|setPhoneCooldown/iu,
    `${surface}: deferred phone OTP must not appear as a launch requirement`);
}

for (const [surface, source] of [
  ['web', webApi],
  ['native', nativeApi],
]) {
  assert.match(source, /p_confirm_18:\s*consent\.age18/u, `${surface}: age consent must not be hard-coded`);
  assert.match(source, /p_accept_terms:\s*consent\.terms/u, `${surface}: Terms consent must not be hard-coded`);
  assert.match(source, /p_accept_privacy:\s*consent\.privacy/u, `${surface}: Privacy consent must not be hard-coded`);
  assert.match(source, /p_accept_marketplace_rules:\s*consent\.marketplaceRules/u,
    `${surface}: Marketplace Rules consent must not be hard-coded`);
  assert.match(source, /shouldCreateUser:\s*false/u,
    `${surface}: account verification must never create a replacement user`);
  assert.match(source, /type:\s*['"]email['"]/u,
    `${surface}: account email proof must use Supabase email OTP verification`);
}

console.log('account readiness web/native static UI: PASS');
