import React, { useEffect } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { logEvent, usePlanLimits } from '@/lib/db';
import { formatPrice } from '@/lib/listingType';
import type { MarketPlan } from '@/types';

const NEXT: Record<string, MarketPlan | null> = {
  free: 'grower',
  grower: 'farm',
  farm: 'sponsor',
  sponsor: null,
};
const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  grower: 'Grower',
  farm: 'Farm',
  sponsor: 'Sponsor',
};

export default function UpgradePromptCard({
  plan,
  reason,
}: {
  plan: MarketPlan;
  reason: 'nudge' | 'limit';
}) {
  const { userId } = useAuth();
  const limits = usePlanLimits();
  const next = NEXT[plan] ?? null;

  useEffect(() => {
    void logEvent('upgrade_prompt_viewed', { userId: userId ?? null, metadata: { plan, reason } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!next) return null;

  const nextLimit = limits.data?.[next];
  const price = nextLimit ? formatPrice(nextLimit.price_cents) : '';
  const maxListings = nextLimit?.max_active_listings;

  const onUpgrade = () => {
    void logEvent('upgrade_prompt_tapped', { userId: userId ?? null, metadata: { plan, next, reason } });
    Alert.alert(
      'Coming soon',
      `${PLAN_LABEL[next]} plans arrive soon — we’ll let you know the moment you can upgrade.`,
    );
  };

  return (
    <Pressable style={[styles.card, reason === 'limit' && styles.cardLimit]} onPress={onUpgrade}>
      <View style={styles.iconWrap}>
        <Sparkles size={18} color={Colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>
          {reason === 'limit' ? 'You’ve hit your Free limit' : 'You’re close to your Free limit'}
        </Text>
        <Text style={styles.body}>
          Upgrade to {PLAN_LABEL[next]}
          {maxListings != null ? ` for ${maxListings} active listings` : ''}
          {price ? ` — ${price}/mo` : ''}.
        </Text>
      </View>
      <View style={styles.cta}>
        <Text style={styles.ctaText}>Upgrade</Text>
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
