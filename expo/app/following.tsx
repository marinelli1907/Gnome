import React, { useEffect } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Button, EmptyState, ErrorState } from '@/components/ui';
import { FeedSkeleton } from '@/components/Skeleton';
import ListingCard from '@/components/ListingCard';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import {
  logEvent, useFollowedDrops, useFollowedListings, useFollowedMarkets,
  useSetDropAlerts,
} from '@/lib/db';
import { ensurePushPermission } from '@/lib/notifications';

// A Market Drop's window in the device's local time (same shape as market/[id]).
const fmtDropWindow = (startsAt: string, endsAt: string) => {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const day = s.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const t = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${t(s)} – ${t(e)}`;
};

/**
 * Markets you follow — the buyer surface for the follow relationship.
 * Everything rendered comes from canonical public reads (active markets,
 * public listings, public_market_drops); following only curates.
 */
export default function FollowingScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const markets = useFollowedMarkets(userId ?? undefined);
  const marketIds = (markets.data ?? []).map((m) => m.id);
  const drops = useFollowedDrops(userId ?? undefined, marketIds);
  const listings = useFollowedListings(userId ?? undefined, marketIds);
  const setDropAlerts = useSetDropAlerts(userId ?? undefined);

  // §4/§5: the durable per-Market toggle. Turning ON asks for OS permission
  // first; a denial keeps the preference OFF with one gentle explanation.
  const onToggleAlerts = (marketId: string, next: boolean) => {
    if (!userId) return;
    void (async () => {
      if (next) {
        const perm = await ensurePushPermission(userId);
        if (perm !== 'granted') {
          Alert.alert('Drop alerts', 'Alerts need notification permission for Gnome in your phone settings.');
          return;
        }
      }
      setDropAlerts.mutate({ marketId, enabled: next }, {
        onError: () => Alert.alert('Drop alerts', 'That didn’t stick — try again.'),
      });
    })();
  };

  useEffect(() => {
    if (userId) void logEvent('following_screen_viewed', { userId });
  }, [userId]);

  if (!userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState
          emoji="🏡"
          title="Sign in to see your Markets"
          subtitle="Follow growers you like and their fresh listings gather here."
        />
        <Button label="Sign in" onPress={() => router.push('/sign-in')} style={{ marginTop: 14, paddingHorizontal: 28 }} />
      </View>
    );
  }
  if (markets.isLoading) {
    return (
      <View style={styles.screen}>
        <FeedSkeleton count={3} />
      </View>
    );
  }
  if (markets.error) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ErrorState
          title="Couldn’t load your Markets"
          message="Check your connection and try again."
          onRetry={() => markets.refetch()}
        />
      </View>
    );
  }

  const rows = markets.data ?? [];
  if (rows.length === 0) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState
          emoji="🏡"
          title="You’re not following anyone yet"
          subtitle="Find a Market you like and tap Follow — their new listings will show up here."
        />
        <Button label="Browse near you" onPress={() => router.push('/(tabs)')} style={{ marginTop: 14, paddingHorizontal: 28 }} />
      </View>
    );
  }

  const marketName = (id: string) => rows.find((m) => m.id === id)?.name ?? '';
  const openMarket = (id: string, from: 'market' | 'drop', dropId?: string) => {
    void logEvent(from === 'drop' ? 'followed_drop_opened' : 'followed_market_opened', {
      userId, metadata: from === 'drop' ? { drop: dropId } : { market: id },
    });
    router.push(`/market/${id}`);
  };

  const Header = (
    <View style={styles.header}>
      <Text style={styles.sectionTitle}>Your Markets</Text>
      {rows.map((m) => (
        <View key={m.id} style={styles.marketRow}>
          <Pressable style={styles.marketMain} onPress={() => openMarket(m.id, 'market')}>
            <Avatar uri={m.avatar_url} name={m.name} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.marketName}>{m.name}</Text>
              {m.tagline ? <Text style={styles.marketMeta} numberOfLines={1}>“{m.tagline}”</Text> : null}
              <Text style={styles.marketMeta}>
                {[m.city, m.state].filter(Boolean).join(', ') || 'Nearby'}
                {' · '}{m.active_count} fresh listing{m.active_count === 1 ? '' : 's'}
                {(drops.data ?? []).some((d) => d.market_id === m.id && d.phase === 'live') ? ' · 🧺 LIVE NOW' :
                  (drops.data ?? []).some((d) => d.market_id === m.id && d.phase === 'upcoming') ? ' · 🧺 Drop coming up' : ''}
              </Text>
            </View>
          </Pressable>
          <View style={styles.alertRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.alertLabel}>Drop alerts: {m.drop_alerts_enabled ? 'On' : 'Off'}</Text>
              <Text style={styles.alertHint}>Get a notification when this Market’s Drops go live.</Text>
            </View>
            <Switch
              value={m.drop_alerts_enabled}
              disabled={setDropAlerts.isPending}
              onValueChange={(next) => onToggleAlerts(m.id, next)}
              accessibilityLabel={`Drop alerts for ${m.name}`}
            />
          </View>
        </View>
      ))}

      {(drops.data ?? []).length > 0 && (
        <>
          <Text style={styles.sectionTitle}>🧺 Market Drops from them</Text>
          {(drops.data ?? []).map((d) => (
            <Pressable key={d.id} style={styles.dropCard} onPress={() => openMarket(d.market_id, 'drop', d.id)}>
              <Text style={styles.dropTitle}>
                🧺 {d.title}{'  '}
                <Text style={styles.dropBadge}>
                  {d.phase === 'live' ? 'LIVE NOW' : d.phase === 'ended' ? 'Just ended' : 'Coming up'}
                </Text>
              </Text>
              <Text style={styles.dropMeta}>
                {marketName(d.market_id)} · {fmtDropWindow(d.starts_at, d.ends_at)} · {d.available_items} item{d.available_items === 1 ? '' : 's'}
              </Text>
            </Pressable>
          ))}
        </>
      )}

      <Text style={styles.sectionTitle}>Recent from Markets you follow</Text>
      {listings.isLoading ? <FeedSkeleton count={2} /> : null}
      {!listings.isLoading && (listings.data ?? []).length === 0 ? (
        <Text style={styles.marketMeta}>Nothing active right now — check back after the weekend harvest.</Text>
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={listings.data ?? []}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={Header}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <ListingCard listing={item} />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: 20 },
  list: { paddingBottom: 32 },
  header: { padding: 16, gap: 10 },
  sectionTitle: { fontSize: 17, fontFamily: fonts.bold, color: Colors.text, marginTop: 10 },
  marketRow: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 12, gap: 10,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  marketMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  alertRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: 10,
  },
  alertLabel: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.text },
  alertHint: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 1 },
  marketName: { fontSize: 15, fontFamily: fonts.semibold, color: Colors.text },
  marketMeta: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 1 },
  dropCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 12, gap: 4,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  dropTitle: { fontFamily: fonts.semibold, fontSize: 14, color: Colors.text },
  dropBadge: { fontFamily: fonts.semibold, fontSize: 11, color: Colors.primary },
  dropMeta: { fontFamily: fonts.regular, fontSize: 13, color: Colors.textSecondary },
  cardWrap: { paddingHorizontal: 16 },
});
