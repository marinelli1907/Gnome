// Read-only data access for the public site. Reads ONLY the public_* views
// (never base tables), so private fields are unreachable. Anon key over fetch;
// Next's fetch cache handles ISR revalidation.

import type { ListingType } from './format';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export interface WebListing {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  category: string;
  listing_type: ListingType;
  status: string;
  price_cents: number | null;
  currency: string | null;
  trade_for: string | null;
  quantity: string | null;
  unit: string | null;
  photos: string[];
  city: string | null;
  county: string | null;
  state: string | null;
  fulfillment_type: string | null;
  market_id: string | null;
  market_name: string | null;
  market_slug: string | null;
  market_avatar_url: string | null;
  market_type: string | null;
  market_verified: boolean | null;
  created_at: string;
  expires_at: string;
  is_featured: boolean | null;
  featured_until: string | null;
  has_active_promotion: boolean | null;
  is_demo?: boolean | null;
  is_bundle?: boolean | null;
  component_count?: number | null;
  inventory_count?: number | null;
  market_position?: number | null;
  market_featured?: boolean | null;
  approx_lat?: number | null;
  approx_lng?: number | null;
  request_options?: { node_id?: string | null; label: string }[] | null;
  allow_custom_request?: boolean | null;
}

export interface WebMarket {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  market_type: string | null;
  status: string;
  avatar_url: string | null;
  banner_url: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  verified: boolean | null;
  sponsor_visible: boolean | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  created_at: string;
  active_listing_count: number;
  member_since: string | null;
  listings_shared: number;
  listings_sold: number;
  trades_completed: number;
  response_rate: number | null;
  verified_email?: boolean;
  tagline?: string | null;
  theme?: string | null;
}

const LISTING_COLS =
  'id,slug,title,description,category,listing_type,status,price_cents,currency,trade_for,quantity,unit,photos,city,county,state,fulfillment_type,market_id,market_name,market_slug,market_avatar_url,market_type,market_verified,created_at,expires_at,is_featured,featured_until,has_active_promotion,is_demo,market_position,market_featured,inventory_count,request_options,allow_custom_request,is_bundle,component_count';

async function rest<T>(view: string, params: Record<string, string>, revalidate: number): Promise<T[]> {
  if (!SUPABASE_URL || !ANON) return [];
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${view}?${qs}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      next: { revalidate },
    });
    if (!res.ok) return [];
    return (await res.json()) as T[];
  } catch {
    return [];
  }
}

// --- Listings -------------------------------------------------------------
export async function getActiveListings(opts: {
  city?: string;
  listingType?: string;
  limit?: number;
} = {}): Promise<WebListing[]> {
  const params: Record<string, string> = {
    select: LISTING_COLS,
    order: 'created_at.desc',
    limit: String(opts.limit ?? 60),
  };
  if (opts.city) params.city = `ilike.${opts.city}`;
  if (opts.listingType) params.listing_type = `eq.${opts.listingType}`;
  return rest<WebListing>('public_listings', params, 300);
}

export async function getFeaturedListings(limit = 8): Promise<WebListing[]> {
  return rest<WebListing>('public_listings', {
    select: LISTING_COLS,
    has_active_promotion: 'eq.true',
    order: 'created_at.desc',
    limit: String(limit),
  }, 60);
}

export async function getCategoryListings(category: string, limit = 60): Promise<WebListing[]> {
  // Intent SEO: match the category id OR a title containing the term.
  return rest<WebListing>('public_listings', {
    select: LISTING_COLS,
    or: `(category.ilike.${category},title.ilike.*${category}*)`,
    order: 'created_at.desc',
    limit: String(limit),
  }, 300);
}

export type BundleComponent = {
  id: string; slug: string | null; title: string;
  price_cents: number | null; unit: string | null;
};

/** What's inside a public basket — canonical reads only (0121). */
export async function getBundleComponents(listingId: string): Promise<BundleComponent[]> {
  const comps = await rest<{ component_listing_id: string }>(
    'listing_components',
    { select: 'component_listing_id,position', listing_id: `eq.${listingId}`, order: 'position.asc' },
    300,
  );
  const ids = comps.map((c) => c.component_listing_id);
  if (!ids.length) return [];
  const rows = await rest<BundleComponent>(
    'public_listings',
    { select: 'id,slug,title,price_cents,unit', id: `in.(${ids.join(',')})` },
    300,
  );
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
}

export async function getListingById(id: string): Promise<WebListing | null> {
  const rows = await rest<WebListing>('public_listings', {
    select: LISTING_COLS,
    id: `eq.${id}`,
    limit: '1',
  }, 60);
  return rows[0] ?? null;
}

/** Listings by id, returned in the order the ids were given. */
export async function getListingsByIds(ids: string[]): Promise<WebListing[]> {
  if (!ids.length) return [];
  const rows = await rest<WebListing>('public_listings', {
    select: LISTING_COLS,
    id: `in.(${ids.join(',')})`,
  }, 60);
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
}

export async function getMarketListings(marketId: string, limit = 60): Promise<WebListing[]> {
  return rest<WebListing>('public_listings', {
    select: LISTING_COLS,
    market_id: `eq.${marketId}`,
    order: 'market_position.asc.nullslast,has_active_promotion.desc,created_at.desc',
    limit: String(limit),
  }, 300);
}

// --- Market Drops (NOT the Seed Drop) --------------------------------------
// Time-boxed collections of a market's existing listings. The view already
// filters to scheduled drops that are upcoming, live, or freshly ended, and
// counts items against public_listings so canonical state wins.
export interface WebMarketDrop {
  id: string;
  market_id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  phase: 'upcoming' | 'live' | 'ended';
  available_items: number;
}

export async function getMarketDrops(marketId: string): Promise<WebMarketDrop[]> {
  return rest<WebMarketDrop>('public_market_drops', {
    select: 'id,market_id,title,description,starts_at,ends_at,timezone,phase,available_items',
    market_id: `eq.${marketId}`,
    order: 'starts_at.asc',
    limit: '12',
  }, 60);
}

// Card order wherever drops render: live first, then coming up, then just
// ended — a recently-ended Drop never crowds a live one out of the row.
export function sortDropsLiveFirst<T extends { phase: string; starts_at: string }>(drops: T[]): T[] {
  const order: Record<string, number> = { live: 0, upcoming: 1, ended: 2 };
  return [...drops].sort(
    (a, b) => (order[a.phase] ?? 3) - (order[b.phase] ?? 3) || Date.parse(a.starts_at) - Date.parse(b.starts_at),
  );
}

export async function getDropItemIds(dropId: string): Promise<string[]> {
  const rows = await rest<{ listing_id: string }>('market_drop_items', {
    select: 'listing_id',
    drop_id: `eq.${dropId}`,
    order: 'position.asc',
    limit: '30',
  }, 60);
  return rows.map((r) => r.listing_id);
}

// --- Markets --------------------------------------------------------------
const MARKET_COLS =
  'id,slug,name,description,market_type,status,avatar_url,banner_url,city,county,state,verified,sponsor_visible,website_url,instagram_url,facebook_url,created_at,active_listing_count,member_since,listings_shared,listings_sold,trades_completed,response_rate,verified_email,tagline,theme';

export async function getFeaturedMarkets(limit = 8): Promise<WebMarket[]> {
  return rest<WebMarket>('public_markets', {
    select: MARKET_COLS,
    active_listing_count: 'gt.0',
    order: 'verified.desc,active_listing_count.desc',
    limit: String(limit),
  }, 300);
}

export async function getMarketBySlug(slug: string): Promise<WebMarket | null> {
  const rows = await rest<WebMarket>('public_markets', {
    select: MARKET_COLS,
    slug: `eq.${slug}`,
    limit: '1',
  }, 300);
  return rows[0] ?? null;
}

// --- Taxonomy roots (server-side) -----------------------------------------
// The same 16 backend roots the app and the Buy page render — the homepage
// category grid must never drift from them.
export interface TaxonomyRoot {
  slug: string;
  name: string;
  icon: string | null;
}

export async function getTaxonomyRoots(): Promise<TaxonomyRoot[]> {
  return rest<TaxonomyRoot>('marketplace_taxonomy_nodes', {
    select: 'slug,name,icon',
    depth: 'eq.0',
    active: 'eq.true',
    order: 'display_order',
  }, 3600);
}

// --- Delivery -------------------------------------------------------------
export interface MarketDelivery {
  market_id: string;
  enabled: boolean;
  radius_miles: number | null;
  flat_fee_cents: number;
  surcharge_after_miles: number | null;
  surcharge_fee_cents: number | null;
  same_day: boolean;
  same_day_cutoff: string | null;
  next_day: boolean;
  next_day_cutoff: string | null;
  scheduled: boolean;
  order_by_dow: number | null;
  delivery_dows: number[];
  notes: string | null;
}

export async function getMarketDelivery(marketId: string): Promise<MarketDelivery | null> {
  const rows = await rest<MarketDelivery>('market_delivery_settings', {
    select: '*',
    market_id: `eq.${marketId}`,
    enabled: 'is.true',
    limit: '1',
  }, 300);
  return rows[0] ?? null;
}

// --- Sitemap helpers ------------------------------------------------------
export async function getAllActiveListingRefs(): Promise<{ id: string; slug: string | null; created_at: string }[]> {
  return rest('public_listings', { select: 'id,slug,created_at', order: 'created_at.desc', limit: '500' }, 300);
}
export async function getAllActiveMarketRefs(): Promise<{ slug: string; created_at: string }[]> {
  return rest('public_markets', { select: 'slug,created_at', active_listing_count: 'gt.0', limit: '500' }, 300);
}

// --- Server errors, in seller language ------------------------------------
// Every listing write goes straight to PostgREST under RLS, so the only thing
// that comes back when a trigger refuses is a Postgres message. Those messages
// are written as customer copy AFTER a machine prefix ("RATE_LIMITED: You have
// posted…"), so the job here is to strip the prefix, pick a title, and never
// leak the machine part — a prefix, an enum, a trigger name, an SQLSTATE, or a
// stack are all things a seller should never see.
//
// Mirrors the shape of the app's mapper ({ code, title, message }). web and expo
// are separate npm packages with no shared code, so the duplication is
// deliberate: the two must agree on behaviour, not share a module.

export type ServerErrorCode =
  | 'PROHIBITED_ITEM'
  | 'PROHIBITED_CATEGORY'
  | 'RATE_LIMITED'
  | 'COMPLIANCE_BLOCKED'
  | 'PLAN_LIMIT_REACHED'
  | 'PUBLISH_ALLOWANCE_EXHAUSTED'
  | 'PLOTS_REQUIRE_PLAN'
  | 'NOT_AUTHORIZED'
  | 'OWNER_ONLY'
  | 'LAST_OWNER'
  | 'INVITE_EXPIRED'
  | 'NO_PENDING_INVITE'
  | 'INVALID_ROLE'
  | 'INVALID_EMAIL'
  | 'REASON_REQUIRED'
  | 'UNKNOWN_STATE'
  | 'UNKNOWN';

export interface ServerError {
  code: ServerErrorCode;
  /** Ours. */
  title: string;
  /** The server's, prefix stripped. Never a code, an errcode, or a trigger name. */
  message: string;
}

/** Where Gnome publishes what may and may not be listed. */
export const RULES_HREF = '/trust';
export const TERMS_PROHIBITED_HREF = '/terms#prohibited';
/** The published contact address used across the site (privacy, terms). */
export const SUPPORT_EMAIL = 'daniel@boonesystems.com';

// Title per code, plus copy for the codes the server raises BARE (a bare token
// must never reach a screen). Titles and bare-code copy are kept word-for-word
// in step with the app's table so the same refusal reads the same in both.
const TITLES: Record<ServerErrorCode, string> = {
  PROHIBITED_ITEM: 'Not allowed on Gnome',
  PROHIBITED_CATEGORY: 'Not allowed on Gnome',
  RATE_LIMITED: 'Posting too quickly',
  COMPLIANCE_BLOCKED: 'Verification required',
  PLAN_LIMIT_REACHED: 'Listing limit reached',
  PUBLISH_ALLOWANCE_EXHAUSTED: 'Included listings used up',
  PLOTS_REQUIRE_PLAN: 'Paid plan required',
  NOT_AUTHORIZED: 'Not permitted',
  OWNER_ONLY: 'Owners only',
  LAST_OWNER: 'Last owner',
  INVITE_EXPIRED: 'Invitation expired',
  NO_PENDING_INVITE: 'No pending invitation',
  INVALID_ROLE: 'Pick a role',
  INVALID_EMAIL: 'Check the email',
  REASON_REQUIRED: 'Add a reason',
  UNKNOWN_STATE: 'Check the state',
  UNKNOWN: 'That didn’t go through',
};

const FALLBACK_BODY: Record<ServerErrorCode, string> = {
  PROHIBITED_ITEM:
    'Gnome can’t carry this one. Editing the wording may help, or contact us if you think that’s wrong.',
  PROHIBITED_CATEGORY: 'Gnome can’t carry items in that category.',
  RATE_LIMITED:
    'You’ve posted a lot of listings in the last hour. Try again in a little while.',
  COMPLIANCE_BLOCKED:
    'This category needs verification before publishing. Adding your permit, licence, or registration in the Credential Center is what clears it.',
  // Transitional: raised by the retired pre-0104 active-listing gate. Production runs the
  // allowance model now (0104 applied 2026-08-16), so this should no longer fire — kept only so
  // a stale environment degrades to readable copy instead of a raw code. Safe to delete later.
  PLAN_LIMIT_REACHED:
    'You’re at your plan’s listing limit right now. Upgrade, or try again later.',
  // The 0104 model: a monthly PUBLISH allowance that expiry does not refund. The wording is
  // per-period, never "active listings" — that model is retired.
  PUBLISH_ALLOWANCE_EXHAUSTED:
    'You’ve used your included Sell listings for this period. Publish this one for $0.99, or upgrade for more each month.',
  PLOTS_REQUIRE_PLAN:
    'Offering plots is a paid plan feature — upgrade and your garden can take reservations.',
  NOT_AUTHORIZED: 'Your account can’t do that.',
  OWNER_ONLY: 'Only an owner can do that.',
  LAST_OWNER: 'An account must always keep at least one owner.',
  INVITE_EXPIRED: 'That invitation has expired. Ask for a new one.',
  NO_PENDING_INVITE: 'There’s no open invitation for this email address.',
  INVALID_ROLE: 'That isn’t a role this account offers.',
  INVALID_EMAIL: 'That email address doesn’t look right.',
  REASON_REQUIRED: 'This action is recorded, so it needs a short reason.',
  UNKNOWN_STATE: 'That isn’t a state Gnome recognises.',
  UNKNOWN: 'Something went wrong on our end — try again.',
};

const CODES: Exclude<ServerErrorCode, 'UNKNOWN'>[] = [
  'PROHIBITED_ITEM', 'PROHIBITED_CATEGORY', 'RATE_LIMITED', 'COMPLIANCE_BLOCKED',
  'PLAN_LIMIT_REACHED', 'PUBLISH_ALLOWANCE_EXHAUSTED', 'PLOTS_REQUIRE_PLAN', 'NOT_AUTHORIZED', 'OWNER_ONLY',
  'LAST_OWNER', 'INVITE_EXPIRED', 'NO_PENDING_INVITE', 'INVALID_ROLE',
  'INVALID_EMAIL', 'REASON_REQUIRED', 'UNKNOWN_STATE',
];

// Anything that reads like plumbing rather than a sentence written for a person.
const MACHINE_PREFIX = /^[A-Z][A-Z0-9_]{3,}(:|$)/;
const MACHINE_NOISE =
  /(violates|constraint|permission denied|relation "|column "|null value in|duplicate key|syntax error|invalid input (value|syntax)|function .*does not exist|pg_|PGRST|SQLSTATE|JWT|at Object\.|\n\s*at )/i;

function rawMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return '';
}

/**
 * Turn anything a listing write can reject with into copy a seller can act on.
 * `fallback` is what an unrecognizable internal error becomes.
 */
export function mapServerError(
  err: unknown,
  fallback = FALLBACK_BODY.UNKNOWN,
): ServerError {
  const raw = rawMessage(err).trim();

  for (const code of CODES) {
    const at = raw.indexOf(code);
    // Must be the whole token: EVENT_RATE_LIMITED is not RATE_LIMITED.
    if (at === -1 || (at > 0 && /[A-Z0-9_]/.test(raw[at - 1]))) continue;
    let body = raw.slice(at + code.length).replace(/^\s*:\s*/, '').trim();
    // COMPLIANCE_BLOCKED is raised as CODE:REASON:message — REASON is an internal
    // enum (CREDENTIAL_REQUIRED, PLAN_REQUIRED…) and never belongs on screen.
    if (code === 'COMPLIANCE_BLOCKED') body = body.replace(/^[A-Z][A-Z0-9_]{2,}:\s*/, '').trim();
    return { code, title: TITLES[code], message: body || FALLBACK_BODY[code] };
  }

  const readable = raw && !MACHINE_PREFIX.test(raw) && !MACHINE_NOISE.test(raw);
  return { code: 'UNKNOWN', title: TITLES.UNKNOWN, message: readable ? raw : fallback };
}

// --- Content screening, from the seller's side ----------------------------
// A saved listing is not automatically a published one. When the screening
// trigger holds a listing it still returns success — the row is written, but
// screening_status becomes 'REVIEW' and an active listing is quietly downgraded
// to 'paused'. Treating that as a normal post is the lie this exists to stop.

export type ScreeningStatus = 'CLEAR' | 'REVIEW' | 'BLOCKED' | 'APPROVED';

export interface ScreenedListing {
  /** Listing status; 'paused' is the trigger's downgrade of a held listing. */
  status?: string | null;
  screening_status?: string | null;
  /** Customer-facing explanation written by the server. Render verbatim. */
  screening_reason?: string | null;
}

/**
 * Columns to read back after a listing write. Kept here so every write path
 * asks for the same thing — and deliberately WITHOUT screening_term and
 * screening_category, which are internal keyword matches.
 */
export const SCREENING_COLS = 'status,screening_status,screening_reason';

/** Shown only when the server's own explanation can't be read back. */
export const REVIEW_FALLBACK_REASON =
  'Your listing has been saved, but it isn’t public yet — someone at Gnome needs to look at it first.';

export function isUnderReview(row: ScreenedListing | null | undefined): boolean {
  if (!row) return false;
  // 'paused' is the same hold seen from the status column alone, which matters
  // because the screening columns are a separate grant a seller may not have.
  return row.screening_status === 'REVIEW' || row.status === 'paused';
}

/** The server's explanation, verbatim, or neutral copy when it isn't readable. */
export function reviewReason(row: ScreenedListing | null | undefined): string {
  const reason = row?.screening_reason?.trim();
  return reason || REVIEW_FALLBACK_REASON;
}
