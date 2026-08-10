// Friendly names for pickup-location types. The enum is owned by the backend
// and will keep growing, so unknown values are title-cased rather than dropped
// or rendered as SCREAMING_SNAKE at the buyer.
// Wording is kept in step with the seller-side labels in lib/pickuplocations
// (deliberately copied, not imported, so the buyer surfaces never break on an
// enum the backend adds before this map catches up).
const TYPE_LABELS: Record<string, string> = {
  PRIVATE_RESIDENCE: 'Private residence',
  PUBLIC_FARM_STAND: 'Public farm stand',
  PUBLIC_BUSINESS: 'Public business',
  PUBLIC_MEETUP_POINT: 'Public meetup point',
  CUSTOM_PICKUP_POINT: 'Custom pickup point',
};

const TYPE_EMOJI: Record<string, string> = {
  PRIVATE_RESIDENCE: '🏡',
  PUBLIC_FARM_STAND: '🌾',
  PUBLIC_BUSINESS: '🏬',
  PUBLIC_MEETUP_POINT: '📍',
  CUSTOM_PICKUP_POINT: '📍',
};

export function locationTypeLabel(type?: string | null): string {
  const t = (type ?? '').trim();
  if (!t) return 'Pickup spot';
  if (TYPE_LABELS[t]) return TYPE_LABELS[t];
  return t
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

export function locationTypeEmoji(type?: string | null): string {
  const t = (type ?? '').trim();
  return TYPE_EMOJI[t] ?? '📍';
}

/** The line shown wherever an address isn't (and shouldn't be) available. */
export const ADDRESS_AFTER_CONFIRMATION = 'Address shown after confirmation';
