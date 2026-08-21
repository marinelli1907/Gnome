export function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'listing';
}

/** Turn a city slug ("richmond-heights") into a display name ("Richmond Heights"). */
export function cityLabel(slug: string): string {
  return (slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || 'your area';
}

const US_STATES = new Set(['oh','pa','ny','ca','tx','fl','mi','il','wa','or','ma','nj','ga','nc','va','co','az','wi','mn','in']);

/** Parse an area slug like "richmond-heights-oh" -> "Richmond Heights, OH". */
export function parseArea(slug: string): string {
  const parts = (slug || '').split('-').filter(Boolean);
  if (parts.length === 0) return 'your area';
  const last = parts[parts.length - 1].toLowerCase();
  let state = '';
  let cityParts = parts;
  if (parts.length > 1 && US_STATES.has(last)) {
    state = last.toUpperCase();
    cityParts = parts.slice(0, -1);
  }
  const city = cityParts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return state ? `${city}, ${state}` : city;
}

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Extract the trailing listing UUID from a "[slug]-[id]" path segment. */
export function idFromSlugId(slugId: string): string | null {
  const m = (slugId || '').match(UUID_RE);
  return m ? m[1] : null;
}

export function listingPath(id: string, title: string | null): string {
  return `/listing/${slugify(title ?? 'listing')}-${id}`;
}

export function marketPath(slug: string): string {
  return `/market/${slug}`;
}

export function areaLabel(city: string | null, state: string | null): string {
  if (city && state) return `${city}, ${state}`;
  return city || state || 'your area';
}

// ── Listing types: the ONE canonical display config ────────────────────────
// The Postgres enum is listing_type = ('free','trade','sale','wanted','plot')
// and CANNOT be reordered — Postgres can only reorder an enum by recreating the
// type, and this one is referenced by markets, views and comparisons. So the
// enum stays exactly as it is and DISPLAY order lives here, in application
// code, as an explicit array.
//
// Nothing under web/ may hard-code its own type list or its own default:
// import LISTING_TYPES / DEFAULT_LISTING_TYPE from here instead.

/** The enum values, verbatim. 'sale' is Sell; 'free' is Share Free. */
export type ListingType = 'free' | 'trade' | 'sale' | 'wanted' | 'plot';

/**
 * Canonical DISPLAY order — Sell first. Every picker, chip row, and count row
 * renders in this order (a subset may filter it, but never re-sort it).
 */
export const LISTING_TYPES = ['sale', 'free', 'trade', 'wanted', 'plot'] as const satisfies
  readonly ListingType[];

/**
 * What a CUSTOMER may create or filter by at launch. 'wanted' is absent: Gnome
 * does not launch with Wanted listings.
 *
 * Deliberately NOT the same array as LISTING_TYPES — that one is the canonical
 * enum list and backs isListingType(). Narrowing it would make historical
 * Wanted rows fail validation and stop rendering. Anything that OFFERS or LISTS
 * types uses this; anything that VALIDATES or RENDERS a stored value uses
 * LISTING_TYPES.
 */
export const LAUNCH_LISTING_TYPES = ['sale', 'free', 'trade', 'plot'] as const satisfies
  readonly ListingType[];

/**
 * What a post/listing flow opens as when the caller gave no explicit type.
 * This is the value the initial state derives from, so the first paint is
 * already Sell — never Share Free repainted into Sell.
 */
export const DEFAULT_LISTING_TYPE: ListingType = 'sale';

/** Narrowing guard for a `?type=` query param or any other untrusted string. */
export function isListingType(value: unknown): value is ListingType {
  return typeof value === 'string' && (LISTING_TYPES as readonly string[]).includes(value);
}

/**
 * ACTION labels — the post-flow picker, where the seller is choosing what they
 * are about to do ("Sell", "Share Free"). Distinct on purpose from TYPE_LABEL
 * below, which names what an already-posted listing IS.
 */
export const LISTING_TYPE_ACTION_LABEL: Record<ListingType, string> = {
  sale: 'Sell',
  free: 'Share Free',
  trade: 'Trade',
  wanted: 'Wanted',
  plot: 'Offer a Plot',
};

/** One-line hint under each picker choice. */
export const LISTING_TYPE_HINT: Record<ListingType, string> = {
  sale: 'Neighborly price, paid at pickup',
  free: 'Give surplus to neighbors',
  trade: 'Swap for something you want',
  wanted: 'Ask neighbors for something',
  plot: 'A neighbor reserves it; you grow their pick',
};

/**
 * The lead line of the post flow, per type. Each one has to be true of ITS
 * type only — the Share Free wording ("Share your surplus", "Free to share —
 * no payments") is correct inside Share Free and belongs nowhere else.
 */
export const LISTING_TYPE_BLURB: Record<ListingType, string> = {
  sale: 'Set a neighborly price and get paid at pickup — Gnome never takes a cut of your sale.',
  free: 'Share your surplus. Free to share — no payments, just neighbors picking it up.',
  trade: 'Swap what you grew for something you want. No money changes hands.',
  wanted: 'Ask your neighbors for something you’re looking for and let them come to you.',
  plot: 'Offer a piece of your garden — a neighbor reserves it and picks the crop you grow.',
};

/**
 * STATE labels — what an existing listing IS, on badges, filter chips and
 * counts ("3 For Sale"). Keys are in canonical order for readability; display
 * order always comes from LISTING_TYPES.
 */
export const TYPE_LABEL: Record<ListingType, string> = {
  sale: 'For Sale',
  free: 'Free',
  trade: 'Trade',
  wanted: 'Wanted',
  plot: 'Plot',
};


export function formatPrice(cents: number, unit?: string | null): string {
  const d = cents / 100;
  const s = Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
  return unit ? `${s}/${unit}` : s;
}

export function listingValue(l: {
  listing_type: ListingType;
  price_cents: number | null;
  unit: string | null;
  trade_for: string | null;
}): string {
  switch (l.listing_type) {
    case 'sale':
      return l.price_cents != null ? formatPrice(l.price_cents, l.unit) : 'For Sale';
    case 'trade':
      return l.trade_for ? `Trade for ${l.trade_for}` : 'Open to trade';
    case 'wanted':
      return 'Wanted';
    case 'plot':
      return l.price_cents != null
        ? `Reserve for ${formatPrice(l.price_cents)}`
        : 'Reserve this plot';
    default:
      return 'Free';
  }
}

// Per-type web CTA → opens the app (no web transactions).
export function appCtaLabel(t: ListingType): string {
  switch (t) {
    case 'trade':
      return 'Offer a Trade in Gnome';
    case 'sale':
      return 'Request to Buy in Gnome';
    case 'wanted':
      return 'Respond in Gnome';
    case 'plot':
      return 'Reserve in Gnome';
    default:
      return 'Claim in Gnome';
  }
}

export function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} left`;
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `${hours} hour${hours === 1 ? '' : 's'} left`;
}
