# Gnome monetization — the canonical model

This page reflects the current 0126 three-tier model. If it disagrees with
`supabase/migrations/0126_three_tier_pricing.sql`, trust the migration first and
fix this page. Live charging is OFF by product decision (see Payments status).

## Plans

| | FREE | PRO | FARM |
|---|---|---|---|
| **Price** | $0 | $9.99/mo | $29.99/mo |
| **Sell publishes / period** | 3 | unlimited | unlimited |
| **Included renewals / period** | 0 | unlimited | unlimited |
| **Wanted introductions / day** | 1 | 5 | unlimited |
| **Premium QR tools** | locked | ✓ | ✓ |
| **Public Market link** | ✓ | ✓ | ✓ |
| **Internal enum** | `free` | `grower` | `farm` |

`sponsor` still exists as the internal **Legacy Farm** comp rung, but it is
retired, not sellable, and its Stripe SKU is deactivated by 0126.

"Unlimited" is subject to anti-abuse controls (per-plan hourly publish ceiling from 0105; the
30-distinct-Wanted-responses-per-hour ceiling in 0110 applies to every plan, Farm included).

## Overage

- **$0.99** per additional Sell publish beyond the period allowance.
- **$0.99** per renewal beyond the plan's included renewals (on Free, every renewal is $0.99).
- Android does not expose the in-app overage purchase surface for v1.1 (D1);
  iOS and web still carry the test-mode path unless/until separately gated.
- One payment funds exactly one publish or one renewal: the paid authorization
  (`listing_publish_authorizations`, UNIQUE on the Stripe session id) is consumed by the
  activation trigger, so replays, double-taps, and webhook retries cannot double-spend it.

## Listing lifetime

Every Sell listing runs **7 days** (`plan_limits.listing_lifetime_days`), then expires. Renewal
restarts a fresh 7-day clock from now, through the same allowance trigger as publishing. Renewing
an already-active listing is an idempotent no-op (0112) — it never extends the clock for free.

## What consumes the Sell allowance

Only `listing_type = 'sale'` (the default post type). **Share Free, Trade, Wanted, and Offer a
Plot never consume it.** Offer a Plot remains a paid-plan-only feature, enforced separately;
nobody is ever charged to give something away.

## Wanted introductions

Metered per DAY (America/New_York), per DISTINCT request — messages inside an existing
conversation are never metered, and reviving a declined/cancelled/expired conversation never
spends a new introduction. Concurrency is serialized per claimer with an advisory transaction
lock, so parallel requests cannot slip past a one-slot allowance.

## QR

- Every Market gets a free public link; the **premium QR toolkit is the paid part**.
- An issued QR is a durable identity: `/q/<16-hex-code>` looks the code up at scan time, so it
  survives renames, plan changes, and future route changes. **A QR issued on a paid plan keeps
  resolving after a downgrade** — printed signs never die; only issuance/management is
  entitlement-gated. Suspended Markets resolve to nothing, exactly as their pages 404.
- Scans are logged with code, market, timestamp — no PII.

## FOUNDING3

- **Pro (`grower`) only** — rejected server-side for Farm and Legacy Farm (`promo_validate`; Stripe's
  coupon restrictions are NOT relied on, because Stripe silently drops `applies_to`).
- 100% off for **3 months**, payment method required at checkout, then **$9.99/month**.
- Distributed directly to selected early sellers; deliberately not advertised in the UI.
- Currently test-mode architecture only, while live payments remain disabled.

## Internal plan mapping

The database enums are frozen; the customer-facing names are a display layer:

`free` → **Free** · `grower` → **Pro** · `farm` → **Farm** · `sponsor` → **Legacy Farm**

The remaining trap is that `grower` is customer-facing **Pro** and `sponsor` is
a retired internal comp rung, not a sellable plan. **Raw enum values must never
reach customer-visible text.** `plan_limits.display_name` is the server
authority; `web/lib/allowance.ts` and `expo/lib/allowance.ts` are parity-tested
mirrors.

## Payments status

`billing_config.payments_live_enabled = false` — **all billing paths run Stripe TEST mode.**
This is a product decision, not a gap: the entitlement architecture is deployed and enforcing,
while real charging stays off. Nothing may flip this flag, create live-mode Stripe objects, or
take real money without an explicit product-owner decision. Stripe object ids live in
`docs/db/DEPLOY_0104_0111.md` and the idempotent `supabase/scripts/stripe_setup.mjs` (re-runnable
against either mode); secrets live only in the environment.

## PRE-LIVE-PAYMENTS TEST REQUIRED

The $0.99 mobile checkout's device-level round trip has **not** been exercised on a simulator or
physical device (its logic is unit-tested and every server leg was proven against the deployed
stack, but the browser/deep-link seam was not device-driven). **Before live payments are ever
enabled**, verify on a device or simulator:

1. the checkout browser opens from the app;
2. a successful payment returns into Gnome (`gnome://checkout-success`);
3. the seller's draft is preserved across the round trip;
4. cancelling checkout preserves the draft and charges nothing;
5. a delayed webhook reconciles (the app's poll of `my_overage_required` flips to paid);
6. a duplicate/replayed return is harmless (no double publish, no double charge).

## Where enforcement lives

Server-side, exclusively — clients only render what RPCs return:

- Publish/renewal allowance: `trg_enforce_publish_allowance` on `listings` + append-only ledgers
  (0104), period accounting split into allowed/used/actual/paid (0107).
- Hourly publish ceiling per plan: 0105. Wanted gate: `claims_wanted_introduction_gate` (0110).
- QR: 0111. Renew-active guard: 0112. Grant tidies: 0108/0109/0113.
- Checkout/webhook: `billing-checkout` and `stripe-webhook` edge functions (trusted server path;
  the deep-link return is a signal to reconcile, never proof of payment).
- Seller surfaces read `my_listing_allowance()` / `my_wanted_allowance()` / `my_market_qr()`;
  admin surfaces read the `admin_*` wrappers (is_admin-gated). No client reconstructs allowance
  arithmetic.
