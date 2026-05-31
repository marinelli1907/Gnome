import React from 'react';
import { View, StyleSheet } from 'react-native';
import { EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import type { Listing } from '@/types';
import type { Coords } from '@/lib/location';

// Base / web implementation. react-native-maps is native-only, so Metro loads
// MapListings.native.tsx on iOS/Android and this file everywhere else.
export interface MapListingsProps {
  listings: Listing[];
  center: Coords | null;
}

export default function MapListings(_props: MapListingsProps) {
  return (
    <View style={styles.fill}>
      <EmptyState
        emoji="🗺️"
        title="Map view is on mobile"
        subtitle="Open Gnome on your phone to see listings on a map. Use the list view here on the web."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'center', backgroundColor: Colors.background },
});
