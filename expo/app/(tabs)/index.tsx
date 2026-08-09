import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
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
import { useListings, logEvent } from '@/lib/db';
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
      <View style={styles.brandRow}>
        <Image source={require('../../assets/images/badge.png')} style={styles.brandBadge} />
        <Text style={styles.brand}>Gnome</Text>
      </View>
      <Text style={styles.tagline}>Fresh from the garden next door.</Text>

      <Pressable style={styles.plannerBanner} onPress={() => router.push('/garden')}>
        <Text style={styles.plannerEmoji}>✨</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.plannerTitle}>Garden Planner</Text>
          <Text style={styles.plannerSub}>What should you plant this week? Ask the AI.</Text>
        </View>
        <Text style={styles.plannerArrow}>→</Text>
      </Pressable>

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

      {/* Seed Drop — first-party seed shop. Web-only by design (keeps the app
          payment-free); physical goods, so linking out is App Store-safe. */}
      <Pressable
        style={styles.seedDrop}
        onPress={() => {
          void logEvent('seed_drop_tapped', {});
          void Linking.openURL('https://gnomefarmersmarket.com/seeds');
        }}
      >
        <Text style={styles.seedDropEmoji}>🌱</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.seedDropTitle}>The Gnome Seed Drop</Text>
          <Text style={styles.seedDropSub}>
            Seeds picked for your zone & season, shipped to your door
          </Text>
        </View>
        <Text style={styles.seedDropGo}>›</Text>
      </Pressable>
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
  segmentText: { fontSize: 13, color: Colors.textSecondary, fontFamily: fonts.semibold },
  segmentTextActive: { color: Colors.primary, fontFamily: fonts.bold },
  brandBadge: { width: 34, height: 34, borderRadius: 17, marginRight: 10 },
  brand: { fontSize: 30, fontFamily: fonts.displayBlack, color: Colors.primaryDark },
  plannerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  plannerEmoji: { fontSize: 22, fontFamily: fonts.regular },
  plannerTitle: { fontFamily: fonts.bold, fontSize: 15, color: Colors.primary },
  plannerSub: { fontFamily: fonts.regular, fontSize: 12.5, color: Colors.textSecondary },
  plannerArrow: { fontFamily: fonts.bold, fontSize: 18, color: Colors.primary },
  tagline: { fontSize: 14, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2, marginBottom: 12 },
  chipRow: { marginHorizontal: -16 },
  chipRowContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  seedDrop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 6,
    padding: 14,
    borderRadius: 14,
    backgroundColor: Colors.primary + '10',
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  seedDropEmoji: { fontSize: 24, fontFamily: fonts.regular },
  seedDropTitle: { fontSize: 15, fontFamily: fonts.bold, color: Colors.text },
  seedDropSub: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 1 },
  seedDropGo: { fontSize: 22, color: Colors.primary, fontFamily: fonts.bold },
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
