// Presentation tests for the seller allowance card.
//
//   node web/lib/allowance.test.mjs
//
// These assert what the seller SEES for a given server payload. They deliberately do not
// re-implement allowance rules — every input row here is shaped exactly as my_listing_allowance()
// returns it, and the rules themselves are proven in supabase/tests/allowance_usage_suite.sql.
// Asserting the arithmetic again here would be testing a copy of the logic, which is not
// verification.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), 'allow-')), 'allowance.mjs');
execFileSync('npx', ['--yes', 'esbuild@0.23.0', join(HERE, 'allowance.ts'),
  '--format=esm', '--target=es2022', `--outfile=${out}`], { stdio: 'pipe' });
const A = await import(out);

const results = [];
const ck = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  — ${detail}`}`);
};
const lines = (m) => m.lines.map((l) => l.value);
const has = (m, s) => lines(m).some((v) => v === s);

/** A row exactly as my_listing_allowance() returns it. */
const row = (o) => ({
  display_name: 'Free', period_start: '2026-08-01T04:00:00Z', period_end: '2026-09-01T04:00:00Z',
  period_source: 'calendar_month',
  publishes_allowed: 3, renewals_allowed: 0,
  publishes_used: 0, renewals_used: 0,
  publishes_actual: 0, renewals_actual: 0,
  paid_publishes_period: 0, paid_renewals_period: 0,
  publishes_remaining: 3, renewals_remaining: 0,
  listing_lifetime_days: 7, ...o,
});
const PRO = (o) => row({
  display_name: 'Pro', period_source: 'subscription', period_end: '2026-09-16T04:00:00Z',
  publishes_allowed: 20, renewals_allowed: 3, publishes_remaining: 20, renewals_remaining: 3, ...o,
});
const MAX = (o) => PRO({ display_name: 'Max', publishes_allowed: 40, renewals_allowed: 10,
  publishes_remaining: 40, renewals_remaining: 10, ...o });
const FARM = (o) => PRO({ display_name: 'Farm', publishes_allowed: null, renewals_allowed: null,
  publishes_remaining: null, renewals_remaining: null, ...o });

console.log('\nseller allowance card presentation\n');

// ---- FREE ----------------------------------------------------------------
ck('Free unused shows 0 of 3 and 3 remaining',
  has(A.listingsMeter(row({})), '0 of 3 used') && has(A.listingsMeter(row({})), '3 remaining'));

{
  const m = A.listingsMeter(row({ publishes_used: 2, publishes_actual: 2, publishes_remaining: 1 }));
  ck('Free partial shows 2 of 3 used, 1 remaining',
    has(m, '2 of 3 used') && has(m, '1 remaining'), lines(m).join(' | '));
  ck('Free partial is not flagged exhausted', m.exhausted === false);
}
{
  const r = row({ publishes_used: 3, publishes_actual: 3, publishes_remaining: 0 });
  const m = A.listingsMeter(r);
  ck('Free exhausted shows 0 remaining', has(m, '0 remaining') && m.exhausted === true);
  ck('Free exhausted offers $0.99', A.exhaustedHint(r, 'listings') === 'Additional listing: $0.99');
  ck('Free exhausted offers the Pro upgrade',
    A.upgradeHint(r)?.name === 'Pro' && A.upgradeHint(r)?.price === '$9.99/month');
}
{
  // 3 included + 2 paid. The spec's explicit "do not render 5 of 3 used".
  const r = row({ publishes_used: 3, publishes_actual: 5, publishes_remaining: 0, paid_publishes_period: 2 });
  const m = A.listingsMeter(r);
  ck('Free overage separates included from actual',
    has(m, '3 of 3 included used') && has(m, '5 published total') && has(m, '0 included remaining'),
    lines(m).join(' | '));
  ck('Free overage NEVER renders "5 of 3 used"', !lines(m).some((v) => /5 of 3/.test(v)));
  ck('Free overage shows no negative remaining', !lines(m).some((v) => v.includes('-')));
}
{
  const m = A.renewalsMeter(row({}));
  ck('Free renewals say there are none free, at $0.99',
    has(m, 'No free renewals') && has(m, '$0.99 each'), lines(m).join(' | '));
  ck('Free renewals heading has no period suffix', m.heading === 'Renewals');
}
ck('Free paid renewal still shows actual activity',
  has(A.renewalsMeter(row({ renewals_actual: 1, paid_renewals_period: 1 })), '1 renewed this month'));

// ---- PRO -----------------------------------------------------------------
ck('Pro unused shows 0 of 20', has(A.listingsMeter(PRO({})), '0 of 20 used'));
{
  const m = A.listingsMeter(PRO({ publishes_used: 14, publishes_actual: 14, publishes_remaining: 6 }));
  ck('Pro partial shows 14 of 20 used, 6 remaining',
    has(m, '14 of 20 used') && has(m, '6 remaining'), lines(m).join(' | '));
  ck('Pro uses billing-period wording', m.heading === 'Listings this billing period');
}
{
  const r = PRO({ publishes_used: 20, publishes_actual: 23, publishes_remaining: 0, paid_publishes_period: 3,
                  renewals_used: 3, renewals_actual: 5, renewals_remaining: 0, paid_renewals_period: 2 });
  const lm = A.listingsMeter(r), rm = A.renewalsMeter(r);
  ck('Pro overage listings read 20 included / 23 total / 0 remaining',
    has(lm, '20 of 20 included used') && has(lm, '23 published total') && has(lm, '0 included remaining'),
    lines(lm).join(' | '));
  ck('Pro overage renewals read 3 included / 5 total / 0 remaining',
    has(rm, '3 of 3 included used') && has(rm, '5 renewed total') && has(rm, '0 included remaining'),
    lines(rm).join(' | '));
  ck('Pro exhausted renewals offer $0.99',
    A.exhaustedHint(r, 'renewals') === 'Additional renewal: $0.99');
  ck('Pro exhausted offers the Max upgrade', A.upgradeHint(r)?.name === 'Max');
  ck('Pro overage never renders "23 of 20"', !lines(lm).some((v) => /23 of 20/.test(v)));
}
{
  const m = A.renewalsMeter(PRO({ renewals_used: 2, renewals_actual: 2, renewals_remaining: 1 }));
  ck('Pro partial renewals show 2 of 3 and 1 free remaining',
    has(m, '2 of 3 used') && has(m, '1 free renewal remaining'), lines(m).join(' | '));
}

// ---- MAX -----------------------------------------------------------------
ck('Max unused shows 0 of 40', has(A.listingsMeter(MAX({})), '0 of 40 used'));
{
  const r = MAX({ publishes_used: 27, publishes_actual: 27, publishes_remaining: 13,
                  renewals_used: 7, renewals_actual: 7, renewals_remaining: 3 });
  ck('Max partial shows 27 of 40 used, 13 remaining',
    has(A.listingsMeter(r), '27 of 40 used') && has(A.listingsMeter(r), '13 remaining'));
  ck('Max partial renewals show 7 of 10 and 3 free remaining',
    has(A.renewalsMeter(r), '7 of 10 used') && has(A.renewalsMeter(r), '3 free renewals remaining'));
  ck('Max not exhausted offers no upgrade advert', A.upgradeHint(r) === null);
}
{
  const r = MAX({ publishes_used: 40, publishes_actual: 40, publishes_remaining: 0,
                  renewals_used: 10, renewals_actual: 10, renewals_remaining: 0 });
  ck('Max exhausted offers the Farm upgrade', A.upgradeHint(r)?.name === 'Farm');
  ck('Max exhausted renewals offer $0.99', A.exhaustedHint(r, 'renewals') === 'Additional renewal: $0.99');
}

// ---- FARM ----------------------------------------------------------------
{
  const r = FARM({ publishes_actual: 47, renewals_actual: 18 });
  const lm = A.listingsMeter(r), rm = A.renewalsMeter(r);
  ck('Farm shows actual publishes AND unlimited',
    has(lm, '47 published') && has(lm, 'Unlimited'), lines(lm).join(' | '));
  ck('Farm shows actual renewals AND unlimited',
    has(rm, '18 renewed') && has(rm, 'Unlimited'), lines(rm).join(' | '));
  ck('Farm renders no fake numeric limit',
    !lines(lm).concat(lines(rm)).some((v) => /999999|-1\b|of 0\b/.test(v)));
  ck('Farm is never in an exhausted state', lm.exhausted === false && rm.exhausted === false);
  ck('Farm offers no paid overage', A.exhaustedHint(r, 'listings') === null
    && A.exhaustedHint(r, 'renewals') === null);
  ck('Farm offers no upgrade — it is the top plan', A.upgradeHint(r) === null);
}

// ---- cross-cutting -------------------------------------------------------
ck('reset date comes from the server period_end',
  A.resetLabel({ period_end: '2026-09-16T04:00:00Z' }) === 'Resets Sep 16',
  A.resetLabel({ period_end: '2026-09-16T04:00:00Z' }));
ck('Free reset date reads Sep 1',
  A.resetLabel({ period_end: '2026-09-01T04:00:00Z' }) === 'Resets Sep 1');
ck('an unparseable period_end degrades to empty, not "Invalid Date"',
  A.resetLabel({ period_end: 'nonsense' }) === '');

// The enum must never appear. Render every plan and scan the whole output.
{
  const all = [row({}), PRO({}), MAX({}), FARM({ publishes_actual: 1, renewals_actual: 1 })]
    .flatMap((r) => lines(A.listingsMeter(r)).concat(lines(A.renewalsMeter(r))).concat([r.display_name]));
  ck('no internal enum name reaches the seller UI',
    !all.some((v) => /\b(grower|sponsor)\b/i.test(v)) && !all.some((v) => /^farm$/.test(v)),
    all.filter((v) => /grower|sponsor/i.test(v)).join(','));
  ck('display names are the customer-facing four',
    ['Free', 'Pro', 'Max', 'Farm'].every((n) => Object.keys(A.NEXT_PLAN).includes(n)));
}
ck('planDisplay maps every enum, including the counter-intuitive two',
  A.planDisplay('free') === 'Free' && A.planDisplay('grower') === 'Pro'
  && A.planDisplay('farm') === 'Max' && A.planDisplay('sponsor') === 'Farm');
ck('planDisplay never emits a raw enum for an unknown value', A.planDisplay('mystery') === 'Free');

const failed = results.filter((r) => !r.ok).length;
console.log(`\nallowance card: ${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
