import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Avatar } from '@/components/ui';
import UpgradePromptCard from '@/components/UpgradePromptCard';
import Colors from '@/constants/colors';
import { useMarketListings, useMyMarket, usePlanLimits } from '@/lib/db';
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

  if (!market.data) return null;

  const m = market.data;
  const plan: MarketPlan = (m.plan as MarketPlan) ?? 'free';
  const count = listings.data?.length ?? 0;
  const cap = limits.data?.[plan]?.max_active_listings ?? null;
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

        <Pressable style={styles.editBtn} onPress={() => router.push(`/market/edit/${m.id}`)}>
          <Text style={styles.editText}>Name your garden</Text>
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
  label: { fontSize: 11, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  name: { fontSize: 17, fontWeight: '800', color: Colors.text, marginTop: 1 },
  meta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.backgroundSecondary, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  editBtn: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary + '12',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  editText: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
});
