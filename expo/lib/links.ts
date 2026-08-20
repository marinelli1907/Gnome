// Public-website share links (spec §7). The web routes are:
//   /market/[slug]            — canonical by slug
//   /listing/[slug]-[id]      — slug is cosmetic; the site extracts the trailing
//                               UUID (web/lib/format.ts idFromSlugId), so a
//                               client-computed slug is always compatible.
import { Platform } from 'react-native';
import type { Listing, Market } from '@/types';

export const WEB_BASE = 'https://gnomefarmersmarket.com';

export function nativeWebUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (Platform.OS !== 'android') return `${WEB_BASE}${cleanPath}`;
  const sep = cleanPath.includes('?') ? '&' : '?';
  return `${WEB_BASE}${cleanPath}${sep}app_platform=android`;
}

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

/** A Market Drop deep link — the Market page, scrolled to the Drop. */
export function dropShareUrl(marketSlug: string, dropId: string): string {
  return `${WEB_BASE}/market/${marketSlug}?drop=${dropId}`;
}
