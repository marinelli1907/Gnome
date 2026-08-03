// Public-website share links (spec §7). The web routes are:
//   /market/[slug]            — canonical by slug
//   /listing/[slug]-[id]      — slug is cosmetic; the site extracts the trailing
//                               UUID (web/lib/format.ts idFromSlugId), so a
//                               client-computed slug is always compatible.
import type { Listing, Market } from '@/types';

export const WEB_BASE = 'https://gnome.boonesystems.com';

/** Mirror of web/lib/format.ts slugify — cosmetic only, id stays canonical. */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'listing'
  );
}

export function listingShareUrl(listing: Pick<Listing, 'id' | 'title'>): string {
  return `${WEB_BASE}/listing/${slugify(listing.title)}-${listing.id}`;
}

export function marketShareUrl(market: Pick<Market, 'slug'>): string | null {
  return market.slug ? `${WEB_BASE}/market/${market.slug}` : null;
}
