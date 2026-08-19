// Where Gnome is allowed to sell a DIGITAL entitlement from inside the app.
//
// v1.1 posture (owner decision D1, 2026-08-19): Android ships with NO in-app
// digital purchase UI. The $0.99 extra Sell listing is not removed, not
// redirected to Stripe, and not replaced with a link out — the product and the
// whole server-side machinery behind it stay exactly as they are and remain
// proven. Android simply does not offer the purchase yet. Native Google Play
// Billing is the v1.2 target, and when it lands this gate is what flips.
//
// Why a gate rather than deleting the call sites: Google's Payments policy
// requires Play Billing for digital functionality bought inside an Android app,
// and a link-out to Stripe would be the same violation wearing a coat. iOS is
// unaffected — it has always used the same Stripe checkout and Apple's
// multiplatform rules are a separate question tracked in the release board.
// Deleting the surfaces would mean rebuilding them for v1.2; gating them means
// changing one boolean.
//
// The seller is never left at a dead end: every call site that would have
// offered "$0.99" offers the plan comparison instead, which is honest (Pro
// genuinely removes the limit) and costs nothing today because payments are
// still TEST-gated and no live price exists on any platform.
import { Platform } from 'react-native';

/**
 * May this platform present an in-app purchase for a digital entitlement
 * (the $0.99 extra Sell listing, promotions, plan upgrades)?
 *
 * Android: false until Play Billing ships (v1.2).
 * iOS / web: unchanged.
 */
export const canBuyDigitalInApp = Platform.OS !== 'android';

/** Copy for the moment a seller hits the allowance wall on a platform that
 *  cannot yet sell them the extra listing. Kept here so post, ai and listing
 *  detail cannot drift apart on the explanation. */
export const OVERAGE_UNAVAILABLE_TITLE = 'Included listings used up';
export const OVERAGE_UNAVAILABLE_BODY =
  'You’ve used your included Sell listings for this period. Your draft is saved right here either way — upgrade for unlimited Sell listings, or post again when your allowance resets.';
