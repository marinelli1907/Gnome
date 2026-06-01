import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MapPin } from 'lucide-react-native';
import ListingCard from '@/components/ListingCard';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import type { Listing } from '@/types';
import type { Coords } from '@/lib/location';

export interface MapListingsProps {
  listings: Listing[];
  center: Coords | null;
  onSelect?: (l: Listing) => void;
}

// react-native-maps is native-only. On web (and Expo Go preview) we don't crash
// or block — we show a clear note and fall back to the listings as cards.
export default function MapListings({ listings }: MapListingsProps) {
  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
      <View style={styles.notice}>
        <MapPin size={18} color={Colors.primary} />
        <Text style={styles.noticeText}>
          The live map is on the Gnome mobile app. Here are the nearby listings.
        </Text>
      </View>
      {listings.map((l) => (
        <ListingCard key={l.id} listing={l} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  noticeText: { flex: 1, fontSize: 13, fontFamily: fonts.medium, color: Colors.textSecondary },
});
