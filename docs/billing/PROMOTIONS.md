# Listing Promotions

Product: **Featured Listing Promotion** — 7 days, $3.99 retail
(`billing_products.GNOME_LISTING_PROMOTION`), or free with an included plan
credit (Neighbor 0 / Grower 3 / Farm 10 / Sponsor 10 per month — from
`plan_limits.included_boost_credits`, resolved through the EFFECTIVE plan, so
complimentary Grower/Farm get the same allowance).

## Credit model (auditable, abuse-safe)
- **Included credits are never a mutable counter.** Usage = count of
  `listing_promotions` rows with `source='plan_credit'` in the current
  calendar month; allowance = current effective plan's number. Remaining =
  `market_boost_credits_remaining()`. Because usage is immutable history,
  upgrade→use→downgrade→re-upgrade cycling can NEVER refresh the allowance
  (live-tested), and downgrades clamp remaining to the new plan instantly.
- **Monthly reset**: automatic on `date_trunc('month')` — unused included
  credits do not roll forward. `resets_on` is exposed to the UI.
- **Purchased credits** live in the append-only `market_promotion_credits`
  ledger (sources: PURCHASED_SINGLE/PACK_3/PACK_10, ADMIN_COMP, REFUND,
  CONSUMED). Balance = sum(delta); they survive the monthly reset and belong
  to the MARKET, not a user. Clients cannot write the ledger (RLS): only the
  Stripe webhook, admin RPCs, and the redemption RPC do.

## Activation
Seller: My Market → listing → Promote. Included credit → direct
`listing_promotions` insert (`source='plan_credit'`; trigger enforces
allowance). Purchased credit → `promote_listing_purchased()` (locks ledger,
consumes −1 atomically). No credit → $3.99 purchase (Stripe checkout —
OWNER CONFIG REQUIRED; the client never fakes success). Opening the screen
never consumes anything; activation is an explicit confirm.

## Rules (trigger-enforced, live-tested)
- 7-day window defaults server-side; sellers cannot change `ends_at`
  (`PROMO_WINDOW_LOCKED`); 31-day hard cap for admin-created promotions.
- Only live listings are promotable (`LISTING_NOT_PROMOTABLE`).
- **No stacking**: one active promotion per listing
  (`PROMO_ALREADY_ACTIVE:<ends_at>` — UI shows the end date). Multiple
  different listings may run at once if credits allow.
- Sold/claimed/paused/expired listings drop out of Browse automatically, so
  the promotion stops displaying; no automatic refund when an item sells.
  Admin may end an invalid promotion and (with `promotions.refund_credit`)
  restore a credit — plan-credit restores are compensated with a +1 ledger
  row (month history is never rewritten).
- Expiry: `expire_finished_promotions()` flips active→expired lazily; the
  `sync_listing_featured` trigger clears the `is_featured` mirror. Analytics
  rows are kept forever.

## Ranking & disclosure
Promoted listings surface in the existing **“Featured Near You” rail** and
carry `is_featured/has_active_promotion` through the public listing views —
always labeled **Featured**, always subject to normal status/geo/filters
(inactive or out-of-range listings never surface because promotion state
never bypasses the base queries).

## Analytics (honest, computed — never fabricated)
`market_promotion_performance()`: per promotion — market listing-views during
the window (from `market_metrics` daily rows), claims started/completed on
the promoted listing during the window. No invented impressions.

## Admin
Permissions: `promotions.view` (most roles), `promotions.manage` (Operations),
`promotions.grant`/`promotions.refund_credit` (owner-tier only). RPCs:
`admin_grant_promo_credits` (audited PROMO_CREDITS_GRANTED),
`admin_end_promotion` (audited PROMOTION_ENDED, optional credit restore).
Admin app: More → Revenue & Promotions.
