// Public "Pickup options" for a Market page. Addresses come only from
// public_pickup_locations — when the RPC hands back null (a private residence,
// or a public spot the seller didn't opt into publishing) we say the address
// arrives after confirmation. We never invent or approximate one.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { distanceMiles, fmtDistance, type Coords } from '@/lib/location';
import type { PublicPickupLocation } from '@/lib/marketops';
import { ADDRESS_AFTER_CONFIRMATION, locationTypeEmoji, locationTypeLabel } from './labels';

/** Miles to the nearest location with an approximate point, or null. */
export function nearestPickupMiles(
  coords: Coords | null,
  locations: PublicPickupLocation[],
): number | null {
  if (!coords) return null;
  const dists = locations
    .filter((l) => l.approx_lat != null && l.approx_lng != null)
    .map((l) => distanceMiles(coords, { lat: l.approx_lat as number, lng: l.approx_lng as number }));
  if (!dists.length) return null;
  return Math.min(...dists);
}

function distLabel(coords: Coords | null, l: PublicPickupLocation): string | null {
  if (!coords || l.approx_lat == null || l.approx_lng == null) return null;
  const d = fmtDistance(distanceMiles(coords, { lat: l.approx_lat, lng: l.approx_lng }));
  return d === 'Nearby' ? 'Nearby' : `${d} away`;
}

export default function PickupOptions({
  locations,
  coords,
}: {
  locations: PublicPickupLocation[];
  coords: Coords | null;
}) {
  if (!locations.length) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Pickup options</Text>
      {locations.map((l) => {
        const type = locationTypeLabel(l.location_type);
        const dist = distLabel(coords, l);
        return (
          <View
            key={l.location_id}
            style={styles.row}
            accessibilityLabel={`${l.nickname}. ${type}${dist ? `, ${dist}` : ''}. ${
              l.public_address ?? ADDRESS_AFTER_CONFIRMATION
            }`}
          >
            <Text style={styles.emoji}>{locationTypeEmoji(l.location_type)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.nickname} numberOfLines={1}>
                {l.nickname}
                {l.is_default ? ' · Usual spot' : ''}
              </Text>
              <Text style={styles.meta}>
                {type}
                {dist ? ` · ${dist}` : ''}
              </Text>
              {l.public_address ? (
                <Text style={styles.address}>{l.public_address}</Text>
              ) : (
                <Text style={styles.pending}>{ADDRESS_AFTER_CONFIRMATION}</Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', marginTop: 16, gap: 8 },
  heading: { fontSize: 14, fontFamily: fonts.bold, color: Colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    padding: 12,
  },
  emoji: { fontSize: 17, fontFamily: fonts.regular, marginTop: 1 },
  nickname: { fontSize: 14.5, fontFamily: fonts.bold, color: Colors.text },
  meta: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  address: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.text, marginTop: 4, lineHeight: 18 },
  pending: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textTertiary, marginTop: 4, lineHeight: 18 },
});
