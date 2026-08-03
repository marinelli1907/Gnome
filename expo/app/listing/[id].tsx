import React, { useEffect } from 'react';
import {
  Alert,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Clock } from 'lucide-react-native';
import { Avatar, Button, EmptyState } from '@/components/ui';
import TypeBadge from '@/components/TypeBadge';
import { Skeleton } from '@/components/Skeleton';
import Reputation from '@/components/Reputation';
import { ctaLabel, listingValueLabel } from '@/lib/listingType';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { categoryFor } from '@/constants/categories';
import type { ListingType } from '@/types';
import { useAuth } from '@/providers/AuthProvider';
import { useBlockUser, useClaimListing, useListing, useMyClaims, useMarketReputation, useReport, logEvent } from '@/lib/db';
import { listingShareUrl } from '@/lib/links';

const { width } = Dimensions.get('window');

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const { data: listing, isLoading } = useListing(id);
  const myClaims = useMyClaims(userId ?? undefined);
  const claim = useClaimListing(userId ?? undefined);
  const rep = useMarketReputation(listing?.market_id ?? undefined);
  const report = useReport(userId ?? undefined);
  const block = useBlockUser(userId ?? undefined);

  useEffect(() => {
    if (listing) {
      void logEvent('listing_viewed', {
        userId: userId ?? null,
        listingId: listing.id,
        metadata: { listing_type: listing.listing_type },
      });
    }
  }, [listing?.id, userId]);

  if (isLoading) {
    return (
      <View style={styles.screen}>
        <Skeleton style={{ width: '100%', height: width * 0.8 }} />
        <View style={{ padding: 20, gap: 12 }}>
          <Skeleton style={{ width: '70%', height: 26, borderRadius: 6 }} />
          <Skeleton style={{ width: '45%', height: 18, borderRadius: 6 }} />
          <Skeleton style={{ width: '90%', height: 14, borderRadius: 6, marginTop: 8 }} />
        </View>
      </View>
    );
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
  const type: ListingType = listing.listing_type ?? (listing.kind === 'wanted' ? 'wanted' : 'free');
  const isWanted = type === 'wanted';
  const value = listingValueLabel(listing);
  const existingClaim = (myClaims.data ?? []).find((c) => c.listing_id === listing.id);
  const isActive = listing.status === 'active';

  // Trade / Sale / Wanted go through the shared request sheet; Free claims inline.
  const openRequest = () => router.push(`/request/${listing.id}`);

  const onReportListing = () => {
    if (!userId) {
      router.push('/sign-in');
      return;
    }
    Alert.alert('Report this listing?', 'Flag this listing for review. This is stored privately.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: () =>
          report.mutate(
            { targetType: 'listing', targetId: listing.id, reason: '' },
            {
              onSuccess: () => Alert.alert('Thanks', 'This listing has been reported.'),
              onError: (e: any) => Alert.alert('Error', e?.message ?? 'Try again.'),
            },
          ),
      },
    ]);
  };

  const onShare = () => {
    const url = listingShareUrl(listing);
    void Share.share(
      Platform.OS === 'ios'
        ? { message: `${listing.title} on Gnome`, url }
        : { message: `${listing.title} on Gnome — ${url}` },
    );
  };

  const onBlockOwner = () => {
    if (!userId) {
      router.push('/sign-in');
      return;
    }
    const who = listing.owner?.name ?? 'this neighbor';
    Alert.alert(
      `Block ${who}?`,
      "You won't see their listings, and neither of you can send requests or messages to the other. You can unblock in Settings.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () =>
            block.mutate(listing.owner_id, {
              onSuccess: () => Alert.alert('Blocked', `You won't see listings from ${who} anymore.`),
              onError: (e: any) => Alert.alert('Error', e?.message ?? 'Try again.'),
            }),
        },
      ],
    );
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
        onError: (e: any) => {
          const msg = e?.message ?? '';
          if (/BLOCKED_USER/i.test(msg)) {
            Alert.alert('Not available', 'You can’t send requests to this neighbor.');
          } else {
            Alert.alert('Could not claim', msg || 'Try again.');
          }
        },
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
            <TypeBadge type={type} />
          </View>
          <Text style={[styles.value, type === 'sale' && { color: Colors.sell }]}>{value}</Text>
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

          <Pressable
            style={styles.owner}
            disabled={!listing.market_id}
            onPress={() => listing.market_id && router.push(`/market/${listing.market_id}`)}
          >
            <Avatar uri={listing.owner?.avatar_url} name={listing.owner?.name} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.ownerName}>{listing.owner?.name ?? 'A neighbor'}</Text>
              <Text style={styles.ownerSub}>
                {listing.market?.name ? `🏡 ${listing.market.name}` : 'Sharing this surplus'}
              </Text>
            </View>
            {listing.market_id ? <Text style={styles.visit}>Visit ›</Text> : null}
          </Pressable>

          {rep.data ? (
            <View style={{ marginTop: 10 }}>
              <Reputation rep={rep.data} compact />
            </View>
          ) : null}

          <View style={styles.actionsRow}>
            <Pressable onPress={onShare} hitSlop={6} style={styles.reportRow}>
              <Text style={styles.shareText}>Share</Text>
            </Pressable>
            {!isOwner ? (
              <>
                <Pressable onPress={onReportListing} hitSlop={6} style={styles.reportRow}>
                  <Text style={styles.reportText}>Report</Text>
                </Pressable>
                <Pressable onPress={onBlockOwner} hitSlop={6} style={styles.reportRow}>
                  <Text style={styles.reportText}>Block</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {isOwner ? (
          <Text style={styles.footerNote}>
            {isWanted
              ? "This is your Wanted post. We'll notify you when a neighbor offers a match."
              : 'This is your listing. Manage it in My Gnome.'}
          </Text>
        ) : !isActive ? (
          <Text style={styles.footerNote}>This listing is no longer available.</Text>
        ) : existingClaim ? (
          <Button label={`Request ${cap(existingClaim.status)}`} onPress={() => router.push('/activity')} variant="secondary" />
        ) : type === 'free' ? (
          <Button label="Claim this" onPress={onClaim} loading={claim.isPending} />
        ) : (
          // Trade -> Offer Trade, Sale -> Request to Buy, Wanted -> I Have This.
          <Button label={ctaLabel(type)} onPress={openRequest} />
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
  title: { fontSize: 24, fontFamily: fonts.bold, color: Colors.text, flex: 1 },
  value: { fontSize: 18, fontFamily: fonts.bold, color: Colors.text, marginTop: 6 },
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
  ownerName: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text },
  ownerSub: { fontSize: 13, color: Colors.textSecondary },
  visit: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  actionsRow: { flexDirection: 'row', gap: 22, alignItems: 'center' },
  reportRow: { marginTop: 18, alignSelf: 'flex-start', paddingVertical: 4 },
  reportText: { fontSize: 13, fontFamily: fonts.medium, color: Colors.textTertiary },
  shareText: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.primary },
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
