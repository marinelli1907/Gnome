import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react-native';
import UpgradePromptCard from '@/components/UpgradePromptCard';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyMarket, usePlanLimits } from '@/lib/db';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { formatPrice } from '@/lib/listingType';
import { listingsMeter, planDisplay, renewalsMeter, resetLabel } from '@/lib/allowance';
import { useMyListingAllowance } from '@/lib/db';
import type { MarketPlan, PlanLimit } from '@/types';

// Tier copy derives from plan_limits' 0104 columns. `undefined` means the connected environment
// has not applied 0104 yet — degrade to an explicit dash, never to max_active_listings, which is
// the retired model this screen exists to stop describing.
const tierListings = (l?: PlanLimit) =>
  l === undefined || l.monthly_publish_allowance === undefined ? null
    : l.monthly_publish_allowance === null ? 'Unlimited Sell listings'
    : `${l.monthly_publish_allowance} new Sell listings/mo`;
const tierRenewals = (l?: PlanLimit) =>
  l === undefined || l.included_renewals_per_period === undefined ? null
    : l.included_renewals_per_period === null ? 'unlimited renewals'
    : l.included_renewals_per_period === 0 ? 'renewals $0.99 each'
    : `${l.included_renewals_per_period} free renewals/mo`;
const tierWanted = (l?: PlanLimit) =>
  l === undefined || l.wanted_intros_per_day === undefined ? null
    : l.wanted_intros_per_day === null ? 'Unlimited Wanted responses'
    : `${l.wanted_intros_per_day} Wanted response${l.wanted_intros_per_day === 1 ? '' : 's'}/day`;
const tierQr = (l?: PlanLimit) =>
  l === undefined || l.qr_tools === undefined ? null
    : l.qr_tools ? 'Custom Market QR tools' : 'Market link included · QR tools locked';
const tierCaveat = (l?: PlanLimit) => {
  if (l === undefined || l.included_renewals_per_period === undefined) return null;
  if (l.included_renewals_per_period === null) return 'No listing or renewal overage charges.';
  if (l.included_renewals_per_period === 0) return 'Extra Sell listings and renewals: $0.99 each.';
  return `Extra Sell listings $0.99 · renewals after the first ${l.included_renewals_per_period}: $0.99.`;
};

// All four sellable tiers, in ladder order. Labels come from planDisplay — customer-facing names
// only, and the mapping is deliberately counter-intuitive (farm→Max, sponsor→Farm), which is
// exactly why no screen may interpolate the enum.
const ORDER: MarketPlan[] = ['free', 'grower', 'farm', 'sponsor'];

/** Resolved entitlements: plan + subscription + purchased add-ons, from the
 *  backend's single source (my_plan_entitlements, 0064). */
interface Entitlements {
  market_id: string;
  plan: MarketPlan;
  entitlement_source: 'free' | 'stripe' | 'complimentary' | 'sponsor';
  grant_expires_at: string | null;
  grant_reason: string | null;
  plan_price_cents: number;
  subscription_status: string | null;
  active_listings: number;
  max_pickup_locations: number;
  extra_location_fee_cents: number | null;
  extra_pickup_locations: number;
  effective_pickup_locations: number;
  delivery_advanced: boolean;
}

function useEntitlements(uid?: string) {
  return useQuery({
    queryKey: ['entitlements', uid],
    enabled: isSupabaseConfigured && !!uid,
    queryFn: async (): Promise<Entitlements | null> => {
      const { data, error } = await supabase.rpc('my_plan_entitlements');
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as Entitlements | null;
    },
  });
}

export default function UpgradeScreen() {
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const market = useMyMarket(userId ?? undefined);
  const limits = usePlanLimits();
  const ent = useEntitlements(userId ?? undefined);
  const allowance = useMyListingAllowance(userId ?? undefined);
  const plan: MarketPlan = (ent.data?.plan as MarketPlan) ?? (market.data?.plan as MarketPlan) ?? 'free';
  const row = allowance.data ?? null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
      <Text style={styles.heading}>Grow your Market</Text>
      <Text style={styles.sub}>
        More monthly Sell listings, free renewals, pickup locations and delivery tools as you grow —
        every number below comes straight from the plan the platform enforces. All Sell listings run
        for 7 days; Share Free, Trade and Wanted posts never touch your Sell allowance.
      </Text>

      {/* Your resolved entitlements — the same numbers the backend enforces. */}
      {ent.data ? (
        <View style={styles.entCard}>
          <Text style={styles.entTitle}>
            Your plan: {row?.display_name ?? planDisplay(ent.data.plan)}
          </Text>
          {ent.data.entitlement_source === 'complimentary' ? (
            <Text style={styles.entLine}>
              Complimentary access
              {ent.data.grant_expires_at
                ? ` · valid through ${new Date(ent.data.grant_expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                : ' · no expiration'}
              {ent.data.grant_reason ? ` · ${ent.data.grant_reason}` : ''}
            </Text>
          ) : null}
          {allowance.isError && (
            <Text style={styles.entLine}>Couldn’t load your listing usage right now.</Text>
          )}
          {row && (
            <>
              <Text style={styles.entLine}>
                {listingsMeter(row).lines.map((l) => l.value).join(' · ')}
              </Text>
              <Text style={styles.entLine}>
                {renewalsMeter(row).lines.map((l) => l.value).join(' · ')}
              </Text>
              <Text style={styles.entHint}>{resetLabel(row)}</Text>
            </>
          )}
          <Text style={styles.entLine}>
            {ent.data.max_pickup_locations} pickup location{ent.data.max_pickup_locations === 1 ? '' : 's'} included
            {ent.data.extra_pickup_locations > 0 ? ` + ${ent.data.extra_pickup_locations} add-on` : ''}
            {' · '}{ent.data.effective_pickup_locations} allowed
          </Text>
          {ent.data.extra_location_fee_cents != null ? (
            <Text style={styles.entHint}>
              Additional locations {formatPrice(ent.data.extra_location_fee_cents)}/mo each — billing setup coming soon.
            </Text>
          ) : null}
        </View>
      ) : null}

      <UpgradePromptCard plan={plan} reason="limit" />

      <View style={{ height: 18 }} />
      {ORDER.map((p) => {
        const l = limits.data?.[p];
        const current = p === plan;
        return (
          <View key={p} style={[styles.tier, current && styles.tierCurrent]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.tierName}>
                {planDisplay(p)} {current ? '· current' : ''}
              </Text>
              <Text style={styles.tierMeta}>
                {tierListings(l) ?? '—'}
                {tierRenewals(l) ? ` · ${tierRenewals(l)}` : ''}
                {tierWanted(l) ? ` · ${tierWanted(l)}` : ''}
                {tierQr(l) ? ` · ${tierQr(l)}` : ''}
                {l?.max_pickup_locations
                  ? ` · ${l.max_pickup_locations} pickup location${l.max_pickup_locations === 1 ? '' : 's'}${l.extra_location_fee_cents ? ` (+${formatPrice(l.extra_location_fee_cents)}/mo each extra)` : ''}`
                  : ''}
                {l?.included_boost_credits ? ` · ${l.included_boost_credits} promotions/mo` : ''}
                {l && l.price_cents > 0 ? ` · ${formatPrice(l.price_cents)}/mo` : ' · free'}
              </Text>
              {tierCaveat(l) ? <Text style={styles.tierPerk}>{tierCaveat(l)}</Text> : null}
              {p !== 'free' && (
                <Text style={styles.tierPerk}>
                  AI Listing Assistant · delivery your way — distance fees, same-day & next-day cutoffs, weekly schedules
                </Text>
              )}
              {p === 'free' && (
                <Text style={styles.tierPerk}>Local delivery up to 15 miles, one flat fee</Text>
              )}
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
  entCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 14,
    borderWidth: 1.5, borderColor: Colors.primary,
  },
  entTitle: { fontSize: 16, fontFamily: fonts.bold, color: Colors.text },
  entLine: { fontSize: 14, fontFamily: fonts.semibold, color: Colors.textSecondary, marginTop: 4 },
  entHint: { fontSize: 12.5, fontFamily: fonts.regular, color: Colors.textTertiary, marginTop: 6 },
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
  tierPerk: { fontSize: 12.5, color: Colors.textTertiary, marginTop: 3, fontFamily: fonts.regular },
});
