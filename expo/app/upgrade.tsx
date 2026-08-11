import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import UpgradePromptCard from '@/components/UpgradePromptCard';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyMarket, usePlanLimits } from '@/lib/db';
import { formatPrice } from '@/lib/listingType';
import type { MarketPlan } from '@/types';

const ORDER: MarketPlan[] = ['free', 'grower', 'farm'];
const PLAN_LABEL: Record<string, string> = { free: 'Free', grower: 'Grower', farm: 'Farm', sponsor: 'Sponsor' };

export default function UpgradeScreen() {
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const market = useMyMarket(userId ?? undefined);
  const limits = usePlanLimits();
  const plan: MarketPlan = (market.data?.plan as MarketPlan) ?? 'free';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
      <Text style={styles.heading}>Grow your Market</Text>
      <Text style={styles.sub}>
        More active listings and tools as you grow. Nothing to pay today — paid plans arrive soon.
      </Text>

      <UpgradePromptCard plan={plan} reason="limit" />

      <View style={{ height: 18 }} />
      {ORDER.map((p) => {
        const l = limits.data?.[p];
        const current = p === plan;
        return (
          <View key={p} style={[styles.tier, current && styles.tierCurrent]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.tierName}>
                {PLAN_LABEL[p]} {current ? '· current' : ''}
              </Text>
              <Text style={styles.tierMeta}>
                {l
                  ? `${l.max_active_listings == null ? 'Unlimited' : l.max_active_listings} active listings`
                  : '—'}
                {l?.max_pickup_locations
                  ? ` · ${l.max_pickup_locations} pickup location${l.max_pickup_locations === 1 ? '' : 's'}${l.extra_location_fee_cents ? ' +' : ''}`
                  : ''}
                {l && l.price_cents > 0 ? ` · ${formatPrice(l.price_cents)}/mo` : ' · free'}
              </Text>
            </View>
            {current && <Check size={20} color={Colors.primary} />}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, paddingTop: 16 },
  heading: { fontSize: 25, fontFamily: 'Fraunces_700Bold', color: Colors.text },
  sub: { fontSize: 14, color: Colors.textSecondary, marginTop: 6, marginBottom: 18, lineHeight: 20, fontFamily: fonts.regular },
  tier: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  tierCurrent: { borderColor: Colors.primary, backgroundColor: Colors.primary + '0A' },
  tierName: { fontSize: 16, color: Colors.text, fontFamily: fonts.bold },
  tierMeta: { fontSize: 13, color: Colors.textSecondary, marginTop: 2, fontFamily: fonts.regular },
});
