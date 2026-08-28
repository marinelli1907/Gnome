import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  FlatList,
  Image as NativeImage,
  Linking,
  Modal,
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
import { TYPE_BADGE_BG, TYPE_BADGE_FG } from '@/components/listingSemantics';
import type { Listing, ListingType } from '@/types';
import Colors from '@/constants/colors';
import { useListings, useFollowedListings, useFollowedMarkets } from '@/lib/db';
import { useAuth } from '@/providers/AuthProvider';
import {
  useTaxonomy,
  subtreeIds,
  matchNodes,
  nodeInAnySubtree,
  breadcrumb,
} from '@/lib/taxonomy';
import {
  DEFAULT_BROWSE_RADIUS,
  currentBrowseLocationAnchor,
  geocodeBrowseLocation,
  getCoordsIfGranted,
  distanceMiles,
  loadBrowseLocationAnchor,
  loadBrowseRadius,
  normalizeBrowseLocationAnchor,
  radiusLabel,
  saveBrowseLocationAnchor,
  saveBrowseRadius,
  type BrowseLocationAnchor,
  type BrowseRadius,
} from '@/lib/location';
import { isSupabaseConfigured } from '@/lib/supabase';

const MARKET_PREVIEW = [
  {
    title: 'Cherry tomatoes',
    market: 'Green Acre Farm',
    value: '$3.50 / pint',
  },
  {
    title: 'Pasture eggs',
    market: 'Happy Hens',
    value: '$4.00 / dozen',
  },
];

function BrowseBrandLockup() {
  return (
    <View
      style={styles.brandLockup}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Gnome Farmers Market. Fresh from the garden next door."
    >
      <Image
        source={require('../../assets/images/gnome-logo-full-hq.png')}
        style={styles.brandLogo}
        contentFit="contain"
        transition={0}
      />
    </View>
  );
}

export default function BrowseScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const [anchor, setAnchor] = useState<BrowseLocationAnchor | null>(null);
  const [radius, setRadiusState] = useState<BrowseRadius>(DEFAULT_BROWSE_RADIUS);
  const [distanceOpen, setDistanceOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [manualLocation, setManualLocation] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | ListingType>('all');
  const [taxNodeId, setTaxNodeId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const coords = anchor?.coords ?? null;

  const setRadius = (r: BrowseRadius) => {
    setRadiusState(r);
    void saveBrowseRadius(r); // persists across restarts
  };

  const clearFilters = () => {
    setSearch('');
    setTaxNodeId(null);
    setTypeFilter('all');
    setRadius(DEFAULT_BROWSE_RADIUS);
  };

  const applyAnchor = (next: BrowseLocationAnchor) => {
    const normalized = normalizeBrowseLocationAnchor(next);
    setAnchor(normalized);
    void saveBrowseLocationAnchor(normalized);
  };

  const handleCurrentLocation = async () => {
    setLocationBusy(true);
    setLocationError(null);
    const next = await currentBrowseLocationAnchor();
    setLocationBusy(false);
    if (!next) {
      setLocationError('Location permission is needed to use current location.');
      return;
    }
    applyAnchor(next);
    setLocationOpen(false);
  };

  const handleManualLocation = async () => {
    setLocationBusy(true);
    setLocationError(null);
    const next = await geocodeBrowseLocation(manualLocation);
    setLocationBusy(false);
    if (!next) {
      setLocationError('Enter a city, state, or ZIP code Gnome can find.');
      return;
    }
    applyAnchor(next);
    setManualLocation('');
    setLocationOpen(false);
  };

  useEffect(() => {
    void loadBrowseRadius().then(setRadiusState);
    void loadBrowseLocationAnchor().then(setAnchor);
  }, []);

  // Refresh the reading when the app returns to the foreground — no prompt,
  // no background tracking; a single fix each time the user comes back.
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        void getCoordsIfGranted().then((c) => {
          if (c && anchor?.source === 'current') {
            applyAnchor({ ...anchor, coords: c });
          }
        });
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [anchor]);

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
  const followedMarkets = useFollowedMarkets(userId ?? undefined);
  const followedMarketIds = useMemo(
    () => (followedMarkets.data ?? []).map((m) => m.id),
    [followedMarkets.data],
  );
  const followedListings = useFollowedListings(userId ?? undefined, followedMarketIds);
  const followedMarketSet = useMemo(() => new Set(followedMarketIds), [followedMarketIds]);

  const feed = useMemo(() => {
    const seen = new Set<string>();
    const merged: Listing[] = [];
    const passesFilters = (listing: Listing) => {
      if (typeFilter !== 'all' && listing.listing_type !== typeFilter) return false;
      if (taxonomyIds?.length && !taxonomyIds.includes(listing.taxonomy_node_id ?? '')) return false;
      return true;
    };
    const withDistance = (listing: Listing): Listing => {
      if (listing.distance_miles != null || !coords || listing.approx_lat == null || listing.approx_lng == null) {
        return listing;
      }
      return {
        ...listing,
        distance_miles: distanceMiles(coords, {
          lat: listing.approx_lat,
          lng: listing.approx_lng,
        }),
      };
    };
    const add = (listing: Listing) => {
      if (seen.has(listing.id) || !passesFilters(listing)) return;
      seen.add(listing.id);
      merged.push(withDistance(listing));
    };
    (data ?? []).forEach(add);
    (followedListings.data ?? []).forEach(add);
    return merged.sort((a, b) => {
      const aFollowed = !!a.market_id && followedMarketSet.has(a.market_id);
      const bFollowed = !!b.market_id && followedMarketSet.has(b.market_id);
      if (aFollowed !== bFollowed) return aFollowed ? -1 : 1;
      const aDistance = a.distance_miles ?? Number.POSITIVE_INFINITY;
      const bDistance = b.distance_miles ?? Number.POSITIVE_INFINITY;
      if (aDistance !== bDistance) return aDistance - bDistance;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [coords, data, followedListings.data, followedMarketSet, taxonomyIds, typeFilter]);

  // Alias-aware search over the fetched page: a listing matches when its
  // title/description contains the query OR its taxonomy node sits inside any
  // node the query matched by name/synonym (backend data, nothing hardcoded).
  const visible = useMemo(() => {
    const base = feed;
    const q = search.trim().toLowerCase();
    if (!q || !index) return base;
    const matched = matchNodes(index, q);
    return base.filter((l) => {
      if (l.title.toLowerCase().includes(q)) return true;
      if (l.description?.toLowerCase().includes(q)) return true;
      return nodeInAnySubtree(index, l.taxonomy_node_id, matched);
    });
  }, [feed, search, index]);

  const filtering = !!selectedNode || !!search.trim() || typeFilter !== 'all';
  const truthfulFreshTitle = anchor ? 'Fresh near you' : 'Fresh listings';
  const locationSummary = anchor
    ? radius === 'anywhere'
      ? `${anchor.label} · No distance limit`
      : `${anchor.label} · ${radius} mi`
    : radius === 'anywhere'
      ? 'Anywhere · No distance limit'
      : 'Set your location to filter by distance';

  const Header = (
    <View style={styles.header}>
      <View style={styles.logoHeader}>
        <BrowseBrandLockup />
      </View>

      {/* Search — matches titles, descriptions, and category names/aliases */}
      <View style={styles.searchRow}>
        <Search size={17} color={Colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="What are you looking for?"
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
        <View style={styles.previewPanel}>
          <View style={styles.previewHead}>
            <Text style={styles.previewTitle}>{truthfulFreshTitle}</Text>
            <Text style={styles.previewLink}>See all</Text>
          </View>
          {!anchor ? (
            <View style={styles.locationNudge}>
              <Text style={styles.locationNudgeText}>Set your location to see what is fresh near you.</Text>
              <View style={styles.locationNudgeActions}>
                <Pressable onPress={handleCurrentLocation} style={styles.locationMiniBtn}>
                  <Text style={styles.locationMiniText}>Use current location</Text>
                </Pressable>
                <Pressable onPress={() => setLocationOpen(true)} style={styles.locationMiniBtnSecondary}>
                  <Text style={styles.locationMiniTextSecondary}>Enter city or ZIP</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          <View style={styles.previewGrid}>
            {MARKET_PREVIEW.map((item) => (
              <Pressable key={item.title} onPress={() => setSearch(item.title)} style={styles.previewCard}>
                <NativeImage
                  source={item.title === 'Cherry tomatoes'
                    ? require('../../assets/images/preview-tomatoes.png')
                    : require('../../assets/images/preview-eggs.png')}
                  style={styles.previewPhoto}
                  resizeMode="cover"
                />
                <Text style={styles.previewName} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.previewMarket} numberOfLines={1}>{item.market}</Text>
                <Text style={styles.previewValue}>{item.value}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

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
              style={[
                styles.chip,
                active && styles.chipActive,
                active && opt.value !== 'all' && {
                  backgroundColor: TYPE_BADGE_BG[opt.value],
                  borderColor: TYPE_BADGE_BG[opt.value],
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  active && styles.chipTextActive,
                  active && opt.value !== 'all' && { color: TYPE_BADGE_FG[opt.value] },
                ]}
              >
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

      {/* Distance: one editable chip backed by the slider/manual-input sheet */}
      <View style={styles.locationRow}>
        <Pressable
          onPress={() => setLocationOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Change browse location"
          style={styles.locationPill}
        >
          <Text style={styles.locationPillText}>{locationSummary}</Text>
        </Pressable>
      </View>
      <View style={styles.distanceRow}>
        <Pressable
          onPress={() => setDistanceOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Distance filter: ${radiusLabel(radius)}. Tap to change.`}
          hitSlop={6}
          style={[styles.chip, styles.chipActive, styles.chipDistance]}
        >
          <Text style={[styles.chipText, styles.chipTextActive]}>
            {radius === 'anywhere' ? 'Anywhere' : anchor ? radiusLabel(radius) : 'Set location'}
          </Text>
        </Pressable>
        {radius !== 'anywhere' && !coords ? (
          <Pressable
            onPress={() => {
              setLocationOpen(true);
            }}
            accessibilityRole="button"
            hitSlop={6}
            style={styles.locateHint}
          >
            <Text style={styles.locateHintText}>
              Location is needed to filter by distance —{' '}
              <Text style={styles.locateHintAction}>use current location</Text>
            </Text>
          </Pressable>
        ) : null}
      </View>


      {!filtering && <FeaturedRail filters={filters} />}

      {filtering ? (
        <Pressable onPress={clearFilters} accessibilityRole="button" style={styles.clearFilters}>
          <X size={15} color={Colors.primaryDark} />
          <Text style={styles.clearFiltersText}>Clear filters</Text>
        </Pressable>
      ) : null}

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
              clearFilters();
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
                if (c && anchor?.source === 'current') applyAnchor({ ...anchor, coords: c });
              });
              void refetch();
              void followedMarkets.refetch();
              if (followedMarketIds.length) void followedListings.refetch();
            }}
            tintColor={Colors.primary}
          />
        }
      />
      <DistancePicker
        visible={distanceOpen}
        value={radius}
        onApply={(r) => {
          setRadius(r);
          if (r !== 'anywhere' && !anchor) setLocationOpen(true);
        }}
        onClose={() => setDistanceOpen(false)}
      />
      <Modal visible={locationOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLocationOpen(false)}>
        <View style={[styles.locationSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.locationSheetHead}>
            <Text style={styles.locationSheetTitle}>Location</Text>
            <Pressable onPress={() => setLocationOpen(false)} hitSlop={10} style={styles.closeBtn}>
              <X size={22} color={Colors.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.locationSheetBody}>
            <Button label="Use current location" onPress={() => void handleCurrentLocation()} loading={locationBusy} />
            <Text style={styles.locationSheetNote}>Gnome shows a coarse place label, not raw coordinates.</Text>
            <Text style={styles.locationInputLabel}>Enter city or ZIP</Text>
            <View style={styles.manualRow}>
              <TextInput
                style={styles.manualInput}
                value={manualLocation}
                onChangeText={(t) => {
                  setManualLocation(t);
                  setLocationError(null);
                }}
                placeholder="44143 or Cleveland, OH"
                placeholderTextColor={Colors.textTertiary}
                returnKeyType="search"
                onSubmitEditing={() => void handleManualLocation()}
              />
              <Pressable onPress={() => void handleManualLocation()} style={styles.manualBtn}>
                <Text style={styles.manualBtnText}>Set</Text>
              </Pressable>
            </View>
            {locationError ? <Text style={styles.locationError}>{locationError}</Text> : null}
            {anchor ? (
              <Text style={styles.currentAnchor}>Current: {anchor.label}</Text>
            ) : (
              <Text style={styles.currentAnchor}>No location set. Broader marketplace browsing still works.</Text>
            )}
            {locationError ? (
              <Pressable onPress={() => Linking.openSettings()} style={styles.settingsLink}>
                <Text style={styles.settingsLinkText}>Open settings</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
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
  logoHeader: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 0,
    paddingBottom: 12,
    marginBottom: 4,
  },
  brandLockup: {
    width: '100%',
    maxWidth: 360,
    height: 148,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLogo: { width: '100%', height: '100%' },
  hello: { fontSize: 18, fontFamily: fonts.bold, color: Colors.text },
  tagline: { fontSize: 12.5, fontFamily: fonts.semibold, color: Colors.textSecondary, marginTop: 1 },
  heroTitle: {
    maxWidth: 260,
    fontSize: 38,
    lineHeight: 39,
    fontFamily: fonts.displayBold,
    color: Colors.text,
    zIndex: 1,
  },
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
  previewPanel: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    padding: 12,
    marginBottom: 12,
    shadowColor: '#111827',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  previewHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  previewTitle: { fontSize: 17, fontFamily: fonts.displayBold, color: Colors.text },
  previewLink: { fontSize: 12, fontFamily: fonts.bold, color: Colors.tradeBlueInteractive },
  previewGrid: { flexDirection: 'row', gap: 10 },
  locationNudge: {
    borderRadius: 12,
    backgroundColor: Colors.tradeBlueInteractive + '10',
    borderWidth: 1,
    borderColor: Colors.tradeBlueInteractive + '30',
    padding: 10,
    marginBottom: 10,
    gap: 8,
  },
  locationNudgeText: { fontSize: 12.5, fontFamily: fonts.semibold, color: Colors.text },
  locationNudgeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  locationMiniBtn: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: Colors.tradeBlueInteractive,
  },
  locationMiniBtnSecondary: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.tradeBlueInteractive + '55',
  },
  locationMiniText: { fontSize: 12.5, fontFamily: fonts.bold, color: Colors.textInverse },
  locationMiniTextSecondary: { fontSize: 12.5, fontFamily: fonts.bold, color: Colors.tradeBlueInteractive },
  previewCard: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 13,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceElevated,
  },
  previewPhoto: { width: '100%', height: 92 },
  previewName: { fontSize: 13, fontFamily: fonts.bold, color: Colors.text, paddingHorizontal: 10, paddingTop: 8 },
  previewMarket: { fontSize: 11.5, fontFamily: fonts.regular, color: Colors.textSecondary, paddingHorizontal: 10, paddingTop: 2 },
  previewValue: { fontSize: 12, fontFamily: fonts.bold, color: Colors.text, paddingHorizontal: 10, paddingTop: 3, paddingBottom: 10 },
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
  locationRow: { marginBottom: 8 },
  locationPill: {
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderRadius: 18,
    backgroundColor: Colors.tradeBlueInteractive + '10',
    borderWidth: 1,
    borderColor: Colors.tradeBlueInteractive + '45',
  },
  locationPillText: { fontSize: 13, fontFamily: fonts.bold, color: Colors.tradeBlueInteractive },
  distanceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10, flexWrap: 'wrap' },
  locateHint: { flexShrink: 1, minHeight: 34, justifyContent: 'center' },
  // Guidance, not a failure. Brand red here read as an error the user had
  // caused; slate reads as the hint it is (#6B7280 on white = 4.83:1). The
  // tappable half is carried by an underline as well as by weight, so the
  // affordance does not depend on colour alone (identity §1b).
  locateHintText: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary },
  locateHintAction: { fontFamily: fonts.semibold, textDecorationLine: 'underline' },
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
  chipActive: { backgroundColor: Colors.text, borderColor: Colors.text },
  // Distance is a location control — Map's blue, not the brand. White on this
  // cut measures 4.56:1.
  chipDistance: { backgroundColor: Colors.tradeBlueInteractive, borderColor: Colors.tradeBlueInteractive },
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
  clearFilters: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 13,
    marginBottom: 10,
    backgroundColor: Colors.primary + '12',
  },
  clearFiltersText: { color: Colors.primaryDark, fontFamily: fonts.bold, fontSize: 13 },
  cardWrap: { paddingHorizontal: 16 },
  locationSheet: { flex: 1, backgroundColor: Colors.background },
  locationSheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  locationSheetTitle: { fontSize: 18, fontFamily: fonts.bold, color: Colors.text },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  locationSheetBody: { padding: 20 },
  locationSheetNote: { marginTop: 8, marginBottom: 18, fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 18 },
  locationInputLabel: { fontSize: 14, fontFamily: fonts.bold, color: Colors.text, marginBottom: 8 },
  manualRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  manualInput: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: 12,
    fontSize: 15,
    fontFamily: fonts.regular,
    color: Colors.text,
  },
  manualBtn: {
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.tradeBlueInteractive,
  },
  manualBtnText: { color: Colors.textInverse, fontSize: 14, fontFamily: fonts.bold },
  locationError: { marginTop: 10, fontSize: 12.5, fontFamily: fonts.semibold, color: Colors.error },
  currentAnchor: { marginTop: 14, fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, lineHeight: 18 },
  settingsLink: { marginTop: 10, alignSelf: 'flex-start' },
  settingsLinkText: { color: Colors.tradeBlueInteractive, fontSize: 13, fontFamily: fonts.bold },
});
