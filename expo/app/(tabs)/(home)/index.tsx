import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  Pressable,
  Animated,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  Plus, MapPin, Bell, Leaf, Carrot, Apple, Flower2, Egg, Droplets,
  CakeSlice, Sprout, Megaphone, Crown, Star, TreePine, Flower,
  Cherry, Shovel, Palette, Hand, Gift, Archive,
} from 'lucide-react-native';
import { useApp } from '@/providers/AppProvider';
import { ListingCard } from '@/components/ListingCard';
import { Listing, User } from '@/types';
import Colors from '@/constants/colors';
import { categories } from '@/mocks/listings';
import { mockUsers } from '@/mocks/users';

const seasonalBanners = [
  { emoji: '🌷', title: 'Spring Garden Start', subtitle: 'Seeds, seedlings & supplies for your spring garden', color: Colors.primary },
  { emoji: '☀️', title: 'Summer Harvest Favorites', subtitle: 'Fresh produce, herbs & flowers at peak season', color: Colors.promoted },
  { emoji: '🍂', title: 'Fall Porch & Decor', subtitle: 'Gnomes, planters & autumn garden accessories', color: Colors.secondary },
  { emoji: '🎁', title: 'Holiday Garden Gifts', subtitle: 'Handmade gifts, planters & garden kits', color: Colors.accent },
];

const iconMap: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  Leaf, Carrot, Apple, Flower2, Egg, Droplets, CakeSlice, Sprout,
  TreePine, Flower, Cherry, Shovel, Palette, Hand, Crown, Gift, Archive,
};

function TopSellerCard({ seller }: { seller: User }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push(`/storefront?sellerId=${seller.id}` as any)} style={styles.sellerCard}>
      <Image source={{ uri: seller.avatar }} style={styles.sellerAvatar} contentFit="cover" />
      {seller.isVerifiedSeller && (
        <View style={styles.sellerVerified}>
          <Crown size={8} color={Colors.gold} />
        </View>
      )}
      <Text style={styles.sellerName} numberOfLines={1}>{seller.name.split(' ')[0]}</Text>
      <View style={styles.sellerRating}>
        <Star size={9} color={Colors.secondaryLight} fill={Colors.secondaryLight} />
        <Text style={styles.sellerRatingText}>{seller.rating}</Text>
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, listings, unreadNotifCount, buyerOrders } = useApp();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [refreshing, setRefreshing] = useState(false);
  const fabScale = useRef(new Animated.Value(1)).current;

  const filteredListings = selectedCategory === 'all'
    ? listings.filter(l => l.status === 'active')
    : listings.filter(l => l.status === 'active' && l.category === selectedCategory);

  const promotedListings = useMemo(() =>
    listings.filter(l => l.status === 'active' && l.promotion?.isActive),
  [listings]);

  const freshPickedListings = useMemo(() =>
    listings.filter(l => l.status === 'active' && (l.freshnessLabel === 'harvested_today' || l.freshnessLabel === 'fresh_picked')),
  [listings]);

  const sellSoonListings = useMemo(() =>
    listings.filter(l => l.status === 'active' && (l.freshnessLabel === 'sell_soon' || l.freshnessLabel === 'limited_qty')),
  [listings]);

  const seedsAndSeedlings = useMemo(() =>
    listings.filter(l => l.status === 'active' && (l.category === 'seeds' || l.category === 'seedlings')),
  [listings]);

  const gnomesAndGifts = useMemo(() =>
    listings.filter(l => l.status === 'active' && (l.category === 'gnomes' || l.category === 'decor' || l.category === 'handmade')),
  [listings]);

  const plantsAndFlowers = useMemo(() =>
    listings.filter(l => l.status === 'active' && (l.category === 'plants' || l.category === 'flowers')),
  [listings]);

  const topSellers = useMemo(() =>
    [...mockUsers].sort((a, b) => (b.totalSales ?? 0) - (a.totalSales ?? 0)).slice(0, 5),
  []);

  const nearbyListings = useMemo(() =>
    [...listings]
      .filter(l => l.status === 'active')
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 6),
  [listings]);

  const recentlyBrowsed = useMemo(() =>
    listings.filter(l => l.status === 'active').slice(0, 4),
  [listings]);

  const activeOrders = useMemo(() =>
    buyerOrders.filter(o => !['completed', 'canceled', 'sold_out'].includes(o.status)),
  [buyerOrders]);

  const currentSeason = seasonalBanners[0];

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const handleFabPress = useCallback(() => {
    Animated.sequence([
      Animated.spring(fabScale, { toValue: 0.9, useNativeDriver: true }),
      Animated.spring(fabScale, { toValue: 1, friction: 3, useNativeDriver: true }),
    ]).start();
    router.push('/create-listing');
  }, [fabScale, router]);

  const renderListingItem = useCallback(({ item }: { item: Listing }) => (
    <View style={styles.listingCardWrapper}>
      <ListingCard listing={item} />
    </View>
  ), []);

  const renderCompactItem = useCallback(({ item }: { item: Listing }) => (
    <ListingCard listing={item} compact />
  ), []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.greeting}>Hello, {user.name.split(' ')[0]} 👋</Text>
          <View style={styles.locationRow}>
            <MapPin size={13} color={Colors.primaryLight} />
            <Text style={styles.locationText}>{user.location}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <Pressable style={styles.notifBtn} onPress={() => router.push('/notifications')}>
            <Bell size={22} color={Colors.text} />
            {unreadNotifCount > 0 && (
              <View style={styles.notifDot}>
                <Text style={styles.notifDotText}>{unreadNotifCount}</Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={() => router.push('/(tabs)/profile')}>
            <Image source={{ uri: user.avatar }} style={styles.avatar} contentFit="cover" />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={filteredListings}
        keyExtractor={(item) => item.id}
        renderItem={renderListingItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        ListHeaderComponent={
          <>
            <View style={styles.heroSection}>
              <View style={styles.heroBg}>
                <Text style={styles.heroEmoji}>🌿</Text>
                <View style={styles.heroContent}>
                  <Text style={styles.heroTitle}>Your garden{'\n'}marketplace</Text>
                  <Text style={styles.heroSubtitle}>Plants, produce, seeds, decor & more from neighbors</Text>
                </View>
              </View>
            </View>

            {activeOrders.length > 0 && (
              <Pressable style={styles.activeOrdersBanner} onPress={() => router.push('/orders')}>
                <View style={styles.activeOrdersLeft}>
                  <View style={styles.activeOrdersDot} />
                  <Text style={styles.activeOrdersText}>
                    {activeOrders.length} active order{activeOrders.length > 1 ? 's' : ''}
                  </Text>
                </View>
                <Text style={styles.activeOrdersLink}>View</Text>
              </Pressable>
            )}

            {promotedListings.length > 0 && (
              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionTitleRow}>
                    <Megaphone size={16} color={Colors.promoted} />
                    <Text style={styles.sectionTitle}>Promoted Near You</Text>
                  </View>
                </View>
                <FlatList
                  data={promotedListings}
                  keyExtractor={(item) => `promo-${item.id}`}
                  renderItem={renderCompactItem}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.horizontalList}
                />
              </View>
            )}

            {freshPickedListings.length > 0 && (
              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>🌱 Fresh Picked Today</Text>
                </View>
                <FlatList
                  data={freshPickedListings}
                  keyExtractor={(item) => `fresh-${item.id}`}
                  renderItem={renderCompactItem}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.horizontalList}
                />
              </View>
            )}

            {seedsAndSeedlings.length > 0 && (
              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>🌰 Seeds & Seedlings</Text>
                  <Text style={styles.sectionSubtitle}>Start your garden</Text>
                </View>
                <FlatList
                  data={seedsAndSeedlings}
                  keyExtractor={(item) => `seed-${item.id}`}
                  renderItem={renderCompactItem}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.horizontalList}
                />
              </View>
            )}

            {plantsAndFlowers.length > 0 && (
              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>🌸 Plants & Flowers</Text>
                </View>
                <FlatList
                  data={plantsAndFlowers}
                  keyExtractor={(item) => `plant-${item.id}`}
                  renderItem={renderCompactItem}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.horizontalList}
                />
              </View>
            )}

            {gnomesAndGifts.length > 0 && (
              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>🍄 Gnomes & Garden Gifts</Text>
                </View>
                <FlatList
                  data={gnomesAndGifts}
                  keyExtractor={(item) => `gnome-${item.id}`}
                  renderItem={renderCompactItem}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.horizontalList}
                />
              </View>
            )}

            {sellSoonListings.length > 0 && (
              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>⏰ Sell Soon</Text>
                </View>
                <FlatList
                  data={sellSoonListings}
                  keyExtractor={(item) => `sell-${item.id}`}
                  renderItem={renderCompactItem}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.horizontalList}
                />
              </View>
            )}

            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Top Local Sellers</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sellersRow}>
                {topSellers.map((seller) => (
                  <TopSellerCard key={seller.id} seller={seller} />
                ))}
              </ScrollView>
            </View>

            <View style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>Closest to You</Text>
              <FlatList
                data={nearbyListings}
                keyExtractor={(item) => `nearby-${item.id}`}
                renderItem={renderCompactItem}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              />
            </View>

            <View style={[styles.seasonalBanner, { borderColor: currentSeason.color + '20' }]}>
              <View style={styles.bannerContent}>
                <Text style={styles.bannerEmoji}>{currentSeason.emoji}</Text>
                <View style={styles.bannerTextWrap}>
                  <Text style={styles.bannerTitle}>{currentSeason.title}</Text>
                  <Text style={styles.bannerSubtitle}>{currentSeason.subtitle}</Text>
                </View>
              </View>
            </View>

            <View style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>🕐 Fresh This Weekend</Text>
              <FlatList
                data={nearbyListings.slice(0, 4)}
                keyExtractor={(item) => `weekend-${item.id}`}
                renderItem={renderCompactItem}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              />
            </View>

            {recentlyBrowsed.length > 0 && (
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionTitle}>🔄 Recently Browsed</Text>
                <FlatList
                  data={recentlyBrowsed}
                  keyExtractor={(item) => `recent-${item.id}`}
                  renderItem={renderCompactItem}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.horizontalList}
                />
              </View>
            )}

            <View style={[styles.seasonalBanner, { backgroundColor: Colors.secondary + '08', borderColor: Colors.secondary + '20' }]}>
              <View style={styles.bannerContent}>
                <Text style={styles.bannerEmoji}>🏆</Text>
                <View style={styles.bannerTextWrap}>
                  <Text style={styles.bannerTitle}>Local Best Sellers</Text>
                  <Text style={styles.bannerSubtitle}>Top-rated products from trusted neighborhood growers</Text>
                </View>
              </View>
            </View>

            <View style={styles.categoriesSection}>
              <Text style={styles.sectionTitle}>Browse by Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
                {categories.map((cat) => {
                  const isSelected = selectedCategory === cat.id;
                  const IconComponent = iconMap[cat.icon] || Leaf;
                  return (
                    <Pressable
                      key={cat.id}
                      style={[styles.categoryChip, isSelected && styles.categoryChipActive]}
                      onPress={() => setSelectedCategory(cat.id)}
                    >
                      <IconComponent
                        size={16}
                        color={isSelected ? Colors.textOnPrimary : Colors.primary}
                      />
                      <Text style={[styles.categoryLabel, isSelected && styles.categoryLabelActive]}>
                        {cat.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <Text style={styles.sectionTitle}>
              {selectedCategory === 'all' ? 'All Listings' : categories.find(c => c.id === selectedCategory)?.label ?? 'Listings'}
            </Text>
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🌱</Text>
            <Text style={styles.emptyTitle}>No listings yet</Text>
            <Text style={styles.emptyText}>Be the first to share from your garden!</Text>
          </View>
        }
      />

      <Animated.View style={[styles.fabContainer, { transform: [{ scale: fabScale }], bottom: 20 }]}>
        <Pressable style={styles.fab} onPress={handleFabPress}>
          <Plus size={24} color={Colors.textInverse} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  greeting: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  locationText: {
    fontSize: 13,
    color: Colors.primaryLight,
    fontWeight: '500' as const,
  },
  notifBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  notifDotText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700' as const,
  },
  activeOrdersBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.primary + '10',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '25',
  },
  activeOrdersLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activeOrdersDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.freshGreen,
  },
  activeOrdersText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primaryDark,
  },
  activeOrdersLink: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  listContent: {
    paddingBottom: 100,
    paddingHorizontal: 20,
  },
  heroSection: {
    marginBottom: 20,
    marginTop: 8,
  },
  heroBg: {
    backgroundColor: Colors.primaryDark,
    borderRadius: 20,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  heroEmoji: {
    fontSize: 48,
    marginRight: 16,
  },
  heroContent: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: Colors.textInverse,
    lineHeight: 30,
  },
  heroSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 4,
  },
  sectionBlock: {
    marginBottom: 20,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
  },
  horizontalList: {
    paddingRight: 20,
  },
  sellersRow: {
    gap: 12,
    paddingRight: 20,
  },
  sellerCard: {
    alignItems: 'center',
    width: 72,
  },
  sellerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: Colors.primary,
    marginBottom: 6,
  },
  sellerVerified: {
    position: 'absolute',
    top: 0,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.background,
  },
  sellerName: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.text,
    textAlign: 'center' as const,
  },
  sellerRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
  },
  sellerRatingText: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '600' as const,
  },
  seasonalBanner: {
    backgroundColor: Colors.primary + '10',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bannerEmoji: {
    fontSize: 36,
  },
  bannerTextWrap: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.primaryDark,
    marginBottom: 2,
  },
  bannerSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  categoriesSection: {
    marginBottom: 20,
  },
  categoryRow: {
    gap: 8,
    paddingRight: 20,
  },
  categoryChip: {
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
  categoryChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  categoryLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  categoryLabelActive: {
    color: Colors.textOnPrimary,
  },
  listingCardWrapper: {
    marginBottom: 0,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
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
  fabContainer: {
    position: 'absolute',
    right: 20,
    zIndex: 10,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
});
