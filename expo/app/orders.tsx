import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import {
  Clock, CheckCircle, XCircle, Truck, MapPin, ArrowRightLeft,
  ChevronRight, Package, AlertCircle, Star,
} from 'lucide-react-native';
import { useApp } from '@/providers/AppProvider';
import { Order, OrderStatus } from '@/types';
import Colors from '@/constants/colors';

type Tab = 'buying' | 'selling';
type FilterStatus = 'all' | 'active' | 'completed' | 'canceled';

const statusConfig: Record<OrderStatus, { label: string; color: string; icon: React.ComponentType<{ size: number; color: string }> }> = {
  awaiting_response: { label: 'Awaiting Response', color: Colors.promoted, icon: Clock },
  accepted: { label: 'Accepted', color: Colors.info, icon: CheckCircle },
  ready_for_pickup: { label: 'Ready for Pickup', color: Colors.freshGreen, icon: MapPin },
  out_for_delivery: { label: 'Out for Delivery', color: Colors.info, icon: Truck },
  completed: { label: 'Completed', color: Colors.primary, icon: CheckCircle },
  canceled: { label: 'Canceled', color: Colors.textTertiary, icon: XCircle },
  sold_out: { label: 'Sold Out', color: Colors.accent, icon: AlertCircle },
};

const typeLabels: Record<string, string> = {
  buy: 'Purchase',
  reserve: 'Reservation',
  pickup: 'Pickup Request',
  delivery: 'Delivery',
  trade: 'Trade',
};

function OrderCard({ order, role, onPress }: { order: Order; role: Tab; onPress: () => void }) {
  const config = statusConfig[order.status];
  const StatusIcon = config.icon;
  const otherUser = role === 'buying' ? order.seller : order.buyer;
  const isActive = !['completed', 'canceled', 'sold_out'].includes(order.status);

  return (
    <Pressable style={[styles.orderCard, isActive && styles.orderCardActive]} onPress={onPress}>
      <Image source={{ uri: order.listing.images[0] }} style={styles.orderImage} contentFit="cover" />
      <View style={styles.orderContent}>
        <View style={styles.orderTopRow}>
          <Text style={styles.orderTitle} numberOfLines={1}>{order.listing.title}</Text>
          {order.totalPrice != null && order.totalPrice > 0 && (
            <Text style={styles.orderPrice}>${order.totalPrice}</Text>
          )}
        </View>
        <Text style={styles.orderType}>{typeLabels[order.type] ?? order.type} · {order.quantity}</Text>
        <View style={styles.orderUserRow}>
          <Image source={{ uri: otherUser.avatar }} style={styles.orderUserAvatar} contentFit="cover" />
          <Text style={styles.orderUserName}>
            {role === 'buying' ? 'from' : 'to'} {otherUser.name}
          </Text>
        </View>
        <View style={styles.orderStatusRow}>
          <View style={[styles.statusBadge, { backgroundColor: config.color + '15' }]}>
            <StatusIcon size={12} color={config.color} />
            <Text style={[styles.statusText, { color: config.color }]}>{config.label}</Text>
          </View>
          <Text style={styles.orderDate}>
            {new Date(order.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </Text>
        </View>
        {order.type === 'trade' && order.tradeOffer && (
          <View style={styles.tradeRow}>
            <ArrowRightLeft size={11} color={Colors.trade} />
            <Text style={styles.tradeText}>{order.tradeOffer}</Text>
          </View>
        )}
      </View>
      <ChevronRight size={18} color={Colors.textTertiary} />
    </Pressable>
  );
}

export default function OrdersScreen() {
  const router = useRouter();
  const { buyerOrders, sellerOrders, updateOrderStatus } = useApp();
  const [tab, setTab] = useState<Tab>('buying');
  const [filter, setFilter] = useState<FilterStatus>('all');

  const orders = tab === 'buying' ? buyerOrders : sellerOrders;

  const filteredOrders = useMemo(() => {
    if (filter === 'all') return orders;
    if (filter === 'active') return orders.filter(o => !['completed', 'canceled', 'sold_out'].includes(o.status));
    if (filter === 'completed') return orders.filter(o => o.status === 'completed');
    return orders.filter(o => o.status === 'canceled');
  }, [orders, filter]);

  const activeCount = useMemo(() => orders.filter(o => !['completed', 'canceled', 'sold_out'].includes(o.status)).length, [orders]);

  const handleOrderPress = useCallback((order: Order) => {
    if (tab === 'selling' && order.status === 'awaiting_response') {
      updateOrderStatus(order.id, 'accepted');
    }
    router.push(`/listing/${order.listing.id}`);
  }, [tab, updateOrderStatus, router]);

  const renderOrder = useCallback(({ item }: { item: Order }) => (
    <OrderCard order={item} role={tab} onPress={() => handleOrderPress(item)} />
  ), [tab, handleOrderPress]);

  const filters: { key: FilterStatus; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: `Active (${activeCount})` },
    { key: 'completed', label: 'Completed' },
    { key: 'canceled', label: 'Canceled' },
  ];

  return (
    <>
      <Stack.Screen options={{ title: 'Orders & Requests' }} />
      <View style={styles.container}>
        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tabBtn, tab === 'buying' && styles.tabBtnActive]}
            onPress={() => { setTab('buying'); setFilter('all'); }}
          >
            <Package size={15} color={tab === 'buying' ? Colors.textOnPrimary : Colors.textSecondary} />
            <Text style={[styles.tabText, tab === 'buying' && styles.tabTextActive]}>Buying</Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, tab === 'selling' && styles.tabBtnActive]}
            onPress={() => { setTab('selling'); setFilter('all'); }}
          >
            <Star size={15} color={tab === 'selling' ? Colors.textOnPrimary : Colors.textSecondary} />
            <Text style={[styles.tabText, tab === 'selling' && styles.tabTextActive]}>Selling</Text>
          </Pressable>
        </View>

        <View style={styles.filterRow}>
          {filters.map(f => (
            <Pressable
              key={f.key}
              style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>

        <FlatList
          data={filteredOrders}
          keyExtractor={item => item.id}
          renderItem={renderOrder}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📦</Text>
              <Text style={styles.emptyTitle}>No orders yet</Text>
              <Text style={styles.emptyText}>
                {tab === 'buying'
                  ? 'Browse listings and place your first order!'
                  : 'Orders from buyers will appear here'}
              </Text>
            </View>
          }
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 11,
  },
  tabBtnActive: {
    backgroundColor: Colors.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: Colors.textOnPrimary,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.primaryDark,
    borderColor: Colors.primaryDark,
  },
  filterText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  filterTextActive: {
    color: Colors.textOnPrimary,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  orderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  orderCardActive: {
    borderColor: Colors.primary + '30',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  orderImage: {
    width: 64,
    height: 64,
    borderRadius: 12,
  },
  orderContent: {
    flex: 1,
  },
  orderTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  orderTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1,
    marginRight: 8,
  },
  orderPrice: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  orderType: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginBottom: 4,
  },
  orderUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  orderUserAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  orderUserName: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  orderStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  orderDate: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  tradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
    backgroundColor: Colors.trade + '10',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tradeText: {
    fontSize: 11,
    color: Colors.trade,
    fontWeight: '500' as const,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
  },
});
