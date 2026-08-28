// Gnome — strict schema + bounded, syntax-only recovery for vision output.
//
// The rule this file exists to enforce: RECOVERY MAY FIX SYNTAX, NEVER MEANING.
// A truncated reply is a damaged reply. We will re-close brackets that the
// model ran out of tokens to write, but we will not finish its sentence, guess
// a price, or supply a field it never sent. Anything that survives recovery is
// then put through EXACTLY the same strict validation as a clean reply, so a
// repaired object and a pristine object are held to one standard.
//
// Consequences, on purpose:
//   * a value cut off mid-way is DROPPED, not completed — so it fails the
//     required-field check and the image is retried or skipped;
//   * unknown keys are rejected outright (an injected key is not "extra data",
//     it is a signal the payload is not what we asked for);
//   * __proto__ / constructor / prototype are rejected before anything touches
//     an object literal;
//   * only the FIRST complete top-level object is considered, so "valid object
//     followed by instructions" cannot smuggle a second payload;
//   * nothing here publishes. The caller writes a DRAFT and a human approves.

export type DraftCandidate = {
  candidate_name: string;
  confidence: number;
  alternatives: string[];
  suggested_title: string;
  suggested_description: string;
  taxonomy_search_terms: string[];
  suggested_unit: string;
  suggested_price_cents: number | null;
  suggested_listing_type: 'sale' | 'free' | 'trade';
  possible_quantity: string;
  compliance_attention_required: boolean;
  seller_questions: string[];
};

export type DraftOutcome =
  | { ok: true; value: DraftCandidate; repaired: boolean }
  | { ok: false; reason: DraftFailure; detail?: string; repaired: boolean };

export type DraftFailure =
  | 'NO_JSON'            // nothing object-shaped in the reply
  | 'UNPARSEABLE'        // not JSON even after bounded repair
  | 'NOT_AN_OBJECT'
  | 'FORBIDDEN_KEY'      // prototype-pollution attempt
  | 'UNKNOWN_FIELD'      // not part of the contract
  | 'MISSING_FIELD'      // required field absent (often: truncated away)
  | 'BAD_TYPE'
  | 'OUT_OF_RANGE'
  | 'TOO_LARGE'          // absurd string / nesting — treat as hostile, not clamp
  | 'TOO_DEEP';

// Exactly the contract asked for in the prompt. Anything else is rejected.
const ALLOWED_KEYS = [
  'candidate_name', 'confidence', 'alternatives', 'suggested_title',
  'suggested_description', 'taxonomy_search_terms', 'suggested_unit',
  'suggested_price_cents', 'suggested_listing_type', 'possible_quantity',
  'compliance_attention_required', 'seller_questions',
] as const;
const ALLOWED = new Set<string>(ALLOWED_KEYS);

// Fields without which a draft is not a draft. A truncated reply loses its tail
// first, so this is what actually catches "the model ran out of room".
const REQUIRED = [
  'candidate_name', 'confidence', 'suggested_title', 'suggested_description',
  'suggested_listing_type', 'compliance_attention_required',
] as const;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const LISTING_TYPES = new Set(['sale', 'free', 'trade']);
const UNITS = new Set(['lb', 'oz', 'each', 'bunch', 'dozen', 'jar', 'basket', 'pint', 'quart', 'bag', '']);

const MAX_STRING = 4000;   // beyond this the payload is hostile, not verbose
const MAX_DESC = 600;
const MAX_TITLE = 80;
const MAX_DEPTH = 4;
const MAX_ARRAY = 12;

/** Full pipeline: strict parse → bounded syntax repair → strict validation. */
export function parseDraft(raw: string): DraftOutcome {
  const extracted = extractFirstObject(raw);
  if (!extracted) return { ok: false, reason: 'NO_JSON', repaired: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.text);
  } catch {
    return { ok: false, reason: 'UNPARSEABLE', repaired: extracted.repaired };
  }
  const result = validateDraft(parsed);
  return result.ok
    ? { ...result, repaired: extracted.repaired }
    : { ...result, repaired: extracted.repaired };
}

/**
 * Find the FIRST complete top-level object. If the reply was cut off, rewind to
 * the last position where a value had definitively finished and close the
 * containers that were still open. Never invents characters inside a value:
 * an unterminated string is discarded along with its key, not completed.
 */
export function extractFirstObject(raw: string): { text: string; repaired: boolean } | null {
  const cleaned = String(raw ?? '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  if (start < 0) return null;

  const stack: string[] = [];       // '{' or '[' — what we are inside of
  let inStr = false;
  let esc = false;
  // A string is only a safe cut point when it is a VALUE. Cutting after a KEY
  // leaves `{"a":"b","c"` — syntactically broken and, worse, a key with no
  // value. Track whether the parser is currently expecting a value.
  let awaitingValue = false;
  // Index (exclusive) just past the last point where a value was complete and
  // the structure was consistent — our only safe rewind target.
  let safeCut = -1;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === '\\') esc = true;
      else if (ch === '"') {
        inStr = false;
        if (awaitingValue && stack.length) { safeCut = i + 1; awaitingValue = false; }
      }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') {
      stack.push(ch);
      awaitingValue = ch === '[';     // arrays hold values; objects expect a key
      continue;
    }
    if (ch === '}' || ch === ']') {
      stack.pop();
      if (!stack.length) {
        // First complete top-level object. Anything after it is ignored on
        // purpose — a second object or trailing prose cannot influence us.
        return { text: cleaned.slice(start, i + 1), repaired: false };
      }
      safeCut = i + 1;
      awaitingValue = false;
      continue;
    }
    if (ch === ':') { awaitingValue = true; continue; }
    if (ch === ',') {
      safeCut = i;                                          // cut BEFORE the comma
      awaitingValue = stack[stack.length - 1] === '[';
      continue;
    }
    // Literals (number/true/false/null) are only trustworthy once a ',' or a
    // closing bracket proves they ended — handled by the branches above.
  }

  // Ran out of input: the reply was truncated.
  if (safeCut <= start) return null;                        // nothing trustworthy
  let text = cleaned.slice(start, safeCut).replace(/,\s*$/, '');
  // Drop a dangling `"key":` whose value never arrived.
  text = text.replace(/,?\s*"[^"]*"\s*:\s*$/, '');
  // Re-close only what is still open, in the right order.
  const reopen: string[] = [];
  let s2 = false, e2 = false;
  for (const ch of text) {
    if (e2) { e2 = false; continue; }
    if (s2) { if (ch === '\\') e2 = true; else if (ch === '"') s2 = false; continue; }
    if (ch === '"') { s2 = true; continue; }
    if (ch === '{') reopen.push('}');
    else if (ch === '[') reopen.push(']');
    else if (ch === '}' || ch === ']') reopen.pop();
  }
  if (s2) return null;                                      // still inside a string: untrustworthy
  while (reopen.length) text += reopen.pop();
  return { text, repaired: true };
}

/** The one strict gate. Applied identically to clean and repaired payloads. */
export function validateDraft(input: unknown): DraftOutcome {
  const repaired = false;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'NOT_AN_OBJECT', repaired };
  }
  if (depthOf(input) > MAX_DEPTH) return { ok: false, reason: 'TOO_DEEP', repaired };

  // Prototype-pollution keys are checked on raw own-property names, before any
  // spread or assignment could act on them.
  for (const k of Object.getOwnPropertyNames(input)) {
    if (FORBIDDEN_KEYS.has(k)) return { ok: false, reason: 'FORBIDDEN_KEY', detail: k, repaired };
  }
  const obj = input as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!ALLOWED.has(k)) return { ok: false, reason: 'UNKNOWN_FIELD', detail: k, repaired };
  }
  for (const k of REQUIRED) {
    if (obj[k] === undefined || obj[k] === null) return { ok: false, reason: 'MISSING_FIELD', detail: k, repaired };
  }

  const bad = (reason: DraftFailure, detail: string): DraftOutcome => ({ ok: false, reason, detail, repaired });

  // --- strings -------------------------------------------------------------
  const strField = (k: string, max: number, required: boolean): string | DraftOutcome => {
    const v = obj[k];
    if (v === undefined) return required ? bad('MISSING_FIELD', k) : '';
    if (typeof v !== 'string') return bad('BAD_TYPE', k);
    if (v.length > MAX_STRING) return bad('TOO_LARGE', k);
    return v.trim().slice(0, max);
  };
  const name = strField('candidate_name', MAX_TITLE, true);
  if (typeof name !== 'string') return name;
  const title = strField('suggested_title', MAX_TITLE, true);
  if (typeof title !== 'string') return title;
  const desc = strField('suggested_description', MAX_DESC, true);
  if (typeof desc !== 'string') return desc;
  const qty = strField('possible_quantity', 60, false);
  if (typeof qty !== 'string') return qty;
  const unitRaw = strField('suggested_unit', 20, false);
  if (typeof unitRaw !== 'string') return unitRaw;
  if (!title) return bad('MISSING_FIELD', 'suggested_title');

  const unit = unitRaw.toLowerCase();
  if (!UNITS.has(unit)) return bad('OUT_OF_RANGE', 'suggested_unit');

  // --- confidence ----------------------------------------------------------
  const conf = obj.confidence;
  if (typeof conf !== 'number' || !Number.isFinite(conf)) return bad('BAD_TYPE', 'confidence');
  if (conf < 0 || conf > 1) return bad('OUT_OF_RANGE', 'confidence');

  // --- listing type + price ------------------------------------------------
  const lt = obj.suggested_listing_type;
  if (typeof lt !== 'string' || !LISTING_TYPES.has(lt)) return bad('OUT_OF_RANGE', 'suggested_listing_type');

  let price: number | null = null;
  if (lt === 'sale') {
    const p = obj.suggested_price_cents;
    if (p === undefined || p === null) return bad('MISSING_FIELD', 'suggested_price_cents');
    if (typeof p !== 'number' || !Number.isFinite(p)) return bad('BAD_TYPE', 'suggested_price_cents');
    if (!Number.isInteger(p)) return bad('BAD_TYPE', 'suggested_price_cents');
    if (p < 0 || p > 100_000) return bad('OUT_OF_RANGE', 'suggested_price_cents');
    price = p;
  } else if (obj.suggested_price_cents != null) {
    // A price on a free/trade listing is a contradiction, not a rounding error.
    return bad('OUT_OF_RANGE', 'suggested_price_cents');
  }

  // --- regulated flag: strict boolean, never coerced -----------------------
  const flag = obj.compliance_attention_required;
  if (typeof flag !== 'boolean') return bad('BAD_TYPE', 'compliance_attention_required');

  // --- arrays --------------------------------------------------------------
  const arrField = (k: string, maxItem: number): string[] | DraftOutcome => {
    const v = obj[k];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) return bad('BAD_TYPE', k);
    if (v.length > MAX_ARRAY) return bad('TOO_LARGE', k);
    const out: string[] = [];
    for (const item of v) {
      if (typeof item !== 'string') return bad('BAD_TYPE', k);
      if (item.length > MAX_STRING) return bad('TOO_LARGE', k);
      const t = item.trim().slice(0, maxItem);
      if (t) out.push(t);
    }
    return out;
  };
  const alternatives = arrField('alternatives', 60);
  if (!Array.isArray(alternatives)) return alternatives;
  const terms = arrField('taxonomy_search_terms', 40);
  if (!Array.isArray(terms)) return terms;
  const questions = arrField('seller_questions', 120);
  if (!Array.isArray(questions)) return questions;

  return {
    ok: true,
    repaired,
    value: {
      candidate_name: name,
      confidence: conf,
      alternatives,
      suggested_title: title,
      suggested_description: desc,
      taxonomy_search_terms: terms,
      suggested_unit: unit,
      suggested_price_cents: price,
      suggested_listing_type: lt as 'sale' | 'free' | 'trade',
      possible_quantity: qty,
      compliance_attention_required: flag,
      seller_questions: questions,
    },
  };
}

function depthOf(v: unknown, d = 1): number {
  if (v === null || typeof v !== 'object') return d;
  if (d > MAX_DEPTH + 2) return d;                 // stop early; caller rejects
  let max = d;
  for (const val of Object.values(v as Record<string, unknown>)) {
    max = Math.max(max, depthOf(val, d + 1));
  }
  return max;
}
