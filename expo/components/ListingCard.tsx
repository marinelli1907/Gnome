import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { MapPin, Clock } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import type { Listing, ListingType } from '@/types';
import { categoryFor } from '@/constants/categories';
import TypeBadge from '@/components/TypeBadge';
import { ctaLabel, formatPrice } from '@/lib/listingType';
import { fmtDistance } from '@/lib/location';
import { logEvent } from '@/lib/db';
import { useAuth } from '@/providers/AuthProvider';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';

function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d left`;
  const hours = Math.floor(ms / 3_600_000);
  return `${Math.max(1, hours)}h left`;
}

function shortValue(l: Listing, type: ListingType): string {
  if (type === 'sale') return l.price_cents != null ? formatPrice(l.price_cents, l.unit) : 'For sale';
  if (type === 'trade') return 'Trade';
  if (type === 'wanted') return 'Wanted';
  if (type === 'plot') return l.price_cents != null ? formatPrice(l.price_cents) : 'Plot';
  return 'Free';
}

/**
 * ListingCardV2 — the visual heart of the feed. Premium single-column card:
 * image, type badge, value, title, market, distance/freshness, primary CTA.
 */
export default function ListingCard({ listing, promoted }: { listing: Listing; promoted?: boolean }) {
  const router = useRouter();
  const { userId } = useAuth();
  const cat = categoryFor(listing.category);
  const photo = listing.photos?.[0];
  const type: ListingType = listing.listing_type ?? (listing.kind === 'wanted' ? 'wanted' : 'free');
  const isWanted = type === 'wanted';
  // <10 mi: one decimal; 10+: whole miles — approximate coords don't support
  // more precision. Preview/demo inventory never shows a distance: its
  // placement is illustrative, and a real-looking "2.1 mi away" would mislead.
  const distanceBase =
    listing.distance_miles != null && !listing.is_demo
      ? fmtDistance(listing.distance_miles)
      : null;
  const distance = distanceBase == null ? null : distanceBase === 'Nearby' ? 'Nearby' : `${distanceBase} away`;

  const open = () => {
    void logEvent('listing_card_opened', {
      userId: userId ?? null,
      listingId: listing.id,
      metadata: { listing_type: type, promoted: !!promoted },
    });
    if (promoted) {
      void logEvent('promoted_listing_opened', { userId: userId ?? null, listingId: listing.id });
    }
    router.push(`/listing/${listing.id}`);
  };

  const isOwner = !!userId && userId === listing.owner_id;

  const onCta = () => {
    if (isOwner || type === 'free') open();
    else router.push(`/request/${listing.id}`);
  };

  return (
    <Pressable onPress={open} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.imageWrap}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.image} contentFit="cover" transition={180} />
        ) : (
          <View style={[styles.image, styles.fallback]}>
            <Text style={styles.fallbackEmoji}>{cat.emoji}</Text>
          </View>
        )}
        <View style={styles.badgeWrap}>
          <TypeBadge type={type} />
          {promoted ? (
            <View style={styles.promotedTag}>
              <Text style={styles.promotedText}>Promoted</Text>
            </View>
          ) : null}
          {listing.is_demo ? (
            <View style={styles.previewTag}>
              <Text style={styles.previewText}>Preview</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.valueChip}>
          <Text style={styles.valueChipText}>{shortValue(listing, type)}</Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {isWanted ? `Looking for ${listing.title}` : listing.title}
        </Text>

        {listing.is_bundle ? (
          <Text style={styles.bundle} numberOfLines={1}>
            🎁 Gift basket
          </Text>
        ) : null}

        {listing.market?.name ? (
          <Text style={styles.market} numberOfLines={1}>
            🏡 {listing.market.name}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          {distance ? (
            <View style={styles.meta}>
              <MapPin size={13} color={Colors.textSecondary} />
              <Text style={styles.metaText}>{distance}</Text>
            </View>
          ) : null}
          <View style={styles.meta}>
            <Clock size={13} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{timeLeft(listing.expires_at)}</Text>
          </View>
          {type === 'trade' && listing.trade_for ? (
            <Text style={styles.tradeFor} numberOfLines={1}>
              · for {listing.trade_for}
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={onCta}
          style={({ pressed }) => [styles.cta, isOwner && styles.ctaOwn, pressed && { opacity: 0.85 }]}
        >
          <Text style={[styles.ctaText, isOwner && styles.ctaTextOwn]}>
            {isOwner ? 'Your listing · View' : ctaLabel(type)}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: Colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  pressed: { opacity: 0.96 },
  imageWrap: { position: 'relative' },
  image: { width: '100%', height: 190, backgroundColor: Colors.backgroundSecondary },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackEmoji: { fontSize: 64, fontFamily: fonts.regular },
  badgeWrap: { position: 'absolute', top: 12, left: 12, gap: 6, alignItems: 'flex-start' },
  promotedTag: {
    backgroundColor: Colors.gold,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  promotedText: { fontSize: 11, fontFamily: fonts.bold, color: Colors.text },
  previewTag: {
    backgroundColor: 'rgba(31,36,33,0.72)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  previewText: { fontSize: 11, fontFamily: fonts.bold, color: '#fff' },
  valueChip: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(255,253,248,0.94)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  valueChipText: { fontSize: 14, fontFamily: fonts.bold, color: Colors.text },
  body: { padding: 14, gap: 4 },
  title: { fontSize: 19, fontFamily: fonts.displayBold, color: Colors.text },
  market: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.secondary },
  bundle: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.sell },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2, flexWrap: 'wrap' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary },
  tradeFor: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, flexShrink: 1 },
  cta: {
    marginTop: 12,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  ctaText: { color: Colors.textInverse, fontSize: 15, fontFamily: fonts.bold },
  ctaOwn: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.border },
  ctaTextOwn: { color: Colors.textSecondary },
});
