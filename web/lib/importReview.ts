// Shared semantics for the Build My Market review flow.
//
// PURE PRESENTATION + PAYLOAD SHAPING. The extraction and the created drafts are server truth;
// this module only decides which SENTENCE a state renders as and which fields are allowed to
// travel back to create_import_drafts. Web and Expo render different pixels but MUST mean the
// same thing, so this file has a byte-identical twin at expo/lib/importReview.ts and a parity
// test that transpiles both and compares them case by case (the allowance.ts pattern).
//
// Confidence stays an enum and stays backstage: sellers read "Price not found", never 0.62.

export type FieldConfidence = 'high' | 'medium' | 'low' | 'missing';

/** One candidate as market-import returns it (validated server-side before we ever see it). */
export type ImportCandidate = {
  product_name: string;
  variety: string;
  category_terms: string[];
  proposed_listing_type: 'sale' | 'free' | 'trade' | 'wanted';
  price_cents: number | null;
  unit: string;
  quantity: string;
  availability: string;
  pickup: string;
  location_text: string;
  description: string;
  seller_notes: string;
  compliance_attention_required: boolean;
  confidence: { product: FieldConfidence; price: FieldConfidence; unit: FieldConfidence; quantity: FieldConfidence };
  evidence: string;
};

export type ImportConflict = {
  product_name: string;
  field: string;
  values: string[];
  note: string;
};

export type TaxonomySuggestion = { id: string; path: string; name: string; score: number };

/** Client-side review state wrapped around a candidate. */
export type ReviewCandidate = {
  candidate: ImportCandidate;
  selected: boolean;
  /** server-resolved suggestions; [0] is the best. Empty = category needs review. */
  taxonomy: TaxonomySuggestion[];
};

// ---------------------------------------------------------------------------
// Money / units
// ---------------------------------------------------------------------------

export function priceLabel(c: ImportCandidate): string {
  if (c.price_cents == null) return '';
  const dollars = (c.price_cents / 100).toFixed(2).replace(/\.00$/, '');
  return c.unit ? `$${dollars} / ${c.unit}` : `$${dollars}`;
}

// ---------------------------------------------------------------------------
// Missing information — human words, only where they matter
// ---------------------------------------------------------------------------

/**
 * The short issue chips on a candidate card. Deliberately narrow: a chip must mean "you will
 * probably want to fix this", not "a field is empty" — 17 cards each shouting four grey chips
 * would bury the two that matter.
 */
export function fieldIssues(rc: ReviewCandidate): string[] {
  const c = rc.candidate;
  const issues: string[] = [];
  if (c.proposed_listing_type === 'sale' && c.price_cents == null) issues.push('Price not found');
  if (c.price_cents != null && !c.unit) issues.push('Unit not found');
  if (rc.taxonomy.length === 0) issues.push('Category needs review');
  return issues;
}

/** Conflicts for THIS candidate, matched the way the server names them. */
export function conflictsFor(c: ImportCandidate, conflicts: ImportConflict[]): ImportConflict[] {
  const name = c.product_name.toLowerCase();
  return conflicts.filter((k) => {
    const kn = k.product_name.toLowerCase();
    return kn === name || kn.includes(name) || name.includes(kn);
  });
}

export function conflictHeadline(k: ImportConflict): string {
  const field = k.field === 'price' ? 'Price' : k.field.charAt(0).toUpperCase() + k.field.slice(1);
  return `${field} needs confirmation`;
}

// ---------------------------------------------------------------------------
// Category display
// ---------------------------------------------------------------------------

/** "Vegetables › Tomatoes" from a taxonomy path, or the review nudge when unresolved. */
export function categoryLabel(rc: ReviewCandidate): string {
  const best = rc.taxonomy[0];
  if (!best) return 'Category needs review';
  return best.path
    .split('/')
    .map((seg) => seg.replace(/-/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()))
    .join(' › ');
}

// ---------------------------------------------------------------------------
// Duplicates & compliance
// ---------------------------------------------------------------------------

export function duplicateLabel(productName: string): string {
  return `You already have a ${productName} listing.`;
}

/** Neutral by design: never "licensed", "approved", "certified". */
export const COMPLIANCE_NOTE =
  'May require seller information or approval before publishing.';

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function selectedCount(list: ReviewCandidate[]): number {
  return list.filter((rc) => rc.selected).length;
}

export function createButtonLabel(count: number): string {
  if (count === 0) return 'Select products to import';
  return count === 1 ? 'Create 1 Draft' : `Create ${count} Drafts`;
}

export function resultHeadline(created: number): string {
  return created === 1 ? '1 draft created' : `${created} drafts created`;
}

// ---------------------------------------------------------------------------
// Plan-aware result — sentences over numbers, server numbers only
// ---------------------------------------------------------------------------

/** The allowance block create_import_drafts returns. NULL allowed/remaining = unlimited. */
export type ImportAllowance = {
  plan: string;                       // enum — display mapping happens HERE, never in UI code
  publishes_allowed: number | null;
  publishes_used: number;
  publishes_remaining: number | null;
  sale_candidates_selected: number;
  exceeds_included_allowance: boolean;
};

export const PLAN_DISPLAY: Record<string, string> = {
  free: 'Free', grower: 'Pro', farm: 'Farm', sponsor: 'Legacy Farm',
};
export const planDisplay = (plan?: string | null) => (plan && PLAN_DISPLAY[plan]) || 'Free';
export type PurchaseCopyOptions = { canBuyExtras?: boolean };
const canMentionExtras = (opts?: PurchaseCopyOptions) => opts?.canBuyExtras !== false;

/**
 * The sentence under "17 drafts created". Free sellers over their allowance learn the honest
 * arithmetic without a hard sell; sellers within allowance get no upsell at all.
 */
export function allowanceSummary(a: ImportAllowance, opts?: PurchaseCopyOptions): { text: string; suggestUpgrade: boolean } {
  if (a.publishes_allowed == null) {
    return { text: `Your ${planDisplay(a.plan)} plan includes unlimited Sell publishes.`, suggestUpgrade: false };
  }
  const period = a.plan === 'free' ? 'this month' : 'this billing period';
  if (a.exceeds_included_allowance) {
    const nextStep = canMentionExtras(opts)
      ? 'publish extras for $0.99 each'
      : 'upgrade for unlimited Sell publishes or wait for your allowance to reset';
    return {
      text: `Your ${planDisplay(a.plan)} plan includes ${a.publishes_allowed} Sell publishes ${period} — `
        + `choose which to publish first, or ${nextStep}.`,
      suggestUpgrade: a.plan === 'free',
    };
  }
  const remaining = a.publishes_remaining ?? a.publishes_allowed;
  return {
    text: `You have ${remaining} included Sell ${remaining === 1 ? 'publish' : 'publishes'} left ${period}.`,
    suggestUpgrade: false,
  };
}

// ---------------------------------------------------------------------------
// Import-limit copy
// ---------------------------------------------------------------------------

export function importLimitCopy(message?: string | null): string {
  // The server message already carries the right cap for the caller's plan; fall back to the
  // Free number, never to a raw token.
  if (message && /\d/.test(message)) return message;
  return 'You’ve used your 3 Gnome Market imports for today. Try again tomorrow.';
}

// ---------------------------------------------------------------------------
// The ONLY payload create_import_drafts accepts — strip everything client-side
// ---------------------------------------------------------------------------

/**
 * Selected candidates → the strict field bag the server validates. Anything else a UI bolted on
 * (selection state, taxonomy suggestions, evidence) is dropped here so an unknown key can never
 * reach — and be rejected by — the server. Server-side validation still treats the result as
 * untrusted; this is hygiene, not the security boundary.
 */
export function toCreatePayload(list: ReviewCandidate[]): Record<string, unknown>[] {
  return list
    .filter((rc) => rc.selected)
    .map(({ candidate: c }) => ({
      product_name: c.product_name,
      ...(c.variety ? { variety: c.variety } : {}),
      ...(c.category_terms.length ? { category_terms: c.category_terms } : {}),
      listing_type: c.proposed_listing_type,
      ...(c.price_cents != null ? { price_cents: c.price_cents } : {}),
      ...(c.unit ? { unit: c.unit } : {}),
      ...(c.quantity ? { quantity: c.quantity } : {}),
      ...(c.availability ? { availability: c.availability } : {}),
      ...(c.pickup ? { pickup: c.pickup } : {}),
      ...(c.location_text ? { location_text: c.location_text } : {}),
      ...(c.description ? { description: c.description } : {}),
      ...(c.seller_notes ? { seller_notes: c.seller_notes } : {}),
      compliance_attention_required: c.compliance_attention_required,
    }));
}
