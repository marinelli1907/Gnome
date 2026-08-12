# Stripe Live Activation Checklist (owner)

**Live payments are OFF.** `billing_config.payments_live_enabled = false`.
Gnome will not create a single real charge until every step below is done and
an owner flips the switch. Do this only AFTER reviewing the test-mode QA.

The Gnome Stripe account is **Boone Systems LLC** `acct_1U0DgIAGtpm0Et4C`.
(The Boon Rideshare account is a different business — never use it here.)

## Prerequisites (all owner actions in the Stripe dashboard)
1. **Complete test-mode QA first** (docs/billing/STRIPE_TEST_MODE_QA.md). Do not
   skip to live. As of 2026-08-12 that QA is done except the webhook signing
   secret — finish that step before considering live.
2. In the **Gnome** Stripe account (Live mode), create Products/Prices.
   **Every product needs a `tax_code`** — this account has Stripe Tax/managed
   payments on, and Checkout rejects sessions for products without one (test
   mode uses `txcd_10000000`; pick the right code per product for live):
   - GNOME_GROWER_MONTHLY — $9.99/mo recurring
   - GNOME_FARM_MONTHLY — $29.99/mo recurring
   - GNOME_PICKUP_LOCATION_ADDON — $5.00/mo recurring, quantity-adjustable
   - GNOME_LISTING_PROMOTION — $3.99 one-time
   - GNOME_SEED_DROP_SEASONAL — $24.99 recurring (per season)
   - (optional, when ready) GNOME_GROWER_SEED_BUNDLE $199/yr, GNOME_FARM_SEED_BUNDLE $429/yr
3. Set `stripe_price_id_live` (+ `stripe_product_id_live`) on each
   `billing_products` row. Admin → Billing Health shows each `live: READY`.
4. Set edge-function secrets: `STRIPE_SECRET_KEY_LIVE=sk_live_…`.
5. Create a **live** webhook endpoint →
   `https://fgybyghwcjlstqxkclch.supabase.co/functions/v1/stripe-webhook`,
   events: checkout.session.completed, customer.subscription.updated,
   customer.subscription.deleted, invoice.paid, invoice.payment_failed,
   charge.refunded. Set its signing secret as `STRIPE_WEBHOOK_SECRET_LIVE` (kept separate from the test secret; the webhook verifies each independently).
6. Confirm return/cancel URLs resolve (`GNOME_PUBLIC_URL`, default
   https://gnomefarmersmarket.com → /account?checkout=success|cancelled).

## Flip the switch (last step)
7. Admin → **Billing Health → Payments Live → ON** (owner/super-admin only,
   strong confirm, audited as PAYMENTS_LIVE_ENABLED). From that moment
   `billing-checkout` creates live sessions using the live price ids.

## Guarantees
- Until step 7, Gnome cannot create a live charge even if a live key exists.
- Test and live revenue stay separate forever (livemode flag on every record);
  test transactions never enter MRR.
- No self-payments: real revenue begins only with real customer transactions
  after launch.
- To roll back instantly: Payments Live → OFF returns Gnome to test mode.
