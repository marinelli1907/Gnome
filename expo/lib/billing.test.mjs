// The reconciliation decision core for mobile $0.99 checkout.
//
//   node expo/lib/billing.test.mjs
//
// The full round trip (Stripe hosted page, webhook, authorization consumption) is proven at the
// DB layer by promotions_suite.sql and end-to-end in the deployed test-mode verification; what
// lives here is the client's DECISION function — the piece that decides whether a seller is told
// "publish now", "wait a moment", or "nothing was charged", and which must never invent a fourth
// answer like "pay again".
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'billing-'));
// Extract the pure function without dragging in expo-web-browser / supabase imports.
const src = readFileSync(join(HERE, 'billing.ts'), 'utf8');
const start = src.indexOf('export function overageOutcome');
const end = src.indexOf('async function fetchOverage');
writeFileSync(join(tmp, 'core.ts'), src.slice(start, end));
execFileSync('npx', ['--yes', 'esbuild@0.23.0', join(tmp, 'core.ts'),
  '--format=esm', '--target=es2022', `--outfile=${join(tmp, 'core.mjs')}`], { stdio: 'pipe' });
const { overageOutcome } = await import(join(tmp, 'core.mjs'));

const results = [];
const ck = (name, got, want) => {
  const ok = got === want;
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  — got ${got}, want ${want}`}`);
};
const row = (required, reason) => ({ required, intent: 'publish', reason, product_key: 'GNOME_LISTING_PUBLISH' });

console.log('\nmobile overage reconciliation\n');

// Payment confirmed by the SERVER: publish proceeds, regardless of what the browser claimed.
ck('webhook landed + success return → paid', overageOutcome(row(false, 'ALREADY_AUTHORIZED'), true), 'paid');
ck('webhook landed + user closed browser early → still paid', overageOutcome(row(false, 'ALREADY_AUTHORIZED'), false), 'paid');
ck('webhook landed before app even reopened → paid', overageOutcome(row(false, 'ALREADY_AUTHORIZED'), false), 'paid');

// Payment became unnecessary mid-checkout (upgrade, period reset): retry free, never charge.
ck('upgrade mid-checkout → not_needed', overageOutcome(row(false, 'ALLOWANCE_REMAINING'), true), 'not_needed');
ck('period reset mid-checkout → not_needed', overageOutcome(row(false, 'ALLOWANCE_REMAINING'), false), 'not_needed');
ck('plan became unlimited → not_needed', overageOutcome(row(false, 'UNLIMITED'), true), 'not_needed');

// Still owed: the browser return is the only tiebreaker, and it can only ever mean WAIT.
ck('success return, webhook delayed → pending (never a second charge)', overageOutcome(row(true, 'ALLOWANCE_EXHAUSTED'), true), 'pending');
ck('cancel return → cancelled, nothing charged', overageOutcome(row(true, 'ALLOWANCE_EXHAUSTED'), false), 'cancelled');
ck('browser dismissed without redirect → cancelled', overageOutcome(row(true, 'ALLOWANCE_EXHAUSTED'), false), 'cancelled');

// Failure is failure.
ck('RPC unavailable → error, not a paywall and not a publish', overageOutcome(null, true), 'error');

// Replay: a consumed authorization leaves required=true again — a duplicate success return must
// resolve to pending/limit, never to a phantom second paid state.
ck('duplicate success return after consumption → pending', overageOutcome(row(true, 'ALLOWANCE_EXHAUSTED'), true), 'pending');

const failed = results.filter((r) => !r).length;
console.log(`\nbilling reconcile: ${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
