import * as Location from 'expo-location';

export interface Coords {
  lat: number;
  lng: number;
}

export type RadiusOption = 'near' | 5 | 10 | 25 | 50;

export const RADIUS_OPTIONS: { value: RadiusOption; label: string }[] = [
  { value: 'near', label: 'Near Me' },
  { value: 5, label: '5 mi' },
  { value: 10, label: '10 mi' },
  { value: 25, label: '25 mi' },
  { value: 50, label: '50 mi' },
];

/** Great-circle distance in miles between two coordinates. */
export function distanceMiles(a: Coords, b: Coords): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Request permission and return the device's current coordinates, or null. */
export async function getCurrentCoords(): Promise<Coords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

/**
 * "Cleveland Heights, OH" for the device's current position, or null. Fills the
 * Garden Planner for users who never set a town on their profile — without it
 * the planner rejects every question for having no location.
 */
export async function currentPlaceLabel(): Promise<string | null> {
  try {
    const coords = await getCurrentCoords();
    if (!coords) return null;
    const [place] = await Location.reverseGeocodeAsync({
      latitude: coords.lat,
      longitude: coords.lng,
    });
    const town = place?.city ?? place?.subregion;
    if (!town) return null;
    return place?.region ? `${town}, ${place.region}` : town;
  } catch {
    return null;
  }
}

/** "Near Me" is treated as a 2-mile bubble. */
export function radiusToMiles(r: RadiusOption): number {
  return r === 'near' ? 2 : r;
}

// Reverse geocoders return the state as either a full name ("Ohio") or an
// abbreviation depending on platform/locale; profiles store the 2-letter code.
const STATE_CODES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM',
  'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC',
};

function toStateCode(region: string | null | undefined): string {
  const r = (region ?? '').trim();
  if (/^[A-Za-z]{2}$/.test(r)) return r.toUpperCase();
  return STATE_CODES[r.toLowerCase()] ?? '';
}

export type LocationFieldsResult =
  | { ok: true; city: string; state: string; zip: string }
  | { ok: false; reason: 'denied' | 'unavailable' };

/**
 * One-tap profile fill: ask for foreground permission (only when called),
 * take a single reading, reverse-geocode it, and return City/State/ZIP as
 * plain strings. The raw coordinates never leave this function — nothing here
 * is stored, so the profile carries only what the user chooses to save.
 */
export async function currentLocationFields(): Promise<LocationFieldsResult> {
  let status: string;
  try {
    ({ status } = await Location.requestForegroundPermissionsAsync());
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (status !== 'granted') return { ok: false, reason: 'denied' };
  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const [place] = await Location.reverseGeocodeAsync({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    });
    const city = (place?.city ?? place?.subregion ?? '').trim();
    const state = toStateCode(place?.region);
    const zip = /^\d{5}/.test(place?.postalCode ?? '')
      ? (place!.postalCode as string).slice(0, 5)
      : '';
    if (!city && !state && !zip) return { ok: false, reason: 'unavailable' };
    return { ok: true, city, state, zip };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
