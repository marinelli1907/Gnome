import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, EmptyState, ErrorState } from '@/components/ui';
import { FeedSkeleton } from '@/components/Skeleton';
import ListingCard from '@/components/ListingCard';
import Reputation from '@/components/Reputation';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useBlockUser, useMarket, useMarketListings, useMarketReputation, useReport, logEvent } from '@/lib/db';
import { fmtDistance, getCoordsIfGranted, type Coords } from '@/lib/location';
import { usePublicPickupLocationsForMarket } from '@/lib/marketops';
import PickupOptions, { nearestPickupMiles } from '@/components/pickup-buyer/PickupOptions';
import { marketShareUrl } from '@/lib/links';

/**
 * A Market's distance is now anchored to where you'd actually GO — its
 * approximate pickup points — rather than the median of its listings. With
 * several spots the nearest one is the honest headline; with one it's just the
 * approximate distance. No pickup locations → no distance claim.
 */

export default function MarketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const market = useMarket(id);
  const listings = useMarketListings(id);
  const [myCoords, setMyCoords] = useState<Coords | null>(null);
  useEffect(() => {
    void getCoordsIfGranted().then(setMyCoords);
  }, []);
  const rep = useMarketReputation(id);
  const report = useReport(userId ?? undefined);
  const block = useBlockUser(userId ?? undefined);
  const pickupLocs = usePublicPickupLocationsForMarket(id);

  useEffect(() => {
    if (market.data) {
      void logEvent('market_viewed', { userId: userId ?? null, metadata: { market_id: market.data.id } });
    }
  }, [market.data?.id, userId]);

  if (market.isLoading) {
    return (
      <View style={styles.screen}>
        <FeedSkeleton count={3} />
      </View>
    );
  }
  if (market.error) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ErrorState
          title="Couldn’t load this Market"
          message="Check your connection and try again."
          onRetry={() => market.refetch()}
        />
      </View>
    );
  }
  if (!market.data) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🏡" title="Market not found" subtitle="This Market may no longer be active." />
      </View>
    );
  }

  const m = market.data;
  const isOwner = userId === m.owner_id;
  const items = listings.data ?? [];
  const hasSaleItems = items.some((l) => l.listing_type === 'sale' && l.price_cents != null);
  // An order now has to land on a specific pickup location, so at least one
  // active location — not a legacy settings row — is what makes ordering real.
  const canOrderPickup =
    !!userId && !isOwner && (pickupLocs.data ?? []).length > 0 && hasSaleItems;

  const shareUrl = marketShareUrl(m);
  const onShare = () => {
    if (!shareUrl) return;
    void Share.share(
      Platform.OS === 'ios'
        ? { message: `${m.name} on Gnome`, url: shareUrl }
        : { message: `${m.name} on Gnome — ${shareUrl}` },
    );
  };

  const onBlockOwner = () => {
    if (!userId) {
      router.push('/sign-in');
      return;
    }
    Alert.alert(
      `Block ${m.name}?`,
      "You won't see their listings, and neither of you can send requests or messages to the other. You can unblock in Settings.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () =>
            block.mutate(m.owner_id, {
              onSuccess: () => {
                // Leave the blocked Market so its listings aren't still on screen.
                if (router.canGoBack()) router.back();
                Alert.alert('Blocked', `You won't see listings from ${m.name} anymore.`);
              },
              onError: (e: any) => Alert.alert('Error', e?.message ?? 'Try again.'),
            }),
        },
      ],
    );
  };

  const onReport = () => {
    if (!userId) {
      router.push('/sign-in');
      return;
    }
    Alert.alert('Report this Market?', 'Flag this Market for review. This is stored privately.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: () =>
          report.mutate(
            { targetType: 'market', targetId: m.id, reason: '' },
            {
              onSuccess: () => Alert.alert('Thanks', 'This Market has been reported.'),
              onError: (e: any) => Alert.alert('Error', e?.message ?? 'Try again.'),
            },
          ),
      },
    ]);
  };

  const locations = pickupLocs.data ?? [];
  const nearestMiles = nearestPickupMiles(myCoords, locations);
  const distanceLine =
    nearestMiles == null
      ? null
      : fmtDistance(nearestMiles) === 'Nearby'
        ? locations.length > 1
          ? 'Nearest pickup · Nearby'
          : 'Nearby'
        : locations.length > 1
          ? `Nearest pickup · ${fmtDistance(nearestMiles)} away`
          : `${fmtDistance(nearestMiles)} away`;

  const Header = (
    <View style={styles.header}>
      <Avatar uri={m.avatar_url} name={m.name} size={72} />
      <Text style={styles.name}>{m.name}</Text>
      {distanceLine ? <Text style={styles.distanceLabel}>📍 {distanceLine}</Text> : null}
      {m.tagline ? <Text style={styles.tagline}>“{m.tagline}”</Text> : null}
      {m.description ? <Text style={styles.desc}>{m.description}</Text> : null}
      {isOwner && (
        <Button
          label="Name your Market"
          variant="secondary"
          onPress={() => router.push(`/market/edit/${m.id}`)}
          style={{ marginTop: 12, alignSelf: 'center', paddingHorizontal: 28 }}
        />
      )}
      {canOrderPickup && (
        <Button
          label="🧺 Order for pickup"
          onPress={() => router.push(`/market/order/${m.id}`)}
          style={{ marginTop: 12, alignSelf: 'center', paddingHorizontal: 28 }}
        />
      )}
      <Text style={styles.countLine}>
        {items.length} active listing{items.length === 1 ? '' : 's'}
      </Text>
      <PickupOptions locations={locations} coords={myCoords} />
      {rep.data ? (
        <View style={styles.repWrap}>
          <Reputation rep={rep.data} />
        </View>
      ) : null}
      <View style={styles.actionsRow}>
        {shareUrl ? (
          <Pressable onPress={onShare} hitSlop={8} style={styles.reportBtn}>
            <Text style={styles.shareText}>Share</Text>
          </Pressable>
        ) : null}
        {!isOwner && (
          <>
            <Pressable onPress={onReport} hitSlop={8} style={styles.reportBtn}>
              <Text style={styles.reportText}>Report</Text>
            </Pressable>
            <Pressable onPress={onBlockOwner} hitSlop={8} style={styles.reportBtn}>
              <Text style={styles.reportText}>Block</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top ? 0 : 0 }]}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={Header}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <ListingCard listing={item} />
          </View>
        )}
        ListEmptyComponent={
          listings.isLoading ? null : (
            <EmptyState
              emoji="🌱"
              title="Nothing growing here yet"
              subtitle={isOwner ? 'Share something from the Post tab to fill your Market.' : 'Check back soon.'}
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: 32 },
  header: { alignItems: 'center', padding: 20, gap: 6 },
  name: { fontSize: 25, fontFamily: fonts.displayBold, color: Colors.text, textAlign: 'center' },
  desc: { fontSize: 15, fontFamily: fonts.regular, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21, marginTop: 2 },
  tagline: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.primaryLight, textAlign: 'center', fontStyle: 'italic', marginTop: 2 },
  distanceLabel: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary, textAlign: 'center', marginTop: 2 },
  countLine: { fontSize: 13, color: Colors.textTertiary, marginTop: 14, fontFamily: fonts.semibold },
  repWrap: { alignSelf: 'stretch', marginTop: 16 },
  actionsRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  reportBtn: { marginTop: 16, padding: 8 },
  reportText: { fontSize: 13, fontFamily: fonts.medium, color: Colors.textTertiary },
  shareText: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.primary },
  cardWrap: { paddingHorizontal: 16 },
});
