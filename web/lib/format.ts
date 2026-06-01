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

type LType = 'free' | 'trade' | 'sale' | 'wanted';

export const TYPE_LABEL: Record<LType, string> = {
  free: 'Free',
  trade: 'Trade',
  sale: 'For Sale',
  wanted: 'Wanted',
};

export function formatPrice(cents: number, unit?: string | null): string {
  const d = cents / 100;
  const s = Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
  return unit ? `${s}/${unit}` : s;
}

export function listingValue(l: {
  listing_type: LType;
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
    default:
      return 'Free';
  }
}

// Per-type web CTA → opens the app (no web transactions).
export function appCtaLabel(t: LType): string {
  switch (t) {
    case 'trade':
      return 'Offer a Trade in Gnome';
    case 'sale':
      return 'Request to Buy in Gnome';
    case 'wanted':
      return 'Respond in Gnome';
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
