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

### The one remaining step (owner)
`STRIPE_WEBHOOK_SECRET_TEST` is **not set**, so the webhook cannot verify
signatures and therefore does not mutate anything. Everything else is done —
the test webhook endpoint already exists with the correct URL and event set:

- Endpoint: `we_1U3VaFAGtpm0Et4CIvWhv1R4`
- URL: `https://fgybyghwcjlstqxkclch.supabase.co/functions/v1/stripe-webhook`
- Events: checkout.session.completed, customer.subscription.updated,
  customer.subscription.deleted, invoice.paid, invoice.payment_failed,
  charge.refunded

To finish:
1. Stripe → Developers → Webhooks → `we_1U3VaFAGtpm0Et4CIvWhv1R4` → reveal the
   **signing secret** (`whsec_…`).
2. Supabase → Project Settings → Edge Functions → Secrets → add
   `STRIPE_WEBHOOK_SECRET_TEST` = that value.
3. In Stripe, **Resend** the pending `checkout.session.completed` for session
   `cs_test_a1T9GRod…` (Stripe also retries automatically for a while).
4. Expected result: market `f2072502-f275-4037-a166-213ee4362049` flips to
   `plan = grower`, a `market_subscriptions` row appears, `stripe_events` and
   `billing_events` each gain a row, and Admin → Billing Health shows the test
   payment while **live revenue stays $0**.

Verify with `billing-admin {"action":"webhook_status"}` — it reports which
signing secrets are configured (booleans only, never the values).

### QA state deliberately left in place
So the round-trip completes itself once the secret lands:
- QA user `gnome-qa-checkout` (`3bac0b6a-…`), its market `f2072502-…`, one
  listing `aaaa1111-…-01`, one seed subscription `bbbb2222-…-01`.
- One paid **test-mode** Stripe subscription `sub_1U3VkrAGtpm0Et4CzkVgbOq7`
  (customer `cus_V3d0rWs8tOhzm5`) — test mode, no real money.

Remove them after the webhook leg is confirmed. The ownership-spoof fixtures
and the temporary QA super-admin were already removed.

Use only official Stripe test cards. Never a real card. Never the live key.
Never the Boon account.
