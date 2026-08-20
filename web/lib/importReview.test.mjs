// Parity + semantics for the Build My Market review module.
//
//   node web/lib/importReview.test.mjs
//
// Web and Expo must MEAN the same thing. The cheapest possible drift-proof comes first: the two
// files are byte-identical twins, asserted here — a divergence fails before any behavior runs.
// The behavior cases then pin the sentences: human words for missing fields, honest plan-aware
// summaries built only from server numbers, and a create-payload that can never smuggle an
// unknown key to the server.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, 'importReview.ts');
const EXPO = join(HERE, '../../expo/lib/importReview.ts');

let n = 0, failed = 0;
function ck(name, ok, detail = '') {
  n++;
  if (!ok) failed++;
  console.log(`  ${String(n).padStart(3)}  ${name}  ${ok ? 'PASS' : `FAIL  ${detail}`}`);
}

const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex');
ck('web and expo modules are byte-identical twins', md5(WEB) === md5(EXPO),
  `${md5(WEB)} vs ${md5(EXPO)}`);

const tmp = mkdtempSync(join(tmpdir(), 'ir-'));
copyFileSync(WEB, join(tmp, 'importReview.ts'));
execFileSync('npx', ['--yes', 'esbuild@0.23.0', join(tmp, 'importReview.ts'),
  '--format=esm', '--target=es2022', `--outfile=${join(tmp, 'ir.mjs')}`], { stdio: 'pipe' });
const m = await import(join(tmp, 'ir.mjs'));

const cand = (over = {}) => ({
  product_name: 'Roma Tomatoes', variety: 'Roma', category_terms: ['tomato'],
  proposed_listing_type: 'sale', price_cents: 1200, unit: 'peck', quantity: '',
  availability: '', pickup: '', location_text: '', description: 'Fresh romas.',
  seller_notes: '', compliance_attention_required: false,
  confidence: { product: 'high', price: 'high', unit: 'high', quantity: 'missing' },
  evidence: 'x', ...over,
});
const rc = (over = {}, tax = [{ id: 'n1', path: 'produce/vegetables/tomatoes', name: 'Tomatoes', score: 6 }]) =>
  ({ candidate: cand(over), selected: true, taxonomy: tax });

// ---- price / issues ---------------------------------------------------------
ck('price renders as $12 / peck', m.priceLabel(cand()) === '$12 / peck', m.priceLabel(cand()));
ck('cents survive when they matter', m.priceLabel(cand({ price_cents: 75, unit: 'each' })) === '$0.75 / each',
  m.priceLabel(cand({ price_cents: 75, unit: 'each' })));
ck('no price renders as nothing, never $0', m.priceLabel(cand({ price_cents: null })) === '');

ck('a priced, categorized candidate has no issue chips', m.fieldIssues(rc()).length === 0,
  m.fieldIssues(rc()).join(','));
ck('a missing Sell price says so in words',
  m.fieldIssues(rc({ price_cents: null, unit: '', confidence: { product: 'high', price: 'missing', unit: 'missing', quantity: 'missing' } }))
    .includes('Price not found'));
ck('a price without a unit asks for the unit',
  m.fieldIssues(rc({ unit: '' })).includes('Unit not found'));
ck('an unresolved category asks for review',
  m.fieldIssues(rc({}, [])).includes('Category needs review'));
ck('no raw confidence numbers ever surface',
  !JSON.stringify(m.fieldIssues(rc({}, []))).match(/0\.\d/));

// ---- conflicts --------------------------------------------------------------
const conflicts = [{ product_name: 'Sourdough Bread', field: 'price', values: ['$10', '$12'],
  note: 'The description says $10 but the sign says $12.' }];
ck('conflicts match their candidate by name',
  m.conflictsFor(cand({ product_name: 'Sourdough' }), conflicts).length === 1);
ck('conflicts do not leak onto other candidates',
  m.conflictsFor(cand(), conflicts).length === 0);
ck('conflict headline speaks human', m.conflictHeadline(conflicts[0]) === 'Price needs confirmation');

// ---- category / duplicates / compliance ------------------------------------
ck('category renders as a breadcrumb', m.categoryLabel(rc()) === 'Produce › Vegetables › Tomatoes',
  m.categoryLabel(rc()));
ck('unresolved category renders the review nudge', m.categoryLabel(rc({}, [])) === 'Category needs review');
ck('duplicate warning names the product',
  m.duplicateLabel('Roma Tomatoes') === 'You already have a Roma Tomatoes listing.');
ck('compliance note stays neutral',
  !/(licensed|approved|certified|legal)/i.test(m.COMPLIANCE_NOTE), m.COMPLIANCE_NOTE);

// ---- selection --------------------------------------------------------------
const list = [rc(), rc({ product_name: 'Green Beans' }), { ...rc(), selected: false }];
ck('selected count follows the toggles', m.selectedCount(list) === 2);
ck('create button pluralizes', m.createButtonLabel(17) === 'Create 17 Drafts');
ck('create button handles one', m.createButtonLabel(1) === 'Create 1 Draft');
ck('empty selection disables in words', m.createButtonLabel(0) === 'Select products to import');
ck('result headline pluralizes', m.resultHeadline(17) === '17 drafts created' && m.resultHeadline(1) === '1 draft created');

// ---- plan-aware summary -----------------------------------------------------
const freeOver = m.allowanceSummary({ plan: 'free', publishes_allowed: 3, publishes_used: 0,
  publishes_remaining: 3, sale_candidates_selected: 17, exceeds_included_allowance: true });
ck('free-over-allowance names the plan and the honest number',
  freeOver.text.includes('Free plan includes 3 Sell publishes this month'), freeOver.text);
ck('free-over-allowance may suggest upgrading', freeOver.suggestUpgrade === true);
const freeOverNoExtras = m.allowanceSummary({ plan: 'free', publishes_allowed: 3, publishes_used: 0,
  publishes_remaining: 3, sale_candidates_selected: 17, exceeds_included_allowance: true },
  { canBuyExtras: false });
ck('free-over-allowance can suppress extra-publish price copy',
  !freeOverNoExtras.text.includes('$0.99') && freeOverNoExtras.text.includes('upgrade for unlimited Sell publishes'),
  freeOverNoExtras.text);
const proWithin = m.allowanceSummary({ plan: 'grower', publishes_allowed: 20, publishes_used: 0,
  publishes_remaining: 20, sale_candidates_selected: 17, exceeds_included_allowance: false });
ck('pro-within-allowance gets no upsell', proWithin.suggestUpgrade === false
  && proWithin.text.includes('20 included Sell publishes left this billing period'), proWithin.text);
const farm = m.allowanceSummary({ plan: 'farm', publishes_allowed: null, publishes_used: 0,
  publishes_remaining: null, sale_candidates_selected: 40, exceeds_included_allowance: false });
ck('unlimited renders as unlimited, never a number',
  farm.text.includes('unlimited') && !farm.text.match(/\d/), farm.text);
ck('enum names never reach the seller',
  ![freeOver, proWithin, farm].some((s) => /grower|sponsor/.test(s.text)));

// ---- limit copy -------------------------------------------------------------
ck('server limit message passes through',
  m.importLimitCopy('You’ve used today’s 15 imports — more tomorrow.').includes('15'));
ck('missing server message falls back to human copy, not a token',
  m.importLimitCopy(null).includes('Try again tomorrow'));

// ---- create payload hygiene -------------------------------------------------
const payload = m.toCreatePayload([
  { ...rc(), selected: true },
  { ...rc({ product_name: 'Skipped' }), selected: false },
]);
ck('only selected candidates travel', payload.length === 1 && payload[0].product_name === 'Roma Tomatoes');
const keys = Object.keys(payload[0]);
const allowed = ['product_name', 'variety', 'category_terms', 'listing_type', 'price_cents', 'unit',
  'quantity', 'availability', 'pickup', 'location_text', 'description', 'seller_notes',
  'compliance_attention_required'];
ck('payload carries ONLY server-allowed keys', keys.every((k) => allowed.includes(k)), keys.join(','));
ck('selection state and taxonomy suggestions never travel',
  !('selected' in payload[0]) && !('taxonomy' in payload[0]) && !('evidence' in payload[0]) && !('confidence' in payload[0]));

console.log('');
console.log(`import review: ${n - failed}/${n} passed`);
if (failed) process.exit(1);
