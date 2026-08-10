// Multiple pickup locations per Market (0052–0054). Basic selling stays free
// with one location; paid plans unlock more.
//
// PRIVACY CONTRACT — read before touching a query in this file:
//   SELECT on market_pickup_locations.address_line / lat / lng is REVOKED for
//   anon + authenticated (0054). Two consequences the client must respect:
//     1. NEVER chain .select() onto an insert/update on this table. PostgREST
//        would ask for `return=representation` and the request dies with 42501.
//        supabase-js v2 already defaults to `return=minimal` when no .select()
//        is chained — so we insert/update bare and re-read afterwards.
//     2. The owner reads their OWN full rows (address + coords) through the
//        my_pickup_locations() RPC. Everyone else reads the safe columns, or
//        public_pickup_locations() which reveals an address only when the
//        seller opted in on a PUBLIC_* location.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from './supabase';
import { logEvent } from './db';
import type { MarketPlan } from '@/types';

// ---------------------------------------------------------------------------
// Types
export type PickupLocationType =
  | 'PRIVATE_RESIDENCE'
  | 'PUBLIC_FARM_STAND'
  | 'PUBLIC_BUSINESS'
  | 'PUBLIC_MEETUP_POINT'
  | 'CUSTOM_PICKUP_POINT';

/** Owner-visible row (via my_pickup_locations). Includes the exact address. */
export interface PickupLocation {
  id: string;
  market_id: string;
  nickname: string;
  location_type: PickupLocationType;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  approx_lat: number | null;
  approx_lng: number | null;
  instructions: string | null;
  public_address_visible: boolean;
  timezone: string;
  slot_minutes: 15 | 30 | 60;
  lead_time_minutes: number;
  max_orders_per_slot: number | null;
  active: boolean;
  is_default: boolean;
  plan_restricted: boolean;
  created_at: string;
  updated_at: string;
}

/** Pre-confirmation shape everyone else can see. */
export interface PublicPickupLocation {
  location_id: string;
  nickname: string;
  location_type: PickupLocationType;
  /** Non-null ONLY when the seller opted in on a PUBLIC_* location. */
  public_address: string | null;
  approx_lat: number | null;
  approx_lng: number | null;
  is_default: boolean;
}

export interface LocationHours {
  id: string;
  market_id: string;
  location_id: string | null;
  weekday: number; // 0 = Sunday
  start_minute: number;
  end_minute: number;
}

export interface LocationException {
  id: string;
  market_id: string;
  location_id: string | null;
  date: string; // YYYY-MM-DD
  closed: boolean;
  start_minute: number | null;
  end_minute: number | null;
  note: string | null;
}

export interface LocationSlot {
  slot_start: string;
  slot_end: string;
  remaining: number | null;
}

/** Everything a seller may write. `id` decides insert vs update. */
export type PickupLocationPatch = Partial<
  Pick<
    PickupLocation,
    | 'nickname'
    | 'location_type'
    | 'address_line'
    | 'city'
    | 'state'
    | 'postal_code'
    | 'lat'
    | 'lng'
    | 'instructions'
    | 'public_address_visible'
    | 'timezone'
    | 'slot_minutes'
    | 'lead_time_minutes'
    | 'max_orders_per_slot'
    | 'active'
    | 'is_default'
  >
>;

export type SaveLocationInput = { id?: string | null } & PickupLocationPatch;

// ---------------------------------------------------------------------------
// Labels & choices (shared by the manager and the editor)
export const LOCATION_TYPE_LABELS: Record<PickupLocationType, string> = {
  PRIVATE_RESIDENCE: 'Private residence',
  PUBLIC_FARM_STAND: 'Public farm stand',
  PUBLIC_BUSINESS: 'Public business',
  PUBLIC_MEETUP_POINT: 'Public meetup point',
  CUSTOM_PICKUP_POINT: 'Custom pickup point',
};

export const LOCATION_TYPES: PickupLocationType[] = [
  'PRIVATE_RESIDENCE',
  'PUBLIC_FARM_STAND',
  'PUBLIC_BUSINESS',
  'PUBLIC_MEETUP_POINT',
  'CUSTOM_PICKUP_POINT',
];

/** Only PUBLIC_* types may ever show their street address before confirmation. */
export function isPublicLocationType(t: PickupLocationType): boolean {
  return t.startsWith('PUBLIC_');
}

/** Plan names as sellers see them. `free` is "Neighbor" in the product copy. */
export const PLAN_LABELS: Record<MarketPlan, string> = {
  free: 'Neighbor',
  grower: 'Grower',
  farm: 'Farm',
  sponsor: 'Sponsor',
};

export function planLabel(plan?: string | null): string {
  return PLAN_LABELS[(plan ?? 'free') as MarketPlan] ?? 'Neighbor';
}

export const SLOT_MINUTE_CHOICES: (15 | 30 | 60)[] = [15, 30, 60];

export const LEAD_TIME_CHOICES: { label: string; minutes: number }[] = [
  { label: 'None', minutes: 0 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '4h', minutes: 240 },
  { label: '24h', minutes: 1440 },
  { label: '48h', minutes: 2880 },
];

/** Short IANA list — the zones Gnome actually serves. */
export const TIMEZONE_CHOICES: { label: string; value: string }[] = [
  { label: 'Eastern', value: 'America/New_York' },
  { label: 'Central', value: 'America/Chicago' },
  { label: 'Mountain', value: 'America/Denver' },
  { label: 'Arizona', value: 'America/Phoenix' },
  { label: 'Pacific', value: 'America/Los_Angeles' },
  { label: 'Alaska', value: 'America/Anchorage' },
  { label: 'Hawaii', value: 'Pacific/Honolulu' },
];

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

export const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];
export const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------------------------------------------------------------------------
// Formatting helpers
export function formatMinuteOfDay(minute: number, withPeriod = true): string {
  const h24 = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''}${withPeriod ? ` ${period}` : ''}`;
}

/** "5–8 PM" when both ends share a period, otherwise "11 AM–1 PM". */
export function formatWindow(startMinute: number, endMinute: number): string {
  const sPm = Math.floor(startMinute / 60) % 24 >= 12;
  const ePm = Math.floor(endMinute / 60) % 24 >= 12;
  if (sPm === ePm) {
    return `${formatMinuteOfDay(startMinute, false)}–${formatMinuteOfDay(endMinute, true)}`;
  }
  return `${formatMinuteOfDay(startMinute)}–${formatMinuteOfDay(endMinute)}`;
}

/**
 * Compact card summary: days that share the exact same windows collapse
 * together, e.g. "Tue/Thu 5–8 PM · Sat 9 AM–12 PM".
 */
export function summarizeHours(hours: LocationHours[]): string {
  if (!hours.length) return 'No pickup windows yet';
  const sorted = [...hours].sort(
    (a, b) => a.weekday - b.weekday || a.start_minute - b.start_minute,
  );
  const byDay = new Map<number, string[]>();
  for (const h of sorted) {
    const arr = byDay.get(h.weekday) ?? [];
    arr.push(`${h.start_minute}-${h.end_minute}`);
    byDay.set(h.weekday, arr);
  }
  const groups = new Map<string, number[]>();
  for (const [day, sigs] of byDay) {
    const key = sigs.join(',');
    const days = groups.get(key) ?? [];
    days.push(day);
    groups.set(key, days);
  }
  const parts: string[] = [];
  for (const [key, days] of groups) {
    const windows = key.split(',').map((sig) => {
      const [a, b] = sig.split('-').map(Number);
      return formatWindow(a, b);
    });
    const label = days.sort((a, b) => a - b).map((d) => WEEKDAY_ABBR[d]).join('/');
    parts.push(`${label} ${windows.join(', ')}`);
  }
  return parts.slice(0, 2).join(' · ') + (parts.length > 2 ? ' · …' : '');
}

/**
 * The backend raises `PICKUP_LOCATION_LIMIT:<allowance>:<message>` when an
 * insert would exceed the plan. Pull the allowance out so the UI can write
 * upgrade copy instead of showing a Postgres string.
 */
export function parsePickupLimitError(
  err: unknown,
): { allowance: number; message: string } | null {
  const raw =
    typeof err === 'string' ? err : ((err as { message?: unknown } | null)?.message ?? '');
  const m = /PICKUP_LOCATION_LIMIT:(\d+):([\s\S]*)/.exec(String(raw));
  if (!m) return null;
  return { allowance: parseInt(m[1], 10), message: m[2].trim() };
}

// ---------------------------------------------------------------------------
// Query keys
export const pickupKeys = {
  locations: (marketId?: string) => ['pickupLocations', marketId] as const,
  publicLocations: (marketId?: string) => ['publicPickupLocations', marketId] as const,
  allowance: (marketId?: string) => ['pickupLocationAllowance', marketId] as const,
  hours: (locationId?: string) => ['locationHours', locationId] as const,
  marketHours: (marketId?: string) => ['locationHoursByMarket', marketId] as const,
  exceptions: (locationId?: string) => ['locationExceptions', locationId] as const,
  slots: (locationId?: string, days?: number) => ['locationSlots', locationId, days] as const,
};

function invalidateLocations(
  qc: ReturnType<typeof useQueryClient>,
  marketId?: string,
) {
  qc.invalidateQueries({ queryKey: pickupKeys.locations(marketId) });
  qc.invalidateQueries({ queryKey: pickupKeys.publicLocations(marketId) });
  qc.invalidateQueries({ queryKey: ['locationSlots'] });
  // market_available_slots delegates to the default location, so the older
  // market-level slot cache in marketops has to go too.
  qc.invalidateQueries({ queryKey: ['pickupSlots'] });
}

// ---------------------------------------------------------------------------
// Reads
/** OWNER only — full rows including address_line/lat/lng, via SECURITY DEFINER. */
export function usePickupLocations(marketId?: string) {
  return useQuery({
    queryKey: pickupKeys.locations(marketId),
    enabled: isSupabaseConfigured && !!marketId,
    queryFn: async (): Promise<PickupLocation[]> => {
      const { data, error } = await supabase.rpc('my_pickup_locations', {
        p_market: marketId,
      });
      if (error) throw error;
      return (data ?? []) as PickupLocation[];
    },
  });
}

/** What buyers see before an order is confirmed. Safe columns only. */
export function usePublicPickupLocations(marketId?: string) {
  return useQuery({
    queryKey: pickupKeys.publicLocations(marketId),
    enabled: isSupabaseConfigured && !!marketId,
    queryFn: async (): Promise<PublicPickupLocation[]> => {
      const { data, error } = await supabase.rpc('public_pickup_locations', {
        p_market: marketId,
      });
      if (error) throw error;
      return (data ?? []) as PublicPickupLocation[];
    },
  });
}

/** How many active locations this Market's plan includes (free 1 / grower 3 / farm+sponsor 10). */
export function useLocationAllowance(marketId?: string) {
  return useQuery({
    queryKey: pickupKeys.allowance(marketId),
    enabled: isSupabaseConfigured && !!marketId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('market_pickup_location_allowance', {
        p_market: marketId,
      });
      if (error) throw error;
      return typeof data === 'number' ? data : 1;
    },
  });
}

/** Hours for ONE location. */
export function useLocationHours(locationId?: string) {
  return useQuery({
    queryKey: pickupKeys.hours(locationId),
    enabled: isSupabaseConfigured && !!locationId,
    queryFn: async (): Promise<LocationHours[]> => {
      const { data, error } = await supabase
        .from('market_pickup_hours')
        .select('*')
        .eq('location_id', locationId as string)
        .order('weekday')
        .order('start_minute');
      if (error) throw error;
      return (data ?? []) as LocationHours[];
    },
  });
}

/**
 * Every location's hours in one round trip — the manager list needs a schedule
 * summary per card and can't call useLocationHours inside a map.
 */
export function useAllLocationHours(marketId?: string) {
  return useQuery({
    queryKey: pickupKeys.marketHours(marketId),
    enabled: isSupabaseConfigured && !!marketId,
    queryFn: async (): Promise<LocationHours[]> => {
      const { data, error } = await supabase
        .from('market_pickup_hours')
        .select('*')
        .eq('market_id', marketId as string)
        .order('weekday')
        .order('start_minute');
      if (error) throw error;
      return (data ?? []) as LocationHours[];
    },
  });
}

export function useLocationExceptions(locationId?: string) {
  return useQuery({
    queryKey: pickupKeys.exceptions(locationId),
    enabled: isSupabaseConfigured && !!locationId,
    queryFn: async (): Promise<LocationException[]> => {
      const { data, error } = await supabase
        .from('market_pickup_exceptions')
        .select('*')
        .eq('location_id', locationId as string)
        .gte('date', new Date().toISOString().slice(0, 10))
        .order('date');
      if (error) throw error;
      return (data ?? []) as LocationException[];
    },
  });
}

/**
 * Server-generated slots for one location — the only truth about what's
 * bookable. A restricted or inactive location generates nothing.
 */
export function useLocationSlots(locationId?: string, days = 10) {
  return useQuery({
    queryKey: pickupKeys.slots(locationId, days),
    enabled: isSupabaseConfigured && !!locationId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<LocationSlot[]> => {
      const { data, error } = await supabase.rpc('location_available_slots', {
        p_location: locationId,
        p_days: days,
      });
      if (error) throw error;
      return (data ?? []) as LocationSlot[];
    },
  });
}

// ---------------------------------------------------------------------------
// Writes
/**
 * Insert (no `id`) or update (`id` given). Never chains .select() — see the
 * privacy contract at the top of this file. Returns the location id: the one
 * passed in on update, or the freshly created row's id resolved from a re-read
 * on insert (null when it can't be resolved, so callers never fake success).
 */
export function useSaveLocation(marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveLocationInput): Promise<string | null> => {
      const { id, ...patch } = input;
      if (!marketId) throw new Error('No Market yet.');

      if (id) {
        const { error } = await supabase
          .from('market_pickup_locations')
          .update(patch)
          .eq('id', id);
        if (error) throw error;
        return id;
      }

      const { error } = await supabase
        .from('market_pickup_locations')
        .insert({ market_id: marketId, ...patch });
      if (error) throw error;

      // Read back through the owner RPC to learn the new id (the insert
      // deliberately returned nothing).
      const { data, error: readErr } = await supabase.rpc('my_pickup_locations', {
        p_market: marketId,
      });
      if (readErr) return null;
      const rows = (data ?? []) as PickupLocation[];
      const mine = patch.nickname
        ? rows.filter((r) => r.nickname === patch.nickname)
        : rows;
      const newest = (mine.length ? mine : rows).reduce<PickupLocation | null>(
        (best, r) =>
          !best || new Date(r.created_at) > new Date(best.created_at) ? r : best,
        null,
      );
      return newest?.id ?? null;
    },
    onSuccess: (locationId, input) => {
      invalidateLocations(qc, marketId);
      if (locationId) qc.invalidateQueries({ queryKey: pickupKeys.hours(locationId) });
      void logEvent(input.id ? 'pickup_location_updated' : 'pickup_location_created', {
        metadata: { market_id: marketId },
      });
    },
  });
}

/**
 * Exactly one default per Market — the trigger clears the others, and also
 * forces the new default active + unrestricted.
 */
export function useSetDefaultLocation(marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (locationId: string): Promise<void> => {
      const { error } = await supabase
        .from('market_pickup_locations')
        .update({ is_default: true })
        .eq('id', locationId);
      if (error) throw error;
    },
    onSuccess: (_r, locationId) => {
      invalidateLocations(qc, marketId);
      void logEvent('pickup_location_default_set', {
        metadata: { market_id: marketId, location_id: locationId },
      });
    },
  });
}

/**
 * Turn a location off. Product rule: the default can't be deactivated — the
 * seller has to promote another location first. Screens check before calling;
 * this is the backstop so no path can quietly strand a Market with no default.
 */
export function useDeactivateLocation(marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: string | { id: string; isDefault?: boolean },
    ): Promise<void> => {
      const id = typeof input === 'string' ? input : input.id;
      if (typeof input !== 'string' && input.isDefault) {
        throw new Error(
          'This is your default pickup location. Set another location as the default first.',
        );
      }
      const { error } = await supabase
        .from('market_pickup_locations')
        .update({ active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_r, input) => {
      invalidateLocations(qc, marketId);
      void logEvent('pickup_location_deactivated', {
        metadata: {
          market_id: marketId,
          location_id: typeof input === 'string' ? input : input.id,
        },
      });
    },
  });
}

/** Re-run the plan sweep (e.g. right after an upgrade) — restrict/release rows. */
export function useReconcileLocations(marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ kept: number; restricted: number }> => {
      const { data, error } = await supabase.rpc('reconcile_pickup_locations', {
        p_market: marketId,
      });
      if (error) throw error;
      const row = ((data ?? []) as { kept: number; restricted: number }[])[0];
      return row ?? { kept: 0, restricted: 0 };
    },
    onSuccess: () => invalidateLocations(qc, marketId),
  });
}

/** Weekly window. Both location_id AND market_id are written — the backend
 *  still keys some legacy paths off market_id. */
export function useAddHour(locationId?: string, marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (w: {
      weekday: number;
      start_minute: number;
      end_minute: number;
    }): Promise<void> => {
      if (!locationId || !marketId) throw new Error('Save this location first.');
      const { error } = await supabase
        .from('market_pickup_hours')
        .insert({ market_id: marketId, location_id: locationId, ...w });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pickupKeys.hours(locationId) });
      qc.invalidateQueries({ queryKey: pickupKeys.marketHours(marketId) });
      qc.invalidateQueries({ queryKey: ['locationSlots'] });
      qc.invalidateQueries({ queryKey: ['pickupSlots'] });
    },
  });
}

export function useRemoveHour(locationId?: string, marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from('market_pickup_hours').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pickupKeys.hours(locationId) });
      qc.invalidateQueries({ queryKey: pickupKeys.marketHours(marketId) });
      qc.invalidateQueries({ queryKey: ['locationSlots'] });
      qc.invalidateQueries({ queryKey: ['pickupSlots'] });
    },
  });
}

export function useSaveException(locationId?: string, marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: {
      date: string;
      closed: boolean;
      start_minute?: number | null;
      end_minute?: number | null;
      note?: string | null;
    }): Promise<void> => {
      if (!locationId || !marketId) throw new Error('Save this location first.');
      const { error } = await supabase
        .from('market_pickup_exceptions')
        .insert({ market_id: marketId, location_id: locationId, ...e });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pickupKeys.exceptions(locationId) });
      qc.invalidateQueries({ queryKey: ['locationSlots'] });
      qc.invalidateQueries({ queryKey: ['pickupSlots'] });
    },
  });
}

export function useRemoveException(locationId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from('market_pickup_exceptions')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pickupKeys.exceptions(locationId) });
      qc.invalidateQueries({ queryKey: ['locationSlots'] });
      qc.invalidateQueries({ queryKey: ['pickupSlots'] });
    },
  });
}

/** Locations that actually consume plan allowance (matches the DB trigger). */
export function countLiveLocations(locations: PickupLocation[]): number {
  return locations.filter((l) => l.active && !l.plan_restricted).length;
}
