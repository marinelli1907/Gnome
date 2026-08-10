// Per-listing pickup availability (`listing_pickup_locations`).
//
// The table is an OVERRIDE, not a requirement: NO rows means "wherever the
// Market says", which is the right answer for almost every seller. So we only
// ever write rows when the seller deliberately narrowed the list, and an empty
// selection deletes back to the default rather than writing "nowhere".
import { useQuery } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

/** Location ids already pinned to a listing. Empty = uses the Market default. */
export function useListingPickupLocations(listingId?: string) {
  return useQuery({
    queryKey: ['listingPickupLocations', listingId],
    enabled: isSupabaseConfigured && !!listingId,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('listing_pickup_locations')
        .select('location_id')
        .eq('listing_id', listingId as string);
      if (error) throw error;
      return ((data ?? []) as { location_id: string }[]).map((r) => r.location_id);
    },
  });
}

/**
 * Delete-then-insert. Throws on failure so callers can tell the seller the
 * listing saved but its pickup spots didn't — never swallowed into fake success.
 */
export async function saveListingPickupLocations(
  listingId: string,
  locationIds: string[],
): Promise<void> {
  const { error: delErr } = await supabase
    .from('listing_pickup_locations')
    .delete()
    .eq('listing_id', listingId);
  if (delErr) throw delErr;
  if (!locationIds.length) return; // back to "use the Market default"
  const { error: insErr } = await supabase
    .from('listing_pickup_locations')
    .insert(locationIds.map((location_id) => ({ listing_id: listingId, location_id })));
  if (insErr) throw insErr;
}

/** Same set, order-insensitive — used to tell "seller changed it" from "seeded". */
export function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}
