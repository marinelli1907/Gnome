import type { Listing, ListingType } from '@/types';
import Colors from '@/constants/colors';

export const TYPE_LABEL: Record<ListingType, string> = {
  free: 'Free',
  trade: 'Trade',
  sale: 'For Sale',
  wanted: 'Wanted',
  plot: 'Plot',
};

// Rork type palette: moss / sky / terracotta / plum, plot keeps the deep green.
export const TYPE_COLOR: Record<ListingType, string> = {
  free: Colors.free,
  trade: Colors.sky,
  sale: Colors.sell,
  wanted: Colors.plum,
  plot: Colors.primary,
};

export const TYPE_FILTERS: { value: 'all' | ListingType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'free', label: 'Free' },
  { value: 'trade', label: 'Trade' },
  { value: 'sale', label: 'For Sale' },
  { value: 'plot', label: 'Plots' },
  { value: 'wanted', label: 'Wanted' },
];

// Create-flow chooser (Give Away / Trade / Sell / Wanted / Offer a Plot).
export const TYPE_CHOICES: { value: ListingType; label: string; emoji: string }[] = [
  { value: 'free', label: 'Give Away', emoji: '🧺' },
  { value: 'trade', label: 'Trade', emoji: '🔄' },
  { value: 'sale', label: 'Sell', emoji: '🏷️' },
  { value: 'wanted', label: 'Wanted', emoji: '🔎' },
  { value: 'plot', label: 'Offer a Plot', emoji: '🌾' },
];

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
