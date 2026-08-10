import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

export interface Coords {
  lat: number;
  lng: number;
}

/** Legacy fixed choices — still used by the Map tab only. */
export type RadiusOption = 'near' | 5 | 10 | 25 | 50;

export const RADIUS_OPTIONS: { value: RadiusOption; label: string }[] = [
  { value: 'near', label: 'Near Me' },
  { value: 5, label: '5 mi' },
  { value: 10, label: '10 mi' },
  { value: 25, label: '25 mi' },
  { value: 50, label: '50 mi' },
];

// ---------------------------------------------------------------------------
// Browse distance model: a real number of miles (1–500) or 'anywhere' — a
// distinct state, never a magic number.
export type BrowseRadius = number | 'anywhere';

/** Default for new users: 10 miles — Gnome is a neighborhood marketplace, and
 *  10 was the previous fixed default, so existing behavior carries over. */
export const DEFAULT_BROWSE_RADIUS: BrowseRadius = 10;
export const MAX_BROWSE_RADIUS = 500;

/** Nonlinear slider detents: fine near home, broad strokes far away. Typed
 *  values are preserved exactly; the slider just snaps to the nearest detent
 *  visually. */
export const RADIUS_DETENTS = [1, 2, 3, 5, 10, 15, 20, 25, 35, 50, 75, 100, 150, 200, 250];

export const RADIUS_SHORTCUTS: BrowseRadius[] = [5, 10, 25, 50, 100, 250, 'anywhere'];

export function browseRadiusMiles(r: BrowseRadius): number | null {
  return r === 'anywhere' ? null : r;
}

export function radiusLabel(r: BrowseRadius): string {
  return r === 'anywhere' ? 'Anywhere' : `Within ${r} mi`;
}

const RADIUS_KEY = 'gnome.browseRadius';

export async function loadBrowseRadius(): Promise<BrowseRadius> {
  try {
    const raw = await AsyncStorage.getItem(RADIUS_KEY);
    if (raw === 'anywhere') return 'anywhere';
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1 && n <= MAX_BROWSE_RADIUS) return n;
  } catch {
    /* fall through to default */
  }
  return DEFAULT_BROWSE_RADIUS;
}

export async function saveBrowseRadius(r: BrowseRadius): Promise<void> {
  try {
    await AsyncStorage.setItem(RADIUS_KEY, String(r));
  } catch {
    /* persistence is best-effort */
  }
}

/**
 * Distance label rounding: under 10 miles one decimal, 10+ whole miles —
 * approximate coordinates don't support more precision and we won't imply it.
 */
export function fmtDistance(mi: number): string {
  if (mi < 0.1) return 'Nearby';
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

/**
 * Bounding box around a point, for the SERVER-side prefilter: PostgREST range
 * conditions on approx_lat/approx_lng shrink the fetched set to a superset of
 * the circle, so the row cap applies within the box instead of nationally.
 * The exact great-circle cut still happens client-side inside that box.
 */
export function boundingBox(c: Coords, miles: number) {
  const latDelta = miles / 69; // ~69 mi per degree latitude
  const lngDelta = miles / (69 * Math.max(0.2, Math.cos((c.lat * Math.PI) / 180)));
  return {
    minLat: c.lat - latDelta,
    maxLat: c.lat + latDelta,
    minLng: c.lng - lngDelta,
    maxLng: c.lng + lngDelta,
  };
}

/**
 * Current coords WITHOUT prompting — for passive surfaces (detail screens,
 * foreground refresh). Only Browse's explicit "Use current location" action
 * (and first-mount getCurrentCoords) may prompt.
 */
export async function getCoordsIfGranted(): Promise<Coords | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

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
