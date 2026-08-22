import type { Listing, ListingType } from '@/types';
import Colors from '@/constants/colors';

/**
 * ONE canonical source of truth for listing types in the mobile app:
 * display order, labels and the default a create flow starts on.
 *
 * The Postgres enum sorts `('free','trade','sale','wanted','plot')` and must NOT
 * be reordered — Postgres cannot reorder an enum without recreating the type,
 * and `listing_type` is referenced by markets, views and comparisons. So the
 * DISPLAY order lives here, in application code, as an explicit array. Anything
 * that renders the five types (chooser, filters, copy maps) derives from it —
 * never hard-code its own ordering.
 *
 * Enum values are the DB values: Sell is 'sale' and Share Free is 'free'
 * (never 'sell', never 'share_free').
 */
export const LISTING_TYPE_ORDER: readonly ListingType[] = [
  'sale',
  'free',
  'trade',
  'wanted',
  'plot',
] as const;

/**
 * What a CUSTOMER may create and filter by at launch.
 *
 * `wanted` is deliberately absent: Gnome does not launch with Wanted listings,
 * because a buyer opening Browse should see what is actually available rather
 * than scrolling past requests for it. This is a HIDE, not a delete — the enum
 * value, the DB rows, the labels, the colours and every render path above still
 * exist, so historical Wanted listings keep working for anyone entitled to see
 * them (their owner, admin and compliance tooling).
 *
 * Deliberately NOT the same array as LISTING_TYPE_ORDER: that one is the
 * canonical list of DB enum values and backs `isListingType()`. Narrowing it
 * would make `isListingType('wanted')` false and break validation and rendering
 * of every historical Wanted row — the exact destructive outcome this split
 * avoids. Anything that OFFERS or LISTS types derives from this array; anything
 * that VALIDATES or RENDERS a stored value derives from LISTING_TYPE_ORDER.
 */
export const LAUNCH_LISTING_TYPES: readonly ListingType[] = [
  'sale',
  'free',
  'trade',
  'plot',
] as const;

/** True for a type a customer may create or filter by today. */
export function isLaunchListingType(value: unknown): value is ListingType {
  return typeof value === 'string' && (LAUNCH_LISTING_TYPES as readonly string[]).includes(value);
}

/**
 * What a listing/post flow starts on when the caller gave no explicit type.
 *
 * Migration 0104 also sets the column DEFAULT to 'sale' at the database level, so the
 * two agree. That default is belt-and-braces only: both clients always send
 * listing_type explicitly, so nothing depends on it.
 * this is the client-side default for the *create UI*, so a user who opens Post
 * with nothing selected lands on Sell. Because it is a plain constant it can be
 * the initial `useState` value — the first paint is already Sell, so there is no
 * Share-Free-then-Sell flash to patch up in an effect.
 */
export const DEFAULT_LISTING_TYPE: ListingType = 'sale';

/** Canonical labels for the five types (used by the create-flow chooser). */
export const LISTING_TYPE_LABEL: Record<ListingType, string> = {
  sale: 'Sell',
  free: 'Share Free',
  trade: 'Trade',
  wanted: 'Wanted',
  plot: 'Offer a Plot',
};

/**
 * Shorthand used when *describing an existing listing* (card badge, browse
 * filter) rather than offering an action. Same five types, same canonical
 * order — only the wording is the noun form.
 */
export const TYPE_LABEL: Record<ListingType, string> = {
  sale: 'For Sale',
  free: 'Free',
  trade: 'Trade',
  wanted: 'Wanted',
  plot: 'Plot',
};

// v6 semantic palette: Sell green, Free blue, Trade red, Plot yellow.
// `wanted` is neutral slate on purpose — it is not offered at launch, and
// purple belongs to Gnome AI alone. Plot no longer borrows `primary`, which
// used to make Plot and Sell the same colour.
export const TYPE_COLOR: Record<ListingType, string> = {
  sale: Colors.sell,
  free: Colors.free,
  trade: Colors.trade,
  wanted: Colors.textSecondary,
  plot: Colors.harvestYellow,
};

// Label colours for TEXT SITTING ON A LIGHT WASH OF ITS OWN HUE — the pattern
// the type chooser and the type badges use. The bright cuts above are for
// borders, fills and pins; on their own ~8% wash they measure 4.10 (Sell),
// 4.11 (Free), 4.00 (Trade) and 1.56 (Plot) — all under AA body, Plot
// invisibly so. These are the same hues cut deep enough to clear it:
// 7.10, 5.90, 5.83 and 6.64:1 respectively, and >= 6.5:1 on plain white.
// Use TYPE_COLOR for the shape, TYPE_TEXT_COLOR for the words.
export const TYPE_TEXT_COLOR: Record<ListingType, string> = {
  sale: '#215E24',
  free: '#0F5FA6',
  trade: '#B71C1C',
  wanted: Colors.textSecondary,
  plot: '#7A5200',
};

/** True for the five DB enum values — anything else (a label, a stale synonym). */
export function isListingType(value: unknown): value is ListingType {
  return typeof value === 'string' && (LISTING_TYPE_ORDER as readonly string[]).includes(value);
}

/**
 * Values that mean one of the five types but aren't the enum value: labels and
 * older/looser spellings a deep link or an AI draft can carry. Mapping them
 * keeps an explicit determination ("giveaway") from being thrown away and
 * silently defaulted.
 */
const LISTING_TYPE_ALIASES: Record<string, ListingType> = {
  sell: 'sale',
  'for sale': 'sale',
  for_sale: 'sale',
  share_free: 'free',
  'share free': 'free',
  sharefree: 'free',
  giveaway: 'free',
  give_away: 'free',
  'give away': 'free',
  gift: 'free',
  swap: 'trade',
  request: 'wanted',
  'offer a plot': 'plot',
  plots: 'plot',
};

/**
 * Read an externally supplied type (deep-link `?type=`, notification payload,
 * AI draft) — `null` when there was no understandable determination.
 *
 * Callers that must not clobber an existing selection check for null; callers
 * that need a value use {@link resolveListingType}.
 */
export function listingTypeFromParam(value: unknown): ListingType | null {
  if (isListingType(value)) return value;
  if (typeof value === 'string') {
    return LISTING_TYPE_ALIASES[value.trim().toLowerCase()] ?? null;
  }
  return null;
}

/**
 * Resolve an externally supplied type to a real enum value.
 *
 * An explicit, understood determination always wins — `?type=trade` opens Trade,
 * an AI draft that decided giveaway/trade/wanted/plot keeps that decision. Only
 * a missing or unrecognizable value falls back, and it falls back to Sell.
 */
export function resolveListingType(
  value: unknown,
  fallback: ListingType = DEFAULT_LISTING_TYPE,
): ListingType {
  return listingTypeFromParam(value) ?? fallback;
}

// Browse/search filters — launch types only, so Wanted is not offered as a
// filter and cannot be used to surface Wanted rows from the UI.
export const TYPE_FILTERS: { value: 'all' | ListingType; label: string }[] = [
  { value: 'all', label: 'All' },
  ...LAUNCH_LISTING_TYPES.map((value) => ({ value, label: TYPE_LABEL[value] })),
];

// Create-flow chooser. Wanted is absent at launch; TYPE_EMOJI still defines it
// so historical rows render.
const TYPE_EMOJI: Record<ListingType, string> = {
  sale: '🏷️',
  free: '🧺',
  trade: '🔄',
  wanted: '🔎',
  plot: '🌾',
};

export const TYPE_CHOICES: { value: ListingType; label: string; emoji: string }[] =
  LAUNCH_LISTING_TYPES.map((value) => ({
    value,
    label: LISTING_TYPE_LABEL[value],
    emoji: TYPE_EMOJI[value],
  }));

export function formatPrice(cents: number, unit?: string | null): string {
  const dollars = cents / 100;
  const s = Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
  return unit ? `${s}/${unit}` : s;
}

/** The headline value shown on cards/detail per type. */
export function listingValueLabel(l: Pick<Listing, 'listing_type' | 'price_cents' | 'unit' | 'trade_for'>): string {
  switch (l.listing_type) {
    case 'sale':
      return l.price_cents != null ? formatPrice(l.price_cents, l.unit) : 'For Sale';
    case 'trade':
      return l.trade_for ? `Trade for ${l.trade_for}` : 'Open to trade';
    case 'wanted':
      return 'Wanted';
    case 'plot':
      return l.price_cents != null ? `${formatPrice(l.price_cents)} to reserve` : 'Plot for rent';
    case 'free':
    default:
      return 'Free';
  }
}

export function ctaLabel(type: ListingType): string {
  switch (type) {
    case 'trade':
      return 'Offer Trade';
    case 'sale':
      return 'Request to Buy';
    case 'wanted':
      return 'I Have This';
    case 'plot':
      return 'Reserve this plot';
    case 'free':
    default:
      return 'Claim this';
  }
}
