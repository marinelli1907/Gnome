# Stripe Test-Mode QA

## What was proven (deterministic, 2026-08-11)
The whole entitlement/order/credit lifecycle was driven through the exact RPCs
and DB effects the webhook performs, using throwaway users tagged
`stripe_livemode=false`, then cleaned. This proves **Gnome's handling logic**;
the Stripe API round-trip itself is a separate owner step (below). Results:

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

All QA data removed; real MRR $0; live gate OFF confirmed after cleanup.

## To run the REAL Stripe test round-trip (owner, ~15 min)
This machine's only authenticated Stripe CLI is a **different** business
account, and there is no Gnome test key in the environment, so the end-to-end
Stripe API leg is intentionally not executed here. To do it safely in TEST mode:

1. In the **Gnome** Stripe account, switch to **Test mode**.
2. Create test Products/Prices for each key (amounts in STRIPE_ARCHITECTURE.md),
   then set `stripe_price_id_test` (+ `stripe_product_id_test`) on each
   `billing_products` row. Admin → Billing Health flips each to `test: READY`.
3. Set edge secrets `STRIPE_SECRET_KEY_TEST=sk_test_…` and
   `STRIPE_WEBHOOK_SECRET` (test endpoint). Leave `payments_live_enabled` FALSE.
4. Point a test webhook endpoint at
   `https://fgybyghwcjlstqxkclch.supabase.co/functions/v1/stripe-webhook`
   with events: checkout.session.completed, customer.subscription.updated,
   customer.subscription.deleted, invoice.paid, invoice.payment_failed,
   charge.refunded. Or locally: `stripe listen --forward-to <url>`.
5. From a QA account, call `billing-checkout` (Upgrade / Promote / Seed Drop) →
   pay with test card **4242 4242 4242 4242** (decline: 4000 0000 0000 0002).
6. Watch Admin → Billing Health: the test payment appears, **live revenue stays
   $0**, product mappings show READY.

Use only official Stripe test cards. Never a real card. Never the live key.
