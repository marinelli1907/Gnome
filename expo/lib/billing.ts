// Mobile $0.99 overage checkout — the thin client half of the trusted server flow.
//
// The client's whole job is: ask billing-checkout for a session, open Stripe's hosted page in an
// auth session, and then RE-ASK THE SERVER whether payment is still owed. The deep-link return is
// a signal to start reconciling, never proof of payment — the only proof is
// my_overage_required() flipping to ALREADY_AUTHORIZED, which happens when the webhook marks the
// authorization paid. Publishing then consumes that authorization exactly once (0104's trigger),
// so a replayed return, a re-opened app, or a double tap cannot buy one publish and take two.
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '@/lib/supabase';
import type { MarketPlan } from '@/types';

export type PlanProductKey = 'GNOME_GROWER_MONTHLY' | 'GNOME_FARM_MONTHLY';
export type PlanCheckoutSession = { url: string; mode: 'test' | 'live'; productKey: PlanProductKey };
export type PlanCheckoutOutcome = 'active' | 'pending' | 'cancelled' | 'error';
export type PlanPromoPreview = {
  mode: 'test' | 'live';
  product_key: PlanProductKey;
  plan: MarketPlan;
  renewal_price_cents: number;
  currency: string;
  checkout_configured: boolean;
  promo: {
    code: string;
    campaign_name: string;
    discount_type: 'percent' | 'amount';
    discount_percent: number | null;
    discount_amount_cents: number | null;
    duration: 'once' | 'repeating' | 'forever';
    duration_in_months: number | null;
    conversion_behavior: 'AUTO_RENEW' | 'NO_AUTO_CONVERSION';
    payment_method_required: boolean;
  };
};

const PLAN_FOR_PRODUCT: Record<PlanProductKey, MarketPlan> = {
  GNOME_GROWER_MONTHLY: 'grower',
  GNOME_FARM_MONTHLY: 'farm',
};
const PLAN_RANK: Record<string, number> = { free: 0, grower: 1, farm: 2, sponsor: 3 };

/** Create a server-owned plan checkout. The server resolves test/live mode,
 * price, customer identity, and Market ownership; the app supplies only an
 * allowlisted product key. */
export async function createPlanCheckout(productKey: PlanProductKey, promoCode?: string): Promise<
  { session?: PlanCheckoutSession; error?: string }
> {
  const { data, error } = await supabase.functions.invoke('billing-checkout', {
    body: { product_key: productKey, platform: 'app', promo_code: promoCode?.trim() || undefined },
  });
  const body = (data ?? {}) as { url?: string; mode?: 'test' | 'live'; error?: string; message?: string };
  if (body.error || error || !body.url || !body.mode) {
    return { error: body.message ?? 'Checkout is unavailable right now. Nothing was charged.' };
  }
  return { session: { url: body.url, mode: body.mode, productKey } };
}

/** Validate and describe a promo without opening checkout. The edge function
 * uses the same private promo_validate RPC as checkout and returns only the
 * customer-facing benefit, authoritative renewal price, and billing mode. */
export async function previewPlanPromo(productKey: PlanProductKey, promoCode: string): Promise<
  { preview?: PlanPromoPreview; error?: string }
> {
  const { data, error } = await supabase.functions.invoke('billing-checkout', {
    body: { action: 'preview_promo', product_key: productKey, promo_code: promoCode.trim(), platform: 'app' },
  });
  const body = (data ?? {}) as PlanPromoPreview & { error?: string; message?: string };
  if (body.error || error || !body.promo) {
    return { error: body.message ?? 'That code could not be applied.' };
  }
  return { preview: body };
}

export async function openStripeSubscriptionPortal(): Promise<{error?:string}> {
  const {data,error}=await supabase.functions.invoke('billing-checkout',{
    body:{action:'portal',product_key:'GNOME_GROWER_MONTHLY',platform:'app'},
  });
  const body=(data??{}) as {url?:string;message?:string};
  if (error || !body.url) return {error:body.message??'Subscription management is unavailable right now.'};
  const result=await WebBrowser.openBrowserAsync(body.url);
  return result.type==='cancel'?{}:{};
}

/** Open Stripe Checkout, then ask Gnome whether the expected plan is active.
 * A success-shaped deep link is only a signal to reconcile, never payment
 * proof. */
export async function finishPlanCheckout(session: PlanCheckoutSession): Promise<PlanCheckoutOutcome> {
  const result = await WebBrowser.openAuthSessionAsync(session.url, 'gnome://checkout');
  if (result.type !== 'success') return 'cancelled';

  const expectedRank = PLAN_RANK[PLAN_FOR_PRODUCT[session.productKey]];
  for (let attempt = 0; attempt < 7; attempt++) {
    const { data, error } = await supabase.rpc('my_plan_entitlements');
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      if (row && (PLAN_RANK[String(row.plan)] ?? -1) >= expectedRank) return 'active';
    }
    await sleep(1500);
  }
  return 'pending';
}

export type OverageRow = {
  required: boolean;
  intent: 'publish' | 'renewal' | null;
  reason: string | null;
  product_key: string | null;
};

export type OverageOutcome =
  | 'paid'         // authorization confirmed — retry the publish/renew now
  | 'not_needed'   // allowance freed up (upgrade, reset) — retry without paying
  | 'pending'      // returned from checkout but webhook not landed yet — retry shortly
  | 'cancelled'    // seller backed out — nothing charged, draft untouched
  | 'error';

/**
 * Pure decision core, split out for tests: given the server's overage answer and whether the
 * browser reported a success-shaped return, what happened?
 */
export function overageOutcome(
  row: OverageRow | null,
  browserReturnedSuccess: boolean,
): OverageOutcome {
  if (!row) return 'error';
  if (!row.required) {
    // ALREADY_AUTHORIZED is the paid signal; any other not-required reason (ALLOWANCE_REMAINING
    // after an upgrade or a period reset, UNLIMITED) means publishing is now free — either way
    // the caller should retry the action, not charge the seller.
    return row.reason === 'ALREADY_AUTHORIZED' ? 'paid' : 'not_needed';
  }
  // Still required: either the seller cancelled, or they paid and the webhook is in flight.
  return browserReturnedSuccess ? 'pending' : 'cancelled';
}

async function fetchOverage(listingId: string | null): Promise<OverageRow | null> {
  const { data, error } = await supabase.rpc('my_overage_required', {
    p_listing: listingId,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as OverageRow | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the full $0.99 purchase round trip for a publish (listingId null) or a renewal (listingId
 * set). Resolves once the outcome is known; 'pending' means the caller should tell the seller
 * their payment is confirming and to retry in a moment — never that they should pay again.
 */
export async function purchaseOverage(listingId: string | null): Promise<OverageOutcome> {
  // The server decides publish-vs-renewal and the price; the key here is only a hint it re-derives.
  const { data, error } = await supabase.functions.invoke('billing-checkout', {
    body: {
      product_key: listingId ? 'GNOME_LISTING_RENEWAL' : 'GNOME_LISTING_PUBLISH',
      listing_id: listingId ?? undefined,
      platform: 'app',
    },
  });

  if (error) {
    // 409 NO_PAYMENT_REQUIRED arrives as an error from functions.invoke; the body says why.
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    if (body?.error === 'NO_PAYMENT_REQUIRED') {
      return body.reason === 'ALREADY_AUTHORIZED' ? 'paid' : 'not_needed';
    }
    return 'error';
  }
  const url = (data as { url?: string } | null)?.url;
  if (!url) return 'error';

  // Stripe's hosted page in an auth session: it closes itself when checkout redirects to the
  // gnome:// return pair billing-checkout configured server-side.
  const result = await WebBrowser.openAuthSessionAsync(url, 'gnome://checkout');
  const returnedSuccess =
    result.type === 'success' && String((result as { url?: string }).url ?? '').includes('checkout-success');

  // Reconcile with the server regardless of what the browser said. A few short polls cover the
  // usual webhook latency; beyond that the state is honestly 'pending'.
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await fetchOverage(listingId);
    const outcome = overageOutcome(row, returnedSuccess);
    if (outcome !== 'pending' && outcome !== 'error') return outcome;
    if (outcome === 'error' && attempt === 4) return 'error';
    await sleep(1500);
  }
  return returnedSuccess ? 'pending' : 'cancelled';
}
