import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import {
  DollarSign,
  TrendingUp,
  Package,
  Megaphone,
  ShoppingCart,
  Clock,
  ChevronRight,
  ArrowUpRight,
  FileText,
  Crown,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { mockSellerStats } from '@/mocks/seller';
import { useApp } from '@/providers/AppProvider';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_HEIGHT = 120;
const CHART_PADDING = 16;

function MiniChart({ data }: { data: { day: string; amount: number }[] }) {
  const maxVal = Math.max(...data.map(d => d.amount), 1);
  const barWidth = (SCREEN_WIDTH - 80 - CHART_PADDING * 2 - (data.length - 1) * 6) / data.length;

  return (
    <View style={chartStyles.container}>
      <View style={chartStyles.barsRow}>
        {data.map((item, i) => {
          const height = (item.amount / maxVal) * (CHART_HEIGHT - 30);
          return (
            <View key={i} style={chartStyles.barCol}>
              <View
                style={[
                  chartStyles.bar,
                  {
                    height: Math.max(height, 4),
                    width: barWidth,
                    backgroundColor: i === data.length - 2 ? Colors.primary : Colors.chartFill.replace('0.12', '0.25'),
                    borderRadius: 4,
                  },
                ]}
              />
              <Text style={chartStyles.label}>{item.day}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  container: {
    height: CHART_HEIGHT,
    justifyContent: 'flex-end',
    paddingHorizontal: CHART_PADDING,
  },
  barsRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    justifyContent: 'space-between' as const,
    gap: 6,
  },
  barCol: {
    alignItems: 'center' as const,
    gap: 6,
  },
  bar: {
    minHeight: 4,
  },
  label: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '600' as const,
  },
});

export default function SellerDashboardScreen() {
  const router = useRouter();
  const { user } = useApp();
  const stats = mockSellerStats;

  const statCards = [
    { label: 'Total Earnings', value: `$${stats.totalEarnings}`, icon: DollarSign, color: Colors.primary, change: '+12%' },
    { label: 'Pending', value: `$${stats.pendingEarnings}`, icon: Clock, color: Colors.promoted, change: '' },
    { label: 'This Month', value: `$${stats.monthlyEarnings}`, icon: TrendingUp, color: Colors.freshGreen, change: '+28%' },
    { label: 'Total Orders', value: `${stats.totalOrders}`, icon: ShoppingCart, color: Colors.sell, change: '+5' },
  ];

  const handleNavigation = useCallback((route: string) => {
    if (route === 'tax') {
      router.push('/tax-summary');
    } else if (route === 'subscription') {
      router.push('/seller-plan');
    }
  }, [router]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Seller Dashboard',
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.text,
        }}
      />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.welcomeCard}>
          <View style={styles.welcomeLeft}>
            <Text style={styles.welcomeLabel}>Welcome back,</Text>
            <Text style={styles.welcomeName}>{user.name.split(' ')[0]}</Text>
            <View style={styles.planBadge}>
              <Crown size={12} color={Colors.gold} />
              <Text style={styles.planText}>Grower Pro</Text>
            </View>
          </View>
          <View style={styles.welcomeRight}>
            <Text style={styles.bigEarnings}>${stats.totalEarnings}</Text>
            <Text style={styles.bigEarningsLabel}>lifetime earnings</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          {statCards.map((card, i) => {
            const IconComp = card.icon;
            return (
              <View key={i} style={styles.statCard}>
                <View style={[styles.statIconWrap, { backgroundColor: card.color + '15' }]}>
                  <IconComp size={18} color={card.color} />
                </View>
                <Text style={styles.statValue}>{card.value}</Text>
                <View style={styles.statBottom}>
                  <Text style={styles.statLabel}>{card.label}</Text>
                  {card.change ? (
                    <View style={styles.changeRow}>
                      <ArrowUpRight size={10} color={Colors.freshGreen} />
                      <Text style={styles.changeText}>{card.change}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Weekly Sales</Text>
            <Text style={styles.sectionSubtitle}>Last 7 days</Text>
          </View>
          <View style={styles.chartCard}>
            <MiniChart data={stats.weeklySales} />
          </View>
        </View>

        <View style={styles.quickActions}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionsRow}>
            <Pressable style={styles.actionBtn} onPress={() => handleNavigation('subscription')}>
              <View style={[styles.actionIcon, { backgroundColor: Colors.gold + '15' }]}>
                <Crown size={20} color={Colors.gold} />
              </View>
              <Text style={styles.actionLabel}>Upgrade Plan</Text>
            </Pressable>
            <Pressable style={styles.actionBtn} onPress={() => handleNavigation('tax')}>
              <View style={[styles.actionIcon, { backgroundColor: Colors.sell + '15' }]}>
                <FileText size={20} color={Colors.sell} />
              </View>
              <Text style={styles.actionLabel}>Tax Report</Text>
            </Pressable>
            <Pressable style={styles.actionBtn} onPress={() => router.push('/create-listing')}>
              <View style={[styles.actionIcon, { backgroundColor: Colors.primary + '15' }]}>
                <Package size={20} color={Colors.primary} />
              </View>
              <Text style={styles.actionLabel}>New Listing</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Active Listings</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{stats.activeListings}</Text>
            </View>
          </View>
          <View style={styles.listingStatsRow}>
            <View style={styles.listingStat}>
              <Package size={16} color={Colors.primary} />
              <Text style={styles.listingStatValue}>{stats.activeListings}</Text>
              <Text style={styles.listingStatLabel}>Active</Text>
            </View>
            <View style={styles.listingStatDivider} />
            <View style={styles.listingStat}>
              <Megaphone size={16} color={Colors.promoted} />
              <Text style={styles.listingStatValue}>{stats.promotedListings}</Text>
              <Text style={styles.listingStatLabel}>Promoted</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Products</Text>
          {stats.topProducts.map((product, i) => (
            <View key={product.id} style={styles.productRow}>
              <Text style={styles.productRank}>#{i + 1}</Text>
              <Image source={{ uri: product.image }} style={styles.productImage} contentFit="cover" />
              <View style={styles.productInfo}>
                <Text style={styles.productName} numberOfLines={1}>{product.title}</Text>
                <Text style={styles.productMeta}>{product.sales} sales</Text>
              </View>
              <Text style={styles.productRevenue}>
                {product.revenue > 0 ? `$${product.revenue}` : 'Trade'}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Transactions</Text>
            <Pressable onPress={() => handleNavigation('tax')}>
              <Text style={styles.seeAll}>See All</Text>
            </Pressable>
          </View>
          {stats.recentTransactions.map((tx) => (
            <View key={tx.id} style={styles.txRow}>
              <View style={[
                styles.txIcon,
                {
                  backgroundColor: tx.type === 'promotion'
                    ? Colors.promoted + '15'
                    : tx.type === 'trade'
                      ? Colors.trade + '15'
                      : Colors.primary + '15'
                },
              ]}>
                {tx.type === 'promotion' ? (
                  <Megaphone size={14} color={Colors.promoted} />
                ) : tx.type === 'trade' ? (
                  <Package size={14} color={Colors.trade} />
                ) : (
                  <DollarSign size={14} color={Colors.primary} />
                )}
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txTitle} numberOfLines={1}>{tx.title}</Text>
                <Text style={styles.txMeta}>
                  {tx.buyer ? `${tx.buyer} · ` : ''}{tx.date}
                </Text>
              </View>
              <View style={styles.txRight}>
                <Text style={[
                  styles.txAmount,
                  tx.amount < 0 && styles.txAmountNeg,
                  tx.amount === 0 && styles.txAmountTrade,
                ]}>
                  {tx.amount > 0 ? `+$${tx.amount}` : tx.amount < 0 ? `-$${Math.abs(tx.amount)}` : 'Trade'}
                </Text>
                <View style={[
                  styles.txStatus,
                  tx.status === 'pending' && styles.txStatusPending,
                ]}>
                  <Text style={[
                    styles.txStatusText,
                    tx.status === 'pending' && styles.txStatusTextPending,
                  ]}>
                    {tx.status}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.earningsCard}>
          <View style={styles.earningsHeader}>
            <Text style={styles.earningsTitle}>Payout Summary</Text>
            <Pressable onPress={() => handleNavigation('tax')}>
              <ChevronRight size={18} color={Colors.textTertiary} />
            </Pressable>
          </View>
          <View style={styles.earningsGrid}>
            <View style={styles.earningsItem}>
              <Text style={styles.earningsLabel}>Gross Sales</Text>
              <Text style={styles.earningsValue}>${stats.grossSales}</Text>
            </View>
            <View style={styles.earningsItem}>
              <Text style={styles.earningsLabel}>Fees</Text>
              <Text style={[styles.earningsValue, { color: Colors.accent }]}>-${stats.fees}</Text>
            </View>
            <View style={styles.earningsDivider} />
            <View style={styles.earningsItem}>
              <Text style={[styles.earningsLabel, { fontWeight: '700' as const }]}>Net Earnings</Text>
              <Text style={[styles.earningsValue, { color: Colors.primary, fontWeight: '800' as const }]}>${stats.netEarnings}</Text>
            </View>
          </View>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  welcomeCard: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: Colors.primaryDark,
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  welcomeLeft: {
    flex: 1,
  },
  welcomeLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
  },
  welcomeName: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    marginBottom: 8,
  },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  planText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.gold,
  },
  welcomeRight: {
    alignItems: 'flex-end',
  },
  bigEarnings: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: '#FFFFFF',
  },
  bigEarningsLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    marginTop: 16,
    gap: 10,
  },
  statCard: {
    width: (SCREEN_WIDTH - 50) / 2,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
  },
  statIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  statBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  changeText: {
    fontSize: 11,
    color: Colors.freshGreen,
    fontWeight: '600' as const,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  seeAll: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  chartCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 16,
  },
  quickActions: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 16,
  },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.text,
    textAlign: 'center',
  },
  countBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  listingStatsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  listingStat: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  listingStatValue: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  listingStatLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '500' as const,
  },
  listingStatDivider: {
    width: 1,
    height: 40,
    backgroundColor: Colors.border,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  productRank: {
    fontSize: 14,
    fontWeight: '800' as const,
    color: Colors.textTertiary,
    width: 24,
  },
  productImage: {
    width: 40,
    height: 40,
    borderRadius: 10,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  productMeta: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  productRevenue: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  txInfo: {
    flex: 1,
  },
  txTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  txMeta: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  txRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  txAmount: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  txAmountNeg: {
    color: Colors.accent,
  },
  txAmountTrade: {
    color: Colors.trade,
  },
  txStatus: {
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  txStatusPending: {
    backgroundColor: Colors.warning + '30',
  },
  txStatusText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.primary,
    textTransform: 'capitalize' as const,
  },
  txStatusTextPending: {
    color: Colors.promoted,
  },
  earningsCard: {
    marginHorizontal: 20,
    marginTop: 24,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
  },
  earningsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  earningsTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  earningsGrid: {
    gap: 12,
  },
  earningsItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  earningsLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  earningsValue: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  earningsDivider: {
    height: 1,
    backgroundColor: Colors.border,
  },
  bottomSpacer: {
    height: 40,
  },
});
