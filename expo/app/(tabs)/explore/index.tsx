import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  Pressable,
  ScrollView,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Search, SlidersHorizontal, X, Leaf, Carrot, Apple, Flower2, Egg,
  Droplets, CakeSlice, Sprout, Megaphone, TreePine, Flower, Cherry,
  Shovel, Palette, Hand, Crown, Gift, Archive, Truck,
} from 'lucide-react-native';
import { useApp } from '@/providers/AppProvider';
import { ListingCard } from '@/components/ListingCard';
import { Listing, ListingType } from '@/types';
import Colors from '@/constants/colors';
import { categories } from '@/mocks/listings';

const iconMap: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  Leaf, Carrot, Apple, Flower2, Egg, Droplets, CakeSlice, Sprout,
  TreePine, Flower, Cherry, Shovel, Palette, Hand, Crown, Gift, Jar: Archive,
};

const typeFilters: { id: ListingType | 'all'; label: string }[] = [
  { id: 'all', label: 'All Types' },
  { id: 'sell', label: 'For Sale' },
  { id: 'trade', label: 'Trade' },
  { id: 'free', label: 'Free' },
];

const deliveryFilters = [
  { id: 'all', label: 'Any' },
  { id: 'ships', label: 'Ships' },
  { id: 'pickup', label: 'Pickup' },
  { id: 'local_delivery', label: 'Delivery' },
] as const;

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const { listings } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<ListingType | 'all'>('all');
  const [selectedDelivery, setSelectedDelivery] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const filterAnim = useRef(new Animated.Value(0)).current;

  const toggleFilters = useCallback(() => {
    const toValue = showFilters ? 0 : 1;
    Animated.spring(filterAnim, {
      toValue,
      useNativeDriver: false,
    }).start();
    setShowFilters(!showFilters);
  }, [showFilters, filterAnim]);

  const filtered = useMemo(() => listings.filter(l => {
    if (l.status !== 'active') return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !l.title.toLowerCase().includes(q) &&
        !l.description.toLowerCase().includes(q) &&
        !l.category.toLowerCase().includes(q) &&
        !(l.tags ?? []).some(t => t.toLowerCase().includes(q))
      ) {
        return false;
      }
    }
    if (selectedCategory !== 'all' && l.category !== selectedCategory) return false;
    if (selectedType !== 'all' && l.type !== selectedType) return false;
    if (selectedDelivery !== 'all' && !(l.deliveryOptions ?? []).includes(selectedDelivery as any)) return false;
    return true;
  }), [listings, searchQuery, selectedCategory, selectedType, selectedDelivery]);

  const sortedListings = useMemo(() => {
    const promoted = filtered.filter(l => l.promotion?.isActive);
    const regular = filtered.filter(l => !l.promotion?.isActive);
    regular.sort((a, b) => a.distance - b.distance);
    return [...promoted, ...regular];
  }, [filtered]);

  const promotedCount = sortedListings.filter(l => l.promotion?.isActive).length;
  const shippableCount = sortedListings.filter(l => l.deliveryOptions?.includes('ships')).length;

  const filterHeight = filterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 180],
  });

  const renderItem = useCallback(({ item }: { item: Listing }) => (
    <View style={styles.cardWrapper}>
      <ListingCard listing={item} />
    </View>
  ), []);

  const activeFilterCount = [
    selectedType !== 'all',
    selectedCategory !== 'all',
    selectedDelivery !== 'all',
  ].filter(Boolean).length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Explore</Text>
        <Text style={styles.headerSubtitle}>Plants, produce, seeds, decor & more</Text>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Search size={18} color={Colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search seeds, plants, gnomes, herbs..."
            placeholderTextColor={Colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')}>
              <X size={18} color={Colors.textTertiary} />
            </Pressable>
          )}
        </View>
        <Pressable
          style={[styles.filterBtn, showFilters && styles.filterBtnActive]}
          onPress={toggleFilters}
        >
          <SlidersHorizontal size={18} color={showFilters ? Colors.textOnPrimary : Colors.primary} />
          {activeFilterCount > 0 && (
            <View style={styles.filterCountBadge}>
              <Text style={styles.filterCountText}>{activeFilterCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      <Animated.View style={[styles.filtersContainer, { height: filterHeight, overflow: 'hidden' }]}>
        <Text style={styles.filterLabel}>Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChips}>
          {typeFilters.map(tf => (
            <Pressable
              key={tf.id}
              style={[styles.chip, selectedType === tf.id && styles.chipActive]}
              onPress={() => setSelectedType(tf.id)}
            >
              <Text style={[styles.chipText, selectedType === tf.id && styles.chipTextActive]}>{tf.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={styles.filterLabel}>Delivery</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChips}>
          {deliveryFilters.map(df => (
            <Pressable
              key={df.id}
              style={[styles.chip, selectedDelivery === df.id && styles.chipActive]}
              onPress={() => setSelectedDelivery(df.id)}
            >
              {df.id === 'ships' && <Truck size={12} color={selectedDelivery === df.id ? Colors.textOnPrimary : Colors.primary} />}
              <Text style={[styles.chipText, selectedDelivery === df.id && styles.chipTextActive]}>{df.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={styles.filterLabel}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChips}>
          {categories.map(cat => {
            const isSelected = selectedCategory === cat.id;
            const IconComponent = iconMap[cat.icon] || Leaf;
            return (
              <Pressable
                key={cat.id}
                style={[styles.chip, isSelected && styles.chipActive]}
                onPress={() => setSelectedCategory(cat.id)}
              >
                <IconComponent size={14} color={isSelected ? Colors.textOnPrimary : Colors.primary} />
                <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{cat.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </Animated.View>

      <View style={styles.resultsMeta}>
        <Text style={styles.resultsCount}>
          {sortedListings.length} listing{sortedListings.length !== 1 ? 's' : ''} found
        </Text>
        <View style={styles.resultsRight}>
          {shippableCount > 0 && (
            <View style={styles.metaIndicator}>
              <Truck size={11} color={Colors.info} />
              <Text style={[styles.metaIndicatorText, { color: Colors.info }]}>{shippableCount} ship</Text>
            </View>
          )}
          {promotedCount > 0 && (
            <View style={styles.metaIndicator}>
              <Megaphone size={11} color={Colors.promoted} />
              <Text style={styles.metaIndicatorText}>{promotedCount} promoted</Text>
            </View>
          )}
        </View>
      </View>

      <FlatList
        data={sortedListings}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🔍</Text>
            <Text style={styles.emptyTitle}>No results found</Text>
            <Text style={styles.emptyText}>Try adjusting your search or filters</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 12,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 46,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
  },
  filterBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterCountBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterCountText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  filtersContainer: {
    paddingHorizontal: 20,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  filterChips: {
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  chipTextActive: {
    color: Colors.textOnPrimary,
  },
  resultsMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  resultsRight: {
    flexDirection: 'row',
    gap: 10,
  },
  resultsCount: {
    fontSize: 13,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
  },
  metaIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaIndicatorText: {
    fontSize: 11,
    color: Colors.promoted,
    fontWeight: '600' as const,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  cardWrapper: {
    marginBottom: 0,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
});
