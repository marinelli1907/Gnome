import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useRouter } from 'expo-router';
import type { Listing } from '@/types';
import type { Coords } from '@/lib/location';
import { categoryFor } from '@/constants/categories';
import Colors from '@/constants/colors';

export default function MapListings({
  listings,
  center,
}: {
  listings: Listing[];
  center: Coords | null;
}) {
  const router = useRouter();
  const withCoords = listings.filter((l) => l.lat != null && l.lng != null);
  const origin = center ?? (withCoords[0]?.lat != null
    ? { lat: withCoords[0].lat as number, lng: withCoords[0].lng as number }
    : { lat: 41.5573, lng: -81.5101 }); // Richmond Heights, OH 44143 default

  return (
    <View style={styles.fill}>
      <MapView
        style={styles.fill}
        initialRegion={{
          latitude: origin.lat,
          longitude: origin.lng,
          latitudeDelta: 0.2,
          longitudeDelta: 0.2,
        }}
        showsUserLocation
      >
        {withCoords.map((l) => (
          <Marker
            key={l.id}
            coordinate={{ latitude: l.lat as number, longitude: l.lng as number }}
            title={l.title}
            description={categoryFor(l.category).label}
            onCalloutPress={() => router.push(`/listing/${l.id}`)}
          />
        ))}
      </MapView>
      {withCoords.length === 0 && (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.overlayText}>No mapped listings in range yet</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  overlayText: { color: Colors.textSecondary, fontWeight: '600' },
});
