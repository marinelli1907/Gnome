import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  Settings,
  Star,
  MapPin,
  Calendar,
  ChevronRight,
  Leaf,
  ShoppingBag,
  Heart,
  LogOut,
  BarChart3,
  Crown,
  Megaphone,
  FileText,
  DollarSign,
  TrendingUp,
  Package,
  Store,
  UserCheck,
} from 'lucide-react-native';
import { useApp } from '@/providers/AppProvider';
import Colors from '@/constants/colors';
import { mockSellerStats } from '@/mocks/seller';
import { Bell, ClipboardList, RotateCcw } from 'lucide-react-native';

type ViewMode = 'buyer' | 'seller';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, listings, wishlistIds, followedSellerIds, buyerOrders, sellerOrders, unreadNotifCount } = useApp();
  const [viewMode, setViewMode] = useState<ViewMode>('seller');
  const stats = mockSellerStats;

  const myListings = listings.filter(l => l.seller.id === user.id || l.seller.id === 'current-user');

  const activeBuyerOrders = buyerOrders.filter(o => !['completed', 'canceled', 'sold_out'].includes(o.status)).length;
  const completedBuyerOrders = buyerOrders.filter(o => o.status === 'completed').length;

  const buyerMenuItems = [
    { icon: ClipboardList, label: 'Orders & Requests', value: activeBuyerOrders > 0 ? `${activeBuyerOrders} active` : `${completedBuyerOrders} completed`, onPress: () => router.push('/orders') },
    { icon: Heart, label: 'Saved Items', value: `${wishlistIds.length} saved`, onPress: () => console.log('saved') },
    { icon: UserCheck, label: 'Following', value: `${followedSellerIds.length} sellers`, onPress: () => console.log('following') },
    { icon: RotateCcw, label: 'Buy Again', value: 'Repeat past purchases', onPress: () => router.push('/orders') },
    { icon: Bell, label: 'Notifications', value: unreadNotifCount > 0 ? `${unreadNotifCount} new` : 'All caught up', onPress: () => router.push('/notifications') },
    { icon: ShoppingBag, label: 'My Listings', value: `${myListings.length} active`, onPress: () => console.log('my listings') },
    { icon: Star, label: 'Reviews', value: `${user.reviewCount} reviews`, onPress: () => console.log('reviews') },
    { icon: Settings, label: 'Settings', value: '', onPress: () => console.log('settings') },
  ];

  const activeSellerOrders = sellerOrders.filter(o => !['completed', 'canceled', 'sold_out'].includes(o.status)).length;

  const sellerMenuItems = [
    { icon: ClipboardList, label: 'Sales & Orders', value: activeSellerOrders > 0 ? `${activeSellerOrders} pending` : 'View history', onPress: () => router.push('/orders') },
    { icon: Store, label: 'My Storefront', value: user.storeName ?? 'Set up your store', onPress: () => router.push(`/storefront?sellerId=${user.id}` as any) },
    { icon: BarChart3, label: 'Seller Dashboard', value: 'View analytics & earnings', onPress: () => router.push('/seller-dashboard') },
    { icon: Crown, label: 'Gnome Market Plan', value: user.sellerPlan === 'pro' ? 'Grower Pro' : user.sellerPlan === 'market' ? 'Gnome Market' : 'Starter', onPress: () => router.push('/seller-plan') },
    { icon: Megaphone, label: 'Promoted Listings', value: `${stats.promotedListings} active`, onPress: () => router.push('/seller-dashboard') },
    { icon: FileText, label: 'Earnings & Tax', value: `${stats.totalEarnings} earned`, onPress: () => router.push('/tax-summary') },
    { icon: Bell, label: 'Notifications', value: unreadNotifCount > 0 ? `${unreadNotifCount} new` : 'All caught up', onPress: () => router.push('/notifications') },
    { icon: ShoppingBag, label: 'My Listings', value: `${myListings.length} active`, onPress: () => console.log('my listings') },
    { icon: Settings, label: 'Settings', value: '', onPress: () => console.log('settings') },
  ];

  const menuItems = viewMode === 'seller' ? sellerMenuItems : buyerMenuItems;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.profileHeader}>
          <View style={styles.profileTopRow}>
            <View style={styles.avatarSection}>
              <Image source={{ uri: user.avatar }} style={styles.avatar} contentFit="cover" />
              <View style={styles.ratingBadge}>
                <Star size={10} color={Colors.secondaryLight} fill={Colors.secondaryLight} />
                <Text style={styles.ratingText}>{user.rating}</Text>
              </View>
              {user.isVerifiedSeller && (
                <View style={styles.verifiedBadge}>
                  <Crown size={10} color={Colors.gold} />
                </View>
              )}
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{user.listingCount}</Text>
                <Text style={styles.statLabel}>Listings</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{user.totalSales ?? 0}</Text>
                <Text style={styles.statLabel}>Sales</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{user.followersCount ?? 0}</Text>
                <Text style={styles.statLabel}>Followers</Text>
              </View>
            </View>
          </View>

          <View style={styles.nameRow}>
            <Text style={styles.name}>{user.name}</Text>
            {user.sellerPlan && user.sellerPlan !== 'free' && (
              <View style={[
                styles.planTag,
                user.sellerPlan === 'market' ? styles.planTagMarket : styles.planTagPro,
              ]}>
                <Text style={styles.planTagText}>
                  {user.sellerPlan === 'market' ? 'MARKET' : 'PRO'}
                </Text>
              </View>
            )}
          </View>
          {user.storeName && (
            <Text style={styles.storeName}>{user.storeName}</Text>
          )}
          <View style={styles.locationRow}>
            <MapPin size={13} color={Colors.primaryLight} />
            <Text style={styles.location}>{user.location}</Text>
          </View>
          <Text style={styles.bio}>{user.bio}</Text>

          {user.gardenSize && (
            <View style={styles.gardenInfo}>
              <Leaf size={14} color={Colors.primary} />
              <Text style={styles.gardenSize}>{user.gardenSize}</Text>
            </View>
          )}

          <View style={styles.joinedRow}>
            <Calendar size={12} color={Colors.textTertiary} />
            <Text style={styles.joinedText}>Joined {new Date(user.joinedDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
          </View>
        </View>

        <View style={styles.viewToggle}>
          <Pressable
            style={[styles.toggleBtn, viewMode === 'buyer' && styles.toggleBtnActive]}
            onPress={() => setViewMode('buyer')}
          >
            <Heart size={14} color={viewMode === 'buyer' ? Colors.textOnPrimary : Colors.textSecondary} />
            <Text style={[styles.toggleText, viewMode === 'buyer' && styles.toggleTextActive]}>Buyer</Text>
          </Pressable>
          <Pressable
            style={[styles.toggleBtn, viewMode === 'seller' && styles.toggleBtnActive]}
            onPress={() => setViewMode('seller')}
          >
            <Package size={14} color={viewMode === 'seller' ? Colors.textOnPrimary : Colors.textSecondary} />
            <Text style={[styles.toggleText, viewMode === 'seller' && styles.toggleTextActive]}>Seller</Text>
          </Pressable>
        </View>

        {viewMode === 'seller' && (
          <View style={styles.earningsPreview}>
            <View style={styles.earningsPreviewHeader}>
              <Text style={styles.earningsPreviewTitle}>Earnings Overview</Text>
              <Pressable onPress={() => router.push('/seller-dashboard')}>
                <Text style={styles.earningsPreviewLink}>Dashboard</Text>
              </Pressable>
            </View>
            <View style={styles.earningsRow}>
              <View style={styles.earningsStat}>
                <View style={[styles.earningsIcon, { backgroundColor: Colors.primary + '15' }]}>
                  <DollarSign size={16} color={Colors.primary} />
                </View>
                <Text style={styles.earningsValue}>${stats.totalEarnings}</Text>
                <Text style={styles.earningsLabel}>Total</Text>
              </View>
              <View style={styles.earningsStat}>
                <View style={[styles.earningsIcon, { backgroundColor: Colors.freshGreen + '15' }]}>
                  <TrendingUp size={16} color={Colors.freshGreen} />
                </View>
                <Text style={styles.earningsValue}>${stats.monthlyEarnings}</Text>
                <Text style={styles.earningsLabel}>This Month</Text>
              </View>
              <View style={styles.earningsStat}>
                <View style={[styles.earningsIcon, { backgroundColor: Colors.promoted + '15' }]}>
                  <Package size={16} color={Colors.promoted} />
                </View>
                <Text style={styles.earningsValue}>{stats.totalOrders}</Text>
                <Text style={styles.earningsLabel}>Orders</Text>
              </View>
            </View>
          </View>
        )}

        {viewMode === 'buyer' && wishlistIds.length > 0 && (
          <View style={styles.savedPreview}>
            <View style={styles.savedPreviewHeader}>
              <Heart size={14} color={Colors.accent} />
              <Text style={styles.savedPreviewTitle}>{wishlistIds.length} Saved Items</Text>
            </View>
            <Text style={styles.savedPreviewText}>Tap to view your wishlist</Text>
          </View>
        )}

        {user.specialties && user.specialties.length > 0 && (
          <View style={styles.specialtiesSection}>
            <Text style={styles.sectionTitle}>Specialties</Text>
            <View style={styles.specialtiesGrid}>
              {user.specialties.map((item, i) => (
                <View key={i} style={styles.specialtyTag}>
                  <Text style={styles.specialtyTagText}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.growsSection}>
          <Text style={styles.sectionTitle}>What I Grow</Text>
          <View style={styles.growsGrid}>
            {user.grows.map((item, i) => (
              <View key={i} style={styles.growTag}>
                <Text style={styles.growTagText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.menuSection}>
          {menuItems.map((item, i) => {
            const IconComp = item.icon;
            return (
              <Pressable key={i} style={styles.menuRow} onPress={item.onPress}>
                <View style={styles.menuIconWrapper}>
                  <IconComp size={20} color={Colors.primary} />
                </View>
                <View style={styles.menuContent}>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  {item.value ? <Text style={styles.menuValue}>{item.value}</Text> : null}
                </View>
                <ChevronRight size={18} color={Colors.textTertiary} />
              </Pressable>
            );
          })}
        </View>

        <Pressable style={styles.logoutBtn}>
          <LogOut size={18} color={Colors.accent} />
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  profileHeader: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    marginBottom: 16,
  },
  avatarSection: {
    position: 'relative',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: Colors.primary,
  },
  ratingBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primaryDark,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  ratingText: {
    color: Colors.textInverse,
    fontSize: 11,
    fontWeight: '700' as const,
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
  statsRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: Colors.border,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  name: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  planTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  planTagPro: {
    backgroundColor: Colors.proTag,
  },
  planTagMarket: {
    backgroundColor: Colors.marketTag,
  },
  planTagText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: 0.8,
  },
  storeName: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '600' as const,
    marginBottom: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  location: {
    fontSize: 14,
    color: Colors.primaryLight,
    fontWeight: '500' as const,
  },
  bio: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 10,
  },
  gardenInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  gardenSize: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  joinedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  joinedText: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  viewToggle: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 11,
  },
  toggleBtnActive: {
    backgroundColor: Colors.primary,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  toggleTextActive: {
    color: Colors.textOnPrimary,
  },
  earningsPreview: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
  },
  earningsPreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  earningsPreviewTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  earningsPreviewLink: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  earningsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  earningsStat: {
    alignItems: 'center',
    flex: 1,
  },
  earningsIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  earningsValue: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  earningsLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  savedPreview: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.accent + '20',
  },
  savedPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  savedPreviewTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  savedPreviewText: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
  specialtiesSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  specialtiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  specialtyTag: {
    backgroundColor: Colors.secondary + '15',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.secondary + '30',
  },
  specialtyTagText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.secondary,
  },
  growsSection: {
    padding: 20,
  },
  growsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  growTag: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  growTagText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  menuSection: {
    marginHorizontal: 20,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  menuIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuContent: {
    flex: 1,
  },
  menuLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  menuValue: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.accent,
  },
});
