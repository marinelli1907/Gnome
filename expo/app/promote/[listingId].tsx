import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sparkles } from 'lucide-react-native';
import { Button, EmptyState } from '@/components/ui';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import {
  logEvent,
  useBoostCreditsRemaining,
  useListing,
  useMyMarket,
  usePlanLimits,
  usePromoteListing,
} from '@/lib/db';
import { formatPrice } from '@/lib/listingType';

const TIERS = [
  { days: 3, priceCents: 300 },
  { days: 7, priceCents: 600 },
  { days: 14, priceCents: 1000 },
];

export default function PromoteScreen() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const { data: listing, isLoading } = useListing(listingId);
  const market = useMyMarket(userId ?? undefined);
  const limits = usePlanLimits();
  const credits = useBoostCreditsRemaining(market.data?.id);
  const promote = usePromoteListing(userId ?? undefined);

  const [days, setDays] = useState(7);

  const plan = market.data?.plan ?? 'free';
  const included = limits.data?.[plan]?.included_boost_credits ?? 0;
  const remaining = credits.data ?? 0;
  const hasCredits = remaining > 0;

  useEffect(() => {
    if (!isLoading && listing && !hasCredits && !listing.is_featured) {
      void logEvent('boost_upgrade_prompt_viewed', { userId: userId ?? null, listingId, metadata: { plan } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, hasCredits, listing?.id]);

  if (isLoading || market.isLoading) {
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
              ? `“${listing.title}” is featured until ${new Date(listing.featured_until).toLocaleDateString()}.`
              : `“${listing.title}” is currently featured.`
          }
        />
      </View>
    );
  }

  const tier = TIERS.find((t) => t.days === days) ?? TIERS[1];

  const onBoost = () => {
    promote.mutate(
      { listingId: listing.id, marketId: market.data!.id, durationDays: days, source: 'plan_credit', priceCents: tier.priceCents },
      {
        onSuccess: () => {
          Alert.alert('Boosted! ✨', `“${listing.title}” is featured for ${days} days.`, [
            { text: 'OK', onPress: () => router.back() },
          ]);
        },
        onError: (e: any) => {
          const msg = /NO_BOOST_CREDITS/i.test(e?.message ?? '')
            ? 'You’re out of boost credits this month.'
            : e?.message ?? 'Please try again.';
          Alert.alert('Could not boost', msg);
        },
      },
    );
  };

  const onUpgradeTap = () => {
    void logEvent('boost_upgrade_prompt_tapped', { userId: userId ?? null, listingId, metadata: { plan } });
    Alert.alert('Coming soon', 'Grower plans and paid boosts arrive soon — no charge today.');
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
      <Text style={styles.heading}>Boost “{listing.title}”</Text>
      <Text style={styles.sub}>Featured listings show up in the “Featured Near You” rail for neighbors close by.</Text>

      <Text style={styles.section}>Duration</Text>
      <View style={styles.tiers}>
        {TIERS.map((t) => {
          const active = days === t.days;
          return (
            <Pressable key={t.days} onPress={() => setDays(t.days)} style={[styles.tier, active && styles.tierActive]}>
              <Text style={[styles.tierDays, active && styles.tierTextActive]}>{t.days} days</Text>
              <Text style={[styles.tierPrice, active && styles.tierTextActive]}>{formatPrice(t.priceCents)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.contextNote}>Prices shown for context — boosts are not charged in this version.</Text>

      <View style={styles.creditBox}>
        <Sparkles size={18} color={Colors.primary} />
        <Text style={styles.creditText}>
          Boosts: {remaining} of {included} left this month
        </Text>
      </View>

      {hasCredits ? (
        <Button
          label={`Promote with 1 boost credit · ${days} days`}
          onPress={onBoost}
          loading={promote.isPending}
        />
      ) : (
        <Pressable style={styles.upgrade} onPress={onUpgradeTap}>
          <Text style={styles.upgradeTitle}>Out of boost credits</Text>
          <Text style={styles.upgradeBody}>
            Promote with a Grower plan (1 boost/month), or paid boosts coming soon. No charge today.
          </Text>
          <View style={styles.upgradeCta}>
            <Text style={styles.upgradeCtaText}>See options</Text>
          </View>
        </Pressable>
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
  section: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary, marginBottom: 8 },
  tiers: { flexDirection: 'row', gap: 10 },
  tier: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.border },
  tierActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '12' },
  tierDays: { fontSize: 15, fontFamily: fonts.bold, color: Colors.text },
  tierPrice: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  tierTextActive: { color: Colors.primary },
  contextNote: { fontSize: 12, fontFamily: fonts.regular, color: Colors.textTertiary, marginTop: 8, marginBottom: 18 },
  creditBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surface, borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: Colors.borderLight },
  creditText: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.text },
  upgrade: { backgroundColor: Colors.gold + '22', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.gold },
  upgradeTitle: { fontSize: 15, fontFamily: fonts.bold, color: Colors.text },
  upgradeBody: { fontSize: 13, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 4, lineHeight: 18 },
  upgradeCta: { alignSelf: 'flex-start', marginTop: 12, backgroundColor: Colors.primary, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  upgradeCtaText: { color: Colors.textInverse, fontFamily: fonts.bold, fontSize: 13 },
});
