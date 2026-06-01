import React from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import type { Listing, ListingType } from '@/types';
import type { Coords } from '@/lib/location';
import { TYPE_COLOR } from '@/lib/listingType';

const DEFAULT = { lat: 41.5573, lng: -81.5101 }; // Richmond Heights, OH 44143

// Pins use APPROXIMATE (rounded) coordinates only — exact location is never
// exposed (see 0009_map_privacy.sql). Tapping a pin calls onSelect.
export default function MapListings({
  listings,
  center,
  onSelect,
}: {
  listings: Listing[];
  center: Coords | null;
  onSelect?: (l: Listing) => void;
}) {
  const withCoords = listings.filter((l) => l.approx_lat != null && l.approx_lng != null);
  const origin = center ?? DEFAULT;

  return (
    <View style={styles.fill}>
      <MapView
        style={styles.fill}
        initialRegion={{
          latitude: origin.lat,
          longitude: origin.lng,
          latitudeDelta: 0.35,
          longitudeDelta: 0.35,
        }}
        showsUserLocation={!!center}
      >
        {withCoords.map((l) => {
          const type: ListingType = l.listing_type ?? (l.kind === 'wanted' ? 'wanted' : 'free');
          return (
            <Marker
              key={l.id}
              coordinate={{ latitude: l.approx_lat as number, longitude: l.approx_lng as number }}
              pinColor={TYPE_COLOR[type]}
              onPress={() => onSelect?.(l)}
            />
          );
        })}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
