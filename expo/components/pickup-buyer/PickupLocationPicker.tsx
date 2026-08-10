// Buyer-side pickup location chooser for the cart. Only rendered when a basket
// can genuinely be picked up in more than one place — one option states itself,
// zero options is a blocked cart (see PickupConflictNotice).
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { distanceMiles, fmtDistance, type Coords } from '@/lib/location';
import type { CartPickupLocation } from '@/lib/marketops';
import { locationTypeEmoji, locationTypeLabel } from './labels';

export function locationDistanceLabel(
  coords: Coords | null,
  loc: { approx_lat: number | null; approx_lng: number | null },
): string | null {
  if (!coords || loc.approx_lat == null || loc.approx_lng == null) return null;
  const mi = distanceMiles(coords, { lat: loc.approx_lat, lng: loc.approx_lng });
  const d = fmtDistance(mi);
  return d === 'Nearby' ? 'Nearby' : `${d} away`;
}

export default function PickupLocationPicker({
  locations,
  selectedId,
  onSelect,
  coords,
}: {
  locations: CartPickupLocation[];
  selectedId: string | null;
  onSelect: (locationId: string) => void;
  coords: Coords | null;
}) {
  return (
    <View style={styles.wrap}>
      {locations.map((l) => {
        const active = selectedId === l.location_id;
        const dist = locationDistanceLabel(coords, l);
        const type = locationTypeLabel(l.location_type);
        return (
          <Pressable
            key={l.location_id}
            onPress={() => onSelect(l.location_id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Pick up at ${l.nickname}. ${type}${dist ? `, ${dist}` : ''}.`}
            style={[styles.card, active && styles.cardActive]}
          >
            <Text style={styles.emoji}>{locationTypeEmoji(l.location_type)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.nickname, active && styles.nicknameActive]} numberOfLines={1}>
                {l.nickname}
              </Text>
              <Text style={[styles.meta, active && styles.metaActive]} numberOfLines={1}>
                {type}
                {dist ? ` · ${dist}` : ''}
                {l.is_default ? ' · Usual spot' : ''}
              </Text>
            </View>
            <View style={[styles.radio, active && styles.radioActive]}>
              {active ? <View style={styles.radioDot} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 60,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  cardActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '0D' },
  emoji: { fontSize: 18, fontFamily: fonts.regular },
  nickname: { fontSize: 15, fontFamily: fonts.bold, color: Colors.text },
  nicknameActive: { color: Colors.primary },
  meta: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  metaActive: { color: Colors.primaryLight },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: Colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
});
