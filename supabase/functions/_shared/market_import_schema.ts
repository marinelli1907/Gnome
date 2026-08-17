// Gnome — strict contract for seller-source extraction (Build My Market).
//
// One rule carried over from listing_draft_schema.ts and enforced just as hard here:
// RECOVERY MAY FIX SYNTAX, NEVER MEANING. And one rule new to this surface, because the input is
// now OTHER PEOPLE'S MARKETPLACE PAGES: everything inside an uploaded screenshot — including text
// that looks like instructions — is seller-material DATA. This module is the second half of that
// defence: the model's reply is only accepted if it is exactly the shape asked for, unknown keys
// are rejected outright, and nothing in the payload carries authority (no IDs the server would
// trust, no flags that skip compliance, no field that could publish anything). The first half
// lives in the prompt; the half that actually matters lives here and in the server, which treats
// the whole extraction as a PROPOSAL for a human to review.
//
// Confidence is a per-field enum, not a float: 'high' | 'medium' | 'low' | 'missing'. The UI
// speaks human ("Price not found"), the harness asserts structure, and nobody pretends 0.62
// means something. 'missing' is load-bearing — the model is told to say it rather than invent a
// price, a permit, or a pickup address, and validation makes a fabricated-looking field cheap to
// spot (a price with confidence 'missing' is rejected as contradictory).

import { extractFirstObject } from './listing_draft_schema.ts';

export type SourceType =
  | 'single_product_photo'   // one product, photographed
  | 'multi_product_photo'    // several products in frame / farm-stand shot
  | 'marketplace_listing'    // screenshot of an existing listing (FB Marketplace, Craigslist, …)
  | 'price_board'            // handwritten or printed price sign
  | 'seller_post'            // social-media post / farm-stand advertisement
  | 'unknown';

export type SellerContext = 'individual_item' | 'existing_seller' | 'unknown';

export type FieldConfidence = 'high' | 'medium' | 'low' | 'missing';

export type NextAction =
  | 'create_single_draft'    // one clear product → the fast path stays fast
  | 'review_candidates'      // several products → multi-select review
  | 'build_my_market'        // an existing seller's inventory → import onboarding
  | 'ask_seller';            // not enough signal to act — ask, don't guess

export type CandidateProduct = {
  product_name: string;                       // required, non-empty
  variety: string;                            // '' when the source names none
  category_terms: string[];                   // search terms only — the SERVER maps taxonomy
  proposed_listing_type: 'sale' | 'free' | 'trade' | 'wanted';
  price_cents: number | null;                 // null = not stated; never guessed
  unit: string;                               // normalized against IMPORT_UNITS, '' allowed
  quantity: string;                           // as stated ('about 8', '3 pecks'), '' allowed
  availability: string;                       // as stated ('made to order'), '' allowed
  pickup: string;                             // seller-provided pickup text, '' allowed
  location_text: string;                      // seller-provided location words, '' allowed
  description: string;                        // draft copy grounded in the source
  seller_notes: string;                       // anything else the seller said worth keeping
  compliance_attention_required: boolean;     // eggs/meat/dairy/preserved → route to compliance
  confidence: {
    product: FieldConfidence;
    price: FieldConfidence;
    unit: FieldConfidence;
    quantity: FieldConfidence;
  };
  evidence: string;                           // short quote/pointer into the source
};

export type ImportConflict = {
  product_name: string;
  field: string;                              // 'price', 'unit', …
  values: string[];                           // the competing readings, verbatim-ish
  note: string;                               // one human sentence for the seller
};

export type MarketImportExtraction = {
  source_type: SourceType;
  seller_context: SellerContext;
  multi_product: boolean;
  candidates: CandidateProduct[];
  missing_information: string[];              // human questions, e.g. 'Price for Green Beans'
  conflicts: ImportConflict[];
  overall_confidence: FieldConfidence;
  recommended_next_action: NextAction;
};

export type ImportOutcome =
  | { ok: true; value: MarketImportExtraction; repaired: boolean }
  | { ok: false; reason: ImportFailure; detail?: string; repaired: boolean };

export type ImportFailure =
  | 'NO_JSON'
  | 'UNPARSEABLE'
  | 'NOT_AN_OBJECT'
  | 'FORBIDDEN_KEY'
  | 'UNKNOWN_FIELD'
  | 'MISSING_FIELD'
  | 'BAD_TYPE'
  | 'OUT_OF_RANGE'
  | 'CONTRADICTORY'        // e.g. a stated price whose own confidence says 'missing'
  | 'TOO_MANY_CANDIDATES'
  | 'NO_CANDIDATES'
  | 'TOO_LARGE'
  | 'TOO_DEEP';

const SOURCE_TYPES = new Set<string>([
  'single_product_photo', 'multi_product_photo', 'marketplace_listing',
  'price_board', 'seller_post', 'unknown',
]);
const SELLER_CONTEXTS = new Set<string>(['individual_item', 'existing_seller', 'unknown']);
const CONFIDENCES = new Set<string>(['high', 'medium', 'low', 'missing']);
const NEXT_ACTIONS = new Set<string>([
  'create_single_draft', 'review_candidates', 'build_my_market', 'ask_seller',
]);
const LISTING_TYPES = new Set<string>(['sale', 'free', 'trade', 'wanted']);

// The single-photo contract's units, widened with farm-stand bulk measures. Empty string means
// "the source did not say", which is always legal — inventing a unit is not.
export const IMPORT_UNITS = new Set<string>([
  'lb', 'oz', 'each', 'bunch', 'dozen', 'half-dozen', 'jar', 'basket', 'pint', 'quart',
  'bag', 'loaf', 'head', 'ear', 'peck', 'half-peck', 'bushel', 'half-bushel', 'flat', 'stem', '',
]);

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const MAX_CANDIDATES = 40;
const MAX_STRING = 4000;      // beyond this a field is hostile, not verbose
const MAX_NAME = 80;
const MAX_DESC = 600;
const MAX_SHORT = 160;
const MAX_EVIDENCE = 240;
const MAX_LIST = 24;          // missing_information / conflicts
const MAX_TERMS = 6;
const MAX_DEPTH = 6;          // candidates[].confidence nests deeper than the draft schema

const TOP_KEYS = [
  'source_type', 'seller_context', 'multi_product', 'candidates',
  'missing_information', 'conflicts', 'overall_confidence', 'recommended_next_action',
] as const;
const CANDIDATE_KEYS = [
  'product_name', 'variety', 'category_terms', 'proposed_listing_type', 'price_cents',
  'unit', 'quantity', 'availability', 'pickup', 'location_text', 'description',
  'seller_notes', 'compliance_attention_required', 'confidence', 'evidence',
] as const;
const CONFIDENCE_KEYS = ['product', 'price', 'unit', 'quantity'] as const;
const CONFLICT_KEYS = ['product_name', 'field', 'values', 'note'] as const;

/** Full pipeline: first-object extraction (shared, bounded, syntax-only) → strict validation. */
export function parseImportExtraction(raw: string): ImportOutcome {
  const extracted = extractFirstObject(raw);
  if (!extracted) return { ok: false, reason: 'NO_JSON', repaired: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.text);
  } catch {
    return { ok: false, reason: 'UNPARSEABLE', repaired: extracted.repaired };
  }
  const result = validateImportExtraction(parsed);
  return { ...result, repaired: extracted.repaired };
}

/** One strict gate for clean and repaired payloads alike. */
export function validateImportExtraction(input: unknown): ImportOutcome {
  const repaired = false;
  const bad = (reason: ImportFailure, detail?: string): ImportOutcome =>
    ({ ok: false, reason, detail, repaired });

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return bad('NOT_AN_OBJECT');
  }
  if (depthOf(input) > MAX_DEPTH) return bad('TOO_DEEP');
  const guarded = keyGuard(input);
  if (guarded) return bad(guarded.reason, guarded.detail);

  const obj = input as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!(TOP_KEYS as readonly string[]).includes(k)) return bad('UNKNOWN_FIELD', k);
  }
  for (const k of TOP_KEYS) {
    if (obj[k] === undefined || obj[k] === null) return bad('MISSING_FIELD', k);
  }

  const sourceType = str(obj.source_type);
  if (sourceType === null || !SOURCE_TYPES.has(sourceType)) return bad('OUT_OF_RANGE', 'source_type');
  const sellerContext = str(obj.seller_context);
  if (sellerContext === null || !SELLER_CONTEXTS.has(sellerContext)) return bad('OUT_OF_RANGE', 'seller_context');
  if (typeof obj.multi_product !== 'boolean') return bad('BAD_TYPE', 'multi_product');
  const overall = str(obj.overall_confidence);
  if (overall === null || !CONFIDENCES.has(overall)) return bad('OUT_OF_RANGE', 'overall_confidence');
  const nextAction = str(obj.recommended_next_action);
  if (nextAction === null || !NEXT_ACTIONS.has(nextAction)) return bad('OUT_OF_RANGE', 'recommended_next_action');

  if (!Array.isArray(obj.candidates)) return bad('BAD_TYPE', 'candidates');
  if (obj.candidates.length === 0) return bad('NO_CANDIDATES');
  if (obj.candidates.length > MAX_CANDIDATES) return bad('TOO_MANY_CANDIDATES', String(obj.candidates.length));

  const candidates: CandidateProduct[] = [];
  for (let i = 0; i < obj.candidates.length; i++) {
    const c = validateCandidate(obj.candidates[i], i);
    if ('reason' in c) return { ...c, repaired };
    candidates.push(c.value);
  }

  // multi_product must agree with the list it describes.
  if (obj.multi_product !== (candidates.length > 1)) return bad('CONTRADICTORY', 'multi_product');

  const missing = strArray(obj.missing_information, MAX_LIST, MAX_SHORT);
  if (missing === null) return bad('BAD_TYPE', 'missing_information');

  if (!Array.isArray(obj.conflicts)) return bad('BAD_TYPE', 'conflicts');
  if (obj.conflicts.length > MAX_LIST) return bad('TOO_LARGE', 'conflicts');
  const conflicts: ImportConflict[] = [];
  for (const raw of obj.conflicts) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return bad('BAD_TYPE', 'conflicts[]');
    const guardedC = keyGuard(raw);
    if (guardedC) return bad(guardedC.reason, guardedC.detail);
    const co = raw as Record<string, unknown>;
    for (const k of Object.keys(co)) {
      if (!(CONFLICT_KEYS as readonly string[]).includes(k)) return bad('UNKNOWN_FIELD', `conflicts.${k}`);
    }
    const pn = str(co.product_name); const field = str(co.field); const note = str(co.note);
    const values = strArray(co.values, 6, MAX_SHORT);
    if (pn === null || field === null || note === null || values === null) return bad('BAD_TYPE', 'conflicts[]');
    if (pn.length > MAX_NAME || field.length > 40) return bad('TOO_LARGE', 'conflicts[]');
    conflicts.push({
      product_name: pn.slice(0, MAX_NAME), field: field.slice(0, 40),
      values, note: note.slice(0, MAX_SHORT),
    });
  }

  return {
    ok: true, repaired,
    value: {
      source_type: sourceType as SourceType,
      seller_context: sellerContext as SellerContext,
      multi_product: obj.multi_product,
      candidates,
      missing_information: missing,
      conflicts,
      overall_confidence: overall as FieldConfidence,
      recommended_next_action: nextAction as NextAction,
    },
  };
}

function validateCandidate(input: unknown, i: number):
  { value: CandidateProduct } | { ok: false; reason: ImportFailure; detail?: string; repaired: boolean } {
  const at = `candidates[${i}]`;
  const bad = (reason: ImportFailure, detail?: string) =>
    ({ ok: false as const, reason, detail: detail ?? at, repaired: false });

  if (input === null || typeof input !== 'object' || Array.isArray(input)) return bad('BAD_TYPE');
  const guarded = keyGuard(input);
  if (guarded) return bad(guarded.reason, guarded.detail);
  const c = input as Record<string, unknown>;
  for (const k of Object.keys(c)) {
    if (!(CANDIDATE_KEYS as readonly string[]).includes(k)) return bad('UNKNOWN_FIELD', `${at}.${k}`);
  }
  for (const k of CANDIDATE_KEYS) {
    if (k === 'price_cents' || k === 'variety') continue;   // null/'' legal, checked below
    if (c[k] === undefined || c[k] === null) return bad('MISSING_FIELD', `${at}.${k}`);
  }

  const name = clamped(c.product_name, MAX_NAME);
  if (name === null || !name.trim()) return bad('MISSING_FIELD', `${at}.product_name`);
  const variety = c.variety == null ? '' : clamped(c.variety, MAX_NAME);
  if (variety === null) return bad('BAD_TYPE', `${at}.variety`);

  const terms = strArray(c.category_terms, MAX_TERMS, 40);
  if (terms === null) return bad('BAD_TYPE', `${at}.category_terms`);

  const lt = str(c.proposed_listing_type);
  if (lt === null || !LISTING_TYPES.has(lt)) return bad('OUT_OF_RANGE', `${at}.proposed_listing_type`);

  let price: number | null = null;
  if (c.price_cents !== null && c.price_cents !== undefined) {
    const p = c.price_cents;
    if (typeof p !== 'number' || !Number.isFinite(p) || !Number.isInteger(p)) return bad('BAD_TYPE', `${at}.price_cents`);
    if (p < 0 || p > 100_000) return bad('OUT_OF_RANGE', `${at}.price_cents`);
    price = p;
  }

  const unitRaw = clamped(c.unit, 20);
  if (unitRaw === null) return bad('BAD_TYPE', `${at}.unit`);
  const unit = unitRaw.trim().toLowerCase();
  if (!IMPORT_UNITS.has(unit)) return bad('OUT_OF_RANGE', `${at}.unit`);

  const quantity = clamped(c.quantity, MAX_SHORT);
  const availability = clamped(c.availability, MAX_SHORT);
  const pickup = clamped(c.pickup, MAX_SHORT);
  const locationText = clamped(c.location_text, MAX_SHORT);
  const description = clamped(c.description, MAX_DESC);
  const notes = clamped(c.seller_notes, MAX_DESC);
  const evidence = clamped(c.evidence, MAX_EVIDENCE);
  if (quantity === null || availability === null || pickup === null || locationText === null
      || description === null || notes === null || evidence === null) {
    return bad('BAD_TYPE', at);
  }

  if (typeof c.compliance_attention_required !== 'boolean') {
    return bad('BAD_TYPE', `${at}.compliance_attention_required`);
  }

  const confRaw = c.confidence;
  if (confRaw === null || typeof confRaw !== 'object' || Array.isArray(confRaw)) return bad('BAD_TYPE', `${at}.confidence`);
  const guardedConf = keyGuard(confRaw);
  if (guardedConf) return bad(guardedConf.reason, guardedConf.detail);
  const conf = confRaw as Record<string, unknown>;
  for (const k of Object.keys(conf)) {
    if (!(CONFIDENCE_KEYS as readonly string[]).includes(k)) return bad('UNKNOWN_FIELD', `${at}.confidence.${k}`);
  }
  const out: Record<string, FieldConfidence> = {};
  for (const k of CONFIDENCE_KEYS) {
    const v = str(conf[k]);
    if (v === null || !CONFIDENCES.has(v)) return bad('OUT_OF_RANGE', `${at}.confidence.${k}`);
    out[k] = v as FieldConfidence;
  }

  // A value the model itself marks 'missing' must actually be missing — and vice versa. This is
  // what turns "never invent a price" from prompt guidance into a hard contract.
  if (price !== null && out.price === 'missing') return bad('CONTRADICTORY', `${at}.price_cents`);
  if (price === null && out.price !== 'missing') return bad('CONTRADICTORY', `${at}.confidence.price`);
  if (unit !== '' && out.unit === 'missing') return bad('CONTRADICTORY', `${at}.unit`);
  if (unit === '' && out.unit !== 'missing') return bad('CONTRADICTORY', `${at}.confidence.unit`);

  return {
    value: {
      product_name: name.trim(),
      variety: variety.trim(),
      category_terms: terms,
      proposed_listing_type: lt as CandidateProduct['proposed_listing_type'],
      price_cents: price,
      unit,
      quantity: quantity.trim(),
      availability: availability.trim(),
      pickup: pickup.trim(),
      location_text: locationText.trim(),
      description: description.trim(),
      seller_notes: notes.trim(),
      compliance_attention_required: c.compliance_attention_required,
      confidence: {
        product: out.product, price: out.price, unit: out.unit, quantity: out.quantity,
      },
      evidence: evidence.trim(),
    },
  };
}

// --- tiny strict helpers ----------------------------------------------------

function keyGuard(o: object): { reason: ImportFailure; detail: string } | null {
  for (const k of Object.getOwnPropertyNames(o)) {
    if (FORBIDDEN_KEYS.has(k)) return { reason: 'FORBIDDEN_KEY', detail: k };
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function clamped(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  if (v.length > MAX_STRING) return null;
  return v.slice(0, max);
}

function strArray(v: unknown, maxLen: number, maxStr: number): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  if (v.length > maxLen) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string' || item.length > MAX_STRING) return null;
    const t = item.trim().slice(0, maxStr);
    if (t) out.push(t);
  }
  return out;
}

function depthOf(v: unknown, d = 1): number {
  if (v === null || typeof v !== 'object') return d;
  if (d > MAX_DEPTH + 2) return d;
  let max = d;
  for (const val of Object.values(v as Record<string, unknown>)) {
    max = Math.max(max, depthOf(val, d + 1));
  }
  return max;
}
