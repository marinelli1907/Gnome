# Stripe Test-Mode QA

## Part 1 — Deterministic lifecycle QA (2026-08-11)
The whole entitlement/order/credit lifecycle was driven through the exact RPCs
and DB effects the webhook performs, using throwaway users tagged
`stripe_livemode=false`, then cleaned. This proves **Gnome's handling logic**.

| Area | Result |
|---|---|
| Grower checkout → grower (25/2/AI/3 promos) | PASS |
| Grower → Farm (unlimited/10, single active plan sub) | PASS |
| Stale grower-cancel can't clobber newer Farm | PASS |
| Farm → Grower | PASS |
| Pickup add-on +1 → 3, qty 2 → 4, cancel → 2 (non-destructive) | PASS |
| Base cancel → free, subscription history preserved | PASS |
| Paid Grower + comp Farm → effective Farm; revoke → back to Grower | PASS |
| Test sub excluded from real MRR (livemode split) | PASS ($0 live MRR) |
| Promotion purchase → grant+consume+promote (net 0), listing featured | PASS |
| Promotion purchase replay → grants nothing | PASS |
| Ownership spoof (promote another market's listing) refused | PASS |
| Promotion refund before use → credit clawed back | PASS |
| Promotion refund after use → history preserved | PASS |
| Seasonal Seed Drop $24.99 → order paid (test) | PASS |
| Seasonal Seed replay → no double order/charge | PASS |
| Bundle → seller plan + seed sub both active | PASS |
| Webhook event id idempotent (replay refused) | PASS |

## Part 2 — REAL Stripe API round-trip (2026-08-12)
Executed against the **Gnome / Boone Systems LLC** Stripe account
`acct_1U0DgIAGtpm0Et4C`, **test mode only** (`livemode:false` verified before
any write). The Boon Rideshare account and its CLI profile were never touched.

### Proven
| Step | Result |
|---|---|
| `billing-admin identity` → correct account, livemode:false | PASS |
| 7 canonical TEST products + prices created (`ensure_products`) | PASS |
| Billing Health shows all 7 `test: READY`, `live: NOT READY` | PASS |
| Real `cs_test_` Checkout Session for all 8 SKU variants | PASS |
| Session amounts exactly match the commercial model | PASS |
| Every session carries server-authored ownership metadata | PASS |
| Every session `livemode:false`, `mode:test` | PASS |
| Promote **another user's** listing → `NOT_YOUR_LISTING` | PASS |
| Pay **another user's** seed subscription → `NOT_YOUR_SUBSCRIPTION` | PASS |
| Nonexistent listing / unknown / inactive product refused | PASS |
| Unauthenticated `billing-checkout` → 401 | PASS |
| **Real test payment** (card 4242…) → `status: complete`, `payment_status: paid` | PASS |
| Stripe Tax applied correctly (NC 6.75%: $9.99 → $10.66) | PASS |
| Stripe subscription + customer created in test mode | PASS |
| Stripe delivered the events to the webhook endpoint | PASS |
| Webhook **refused** events it could not verify (HTTP 400) | PASS |
| DB left untouched by unverifiable events (no plan/sub/event rows) | PASS |
| `payments_live_enabled` = **false** throughout | PASS |
| Live MRR / promotion / seed revenue = **$0** | PASS |

### Account-config blocker found and fixed
The account has Stripe Tax / managed payments enabled, which **requires a
`tax_code` on every product**. The first real session attempt failed with
`Invalid line_items[0]: the product tax code is missing`. `ensure_products` now
sets `tax_code: txcd_10000000` ("General — Electronically Supplied Services")
on create *and* patches existing products. Refine per-product tax codes before
going live.

## Part 3 — FULL round-trip COMPLETE (2026-08-12)
`STRIPE_WEBHOOK_SECRET_TEST` was set by the owner, and the whole loop was then
driven for real: **Gnome checkout → Stripe Test Checkout → official test card
payment → real signed Stripe webhook → Gnome mutation → Admin reflects it.**

Test webhook endpoint `we_1U3VaFAGtpm0Et4CIvWhv1R4` →
`https://fgybyghwcjlstqxkclch.supabase.co/functions/v1/stripe-webhook`
(6 events). `webhook_status` reports `test: true`.

| Real payment / event | Gnome result | Verdict |
|---|---|---|
| Grower $9.99 (+NC tax = $10.66) | market `free` → **grower**, plan sub active | PASS |
| Farm $29.99 (+tax = $32.01) | **grower → farm**, prior Grower sub auto-cancelled in Stripe + DB, exactly 1 active plan | PASS |
| Stale grower-cancel event arrives after Farm | ignored — Farm survived | PASS |
| Listing promotion $3.99 (+tax = $4.26) | credit ledger +1 then −1 (**net 0**), listing featured `active` | PASS |
| Seed Drop seasonal $24.99 (+tax = $26.68) | sub `active` + linked to Stripe, seed order `paid` | PASS |
| Pickup add-on qty 3 ($15 +tax = $16.01) | `extra_pickup_locations` = **3**, plan untouched, addon sub separate | PASS |
| Refund of the promotion charge | event processed; credit already consumed → **history preserved**, no bogus clawback | PASS |
| Cancel add-on subscription | extras → **0**, plan stayed `farm` (non-destructive) | PASS |
| Cancel plan subscription | plan → **free**, extras 0, all 3 subscription history rows kept | PASS |
| Every record | `livemode = false` | PASS |
| Admin → Billing Health | 7/7 test READY, 0 live READY, `stripe_mode: test`, 9 test events, **0 live events**, last test payment shown | PASS |
| Admin → Commercial overview | REAL MRR **$0**, REAL promo **$0**, REAL seed **$0**, while the separate `test` block shows the activity | PASS |
| `payments_live_enabled` | **false** throughout | PASS |

Real Stripe event ids were recorded in `stripe_events` (e.g.
`evt_1U3bWtAGtpm0Et4Crf1liPRv` checkout.session.completed,
`evt_1U3bWtAGtpm0Et4CYZ6oP7gN` invoice.paid), all `livemode=false`.

**Test money never touched business numbers** — that is the whole point of the
livemode split, and it now holds against real Stripe traffic, not a simulation.

### Cleanup done
All QA data removed (QA user, market, listing, seed sub/order, promotions,
credits, subscriptions), every test Stripe subscription cancelled, the
temporary QA super-admin deleted (`admin_users` = the two real OWNER accounts),
and the two seed bundles restored to `active = false`. The 15 test
`stripe_events` rows are intentionally kept as the audit trail; they are all
`livemode=false` and excluded from revenue.

### Note for going live
`billing-admin` also has QA-only `cancel_subscription` and `refund_payment`
actions. Both refuse unless the live gate is OFF, the key is a test key, the
Stripe object is `livemode:false`, and `confirm_account_id` matches — verified
by an explicit negative test (`ACCOUNT_UNCONFIRMED` without confirmation).

Use only official Stripe test cards. Never a real card. Never the live key.
Never the Boon account.
