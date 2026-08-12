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

## To run the REAL Stripe test round-trip (owner setup, then automated)
The Mac's only authenticated Stripe CLI belongs to **Boon Rideshare** (a
different business) and there is **no Gnome test key** in the environment, so
the real Stripe API leg is intentionally NOT executed. The owner does ONE
thing; product/price creation and identity confirmation are then automated by
the `billing-admin` edge function (owner-only, test-only, guarded).

**Owner (one step, Supabase → Project → Edge Functions → Secrets):**
1. In the **Gnome** Stripe account, switch to **Test mode** → Developers →
   API keys → copy the **test** secret key (`sk_test_…`), or make a restricted
   test key with write access to Products/Prices + Checkout + Subscriptions.
2. Set secret `STRIPE_SECRET_KEY_TEST` = that key.
3. Create a **test** webhook endpoint →
   `https://fgybyghwcjlstqxkclch.supabase.co/functions/v1/stripe-webhook`
   (events: checkout.session.completed, customer.subscription.updated,
   customer.subscription.deleted, invoice.paid, invoice.payment_failed,
   charge.refunded) and set its signing secret as `STRIPE_WEBHOOK_SECRET_TEST` (v16 resolves test/live signing secrets independently; the legacy `STRIPE_WEBHOOK_SECRET` is still accepted during transition).
   (Local alternative: `stripe listen --forward-to <url>` from the **Gnome**
   CLI profile — never the Boon profile.)

**Then automated (next session):**
4. `billing-admin {action:"identity"}` → confirms the key resolves to the
   **Gnome** account id + `livemode:false`. If it's the wrong account or a live
   key, it refuses. (Nothing is created at this step.)
5. `billing-admin {action:"ensure_products", confirm_account_id:"acct_…"}` →
   creates/reuses the 7 test Products/Prices (metadata gnome_product_key,
   environment=test) and writes the test price ids into `billing_products`.
   Guarded: refuses on a live account or if the live gate is on. Admin →
   Billing Health then shows all seven `test: READY`.
6. From a QA account, `billing-checkout` (Upgrade / Promote / Seed Drop) → pay
   with test card **4242 4242 4242 4242** (decline: **4000 0000 0000 0002**).
7. Admin → Billing Health shows the test payment; **live revenue stays $0**.

Use only official Stripe test cards. Never a real card. Never the live key.
Never the Boon account.
