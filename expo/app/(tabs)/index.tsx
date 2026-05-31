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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ListingCard from '@/components/ListingCard';
import { EmptyState } from '@/components/ui';
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
  const [coords, setCoords] = useState<Coords | null>(null);
  const [radius, setRadius] = useState<RadiusOption>(10);
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => {
    void getCurrentCoords().then(setCoords);
  }, []);

  const filters = useMemo(
    () => ({ coords, radius, category }),
    [coords, radius, category],
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
    </View>
  );

  const empty = !isSupabaseConfigured ? (
    <EmptyState
      emoji="🔌"
      title="Connect Supabase"
      subtitle="Add your Supabase URL and anon key to a .env file, then restart Expo to load real listings."
    />
  ) : error ? (
    <EmptyState emoji="⚠️" title="Couldn't load listings" subtitle={String((error as Error).message)} />
  ) : (
    <EmptyState
      emoji="🌱"
      title="No listings nearby yet"
      subtitle="Be the first to share — widen the radius or post your own surplus from the Post tab."
    />
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <FlatList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        numColumns={2}
        ListHeaderComponent={Header}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <ListingCard listing={item} />
          </View>
        )}
        ListEmptyComponent={isLoading ? null : empty}
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
  brand: { fontSize: 28, fontWeight: '800', color: Colors.primaryDark },
  tagline: { fontSize: 14, color: Colors.textSecondary, marginTop: 2, marginBottom: 12 },
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
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  chipTextActive: { color: Colors.textInverse },
  row: { paddingHorizontal: 12, gap: 12 },
  cardWrap: { flex: 1, marginBottom: 12 },
});
