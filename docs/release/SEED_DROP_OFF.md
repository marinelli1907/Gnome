# Seed Drop OFF — evidence inventory

**Question this document answers:** can any person, by any route, cause Gnome to
create a Seed Drop payment?

**Scope of the claim.** Seed Drop ships as *Coming Soon*: announced, no price, no
date, no purchase, no charge. This file inventories every surface the directive
names, states whether each is reachable, and records the evidence — or records
plainly that there is none.

Compiled 2026-08-13 against `main` working tree, Supabase project
`fgybyghwcjlstqxkclch`. Read `billing_config.payments_live_enabled = false`
directly; no live Stripe price id exists for any product.

---

## Verdict

| | |
|---|---|
| Could a **live-money** Seed Drop charge be created today? | **No.** No live price id exists on any seed key, and `payments_live_enabled = false` forces every checkout into test mode. |
| Could a **test-mode** Seed Drop charge be created today? | **It could before this round, and it has been.** See "The path was real" below. The repo fix closes it; the fix is **not deployed yet**. |
| Is the repository state now Coming Soon-only? | Yes for the checkout path. Two production-data items and two content items remain — see **Open items**. |

### The path was real, not hypothetical

`billing_events` retains the record of a completed Seed Drop purchase:

```
2026-08-12 12:51:18+00  livemode=false  GNOME_SEED_DROP_SEASONAL  2668  paid:00ff3c98-…
2026-08-12 12:59:27+00  livemode=false  GNOME_SEED_DROP_SEASONAL  null  seed_sub:cancelled
```

That is a full round trip — checkout session → Stripe → signed webhook →
`billing_pay_seed_seasonal` — in **test** mode, during the 2026-08-12 QA round.
`stripe_events` holds 15 rows, **0 with `livemode = true`**; no real money has
ever moved. The point is not the money, it is that the machinery works end to
end and only the live gate stood between it and a real charge.

---

## Open items (nothing here is fixed by this lane's code)

| # | Item | Owner | Why it matters |
|---|---|---|---|
| **B1** | `billing_products` rows `GNOME_SEED_DROP_SEASONAL`, `GNOME_SEED_DROP_ONE_TIME`, `GNOME_SEED_DROP_SUBSCRIPTION` are still `active = true`; `SEASONAL`, `GROWER_SEED_BUNDLE`, `FARM_SEED_BUNDLE` still carry a **test** price id. | Coordinator (production data) | Defence in depth. The checkout gate no longer consults these rows, but an armed row plus one future code change is a purchase path. SQL below. |
| **B2** | The repaired `billing-checkout` is **not deployed**. Deployed version 3 (read back from the project on 2026-08-13) still contains the `GNOME_SEED_DROP_SEASONAL` branch that resolves a `seed_drop_subscriptions` row and creates a Stripe subscription session. | Coordinator | Until deployed, production behaviour is unchanged. This is the single most important open item. |
| **B3** | `supabase/functions/ask-gnome/index.ts` line ~122 instructs the assistant that the Seasonal Seed Drop is **"$24.99 per season"** and describes how to join. The assistant will quote a price and a cadence for a product that is Coming Soon. | Not lane 2c — flagging only | A price statement is a price statement regardless of which surface says it. |
| **B4** | `supabase/functions/billing-admin/index.ts` `CANON` still lists `GNOME_SEED_DROP_SEASONAL`, `GNOME_GROWER_SEED_BUNDLE`, `GNOME_FARM_SEED_BUNDLE`. Running `ensure_products` re-creates their Stripe **test** products/prices and rewrites `stripe_price_id_test`. | Not lane 2c — flagging only | Re-arms B1's price half. It does **not** touch `active`, so the B1 fix survives an `ensure_products` run. |

---

## Surface inventory

Legend — **Reachable**: can an ordinary person get to a Seed Drop *purchase* from
here? Content that merely mentions the Seed Drop is "announce only".

### Mobile app (Expo)

| Surface | Path | Reachable | Evidence |
|---|---|---|---|
| Browse-tab Seed Drop banner | `expo/app/(tabs)/index.tsx` ~L293 | No — announce only | Previously `Linking.openURL('https://gnomefarmersmarket.com/seeds')`. Now opens an in-app preview sheet (`expo/components/SeedDropComingSoon.tsx`, added this round by another lane). Read the working-tree diff. |
| Any other seed route | `expo/app/**` | No route exists | `ls expo/app` and `ls expo/app/(tabs)` — no `seeds` file or directory. |
| Upgrade / paywall screen | `expo/app/upgrade.tsx` | No | `grep -i seed expo/app/upgrade.tsx` → no matches. |
| Deep links | `expo/app.json` `"scheme": "gnome"` | No seed deep link | No seed route exists to link to (previous row). Expo Router derives deep links from the route tree. |
| In-app payments | — | None | Gnome's app is payment-free by design; no client in the repo calls `billing-checkout` (see API routes below). |

### Web (Next.js, gnomefarmersmarket.com)

| Surface | Path | Reachable | Evidence |
|---|---|---|---|
| Header "Grow" menu → Seed Drop | `web/app/layout.tsx` L82–84 | Announce only | Links to `/seeds`, which is now a Coming Soon page. |
| Footer link | `web/app/layout.tsx` L125 | Announce only | Same destination. |
| Mobile nav sheet | `web/app/components/MobileNav.tsx` L16 | Announce only | Same destination. |
| Home page cards | `web/app/page.tsx` L241, L298 | Announce only | Same destination. |
| Pricing page | `web/app/pricing/page.tsx` | Announce only | Rewritten this round by another lane: the `$24.99 per season` heading and the `~$199/yr` / `~$429/yr` bundle copy are gone, replaced with a "Coming soon" section carrying no price and no date. Verified in the working-tree diff. |
| `/seeds` page | `web/app/seeds/page.tsx` | **No purchase path** | Rewritten this round: the `NEXT_PUBLIC_SEED_LINK_SEASON` / `_MONTHLY` anchors were deleted, not flagged off. Suite case **A-15** greps the de-commented source for `NEXT_PUBLIC_SEED_LINK_`, `buy.stripe.com`, `client_reference_id=seed_` → clean. **A-16** greps for any `$<digit>` → clean. |
| `/seeds` garden profile | `web/app/seeds/SeedProfileClient.tsx` | **No purchase path** | The `STARTER_LINK` redirect to `…?client_reference_id=seed_<uid>` is gone. Writes `seed_profiles` (own-row RLS) only. Same A-15/A-16 evidence. |
| Sitemap | `web/app/sitemap.ts` | `/seeds` is **not** listed | Read the file — it emits `/`, `/plots`, `/trust`, area, category, market and listing URLs only. |
| Old bookmarks / direct URLs | `https://gnomefarmersmarket.com/seeds` | Resolves, Coming Soon **after deploy** | The route still exists by design. **UNVERIFIED**: whether the VPS has been redeployed with the new page — see Unverified. |
| API routes | `web/app/**/route.ts` | **None exist** | `find web/app -name route.ts` → no results. The web app has no server API surface at all. |

### Edge functions

| Function | Deployed | `verify_jwt` | Reachable for seed | Evidence |
|---|---|---|---|---|
| `billing-checkout` | v3, 2026-08-12 | true | **Repo: no. Deployed: YES (B2).** | Repo source now refuses every seed key before the `billing_products` read and before a Stripe client exists (suite A-06/A-07). Deployed source read back via the Supabase management API on 2026-08-13 still contains the `else if (key === 'GNOME_SEED_DROP_SEASONAL')` branch. |
| `stripe-webhook` | v18 | false (Stripe signs) | Guarded in repo — not this lane's file | See "What the webhook seed branches would do". |
| `billing-admin` | v9 | true | Owner/super-admin only, mutations gated on live-gate-off + test account + confirmed account id | Creates **test** prices only; never a checkout session. See B4. |
| `ask-gnome` | v9 | true | Text only | Quotes a price — see B3. |
| `gnome-assistant` | v3 | true | Text only | Lists "Seed Drop" among app topics; no price, no link. |
| `notify` | v13 | false | No seed content | `grep -i seed supabase/functions/notify/index.ts` → no matches. |

**Callers of `billing-checkout`:** none in the repository.
`grep -rn "billing-checkout" $(git ls-files)` matches only the function's own log
line and a comment in `billing-admin`. The only way to invoke it is a direct HTTP
POST with a valid user JWT — which is exactly why the refusal has to live in the
function and not in a client.

### Database — RPCs and grants

| Object | Grants | Reachable | Evidence |
|---|---|---|---|
| `generate_seed_drop(uuid)` | `postgres, service_role` | No — webhook only | `aclexplode` over `pg_proc`, queried live 2026-08-13. |
| `generate_seed_subscription_order(uuid, bool)` | `postgres, service_role` | No | Same query. |
| `billing_pay_seed_seasonal(text,bool,uuid,int)` | `postgres, service_role` | No | Same query; `0084` explicitly revokes from `public, anon, authenticated`. |
| `seed_sub_next_window(uuid)` | `authenticated` | Read-only date helper | Same query. |
| `skip_next_seed_order(uuid)` | `anon, authenticated, PUBLIC` | Yes, but harmless | Same query. Skips an existing subscription's next order; creates no charge and no inventory movement. Grant is broader than it needs to be — worth tightening, not a payment path. |
| `reserve_seed_packets`, `convert_seed_reservation`, `mark_seed_reservation_payment_pending` | n/a | **Do not exist in production** | Defined only in `supabase/migrations/0089_seed_drop_compliance_foundation.sql`, which is deliberately unapplied. |
| `seed_drop_subscriptions` | `authenticated` may `insert` its own row (column-level grant, own-row RLS) and `update` a limited column set | Row creation yes; billing state no | `0067_seed_drop_subscriptions.sql` L64–72 plus the `seed_sub_guard` trigger. **This was the missing half of the old attack**: a user could create their own `incomplete` row and hand its id to `billing-checkout`. With the checkout gate in place the row is inert — it has no way to become `active` without a webhook event that can no longer be produced. Production currently holds **0 rows**. |

### Stripe configuration

| Item | State | Evidence |
|---|---|---|
| Live price ids | **None, on any product** | `select … from billing_products` run live 2026-08-13: `stripe_price_id_live` is null for all 11 rows. |
| Test price ids on seed keys | `GNOME_SEED_DROP_SEASONAL`, `GNOME_GROWER_SEED_BUNDLE`, `GNOME_FARM_SEED_BUNDLE` — present | Same query. This is B1. |
| `active` on seed keys | `SEASONAL`, `ONE_TIME`, `SUBSCRIPTION` = true; both bundles = false | Same query. This is B1. |
| Live payments gate | `payments_live_enabled = false` | Same query. |
| Stripe Payment Links | **UNVERIFIED** — see below | |
| Checkout-session creation | Only `billing-checkout` creates sessions | It is the only file in the repo calling `stripe.checkout.sessions.create`. |

### Admin controls

| Surface | Path | Purchase path? |
|---|---|---|
| Admin app: Seed Drop Seasons, Fulfill tab, seed inventory | `admin/App.tsx` (`seed_drop.view/pick/pack/ship/generate` permissions) | No. Fulfillment and inventory only; every action is permission-gated and audited. |
| Web admin: `seeds` / `drops` tabs | `web/app/admin/AdminClient.tsx` | No. Inventory, lots, germination tests, order queue. |
| `admin_seed_wave_generate` | `0081_commercial_model.sql` | Generates orders for *existing paid* subscriptions. With zero subscriptions it has nothing to act on. |
| `billing-admin` `ensure_products` | edge function | Creates Stripe **test** prices. See B4. |

### Emails and notifications

| Surface | State | Evidence |
|---|---|---|
| `notify` edge function | No seed content | `grep -i seed` → no matches. |
| Notification/email templates in migrations | None found for Seed Drop | `grep -rn seed supabase/migrations/*.sql \| grep -iE 'notification\|notify\|push\|email'` → no matches. |
| Marketing email | **UNVERIFIED** — no email platform is configured in this repo. | |

---

## What the three `stripe-webhook` seed branches would do

Not this lane's file to edit; documented as required.

The webhook's `checkout.session.completed` case contains three seed branches. In
the absence of a guard they would do this:

1. **Legacy Payment-Link starter** — `client_reference_id` matching `seed_<uid>`,
   `mode: 'payment'`. Inserts a `seed_orders` row with `status: 'paid'` and calls
   `generate_seed_drop(order_id)`. **This is the dangerous one: it reserves real
   packet inventory** and puts an order in the fulfillment queue.
2. **Seasonal (server checkout)** — `seedseason_<sub>` or
   `metadata.product_key = 'GNOME_SEED_DROP_SEASONAL'`, `mode: 'subscription'`.
   Flips the `seed_drop_subscriptions` row to `active`, stores the Stripe customer
   and subscription ids, then calls `billing_pay_seed_seasonal`. This is the branch
   that fired on 2026-08-12.
3. **Legacy subscription Payment Link** — `seedsub_<sub>`, `mode: 'subscription'`.
   Flips the row to `active` and sets `next_order_date` to today, which arms the
   seasonal generator.

Two further seed paths live outside `checkout.session.completed`:
`invoice.paid` (a renewal calls `generate_seed_subscription_order` — a box with no
checkout involved at all), and `customer.subscription.updated/deleted` plus
`invoice.payment_failed` (status flips only; no charge, no inventory).

**As of this working tree**, the coordinator has added `SEED_DROP_COMING_SOON` to
`stripe-webhook`: a single `isSeedDropEvent(ref, meta)` check at the top of
`checkout.session.completed` that logs `refused:coming_soon` to `billing_events`
and breaks before any of the three branches, plus an equivalent guard in
`invoice.paid` that breaks rather than throwing. The status-only branches in
`customer.subscription.*` and `invoice.payment_failed` remain unguarded; they
mutate a row's `status` and nothing else, and require a `seed_drop_subscriptions`
row already linked to a Stripe subscription — of which production has none.

### Could a seed event arise at all?

Three routes, and each is now closed:

- **Through Gnome's own checkout** — no. The repaired `billing-checkout` refuses
  every seed key before it reads `billing_products` and before a Stripe client is
  constructed. **Caveat: only once B2 is deployed.**
- **Through a Stripe Payment Link** — the legacy `seed_` and `seedsub_` branches
  exist precisely because Payment Links once drove them. No link URL exists
  anywhere in this repository, and `NEXT_PUBLIC_SEED_LINK_*` is absent from
  `web/.env.example` and from the local `web/.env.local`. Whether a Payment Link
  still exists in the Stripe dashboard is **UNVERIFIED** (see below) — a live
  Payment Link would be reachable by anyone holding an old bookmark, entirely
  outside this codebase.
- **A hand-made Stripe session, or a replayed old event** — possible in principle
  for anyone with the Stripe API key; this is what the webhook guard is for.

For **live money** specifically: no live price id exists for any seed key, so no
live-mode Stripe object can reference one, and `payments_live_enabled = false`
means `billing-checkout` cannot even select the live secret key. A live-mode seed
event has no way to come into existence.

---

## SQL the coordinator should run (production data — not run by this lane)

Deactivating the seed product rows is a production data change and was
deliberately left undone here. Minimal, sufficient version:

```sql
-- Seed Drop stays unpurchasable at the data layer, not just in code: no seed key
-- may be simultaneously active and price-configured. billing-admin's
-- ensure_products rewrites price ids but never touches `active`, so this
-- survives a QA re-provision.
update public.billing_products
   set active = false, updated_at = now()
 where key in ('GNOME_SEED_DROP_SEASONAL', 'GNOME_SEED_DROP_ONE_TIME',
               'GNOME_SEED_DROP_SUBSCRIPTION', 'GNOME_GROWER_SEED_BUNDLE',
               'GNOME_FARM_SEED_BUNDLE');
```

Optional and stronger — also drops the test price ids, at the cost of needing an
`ensure_products` run before the next billing QA round:

```sql
update public.billing_products
   set active = false, stripe_price_id_test = null, stripe_product_id_test = null,
       stripe_price_id = null, updated_at = now()
 where key like '%SEED%';
```

Verify with:

```sql
select key, active,
       stripe_price_id_test is not null as test_price,
       stripe_price_id_live is not null as live_price
  from public.billing_products where key like '%SEED%' order by key;
```

---

## Regression suite

`supabase/tests/run_seed_drop_off_tests.sh` — fails if a Seed Drop purchase path
becomes reachable while Coming Soon is on. Two halves, one exit code.

**Artifact half** (Node, no database). Parses the real
`supabase/functions/billing-checkout/index.ts` rather than restating its intent:
extracts the `CHECKOUT_ALLOWED_KEYS` and `SEED_DROP_KEYS` literals and the
`isSeedDropKey` arrow function, then **executes the shipped predicate** against
adversarial key shapes — casing, padding, tabs, an array-wrapped key, and an
invented `GNOME_SOME_FUTURE_SEED_THING`. Also asserts the refusal precedes the
`billing_products` read and the Stripe client, that the seed checkout branch is
gone, that `_shared/seed_drop_gate.ts` has not drifted from the inline copy, and
that the web `/seeds` sources carry no payment link and no price.

**Database half** (psql, throwaway local database). Asserts that no seed key row
is simultaneously `active` and price-configured, that no seed key has a live price,
that every seed row is inactive, that the live gate is off — and, as a guard
against over-correction, that the four marketplace keys are still active and
priced. Rows come from the snapshot embedded in `seed_drop_off_suite.sql`
(observed 2026-08-13); set `GNOME_BILLING_SNAPSHOT_URL` to a read-only Postgres
connection string to test today's rows instead. That path only ever `SELECT`s, and
reduces price ids to a presence marker so no Stripe identifier is written to disk.

### Actual result, 2026-08-13

```
16/16 artifact cases pass
SEED DROP OFF (artifact): ALL TESTS PASSED

 1 | T-OFF-01 no seed key is active AND price-configured | FAIL | armed: GNOME_SEED_DROP_SEASONAL
 2 | T-OFF-02 no seed key has a LIVE price id            | PASS | no live price on any seed key
 3 | T-OFF-03 every seed key row is inactive             | FAIL | still active: GNOME_SEED_DROP_ONE_TIME, GNOME_SEED_DROP_SEASONAL, GNOME_SEED_DROP_SUBSCRIPTION
 4 | T-OFF-04 the snapshot actually contains seed keys   | PASS | 5 seed key row(s)
 5 | T-OFF-05 live payments gate is off                  | PASS | payments_live_enabled=false
 6 | T-OFF-06 the four marketplace keys stay purchasable | PASS | all four active and priced
4/6 database cases pass

SEED DROP OFF: FAILURES PRESENT   (exit 1)
```

The two failures are B1 and only B1. Re-running the database half against rows in
the post-fix state gives `6/6 database cases pass`.

### The suite was checked against regressions, not just against today

Negative controls, run on a scratch copy so no tracked file was modified:

| Injected regression | Result |
|---|---|
| `GNOME_SEED_DROP_SEASONAL` added back to `CHECKOUT_ALLOWED_KEYS` | A-02, A-03, A-14 fail (13/16) |
| `SEED_DROP_COMING_SOON` flipped to `false` | A-05, A-11, A-14 fail — A-11 names all five leaked keys (13/16) |
| Seed checkout branch restored (`seed_drop_subscriptions` lookup) | A-09 fails (15/16) |
| Seed rows deactivated in the database snapshot | database half goes 4/6 → **6/6** |

---

## UNVERIFIED — do not read these as cleared

1. **Stripe dashboard objects.** Whether any Seed Drop **Payment Link** still
   exists and still resolves. The legacy `seed_` / `seedsub_` webhook branches
   exist because such links once did. This cannot be checked from the repository
   or the database; someone must open the Stripe dashboard (test *and* live) and
   deactivate any seed Payment Link. **A live Payment Link would be reachable
   from an old bookmark and would bypass every control described here except the
   webhook guard.**
2. **The deployed website.** Evidence above is from the repository and from the
   local `web/.next` build (BUILD_ID `5crXI-8djxcS1qK4tBKtY`, built 2026-08-13
   00:27), in which `NEXT_PUBLIC_SEED_LINK_STARTER` was *not* inlined — it
   compiles to a `process.env` lookup against an empty shim, so the CTA was
   already inert in that build. Whether the VPS runs that build, and whether its
   process environment sets `NEXT_PUBLIC_SEED_LINK_*`, was not checked. Deploy
   and confirm.
3. **Supabase function secrets.** Whether `STRIPE_SECRET_KEY_TEST` is set is not
   readable through the management API. The 2026-08-12 test round trip implies it
   is; that is inference, not verification.
4. **Runtime behaviour of the repaired `billing-checkout`.** Every assertion in
   this document about it is static — source parsing plus execution of the
   extracted predicate. No HTTP request was made to the function, and the fix is
   not deployed (B2). After deployment, a POST with
   `{"product_key":"GNOME_SEED_DROP_SEASONAL"}` and a valid user JWT should return
   `403 SEED_DROP_COMING_SOON`; that is the confirmation to run.
5. **The database snapshot's freshness.** The embedded snapshot is a point-in-time
   read. A run without `GNOME_BILLING_SNAPSHOT_URL` is evidence about 2026-08-13,
   not about the day it is run.
