import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ListingCard from '@/components/ListingCard';
import FeaturedRail from '@/components/FeaturedRail';
import { EmptyState, ErrorState, Button } from '@/components/ui';
import { FeedSkeleton } from '@/components/Skeleton';
import { fonts } from '@/constants/theme';
import { TYPE_FILTERS } from '@/lib/listingType';
import type { ListingType } from '@/types';
import { CATEGORIES } from '@/constants/categories';
import Colors from '@/constants/colors';
import { useListings } from '@/lib/db';
import {
  getCurrentCoords,
  RADIUS_OPTIONS,
  type Coords,
  type RadiusOption,
} from '@/lib/location';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function BrowseScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [coords, setCoords] = useState<Coords | null>(null);
  const [radius, setRadius] = useState<RadiusOption>(10);
  const [category, setCategory] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | ListingType>('all');

  useEffect(() => {
    void getCurrentCoords().then(setCoords);
  }, []);

  const filters = useMemo(
    () => ({ coords, radius, category, listingType: typeFilter }),
    [coords, radius, category, typeFilter],
  );
  const { data, isLoading, refetch, isRefetching, error } = useListings(filters);

  const Header = (
    <View style={styles.header}>
      <Text style={styles.brand}>🍅 Gnome</Text>
      <Text style={styles.tagline}>Fresh surplus from neighbors near you</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chipRowContent}
      >
        {TYPE_FILTERS.map((opt) => {
          const active = typeFilter === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setTypeFilter(opt.value)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chipRowContent}
      >
        {RADIUS_OPTIONS.map((opt) => {
          const active = radius === opt.value;
          return (
            <Pressable
              key={String(opt.value)}
              onPress={() => setRadius(opt.value)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chipRowContent}
      >
        <Pressable
          onPress={() => setCategory(null)}
          style={[styles.chip, !category && styles.chipActive]}
        >
          <Text style={[styles.chipText, !category && styles.chipTextActive]}>All</Text>
        </Pressable>
        {CATEGORIES.map((c) => {
          const active = category === c.id;
          return (
            <Pressable
              key={c.id}
              onPress={() => setCategory(active ? null : c.id)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {c.emoji} {c.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FeaturedRail filters={filters} />
    </View>
  );

  const emptyComponent = () => {
    if (isLoading) return <FeedSkeleton count={4} />;
    if (!isSupabaseConfigured) {
      return (
        <EmptyState
          emoji="🔌"
          title="Connect Supabase"
          subtitle="Add your Supabase URL and anon key to a .env file, then restart Expo to load real listings."
        />
      );
    }
    if (error) {
      return (
        <ErrorState
          title="Couldn’t load nearby listings"
          message="Check your connection and try again."
          onRetry={() => refetch()}
        />
      );
    }
    return (
      <EmptyState
        emoji="🌱"
        title="Nothing fresh nearby yet"
        subtitle="Be the first grower in your area — share something from your garden."
      >
        <Button label="Create listing" onPress={() => router.push('/post')} style={{ marginTop: 12, paddingHorizontal: 28 }} />
      </EmptyState>
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <FlatList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={Header}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <ListingCard listing={item} />
          </View>
        )}
        ListEmptyComponent={emptyComponent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  list: { paddingBottom: 32 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modeBtnText: { color: Colors.primary, fontFamily: fonts.bold, fontSize: 13 },
  kindFilterRow: {
    flexDirection: 'row',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 3,
    marginTop: 12,
    marginBottom: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
  },
  segmentActive: { backgroundColor: Colors.surface },
  segmentText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  segmentTextActive: { color: Colors.primary, fontWeight: '700' },
  brand: { fontSize: 28, fontFamily: fonts.bold, color: Colors.primaryDark },
  tagline: { fontSize: 14, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2, marginBottom: 12 },
  chipRow: { marginHorizontal: -16 },
  chipRowContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary },
  chipTextActive: { color: Colors.textInverse },
  cardWrap: { paddingHorizontal: 16 },
});
