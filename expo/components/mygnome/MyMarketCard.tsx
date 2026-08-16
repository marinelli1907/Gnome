import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Avatar } from '@/components/ui';
import UpgradePromptCard from '@/components/UpgradePromptCard';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useBoostCreditsRemaining, useMyListingAllowance, useMyListings, useMyMarket, usePlanLimits } from '@/lib/db';
import { exhaustedHint, listingsMeter, renewalsMeter, planDisplay, resetLabel, type Meter } from '@/lib/allowance';
import type { MarketPlan } from '@/types';

// One LISTINGS or RENEWALS block. Lines come straight from the shared formatter, which renders
// the server's numbers — including the overage shape ("20 of 20 included used / 23 published
// total") and Farm's "47 published / Unlimited". Nothing here recomputes a value.
function MeterBlock({ meter, hint }: { meter: Meter; hint: string | null }) {
  return (
    <View style={{ flex: 1, minWidth: 130 }}>
      <Text style={styles.meterHead}>{meter.heading}</Text>
      {meter.lines.map((l, i) => (
        <Text key={l.value} style={i === 0 ? styles.meterMain : styles.meterSub}>{l.value}</Text>
      ))}
      {hint ? <Text style={styles.meterHint}>{hint}</Text> : null}
    </View>
  );
}

export default function MyMarketCard({ uid }: { uid: string }) {
  const router = useRouter();
  const market = useMyMarket(uid);
  const limits = usePlanLimits();
  const allowance = useMyListingAllowance(uid);
  const credits = useBoostCreditsRemaining(market.data?.id);
  // Every account gets a market row at signup, because listings, orders,
  // pickup hours and the sales notebook all hang off market_id. But someone
  // who has only ever bought does not have a storefront in any meaningful
  // sense, and showing them "0 active listings · Name your Market" is noise.
  // The storefront appears the moment they list something — any status, so a
  // seller whose listings expired or sold keeps theirs.
  const everListed = useMyListings(uid);
  const hasEverListed = (everListed.data?.length ?? 0) > 0;

  if (!market.data || !hasEverListed) return null;

  const m = market.data;
  const plan: MarketPlan = (m.plan as MarketPlan) ?? 'free';
  const includedBoosts = limits.data?.[plan]?.included_boost_credits ?? 0;
  const boostsLeft = credits.data ?? 0;
  const row = allowance.data ?? null;
  // Upsell only on the server's own exhaustion verdict — never a client-side 80%-of-cap guess
  // against an active-listing count, which is the retired model.
  const exhausted = row != null && row.publishes_allowed !== null && row.publishes_remaining === 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Pressable style={styles.row} onPress={() => router.push(`/market/${m.id}`)}>
          <Avatar uri={m.avatar_url} name={m.name} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Your Market · {row ? row.display_name : planDisplay(plan)} plan</Text>
            <Text style={styles.name} numberOfLines={1}>{m.name}</Text>
          </View>
          <ChevronRight size={20} color={Colors.textTertiary} />
        </Pressable>

        {allowance.isLoading && <Text style={styles.meta}>Checking your listing allowance…</Text>}
        {allowance.isError && (
          <Text style={styles.metaError}>
            Couldn’t load your listing allowance — nothing about your plan has changed.
          </Text>
        )}
        {row && (
          <View style={styles.meters}>
            <MeterBlock meter={listingsMeter(row)} hint={exhaustedHint(row, 'listings')} />
            <MeterBlock meter={renewalsMeter(row)} hint={exhaustedHint(row, 'renewals')} />
          </View>
        )}
        {row && <Text style={styles.reset}>{resetLabel(row)} · Sell listings run for {row.listing_lifetime_days} days</Text>}

        {includedBoosts > 0 && (
          <Text style={styles.boosts}>✨ Boosts: {boostsLeft} of {includedBoosts} left this month</Text>
        )}

        <Pressable style={styles.editBtn} onPress={() => router.push(`/market/edit/${m.id}`)}>
          <Text style={styles.editText}>Name your Market</Text>
        </Pressable>
      </View>

      {exhausted && (
        <View style={{ marginTop: 10 }}>
          <UpgradePromptCard plan={plan} reason="limit" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginTop: 12 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontSize: 11, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: fonts.bold },
  name: { fontSize: 17, color: Colors.text, marginTop: 1, fontFamily: fonts.bold },
  meta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2, fontFamily: fonts.regular },
  boosts: { fontSize: 12, color: Colors.textSecondary, fontFamily: fonts.semibold },
  metaError: { fontSize: 12, color: Colors.error, fontFamily: fonts.regular },
  meters: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  meterHead: { fontSize: 10.5, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: fonts.bold },
  meterMain: { fontSize: 15, color: Colors.text, marginTop: 2, fontFamily: fonts.bold },
  meterSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 1, fontFamily: fonts.regular },
  meterHint: { fontSize: 11.5, color: Colors.gold, marginTop: 3, fontFamily: fonts.semibold },
  reset: { fontSize: 11.5, color: Colors.textTertiary, fontFamily: fonts.regular },
  editBtn: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary + '12',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  editText: { color: Colors.primary, fontSize: 13, fontFamily: fonts.bold },
});
