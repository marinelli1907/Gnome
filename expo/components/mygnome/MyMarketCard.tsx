import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Avatar } from '@/components/ui';
import UpgradePromptCard from '@/components/UpgradePromptCard';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useBoostCreditsRemaining, useMarketListings, useMyListings, useMyMarket, usePlanLimits } from '@/lib/db';
import type { MarketPlan } from '@/types';

const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  grower: 'Grower',
  farm: 'Farm',
  sponsor: 'Sponsor',
};

export default function MyMarketCard({ uid }: { uid: string }) {
  const router = useRouter();
  const market = useMyMarket(uid);
  const listings = useMarketListings(market.data?.id);
  const limits = usePlanLimits();
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
  const count = listings.data?.length ?? 0;
  const cap = limits.data?.[plan]?.max_active_listings ?? null;
  const includedBoosts = limits.data?.[plan]?.included_boost_credits ?? 0;
  const boostsLeft = credits.data ?? 0;
  const pct = cap ? Math.min(1, count / cap) : 0;
  const near = plan === 'free' && cap != null && count >= 8;
  const barColor = pct >= 1 ? Colors.error : pct >= 0.8 ? Colors.gold : Colors.primary;

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Pressable style={styles.row} onPress={() => router.push(`/market/${m.id}`)}>
          <Avatar uri={m.avatar_url} name={m.name} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Your Market · {PLAN_LABEL[plan]} plan</Text>
            <Text style={styles.name} numberOfLines={1}>{m.name}</Text>
            <Text style={styles.meta}>
              {count}
              {cap != null ? ` / ${cap}` : ''} active listing{count === 1 ? '' : 's'}
            </Text>
          </View>
          <ChevronRight size={20} color={Colors.textTertiary} />
        </Pressable>

        {cap != null && (
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: barColor }]} />
          </View>
        )}

        {includedBoosts > 0 && (
          <Text style={styles.boosts}>✨ Boosts: {boostsLeft} of {includedBoosts} left this month</Text>
        )}

        <Pressable style={styles.editBtn} onPress={() => router.push(`/market/edit/${m.id}`)}>
          <Text style={styles.editText}>Name your Market</Text>
        </Pressable>
      </View>

      {near && (
        <View style={{ marginTop: 10 }}>
          <UpgradePromptCard plan="free" reason="nudge" />
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
  barTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.backgroundSecondary, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  editBtn: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary + '12',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  editText: { color: Colors.primary, fontSize: 13, fontFamily: fonts.bold },
});
