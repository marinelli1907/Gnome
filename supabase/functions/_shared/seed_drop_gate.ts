// Gnome — the Seed Drop "Coming Soon" gate, in one place.
//
// The Seed Drop ships as an announcement only: no price, no date, no purchase,
// no charge. The compliance foundation it depends on (migration 0089) is
// deliberately unapplied, and no live Stripe price exists for any seed key.
// Until the owner reverses that deliberately, every payment surface must refuse
// seed keys outright rather than merely lack a button.
//
// WHY billing-checkout INLINES this instead of importing it: billing-checkout
// is deployed as a single index.ts file (verified 2026-08-13 against the
// deployed artifact, version 3, which contains exactly one file). An import
// that failed to resolve at deploy time would take marketplace checkout down
// with it. The inline copy is authoritative for that function; the regression
// suite (supabase/tests/run_seed_drop_off_tests.sh) fails if the two ever
// disagree, so drift is caught mechanically rather than by review.
//
// New payment surfaces should import this module.

// Deny-by-default: only these four keys may reach Stripe. A renamed or newly
// added seed key therefore opens nothing by accident — it has to be added here
// on purpose. Reactivating a billing_products row does not open a path either.
export const CHECKOUT_ALLOWED_KEYS: readonly string[] = [
  'GNOME_GROWER_MONTHLY',
  'GNOME_FARM_MONTHLY',
  'GNOME_LISTING_PROMOTION',
  'GNOME_PICKUP_LOCATION_ADDON',
];

// Named so a refusal can say WHY rather than "unknown product". Covers every
// seed key that exists in billing_products today.
export const SEED_DROP_KEYS: readonly string[] = [
  'GNOME_SEED_DROP_SEASONAL',
  'GNOME_SEED_DROP_ONE_TIME',
  'GNOME_SEED_DROP_SUBSCRIPTION',
  'GNOME_GROWER_SEED_BUNDLE',
  'GNOME_FARM_SEED_BUNDLE',
];

// Flip to false only together with: 0089 applied, a live price configured, and
// the state/supplier clearances the compliance memos require.
export const SEED_DROP_COMING_SOON = true;

// Matched on the upper-cased key and on a SEED substring, so casing, padding,
// and any future GNOME_*_SEED_* key all land on the explicit refusal instead
// of falling through to a generic error.
export const isSeedDropKey = (key: string): boolean => {
  const k = String(key ?? '').trim().toUpperCase();
  return SEED_DROP_KEYS.includes(k) || k.includes('SEED');
};

export const SEED_DROP_COMING_SOON_MESSAGE =
  'The Gnome Seed Drop is Coming Soon. It cannot be purchased yet — no price, no date, no checkout. Nothing has been charged.';
