import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Modal, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, Users } from 'lucide-react-native';
import { Avatar, Button, EmptyState, ErrorState, Field } from '@/components/ui';
import SlotPicker from '@/components/orders/SlotPicker';
import { FeedSkeleton } from '@/components/Skeleton';
import ListingCard from '@/components/ListingCard';
import Reputation from '@/components/Reputation';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import {
  consumePendingFollow, logEvent, setPendingFollow, useBlockUser, useIsFollowing,
  useMarket, useMarketListings, useMarketReputation, useMarketStorefrontStats,
  useReport, useSetDropAlerts,
  useToggleFollow,
} from '@/lib/db';
import { ensurePushPermission } from '@/lib/notifications';
import { distanceMiles, fmtDistance, getCoordsIfGranted, type Coords } from '@/lib/location';
import {
  fmtWindow, useCreateVisitRequest, usePickupHours, usePickupSettings, usePickupSlots,
  type PickupSlot,
} from '@/lib/marketops';
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

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const THEME_COLORS: Record<string, string> = {
  garden: Colors.gardenGreen,
  harvest: Colors.marketOrange,
  herb: Colors.gardenGreenInteractive,
  farm_stand: Colors.gnomeRed,
  minimal: Colors.backgroundSecondary,
};

function fmtMinute(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour >= 12 ? 'PM' : 'AM';
  const clockHour = hour % 12 || 12;
  return `${clockHour}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${period}`;
}

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
  const [featuredUntil, setFeaturedUntil] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const [{ data }, boost] = await Promise.all([
        supabase.from('public_market_drops').select('id,title,description,starts_at,ends_at,phase,available_items')
          .eq('market_id', id).order('starts_at', { ascending: true }).limit(12),
        supabase.from('public_active_market_boosts').select('featured_until').eq('market_id', id).maybeSingle(),
      ]);
      // Live first, then upcoming, then just-ended — a run of recently-ended
      // Drops never crowds a live one off the screen.
      const rank = (phase: string) => (phase === 'live' ? 0 : phase === 'upcoming' ? 1 : 2);
      const rows = ((data ?? []) as typeof drops).sort(
        (a, b) => rank(a.phase) - rank(b.phase) || Date.parse(a.starts_at) - Date.parse(b.starts_at),
      );
      if (alive) setDrops(rows);
      if (alive) setFeaturedUntil(boost.data?.featured_until ?? null);
    })();
    return () => { alive = false; };
  }, [id]);
  const report = useReport(userId ?? undefined);
  const block = useBlockUser(userId ?? undefined);
  const storefront = useMarketStorefrontStats(id);
  const pickupSettings = usePickupSettings(id);
  const pickupHours = usePickupHours(id);
  const pickupSlots = usePickupSlots(id, 14);
  const deliverySettings = useDeliverySettings(id);
  const createVisit = useCreateVisitRequest(userId ?? undefined);
  const [visitOpen, setVisitOpen] = useState(false);
  const [visitSlot, setVisitSlot] = useState<PickupSlot | null>(null);
  const [visitNote, setVisitNote] = useState('');

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

  const viewedMarketId = market.data?.id;
  useEffect(() => {
    if (viewedMarketId) {
      void logEvent('market_viewed', { userId: userId ?? null, metadata: { market_id: viewedMarketId } });
    }
  }, [viewedMarketId, userId]);

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

  const openVisit = () => {
    if (!userId) {
      router.push('/sign-in');
      return;
    }
    setVisitOpen(true);
  };

  const submitVisit = async () => {
    if (!visitSlot) {
      Alert.alert('Choose a time', 'Pick one of the Market’s available times.');
      return;
    }
    try {
      const orderId = await createVisit.mutateAsync({ marketId: id, slot: visitSlot, note: visitNote });
      setVisitOpen(false);
      setVisitSlot(null);
      setVisitNote('');
      Alert.alert('Visit requested', `${m.name} can confirm this time or suggest another one.`, [
        { text: 'View request', onPress: () => router.push(`/order/${orderId}`) },
      ]);
    } catch (e: any) {
      const message = String(e?.message ?? '');
      Alert.alert(
        'Couldn’t request this visit',
        message.includes('SLOT_UNAVAILABLE')
          ? 'That time was just taken. Refresh the available times and choose another.'
          : message.includes('SUBSCRIPTION_REQUIRED')
            ? 'Visit scheduling is not available for this Market right now.'
            : 'Check your connection and try again.',
      );
    }
  };

  const mktMiles = marketDistance(myCoords, listings.data ?? []);
  const hoursByDay = new Map<number, typeof pickupHours.data>();
  for (let day = 0; day < 7; day++) hoursByDay.set(day, []);
  for (const window of pickupHours.data ?? []) {
    const dayWindows = hoursByDay.get(window.weekday) ?? [];
    dayWindows.push(window);
    hoursByDay.set(window.weekday, dayWindows);
  }
  const schedulingEnabled = storefront.data?.scheduling_enabled === true;

  const Header = (
    <View style={styles.header}>
      <View style={[styles.cover, { backgroundColor: THEME_COLORS[m.theme ?? 'garden'] ?? Colors.gardenGreen }]}>
        {m.banner_url ? <Image source={{ uri: m.banner_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      </View>
      <View style={styles.identity}>
        <View style={styles.avatarFrame}><Avatar uri={m.avatar_url} name={m.name} size={84} /></View>
        <Text style={styles.name}>{m.name}</Text>
      {featuredUntil ? <View style={styles.featuredBadge}><Text style={styles.featuredText}>Featured Market</Text></View> : null}
      {mktMiles != null ? (
        <Text style={styles.distanceLabel}>
          📍 {fmtDistance(mktMiles) === 'Nearby' ? 'Nearby' : `${fmtDistance(mktMiles)} away`}
        </Text>
      ) : null}
      {m.tagline ? <Text style={styles.tagline}>“{m.tagline}”</Text> : null}
      {m.description ? <Text style={styles.desc}>{m.description}</Text> : null}
      {storefront.data ? (
        <View style={styles.followerLine}>
          <Users size={15} color={Colors.textSecondary} />
          <Text style={styles.followerText}>
            {storefront.data.follower_count} {storefront.data.follower_count === 1 ? 'follower' : 'followers'}
          </Text>
        </View>
      ) : null}
      {isOwner && (
        <Button
          label="Customize Market"
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
      {schedulingEnabled && !isOwner ? (
        <Button
          label="Request a visit"
          variant="secondary"
          onPress={openVisit}
          style={{ marginTop: 10, alignSelf: 'center', paddingHorizontal: 28 }}
        />
      ) : null}
      </View>
      {schedulingEnabled ? (
        <View style={styles.hoursSection}>
          <View style={styles.hoursTitleRow}>
            <CalendarDays size={19} color={Colors.marketOrangeInteractive} />
            <Text style={styles.hoursTitle}>Stand hours</Text>
          </View>
          {WEEKDAYS.map((day, dayIndex) => {
            const windows = hoursByDay.get(dayIndex) ?? [];
            return (
              <View key={day} style={styles.hoursRow}>
                <Text style={styles.hoursDay}>{day.slice(0, 3)}</Text>
                <Text style={styles.hoursTime}>
                  {windows.length
                    ? windows.map((window) => `${fmtMinute(window.start_minute)}–${fmtMinute(window.end_minute)}`).join(', ')
                    : 'Closed'}
                </Text>
              </View>
            );
          })}
          {(pickupSlots.data ?? []).length > 0 ? (
            <View style={styles.nextOpening}>
              <Text style={styles.nextOpeningLabel}>Next available</Text>
              <Text style={styles.nextOpeningValue}>
                {fmtWindow(pickupSlots.data![0].slot_start, pickupSlots.data![0].slot_end)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.identity}>
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
      <Modal
        visible={visitOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setVisitOpen(false)}
      >
        <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
          <View style={styles.visitHeader}>
            <View>
              <Text style={styles.visitTitle}>Visit {m.name}</Text>
              <Text style={styles.visitSubtitle}>Choose a time for the seller to confirm.</Text>
            </View>
            <Pressable
              onPress={() => setVisitOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close visit request"
              style={styles.closeButton}
            >
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <FlatList
            data={[]}
            renderItem={() => null}
            contentContainerStyle={styles.visitBody}
            ListHeaderComponent={
              <>
                <SlotPicker
                  slots={pickupSlots.data ?? []}
                  loading={pickupSlots.isLoading}
                  isError={pickupSlots.isError}
                  onRetry={() => pickupSlots.refetch()}
                  selected={visitSlot}
                  onSelect={setVisitSlot}
                />
                <Field
                  label="Note (optional)"
                  value={visitNote}
                  onChangeText={setVisitNote}
                  placeholder="We’d love to stop by and see what’s available."
                  multiline
                  maxLength={500}
                  style={styles.visitNote}
                />
                <Button
                  label="Send visit request"
                  onPress={() => void submitVisit()}
                  loading={createVisit.isPending}
                  disabled={!visitSlot}
                />
              </>
            }
          />
        </View>
      </Modal>
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
  header: { alignItems: 'stretch' },
  cover: { width: '100%', height: 176, overflow: 'hidden' },
  identity: { alignItems: 'center', paddingHorizontal: 20, gap: 6 },
  avatarFrame: {
    width: 92, height: 92, borderRadius: 46, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center', marginTop: -46,
    borderWidth: 4, borderColor: Colors.surface,
  },
  name: { fontSize: 25, fontFamily: fonts.displayBold, color: Colors.text, textAlign: 'center' },
  featuredBadge: { borderRadius: 6, backgroundColor: Colors.accent, paddingHorizontal: 9, paddingVertical: 4 },
  featuredText: { fontSize: 12, fontFamily: fonts.bold, color: Colors.text },
  desc: { fontSize: 15, fontFamily: fonts.regular, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21, marginTop: 2 },
  // Brand red #E53935 is 4.23:1 on white and this is 14px body text; the
  // interactive cut #E32C27 measures 4.51:1.
  tagline: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.marketOrangeInteractive, textAlign: 'center', fontStyle: 'italic', marginTop: 2 },
  distanceLabel: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary, textAlign: 'center', marginTop: 2 },
  followerLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  followerText: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary },
  hoursSection: {
    marginTop: 20, paddingHorizontal: 20, paddingVertical: 18,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.backgroundSecondary,
  },
  hoursTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  hoursTitle: { fontSize: 17, fontFamily: fonts.bold, color: Colors.text },
  hoursRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 3 },
  hoursDay: { width: 42, fontSize: 13, fontFamily: fonts.bold, color: Colors.textSecondary },
  hoursTime: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: Colors.text },
  nextOpening: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  nextOpeningLabel: { fontSize: 11.5, fontFamily: fonts.bold, color: Colors.marketOrangeInteractive, textTransform: 'uppercase' },
  nextOpeningValue: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.text, marginTop: 2 },
  countLine: { fontSize: 13, color: Colors.textTertiary, marginTop: 14, fontFamily: fonts.semibold },
  repWrap: { alignSelf: 'stretch', marginTop: 16 },
  actionsRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  reportBtn: { marginTop: 16, padding: 8 },
  reportText: { fontSize: 13, fontFamily: fonts.medium, color: Colors.textTertiary },
  shareText: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.marketOrangeInteractive },
  cardWrap: { paddingHorizontal: 16 },
  visitHeader: {
    minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  visitTitle: { fontSize: 20, fontFamily: fonts.displayBold, color: Colors.text },
  visitSubtitle: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  closeButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 14, fontFamily: fonts.bold, color: Colors.primary },
  visitBody: { padding: 18, paddingBottom: 40 },
  visitNote: { minHeight: 82, textAlignVertical: 'top' },
});
