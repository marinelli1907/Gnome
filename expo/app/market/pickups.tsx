// Seller pickups board — TODAY / UPCOMING / ALL. Today is the working view:
// confirmed and ready orders in chronological pickup order. Upcoming surfaces
// pending requests with a "Needs response" flag.
import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';
import { Badge, Button, EmptyState, ErrorState } from '@/components/ui';
import { orderWindow, OrderStatusBadge, STATUS_META } from '@/components/orders/OrderStatus';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyMarket } from '@/lib/db';
import { money, useMarketOrders, type MarketOrder } from '@/lib/marketops';

type Tab = 'today' | 'upcoming' | 'all';
const OPEN = ['REQUESTED', 'TIME_PROPOSED', 'CONFIRMED', 'READY', 'OUT_FOR_DELIVERY'];

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function rowLine(o: MarketOrder): string {
  const win = orderWindow(o);
  const count = (o.items ?? []).reduce((s, it) => s + it.quantity, 0);
  return `${fmtTime(win.start)}–${fmtTime(win.end)} · ${o.buyer?.name ?? 'Neighbor'} · ${count} item${count === 1 ? '' : 's'} · ${money(o.subtotal_cents)}`;
}

function PickupRow({ o, onPress }: { o: MarketOrder; onPress: () => void }) {
  const win = orderWindow(o);
  const needsResponse = o.status === 'REQUESTED';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Pickup order, ${rowLine(o)}, ${STATUS_META[o.status].label}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{rowLine(o)}</Text>
        <Text style={styles.rowSub}>
          {new Date(win.start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
        </Text>
        <View style={styles.rowBadges}>
          <OrderStatusBadge status={o.status} />
          {o.fulfillment_type === 'delivery' ? (
            <Badge
              label={o.delivery_distance_miles != null ? `Delivery · ${o.delivery_distance_miles} mi` : 'Delivery'}
              color={Colors.info}
            />
          ) : null}
          {needsResponse ? <Badge label="Needs response" color={Colors.accent} /> : null}
        </View>
      </View>
      <ChevronRight size={18} color={Colors.textSecondary} />
    </Pressable>
  );
}

export default function SellerPickupsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const market = useMyMarket(userId ?? undefined);
  const marketId = market.data?.id;
  const orders = useMarketOrders(marketId);
  const [tab, setTab] = useState<Tab>('today');

  const { today, upcoming, all, pendingCount } = useMemo(() => {
    const list = orders.data ?? [];
    const now = Date.now();
    const todayKey = new Date().toDateString();

    const todayList = list
      .filter((o) => {
        if (o.status !== 'CONFIRMED' && o.status !== 'READY' && o.status !== 'OUT_FOR_DELIVERY') return false;
        return new Date(orderWindow(o).start).toDateString() === todayKey;
      })
      .sort(
        (a, b) =>
          new Date(orderWindow(a).start).getTime() - new Date(orderWindow(b).start).getTime(),
      );

    const upcomingList = list
      .filter((o) => {
        if (!OPEN.includes(o.status)) return false;
        if (o.status === 'REQUESTED' || o.status === 'TIME_PROPOSED') return true;
        return new Date(orderWindow(o).start).getTime() > now;
      })
      .sort(
        (a, b) =>
          new Date(orderWindow(a).start).getTime() - new Date(orderWindow(b).start).getTime(),
      );

    const allList = [...list].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return {
      today: todayList,
      upcoming: upcomingList,
      all: allList,
      pendingCount: list.filter((o) => o.status === 'REQUESTED').length,
    };
  }, [orders.data]);

  if (!userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🧺" title="Sign in" subtitle="Pickups are tied to your Market.">
          <Button label="Sign in" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }
  if (market.data === null) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🏡" title="No Market yet" subtitle="Post a listing to create your Market, then pickups appear here." />
      </View>
    );
  }
  if (orders.isError) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ErrorState message="Couldn’t load your pickups." onRetry={() => orders.refetch()} />
      </View>
    );
  }

  const active = tab === 'today' ? today : tab === 'upcoming' ? upcoming : all;
  const emptyCopy: Record<Tab, string> = {
    today: 'No confirmed pickups today.',
    upcoming: 'No upcoming or pending orders.',
    all: 'No pickup orders yet — buyers order from your Market page.',
  };

  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        {(
          [
            ['today', 'Today'],
            ['upcoming', 'Upcoming'],
            ['all', 'All'],
          ] as [Tab, string][]
        ).map(([key, label]) => {
          const activeTab = tab === key;
          const showCount = key === 'upcoming' && pendingCount > 0;
          return (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: activeTab }}
              accessibilityLabel={`${label} pickups${showCount ? `, ${pendingCount} needing a response` : ''}`}
              style={[styles.tab, activeTab && styles.tabActive]}
            >
              <Text style={[styles.tabText, activeTab && styles.tabTextActive]}>{label}</Text>
              {showCount ? (
                <View style={styles.countBubble}>
                  <Text style={styles.countText}>{pendingCount}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl refreshing={orders.isRefetching} onRefresh={() => orders.refetch()} tintColor={Colors.primary} />
        }
      >
        {active.length === 0 && !orders.isLoading ? (
          <EmptyState emoji="🧺" title="Nothing here" subtitle={emptyCopy[tab]} />
        ) : (
          active.map((o) => (
            <PickupRow key={o.id} o={o} onPress={() => router.push(`/order/${o.id}`)} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { fontSize: 13.5, fontFamily: fonts.semibold, color: Colors.textSecondary },
  tabTextActive: { color: Colors.textInverse },
  countBubble: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  countText: { fontSize: 11, fontFamily: fonts.bold, color: Colors.textInverse },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
  },
  rowTitle: { fontSize: 14.5, fontFamily: fonts.bold, color: Colors.text },
  rowSub: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  rowBadges: { flexDirection: 'row', gap: 6, marginTop: 6 },
});
