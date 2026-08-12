# Stripe Architecture (Gnome)

Gnome never touches card data. Stripe hosts checkout; a signed webhook turns
verified events into entitlements/orders/credits. All secrets are server-side
edge-function secrets — never in web, consumer, or Admin bundles.

## Modes & the live gate (safety spine)
- `billing_config` singleton: `payments_live_enabled` (default **FALSE**),
  `stripe_mode` (test|live, follows the flag).
- `admin_set_payments_live(bool)` — **OWNER-only, audited**. Default OFF. Even
  with live keys present, `billing-checkout` refuses to create a live session
  until an owner flips this (Admin → Billing Health → Payments Live).
- Mode-specific secrets: `STRIPE_SECRET_KEY_TEST` (sk_test_…),
  `STRIPE_SECRET_KEY_LIVE` (sk_live_…). The webhook also honors legacy
  `STRIPE_SECRET_KEY`. `STRIPE_WEBHOOK_SECRET` verifies signatures.

## livemode everywhere (no fake revenue)
Every billing record carries the Stripe event's livemode:
`market_subscriptions.stripe_livemode`, `seed_orders.stripe_livemode`,
`market_promotion_credits.stripe_livemode`, `listing_promotions.stripe_livemode`,
`stripe_events.livemode`, `billing_events.livemode`. **Real MRR / revenue count
livemode=true ONLY** (`admin_commercial_overview`); test rows surface in a
separate `test` block. Test transactions can never inflate business numbers.

## Products & prices (`billing_products`)
Per key: `unit_amount_cents`, plus `stripe_product_id_test/_live` and
`stripe_price_id_test/_live`. `billing_price_id(key, mode)` resolves the active
price. Canonical keys: GNOME_GROWER_MONTHLY ($9.99), GNOME_FARM_MONTHLY
($29.99), GNOME_PICKUP_LOCATION_ADDON ($5/unit/mo), GNOME_LISTING_PROMOTION
($3.99), GNOME_SEED_DROP_SEASONAL ($24.99/season), GNOME_GROWER_SEED_BUNDLE
($199/yr, inactive), GNOME_FARM_SEED_BUNDLE ($429/yr, inactive). Price IDs are
owner config — none set yet.

## Checkout (`billing-checkout` edge fn, authenticated)
Server-created Checkout Sessions replace generic Payment Links. The caller's
identity is the JWT; the Market/listing/subscription is resolved from the DB as
**owned by that user**. Ownership is written into server-authored
`session.metadata` (gnome_user_id + market/listing/subscription id) that the
webhook re-validates — a client can never credit a payment to someone else's
Market (proven: `ownership_spoof_refused`). Mode/price come from the gate; a
missing key or price returns 503 (owner config), never a fake success.

## Webhook (`stripe-webhook` v15, signature-verified, verify_jwt off)
Idempotent insert-first on `stripe_events.id`; each money effect additionally
guards on the Stripe session/order id inside its RPC, so replays and
out-of-order retries apply at most once. Branches:
- **checkout.session.completed** → plan/addon (markets.plan + market_subscriptions,
  prior plan sub cancelled so no double-billing), **bundle**
  (`billing_activate_bundle` = plan + seed sub, no fake plan enum),
  **listing promotion** (`billing_purchase_and_promote` = grant+consume+promote,
  idempotent), **seasonal seed** (`billing_pay_seed_seasonal` = order→paid),
  legacy Payment-Link paths (seed_/boost_/seedsub_) preserved.
- **customer.subscription.updated/deleted** → status sync; downgrade only when
  no other active plan sub survives (stale cancel can't clobber a newer plan —
  proven `stale_cancel_no_clobber`); pickup extras non-destructive via
  `reconcile_pickup_locations`.
- **invoice.payment_failed / invoice.paid** → seed sub state / renewal box.
- **charge.refunded / refund.created** → `billing_refund_promo_credit` claws
  back an unconsumed purchased credit; if already used, history is preserved.
Every branch writes `billing_events` (the financial audit ledger).

## Audit
`admin_audit` for the live-payments switch + comp grants; `billing_events` is
the append-only ledger of every Stripe effect (event id, type, livemode,
market/user, product, amount, effect).
