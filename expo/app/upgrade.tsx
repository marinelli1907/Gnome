import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Check, CreditCard, RefreshCw, Settings } from 'lucide-react-native';
import UpgradePromptCard from '@/components/UpgradePromptCard';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyListingAllowance, useMyMarket, usePlanLimits } from '@/lib/db';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { listingsMeter, planDisplay, renewalsMeter, resetLabel } from '@/lib/allowance';
import { nativeWebUrl } from '@/lib/links';
import type { MarketPlan, PlanLimit } from '@/types';
import { NATIVE_PRODUCT_FOR_PLAN, useNativeSubscriptions } from '@/lib/nativeSubscriptions';

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
    : l.included_renewals_per_period === 0
      ? 'renewals require a higher plan'
    : `${l.included_renewals_per_period} free renewals/mo`;
// Wanted is not part of the launch UX, so plan cards must not advertise a
// Wanted-response allowance (D5: never claim a feature that does not ship).
// The plan_limits column and this helper are left intact — returning null just
// drops the line from every tier — so restoring it later is a one-line change.
const tierWanted = (_l?: PlanLimit) => null;
const tierQr = (l?: PlanLimit) =>
  l === undefined || l.qr_tools === undefined ? null
    : l.qr_tools ? 'Custom Market QR tools' : 'Market link included · QR tools locked';
const tierCaveat = (l?: PlanLimit) => {
  if (l === undefined || l.included_renewals_per_period === undefined) return null;
  if (l.included_renewals_per_period === null) return 'No listing or renewal overage charges.';
  if (l.included_renewals_per_period === 0) return 'Review higher plans for renewal access.';
  return `Review higher plans after the first ${l.included_renewals_per_period} renewal${l.included_renewals_per_period === 1 ? '' : 's'}.`;
};

// The three sellable tiers, in ladder order (0126: Free / Pro / Farm). Labels
// come from planDisplay — customer-facing names only; the retired sponsor rung
// ("Legacy Farm", the old $99 tier) is comp-only and deliberately not shown.
const ORDER: MarketPlan[] = ['free', 'grower', 'farm'];
const PLAN_RANK: Record<MarketPlan, number> = { free: 0, grower: 1, farm: 2, sponsor: 3 };

/** Resolved entitlements: plan + subscription + purchased add-ons, from the
 *  backend's single source (my_plan_entitlements, 0064). */
interface Entitlements {
  market_id: string;
  plan: MarketPlan;
  entitlement_source: 'free' | 'APPLE' | 'GOOGLE_PLAY' | 'STRIPE' | 'stripe' | 'complimentary' | 'sponsor' | 'legacy';
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

interface SubscriptionSummary {
  effective_plan: MarketPlan;
  effective_source: string;
  grant_expires_at: string | null;
  duplicate_paid_sources: boolean;
  paid_subscriptions: {
    plan: MarketPlan;
    source: 'APPLE'|'GOOGLE_PLAY'|'STRIPE';
    status: string;
    product_id: string | null;
    renews_at: string | null;
    expires_at: string | null;
    cancel_at_period_end: boolean;
    last_verified_at: string | null;
    environment: string | null;
  }[];
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

function useSubscriptionSummary(uid?:string) {
  return useQuery({
    queryKey:['subscription-summary',uid],enabled:isSupabaseConfigured && !!uid,
    queryFn:async():Promise<SubscriptionSummary|null> => {
      const {data,error}=await supabase.rpc('my_subscription_summary');
      if (error) throw error;
      return (data??null) as SubscriptionSummary|null;
    },
  });
}

export default function UpgradeScreen() {
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const market = useMyMarket(userId ?? undefined);
  const limits = usePlanLimits();
  const ent = useEntitlements(userId ?? undefined);
  const subscriptions = useSubscriptionSummary(userId ?? undefined);
  const allowance = useMyListingAllowance(userId ?? undefined);
  const plan: MarketPlan = (ent.data?.plan as MarketPlan) ?? (market.data?.plan as MarketPlan) ?? 'free';
  const row = allowance.data ?? null;
  const [checkoutPlan, setCheckoutPlan] = useState<MarketPlan | null>(null);
  const nextPlan: MarketPlan | null = plan === 'free' ? 'grower' : plan === 'grower' ? 'farm' : null;
  const usesNativeSubscriptions = Platform.OS === 'ios';
  const refreshPlan=useCallback(async()=>{
    await Promise.all([ent.refetch(),subscriptions.refetch(),allowance.refetch(),market.refetch()]);
  },[allowance,ent,market,subscriptions]);
  const native=useNativeSubscriptions(userId??undefined,refreshPlan,usesNativeSubscriptions);
  const primaryPaid=subscriptions.data?.paid_subscriptions[0]??null;
  const billingLabel=primaryPaid?.source==='APPLE'?'Apple':primaryPaid?.source==='GOOGLE_PLAY'?'Google Play':primaryPaid?.source==='STRIPE'?'Gnome website':null;
  const displayedPlanPrice=(target:MarketPlan) => {
    const productId=target==='grower'||target==='farm' ? NATIVE_PRODUCT_FOR_PLAN[target] : null;
    const storePrice=productId ? native.products[productId]?.displayPrice : null;
    const fallback=limits.data?.[target]?.price_cents;
    return storePrice ?? (fallback != null ? `$${(fallback/100).toFixed(2)}` : null);
  };

  useEffect(()=>{
    if (!native.state.message) return;
    Alert.alert(native.state.kind==='active'?'Subscription active':native.state.kind==='pending'?'Payment pending':'Subscription',native.state.message);
  },[native.state.kind,native.state.message]);

  const beginUpgrade = async (target: MarketPlan) => {
    if (!usesNativeSubscriptions || checkoutPlan || (target !== 'grower' && target !== 'farm')) return;
    const currentProvider='APPLE';
    const other=subscriptions.data?.paid_subscriptions.find((sub)=>
      ['active','trialing','grace_period','canceled','cancelled'].includes(sub.status)
      && sub.source!==currentProvider && (!sub.expires_at || Date.parse(sub.expires_at)>Date.now()));
    if (other) {
      Alert.alert(
        'You already have a paid plan',
        `Your ${planDisplay(other.plan)} subscription is billed through ${other.source==='STRIPE'?'the Gnome website':other.source==='APPLE'?'Apple':'Google Play'}. Manage that subscription instead of paying twice.`,
      );
      return;
    }
    setCheckoutPlan(target);
    await native.purchase(target);
    setCheckoutPlan(null);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
      <Text style={styles.heading}>Your plan</Text>
      <Text style={styles.sub}>
        {usesNativeSubscriptions
          ? 'Compare seller plans and subscribe securely with Apple. Gnome unlocks a plan only after server verification.'
          : 'Compare seller plans and benefits. Digital plan checkout is not available in the Android app, while existing paid or complimentary access still works here.'}
        {' '}All Sell listings run for 7 days; Share Free, Trade and Plot posts never touch your Sell allowance.
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
          {billingLabel && primaryPaid ? (
            <>
              <Text style={styles.entLine}>Billing: {billingLabel}</Text>
              <Text style={styles.entLine}>
                {primaryPaid.cancel_at_period_end?'Access through':'Renews'}: {new Date(primaryPaid.expires_at??primaryPaid.renews_at??Date.now()).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
              </Text>
              {subscriptions.data?.duplicate_paid_sources ? (
                <Text style={styles.duplicateWarning}>You have paid subscriptions through more than one provider. Manage each one to avoid duplicate charges.</Text>
              ) : null}
              {usesNativeSubscriptions && primaryPaid.source==='APPLE' ? (
                <Pressable style={styles.manageButton} onPress={()=>void native.manage(primaryPaid.product_id??undefined)}>
                  <Settings size={16} color={Colors.primary}/><Text style={styles.manageButtonText}>Manage subscription</Text>
                </Pressable>
              ) : null}
            </>
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
              Additional pickup locations are not available in the app.
            </Text>
          ) : null}
        </View>
      ) : null}

      {nextPlan && usesNativeSubscriptions ? (
        <View style={styles.upgradeCard}>
          <View style={styles.upgradeIcon}><CreditCard size={20} color={Colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.upgradeTitle}>Upgrade your Market</Text>
            <Text style={styles.upgradeBody}>
              Move to {planDisplay(nextPlan)} for {displayedPlanPrice(nextPlan) != null
                ? `${displayedPlanPrice(nextPlan)}/month`
                : 'the next level of seller tools'}.
            </Text>
          </View>
          <Pressable style={styles.upgradeButton} onPress={() => void beginUpgrade(nextPlan)}
            disabled={checkoutPlan !== null} accessibilityRole="button"
            accessibilityLabel={`Upgrade to ${planDisplay(nextPlan)}`}>
            {checkoutPlan === nextPlan
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <><Text style={styles.upgradeButtonText}>Upgrade</Text><ArrowUpRight size={16} color="#FFFFFF" /></>}
          </Pressable>
        </View>
      ) : null}

      {/* The banner makes a claim about the seller's own allowance, so it only
          renders when the claim is true: "limit" at 0 remaining, "nudge" at 1.
          It used to render unconditionally with reason="limit" — a fresh Free
          account saw "You've used this period's included listings" while the
          meter two cards up said 0 of 3 used. With allowance to spare (or an
          unlimited plan, remaining === null) the tier cards below are the
          pitch, and no card states something false about the account. */}
      {row && row.publishes_remaining !== null && row.publishes_remaining <= 1 ? (
        <UpgradePromptCard
          plan={plan}
          reason={row.publishes_remaining === 0 ? 'limit' : 'nudge'}
        />
      ) : null}

      <View style={{ height: 18 }} />
      {ORDER.map((p) => {
        const l = limits.data?.[p];
        const current = p === plan;
        const paidPrice=p==='grower'||p==='farm' ? displayedPlanPrice(p) : null;
        return (
          <View key={p} style={[styles.tier, current && styles.tierCurrent]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.tierName}>
                {planDisplay(p)} {current ? '· current' : ''}
              </Text>
              {paidPrice ? <Text style={styles.tierPrice}>{paidPrice} per month</Text> : null}
              <Text style={styles.tierMeta}>
                {tierListings(l) ?? '—'}
                {tierRenewals(l) ? ` · ${tierRenewals(l)}` : ''}
                {tierWanted(l) ? ` · ${tierWanted(l)}` : ''}
                {tierQr(l) ? ` · ${tierQr(l)}` : ''}
                {l?.max_pickup_locations
                  ? ` · ${l.max_pickup_locations} pickup location${l.max_pickup_locations === 1 ? '' : 's'}`
                  : ''}
                {l?.included_boost_credits ? ` · ${l.included_boost_credits} promotions/mo` : ''}
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
            {current ? <Check size={20} color={Colors.primary} /> : null}
            {!current && usesNativeSubscriptions && p !== 'free' ? (
              <Pressable style={styles.tierUpgrade} onPress={() => void beginUpgrade(p)}
                disabled={checkoutPlan !== null} accessibilityRole="button"
                accessibilityLabel={`${PLAN_RANK[p] > PLAN_RANK[plan] ? 'Upgrade' : 'Change'} to ${planDisplay(p)}`}>
                {checkoutPlan === p
                  ? <ActivityIndicator size="small" color={Colors.primary} />
                  : <><Text style={styles.tierActionText}>{PLAN_RANK[p] > PLAN_RANK[plan] ? 'Upgrade' : 'Change'}</Text><ArrowUpRight size={18} color={Colors.primary} /></>}
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <Text style={styles.tierPerk}>
        {usesNativeSubscriptions
          ? 'Checkout stays inside Apple. Gnome confirms the store transaction on the server before changing your plan.'
          : 'Digital plan checkout is not available in the Android app. Your existing paid or complimentary access still works here.'}
      </Text>
      {usesNativeSubscriptions ? (
        <>
          <Pressable style={styles.restoreButton} onPress={()=>void native.restore()} disabled={native.state.kind==='restoring'}>
            {native.state.kind==='restoring'
              ? <ActivityIndicator size="small" color={Colors.primary}/>
              : <RefreshCw size={17} color={Colors.primary}/>}
            <Text style={styles.restoreButtonText}>Restore purchases</Text>
          </Pressable>
          <View style={styles.subscriptionLegal} accessibilityRole="text">
            <Pressable onPress={()=>void Linking.openURL(nativeWebUrl('/terms'))} accessibilityRole="link" accessibilityLabel="Open Terms of Use">
              <Text style={styles.subscriptionLegalLink}>Terms of Use</Text>
            </Pressable>
            <Text style={styles.subscriptionLegalSeparator}>·</Text>
            <Pressable onPress={()=>void Linking.openURL(nativeWebUrl('/privacy'))} accessibilityRole="link" accessibilityLabel="Open Privacy Policy">
              <Text style={styles.subscriptionLegalLink}>Privacy Policy</Text>
            </Pressable>
          </View>
        </>
      ) : null}
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
  duplicateWarning: { fontSize: 12.5, lineHeight: 18, fontFamily: fonts.semibold, color: Colors.error, marginTop: 8 },
  manageButton: { minHeight: 40, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 8, borderWidth: 1, borderColor: Colors.primary },
  manageButtonText: { fontSize: 13, fontFamily: fonts.bold, color: Colors.primary },
  upgradeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.primary + '0D',
    borderWidth: 1.5, borderColor: Colors.primary, borderRadius: 8, padding: 14, marginBottom: 14,
  },
  upgradeIcon: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface },
  upgradeTitle: { fontSize: 15, fontFamily: fonts.bold, color: Colors.text },
  upgradeBody: { fontSize: 12.5, lineHeight: 17, fontFamily: fonts.regular, color: Colors.textSecondary, marginTop: 2 },
  upgradeButton: { minWidth: 86, minHeight: 42, borderRadius: 8, paddingHorizontal: 13, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary },
  upgradeButtonText: { fontSize: 13, fontFamily: fonts.bold, color: '#FFFFFF' },
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
  tierUpgrade: { minWidth: 86, height: 40, paddingHorizontal: 10, gap: 4, flexDirection: 'row', borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '12' },
  tierActionText: { color: Colors.primary, fontFamily: fonts.semibold, fontSize: 13 },
  tierName: { fontSize: 16, color: Colors.text, fontFamily: fonts.bold },
  tierPrice: { fontSize: 15, lineHeight: 20, color: Colors.text, marginTop: 3, fontFamily: fonts.semibold },
  tierMeta: { fontSize: 13, color: Colors.textSecondary, marginTop: 2, fontFamily: fonts.regular },
  tierPerk: { fontSize: 12.5, color: Colors.textTertiary, marginTop: 3, fontFamily: fonts.regular },
  restoreButton: { minHeight: 44, marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 8, borderWidth: 1, borderColor: Colors.primary },
  restoreButtonText: { fontSize: 13.5, fontFamily: fonts.bold, color: Colors.primary },
  subscriptionLegal: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  subscriptionLegalLink: { fontSize: 12.5, lineHeight: 18, fontFamily: fonts.semibold, color: Colors.primary, textDecorationLine: 'underline' },
  subscriptionLegalSeparator: { fontSize: 12.5, color: Colors.textTertiary },
});
