# Stripe Live Activation Checklist (owner)

**Live payments are OFF.** `billing_config.payments_live_enabled = false`.
Gnome will not create a single real charge until every step below is done and
an owner flips the switch. Do this only AFTER reviewing the test-mode QA.

The Gnome Stripe account is **Boone Systems LLC** `acct_1U0DgIAGtpm0Et4C`.
(The Boon Rideshare account is a different business — never use it here.)

## Prerequisites (all owner actions in the Stripe dashboard)
1. **Complete test-mode QA first** (docs/billing/STRIPE_TEST_MODE_QA.md). Do not
   skip to live. As of 2026-08-12 the FULL test round-trip is **DONE** — real
   test payments through a real signed webhook to real Gnome mutations, for
   plans, plan change, add-on, promotion, seed drop, refund and cancellation,
   with real revenue provably $0.
2. In the **Gnome** Stripe account (Live mode), create Products/Prices.
   **Every product needs a `tax_code`** — this account has Stripe Tax/managed
   payments on, and Checkout rejects sessions for products without one (test
   mode uses `txcd_10000000`; pick the right code per product for live):
   - GNOME_GROWER_MONTHLY — $9.99/mo recurring (customer-facing "Pro")
   - GNOME_FARM_MONTHLY — $29.99/mo recurring (customer-facing "Farm")
   - GNOME_SPONSOR_MONTHLY — retired Legacy Farm comp rung; keep inactive, do not create a sellable live price
   - GNOME_PICKUP_LOCATION_ADDON — $5.00/mo recurring, quantity-adjustable
   - GNOME_LISTING_PROMOTION — $3.99 one-time
   - GNOME_LISTING_PUBLISH — $0.99 one-time (allowance overage)
   - GNOME_LISTING_RENEWAL — $0.99 one-time (allowance overage)
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
   https://gnomefarmersmarket.com → `/my?checkout=success|cancelled`; the app
   uses the `gnome://checkout-success|cancelled` deep links).

## §13 payment-hardening requirements (2026-08-17)

The 0124/0125 hardening round moved real money-safety into the schema and the
mode-resolution logic below. These are not optional review items — they are the
conditions under which the deployed code is safe to point at real money.

### Database before functions

Migrations **0124+ (mode isolation) must be applied and PostgREST's schema
cache reloaded** before the billing functions that reference them are deployed.
`stripe_livemode` stamping (billing-checkout at session creation, stripe-webhook
on confirmation) and the consumption guard (`authorization_mode_guard_trg`,
which refuses to consume an authorization whose mode disagrees with the
platform's) are one safety boundary split across schema and functions: a
function deployed against a database whose schema cache does not yet know the
column stamps nothing — both stamps are logged-not-fatal — and the row falls
back to its default, which reads as **test**. Fail-closed (a mis-flagged credit
is refused at consumption, never spent cross-mode), but the payment then needs
manual reconciliation. Deploy order: migration → `notify pgrst, 'reload
schema'` (0124 does this itself) → functions. This ordering held for the
2026-08-17 deploy.

### Test/live key isolation (stripe-webhook v21+)

- The Stripe API client is chosen by the **event's own signature-verified
  livemode**, never by which keys happen to be configured: live events use
  `STRIPE_SECRET_KEY_LIVE`, test events `STRIPE_SECRET_KEY_TEST`.
- There is **no opposite-mode fallback**. A live event with no live key is
  refused for retry (503), never answered with the test key; same in reverse.
- Key prefixes are proof: a mode-named variable holding the OTHER mode's
  `sk_`/`rk_` prefix is treated as misfiled and unusable for that mode; the
  legacy single `STRIPE_SECRET_KEY` is used only when its prefix proves the
  needed mode.
- **Signing-secret/livemode consistency**: an event whose `livemode`
  contradicts the mode-specific signing secret that verified it is refused 400
  before anything is written — the test signing secret can never elect the
  live key.
- **Duplicated secrets**: the same value in both `STRIPE_WEBHOOK_SECRET_TEST`
  and `_LIVE` proves neither mode and is collapsed to a legacy-standing entry
  (events verify, the consistency gate stands down). Misfiled (swapped)
  secrets make genuine events trip the 400 gate — loud in the Stripe
  dashboard; fix the secrets rather than removing the gate.

### Authorization mode safety (0124 §2)

`listing_publish_authorizations.stripe_livemode` is **server-stamped only**:
billing-checkout writes it from the same `billing_config` resolution that chose
the secret key and price id; the webhook re-stamps it from `event.livemode`
while the row is still pending. Neither function accepts a mode field from any
client, and the column defaults false. A mismatched-mode authorization cannot
fund an action: the consumption guard raises `AUTHORIZATION_MODE_MISMATCH`
(proven in `payment_hardening_suite` C5 and on the restored baseline).

### Webhook retry expectations

- The subscription branch's **no-key-for-mode refusal is retryable by
  design**: it logs `refused:no_key_for_mode` to `billing_events`, deletes its
  own `stripe_events` dedupe row (checked, retried once, CRITICAL-logged on
  double failure), and returns 503 — Stripe retries with backoff for days, so
  the purchase is recovered automatically once the key is configured.
- A dedupe row must never permanently shadow a valid resend. The refusal and
  handler-error paths both delete their row before returning non-2xx; the
  15-case `run_webhook_mode_tests.sh` matrix proves the refuse-then-resend
  round-trip against the real handler.
- **Known remaining race (pre-live checklist item)**: if Stripe redelivers
  while the FIRST attempt is still in flight, the duplicate hits the replay
  path and is acknowledged 200; if the first attempt then fails and deletes
  its row, the event is lost with no retry owed. Pre-existing shape (the
  handler-error path has always had it); fix is an explicit
  processed-completion marker — see the checklist below.

### MUST REVIEW BEFORE LIVE

None of these block test-mode operation. All of them get a decision before the
switch flips:

1. **In-flight replay race** — add a `processed_at`-style completion marker to
   `stripe_events` so the replay path can distinguish "processed" from "still
   in flight" (return 5xx for in-flight rather than 200), or explicitly accept
   the race.
2. **Catch-block dedupe delete** — the handler-error path's
   `stripe_events` delete is still unchecked (the refusal path's delete is
   checked/retried); a failed delete there converts a retryable error into a
   permanently replay-shadowed event. Same fix class as the refusal path.
3. **Alerting** — monitor `billing_events` for `effect='refused:no_key_for_mode'`
   (each Stripe retry appends another row; there is no conflict guard, so a
   stuck event produces a visible pile) and for the CRITICAL dedupe-delete log
   line. A refused live purchase must page somebody, not wait to be noticed.
4. **Re-stamp fatality** — decide whether the webhook's `stripe_livemode`
   re-stamp failure becomes fatal-for-retry (delete dedupe row + 5xx, the
   subscription-branch shape) or whether the migration-before-deploy ordering
   above remains the accepted control. Today it is logged-not-fatal and
   fail-closed.

### Billing products

The canonical product **keys** (rows in `billing_products`, seeded by
migrations 0083/0124 §4) exist independently of any Stripe environment;
`stripe_*_test` / `stripe_*_live` id columns are **per-environment runtime
configuration** and are never written by migrations. For live: every purchasable
key needs `stripe_price_id_live` + `stripe_product_id_live` set (step 3 above);
test ids are never reused in live mode — the resolver picks the column by mode,
and a live session with only test ids configured fails closed (`PRICE_MISSING`,
503). `billing-admin ensure_products` is test-only by construction (refuses
non-`sk_test_`/`rk_test_` keys) and cannot provision live objects.

### The gate

**`billing_config.payments_live_enabled` stays FALSE until every item above
passes review and the owner tests below are done.** Nothing in this repo flips
it programmatically; only Admin → Billing Health → Payments Live (owner/
super-admin, audited).

### Owner tests before live (not yet performed)

Run in order, after the checklist above, before announcing:

1. **Mobile checkout deep-link round-trip on a real device** — checkout from
   the app, complete payment, confirm `gnome://checkout-success` returns to the
   app and the app re-asks the server (return is a signal, not proof).
2. **One controlled real-money transaction** (smallest product, own card).
3. **Webhook receipt** for it — `stripe_events` row with `livemode=true`,
   `billing_events` effect recorded.
4. **Authorization consumption** — the paid credit publishes exactly once,
   `stripe_livemode=true` on the authorization, consumed status after use.
5. **Replay protection** — resend the same event from the Stripe dashboard;
   expect `replay:true` and no second effect.
6. **Refund/reversal** — refund the transaction; confirm the clawback/audit
   row and that no entitlement survives that should not.
7. **Subscription cancellation** — cancel in Stripe; confirm downgrade
   converges via `customer.subscription.deleted`.
8. **Mode verification** — after all of the above, confirm zero rows anywhere
   with `stripe_livemode=true` that were not part of these tests.

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
