import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Image } from 'expo-image';
import {
  Star, MapPin, Crown, UserPlus, UserCheck,
  Package as PackageIcon, MessageCircle,
} from 'lucide-react-native';
import { useApp } from '@/providers/AppProvider';
import { ListingCard } from '@/components/ListingCard';
import { mockUsers } from '@/mocks/users';
import { currentUser } from '@/mocks/users';
import Colors from '@/constants/colors';
import { User, SellerReview } from '@/types';

function ReviewCard({ review }: { review: SellerReview }) {
  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        <Image source={{ uri: review.reviewer.avatar }} style={styles.reviewAvatar} contentFit="cover" />
        <View style={styles.reviewHeaderText}>
          <View style={styles.reviewerNameRow}>
            <Text style={styles.reviewerName}>{review.reviewer.name}</Text>
            {review.isRepeatBuyer && (
              <View style={styles.repeatBadge}>
                <Text style={styles.repeatBadgeText}>Repeat Buyer</Text>
              </View>
            )}
          </View>
          <View style={styles.reviewStars}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                size={12}
                color={i < review.rating ? Colors.secondaryLight : Colors.border}
                fill={i < review.rating ? Colors.secondaryLight : 'none'}
              />
            ))}
            <Text style={styles.reviewDate}>
              {new Date(review.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
          </View>
        </View>
      </View>
      <Text style={styles.reviewComment}>{review.comment}</Text>
      <View style={styles.reviewBreakdown}>
        <Text style={styles.reviewBreakdownItem}>Quality: {review.quality}/5</Text>
        <Text style={styles.reviewBreakdownDot}>·</Text>
        <Text style={styles.reviewBreakdownItem}>Communication: {review.communication}/5</Text>
        <Text style={styles.reviewBreakdownDot}>·</Text>
        <Text style={styles.reviewBreakdownItem}>Reliability: {review.reliability}/5</Text>
      </View>
    </View>
  );
}

export default function StorefrontScreen() {
  const { sellerId } = useLocalSearchParams<{ sellerId: string }>();
  const router = useRouter();
  const { listings, isFollowingSeller, toggleFollowSeller, getReviewsForSeller } = useApp();

  const seller: User | undefined = useMemo(() => {
    if (sellerId === 'current-user') return currentUser;
    return mockUsers.find(u => u.id === sellerId) ?? currentUser;
  }, [sellerId]);

  const sellerListings = useMemo(() =>
    listings.filter(l => l.status === 'active' && (l.seller.id === seller.id)),
  [listings, seller]);

  const sellerCategories = useMemo(() => {
    const cats = new Set(sellerListings.map(l => l.category));
    return Array.from(cats);
  }, [sellerListings]);

  const sellerReviews = useMemo(() => getReviewsForSeller(seller.id), [seller.id, getReviewsForSeller]);
  const avgRating = useMemo(() => {
    if (sellerReviews.length === 0) return seller.rating;
    return Math.round(sellerReviews.reduce((s, r) => s + r.rating, 0) / sellerReviews.length * 10) / 10;
  }, [sellerReviews, seller.rating]);

  const isFollowing = isFollowingSeller(seller.id);

  const handleFollow = useCallback(() => {
    toggleFollowSeller(seller.id);
  }, [seller.id, toggleFollowSeller]);

  return (
    <>
      <Stack.Screen options={{ title: seller.storeName ?? seller.name, headerStyle: { backgroundColor: Colors.surface } }} />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {seller.storeBanner && (
          <Image source={{ uri: seller.storeBanner }} style={styles.banner} contentFit="cover" />
        )}

        <View style={styles.profileSection}>
          <View style={styles.profileRow}>
            <View style={styles.avatarWrap}>
              <Image source={{ uri: seller.avatar }} style={styles.avatar} contentFit="cover" />
              {seller.isVerifiedSeller && (
                <View style={styles.verifiedBadge}>
                  <Crown size={10} color={Colors.gold} />
                </View>
              )}
            </View>
            <View style={styles.profileInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.storeName}>{seller.storeName ?? seller.name}</Text>
                {seller.sellerPlan === 'market' && (
                  <View style={styles.planBadge}>
                    <Text style={styles.planBadgeText}>MARKET</Text>
                  </View>
                )}
                {seller.sellerPlan === 'pro' && (
                  <View style={[styles.planBadge, { backgroundColor: Colors.proTag }]}>
                    <Text style={styles.planBadgeText}>PRO</Text>
                  </View>
                )}
              </View>
              <View style={styles.ratingRow}>
                <Star size={14} color={Colors.secondaryLight} fill={Colors.secondaryLight} />
                <Text style={styles.ratingText}>{seller.rating}</Text>
                <Text style={styles.reviewCountText}>({seller.reviewCount} reviews)</Text>
              </View>
              <View style={styles.locationRow}>
                <MapPin size={12} color={Colors.primaryLight} />
                <Text style={styles.locationText}>{seller.location}</Text>
              </View>
            </View>
          </View>

          <Text style={styles.bio}>{seller.bio}</Text>

          <View style={styles.statsBar}>
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{seller.totalSales ?? 0}</Text>
              <Text style={styles.statLabel}>Sales</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{sellerListings.length}</Text>
              <Text style={styles.statLabel}>Listings</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{seller.followersCount ?? 0}</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNum}>
                {new Date(seller.joinedDate).toLocaleDateString('en-US', { year: 'numeric' })}
              </Text>
              <Text style={styles.statLabel}>Joined</Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <Pressable
              style={[styles.followBtn, isFollowing && styles.followBtnActive]}
              onPress={handleFollow}
            >
              {isFollowing ? (
                <UserCheck size={16} color={Colors.textOnPrimary} />
              ) : (
                <UserPlus size={16} color={Colors.primary} />
              )}
              <Text style={[styles.followBtnText, isFollowing && styles.followBtnTextActive]}>
                {isFollowing ? 'Following' : 'Follow'}
              </Text>
            </Pressable>
            <Pressable style={styles.messageBtn} onPress={() => router.push('/chat/conv-new')}>
              <MessageCircle size={16} color={Colors.primary} />
              <Text style={styles.messageBtnText}>Message</Text>
            </Pressable>
          </View>
        </View>

        {seller.specialties && seller.specialties.length > 0 && (
          <View style={styles.specialtiesSection}>
            <Text style={styles.sectionTitle}>Specialties</Text>
            <View style={styles.specialtiesRow}>
              {seller.specialties.map(s => (
                <View key={s} style={styles.specialtyChip}>
                  <Text style={styles.specialtyText}>{s}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {sellerCategories.length > 0 && (
          <View style={styles.categoriesSection}>
            <Text style={styles.sectionTitle}>Categories</Text>
            <View style={styles.specialtiesRow}>
              {sellerCategories.map(c => (
                <View key={c} style={[styles.specialtyChip, { borderColor: Colors.primary + '40' }]}>
                  <Text style={[styles.specialtyText, { color: Colors.primary }]}>{c}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.listingsSection}>
          <View style={styles.listingsHeader}>
            <PackageIcon size={16} color={Colors.primary} />
            <Text style={styles.sectionTitle}>Active Listings</Text>
            <Text style={styles.listingsCount}>{sellerListings.length}</Text>
          </View>
          {sellerListings.map(item => (
            <View key={item.id} style={styles.listingWrapper}>
              <ListingCard listing={item} />
            </View>
          ))}
          {sellerListings.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🌱</Text>
              <Text style={styles.emptyText}>No active listings yet</Text>
            </View>
          )}
        </View>

        <View style={styles.reviewsSection}>
          <View style={styles.reviewsSummary}>
            <Text style={styles.sectionTitle}>Reviews</Text>
            <View style={styles.reviewsSummaryRight}>
              <Star size={14} color={Colors.secondaryLight} fill={Colors.secondaryLight} />
              <Text style={styles.reviewsAvg}>{avgRating}</Text>
              <Text style={styles.reviewsCount}>({sellerReviews.length > 0 ? sellerReviews.length : seller.reviewCount})</Text>
            </View>
          </View>
          {sellerReviews.length > 0 ? (
            sellerReviews.map(review => (
              <ReviewCard key={review.id} review={review} />
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>⭐</Text>
              <Text style={styles.emptyText}>No reviews yet</Text>
            </View>
          )}
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  banner: {
    width: '100%',
    height: 160,
  },
  profileSection: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  profileRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: Colors.primary,
  },
  verifiedBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  storeName: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text,
    flex: 1,
  },
  planBadge: {
    backgroundColor: Colors.marketTag,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  planBadgeText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  ratingText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  reviewCountText: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    fontSize: 13,
    color: Colors.primaryLight,
    fontWeight: '500' as const,
  },
  bio: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 14,
  },
  statsBar: {
    flexDirection: 'row',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    justifyContent: 'space-around',
    marginBottom: 14,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statNum: {
    fontSize: 17,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  followBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  followBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  followBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  followBtnTextActive: {
    color: Colors.textOnPrimary,
  },
  messageBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  messageBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  specialtiesSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  categoriesSection: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 10,
  },
  specialtiesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  specialtyChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.secondary + '50',
  },
  specialtyText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.secondary,
  },
  listingsSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  listingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  listingsCount: {
    fontSize: 13,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
    marginLeft: 'auto',
  },
  listingWrapper: {
    marginBottom: 0,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  emptyEmoji: {
    fontSize: 36,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textTertiary,
  },
  reviewsSection: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  reviewCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  reviewHeader: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  reviewAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  reviewHeaderText: {
    flex: 1,
  },
  reviewerName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  reviewStars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  reviewDate: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginLeft: 6,
  },
  reviewComment: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  bottomSpacer: {
    height: 40,
  },
  reviewerNameRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 2,
  },
  repeatBadge: {
    backgroundColor: Colors.freshGreen + '15',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  repeatBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.freshGreen,
  },
  reviewBreakdown: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginTop: 8,
    flexWrap: 'wrap' as const,
  },
  reviewBreakdownItem: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
  },
  reviewBreakdownDot: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginHorizontal: 4,
  },
  reviewsSummary: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 10,
  },
  reviewsSummaryRight: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  reviewsAvg: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  reviewsCount: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
});
