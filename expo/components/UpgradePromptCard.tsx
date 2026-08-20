import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { logEvent, usePlanLimits } from '@/lib/db';
import { planDisplay } from '@/lib/allowance';
import type { MarketPlan } from '@/types';

const NEXT: Record<string, MarketPlan | null> = {
  free: 'grower',
  grower: 'farm',
  farm: null,
  sponsor: null,
};
// Customer-facing names only; the internal enum stays internal.

export default function UpgradePromptCard({
  plan,
  reason,
}: {
  plan: MarketPlan;
  reason: 'nudge' | 'limit';
}) {
  const router = useRouter();
  const { userId } = useAuth();
  const limits = usePlanLimits();
  const next = NEXT[plan] ?? null;

  useEffect(() => {
    void logEvent('upgrade_prompt_viewed', { userId: userId ?? null, metadata: { plan, reason } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!next) return null;

  const nextLimit = limits.data?.[next];
  // 0104 columns; undefined until the migrations apply, in which case the pitch omits numbers
  // rather than falling back to the retired active-listing cap.
  const monthly = nextLimit?.monthly_publish_allowance;
  const renewals = nextLimit?.included_renewals_per_period;

  const onUpgrade = () => {
    void logEvent('upgrade_prompt_tapped', { userId: userId ?? null, metadata: { plan, next, reason } });
    router.push('/upgrade');
  };

  return (
    <Pressable style={[styles.card, reason === 'limit' && styles.cardLimit]} onPress={onUpgrade}>
      <View style={styles.iconWrap}>
        <Sparkles size={18} color={Colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>
          {reason === 'limit'
            ? 'You’ve used this period’s included listings'
            : 'You’re close to this period’s included listings'}
        </Text>
        <Text style={styles.body}>
          See what changes with{' '}
          {planDisplay(next)}
          {monthly === null ? ' for unlimited Sell listings'
            : monthly != null ? ` for ${monthly} new Sell listings a month` : ''}
          {renewals === null ? ' and unlimited renewals'
            : renewals != null && renewals > 0 ? ` and ${renewals} free renewals` : ''}
          . Plans are not sold in the app.
        </Text>
      </View>
      <View style={styles.cta}>
        <Text style={styles.ctaText}>See plans</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.gold + '22',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.gold,
  },
  cardLimit: { backgroundColor: Colors.accent + '14', borderColor: Colors.accent },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 15, color: Colors.text, fontFamily: fonts.bold },
  body: { fontSize: 13, color: Colors.textSecondary, marginTop: 2, lineHeight: 18, fontFamily: fonts.regular },
  cta: { backgroundColor: Colors.primary, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  ctaText: { color: Colors.textInverse, fontSize: 13, fontFamily: fonts.bold },
});
