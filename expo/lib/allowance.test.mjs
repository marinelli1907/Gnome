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
  publishes_allowed: 20, renewals_allowed: 3, publishes_remaining: 20, renewals_remaining: 3, ...o });
const MAX = (o) => PRO({ display_name: 'Max', publishes_allowed: 40, renewals_allowed: 10,
  publishes_remaining: 40, renewals_remaining: 10, ...o });
const FARM = (o) => PRO({ display_name: 'Farm', publishes_allowed: null, renewals_allowed: null,
  publishes_remaining: null, renewals_remaining: null, ...o });

// ---- 1. PARITY across the full state matrix -------------------------------
const MATRIX = [
  ['free unused', row({})],
  ['free partial', row({ publishes_used: 2, publishes_actual: 2, publishes_remaining: 1 })],
  ['free exhausted', row({ publishes_used: 3, publishes_actual: 3, publishes_remaining: 0 })],
  ['free paid overage', row({ publishes_used: 3, publishes_actual: 5, publishes_remaining: 0, paid_publishes_period: 2 })],
  ['free paid renewal', row({ renewals_actual: 1, paid_renewals_period: 1 })],
  ['pro partial', PRO({ publishes_used: 14, publishes_actual: 14, publishes_remaining: 6,
                        renewals_used: 2, renewals_actual: 2, renewals_remaining: 1 })],
  ['pro overage', PRO({ publishes_used: 20, publishes_actual: 23, publishes_remaining: 0, paid_publishes_period: 3,
                        renewals_used: 3, renewals_actual: 5, renewals_remaining: 0, paid_renewals_period: 2 })],
  ['max partial', MAX({ publishes_used: 27, publishes_actual: 27, publishes_remaining: 13,
                        renewals_used: 7, renewals_actual: 7, renewals_remaining: 3 })],
  ['max exhausted', MAX({ publishes_used: 40, publishes_actual: 40, publishes_remaining: 0,
                          renewals_used: 10, renewals_actual: 10, renewals_remaining: 0 })],
  ['farm', FARM({ publishes_actual: 47, renewals_actual: 18 })],
];

console.log('\nexpo/web allowance parity\n');
for (const [name, r] of MATRIX) {
  const same =
    JSON.stringify(EXPO.listingsMeter(r)) === JSON.stringify(WEB.listingsMeter(r)) &&
    JSON.stringify(EXPO.renewalsMeter(r)) === JSON.stringify(WEB.renewalsMeter(r)) &&
    EXPO.exhaustedHint(r, 'listings') === WEB.exhaustedHint(r, 'listings') &&
    EXPO.exhaustedHint(r, 'renewals') === WEB.exhaustedHint(r, 'renewals') &&
    JSON.stringify(EXPO.upgradeHint(r)) === JSON.stringify(WEB.upgradeHint(r)) &&
    EXPO.resetLabel(r) === WEB.resetLabel(r);
  ck(`parity: ${name}`, same);
}
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
  const r = PRO({ publishes_used: 20, publishes_actual: 23, publishes_remaining: 0, paid_publishes_period: 3,
                  renewals_used: 3, renewals_actual: 5, renewals_remaining: 0, paid_renewals_period: 2 });
  ck('Pro overage listings: 20 included / 23 total',
    has(EXPO.listingsMeter(r), '20 of 20 included used') && has(EXPO.listingsMeter(r), '23 published total'));
  ck('Pro overage renewals: 3 included / 5 total',
    has(EXPO.renewalsMeter(r), '3 of 3 included used') && has(EXPO.renewalsMeter(r), '5 renewed total'));
  ck('renewal totals never leak into publish totals',
    !lines(EXPO.listingsMeter(r)).some((v) => /renew/i.test(v)));
  ck('Pro exhausted offers Max', EXPO.upgradeHint(r)?.name === 'Max');
}
{
  const r = MAX({ publishes_used: 40, publishes_actual: 40, publishes_remaining: 0,
                  renewals_used: 10, renewals_actual: 10, renewals_remaining: 0 });
  ck('Max exhausted offers Farm', EXPO.upgradeHint(r)?.name === 'Farm');
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
  const all = [row({}), PRO({}), MAX({}), FARM({ publishes_actual: 1, renewals_actual: 1 })]
    .flatMap((r) => lines(EXPO.listingsMeter(r)).concat(lines(EXPO.renewalsMeter(r))).concat([r.display_name]));
  ck('no internal enum reaches seller copy',
    !all.some((v) => /\b(grower|sponsor)\b/i.test(v)) && !all.some((v) => /^farm$/.test(v)));
}
ck('planDisplay: the counter-intuitive pair maps right',
  EXPO.planDisplay('farm') === 'Max' && EXPO.planDisplay('sponsor') === 'Farm');

const failed = results.filter((r) => !r.ok).length;
console.log(`\nexpo allowance: ${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
