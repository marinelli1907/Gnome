import React, { useEffect } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sparkles } from 'lucide-react-native';
import { Button, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import {
  logEvent,
  useListing,
  useMarketPromotionStatus,
  useMyMarket,
  usePromoteListing,
  usePromotePurchased,
} from '@/lib/db';
import { formatPrice } from '@/lib/listingType';

// FEATURED LISTING PROMOTION — one product: 7 days, $3.99, or free with an
// included plan credit (Grower 3/mo, Farm 10/mo). All allowance math is
// server-side (market_promotion_status → effective plan).
export default function PromoteScreen() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const { data: listing, isLoading } = useListing(listingId);
  const market = useMyMarket(userId ?? undefined);
  const status = useMarketPromotionStatus(market.data?.id);
  const promote = usePromoteListing(userId ?? undefined);
  const promotePurchased = usePromotePurchased(userId ?? undefined);

  const st = status.data;
  const includedRemaining = st?.included_remaining ?? 0;
  const purchased = st?.purchased_balance ?? 0;
  const priceCents = st?.price_cents ?? 399;
  const days = st?.duration_days ?? 7;
  const resetsOn = st?.resets_on
    ? new Date(`${st.resets_on}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';

  useEffect(() => {
    if (!isLoading && listing && st && includedRemaining <= 0 && purchased <= 0 && !listing.is_featured) {
      void logEvent('boost_upgrade_prompt_viewed', { userId: userId ?? null, listingId, metadata: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, st?.included_remaining, listing?.id]);

  if (isLoading || market.isLoading || status.isLoading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={Colors.primary} />
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
  if (userId !== listing.owner_id || !market.data) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState emoji="🔒" title="Can’t promote this" subtitle="You can only promote your own listings." />
      </View>
    );
  }
  if (listing.is_featured) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState
          emoji="✨"
          title="Already featured"
          subtitle={
            listing.featured_until
              ? `“${listing.title}” is featured until ${new Date(listing.featured_until).toLocaleDateString()}. One promotion at a time per listing.`
              : `“${listing.title}” is currently featured.`
          }
        />
      </View>
    );
  }

  const onErr = (e: any) => {
    const m = String(e?.message ?? '');
    const stacked = m.match(/PROMO_ALREADY_ACTIVE:(\S+)/);
    Alert.alert(
      'Could not promote',
      stacked
        ? `This listing is already featured until ${new Date(stacked[1]).toLocaleDateString()}. One promotion at a time.`
        : /NO_BOOST_CREDITS/.test(m)
          ? 'You’re out of included promotions this month.'
          : /NO_PURCHASED_CREDITS/.test(m)
            ? 'No purchased promotion credits available.'
            : /LISTING_NOT_PROMOTABLE/.test(m)
              ? 'Only live listings can be promoted.'
              : m || 'Please try again.',
    );
  };
  const done = () =>
    Alert.alert('Featured! ✨', `“${listing.title}” is featured for ${days} days.`, [
      { text: 'OK', onPress: () => router.back() },
    ]);

  const useIncluded = () =>
    promote.mutate(
      { listingId: listing.id, marketId: market.data!.id, durationDays: days, source: 'plan_credit', priceCents: 0 },
      { onSuccess: done, onError: onErr },
    );
  const usePurchasedCredit = () =>
    promotePurchased.mutate({ listingId: listing.id, marketId: market.data!.id }, { onSuccess: done, onError: onErr });
  const buySingle = () => {
    void logEvent('boost_upgrade_prompt_tapped', { userId: userId ?? null, listingId, metadata: {} });
    Alert.alert(
      `Buy a promotion · ${formatPrice(priceCents)}`,
      'Promotion checkout is almost ready. Until then, Grower ($9.99/mo) includes 3 promotions a month and Farm includes 10.',
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
      <Text style={styles.heading}>Feature “{listing.title}”</Text>
      <Text style={styles.sub}>
        Featured listings rise to the top of nearby Browse and category results and appear in the “Featured Near You”
        rail for {days} days. Clearly labeled Featured — same honest listing, more neighbors see it.
      </Text>

      <View style={styles.creditBox}>
        <Sparkles size={18} color={Colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.creditText}>
            {st ? `${includedRemaining} of ${st.included_allowance} included promotions left` : '—'}
          </Text>
          {!!resetsOn && <Text style={styles.creditSub}>Resets {resetsOn}{purchased > 0 ? ` · ${purchased} purchased credit${purchased === 1 ? '' : 's'} banked` : ''}</Text>}
        </View>
      </View>

      {includedRemaining > 0 ? (
        <Button
          label={`Feature for ${days} days · FREE (included credit)`}
          onPress={useIncluded}
          loading={promote.isPending}
        />
      ) : purchased > 0 ? (
        <Button
          label={`Feature for ${days} days · use 1 purchased credit`}
          onPress={usePurchasedCredit}
          loading={promotePurchased.isPending}
        />
      ) : (
        <>
          <Button label={`Feature for ${days} days · ${formatPrice(priceCents)}`} onPress={buySingle} />
          <Text style={styles.contextNote}>
            {st && st.included_allowance > 0
              ? `You’ve used your ${st.included_allowance} included promotion${st.included_allowance === 1 ? '' : 's'} this month${resetsOn ? ` — they’re back ${resetsOn}` : ''}.`
              : 'Grower includes 3 promotions each month, Farm includes 10.'}
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingTop: 16 },
  heading: { fontSize: 22, fontFamily: fonts.bold, color: Colors.text },
  sub: { fontSize: 14, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 6, marginBottom: 18, lineHeight: 20 },
  contextNote: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textTertiary, marginTop: 10, lineHeight: 18 },
  creditBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.surface, borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: Colors.borderLight },
  creditText: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.text },
  creditSub: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
});
