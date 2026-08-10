// Shown when cart_pickup_locations returns zero locations: the basket has no
// single spot that can fulfil all of it. Rather than a dead end, we narrow the
// blame — one extra pass of the same RPC per item (cart-minus-that-item) tells
// the buyer exactly what to drop. Only runs while the cart is actually blocked.
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

const MAX_PROBED_ITEMS = 8;

export interface ConflictLine {
  listingId: string;
  title: string;
}

/**
 * Items whose removal would leave the rest of the basket with a shared pickup
 * location. Empty result = no single item explains it (or we didn't probe).
 */
export function useCartConflictCulprits(
  marketId: string | undefined,
  lines: ConflictLine[],
  enabled: boolean,
) {
  const ids = lines.map((l) => l.listingId).sort();
  const probeable = enabled && lines.length > 1 && lines.length <= MAX_PROBED_ITEMS;
  return useQuery({
    queryKey: ['cartPickupConflict', marketId, ids.join(',')],
    enabled: isSupabaseConfigured && !!marketId && probeable,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<string[]> => {
      const culprits: string[] = [];
      for (const line of lines) {
        const rest = lines.filter((l) => l.listingId !== line.listingId).map((l) => l.listingId);
        if (rest.length === 0) continue;
        const { data, error } = await supabase.rpc('cart_pickup_locations', {
          p_market: marketId,
          p_listings: rest,
        });
        if (error) throw error;
        if (((data ?? []) as unknown[]).length > 0) culprits.push(line.title);
      }
      return culprits;
    },
  });
}

export default function PickupConflictNotice({
  marketId,
  lines,
}: {
  marketId?: string;
  lines: ConflictLine[];
}) {
  const culprits = useCartConflictCulprits(marketId, lines, true);
  const single = lines.length === 1;

  let guidance: string;
  if (single) {
    guidance = `“${lines[0].title}” has no pickup location set up yet. Message the seller, or order something else from this Market.`;
  } else if (culprits.data && culprits.data.length === 1) {
    guidance = `Removing “${culprits.data[0]}” would let the rest be picked up together. You can order it separately.`;
  } else if (culprits.data && culprits.data.length > 1) {
    guidance = `Try removing one of: ${culprits.data.slice(0, 4).join(', ')}. Anything you drop can be ordered on its own.`;
  } else {
    guidance = 'Remove an item and try again — or place a separate order for each pickup spot.';
  }

  return (
    <View
      style={styles.card}
      accessibilityRole="alert"
      accessibilityLabel={`These items aren't available for pickup at the same location. ${guidance}`}
    >
      <Text style={styles.title}>These items aren’t available for pickup at the same location.</Text>
      {culprits.isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={Colors.error} size="small" />
          <Text style={styles.body}>Working out which item is the odd one…</Text>
        </View>
      ) : (
        <Text style={styles.body}>{guidance}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.error + '0D',
    borderWidth: 1,
    borderColor: Colors.error + '55',
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    gap: 6,
  },
  title: { fontSize: 14.5, fontFamily: fonts.bold, color: Colors.error, lineHeight: 20 },
  body: { fontSize: 13.5, fontFamily: fonts.regular, color: Colors.text, lineHeight: 19 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
