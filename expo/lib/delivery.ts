// Delivery — seller settings, buyer addresses, quotes, and candidate windows.
//
// Privacy model mirrors the backend (0063/0065/0066): the settings row is
// world-readable (radius/fees/timing only — no coordinates); buyer addresses
// are RLS'd to their owner and their coords only ever meet the seller's
// private origin inside SECURITY DEFINER functions. The client never computes
// an authoritative fee — delivery_quote() does, and create_market_order
// re-runs it server-side.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from './supabase';

// ---------------------------------------------------------------------------
// Types (mirror market_delivery_settings / buyer_delivery_addresses)
// ---------------------------------------------------------------------------
export interface DeliverySettings {
  market_id: string;
  enabled: boolean;
  radius_miles: number | null;
  flat_fee_cents: number;
  surcharge_after_miles: number | null;
  surcharge_fee_cents: number | null;
  same_day: boolean;
  same_day_cutoff: string | null; // "HH:MM:SS"
  next_day: boolean;
  next_day_cutoff: string | null;
  scheduled: boolean;
  order_by_dow: number | null; // 0 = Sunday
  delivery_dows: number[];
  tz: string;
  notes: string | null;
}

export interface BuyerAddress {
  id: string;
  buyer_id: string;
  label: string;
  address_line: string;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  delivery_notes: string | null;
  is_default: boolean;
}

export interface DeliveryQuote {
  eligible: boolean;
  reason: string | null;
  distance_miles: number | null;
  base_fee_cents: number | null;
  surcharge_cents: number | null;
  total_fee_cents: number | null;
  rule: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Seller settings
// ---------------------------------------------------------------------------
export function useDeliverySettings(marketId?: string) {
  return useQuery({
    queryKey: ['deliverySettings', marketId],
    enabled: isSupabaseConfigured && !!marketId,
    queryFn: async (): Promise<DeliverySettings | null> => {
      const { data, error } = await supabase
        .from('market_delivery_settings')
        .select('*')
        .eq('market_id', marketId as string)
        .maybeSingle();
      if (error) throw error;
      return data as DeliverySettings | null;
    },
  });
}

export function useSaveDeliverySettings(marketId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<DeliverySettings>): Promise<void> => {
      const { error } = await supabase
        .from('market_delivery_settings')
        .upsert({ market_id: marketId, ...patch }, { onConflict: 'market_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deliverySettings', marketId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Buyer addresses
// ---------------------------------------------------------------------------
export function useMyAddresses(uid?: string) {
  return useQuery({
    queryKey: ['myAddresses', uid],
    enabled: isSupabaseConfigured && !!uid,
    queryFn: async (): Promise<BuyerAddress[]> => {
      const { data, error } = await supabase
        .from('buyer_delivery_addresses')
        .select('*')
        .order('is_default', { ascending: false })
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as BuyerAddress[];
    },
  });
}

/**
 * Keyless forward geocoding (OpenStreetMap Nominatim) — same boundary the
 * website uses. The coords land in the buyer's own PRIVATE address row.
 */
export async function forwardGeocode(q: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'GnomeFarmersMarket/1.0' } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { lat: string; lon: string }[];
    if (!rows[0]) return null;
    return { lat: +rows[0].lat, lng: +rows[0].lon };
  } catch {
    return null;
  }
}

export function useSaveAddress(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      label: string;
      address_line: string;
      city?: string | null;
      state?: string | null;
      postal_code?: string | null;
      delivery_notes?: string | null;
      is_default?: boolean;
    }): Promise<string> => {
      if (!uid) throw new Error('Sign in first.');
      // Geocode before save so the quote can run; a failed geocode still
      // saves (the server answers ADDRESS_NOT_LOCATED until it resolves).
      const q = [input.address_line, input.city, input.state, input.postal_code]
        .filter(Boolean).join(', ');
      const geo = await forwardGeocode(q);
      const row = {
        buyer_id: uid,
        label: input.label,
        address_line: input.address_line,
        city: input.city ?? null,
        state: input.state ?? null,
        postal_code: input.postal_code ?? null,
        delivery_notes: input.delivery_notes ?? null,
        is_default: input.is_default ?? false,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
      };
      if (input.id) {
        const { error } = await supabase
          .from('buyer_delivery_addresses').update(row).eq('id', input.id);
        if (error) throw error;
        return input.id;
      }
      let { data, error } = await supabase
        .from('buyer_delivery_addresses').insert(row).select('id').single();
      if (error && error.code === '23505' && row.is_default) {
        // A default already exists (cache raced) — save as non-default.
        ({ data, error } = await supabase
          .from('buyer_delivery_addresses')
          .insert({ ...row, is_default: false }).select('id').single());
      }
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['myAddresses'] });
      void qc.invalidateQueries({ queryKey: ['deliveryQuote'] });
    },
  });
}

export function useDeleteAddress(uid?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from('buyer_delivery_addresses').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['myAddresses'] }),
  });
}

// ---------------------------------------------------------------------------
// Quote — authoritative, server-side
// ---------------------------------------------------------------------------
export function useDeliveryQuote(marketId?: string, addressId?: string | null) {
  return useQuery({
    queryKey: ['deliveryQuote', marketId, addressId],
    enabled: isSupabaseConfigured && !!marketId && !!addressId,
    queryFn: async (): Promise<DeliveryQuote | null> => {
      const { data, error } = await supabase.rpc('delivery_quote', {
        p_market: marketId,
        p_address: addressId,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as DeliveryQuote | null;
    },
  });
}

// ---------------------------------------------------------------------------
// Candidate delivery windows — CLIENT-SIDE SUGGESTIONS ONLY. The server
// re-validates cutoffs/days in create_market_order; these just give the buyer
// sensible taps. Evening window default; the propose/confirm negotiation
// refines the exact time with the seller.
// ---------------------------------------------------------------------------
export interface DeliveryWindow {
  slot_start: string;
  slot_end: string;
  label: string;
}

export function deliveryWindows(ds: DeliverySettings, days = 10): DeliveryWindow[] {
  const out: DeliveryWindow[] = [];
  // Evaluate "today"/cutoffs in the MARKET's timezone — the server does, and a
  // buyer travelling (or a device set to another tz) must see the same days.
  const now = new Date();
  const marketNow = new Date(now.toLocaleString('en-US', { timeZone: ds.tz || 'America/New_York' }));
  for (let i = 0; i < days; i++) {
    const day = new Date(marketNow.getFullYear(), marketNow.getMonth(), marketNow.getDate() + i);
    const dow = day.getDay();
    let ok = false;
    if (i === 0 && ds.same_day) {
      const cutoff = ds.same_day_cutoff?.slice(0, 5);
      if (!cutoff || fmtHM(marketNow) <= cutoff) ok = true;
    } else if (i === 1 && ds.next_day) {
      const cutoff = ds.next_day_cutoff?.slice(0, 5);
      if (!cutoff || fmtHM(marketNow) <= cutoff) ok = true;
    }
    if (!ok && i >= 1 && ds.scheduled && ds.delivery_dows.includes(dow)) {
      // order-by rule: the order-by day for this delivery day must not be past
      if (ds.order_by_dow == null) ok = true;
      else {
        const daysBack = (7 + dow - ds.order_by_dow) % 7;
        const orderBy = new Date(day.getFullYear(), day.getMonth(), day.getDate() - daysBack);
        ok = marketNow <= new Date(orderBy.getFullYear(), orderBy.getMonth(), orderBy.getDate(), 23, 59, 59);
      }
    }
    // No timing modes at all → any future day works (flat local delivery).
    if (!ok && !ds.same_day && !ds.next_day && !ds.scheduled && i >= 1) ok = true;
    if (!ok) continue;

    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 17, 0, 0);
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 19, 0, 0);
    if (start <= now) continue;
    out.push({
      slot_start: start.toISOString(),
      slot_end: end.toISOString(),
      label: `${day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · 5–7 PM`,
    });
    if (out.length >= 7) break;
  }
  return out;
}

function fmtHM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
