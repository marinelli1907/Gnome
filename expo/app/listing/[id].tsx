import React, { useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Animated,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Image } from 'expo-image';
import {
  MapPin, Clock, Star, MessageCircle, ArrowRightLeft,
  Heart, Megaphone, Leaf, ShieldCheck, Crown, Zap, Eye, Users,
  Truck, Sun, Droplets, Ruler, Home, TreePine, Paintbrush, Package as PackageIcon,
} from 'lucide-react-native';
import { useApp } from '@/providers/AppProvider';
import Colors from '@/constants/colors';
import { FreshnessLabel, OrderStatus } from '@/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const freshnessConfig: Record<FreshnessLabel, { label: string; color: string }> = {
  harvested_today: { label: 'Harvested Today', color: Colors.freshGreen },
  sell_soon: { label: 'Sell Soon', color: Colors.urgentOrange },
  fresh_picked: { label: 'Fresh Picked', color: Colors.freshGreen },
  limited_qty: { label: 'Limited Quantity', color: Colors.promoted },
};

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { listings, user, isInWishlist, toggleWishlist, getOrderForListing } = useApp();
  const heartScale = useRef(new Animated.Value(1)).current;

  const listing = listings.find(l => l.id === id);

  const handleHeart = useCallback(() => {
    if (!listing) return;
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.3, useNativeDriver: true }),
      Animated.spring(heartScale, { toValue: 1, friction: 3, useNativeDriver: true }),
    ]).start();
    toggleWishlist(listing.id);
  }, [heartScale, listing, toggleWishlist]);

  if (!listing) {
    return (
      <View style={styles.notFound}>
        <Text style={styles.notFoundEmoji}>🌻</Text>
        <Text style={styles.notFoundTitle}>Listing not found</Text>
        <Text style={styles.notFoundText}>This listing may have been removed</Text>
      </View>
    );
  }

  const typeLabel = listing.type === 'free' ? 'Free' : listing.type === 'trade' ? 'Trade' : `$${listing.price}`;
  const typeColor = listing.type === 'free' ? Colors.free : listing.type === 'trade' ? Colors.trade : Colors.sell;
  const isPromoted = listing.promotion?.isActive;
  const freshness = listing.freshnessLabel ? freshnessConfig[listing.freshnessLabel] : null;
  const isOwner = listing.seller.id === user.id || listing.seller.id === 'current-user';
  const saved = isInWishlist(listing.id);
  const canShip = listing.deliveryOptions?.includes('ships');
  const canDeliver = listing.deliveryOptions?.includes('local_delivery');
  const existingOrder = getOrderForListing(listing.id);

  const orderStatusLabel: Record<OrderStatus, string> = {
    awaiting_response: 'Awaiting Seller Response',
    accepted: 'Order Accepted',
    ready_for_pickup: 'Ready for Pickup',
    out_for_delivery: 'Out for Delivery',
    completed: 'Completed',
    canceled: 'Canceled',
    sold_out: 'Sold Out',
  };

  const orderStatusColor: Record<OrderStatus, string> = {
    awaiting_response: Colors.promoted,
    accepted: Colors.info,
    ready_for_pickup: Colors.freshGreen,
    out_for_delivery: Colors.info,
    completed: Colors.primary,
    canceled: Colors.textTertiary,
    sold_out: Colors.accent,
  };

  const stockPercent = listing.quantityRemaining != null && listing.quantityTotal
    ? listing.quantityRemaining / listing.quantityTotal
    : null;
  const isLowStock = stockPercent != null && stockPercent <= 0.3;

  const hasSeedMeta = listing.seedMeta && Object.keys(listing.seedMeta).length > 0;
  const hasPlantMeta = listing.plantMeta && Object.keys(listing.plantMeta).length > 0;
  const hasDecorMeta = listing.decorMeta && Object.keys(listing.decorMeta).length > 0;
  const hasSupplyMeta = listing.supplyMeta && Object.keys(listing.supplyMeta).length > 0;

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerTransparent: true,
          headerTintColor: Colors.text,
        }}
      />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.imageCarousel}
        >
          {listing.images.map((img, i) => (
            <Image
              key={i}
              source={{ uri: img }}
              style={styles.heroImage}
              contentFit="cover"
            />
          ))}
        </ScrollView>

        {listing.images.length > 1 && (
          <View style={styles.imageIndicator}>
            {listing.images.map((_, i) => (
              <View key={i} style={[styles.dot, i === 0 && styles.dotActive]} />
            ))}
          </View>
        )}

        <View style={styles.content}>
          <View style={styles.topRow}>
            <View style={[styles.typeBadge, { backgroundColor: typeColor }]}>
              <Text style={styles.typeBadgeText}>{typeLabel}</Text>
            </View>
            {isPromoted && (
              <View style={styles.promoBadge}>
                <Megaphone size={10} color={Colors.promoted} />
                <Text style={styles.promoText}>Promoted</Text>
              </View>
            )}
            {listing.status === 'reserved' && (
              <View style={styles.statusBadge}>
                <Text style={styles.statusText}>Reserved</Text>
              </View>
            )}
          </View>

          {freshness && (
            <View style={[styles.freshnessBar, { backgroundColor: freshness.color + '12' }]}>
              <View style={[styles.freshDot, { backgroundColor: freshness.color }]} />
              <Text style={[styles.freshnessText, { color: freshness.color }]}>{freshness.label}</Text>
              {listing.harvestDate && (
                <Text style={styles.harvestDate}>
                  · Harvested {new Date(listing.harvestDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Text>
              )}
            </View>
          )}

          <Text style={styles.title}>{listing.title}</Text>

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <MapPin size={14} color={Colors.primaryLight} />
              <Text style={styles.metaText}>{listing.distance} mi away</Text>
            </View>
            <View style={styles.metaItem}>
              <Clock size={14} color={Colors.textTertiary} />
              <Text style={styles.metaText}>{listing.quantity}</Text>
            </View>
          </View>

          {listing.deliveryOptions && listing.deliveryOptions.length > 0 && (
            <View style={styles.deliveryRow}>
              {listing.deliveryOptions.includes('pickup') && (
                <View style={styles.deliveryChip}>
                  <MapPin size={11} color={Colors.primary} />
                  <Text style={styles.deliveryChipText}>Pickup</Text>
                </View>
              )}
              {canDeliver && (
                <View style={styles.deliveryChip}>
                  <Truck size={11} color={Colors.info} />
                  <Text style={[styles.deliveryChipText, { color: Colors.info }]}>Local Delivery</Text>
                </View>
              )}
              {canShip && (
                <View style={[styles.deliveryChip, { backgroundColor: Colors.info + '12', borderColor: Colors.info + '30' }]}>
                  <PackageIcon size={11} color={Colors.info} />
                  <Text style={[styles.deliveryChipText, { color: Colors.info }]}>Ships</Text>
                </View>
              )}
            </View>
          )}

          {(listing.viewCount != null || listing.interestCount != null) && (
            <View style={styles.engagementRow}>
              {listing.viewCount != null && (
                <View style={styles.engagementItem}>
                  <Eye size={13} color={Colors.textTertiary} />
                  <Text style={styles.engagementText}>{listing.viewCount} views</Text>
                </View>
              )}
              {listing.interestCount != null && (
                <View style={styles.engagementItem}>
                  <Users size={13} color={Colors.textTertiary} />
                  <Text style={styles.engagementText}>{listing.interestCount} interested</Text>
                </View>
              )}
            </View>
          )}

          {isLowStock && (
            <View style={styles.stockAlert}>
              <View style={styles.stockBarContainer}>
                <View style={[styles.stockBarFill, { width: `${(stockPercent ?? 0) * 100}%` }]} />
              </View>
              <Text style={styles.stockAlertText}>
                Only {listing.quantityRemaining} left of {listing.quantityTotal}
              </Text>
            </View>
          )}

          {existingOrder && (
            <Pressable
              style={[styles.orderStatusBar, { backgroundColor: orderStatusColor[existingOrder.status] + '12' }]}
              onPress={() => router.push('/orders')}
            >
              <View style={[styles.orderStatusDot, { backgroundColor: orderStatusColor[existingOrder.status] }]} />
              <Text style={[styles.orderStatusText, { color: orderStatusColor[existingOrder.status] }]}>
                {orderStatusLabel[existingOrder.status]}
              </Text>
              <Text style={styles.orderStatusLink}>View Order</Text>
            </Pressable>
          )}

          <View style={styles.actionRow}>
            {listing.type === 'sell' ? (
              <View style={styles.actionBtnsCol}>
                <Pressable
                  style={styles.buyBtn}
                  onPress={() => router.push(`/checkout?listingId=${listing.id}&orderType=buy` as any)}
                >
                  <Zap size={18} color={Colors.textInverse} />
                  <Text style={styles.buyBtnText}>Buy Now</Text>
                </Pressable>
                {canDeliver && (
                  <Pressable
                    style={[styles.secondaryBtn]}
                    onPress={() => router.push(`/checkout?listingId=${listing.id}&orderType=delivery` as any)}
                  >
                    <Truck size={16} color={Colors.info} />
                    <Text style={[styles.secondaryBtnText, { color: Colors.info }]}>Request Delivery</Text>
                  </Pressable>
                )}
              </View>
            ) : listing.type === 'trade' ? (
              <Pressable
                style={[styles.buyBtn, { backgroundColor: Colors.trade }]}
                onPress={() => router.push(`/checkout?listingId=${listing.id}&orderType=trade` as any)}
              >
                <ArrowRightLeft size={18} color={Colors.textInverse} />
                <Text style={styles.buyBtnText}>Propose Trade</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[styles.buyBtn, { backgroundColor: Colors.free }]}
                onPress={() => router.push(`/checkout?listingId=${listing.id}&orderType=pickup` as any)}
              >
                <MapPin size={18} color={Colors.textInverse} />
                <Text style={styles.buyBtnText}>Request Pickup</Text>
              </Pressable>
            )}
            <Animated.View style={{ transform: [{ scale: heartScale }] }}>
              <Pressable style={[styles.iconBtn, saved && styles.iconBtnSaved]} onPress={handleHeart}>
                <Heart size={20} color={saved ? Colors.textInverse : Colors.accent} fill={saved ? Colors.accent : 'none'} />
              </Pressable>
            </Animated.View>
            <Pressable style={styles.iconBtn} onPress={() => router.push(`/chat/conv-new`)}>
              <MessageCircle size={20} color={Colors.text} />
            </Pressable>
          </View>

          {isOwner && (
            <Pressable
              style={styles.promoteBtn}
              onPress={() => router.push(`/promote-listing?id=${listing.id}`)}
            >
              <Megaphone size={16} color={Colors.promoted} />
              <Text style={styles.promoteBtnText}>
                {isPromoted ? 'Manage Promotion' : 'Promote This Listing'}
              </Text>
            </Pressable>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.description}>{listing.description}</Text>
          </View>

          {(listing.isOrganic || listing.noSpray || listing.decorMeta?.handmade || (listing.tags ?? []).length > 0) && (
            <View style={styles.tagsSection}>
              {listing.isOrganic && (
                <View style={styles.qualityTag}>
                  <Leaf size={14} color={Colors.freshGreen} />
                  <Text style={styles.qualityTagText}>Organically Grown</Text>
                </View>
              )}
              {listing.noSpray && (
                <View style={styles.qualityTag}>
                  <ShieldCheck size={14} color={Colors.sell} />
                  <Text style={styles.qualityTagText}>No Pesticides</Text>
                </View>
              )}
              {listing.decorMeta?.handmade && (
                <View style={styles.qualityTag}>
                  <Paintbrush size={14} color={Colors.secondary} />
                  <Text style={styles.qualityTagText}>Handmade</Text>
                </View>
              )}
              {(listing.tags ?? []).map(tag => (
                <View key={tag} style={styles.qualityTag}>
                  <Text style={styles.qualityTagText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {listing.tradeFor && (
            <View style={styles.tradeSection}>
              <ArrowRightLeft size={16} color={Colors.trade} />
              <View style={styles.tradeContent}>
                <Text style={styles.tradeLabel}>Will trade for</Text>
                <Text style={styles.tradeText}>{listing.tradeFor}</Text>
              </View>
            </View>
          )}

          {hasSeedMeta && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Seed Details</Text>
              <View style={styles.detailsGrid}>
                {listing.seedMeta?.packetSize && (
                  <View style={styles.detailItem}>
                    <View style={styles.detailIconWrap}>
                      <PackageIcon size={14} color={Colors.primary} />
                    </View>
                    <View style={styles.detailTextWrap}>
                      <Text style={styles.detailLabel}>Packet Size</Text>
                      <Text style={styles.detailValue}>{listing.seedMeta.packetSize}</Text>
                    </View>
                  </View>
                )}
                {listing.seedMeta?.plantingSeason && (
                  <View style={styles.detailItem}>
                    <View style={styles.detailIconWrap}>
                      <Sun size={14} color={Colors.secondaryLight} />
                    </View>
                    <View style={styles.detailTextWrap}>
                      <Text style={styles.detailLabel}>Planting Season</Text>
                      <Text style={styles.detailValue}>{listing.seedMeta.plantingSeason}</Text>
                    </View>
                  </View>
                )}
                {listing.seedMeta?.daysToGermination && (
                  <View style={styles.detailItem}>
                    <View style={styles.detailIconWrap}>
                      <TreePine size={14} color={Colors.freshGreen} />
                    </View>
                    <View style={styles.detailTextWrap}>
                      <Text style={styles.detailLabel}>Germination</Text>
                      <Text style={styles.detailValue}>{listing.seedMeta.daysToGermination}</Text>
                    </View>
                  </View>
                )}
                {listing.seedMeta?.hardinessZone && (
                  <View style={styles.detailItem}>
                    <View style={styles.detailIconWrap}>
                      <MapPin size={14} color={Colors.info} />
                    </View>
                    <View style={styles.detailTextWrap}>
                      <Text style={styles.detailLabel}>Hardiness Zone</Text>
                      <Text style={styles.detailValue}>{listing.seedMeta.hardinessZone}</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
          )}

          {hasPlantMeta && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Plant Care</Text>
              <View style={styles.detailsGrid}>
                {listing.plantMeta?.sunNeeds && (
                  <View style={styles.detailItem}>
                    <View style={styles.detailIconWrap}>
                      <Sun size={14} color={Colors.secondaryLight} />
                    </View>
                    <View style={styles.detailTextWrap}>
                      <Text style={styles.detailLabel}>Sun</Text>
                      <Text style={styles.detailValue}>{listing.plantMeta.sunNeeds}</Text>
                    </View>
                  </View>
                )}
                {listing.plantMeta?.waterNeeds && (
                  <View style={styles.detailItem}>
                    <View style={styles.detailIconWrap}>
                      <Droplets size={14} color={Colors.info} />
                    </View>
                    <View style={styles.detailTextWrap}>
                      <Text style={styles.detailLabel}>Water</Text>
                      <Text style={styles.detailValue}>{listing.plantMeta.waterNeeds}</Text>
                    </View>
                  </View>
                )}
                {listing.plantMeta?.potSize && (
                  <View style={styles.detailItem}>
                    <View style={styles.detailIconWrap}>
                      <Ruler size={14} color={Colors.textSecondary} />
                    </View>
                    <View style={styles.detailTextWrap}>
                      <Text style={styles.detailLabel}>Pot Size</Text>
                      <Text style={styles.detailValue}>{listing.plantMeta.potSize}</Text>
                    </View>
                  </View>
                )}
                {listing.plantMeta?.matureHeight && (
                  <View style={styles.detailItem}>
                    <View style={styles.detailIconWrap}>
                      <TreePine size={14} color={Colors.freshGreen} />
                    </View>
                    <View style={styles.detailTextWrap}>
                      <Text style={styles.detailLabel}>Mature Height</Text>
                      <Text style={styles.detailValue}>{listing.plantMeta.matureHeight}</Text>
                    </View>
                  </View>
                )}
                {(listing.plantMeta?.indoor || listing.plantMeta?.outdoor) && (
                  <View style={styles.detailItem}>
                    <View style={styles.detailIconWrap}>
                      <Home size={14} color={Colors.primary} />
                    </View>
                    <View style={styles.detailTextWrap}>
                      <Text style={styles.detailLabel}>Placement</Text>
                      <Text style={styles.detailValue}>
                        {[listing.plantMeta.indoor && 'Indoor', listing.plantMeta.outdoor && 'Outdoor'].filter(Boolean).join(' / ')}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
          )}

          {hasDecorMeta && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Item Details</Text>
              <View style={styles.detailsGrid}>
                {listing.decorMeta?.material && (
                  <View style={styles.detailItem}>
                    <View style={styles.detailIconWrap}>
                      <Paintbrush size={14} color={Colors.secondary} />
                    </View>
                    <View style={styles.detailTextWrap}>
                      <Text style={styles.detailLabel}>Material</Text>
                      <Text style={styles.detailValue}>{listing.decorMeta.material}</Text>
                    </View>
                  </View>
                )}
                {listing.decorMeta?.dimensions && (
                  <View style={styles.detailItem}>
                    <View style={styles.detailIconWrap}>
                      <Ruler size={14} color={Colors.textSecondary} />
                    </View>
                    <View style={styles.detailTextWrap}>
                      <Text style={styles.detailLabel}>Dimensions</Text>
                      <Text style={styles.detailValue}>{listing.decorMeta.dimensions}</Text>
                    </View>
                  </View>
                )}
                {listing.decorMeta?.indoorOutdoor && (
                  <View style={styles.detailItem}>
                    <View style={styles.detailIconWrap}>
                      <Home size={14} color={Colors.primary} />
                    </View>
                    <View style={styles.detailTextWrap}>
                      <Text style={styles.detailLabel}>Use</Text>
                      <Text style={styles.detailValue}>
                        {listing.decorMeta.indoorOutdoor === 'both' ? 'Indoor & Outdoor' : listing.decorMeta.indoorOutdoor === 'indoor' ? 'Indoor' : 'Outdoor'}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
          )}

          {hasSupplyMeta && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Supply Details</Text>
              <View style={styles.detailsGrid}>
                {listing.supplyMeta?.weight && (
                  <View style={styles.detailItem}>
                    <View style={styles.detailIconWrap}>
                      <PackageIcon size={14} color={Colors.textSecondary} />
                    </View>
                    <View style={styles.detailTextWrap}>
                      <Text style={styles.detailLabel}>Weight</Text>
                      <Text style={styles.detailValue}>{listing.supplyMeta.weight}</Text>
                    </View>
                  </View>
                )}
                {listing.supplyMeta?.volume && (
                  <View style={styles.detailItem}>
                    <View style={styles.detailIconWrap}>
                      <Ruler size={14} color={Colors.info} />
                    </View>
                    <View style={styles.detailTextWrap}>
                      <Text style={styles.detailLabel}>Volume</Text>
                      <Text style={styles.detailValue}>{listing.supplyMeta.volume}</Text>
                    </View>
                  </View>
                )}
                {listing.supplyMeta?.coverage && (
                  <View style={styles.detailItem}>
                    <View style={styles.detailIconWrap}>
                      <MapPin size={14} color={Colors.freshGreen} />
                    </View>
                    <View style={styles.detailTextWrap}>
                      <Text style={styles.detailLabel}>Coverage</Text>
                      <Text style={styles.detailValue}>{listing.supplyMeta.coverage}</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Details</Text>
            <View style={styles.generalDetails}>
              <View style={styles.generalDetailRow}>
                <Text style={styles.generalDetailLabel}>Pickup</Text>
                <Text style={styles.generalDetailValue}>{listing.pickupLocation}</Text>
              </View>
              {listing.pickupWindow && (
                <View style={styles.generalDetailRow}>
                  <Text style={styles.generalDetailLabel}>Pickup Hours</Text>
                  <Text style={styles.generalDetailValue}>{listing.pickupWindow}</Text>
                </View>
              )}
              <View style={styles.generalDetailRow}>
                <Text style={styles.generalDetailLabel}>Available</Text>
                <Text style={styles.generalDetailValue}>
                  {new Date(listing.availableFrom).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {listing.availableTo ? ` - ${new Date(listing.availableTo).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '+'}
                </Text>
              </View>
              <View style={styles.generalDetailRow}>
                <Text style={styles.generalDetailLabel}>Category</Text>
                <Text style={styles.generalDetailValue}>{listing.category}</Text>
              </View>
              {listing.harvestDate && (
                <View style={styles.generalDetailRow}>
                  <Text style={styles.generalDetailLabel}>Harvest Date</Text>
                  <Text style={styles.generalDetailValue}>
                    {new Date(listing.harvestDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Text>
                </View>
              )}
            </View>
          </View>

          <Pressable
            style={styles.sellerCard}
            onPress={() => router.push(`/storefront?sellerId=${listing.seller.id}` as any)}
          >
            <Image
              source={{ uri: listing.seller.avatar }}
              style={styles.sellerAvatar}
              contentFit="cover"
            />
            <View style={styles.sellerInfo}>
              <View style={styles.sellerNameRow}>
                <Text style={styles.sellerName}>{listing.seller.name}</Text>
                {listing.seller.isVerifiedSeller && (
                  <View style={styles.sellerBadge}>
                    <Crown size={10} color={Colors.gold} />
                  </View>
                )}
                {listing.seller.sellerPlan === 'market' && (
                  <View style={styles.marketTag}>
                    <Text style={styles.marketTagText}>MARKET</Text>
                  </View>
                )}
              </View>
              <View style={styles.sellerRating}>
                <Star size={12} color={Colors.secondaryLight} fill={Colors.secondaryLight} />
                <Text style={styles.sellerRatingText}>{listing.seller.rating} ({listing.seller.reviewCount} reviews)</Text>
              </View>
              <Text style={styles.sellerMeta}>
                {listing.seller.location} · {listing.seller.totalSales ?? 0} sales
              </Text>
            </View>
          </Pressable>

          <View style={styles.bottomSpacer} />
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  imageCarousel: {
    height: 320,
  },
  heroImage: {
    width: SCREEN_WIDTH,
    height: 320,
  },
  imageIndicator: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: -20,
    marginBottom: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  dotActive: {
    backgroundColor: '#fff',
    width: 18,
    borderRadius: 3,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  topRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  typeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
  },
  typeBadgeText: {
    color: Colors.textInverse,
    fontSize: 13,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  promoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.promotedLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  promoText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.promoted,
  },
  statusBadge: {
    backgroundColor: Colors.warning,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  freshnessBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 12,
  },
  freshDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  freshnessText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  harvestDate: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  title: {
    fontSize: 26,
    fontWeight: '800' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 8,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  deliveryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  deliveryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  deliveryChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  engagementRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  engagementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  engagementText: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  stockAlert: {
    backgroundColor: Colors.urgentOrange + '12',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  stockBarContainer: {
    height: 4,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 6,
  },
  stockBarFill: {
    height: '100%',
    backgroundColor: Colors.urgentOrange,
    borderRadius: 2,
  },
  stockAlertText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.urgentOrange,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  buyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  buyBtnText: {
    color: Colors.textInverse,
    fontSize: 15,
    fontWeight: '700' as const,
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconBtnSaved: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  promoteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.promotedBg,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.promoted + '30',
  },
  promoteBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.promoted,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 10,
  },
  description: {
    fontSize: 15,
    color: Colors.textSecondary,
    lineHeight: 23,
  },
  tagsSection: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  qualityTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  qualityTagText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  tradeSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.trade,
    borderLeftWidth: 3,
  },
  tradeContent: {
    flex: 1,
  },
  tradeLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.trade,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  tradeText: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  detailsGrid: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  detailIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailTextWrap: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  detailValue: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '600' as const,
    marginTop: 1,
  },
  generalDetails: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 14,
  },
  generalDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  generalDetailLabel: {
    fontSize: 14,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
  },
  generalDetailValue: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '600' as const,
    flex: 1,
    textAlign: 'right' as const,
  },
  sellerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sellerAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  sellerInfo: {
    flex: 1,
  },
  sellerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  sellerName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  sellerBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  marketTag: {
    backgroundColor: Colors.marketTag,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  marketTagText: {
    fontSize: 8,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  sellerRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  sellerRatingText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  sellerMeta: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  bottomSpacer: {
    height: 40,
  },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    paddingHorizontal: 40,
  },
  notFoundEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  notFoundTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 6,
  },
  notFoundText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
  },
  orderStatusBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 12,
  },
  orderStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  orderStatusText: {
    fontSize: 13,
    fontWeight: '700' as const,
    flex: 1,
  },
  orderStatusLink: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  actionBtnsCol: {
    flex: 1,
    gap: 8,
  },
  secondaryBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.info + '40',
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
});
