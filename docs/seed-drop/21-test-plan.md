# 21 — Seed Drop V1 Operations: Test Plan

Status: SPECIFICATION (2026-08-13). Companion to `18-admin-command-center.md`
and `19-checkout-fulfillment.md`. Tests marked **(NEW)** exercise behavior
specified in docs 18/19 that is not yet built — they are written now so the
build has an acceptance contract.

**Automation tags**
- `AUTO` — automatable now: pgTAP/SQL against a branch DB with synthetic
  fixtures, or Deno tests against edge functions with the Stripe CLI in
  test mode. No physical stock or manual steps required.
- `STAGING` — needs staging inventory (real received lots with bins/lots/
  germination data) and/or the running apps to verify end-to-end, including
  UI copy.

**Shared fixture (`fixtures/seed_v1.sql`, to be written with the build):**
cleared allowlist rows for OH + MI (agency-confirmed), NO row for OR/AK/HI/
PR; an active FALL 2026 window (zones 4–9, cutoff ≥ test date); products
from the 0028 starter catalog; lots via `admin_receive_lot` (so the ledger
is real): ≥ 30 packets across ≥ 12 products, one product with exactly 1
packet, one quarantined lot, one product with `packet_seed_count` null
(schema delta, doc 19) and one with `days_to_maturity` null; test users
`buyer_a`, `buyer_b`, admin users per role preset; `zip_zone_lookup` rows
incl. 441→6.

---

## Group A — Drop size & quantity validation

**SD-001 — 4-packet selection** `AUTO`
Given buyer_a passes precheck (OH, in-window). When they subscribe with size
4 and checkout completes. Then `seed_drop_subscriptions.packet_count = 4`
and the composed order has exactly 4 `seed_order_items` (sum `qty_packets` =
4), each on a distinct crop.

**SD-002 — 8-packet selection** `AUTO`
Same as SD-001 with size 8 → 8 packets reserved, `seed_inventory_log` shows
exactly 8 `-1 reserved` rows for the order.

**SD-003 — 12-packet selection** `AUTO`
Same with size 12 → 12 packets reserved; order `selected` (fixture has
stock), not `needs_review`.

**SD-004 — Custom size 4–20** `AUTO`
Given custom size 17 (allowed range 4–20, `seed_drop_config`). When
subscribed. Then accepted, 17 reserved. Repeat at boundaries 4 and 20 —
both accepted.

**SD-005 — Invalid quantity: 3** `AUTO` (NEW constraint)
When a size-3 subscription is attempted via API. Then server rejects
(`packet_count` check 4–20 / precheck gate 6); no subscription row, no
order, no reservation.

**SD-006 — Invalid quantity: 21** `AUTO` (NEW)
Size 21 → rejected identically. (Today's schema allows up to 24 — this test
pins the tightened constraint.)

**SD-007 — Invalid quantity: 0** `AUTO`
Rejected; zero-packet orders can never exist.

**SD-008 — Invalid quantity: -1** `AUTO`
Rejected at validation; additionally assert no code path can pass a negative
to the engine (engine loop limit `o.packet_count` would no-op, but the
constraint must fire first).

**SD-009 — Invalid quantity: non-integer** `AUTO`
`7.5` and `"abc"` via raw PostgREST/RPC call → type/constraint rejection;
no partial writes.

**SD-010 — Drop-size change** `AUTO`
Given an active size-8 sub with a generated (unshipped, unpaid) current
order. When the customer changes to 12. Then the sub updates (guard trigger
allows it), the **current** composed order is unchanged (size applies from
next composition), and the change is visible in drop-size mix (doc 18 §3.1).

## Group B — Subscription lifecycle

**SD-011 — Frequency change** `AUTO`
Given a `seasonal` sub. When cadence/billing_model is changed through the
permitted column grants (0067). Then next-window math follows the new
setting; billing state columns remain client-unwritable (attempt to set
`stripe_subscription_id` fails).

**SD-012 — Pause** `AUTO`
Given active sub. When status → `paused` (allowed transition in
`seed_sub_guard`). Then wave preview/generate excludes it (`status =
'active'` filter, 0081) and `invoice.paid` for a paused sub creates **no
box** (webhook: "is paused — no box"). Resume restores eligibility.

**SD-013 — Skip** `AUTO`
Given active sub, upcoming window W. When `skip_season_window(sub, W)`
before `generation_date`. Then a `seed_sub_season_skips` row exists,
generation skips the sub, and skipping after `generation_date` errors
`TOO_LATE_TO_SKIP` (0081).

**SD-014 — Cancel** `AUTO`
When status → `cancelled`. Then no future window matches
(`seed_sub_next_window` empty), history/orders/ledger remain readable to
the user, and `customer.subscription.deleted` webhook maps to `cancelled`
without touching shipped orders.

## Group C — Location, zone & seasonal correctness

**SD-015 — Multiple growing environments** `AUTO`
Given `seed_profiles.garden_sizes = {containers, medium}` (0030). When
composed. Then container-only filtering is NOT applied (it applies only
when every selected space is small), and at least one non-container-
friendly product may appear.

**SD-016 — ZIP→zone derivation with user correction** `AUTO` (NEW lookup)
Given ZIP 44143 → `zip_zone_lookup` returns 6, profile shows zone 6. When
the user corrects zone to 5. Then composition uses 5; the shipping state
remains OH and cannot be edited independently of ZIP (compliance
authority, doc 19 §1).

**SD-017 — Richmond Heights OH 44143 on 2026-08-12** `STAGING`
Given buyer in 44143 (zone 6), clock 2026-08-12 (month0 = 8, shift 0), full
fixture catalog in stock. When a drop is composed. Then only products with
`8 = any(sow_months)` are selected as plant-now (Radish, Lettuce, Spinach,
Kale, Arugula, Turnip, Cilantro, Beet, Peas, Chard candidates); **no
warm-season outdoor start** (Basil, Zucchini, Cucumber, Bush Bean,
Sunflower, Zinnia — sow_months {5,6,7}) appears as plant-now; any such
packet included for future sowing is labeled SAVE_FOR_LATER with its window
named (doc 19 §2 labeling — NEW).

**SD-018 — Plant-now recommendations** `STAGING` (NEW labeling)
Given a delivered drop. Then each packet whose shifted sow window includes
the current month is tagged PLANT_NOW and its guidance shows depth/spacing/
days-to-germination from catalog columns only.

**SD-019 — Save-for-later recommendations** `STAGING` (NEW)
Given a drop containing an out-of-window packet. Then it is tagged
SAVE_FOR_LATER, names the future sow window, and is excluded from
germination check-in scheduling until planted.

## Group D — Packet display honesty

**SD-020 — Packet-scale display** `STAGING`
Given Radish (packet_seed_count 60). Then customer UI shows "~60 seeds" (or
exact count language) sourced from `seed_products.packet_seed_count`; no
screen invents a different number.

**SD-021 — Missing seed count** `STAGING` (NEW: column becomes nullable)
Given a product with `packet_seed_count` NULL (today the column defaults to
25 — the delta makes "unknown" representable). Then the UI displays exactly
**"Seed count not supplied by the manufacturer."** and never a default/
estimated number.

**SD-022 — Unsupported harvest estimate** `STAGING`
Given `days_to_maturity` NULL. Then harvest copy uses variability language
("harvest timing varies — no reliable estimate for this variety") and no
computed date; with data present, copy still frames as an estimate.

## Group E — Selection modes & composition integrity

**SD-023 — SURPRISE_ME mode** `AUTO`
Given mode SURPRISE_ME. When composed. Then the engine output is fully
deterministic for a fixed fixture (same inputs ⇒ same packets), all items
pass `seed_lot_eligible`, one variety per crop.

**SD-024 — GUIDED mode** `AUTO`
Given preferences `{salsa garden}` and exclusions `{kale}`. Then Cilantro
(tagged salsa) is preferred (score +3.0 path) and no Kale item exists.

**SD-025 — REVIEW_FIRST mode** `STAGING` (NEW flow)
Given mode REVIEW_FIRST. When the proposal is generated. Then payment is
not captured until approval; a requested swap re-runs the engine (prior
reservations released first — ledger shows `reselect` releases) and an
unapproved proposal expires per SD-042.

**SD-026 — BUILD_MY_BOX mode** `STAGING` (NEW flow)
Given mode BUILD_MY_BOX. Then the pickable catalog contains only in-stock,
eligible, unrestricted, unsuspended products for the buyer's state; server
re-validates each submitted line; a tampered request adding an ineligible
product id is rejected with no reservation.

**SD-027 — Replacement approval, no silent substitution** `AUTO` (NEW)
Given a shipped order with a damaged packet and a replacement request. When
an admin with `seed_drop.replacements` approves a different variety. Then
the customer sees the proposed variety and must have the request state to
consult; nothing ships without an APPROVED row; `seed_order_items.status
'substituted'` never appears on a customer order without a linked approved
request (assert zero rows violating this invariant).

**SD-028 — Duplicate prevention** `AUTO`
Given composition. Then no two items in one drop share a crop (engine
`crop_rank = 1`), and (NEW) no variety shipped to this user in the lookback
window recurs unless the user explicitly re-requested it.

**SD-029 — Existing customer seed inventory** `AUTO` (NEW)
Given buyer_a records "Cherokee Purple tomato" in `seed_user_inventory`.
When composed. Then that variety is excluded like an exclusion; removing
the record restores eligibility next run.

**SD-030 — Real inventory only** `AUTO`
Given a product with zero eligible packets (only quarantined/depleted
lots). When composed. Then it is never selected; if the shortfall leaves
the drop under size, order → `needs_review` and **no charge is initiated**
(pending orders in Review lane). Assert no `seed_order_items` row ever
references a lot failing `seed_lot_eligible` at reservation time.

## Group F — Eligibility, capacity & destination gating

**SD-031 — Capacity waitlist** `AUTO` (NEW)
Given `enrollment_cap_global` = current active subs. When buyer_b attempts
checkout. Then precheck returns `WAITLIST_OFFERED`, a `seed_waitlist` row
is created on accept, no order/reservation exists, and admin waitlist-by-
state shows it.

**SD-032 — Seasonal closure** `AUTO`
Given today > `join_cutoff` for the current window. When buyer subscribes.
Then subscription is accepted but `seed_sub_next_window` targets the NEXT
window (0081 behavior); no order is generated for the closed window. With a
GLOBAL suspension active (NEW), checkout itself is refused with closure
copy.

**SD-033 — Unsupported destination (uncleared state)** `AUTO` (NEW)
Given OR has **no** `seed_state_clearances` row. When an OR buyer runs
precheck. Then gate 2 fails (`STATE_NOT_CLEARED`); nothing is created.
Also: a `PENDING` row and a `CLEARED`-but-unconfirmed row (`agency_confirmed_at`
NULL) both fail — allowlist means fully cleared only.

**SD-034 — Restricted packet destination** `AUTO` (NEW)
Given MI cleared but a `seed_product_restrictions` row bars product X in
MI. When an MI buyer composes (any mode). Then X is never selected/pickable
for MI while remaining available to OH buyers; a restriction added after
reservation is caught by `admin_verify_seed_order` (order → `needs_review`,
reason RESTRICTED_DESTINATION).

**SD-035 — Alaska rejection** `AUTO` (NEW)
AK buyer precheck → rejected at gate 2 (AK never in allowlist). No
subscription, no reservation, honest copy ("we can't ship seeds to AK yet").

**SD-036 — Hawaii rejection** `AUTO` (NEW)
Same as SD-035 for HI.

**SD-037 — Territory rejection** `AUTO` (NEW)
PR / GU / VI ZIPs → rejected (gate 1/2). No allowlist row can be created
for a non-state without the compliance perm + matrix_ref (admin RPC
validation).

**SD-038 — APO/FPO/DPO rejection** `AUTO` (NEW)
State AA/AE/AP or city APO/FPO/DPO → rejected at gate 1 before the
allowlist is even consulted.

**SD-039 — International rejection** `AUTO` (NEW)
Non-US address (or non-5-digit ZIP) → rejected at gate 1; also assert the
checkout edge function refuses to create a Stripe session for an order that
failed precheck.

## Group G — Inventory integrity & reservations

**SD-040 — Inventory race: two buyers, last packet** `AUTO`
Given product Z has exactly 1 packet in one lot. When two composition
transactions run concurrently (two sessions, synchronized). Then exactly
one order holds the item; the other composes without Z (or goes
`needs_review` if under size); `seed_lots.current_qty` = 0, never negative;
ledger shows exactly one `-1 reserved` row for that lot.

**SD-041 — Oversell prevention** `AUTO`
Given total eligible stock S. When N buyers order sizes summing > S. Then
total reserved packets ≤ S; excess orders are short and `needs_review`;
`sum(current_qty)` across lots + reserved = received − shipped-consumed
(ledger reconciliation query returns zero drift).

**SD-042 — Reservation expiration** `AUTO` (NEW)
Given a `pending_payment` order with `reservation_expires_at` in the past.
When `expire_seed_checkout_reservations()` runs (twice — idempotency). Then
first run: items `released`, lot qty restored, ledger `checkout_expired`
rows, order `expired`; second run: zero changes. A payment webhook arriving
after expiry re-composes against current stock (doc 19 §3.3), never revives
the stale reservation.

**SD-043 — Abandoned checkout** `AUTO` (NEW)
Given a Stripe Checkout Session created then abandoned (session expires,
TTL aligned). Then the same release path as SD-042 fires; no
`billing_pay_seed_seasonal` effect; customer can restart cleanly (cap from
doc 19 §3.4 no longer counts the expired order).

## Group H — Payments & webhooks

**SD-044 — Payment failure** `AUTO`
(a) `checkout.session.async_payment_failed` → immediate release, order
`cancelled`, Payment lane entry (NEW branch). (b) renewal
`invoice.payment_failed` → sub `payment_failed` (existing webhook branch),
reservation held for grace, then released by sweeper after
`renewal_payment_grace_hours` (NEW). In both: order is never packable
(`admin_pack_seed_order` refuses unpaid states).

**SD-045 — Stripe webhook idempotency (replay)** `AUTO`
Given a processed `checkout.session.completed`. When the identical event id
is re-delivered (Stripe CLI resend). Then insert-first on
`stripe_events(id)` short-circuits (`replay: true`); no second payment
application, no second order, no reservation change. Also replay the
session id inside a *different* event id: `billing_pay_seed_seasonal`'s
`stripe_session_id` unique guard still prevents double effect.

## Group I — Security & access control

**SD-046 — Cross-user order access** `AUTO`
Given buyer_a's order. When buyer_b selects it via PostgREST
(`seed_orders`, `seed_order_items`, shipment events, replacement requests).
Then zero rows (RLS own-row policies, 0028/0077 + NEW tables). buyer_b
calling `billing-checkout` with buyer_a's `subscription_id` → 403
`NOT_YOUR_SUBSCRIPTION`.

**SD-047 — Anonymous access** `AUTO`
Anonymous client: `seed_products` active-catalog read succeeds (public by
design, safe fields); `seed_lots`, `seed_orders`, `seed_drop_subscriptions`,
and every NEW table return zero rows / permission errors; all seed RPCs
revoke `anon`; `stripe-webhook` without a valid signature → 400.

**SD-048 — Admin authorization** `AUTO`
For each sensitive RPC (pick/pack/ship, receive/adjust/quarantine, wave
generate, suspend, recall, clearance set, config set, replacement review):
a READ_ONLY admin gets `NOT_AUTHORIZED`; the role holding the mapped perm
succeeds; GLOBAL suspension + recall resolution + config money-limits
require owner (`admin_is_owner`), matching `admin_set_payments_live`
posture. Every success writes an `admin_audit_log` row (assert per action).

**SD-049 — RLS on every new table** `AUTO`
Automated catalog check: for each table in docs 18 §11 / 19 §12
(`seed_state_clearances, seed_compliance_documents, seed_recalls,
seed_suspensions, seed_product_restrictions, seed_waitlist,
seed_replacement_requests, seed_shipment_events, stripe_webhook_failures,
seed_drop_config, seed_user_inventory, seed_checkins, zip_zone_lookup`):
`relrowsecurity = true`, no `anon`/`authenticated` INSERT/UPDATE/DELETE
grants (except explicitly specified own-row RPC paths), and a negative
probe as buyer_b against buyer_a's rows returns nothing.

**SD-050 — Private address protection** `AUTO`
Assert ship-to data (`profile_snapshot.ship`, `ship_*` columns) is
unreachable by: other users (RLS), anonymous, the public catalog views, the
events pipeline (`events_guard` nulls user ids), and any signed-URL-less
storage path; admin access requires `seed_drop.view` and is the only
non-owner read path.

## Group J — AI containment

**SD-051 — AI hallucinated seed data rejected** `AUTO` (NEW validations)
Given an AI agent proposes (via `ai_action_requests`) a catalog/lot write
containing invented label data (germination %, lot number, seed count not
present in any received record). When approved and executed through
`admin_execute_ai_action`. Then the underlying RPCs reject: label/
germination/lot data can enter ONLY via `admin_receive_lot` /
`germination_tests` rows recorded by a human admin; the AI read surfaces
(`ask-gnome`, `garden-planner`, Boardroom) render catalog columns verbatim
and a response containing seed facts absent from the DB is a test failure
(doc 19 §7: AI explains, never supplies data).

**SD-052 — AI attempted compliance override** `AUTO` (NEW)
Given an AI action proposing to ship to an uncleared state, "clear" a
state, or lift a suspension. Then: no AI-reachable RPC can write
`seed_state_clearances` / `seed_suspensions` (perm-gated to human roles;
agent permission matrix, `docs/ai/AGENT_PERMISSION_MATRIX.md`, never grants
them); and even a hypothetically approved action re-hits the server-side
allowlist in precheck/verify (doc 19 §1, §5.2) — the OR-buyer order still
fails `STATE_NOT_CLEARED` at pack. Chat output cannot change eligibility
(Boardroom "can't change production" invariant, 0077).

## Group K — Recall, stop-sale & supplier data

**SD-053 — Recall** `STAGING` (NEW)
Given lot L is in buyer_a's unshipped reserved order and buyer_b's shipped
order. When `admin_open_recall('RECALL','lot',L,reason)`. Then: L →
`recalled` and fails `seed_lot_eligible`; buyer_a's item released (ledger
reason `recall`), order `needs_review` + Recall-hold lane; buyer_b appears
in the notification worklist with an auto-created replacement request;
Pick Mode refuses to pick from L; all steps audited.

**SD-054 — Stop-sale** `STAGING` (NEW)
Given product P stop-sale. Then P is excluded from composition and
Build-My-Box immediately, unshipped reservations are released to review,
NO customer notifications are generated, and lifting the stop-sale
(audited) restores eligibility without inventing inventory.

**SD-055 — Supplier packet missing required data → REVIEW_REQUIRED** `AUTO` (NEW)
Given a new product ingested without required label data (e.g. no variety
or manufacturer seed-count field explicitly unknown without confirmation).
Then `seed_products.catalog_status = 'REVIEW_REQUIRED'`; it is not sellable
(never composed, not in Build-My-Box), it is counted on the admin
dashboard, and completing the record via `admin_upsert_seed_product`
(audited) flips it to `ACTIVE`.

---

## Summary

| Group | IDs | Count | AUTO | STAGING |
|---|---|---|---|---|
| A Drop size & quantity | SD-001–010 | 10 | 10 | 0 |
| B Lifecycle | SD-011–014 | 4 | 4 | 0 |
| C Location & season | SD-015–019 | 5 | 2 | 3 |
| D Packet display | SD-020–022 | 3 | 0 | 3 |
| E Selection & composition | SD-023–030 | 8 | 6 | 2 |
| F Eligibility & destination | SD-031–039 | 9 | 9 | 0 |
| G Inventory integrity | SD-040–043 | 4 | 4 | 0 |
| H Payments & webhooks | SD-044–045 | 2 | 2 | 0 |
| I Security & access | SD-046–050 | 5 | 5 | 0 |
| J AI containment | SD-051–052 | 2 | 2 | 0 |
| K Recall & supplier | SD-053–055 | 3 | 1 | 2 |
| **Total** | | **55** | **45** | **10** |

Runnable today against the live schema (no new build): SD-011–015, 023,
024, 028 (in-drop half), 030, 032 (window half), 040, 041, 045, 046, 047,
050 and the existing-RPC halves of SD-048 — everything else pins NEW
behavior from docs 18/19 and becomes runnable as those deltas land.
Fixture discipline: all stock enters via `admin_receive_lot` (never raw
inserts) so every test exercises the real ledger.
