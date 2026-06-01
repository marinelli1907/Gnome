import React, { useEffect } from 'react';
import {
  Alert,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Clock } from 'lucide-react-native';
import { Avatar, Badge, Button, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { categoryFor } from '@/constants/categories';
import { useAuth } from '@/providers/AuthProvider';
import { useClaimListing, useListing, useMyClaims, logEvent } from '@/lib/db';

const { width } = Dimensions.get('window');

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const { data: listing, isLoading } = useListing(id);
  const myClaims = useMyClaims(userId ?? undefined);
  const claim = useClaimListing(userId ?? undefined);

  useEffect(() => {
    if (listing && listing.kind === 'wanted') {
      void logEvent('wanted_viewed', { userId: userId ?? null, listingId: listing.id });
    }
  }, [listing?.id, listing?.kind, userId]);

  if (isLoading) {
    return <View style={styles.screen} />;
  }
  if (!listing) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🥕" title="Listing not found" subtitle="It may have expired or been removed." />
      </View>
    );
  }

  const cat = categoryFor(listing.category);
  const isOwner = userId === listing.owner_id;
  const isWanted = listing.kind === 'wanted';
  const existingClaim = (myClaims.data ?? []).find((c) => c.listing_id === listing.id);
  const isActive = listing.status === 'active';

  const onIHaveThis = () => {
    router.push({
      pathname: '/post',
      params: {
        kind: 'offer',
        category: listing.category,
        title: `Offer: ${listing.title}`,
        fulfilledBy: listing.id,
      },
    });
  };

  const onClaim = () => {
    if (!userId) {
      router.push('/sign-in');
      return;
    }
    claim.mutate(
      { listingId: listing.id, title: listing.title },
      {
        onSuccess: () =>
          Alert.alert('Claim sent!', 'The owner will get a notification to approve your claim.'),
        onError: (e: any) => Alert.alert('Could not claim', e?.message ?? 'Try again.'),
      },
    );
  };

  const photos = listing.photos ?? [];

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
        {photos.length > 0 ? (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {photos.map((uri) => (
              <Image key={uri} source={{ uri }} style={styles.hero} contentFit="cover" />
            ))}
          </ScrollView>
        ) : (
          <View style={[styles.hero, styles.heroFallback]}>
            <Text style={{ fontSize: 72 }}>{cat.emoji}</Text>
          </View>
        )}

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>
              {isWanted ? `Looking for ${listing.title}` : listing.title}
            </Text>
            <Badge
              label={isWanted ? 'Wanted' : cap(listing.status)}
              color={isWanted ? Colors.accent : isActive ? Colors.success : Colors.textTertiary}
            />
          </View>
          <Text style={styles.category}>
            {cat.emoji} {cat.label}
            {listing.quantity ? `  ·  ${listing.quantity}` : ''}
          </Text>

          <View style={styles.metaRow}>
            {listing.distance_miles != null && (
              <View style={styles.meta}>
                <MapPin size={14} color={Colors.textSecondary} />
                <Text style={styles.metaText}>{listing.distance_miles.toFixed(1)} mi away</Text>
              </View>
            )}
            <View style={styles.meta}>
              <Clock size={14} color={Colors.textSecondary} />
              <Text style={styles.metaText}>Expires {new Date(listing.expires_at).toLocaleDateString()}</Text>
            </View>
          </View>

          {listing.description ? <Text style={styles.description}>{listing.description}</Text> : null}

          <View style={styles.owner}>
            <Avatar uri={listing.owner?.avatar_url} name={listing.owner?.name} size={44} />
            <View>
              <Text style={styles.ownerName}>{listing.owner?.name ?? 'A neighbor'}</Text>
              <Text style={styles.ownerSub}>Sharing this surplus</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {isOwner ? (
          <Text style={styles.footerNote}>
            {isWanted
              ? "This is your Wanted post. We'll notify you when a neighbor offers a match."
              : 'This is your listing. Manage claims in the Activity tab.'}
          </Text>
        ) : isWanted ? (
          isActive ? (
            <Button label="I Have This" onPress={onIHaveThis} />
          ) : (
            <Text style={styles.footerNote}>This want is no longer active.</Text>
          )
        ) : existingClaim ? (
          <Button label={`Claim ${cap(existingClaim.status)}`} onPress={() => router.push('/activity')} variant="secondary" />
        ) : isActive ? (
          <Button label="Claim this" onPress={onClaim} loading={claim.isPending} />
        ) : (
          <Text style={styles.footerNote}>This listing is no longer available.</Text>
        )}
      </View>
    </View>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  hero: { width, height: width * 0.8, backgroundColor: Colors.backgroundSecondary },
  heroFallback: { alignItems: 'center', justifyContent: 'center' },
  body: { padding: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 24, fontWeight: '800', color: Colors.text, flex: 1 },
  category: { fontSize: 15, color: Colors.textSecondary, marginTop: 4 },
  metaRow: { flexDirection: 'row', gap: 18, marginTop: 14 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 13, color: Colors.textSecondary },
  description: { fontSize: 15, color: Colors.text, lineHeight: 22, marginTop: 18 },
  owner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 24,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  ownerName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  ownerSub: { fontSize: 13, color: Colors.textSecondary },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  footerNote: { textAlign: 'center', color: Colors.textSecondary, fontSize: 14, paddingVertical: 8 },
});
