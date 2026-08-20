// Parity + presentation for the expo allowance formatter.
//
//   node expo/lib/allowance.test.mjs
//
// Two jobs:
//   1. PARITY — transpile web/lib/allowance.ts AND expo/lib/allowance.ts and assert identical
//      output for identical server rows, across a matrix of plan states. The expo file is a copy
//      (no shared package exists between the two npm roots), and a copy's failure mode is silent
//      drift; this makes drift a test failure instead.
//   2. PRESENTATION — the same seller-facing assertions the web suite runs, against the expo copy,
//      so mobile cannot pass parity while both files are wrong together only if web's own suite is
//      also failing.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'allow-parity-'));
const build = (src, name) => {
  const out = join(tmp, name);
  execFileSync('npx', ['--yes', 'esbuild@0.23.0', src, '--format=esm', '--target=es2022', `--outfile=${out}`], { stdio: 'pipe' });
  return out;
};
const EXPO = await import(build(join(HERE, 'allowance.ts'), 'expo.mjs'));
const WEB = await import(build(join(HERE, '..', '..', 'web', 'lib', 'allowance.ts'), 'web.mjs'));

const results = [];
const ck = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  — ${detail}`}`);
};
const lines = (m) => m.lines.map((l) => l.value);
const has = (m, s) => lines(m).some((v) => v === s);

const row = (o) => ({
  display_name: 'Free', period_start: '2026-08-01T04:00:00Z', period_end: '2026-09-01T04:00:00Z',
  period_source: 'calendar_month',
  publishes_allowed: 3, renewals_allowed: 0, publishes_used: 0, renewals_used: 0,
  publishes_actual: 0, renewals_actual: 0, paid_publishes_period: 0, paid_renewals_period: 0,
  publishes_remaining: 3, renewals_remaining: 0, listing_lifetime_days: 7, ...o,
});
const PRO = (o) => row({ display_name: 'Pro', period_source: 'subscription', period_end: '2026-09-16T04:00:00Z',
  publishes_allowed: null, renewals_allowed: null, publishes_remaining: null, renewals_remaining: null, ...o });
const FARM = (o) => PRO({ display_name: 'Farm', publishes_allowed: null, renewals_allowed: null,
  publishes_remaining: null, renewals_remaining: null, ...o });
const LEGACY_FARM = (o) => FARM({ display_name: 'Legacy Farm', ...o });

// ---- 1. PARITY across the full state matrix -------------------------------
const MATRIX = [
  ['free unused', row({})],
  ['free partial', row({ publishes_used: 2, publishes_actual: 2, publishes_remaining: 1 })],
  ['free exhausted', row({ publishes_used: 3, publishes_actual: 3, publishes_remaining: 0 })],
  ['free paid overage', row({ publishes_used: 3, publishes_actual: 5, publishes_remaining: 0, paid_publishes_period: 2 })],
  ['free paid renewal', row({ renewals_actual: 1, paid_renewals_period: 1 })],
  ['pro', PRO({ publishes_actual: 14, renewals_actual: 2 })],
  ['farm', FARM({ publishes_actual: 47, renewals_actual: 18 })],
  ['legacy farm', LEGACY_FARM({ publishes_actual: 3, renewals_actual: 1 })],
];

console.log('\nexpo/web allowance parity\n');
for (const [name, r] of MATRIX) {
  const same =
    JSON.stringify(EXPO.listingsMeter(r)) === JSON.stringify(WEB.listingsMeter(r)) &&
    JSON.stringify(EXPO.renewalsMeter(r)) === JSON.stringify(WEB.renewalsMeter(r)) &&
    JSON.stringify(EXPO.renewalsMeter(r, { canBuyExtras: false })) === JSON.stringify(WEB.renewalsMeter(r, { canBuyExtras: false })) &&
    EXPO.exhaustedHint(r, 'listings') === WEB.exhaustedHint(r, 'listings') &&
    EXPO.exhaustedHint(r, 'renewals') === WEB.exhaustedHint(r, 'renewals') &&
    EXPO.exhaustedHint(r, 'listings', { canBuyExtras: false }) === WEB.exhaustedHint(r, 'listings', { canBuyExtras: false }) &&
    EXPO.exhaustedHint(r, 'renewals', { canBuyExtras: false }) === WEB.exhaustedHint(r, 'renewals', { canBuyExtras: false }) &&
    JSON.stringify(EXPO.upgradeHint(r)) === JSON.stringify(WEB.upgradeHint(r)) &&
    EXPO.resetLabel(r) === WEB.resetLabel(r);
  ck(`parity: ${name}`, same);
}
for (const [name, w] of [
  ['wanted free fresh', { display_name: 'Free', allowed: 1, used_today: 0, remaining: 1 }],
  ['wanted free spent', { display_name: 'Free', allowed: 1, used_today: 1, remaining: 0 }],
  ['wanted pro partial', { display_name: 'Pro', allowed: 5, used_today: 3, remaining: 2 }],
  ['wanted farm', { display_name: 'Farm', allowed: null, used_today: 27, remaining: null }],
  ['wanted legacy farm', { display_name: 'Legacy Farm', allowed: null, used_today: 3, remaining: null }],
]) {
  ck(`parity: ${name}`, JSON.stringify(EXPO.wantedMeter(w)) === JSON.stringify(WEB.wantedMeter(w)));
}
{
  const m = EXPO.wantedMeter({ display_name: 'Pro', allowed: 5, used_today: 3, remaining: 2 });
  ck('Wanted partial: 3 of 5 used / 2 remaining', has(m, '3 of 5 used') && has(m, '2 remaining'));
}
{
  const m = EXPO.wantedMeter({ display_name: 'Farm', allowed: null, used_today: 27, remaining: null });
  ck('Wanted Farm: 27 sent / Unlimited, no sentinel',
    has(m, '27 sent') && has(m, 'Unlimited') && !lines(m).some((v) => /999999|-1\b/.test(v)));
}
ck('Wanted exhausted state flags at 0 remaining',
  EXPO.wantedMeter({ display_name: 'Free', allowed: 1, used_today: 1, remaining: 0 }).exhausted === true);

ck('parity: planDisplay maps identically',
  ['free', 'grower', 'farm', 'sponsor', 'junk'].every((p) => EXPO.planDisplay(p) === WEB.planDisplay(p)));
ck('parity: NEXT_PLAN ladders identical',
  JSON.stringify(EXPO.NEXT_PLAN) === JSON.stringify(WEB.NEXT_PLAN));

// ---- 2. PRESENTATION against the expo copy --------------------------------
console.log('\nexpo presentation\n');
{
  const m = EXPO.listingsMeter(row({ publishes_used: 2, publishes_actual: 2, publishes_remaining: 1 }));
  ck('Free partial: 2 of 3 used / 1 remaining', has(m, '2 of 3 used') && has(m, '1 remaining'));
}
{
  const r = row({ publishes_used: 3, publishes_actual: 5, publishes_remaining: 0, paid_publishes_period: 2 });
  const m = EXPO.listingsMeter(r);
  ck('Free overage: included and actual stated separately',
    has(m, '3 of 3 included used') && has(m, '5 published total') && has(m, '0 included remaining'));
  ck('never renders "5 of 3"', !lines(m).some((v) => /5 of 3/.test(v)));
  ck('no negative remaining', !lines(m).some((v) => v.includes('-')));
}
{
  const r = PRO({ publishes_actual: 23, renewals_actual: 5 });
  ck('Pro shows actual publishes AND Unlimited',
    has(EXPO.listingsMeter(r), '23 published') && has(EXPO.listingsMeter(r), 'Unlimited'));
  ck('Pro shows actual renewals AND Unlimited',
    has(EXPO.renewalsMeter(r), '5 renewed') && has(EXPO.renewalsMeter(r), 'Unlimited'));
  ck('renewal totals never leak into publish totals',
    !lines(EXPO.listingsMeter(r)).some((v) => /renew/i.test(v)));
  ck('Pro gets no paid overage or upgrade hints',
    EXPO.exhaustedHint(r, 'listings') === null && EXPO.exhaustedHint(r, 'renewals') === null && EXPO.upgradeHint(r) === null);
}
{
  const r = FARM({ publishes_actual: 47, renewals_actual: 18 });
  const lm = EXPO.listingsMeter(r), rm = EXPO.renewalsMeter(r);
  ck('Farm shows actual AND Unlimited', has(lm, '47 published') && has(lm, 'Unlimited')
    && has(rm, '18 renewed') && has(rm, 'Unlimited'));
  ck('Farm has no sentinel numbers', !lines(lm).concat(lines(rm)).some((v) => /999999|-1\b|of 0\b/.test(v)));
  ck('Farm gets no overage or upgrade hints',
    EXPO.exhaustedHint(r, 'listings') === null && EXPO.upgradeHint(r) === null);
}
ck('reset date is the server period_end', EXPO.resetLabel({ period_end: '2026-09-16T04:00:00Z' }) === 'Resets Sep 16');
ck('bad period_end degrades to empty', EXPO.resetLabel({ period_end: 'junk' }) === '');
{
  const all = [row({}), PRO({}), FARM({ publishes_actual: 1, renewals_actual: 1 }), LEGACY_FARM({ publishes_actual: 1, renewals_actual: 1 })]
    .flatMap((r) => lines(EXPO.listingsMeter(r)).concat(lines(EXPO.renewalsMeter(r))).concat([r.display_name]));
  ck('no internal enum reaches seller copy',
    !all.some((v) => /\b(grower|sponsor)\b/i.test(v)) && !all.some((v) => /^farm$/.test(v)));
}
ck('planDisplay: farm is sellable Farm and sponsor is Legacy Farm',
  EXPO.planDisplay('farm') === 'Farm' && EXPO.planDisplay('sponsor') === 'Legacy Farm');
{
  const r = row({ publishes_used: 3, publishes_actual: 3, publishes_remaining: 0 });
  const rm = EXPO.renewalsMeter(r, { canBuyExtras: false });
  ck('Android-style copy hides extra-purchase prices',
    EXPO.exhaustedHint(r, 'listings', { canBuyExtras: false }) === null
    && has(rm, 'Upgrade for renewals')
    && !lines(rm).some((v) => v.includes('$0.99')));
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nexpo allowance: ${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
