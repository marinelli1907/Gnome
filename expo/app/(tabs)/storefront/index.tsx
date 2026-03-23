import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Animated,
  Alert,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import {
  Star,
  MapPin,
  Crown,
  Plus,
  Settings,
  TrendingUp,
  Package,
  BarChart3,
  ChevronRight,
  Eye,
  Heart,
  ShoppingBag,
  Megaphone,
  Edit3,
  Sparkles,
} from 'lucide-react-native';
import { useApp } from '@/providers/AppProvider';
import { ListingCard } from '@/components/ListingCard';
import { mockSellerStats } from '@/mocks/seller';
import Colors from '@/constants/colors';

export default function StorefrontTabScreen() {
  const router = useRouter();
  const { user, listings, getReviewsForSeller, updateUser } = useApp();

  const myListings = useMemo(() =>
    listings.filter(l => l.seller.id === user.id || l.seller.id === 'current-user'),
  [listings, user.id]);

  const activeListings = useMemo(() =>
    myListings.filter(l => l.status === 'active'),
  [myListings]);

  const promotedListings = useMemo(() =>
    activeListings.filter(l => l.promotion?.isActive),
  [activeListings]);

  const myCategories = useMemo(() => {
    const cats = new Set(activeListings.map(l => l.category));
    return Array.from(cats);
  }, [activeListings]);

  const sellerReviews = useMemo(() => getReviewsForSeller(user.id), [user.id, getReviewsForSeller]);
  const avgRating = useMemo(() => {
    if (sellerReviews.length === 0) return user.rating;
    return Math.round(sellerReviews.reduce((s, r) => s + r.rating, 0) / sellerReviews.length * 10) / 10;
  }, [sellerReviews, user.rating]);

  const totalViews = useMemo(() =>
    activeListings.reduce((sum, l) => sum + (l.viewCount ?? 0), 0),
  [activeListings]);

  const totalSaves = useMemo(() =>
    activeListings.reduce((sum, l) => sum + (l.interestCount ?? 0), 0),
  [activeListings]);

  const handleCreateListing = useCallback(() => {
    router.push('/create-listing');
  }, [router]);

  const handleDashboard = useCallback(() => {
    router.push('/seller-dashboard');
  }, [router]);

  const handlePromote = useCallback(() => {
    if (activeListings.length > 0) {
      router.push({ pathname: '/promote-listing', params: { listingId: activeListings[0].id } });
    }
  }, [router, activeListings]);

  const handleOrders = useCallback(() => {
    router.push('/orders');
  }, [router]);

  const handleTax = useCallback(() => {
    router.push('/tax-summary');
  }, [router]);

  const handlePlan = useCallback(() => {
    router.push('/seller-plan');
  }, [router]);

  const handleChangeBanner = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow access to your photo library to change your cover photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [16, 6],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        console.log('Banner image selected:', result.assets[0].uri);
        updateUser({ storeBanner: result.assets[0].uri });
      }
    } catch (error) {
      console.log('Error picking banner image:', error);
      Alert.alert('Error', 'Could not select image. Please try again.');
    }
  }, [updateUser]);

  const handleBannerOptions = useCallback(() => {
    if (Platform.OS === 'web') {
      void handleChangeBanner();
      return;
    }
    Alert.alert(
      'Cover Photo',
      user.storeBanner ? 'Change or remove your cover photo' : 'Add a cover photo to your storefront',
      [
        { text: 'Choose Photo', onPress: handleChangeBanner },
        ...(user.storeBanner ? [{ text: 'Remove Photo', style: 'destructive' as const, onPress: () => updateUser({ storeBanner: undefined }) }] : []),
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
  }, [handleChangeBanner, user.storeBanner, updateUser]);

  const scaleAnim = useMemo(() => new Animated.Value(1), []);

  const onPressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const onPressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>My Storefront</Text>
            {user.sellerPlan && user.sellerPlan !== 'free' && (
              <View style={[styles.planPill, user.sellerPlan === 'market' && styles.planPillMarket]}>
                <Text style={styles.planPillText}>
                  {user.sellerPlan === 'pro' ? 'PRO' : 'MARKET'}
                </Text>
              </View>
            )}
          </View>
          <Pressable onPress={handlePlan} style={styles.headerBtn}>
            <Settings size={20} color={Colors.textSecondary} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {user.storeBanner ? (
          <View style={styles.bannerWrap}>
            <Image source={{ uri: user.storeBanner }} style={styles.banner} contentFit="cover" />
            <View style={styles.bannerOverlay} />
            <Pressable style={styles.editBannerBtn} onPress={handleBannerOptions}>
              <Edit3 size={14} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.addBannerWrap} onPress={handleBannerOptions}>
            <Edit3 size={18} color={Colors.primary} />
            <Text style={styles.addBannerText}>Add Cover Photo</Text>
          </Pressable>
        )}

        <View style={styles.profileCard}>
          <View style={styles.profileRow}>
            <View style={styles.avatarWrap}>
              <Image source={{ uri: user.avatar }} style={styles.avatar} contentFit="cover" />
              {user.isVerifiedSeller && (
                <View style={styles.verifiedBadge}>
                  <Crown size={10} color={Colors.gold} />
                </View>
              )}
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.storeName} numberOfLines={1}>
                {user.storeName ?? user.name}
              </Text>
              <View style={styles.ratingRow}>
                <Star size={13} color={Colors.secondaryLight} fill={Colors.secondaryLight} />
                <Text style={styles.ratingText}>{avgRating}</Text>
                <Text style={styles.reviewCount}>
                  ({sellerReviews.length > 0 ? sellerReviews.length : user.reviewCount} reviews)
                </Text>
              </View>
              <View style={styles.locationRow}>
                <MapPin size={11} color={Colors.primaryLight} />
                <Text style={styles.locationText}>{user.location}</Text>
              </View>
            </View>
          </View>
          <Text style={styles.bio} numberOfLines={2}>{user.bio}</Text>
        </View>

        <View style={styles.quickStats}>
          <View style={styles.statBox}>
            <View style={[styles.statIcon, { backgroundColor: Colors.primary + '14' }]}>
              <ShoppingBag size={16} color={Colors.primary} />
            </View>
            <Text style={styles.statNum}>{user.totalSales ?? 0}</Text>
            <Text style={styles.statLabel}>Sales</Text>
          </View>
          <View style={styles.statBox}>
            <View style={[styles.statIcon, { backgroundColor: Colors.sell + '14' }]}>
              <Package size={16} color={Colors.sell} />
            </View>
            <Text style={styles.statNum}>{activeListings.length}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={styles.statBox}>
            <View style={[styles.statIcon, { backgroundColor: Colors.secondaryLight + '20' }]}>
              <Eye size={16} color={Colors.secondary} />
            </View>
            <Text style={styles.statNum}>{totalViews}</Text>
            <Text style={styles.statLabel}>Views</Text>
          </View>
          <View style={styles.statBox}>
            <View style={[styles.statIcon, { backgroundColor: Colors.accent + '14' }]}>
              <Heart size={16} color={Colors.accent} />
            </View>
            <Text style={styles.statNum}>{totalSaves}</Text>
            <Text style={styles.statLabel}>Saves</Text>
          </View>
        </View>

        <View style={styles.earningsCard}>
          <View style={styles.earningsTop}>
            <View>
              <Text style={styles.earningsLabel}>This Month</Text>
              <Text style={styles.earningsAmount}>${mockSellerStats.monthlyEarnings}</Text>
            </View>
            <View style={styles.earningsRight}>
              <Text style={styles.earningsLabel}>Total Earnings</Text>
              <Text style={styles.earningsTotalAmount}>${user.totalEarnings ?? 0}</Text>
            </View>
          </View>
          <Pressable style={styles.earningsLink} onPress={handleDashboard}>
            <BarChart3 size={14} color={Colors.primary} />
            <Text style={styles.earningsLinkText}>View Dashboard</Text>
            <ChevronRight size={14} color={Colors.primary} />
          </Pressable>
        </View>

        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <Pressable
            style={styles.createBtn}
            onPress={handleCreateListing}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
          >
            <Plus size={20} color="#FFFFFF" />
            <Text style={styles.createBtnText}>Create New Listing</Text>
          </Pressable>
        </Animated.View>

        <View style={styles.quickActions}>
          <Text style={styles.sectionTitle}>Seller Tools</Text>
          <View style={styles.actionsGrid}>
            <Pressable style={styles.actionCard} onPress={handleOrders}>
              <View style={[styles.actionIcon, { backgroundColor: Colors.sell + '12' }]}>
                <ShoppingBag size={18} color={Colors.sell} />
              </View>
              <Text style={styles.actionLabel}>Orders</Text>
              <Text style={styles.actionSub}>{mockSellerStats.totalOrders} total</Text>
            </Pressable>
            <Pressable style={styles.actionCard} onPress={handlePromote}>
              <View style={[styles.actionIcon, { backgroundColor: Colors.promoted + '12' }]}>
                <Megaphone size={18} color={Colors.promoted} />
              </View>
              <Text style={styles.actionLabel}>Promote</Text>
              <Text style={styles.actionSub}>{promotedListings.length} active</Text>
            </Pressable>
            <Pressable style={styles.actionCard} onPress={handleDashboard}>
              <View style={[styles.actionIcon, { backgroundColor: Colors.primary + '12' }]}>
                <TrendingUp size={18} color={Colors.primary} />
              </View>
              <Text style={styles.actionLabel}>Analytics</Text>
              <Text style={styles.actionSub}>View stats</Text>
            </Pressable>
            <Pressable style={styles.actionCard} onPress={handleTax}>
              <View style={[styles.actionIcon, { backgroundColor: Colors.freshGreen + '12' }]}>
                <Sparkles size={18} color={Colors.freshGreen} />
              </View>
              <Text style={styles.actionLabel}>Earnings</Text>
              <Text style={styles.actionSub}>Tax & reports</Text>
            </Pressable>
          </View>
        </View>

        {myCategories.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Categories</Text>
            <View style={styles.chipsRow}>
              {myCategories.map(c => (
                <View key={c} style={styles.chip}>
                  <Text style={styles.chipText}>{c}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {user.specialties && user.specialties.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Specialties</Text>
            <View style={styles.chipsRow}>
              {user.specialties.map(s => (
                <View key={s} style={[styles.chip, styles.specialtyChip]}>
                  <Text style={[styles.chipText, styles.specialtyChipText]}>{s}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Active Listings</Text>
            <Text style={styles.sectionCount}>{activeListings.length}</Text>
          </View>
          {activeListings.length > 0 ? (
            activeListings.map(item => (
              <View key={item.id} style={styles.listingWrapper}>
                <ListingCard listing={item} />
              </View>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🌿</Text>
              <Text style={styles.emptyTitle}>No active listings</Text>
              <Text style={styles.emptyDesc}>Create your first listing to start selling</Text>
              <Pressable style={styles.emptyBtn} onPress={handleCreateListing}>
                <Plus size={16} color="#FFFFFF" />
                <Text style={styles.emptyBtnText}>Create Listing</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Reviews</Text>
            <View style={styles.reviewSummary}>
              <Star size={13} color={Colors.secondaryLight} fill={Colors.secondaryLight} />
              <Text style={styles.reviewSummaryText}>{avgRating}</Text>
            </View>
          </View>
          {sellerReviews.length > 0 ? (
            sellerReviews.slice(0, 3).map(review => (
              <View key={review.id} style={styles.reviewCard}>
                <View style={styles.reviewHeader}>
                  <Image source={{ uri: review.reviewer.avatar }} style={styles.reviewAvatar} contentFit="cover" />
                  <View style={styles.reviewInfo}>
                    <View style={styles.reviewerRow}>
                      <Text style={styles.reviewerName}>{review.reviewer.name}</Text>
                      {review.isRepeatBuyer && (
                        <View style={styles.repeatBadge}>
                          <Text style={styles.repeatBadgeText}>Repeat</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.reviewStars}>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          size={11}
                          color={i < review.rating ? Colors.secondaryLight : Colors.border}
                          fill={i < review.rating ? Colors.secondaryLight : 'none'}
                        />
                      ))}
                    </View>
                  </View>
                </View>
                <Text style={styles.reviewComment} numberOfLines={2}>{review.comment}</Text>
              </View>
            ))
          ) : (
            <View style={styles.emptyReviews}>
              <Text style={styles.emptyEmoji}>⭐</Text>
              <Text style={styles.emptyDesc}>No reviews yet</Text>
            </View>
          )}
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  safeTop: {
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  planPill: {
    backgroundColor: Colors.proTag,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  planPillMarket: {
    backgroundColor: Colors.marketTag,
  },
  planPillText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  bannerWrap: {
    position: 'relative',
  },
  banner: {
    width: '100%',
    height: 150,
  },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  editBannerBtn: {
    position: 'absolute',
    bottom: 10,
    right: 14,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileCard: {
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    marginTop: -20,
    borderRadius: 16,
    padding: 16,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  profileRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 10,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2.5,
    borderColor: Colors.primary,
  },
  verifiedBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  profileInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  storeName: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
    marginBottom: 3,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  ratingText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  reviewCount: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  locationText: {
    fontSize: 12,
    color: Colors.primaryLight,
    fontWeight: '500' as const,
  },
  bio: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  quickStats: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 14,
    gap: 8,
  },
  statBox: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  statNum: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  statLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '600' as const,
    marginTop: 2,
  },
  earningsCard: {
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: Colors.primaryDark,
    borderRadius: 16,
    padding: 16,
    overflow: 'hidden',
  },
  earningsTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  earningsLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '600' as const,
    marginBottom: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  earningsAmount: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  earningsRight: {
    alignItems: 'flex-end',
  },
  earningsTotalAmount: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: 'rgba(255,255,255,0.85)',
  },
  earningsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  earningsLinkText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#FFFFFF',
    flex: 1,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  createBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  quickActions: {
    marginHorizontal: 16,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionCard: {
    width: '48%',
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  actionSub: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
  },
  section: {
    marginHorizontal: 16,
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionCount: {
    fontSize: 13,
    color: Colors.textTertiary,
    fontWeight: '600' as const,
    backgroundColor: Colors.backgroundSecondary,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.primary + '10',
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
    textTransform: 'capitalize' as const,
  },
  specialtyChip: {
    backgroundColor: Colors.secondary + '12',
    borderColor: Colors.secondary + '30',
  },
  specialtyChipText: {
    color: Colors.secondary,
  },
  listingWrapper: {
    marginBottom: 0,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 30,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyEmoji: {
    fontSize: 36,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  emptyDesc: {
    fontSize: 13,
    color: Colors.textTertiary,
    marginBottom: 14,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  emptyBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
  reviewSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reviewSummaryText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  reviewCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  reviewHeader: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  reviewAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  reviewInfo: {
    flex: 1,
  },
  reviewerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  reviewerName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  repeatBadge: {
    backgroundColor: Colors.freshGreen + '15',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  repeatBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.freshGreen,
  },
  reviewStars: {
    flexDirection: 'row',
    gap: 1,
  },
  reviewComment: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  emptyReviews: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  addBannerWrap: {
    height: 100,
    backgroundColor: Colors.backgroundSecondary,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    flexDirection: 'row' as const,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  addBannerText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  bottomSpacer: {
    height: 30,
  },
});
