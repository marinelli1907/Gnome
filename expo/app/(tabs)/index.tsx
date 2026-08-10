import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, SlidersHorizontal, X } from 'lucide-react-native';
import ListingCard from '@/components/ListingCard';
import DistancePicker from '@/components/DistancePicker';
import FeaturedRail from '@/components/FeaturedRail';
import TaxonomyPicker from '@/components/TaxonomyPicker';
import { EmptyState, ErrorState, Button } from '@/components/ui';
import { FeedSkeleton } from '@/components/Skeleton';
import { fonts } from '@/constants/theme';
import { TYPE_FILTERS } from '@/lib/listingType';
import type { ListingType } from '@/types';
import Colors from '@/constants/colors';
import { useListings, logEvent } from '@/lib/db';
import {
  useTaxonomy,
  subtreeIds,
  matchNodes,
  nodeInAnySubtree,
  breadcrumb,
} from '@/lib/taxonomy';
import {
  DEFAULT_BROWSE_RADIUS,
  getCoordsIfGranted,
  getCurrentCoords,
  loadBrowseRadius,
  radiusLabel,
  saveBrowseRadius,
  type BrowseRadius,
  type Coords,
} from '@/lib/location';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function BrowseScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [coords, setCoords] = useState<Coords | null>(null);
  const [radius, setRadiusState] = useState<BrowseRadius>(DEFAULT_BROWSE_RADIUS);
  const [distanceOpen, setDistanceOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | ListingType>('all');
  const [taxNodeId, setTaxNodeId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const setRadius = (r: BrowseRadius) => {
    setRadiusState(r);
    void saveBrowseRadius(r); // persists across restarts
  };

  useEffect(() => {
    void loadBrowseRadius().then(setRadiusState);
    // First mount may prompt (existing behavior — iOS shows the sheet once).
    void getCurrentCoords().then(setCoords);
  }, []);

  // Refresh the reading when the app returns to the foreground — no prompt,
  // no background tracking; a single fix each time the user comes back.
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        void getCoordsIfGranted().then((c) => {
          if (c) setCoords(c);
        });
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  const taxonomy = useTaxonomy();
  const index = taxonomy.data;
  const selectedNode = index && taxNodeId ? index.byId.get(taxNodeId) ?? null : null;

  const taxonomyIds = useMemo(
    () => (index && selectedNode ? subtreeIds(index, selectedNode) : null),
    [index, selectedNode],
  );

  const filters = useMemo(
    () => ({ coords, radius, category: null, listingType: typeFilter, taxonomyIds }),
    [coords, radius, typeFilter, taxonomyIds],
  );
  const { data, isLoading, refetch, isRefetching, error } = useListings(filters);

  // Alias-aware search over the fetched page: a listing matches when its
  // title/description contains the query OR its taxonomy node sits inside any
  // node the query matched by name/synonym (backend data, nothing hardcoded).
  const visible = useMemo(() => {
    const base = data ?? [];
    const q = search.trim().toLowerCase();
    if (!q || !index) return base;
    const matched = matchNodes(index, q);
    return base.filter((l) => {
      if (l.title.toLowerCase().includes(q)) return true;
      if (l.description?.toLowerCase().includes(q)) return true;
      return nodeInAnySubtree(index, l.taxonomy_node_id, matched);
    });
  }, [data, search, index]);

  const filtering = !!selectedNode || !!search.trim();

  const Header = (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <Image source={require('../../assets/images/badge.png')} style={styles.brandBadge} />
        <Text style={styles.brand}>Gnome</Text>
      </View>
      <Text style={styles.tagline}>Fresh from the garden next door.</Text>

      {/* Search — matches titles, descriptions, and category names/aliases */}
      <View style={styles.searchRow}>
        <Search size={17} color={Colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search — try “hamburger” or “worms”"
          placeholderTextColor={Colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search listings"
        />
        {search ? (
          <Pressable
            onPress={() => setSearch('')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <X size={17} color={Colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      {!filtering && (
        <Pressable style={styles.plannerBanner} onPress={() => router.push('/garden')}>
          <Text style={styles.plannerEmoji}>✨</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.plannerTitle}>Garden Planner</Text>
            <Text style={styles.plannerSub}>What should you plant this week? Ask the AI.</Text>
          </View>
          <Text style={styles.plannerArrow}>→</Text>
        </Pressable>
      )}

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
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              hitSlop={6}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Taxonomy: top-level chips from the backend tree + full drilldown */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chipRowContent}
      >
        <Pressable
          onPress={() => setTaxNodeId(null)}
          accessibilityRole="button"
          accessibilityState={{ selected: !selectedNode }}
          hitSlop={6}
          style={[styles.chip, !selectedNode && styles.chipActive]}
        >
          <Text style={[styles.chipText, !selectedNode && styles.chipTextActive]}>All</Text>
        </Pressable>
        {(index?.roots ?? []).map((root) => {
          const active =
            !!selectedNode &&
            (selectedNode.id === root.id || selectedNode.path.startsWith(root.path + '/'));
          return (
            <Pressable
              key={root.id}
              onPress={() => {
                if (active && selectedNode?.id === root.id) setPickerOpen(true);
                else setTaxNodeId(root.id);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              hitSlop={6}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {root.icon ? `${root.icon} ` : ''}{root.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Active filter chips: what's applied, one tap to refine or remove */}
      {selectedNode && index ? (
        <View style={styles.activeRow}>
          <Pressable
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Refine category, currently ${breadcrumb(index, selectedNode)}`}
            style={styles.activeChip}
          >
            <SlidersHorizontal size={13} color={Colors.textInverse} />
            <Text style={styles.activeChipText} numberOfLines={1}>
              {breadcrumb(index, selectedNode)}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTaxNodeId(null)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Remove category filter"
            style={styles.activeClear}
          >
            <X size={15} color={Colors.primary} />
          </Pressable>
        </View>
      ) : index ? (
        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          style={styles.browseAll}
        >
          <Text style={styles.browseAllText}>Browse all categories ›</Text>
        </Pressable>
      ) : null}

      {/* Distance sits last: it's the filter people reach for after they've
          decided what they're looking for. */}
      <View style={styles.distanceRow}>
        <Pressable
          onPress={() => setDistanceOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Distance filter: ${radiusLabel(radius)}. Tap to change.`}
          hitSlop={6}
          style={[styles.chip, styles.chipActive]}
        >
          <Text style={[styles.chipText, styles.chipTextActive]}>
            📍 {radiusLabel(radius)}
          </Text>
        </Pressable>
        {radius !== 'anywhere' && !coords ? (
          <Pressable
            onPress={() => {
              void getCurrentCoords().then((c) => {
                setCoords(c);
                if (!c) void Linking.openSettings();
              });
            }}
            accessibilityRole="button"
            hitSlop={6}
            style={styles.locateHint}
          >
            <Text style={styles.locateHintText}>Location is needed to filter by distance — use current location</Text>
          </Pressable>
        ) : null}
      </View>

      {!filtering && <FeaturedRail filters={filters} />}

      {/* Seed Drop — first-party seed shop. Web-only by design (keeps the app
          payment-free); physical goods, so linking out is App Store-safe. */}
      {!filtering && (
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
      )}
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
    if (filtering) {
      return (
        <EmptyState
          emoji="🔍"
          title="No matches nearby"
          subtitle="Try a wider radius, a broader category, or a different search."
        >
          <Button
            label="Clear filters"
            variant="secondary"
            onPress={() => {
              setTaxNodeId(null);
              setSearch('');
            }}
            style={{ marginTop: 12, paddingHorizontal: 28 }}
          />
        </EmptyState>
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
        data={visible}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={Header}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <ListingCard listing={item} />
          </View>
        )}
        ListEmptyComponent={emptyComponent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              // A browse refresh also refreshes the location fix (no prompt).
              void getCoordsIfGranted().then((c) => {
                if (c) setCoords(c);
              });
              void refetch();
            }}
            tintColor={Colors.primary}
          />
        }
      />
      <DistancePicker
        visible={distanceOpen}
        value={radius}
        onApply={setRadius}
        onClose={() => setDistanceOpen(false)}
      />
      {index ? (
        <TaxonomyPicker
          visible={pickerOpen}
          index={index}
          selectedId={taxNodeId}
          mode="filter"
          onSelect={(node) => setTaxNodeId(node?.id ?? null)}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  list: { paddingBottom: 32 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  brandBadge: { width: 34, height: 34, borderRadius: 17, marginRight: 10 },
  brand: { fontSize: 30, fontFamily: fonts.displayBlack, color: Colors.primaryDark },
  tagline: { fontSize: 14, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2, marginBottom: 12 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 44,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: fonts.regular,
    color: Colors.text,
    paddingVertical: 10,
  },
  plannerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  plannerEmoji: { fontSize: 22, fontFamily: fonts.regular },
  plannerTitle: { fontFamily: fonts.bold, fontSize: 15, color: Colors.primary },
  plannerSub: { fontFamily: fonts.regular, fontSize: 12.5, color: Colors.textSecondary },
  plannerArrow: { fontFamily: fonts.bold, fontSize: 18, color: Colors.primary },
  chipRow: { marginHorizontal: -16 },
  chipRowContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  distanceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10, flexWrap: 'wrap' },
  locateHint: { flexShrink: 1, minHeight: 34, justifyContent: 'center' },
  locateHintText: { fontSize: 12.5, fontFamily: fonts.semibold, color: Colors.primary },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    minHeight: 34,
    borderRadius: 20,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary },
  chipTextActive: { color: Colors.textInverse },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 20,
    paddingHorizontal: 14,
    minHeight: 36,
    maxWidth: '82%',
  },
  activeChipText: { color: Colors.textInverse, fontFamily: fonts.semibold, fontSize: 13 },
  activeClear: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  browseAll: { minHeight: 40, justifyContent: 'center', marginBottom: 6 },
  browseAllText: { color: Colors.primary, fontFamily: fonts.bold, fontSize: 14 },
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
  cardWrap: { paddingHorizontal: 16 },
});
