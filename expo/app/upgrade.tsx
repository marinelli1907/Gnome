import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Check, CreditCard, RefreshCw, Settings, TicketPercent } from 'lucide-react-native';
import UpgradePromptCard from '@/components/UpgradePromptCard';
import Colors from '@/constants/colors';
import { fonts } from '@/constants/theme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyListingAllowance, useMyMarket, usePlanLimits } from '@/lib/db';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { listingsMeter, planDisplay, renewalsMeter, resetLabel } from '@/lib/allowance';
import { canBuyDigitalInApp } from '@/lib/digitalPurchase';
import { nativeWebUrl } from '@/lib/links';
import {
  createPlanCheckout, finishPlanCheckout, openStripeSubscriptionPortal, previewPlanPromo,
  type PlanCheckoutSession, type PlanProductKey, type PlanPromoPreview,
} from '@/lib/billing';
import type { MarketPlan, PlanLimit } from '@/types';
import { NATIVE_PRODUCT_FOR_PLAN, useNativeSubscriptions } from '@/lib/nativeSubscriptions';

// Tier copy derives from plan_limits' 0104 columns. `undefined` means the connected environment
// has not applied 0104 yet — degrade to an explicit dash, never to max_active_listings, which is
// the retired model this screen exists to stop describing.
const tierListings = (l?: PlanLimit) =>
  l === undefined || l.monthly_publish_allowance === undefined ? null
    : l.monthly_publish_allowance === null ? 'Unlimited Sell listings'
    : `${l.monthly_publish_allowance} new Sell listings/mo`;
const tierRenewals = (l?: PlanLimit, canBuyExtras = true) =>
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
const tierCaveat = (l?: PlanLimit, canBuyExtras = true) => {
  if (l === undefined || l.included_renewals_per_period === undefined) return null;
  if (l.included_renewals_per_period === null) return 'No listing or renewal overage charges.';
  if (!canBuyExtras) return 'Review higher plans for unlimited Sell listings and renewals, or post again when your allowance resets.';
  if (l.included_renewals_per_period === 0) return 'Review higher plans for renewal access.';
  return `Review higher plans after the first ${l.included_renewals_per_period} renewal${l.included_renewals_per_period === 1 ? '' : 's'}.`;
};

// The three sellable tiers, in ladder order (0126: Free / Pro / Farm). Labels
// come from planDisplay — customer-facing names only; the retired sponsor rung
// ("Legacy Farm", the old $99 tier) is comp-only and deliberately not shown.
const ORDER: MarketPlan[] = ['free', 'grower', 'farm'];
const PRODUCT_FOR_PLAN: Partial<Record<MarketPlan, PlanProductKey>> = {
  grower: 'GNOME_GROWER_MONTHLY',
  farm: 'GNOME_FARM_MONTHLY',
};
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
  const [promoCode, setPromoCode] = useState('');
  const [promoPlan, setPromoPlan] = useState<MarketPlan>(nextPlan ?? 'grower');
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [appliedPromo, setAppliedPromo] = useState<PlanPromoPreview | null>(null);
  const [nativeFounding, setNativeFounding] = useState<'eligible'|'store-confirmed'|null>(null);
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

  const completeCheckout = async (session: PlanCheckoutSession, target: MarketPlan) => {
    setCheckoutPlan(target);
    const outcome = await finishPlanCheckout(session);
    setCheckoutPlan(null);
    if (outcome === 'active') {
      await refreshPlan();
      Alert.alert(`${planDisplay(target)} is active`, 'Your Market benefits and limits have been updated.');
    } else if (outcome === 'pending') {
      Alert.alert('Payment is confirming', 'Stripe received the checkout. Your plan will update as soon as Gnome confirms the payment.');
    } else if (outcome === 'error') {
      Alert.alert('Could not confirm the upgrade', 'Nothing else was charged. Check your plan again in a moment.');
    }
  };

  const beginUpgrade = async (target: MarketPlan) => {
    const productKey = PRODUCT_FOR_PLAN[target];
    if (!productKey || checkoutPlan) return;
    if (usesNativeSubscriptions) {
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
      const nativePromo = target === 'grower' && nativeFounding ? promoCode : undefined;
      await native.purchase(target,nativePromo);
      setCheckoutPlan(null);
      return;
    }
    if (!canBuyDigitalInApp) return;
    setCheckoutPlan(target);
    const promo = appliedPromo?.product_key === productKey ? appliedPromo.promo.code : undefined;
    const result = await createPlanCheckout(productKey, promo);
    setCheckoutPlan(null);
    if (!result.session) {
      Alert.alert('Checkout unavailable', result.error ?? 'Nothing was charged.');
      return;
    }
    if (result.session.mode === 'test') {
      Alert.alert(
        'Test checkout only',
        'Payments are not live. A real card will not be charged. Continuing may temporarily activate a test plan in this environment.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue testing', onPress: () => void completeCheckout(result.session!, target) },
        ],
      );
      return;
    }
    await completeCheckout(result.session, target);
  };

  const applyPromo = async () => {
    const productKey = PRODUCT_FOR_PLAN[promoPlan];
    if (!productKey || !promoCode.trim() || promoBusy) return;
    setPromoBusy(true);
    setPromoError(null);
    setAppliedPromo(null);
    setNativeFounding(null);
    if (usesNativeSubscriptions) {
      if (promoCode.trim().toUpperCase()!=='FOUNDING3') {
        setPromoBusy(false);
        setPromoError('That code is not available through this app store.');
        return;
      }
      if (promoPlan!=='grower') {
        setPromoBusy(false);
        setPromoError('FOUNDING3 applies to Pro. Select Pro to continue.');
        return;
      }
      const eligibility=native.foundingEligibility(promoPlan);
      setPromoBusy(false);
      if (eligibility==='ineligible') {
        setPromoError('Apple says this account is not eligible for the Founding3 trial.');
        return;
      }
      if (eligibility==='unavailable') {
        setPromoError('The store has not returned this plan yet. Try again in a moment.');
        return;
      }
      setPromoCode('FOUNDING3');
      setNativeFounding(eligibility);
      return;
    }
    const result = await previewPlanPromo(productKey, promoCode);
    setPromoBusy(false);
    if (!result.preview) {
      setPromoError(result.error ?? 'That code could not be applied.');
      return;
    }
    setPromoCode(result.preview.promo.code);
    setAppliedPromo(result.preview);
  };

  const promoBenefit = appliedPromo?.promo.discount_type === 'percent'
    ? `${Number(appliedPromo.promo.discount_percent ?? 0)}% off${appliedPromo.promo.duration === 'repeating'
      ? ` for ${appliedPromo.promo.duration_in_months} months`
      : appliedPromo.promo.duration === 'forever' ? ' ongoing' : ' once'}`
    : appliedPromo?.promo.discount_amount_cents != null
      ? `$${(appliedPromo.promo.discount_amount_cents / 100).toFixed(2)} off`
      : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
      <Text style={styles.heading}>Your plan</Text>
      <Text style={styles.sub}>
        {usesNativeSubscriptions
          ? 'Compare seller plans and subscribe securely with Apple. Gnome unlocks a plan only after server verification.'
          : canBuyDigitalInApp
            ? 'Compare seller plans and upgrade securely with Stripe. Your plan changes only after Gnome confirms the subscription.'
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
              {primaryPaid.source==='STRIPE' && Platform.OS !== 'android' ? (
                <Pressable style={styles.manageButton} onPress={()=>void openStripeSubscriptionPortal().then((result)=>{
                  if (result.error) Alert.alert('Could not open subscription management',result.error);
                })}>
                  <Settings size={16} color={Colors.primary}/><Text style={styles.manageButtonText}>Manage website subscription</Text>
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
                {renewalsMeter(row, { canBuyExtras: canBuyDigitalInApp }).lines.map((l) => l.value).join(' · ')}
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

      {canBuyDigitalInApp ? (
        <View style={styles.promoCard}>
          <View style={styles.promoHead}>
            <View style={styles.promoIcon}><TicketPercent size={20} color={Colors.text} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.promoTitle}>Promo code</Text>
              <Text style={styles.promoHint}>Have a code? Apply it before checkout.</Text>
            </View>
          </View>
          <View style={styles.planChoiceRow}>
            {(['grower', 'farm'] as MarketPlan[]).map((choice) => (
              <Pressable key={choice} style={[styles.planChoice, promoPlan === choice && styles.planChoiceActive]}
                onPress={() => {
                  setPromoPlan(choice);
                  setAppliedPromo(null);
                  setNativeFounding(null);
                  setPromoError(null);
                }}>
                <Text style={[styles.planChoiceText, promoPlan === choice && styles.planChoiceTextActive]}>{planDisplay(choice)}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.promoEntry}>
            <TextInput value={promoCode} onChangeText={(value) => {
              setPromoCode(value.toUpperCase());
              setAppliedPromo(null);
              setNativeFounding(null);
              setPromoError(null);
            }}
              placeholder="Enter promo code" placeholderTextColor={Colors.textTertiary} autoCapitalize="characters"
              autoCorrect={false} style={styles.promoInput} />
            <Pressable style={[styles.applyButton, (!promoCode.trim() || promoBusy) && styles.applyButtonDisabled]}
              disabled={!promoCode.trim() || promoBusy} onPress={() => void applyPromo()}>
              {promoBusy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.applyButtonText}>Apply</Text>}
            </Pressable>
          </View>
          {promoError ? <Text style={styles.promoError}>{promoError}</Text> : null}
          {nativeFounding ? (
            <View style={styles.promoResult}>
              <Text style={styles.promoApplied}>FOUNDING3 recognized</Text>
              <Text style={styles.promoResultPlan}>Pro</Text>
              {nativeFounding==='eligible' ? (
                <>
                  <Text style={styles.promoBenefit}>$0 today</Text>
                  <Text style={styles.promoBenefit}>Pro free for 3 months</Text>
                  <Text style={styles.promoRenewal}>Then $9.99/month unless canceled. Apple will show the final offer before you confirm.</Text>
                </>
              ) : (
                <Text style={styles.promoRenewal}>Apple will check introductory-offer eligibility and show the exact trial and renewal terms before you confirm. Gnome will not promise or grant the trial independently.</Text>
              )}
              <Pressable style={styles.promoContinue} onPress={() => void beginUpgrade('grower')} disabled={checkoutPlan !== null}>
                <Text style={styles.promoContinueText}>Continue with Apple</Text>
                <ArrowUpRight size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          ) : null}
          {appliedPromo ? (
            <View style={styles.promoResult}>
              <Text style={styles.promoApplied}>{appliedPromo.promo.code} applied</Text>
              <Text style={styles.promoResultPlan}>{planDisplay(appliedPromo.plan)}</Text>
              <Text style={styles.promoBenefit}>$0 today</Text>
              <Text style={styles.promoBenefit}>{promoBenefit}</Text>
              {appliedPromo.promo.conversion_behavior === 'AUTO_RENEW' ? (
                <Text style={styles.promoRenewal}>
                  Then ${(appliedPromo.renewal_price_cents / 100).toFixed(2)}/month unless canceled.
                  {appliedPromo.promo.payment_method_required ? ' A payment method is required to activate this offer.' : ''}
                </Text>
              ) : (
                <Text style={styles.promoRenewal}>No card required. This offer ends without converting to a paid plan.</Text>
              )}
              {appliedPromo.mode === 'test' ? (
                <View style={styles.testMode}>
                  <Text style={styles.testModeTitle}>Billing test mode</Text>
                  <Text style={styles.testModeText}>This checkout cannot create a live paid subscription.</Text>
                </View>
              ) : null}
              <Pressable style={styles.promoContinue} onPress={() => void beginUpgrade(appliedPromo.plan)} disabled={checkoutPlan !== null}>
                <Text style={styles.promoContinueText}>Continue with offer</Text>
                <ArrowUpRight size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {nextPlan && canBuyDigitalInApp ? (
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
                {tierRenewals(l, canBuyDigitalInApp) ? ` · ${tierRenewals(l, canBuyDigitalInApp)}` : ''}
                {tierWanted(l) ? ` · ${tierWanted(l)}` : ''}
                {tierQr(l) ? ` · ${tierQr(l)}` : ''}
                {l?.max_pickup_locations
                  ? ` · ${l.max_pickup_locations} pickup location${l.max_pickup_locations === 1 ? '' : 's'}`
                  : ''}
                {l?.included_boost_credits ? ` · ${l.included_boost_credits} promotions/mo` : ''}
              </Text>
              {tierCaveat(l, canBuyDigitalInApp) ? <Text style={styles.tierPerk}>{tierCaveat(l, canBuyDigitalInApp)}</Text> : null}
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
            {!current && canBuyDigitalInApp && p !== 'free'
              && (usesNativeSubscriptions || PLAN_RANK[p] > PLAN_RANK[plan]) ? (
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
          : canBuyDigitalInApp
          ? 'Checkout opens securely with Stripe. Gnome confirms the subscription before changing your plan.'
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
  promoCard: { backgroundColor: Colors.goldLight, borderWidth: 1.5, borderColor: Colors.harvestYellow, borderRadius: 8, padding: 14, marginBottom: 14 },
  promoHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  promoIcon: { width: 36, height: 36, borderRadius: 8, backgroundColor: Colors.harvestYellow, alignItems: 'center', justifyContent: 'center' },
  promoTitle: { fontSize: 17, fontFamily: fonts.bold, color: Colors.text },
  promoHint: { fontSize: 12.5, fontFamily: fonts.semibold, color: Colors.textSecondary, marginTop: 1 },
  planChoiceRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  planChoice: { flex: 1, minHeight: 38, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  planChoiceActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '10' },
  planChoiceText: { fontSize: 13, fontFamily: fonts.semibold, color: Colors.textSecondary },
  planChoiceTextActive: { color: Colors.primary },
  promoEntry: { flexDirection: 'row', gap: 8, marginTop: 10 },
  promoInput: { flex: 1, minHeight: 44, borderRadius: 8, borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.surface, paddingHorizontal: 12, color: Colors.text, fontFamily: fonts.semibold, fontSize: 15 },
  applyButton: { minWidth: 76, minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary, paddingHorizontal: 14 },
  applyButtonDisabled: { opacity: 0.45 },
  applyButtonText: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 13 },
  promoError: { color: Colors.error, fontFamily: fonts.semibold, fontSize: 12.5, marginTop: 8 },
  promoResult: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  promoApplied: { color: Colors.primary, fontFamily: fonts.bold, fontSize: 12, textTransform: 'uppercase' },
  promoResultPlan: { color: Colors.text, fontFamily: fonts.bold, fontSize: 18, marginTop: 4 },
  promoBenefit: { color: Colors.text, fontFamily: fonts.semibold, fontSize: 15, marginTop: 2 },
  promoRenewal: { color: Colors.textSecondary, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  testMode: { backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FDBA74', borderRadius: 8, padding: 10, marginTop: 10 },
  testModeTitle: { color: '#9A3412', fontFamily: fonts.bold, fontSize: 12, textTransform: 'uppercase' },
  testModeText: { color: '#9A3412', fontFamily: fonts.regular, fontSize: 12.5, marginTop: 2 },
  promoContinue: { minHeight: 44, borderRadius: 8, backgroundColor: Colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  promoContinueText: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 13.5 },
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
