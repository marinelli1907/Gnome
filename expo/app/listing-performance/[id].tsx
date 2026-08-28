import React from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Archive,
  ExternalLink,
  Megaphone,
  Pencil,
  Share2,
  ShoppingBag,
  Trash2,
} from 'lucide-react-native';
import { Badge, Button, ErrorState } from '@/components/ui';
import { RowSkeleton, Skeleton } from '@/components/Skeleton';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import {
  useArchiveListing,
  useListing,
  useListingPerformance,
  useUpdateListingStatus,
} from '@/lib/db';
import { listingShareUrl } from '@/lib/links';
import { safeErrorText } from '@/lib/screening';
import { useAuth } from '@/providers/AuthProvider';
import type { Listing } from '@/types';

function money(cents: number | null) {
  if (cents == null) return 'Not available';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function shortDate(value: string | null | undefined) {
  if (!value) return 'Not available';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function statusLabel(status: string) {
  return status.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function statusColor(status: string) {
  if (status === 'active') return Colors.success;
  if (status === 'paused' || status === 'claimed') return Colors.warning;
  if (status === 'archived') return Colors.error;
  return Colors.textTertiary;
}

function paymentLabel(method: string) {
  const labels: Record<string, string> = {
    cash: 'Cash',
    venmo: 'Venmo',
    zelle: 'Zelle',
    cashapp: 'Cash App',
    paypal: 'PayPal',
    check: 'Check',
    external_card: 'External card',
    other: 'Other',
    gnome: 'Gnome',
  };
  return labels[method] ?? statusLabel(method);
}

function Stat({ label, value, note, color }: {
  label: string;
  value: string;
  note?: string;
  color?: string;
}) {
  return (
    <View style={[styles.stat, color ? { borderTopColor: color, borderTopWidth: 3 } : null]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={2}>{value}</Text>
      {note ? <Text style={styles.statNote}>{note}</Text> : null}
    </View>
  );
}

function Action({ icon, label, onPress, danger = false }: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
    >
      {icon}
      <Text style={[styles.actionLabel, danger && { color: Colors.error }]}>{label}</Text>
    </Pressable>
  );
}

export default function ListingPerformanceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const listingQuery = useListing(id);
  const listing = listingQuery.data;
  const isOwner = !!listing && listing.owner_id === userId;
  const performance = useListingPerformance(id, isOwner);
  const archiveListing = useArchiveListing(userId ?? undefined);
  const updateStatus = useUpdateListingStatus(userId ?? undefined);

  const repost = (item: Listing) => {
    router.push({
      pathname: '/post',
      params: {
        type: item.listing_type,
        category: item.category,
        title: item.title,
        quantity: item.quantity ?? '',
        harvestDate: item.harvest_date ?? '',
        description: item.description ?? '',
        n: String(Date.now()),
      },
    });
  };

  const deleteListing = (item: Listing) => {
    const isPublic = item.status === 'active' && new Date(item.expires_at).getTime() > Date.now();
    const message = isPublic
      ? 'This listing will immediately stop appearing to buyers. Any completed sales or accounting records connected to it will remain in your Gnome records.'
      : 'This listing will be removed from your Market. Any completed sales or accounting records connected to it will remain in your Gnome records.';
    Alert.alert(`Delete “${item.title}”?`, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete listing',
        style: 'destructive',
        onPress: () => archiveListing.mutate(item.id, {
          onSuccess: () => router.replace('/activity' as never),
          onError: (error: any) => Alert.alert(
            'Couldn’t delete it',
            safeErrorText(error?.message, 'Try again.'),
          ),
        }),
      },
    ]);
  };

  const markSoldOut = (item: Listing) => {
    Alert.alert(
      item.listing_type === 'sale' ? 'Mark sold out?' : 'Mark complete?',
      'This listing will stop appearing to buyers. Recorded sales and requests stay in your records.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: item.listing_type === 'sale' ? 'Mark sold out' : 'Mark complete',
          onPress: () => updateStatus.mutate(
            { listingId: item.id, status: 'completed', kind: item.kind, title: item.title },
            {
              onSuccess: () => {
                void listingQuery.refetch();
                void performance.refetch();
              },
              onError: (error: any) => Alert.alert(
                'Couldn’t update it',
                safeErrorText(error?.message, 'Try again.'),
              ),
            },
          ),
        },
      ],
    );
  };

  if (listingQuery.isLoading) {
    return (
      <View style={styles.screen}>
        <View style={styles.loading}>
          <Skeleton style={{ width: '62%', height: 30, borderRadius: 6 }} />
          <RowSkeleton />
          <RowSkeleton />
        </View>
      </View>
    );
  }

  if (!listing || !isOwner) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ErrorState
          title="Performance unavailable"
          message="Only the listing owner can view these business records."
          emoji=""
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  if (performance.isLoading) {
    return (
      <View style={styles.screen}>
        <View style={styles.loading}>
          <Skeleton style={{ width: '72%', height: 30, borderRadius: 6 }} />
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </View>
      </View>
    );
  }

  if (performance.error || !performance.data) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ErrorState
          message="Your listing loaded, but its performance data didn’t."
          onRetry={() => void performance.refetch()}
        />
      </View>
    );
  }

  const stats = performance.data;
  const active = stats.status === 'active';
  const expired = stats.status === 'expired';
  const archived = stats.status === 'archived';
  const viewValue = stats.views_tracked ? String(stats.views ?? 0) : 'Not available';
  const uniqueValue = stats.views_tracked ? String(stats.unique_viewers ?? 0) : 'Not available';
  const conversionValue = stats.conversion_rate == null
    ? (stats.views_tracked ? 'Not enough data' : 'Not available')
    : `${stats.conversion_rate.toFixed(1)}%`;
  const quantitySold = `${stats.quantity_sold ?? 0}${stats.unit ? ` ${stats.unit}` : ''}`;
  const remaining = stats.quantity_remaining == null
    ? 'Not tracked'
    : `${stats.quantity_remaining}${stats.unit ? ` ${stats.unit}` : ''}`;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
    >
      <View style={styles.headingRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>LISTING PERFORMANCE</Text>
          <Text style={styles.title}>{listing.title}</Text>
        </View>
        <Badge label={statusLabel(stats.status)} color={statusColor(stats.status)} />
      </View>

      {!stats.views_tracked ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Historical views were not tracked</Text>
          <Text style={styles.noticeText}>
            Requests and recorded sales are available. View totals are omitted instead of shown as a false zero.
          </Text>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Performance</Text>
      <View style={styles.statGrid}>
        <Stat label="Views" value={viewValue} note="Signed-in detail views" color={Colors.tradeBlueInteractive} />
        <Stat label="Unique viewers" value={uniqueValue} note="Signed-in neighbors" color={Colors.tradeBlueInteractive} />
        <Stat label="Requests" value={String(stats.requests)} />
        <Stat label="Reservations" value={String(stats.reservations)} note="Approved or completed" />
        <Stat label="Completed sales" value={String(stats.completed_sales)} color={Colors.gardenGreenInteractive} />
        <Stat label="Quantity sold" value={quantitySold} color={Colors.gardenGreenInteractive} />
        <Stat label="Recorded revenue" value={money(stats.recorded_revenue_cents)} color={Colors.gardenGreenInteractive} />
        <Stat
          label="Promotion spend"
          value={stats.promotion_spend_known ? money(stats.promotion_spend_cents) : 'Not available'}
          note={stats.included_promotions > 0 ? `${stats.included_promotions} included promotion${stats.included_promotions === 1 ? '' : 's'}` : undefined}
          color={Colors.aiPurpleInteractive}
        />
        <Stat
          label="Net after Gnome promotion"
          value={money(stats.net_after_promotion_cents)}
          note="Not business profit"
          color={Colors.gardenGreenInteractive}
        />
        <Stat
          label="Completion conversion"
          value={conversionValue}
          note="Completed requests / unique signed-in viewers"
        />
        <Stat label="Days listed" value={String(stats.days_listed)} />
        <Stat label="Quantity remaining" value={remaining} />
      </View>

      <Text style={styles.definition}>
        A view is one signed-in, non-owner listing open per 30 minutes. Conversion appears after at least {stats.conversion_minimum_viewers} unique viewers. Revenue includes completed seller-ledger entries only; reserved value is excluded.
      </Text>

      <Text style={styles.sectionTitle}>Listing history</Text>
      <View style={styles.rows}>
        <DetailRow label="Posted" value={shortDate(stats.posted_at)} />
        <DetailRow label={expired ? 'Expired' : 'Expires'} value={shortDate(stats.expires_at)} />
        <DetailRow label="Renewed" value={String(stats.renewal_count)} />
        <DetailRow label="Reposts" value={stats.repost_count == null ? 'Not available' : String(stats.repost_count)} />
        <DetailRow label="Last activity" value={shortDate(stats.last_activity_at)} />
      </View>

      {stats.payment_breakdown.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Recorded payment methods</Text>
          <View style={styles.rows}>
            {stats.payment_breakdown.map((payment) => (
              <DetailRow
                key={payment.method}
                label={`${paymentLabel(payment.method)} · ${payment.sales} sale${payment.sales === 1 ? '' : 's'}`}
                value={money(payment.revenue_cents)}
              />
            ))}
          </View>
          <Text style={styles.definition}>
            These are seller ledger records. Methods other than Gnome were settled off-platform; Gnome did not process those payments.
          </Text>
        </>
      ) : null}

      {stats.promotion_periods.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Performance while promoted</Text>
          <View style={styles.promotionList}>
            {stats.promotion_periods.map((period) => (
              <View key={period.id} style={styles.promotion}>
                <View style={styles.promotionHeading}>
                  <Text style={styles.promotionTitle}>{statusLabel(period.source)} promotion</Text>
                  <Text style={styles.promotionDate}>
                    {shortDate(period.starts_at)} – {shortDate(period.ends_at)}
                  </Text>
                </View>
                <Text style={styles.promotionStats}>
                  {period.views_during == null ? 'Views not available' : `${period.views_during} views`} · {period.requests_during} requests · {period.recorded_sales_during} recorded sales
                </Text>
                {period.source === 'paid' && period.seller_paid_cents == null ? (
                  <Text style={styles.promotionNote}>Cash spend cannot be attributed from the historical credit record.</Text>
                ) : null}
              </View>
            ))}
          </View>
          <Text style={styles.definition}>
            This is timing overlap, not a claim that the promotion caused a request or sale.
          </Text>
        </>
      ) : null}

      <Text style={styles.sectionTitle}>Manage listing</Text>
      <View style={styles.actions}>
        <Action
          icon={<ExternalLink size={19} color={Colors.text} />}
          label="View listing details"
          onPress={() => router.push(`/listing/${listing.id}?preview=1` as never)}
        />
        {!archived ? (
          <Action
            icon={<Pencil size={19} color={Colors.text} />}
            label="Edit listing"
            onPress={() => router.push(`/edit-listing/${listing.id}`)}
          />
        ) : null}
        {active && !listing.is_featured ? (
          <Action
            icon={<Megaphone size={19} color={Colors.text} />}
            label="Promote listing"
            onPress={() => router.push(`/promote/${listing.id}`)}
          />
        ) : null}
        {active ? (
          <Action
            icon={<Share2 size={19} color={Colors.text} />}
            label="Share listing"
            onPress={() => void Share.share({ message: `${listing.title} on Gnome — ${listingShareUrl(listing)}` })}
          />
        ) : null}
        {active ? (
          <Action
            icon={<ShoppingBag size={19} color={Colors.text} />}
            label={listing.listing_type === 'sale' ? 'Mark sold out' : 'Mark complete'}
            onPress={() => markSoldOut(listing)}
          />
        ) : null}
        {expired || stats.status === 'completed' || archived ? (
          <Action
            icon={<Archive size={19} color={Colors.text} />}
            label={archived ? 'Duplicate as new listing' : 'Repost listing'}
            onPress={() => repost(listing)}
          />
        ) : null}
        {!archived ? (
          <Action
            icon={<Trash2 size={19} color={Colors.error} />}
            label="Delete listing"
            danger
            onPress={() => deleteListing(listing)}
          />
        ) : null}
      </View>

      {archiveListing.isPending || updateStatus.isPending ? (
        <Button label="Updating…" onPress={() => {}} loading disabled style={{ marginTop: 14 }} />
      ) : null}
    </ScrollView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { justifyContent: 'center' },
  loading: { padding: 20, gap: 12 },
  content: { padding: 20 },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
  eyebrow: { fontSize: 12, color: Colors.marketOrangeInteractive, fontFamily: fonts.bold },
  title: { fontSize: 28, lineHeight: 34, color: Colors.text, fontFamily: fonts.displayBold, marginTop: 3 },
  notice: {
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.warning,
    backgroundColor: Colors.goldLight,
    marginBottom: 18,
  },
  noticeTitle: { fontSize: 14, color: Colors.text, fontFamily: fonts.bold },
  noticeText: { fontSize: 13, lineHeight: 18, color: Colors.textSecondary, fontFamily: fonts.regular, marginTop: 4 },
  sectionTitle: { fontSize: 17, color: Colors.text, fontFamily: fonts.bold, marginTop: 20, marginBottom: 10 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: {
    width: '48%',
    minHeight: 112,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: 12,
  },
  statLabel: { fontSize: 12, lineHeight: 16, color: Colors.textSecondary, fontFamily: fonts.semibold },
  statValue: { fontSize: 21, lineHeight: 26, color: Colors.text, fontFamily: fonts.bold, marginTop: 6 },
  statNote: { fontSize: 11.5, lineHeight: 15, color: Colors.textTertiary, fontFamily: fonts.regular, marginTop: 4 },
  definition: { fontSize: 12, lineHeight: 18, color: Colors.textSecondary, fontFamily: fonts.regular, marginTop: 10 },
  rows: { borderTopWidth: 1, borderTopColor: Colors.border },
  row: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowLabel: { flex: 1, fontSize: 14, color: Colors.textSecondary, fontFamily: fonts.regular },
  rowValue: { fontSize: 14, color: Colors.text, fontFamily: fonts.semibold, textAlign: 'right' },
  promotionList: { gap: 10 },
  promotion: { borderRadius: 8, borderWidth: 1, borderColor: Colors.border, padding: 13 },
  promotionHeading: { gap: 2 },
  promotionTitle: { fontSize: 14, color: Colors.text, fontFamily: fonts.bold },
  promotionDate: { fontSize: 12, color: Colors.textSecondary, fontFamily: fonts.regular },
  promotionStats: { fontSize: 13, lineHeight: 18, color: Colors.text, fontFamily: fonts.regular, marginTop: 8 },
  promotionNote: { fontSize: 11.5, lineHeight: 16, color: Colors.textSecondary, fontFamily: fonts.regular, marginTop: 5 },
  actions: { borderTopWidth: 1, borderTopColor: Colors.border },
  action: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  actionLabel: { fontSize: 15, color: Colors.text, fontFamily: fonts.semibold },
});
