import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import ListingCard from '@/components/ListingCard';
import { Skeleton } from '@/components/Skeleton';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { logEvent, useFeaturedListings, type BrowseFilters } from '@/lib/db';

const CARD_W = 300;

// "Featured Near You" rail. Hidden when fewer than 2 active promotions match.
// The organic feed stays organic — no promoted listings are mixed into it.
export default function FeaturedRail({ filters }: { filters: BrowseFilters }) {
  const { userId } = useAuth();
  const { data, isLoading } = useFeaturedListings(filters);
  const items = data ?? [];
  const show = items.length >= 2;

  useEffect(() => {
    if (show) void logEvent('featured_rail_viewed', { userId: userId ?? null, metadata: { count: items.length } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, items.length]);

  if (isLoading) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>✨ Featured Near You</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          <Skeleton style={styles.skel} />
          <Skeleton style={styles.skel} />
        </ScrollView>
      </View>
    );
  }
  if (!show) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>✨ Featured Near You</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((l) => (
          <View key={l.id} style={styles.card}>
            <ListingCard listing={l} promoted />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  label: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text, paddingHorizontal: 16, marginBottom: 8 },
  row: { paddingHorizontal: 16, gap: 12 },
  card: { width: CARD_W },
  skel: { width: CARD_W, height: 300, borderRadius: 18 },
});
