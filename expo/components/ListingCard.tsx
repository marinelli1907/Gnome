import React, { useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { Image } from 'expo-image';
import { MapPin, Clock, Megaphone, Leaf, ShieldCheck, Zap, Truck, Package as PackageIcon } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Listing, FreshnessLabel } from '@/types';
import Colors from '@/constants/colors';

interface ListingCardProps {
  listing: Listing;
  compact?: boolean;
}

const freshnessConfig: Record<FreshnessLabel, { label: string; color: string }> = {
  harvested_today: { label: 'Harvested Today', color: Colors.freshGreen },
  sell_soon: { label: 'Sell Soon', color: Colors.urgentOrange },
  fresh_picked: { label: 'Fresh Picked', color: Colors.freshGreen },
  limited_qty: { label: 'Limited Qty', color: Colors.promoted },
};

const categoryEmoji: Record<string, string> = {
  gnomes: '🍄',
  handmade: '🎨',
  decor: '🪴',
  flowers: '💐',
  seeds: '🌰',
  plants: '🌿',
};

function ListingCardInner({ listing, compact = false }: ListingCardProps) {
  const router = useRouter();
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scale, {
      toValue: 0.97,
      useNativeDriver: true,
    }).start();
  }, [scale]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 3,
      useNativeDriver: true,
    }).start();
  }, [scale]);

  const typeLabel = listing.type === 'free' ? 'Free' : listing.type === 'trade' ? 'Trade' : listing.price ? `$${listing.price}` : 'Sell';
  const typeColor = listing.type === 'free' ? Colors.free : listing.type === 'trade' ? Colors.trade : Colors.sell;
  const isPromoted = listing.promotion?.isActive;
  const freshness = listing.freshnessLabel ? freshnessConfig[listing.freshnessLabel] : null;
  const canShip = listing.deliveryOptions?.includes('ships');

  const stockPercent = listing.quantityRemaining != null && listing.quantityTotal
    ? listing.quantityRemaining / listing.quantityTotal
    : null;
  const isLowStock = stockPercent != null && stockPercent <= 0.3;

  const emoji = categoryEmoji[listing.category];

  if (compact) {
    return (
      <Pressable
        onPress={() => router.push(`/listing/${listing.id}`)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        <Animated.View style={[styles.compactCard, { transform: [{ scale }] }]}>
          <Image
            source={{ uri: listing.images[0] }}
            style={styles.compactImage}
            contentFit="cover"
          />
          <View style={styles.compactBadge}>
            <Text style={[styles.compactBadgeText, { color: typeColor }]}>{typeLabel}</Text>
          </View>
          {isPromoted && (
            <View style={styles.compactPromoBadge}>
              <Zap size={8} color={Colors.promoted} />
            </View>
          )}
          {canShip && (
            <View style={styles.compactShipBadge}>
              <Truck size={8} color={Colors.info} />
            </View>
          )}
          <View style={styles.compactInfo}>
            <Text style={styles.compactTitle} numberOfLines={1}>
              {emoji ? `${emoji} ` : ''}{listing.title}
            </Text>
            <View style={styles.compactMeta}>
              <MapPin size={11} color={Colors.textTertiary} />
              <Text style={styles.compactDistance}>{listing.distance} mi</Text>
            </View>
          </View>
        </Animated.View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => router.push(`/listing/${listing.id}`)}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View style={[styles.card, isPromoted && styles.cardPromoted, { transform: [{ scale }] }]}>
        <Image
          source={{ uri: listing.images[0] }}
          style={styles.image}
          contentFit="cover"
        />
        <View style={[styles.typeBadge, { backgroundColor: typeColor }]}>
          <Text style={styles.typeBadgeText}>{typeLabel}</Text>
        </View>

        {isPromoted && (
          <View style={styles.promotedBadge}>
            <Megaphone size={10} color={Colors.promoted} />
            <Text style={styles.promotedText}>Promoted</Text>
          </View>
        )}

        {listing.status === 'reserved' && (
          <View style={styles.reservedBadge}>
            <Text style={styles.reservedText}>Reserved</Text>
          </View>
        )}

        {freshness && !listing.status?.startsWith('reserved') && (
          <View style={[styles.freshBadge, { backgroundColor: freshness.color + '18' }]}>
            <View style={[styles.freshDot, { backgroundColor: freshness.color }]} />
            <Text style={[styles.freshText, { color: freshness.color }]}>{freshness.label}</Text>
          </View>
        )}

        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>{listing.title}</Text>
            {listing.seller.isVerifiedSeller && (
              <ShieldCheck size={14} color={Colors.primary} />
            )}
          </View>
          <Text style={styles.description} numberOfLines={2}>{listing.description}</Text>

          <View style={styles.tagsRow}>
            {listing.isOrganic && (
              <View style={styles.tag}>
                <Leaf size={10} color={Colors.freshGreen} />
                <Text style={styles.tagText}>Organic</Text>
              </View>
            )}
            {listing.noSpray && (
              <View style={styles.tag}>
                <ShieldCheck size={10} color={Colors.sell} />
                <Text style={styles.tagText}>No Spray</Text>
              </View>
            )}
            {canShip && (
              <View style={[styles.tag, { backgroundColor: Colors.info + '12' }]}>
                <Truck size={10} color={Colors.info} />
                <Text style={[styles.tagText, { color: Colors.info }]}>Ships</Text>
              </View>
            )}
            {listing.decorMeta?.handmade && (
              <View style={[styles.tag, { backgroundColor: Colors.secondary + '20' }]}>
                <Text style={[styles.tagText, { color: Colors.secondary }]}>Handmade</Text>
              </View>
            )}
            {listing.tags?.slice(0, 2).map(t => (
              <View key={t} style={styles.tag}>
                <Text style={styles.tagText}>{t}</Text>
              </View>
            ))}
          </View>

          <View style={styles.metaRow}>
            <View style={styles.sellerRow}>
              <Image
                source={{ uri: listing.seller.avatar }}
                style={styles.sellerAvatar}
                contentFit="cover"
              />
              <Text style={styles.sellerName}>{listing.seller.name}</Text>
              {listing.seller.sellerPlan === 'market' && (
                <View style={styles.marketBadge}>
                  <Text style={styles.marketBadgeText}>PRO</Text>
                </View>
              )}
            </View>
            <View style={styles.distanceRow}>
              {canShip ? (
                <PackageIcon size={13} color={Colors.info} />
              ) : (
                <MapPin size={13} color={Colors.textTertiary} />
              )}
              <Text style={styles.distanceText}>{listing.distance} mi</Text>
            </View>
          </View>

          {isLowStock && (
            <View style={styles.stockRow}>
              <View style={styles.stockBar}>
                <View style={[styles.stockFill, { width: `${(stockPercent ?? 0) * 100}%`, backgroundColor: Colors.urgentOrange }]} />
              </View>
              <Text style={styles.stockText}>
                {listing.quantityRemaining} left of {listing.quantityTotal}
              </Text>
            </View>
          )}

          {listing.quantity && !isLowStock ? (
            <View style={styles.quantityRow}>
              <Clock size={12} color={Colors.textTertiary} />
              <Text style={styles.quantityText}>{listing.quantity}</Text>
            </View>
          ) : null}
        </View>
      </Animated.View>
    </Pressable>
  );
}

export const ListingCard = React.memo(ListingCardInner);

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden' as const,
    shadowColor: Colors.cardShadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 3,
    marginBottom: 16,
  },
  cardPromoted: {
    borderWidth: 1.5,
    borderColor: Colors.promoted + '40',
  },
  image: {
    width: '100%',
    height: 200,
  },
  typeBadge: {
    position: 'absolute' as const,
    top: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typeBadgeText: {
    color: Colors.textInverse,
    fontSize: 12,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  promotedBadge: {
    position: 'absolute' as const,
    top: 12,
    right: 12,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: Colors.promotedLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  promotedText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.promoted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  reservedBadge: {
    position: 'absolute' as const,
    top: 12,
    right: 12,
    backgroundColor: Colors.warning,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  reservedText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  freshBadge: {
    position: 'absolute' as const,
    top: 170,
    left: 12,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  freshDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  freshText: {
    fontSize: 10,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  info: {
    padding: 14,
  },
  titleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1,
  },
  description: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 8,
  },
  tagsRow: {
    flexDirection: 'row' as const,
    gap: 6,
    marginBottom: 8,
    flexWrap: 'wrap' as const,
  },
  tag: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: Colors.backgroundSecondary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  sellerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  sellerAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  sellerName: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  marketBadge: {
    backgroundColor: Colors.proTag,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  marketBadgeText: {
    fontSize: 8,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  distanceRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
  },
  distanceText: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  stockRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginTop: 10,
  },
  stockBar: {
    flex: 1,
    height: 4,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  stockFill: {
    height: '100%',
    borderRadius: 2,
  },
  stockText: {
    fontSize: 11,
    color: Colors.urgentOrange,
    fontWeight: '600' as const,
  },
  quantityRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginTop: 8,
  },
  quantityText: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  compactCard: {
    width: 160,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    overflow: 'hidden' as const,
    shadowColor: Colors.cardShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
    marginRight: 12,
  },
  compactImage: {
    width: '100%',
    height: 120,
  },
  compactBadge: {
    position: 'absolute' as const,
    top: 8,
    left: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  compactBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
  },
  compactPromoBadge: {
    position: 'absolute' as const,
    top: 8,
    right: 8,
    backgroundColor: Colors.promotedLight,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  compactShipBadge: {
    position: 'absolute' as const,
    top: 28,
    right: 8,
    backgroundColor: Colors.info + '20',
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  compactInfo: {
    padding: 10,
  },
  compactTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  compactMeta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
  },
  compactDistance: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
});
