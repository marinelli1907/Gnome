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
import {
  consumePendingFollow, logEvent, setPendingFollow, useBlockUser, useIsFollowing,
  useMarket, useMarketListings, useMarketReputation, useReport, useSetDropAlerts,
  useToggleFollow,
} from '@/lib/db';
import { ensurePushPermission } from '@/lib/notifications';
import { distanceMiles, fmtDistance, getCoordsIfGranted, type Coords } from '@/lib/location';
import { usePickupSettings } from '@/lib/marketops';
import { useDeliverySettings } from '@/lib/delivery';
import { marketShareUrl } from '@/lib/links';
import { supabase } from '@/lib/supabase';

// A Market Drop's window in the device's local time.
const fmtDropWindow = (startsAt: string, endsAt: string) => {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const day = s.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const t = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  return `${day}, ${t(s)} – ${t(e)}`;
};

/**
 * A Market's distance: buyer's transient foreground fix vs the median of the
 * Market's own listings' APPROX coordinates — the same privacy basis as
 * everywhere else. Demo listings are excluded; no listings → no label.
 */
function marketDistance(
  coords: Coords | null,
  ls: { approx_lat?: number | null; approx_lng?: number | null; is_demo?: boolean | null }[],
): number | null {
  if (!coords) return null;
  const pts = ls.filter((l) => !l.is_demo && l.approx_lat != null && l.approx_lng != null);
  if (!pts.length) return null;
  const mid = (arr: number[]) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  return distanceMiles(coords, {
    lat: mid(pts.map((l) => l.approx_lat as number)),
    lng: mid(pts.map((l) => l.approx_lng as number)),
  });
}

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
  // Market Drops (NOT the Seed Drop): upcoming/live/just-ended, from the public view.
  const [drops, setDrops] = React.useState<{
    id: string; title: string; description: string | null;
    starts_at: string; ends_at: string; phase: string; available_items: number;
  }[]>([]);
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.from('public_market_drops')
        .select('id,title,description,starts_at,ends_at,phase,available_items')
        .eq('market_id', id).order('starts_at', { ascending: true }).limit(12);
      // Live first, then upcoming, then just-ended — a run of recently-ended
      // Drops never crowds a live one off the screen.
      const rank = (phase: string) => (phase === 'live' ? 0 : phase === 'upcoming' ? 1 : 2);
      const rows = ((data ?? []) as typeof drops).sort(
        (a, b) => rank(a.phase) - rank(b.phase) || Date.parse(a.starts_at) - Date.parse(b.starts_at),
      );
      if (alive) setDrops(rows);
    })();
    return () => { alive = false; };
  }, [id]);
  const report = useReport(userId ?? undefined);
  const block = useBlockUser(userId ?? undefined);
  const pickupSettings = usePickupSettings(id);
  const deliverySettings = useDeliverySettings(id);

  // Follow / Unfollow (0005 market_follows, self-scoped RLS). A signed-out tap
  // remembers this market, opens sign-in, and completes on return — but the
  // mutation re-resolves the market through canonical visibility first, so a
  // stale intent can never follow a market that went non-public in between.
  const isFollowing = useIsFollowing(id, userId ?? undefined);
  const toggleFollow = useToggleFollow(userId ?? undefined);
  const setDropAlerts = useSetDropAlerts(userId ?? undefined);

  // §3: after a successful follow, a lightweight non-blocking offer. Explicit
  // consent — the OS permission sheet appears only if they say yes, and a
  // denial keeps Following intact with alerts OFF.
  const offerDropAlerts = (marketId: string) => {
    if (!userId) return;
    Alert.alert(
      'Followed 🌱',
      'Want an alert when this Market has a Drop go live?',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Turn on Drop alerts',
          onPress: () => {
            void (async () => {
              const perm = await ensurePushPermission(userId);
              if (perm !== 'granted') {
                Alert.alert('Drop alerts', 'Alerts need notification permission. You can turn them on any time from Markets you follow.');
                return;
              }
              setDropAlerts.mutate({ marketId, enabled: true }, {
                onError: () => Alert.alert('Drop alerts', 'That didn’t stick — try again from Markets you follow.'),
              });
            })();
          },
        },
      ],
    );
  };

  useEffect(() => {
    if (!userId || !id) return;
    if (!consumePendingFollow(id)) return;
    toggleFollow.mutate({ marketId: id, follow: true }, {
      onSuccess: () => offerDropAlerts(id),
      onError: (e: unknown) => {
        const msg = e instanceof Error && e.message === 'MARKET_UNAVAILABLE'
          ? 'This Market isn’t available right now.'
          : 'Couldn’t follow just now — try the button again.';
        Alert.alert('Follow', msg);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, id]);
  const onToggleFollow = () => {
    if (!userId) {
      if (id) setPendingFollow(id);
      router.push('/sign-in');
      return;
    }
    const willFollow = !isFollowing.data;
    toggleFollow.mutate({ marketId: id, follow: willFollow }, {
      onSuccess: () => { if (willFollow) offerDropAlerts(id); },
      onError: (e: unknown) => {
        const msg = e instanceof Error && e.message === 'MARKET_UNAVAILABLE'
          ? 'This Market isn’t available right now.'
          : 'That didn’t stick — try again.';
        Alert.alert('Follow', msg);
      },
    });
  };

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
  const canOrderPickup =
    !!userId && !isOwner && hasSaleItems &&
    (!!pickupSettings.data || !!deliverySettings.data?.enabled);

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

  const mktMiles = marketDistance(myCoords, listings.data ?? []);

  const Header = (
    <View style={styles.header}>
      <Avatar uri={m.avatar_url} name={m.name} size={72} />
      <Text style={styles.name}>{m.name}</Text>
      {mktMiles != null ? (
        <Text style={styles.distanceLabel}>
          📍 {fmtDistance(mktMiles) === 'Nearby' ? 'Nearby' : `${fmtDistance(mktMiles)} away`}
        </Text>
      ) : null}
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
      {!isOwner && (
        <Button
          label={isFollowing.data ? '✓ Following' : '+ Follow this Market'}
          variant={isFollowing.data ? 'secondary' : 'primary'}
          loading={toggleFollow.isPending || (!!userId && isFollowing.isLoading)}
          onPress={onToggleFollow}
          style={{ marginTop: 12, alignSelf: 'center', paddingHorizontal: 28 }}
        />
      )}
      {canOrderPickup && (
        <Button
          label={deliverySettings.data?.enabled ? "🧺 Order — pickup or delivery" : "🧺 Order for pickup"}
          onPress={() => router.push(`/market/order/${m.id}`)}
          style={{ marginTop: 12, alignSelf: 'center', paddingHorizontal: 28 }}
        />
      )}
      {drops.map((d) => (
        <View key={d.id} style={styles.dropCard}>
          <Text style={styles.dropTitle}>
            🧺 {d.title}{'  '}
            <Text style={styles.dropBadge}>
              {d.phase === 'live' ? 'LIVE NOW' : d.phase === 'ended' ? 'Just ended' : 'Coming up'}
            </Text>
          </Text>
          <Text style={styles.dropMeta}>
            {fmtDropWindow(d.starts_at, d.ends_at)} · {(d.phase === 'live' || d.phase === 'upcoming') && d.available_items === 0
              ? 'Sold out'
              : `${d.available_items} item${d.available_items === 1 ? '' : 's'}`}
          </Text>
          {d.description ? <Text style={styles.dropMeta}>{d.description}</Text> : null}
        </View>
      ))}
      <Text style={styles.countLine}>
        {items.length} active listing{items.length === 1 ? '' : 's'}
      </Text>
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
  dropCard: {
    marginTop: 12, alignSelf: 'stretch', backgroundColor: Colors.surface,
    borderRadius: 14, padding: 12, gap: 4, borderWidth: 1, borderColor: Colors.borderLight,
  },
  dropTitle: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.text },
  dropBadge: { fontFamily: fonts.semibold, fontSize: 11, color: Colors.marketOrangeInteractive },
  dropMeta: { fontFamily: fonts.regular, fontSize: 13, color: Colors.textSecondary },
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: 32 },
  header: { alignItems: 'center', padding: 20, gap: 6 },
  name: { fontSize: 25, fontFamily: fonts.displayBold, color: Colors.text, textAlign: 'center' },
  desc: { fontSize: 15, fontFamily: fonts.regular, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21, marginTop: 2 },
  // Brand red #E53935 is 4.23:1 on white and this is 14px body text; the
  // interactive cut #E32C27 measures 4.51:1.
  tagline: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.marketOrangeInteractive, textAlign: 'center', fontStyle: 'italic', marginTop: 2 },
  distanceLabel: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary, textAlign: 'center', marginTop: 2 },
  countLine: { fontSize: 13, color: Colors.textTertiary, marginTop: 14, fontFamily: fonts.semibold },
  repWrap: { alignSelf: 'stretch', marginTop: 16 },
  actionsRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  reportBtn: { marginTop: 16, padding: 8 },
  reportText: { fontSize: 13, fontFamily: fonts.medium, color: Colors.textTertiary },
  shareText: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.marketOrangeInteractive },
  cardWrap: { paddingHorizontal: 16 },
});
