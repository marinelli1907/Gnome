import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { MapPin, Clock } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import type { Listing } from '@/types';
import { categoryFor } from '@/constants/categories';
import Colors from '@/constants/colors';

function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d left`;
  const hours = Math.floor(ms / 3_600_000);
  return `${Math.max(1, hours)}h left`;
}

export default function ListingCard({ listing }: { listing: Listing }) {
  const router = useRouter();
  const cat = categoryFor(listing.category);
  const photo = listing.photos?.[0];
  const isWanted = listing.kind === 'wanted';
  const distance =
    listing.distance_miles != null
      ? listing.distance_miles < 0.1
        ? 'Nearby'
        : `${listing.distance_miles.toFixed(1)} mi`
      : null;

  return (
    <Pressable
      onPress={() => router.push(`/listing/${listing.id}`)}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.imageWrap}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.image} contentFit="cover" transition={150} />
        ) : (
          <View style={[styles.image, styles.imageFallback]}>
            <Text style={{ fontSize: 44 }}>{cat.emoji}</Text>
          </View>
        )}
        <View style={styles.catChip}>
          <Text style={styles.catChipText}>
            {cat.emoji} {cat.label}
          </Text>
        </View>
        <View style={[styles.kindChip, { backgroundColor: isWanted ? Colors.accent : Colors.primary }]}>
          <Text style={styles.kindChipText}>{isWanted ? 'Wanted' : 'Available'}</Text>
        </View>
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {isWanted ? `Looking for ${listing.title}` : listing.title}
        </Text>
        {listing.market?.name ? (
          <Text style={styles.market} numberOfLines={1}>
            🏡 {listing.market.name}
          </Text>
        ) : null}
        {listing.quantity ? (
          <Text style={styles.quantity} numberOfLines={1}>
            {listing.quantity}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          {distance ? (
            <View style={styles.meta}>
              <MapPin size={12} color={Colors.textSecondary} />
              <Text style={styles.metaText}>{distance}</Text>
            </View>
          ) : null}
          <View style={styles.meta}>
            <Clock size={12} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{timeLeft(listing.expires_at)}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  imageWrap: { position: 'relative' },
  image: { width: '100%', aspectRatio: 1.2, backgroundColor: Colors.backgroundSecondary },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  catChip: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  catChipText: { fontSize: 11, fontWeight: '700', color: Colors.text },
  kindChip: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  kindChipText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  body: { padding: 10, gap: 3 },
  title: { fontSize: 15, fontWeight: '700', color: Colors.text },
  market: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  quantity: { fontSize: 13, color: Colors.textSecondary },
  metaRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 12, color: Colors.textSecondary },
});
