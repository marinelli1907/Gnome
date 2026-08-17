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
