// My pickups & orders — the buyer's list. Upcoming (sorted by pickup window)
// then Past. Each card links to the order detail screen.
import React, { useMemo } from 'react';
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
import { Button, EmptyState, ErrorState } from '@/components/ui';
import { OrderStatusBadge, orderWindow } from '@/components/orders/OrderStatus';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { fmtWindow, money, useMyOrders, type MarketOrder } from '@/lib/marketops';

const UPCOMING = ['REQUESTED', 'TIME_PROPOSED', 'CONFIRMED', 'READY'];

function OrderCard({ o, onPress }: { o: MarketOrder; onPress: () => void }) {
  const win = orderWindow(o);
  const count = (o.items ?? []).reduce((s, it) => s + it.quantity, 0);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Order from ${o.market?.name ?? 'a market'}, ${money(o.subtotal_cents)}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {o.market?.name ?? 'Market'}
        </Text>
        <Text style={styles.cardSub}>{fmtWindow(win.start, win.end)}</Text>
        <Text style={styles.cardSub}>
          {count} item{count === 1 ? '' : 's'} · {money(o.subtotal_cents)}
        </Text>
        <View style={{ marginTop: 6 }}>
          <OrderStatusBadge status={o.status} />
        </View>
      </View>
      <ChevronRight size={18} color={Colors.textSecondary} />
    </Pressable>
  );
}

export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const orders = useMyOrders(userId ?? undefined);

  const { upcoming, past } = useMemo(() => {
    const all = orders.data ?? [];
    const up = all
      .filter((o) => UPCOMING.includes(o.status))
      .sort(
        (a, b) =>
          new Date(orderWindow(a).start).getTime() - new Date(orderWindow(b).start).getTime(),
      );
    const done = all
      .filter((o) => !UPCOMING.includes(o.status))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return { upcoming: up, past: done };
  }, [orders.data]);

  if (!userId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🧺" title="Sign in" subtitle="Your pickup orders are tied to your account.">
          <Button label="Sign in" onPress={() => router.push('/sign-in')} style={{ marginTop: 12 }} />
        </EmptyState>
      </View>
    );
  }
  if (orders.isError) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ErrorState message="Couldn’t load your orders." onRetry={() => orders.refetch()} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
      refreshControl={
        <RefreshControl refreshing={orders.isRefetching} onRefresh={() => orders.refetch()} tintColor={Colors.primary} />
      }
    >
      {upcoming.length === 0 && past.length === 0 && !orders.isLoading ? (
        <EmptyState
          emoji="🧺"
          title="No pickup orders yet"
          subtitle="When you order from a neighbor's market, it shows up here."
        />
      ) : (
        <>
          {upcoming.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Upcoming</Text>
              {upcoming.map((o) => (
                <OrderCard key={o.id} o={o} onPress={() => router.push(`/order/${o.id}`)} />
              ))}
            </>
          ) : null}
          {past.length > 0 ? (
            <>
              <Text style={[styles.sectionTitle, upcoming.length > 0 && { marginTop: 22 }]}>
                Past
              </Text>
              {past.map((o) => (
                <OrderCard key={o.id} o={o} onPress={() => router.push(`/order/${o.id}`)} />
              ))}
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text, marginBottom: 4 },
  card: {
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
  cardTitle: { fontSize: 15.5, fontFamily: fonts.bold, color: Colors.text },
  cardSub: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
});
