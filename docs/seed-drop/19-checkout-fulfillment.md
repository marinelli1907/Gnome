# 19 — Seed Drop V1 Operations: Checkout → Fulfillment → Feedback

Status: SPECIFICATION (2026-08-13). No production changes in this document.
Reads with: `18-admin-command-center.md` (admin surface + config keys),
`21-test-plan.md`, `SEASONAL_SUBSCRIPTION.md`, `docs/billing/STRIPE_ARCHITECTURE.md`.

The end-to-end pipeline, each stage mapped to the existing implementation it
extends or marked **NEW**:

```
eligibility precheck → composition (per control mode) → ATOMIC reservation
   → Stripe checkout → webhook → pick → verify → pack → ship (once)
   → tracking → delivery confirmation → guidance triggers → feedback → next drop
```

---

## 1. Eligibility precheck — server-side, allowlist first

**NEW RPC `seed_checkout_precheck(p_zip, p_state, p_size, p_env jsonb)`**
(security definer, callable by the authenticated customer; also invoked
internally by checkout and re-invoked by wave generation and pack — the
client result is a preview, never the authority). Gates run **in this
order**, first failure returns a machine code + honest customer copy:

| # | Gate | Rule | Source |
|---|---|---|---|
| 1 | Destination class | Reject international, APO/FPO/DPO (state `AA/AE/AP` or city APO/FPO/DPO), and any non-USPS-state input before anything else | NEW |
| 2 | **State allowlist** | `seed_state_clearances`: sellable = `CLEARED` + `agency_confirmed_at` set + not expired. **No row ⇒ ineligible.** AK, HI, territories fail here by never being cleared (doc 18 §5.1) | NEW |
| 3 | Suspensions | No active `GLOBAL`, `STATE`, or `DESTINATION` (ZIP) suspension (doc 18 §7) | NEW |
| 4 | Seasonal window | An active `seed_season_windows` row exists with `current_date <= join_cutoff` and the derived zone within `zone_min–zone_max` — the exact `seed_sub_next_window()` logic (0081), reused not re-implemented | EXISTS |
| 5 | Capacity | Active subs < `enrollment_cap_global` / per-state cap (config). Full ⇒ `WAITLIST_OFFERED` (§9) | NEW |
| 6 | Size | `p_size` ∈ `drop_sizes_fixed` or integer within `custom_size_min..custom_size_max` (4–20). **Delta:** `seed_drop_subscriptions.packet_count` check tightens from `1..24` (0067) to `4..20` for new/changed subs | DELTA |
| 7 | Per-user caps | ≤ `max_pending_reservations_per_user` open reservations; season packet total ≤ `max_packets_per_user_per_season` | NEW |

ZIP → zone derivation: NEW reference table `zip_zone_lookup(zip3, zone)`
(static data, admin-refreshable). Derived zone and state are written to
`seed_profiles.zone` / normalized state, and the customer may **correct the
zone** (they know their microclimate) but may NOT correct the state/ZIP
mismatch — the shipping ZIP is authoritative for compliance. The order
freezes everything into `seed_orders.profile_snapshot` exactly as today.

---

## 2. Drop composition — four control modes

`seed_drop_subscriptions.selection_mode` (NEW column):
`'SURPRISE_ME' | 'GUIDED' | 'REVIEW_FIRST' | 'BUILD_MY_BOX'`.

All four modes end at the **same** deterministic engine
`generate_seed_drop()` (0028) — the AI never composes, the client never
composes. Modes differ only in the constraint set handed to the engine:

| Mode | Behavior | Status |
|---|---|---|
| SURPRISE_ME | Engine picks everything from profile (zone/season/sun/space/experience). Today's default path | EXISTS |
| GUIDED | Engine picks, honoring `preferences[]` / `exclusions[]` (already scored/filtered in the engine CTE) | EXISTS |
| REVIEW_FIRST | Engine proposes; customer sees the proposed packet list and approves or requests swaps **before payment capture**; swap = re-run engine with added exclusion (re-run releases prior reservations first — the engine's built-in idempotency). Unapproved past TTL ⇒ reservation expiry (§3.3) | NEW flow, existing engine |
| BUILD_MY_BOX | Customer picks each packet from the **eligible-and-in-stock** catalog only (products passing `seed_lot_eligible`, restrictions §1, suspensions); server re-validates every line — a client-submitted product id that fails any gate is rejected, never silently substituted | NEW flow (0028 named it; UI/API not built) |

Composition constraints in every mode: one variety per crop within a drop
(engine `crop_rank = 1` — EXISTS); exclude varieties shipped to this user in
the last N drops and varieties the user marked as already-owned in NEW
`seed_user_inventory` (user-declared "seeds I have") — **NEW** engine input;
`packet_count` from the sub; real inventory only (engine draws only lots
passing `seed_lot_eligible` with `current_qty >= 1` — EXISTS, the reason
out-of-stock can never be selected).

Season correctness: engine's zone-shifted `sow_months` filter (0028) keeps
warm-season outdoor starts out of late-summer drops. **NEW labeling layer**
(display only, catalog-data-driven, no AI-invented facts): each composed
packet is tagged `PLANT_NOW` (current month in shifted sow window) or
`SAVE_FOR_LATER` (shipped for storage with its future window named).

---

## 3. Atomic inventory reservation

### 3.1 The one decrement (EXISTS — extended, not replaced)

Reserve-at-generate is **the only inventory decrement in the system** (0077
header). `generate_seed_drop()` does, per packet, in one transaction:

```sql
update seed_lots set current_qty = current_qty - 1, ...
 where id = pick.lot_id and current_qty >= 1;   -- guarded UPDATE = the lock
```

then inserts `seed_order_items (status 'reserved')` + `seed_inventory_log
(delta -1, 'reserved')`. Pick/pack/ship only change statuses; ship logs a
`delta 0 — 'shipped (reservation consumed)'` row (`admin_ship_seed_order`,
0077). Release is the single inverse: `release_seed_drop_items(order,
reason)` (+qty, ledger row, item → `released`). **Nothing else may touch
`current_qty` except `admin_adjust_lot` / `admin_receive_lot` (audited human
actions).** V1 keeps this invariant absolutely.

### 3.2 Race-safety statement

Two buyers, one packet left: both transactions attempt the guarded UPDATE;
row-level locking serializes them; the second finds `current_qty >= 1` false
— `FOUND` is false, no item row, no ledger row. The engine then either
fills from another eligible lot/product or comes up short, and the order
lands in `needs_review` (never oversold, never negative — `check
(current_qty >= 0)` is the backstop, and the same-transaction property means
a crash rolls back reservation and decrement together). This is existing
0028 behavior; V1 adds no new decrement paths, so the property holds
system-wide by construction.

### 3.3 Checkout reservation expiry (NEW)

Customer-initiated checkouts (new subscriber, BUILD_MY_BOX, REVIEW_FIRST)
reserve **before** payment, so reservations get a TTL:

- `seed_orders.reservation_expires_at` (NEW column) = now +
  `checkout_reservation_ttl_minutes` (config, default 30), set when a
  `pending_payment` order is composed.
- NEW sweeper `expire_seed_checkout_reservations()` (pg_cron every 5 min +
  lazily from `admin_seed_queue`, same lazy pattern as
  `expire_finished_promotions` in 0081): for each `pending_payment` order
  with `reservation_expires_at <= now()` — `release_seed_drop_items(order,
  'checkout_expired')`, order status → `expired` (NEW status in the
  `seed_orders.status` check), customer notified ("your packets were
  released back to stock — start again anytime"). Idempotent: release only
  touches `status='reserved'` items; a re-run finds nothing.
- Payment arriving **after** expiry: the webhook finds the order `expired`
  ⇒ does NOT resurrect stale reservations; it re-runs the engine
  (`generate_seed_drop`, which releases-then-reserves) against current
  stock; shortfall ⇒ `needs_review` + admin Payment lane — never a silent
  partial ship.

### 3.4 Per-user reservation caps (NEW)

Enforced inside the order-creating RPC (not the client): at most
`max_pending_reservations_per_user` (default 1) open `pending_payment`
orders, and cumulative reserved packets per user per season window ≤
`max_packets_per_user_per_season` (default 20). Violations return
`RESERVATION_CAP` before any decrement.

Wave-generated renewal orders (`admin_seed_wave_generate`, 0081) keep their
existing semantics — idempotent via the partial unique index
`seed_orders_window_user_uq`, reservation held through the **renewal grace
window** (`renewal_payment_grace_hours`, §4.3) instead of the 30-min TTL.

---

## 4. Stripe checkout & webhook

### 4.1 Session creation (EXISTS — reused)

The existing `billing-checkout` edge function pattern is the template and is
already Seed-aware: caller identity from the JWT, subscription row loaded
and checked `sub.user_id === uid` (403 `NOT_YOUR_SUBSCRIPTION`), **server-
authored** `metadata { gnome_user_id, subscription_id, product_key, mode }`,
`client_reference_id = seedseason_<sub>`, live/test mode resolved from
`billing_config.payments_live_enabled` + per-mode price ids
(`billing_products.stripe_price_id_test/live`). V1 additions: pass the
`order_id` being paid in metadata, and set a Stripe `expires_at` on the
Checkout Session aligned to `reservation_expires_at` so Stripe and Gnome
expire together.

### 4.2 Webhook (EXISTS — preserved invariants)

`supabase/functions/stripe-webhook/index.ts`:

- **Idempotency (preserved):** insert-first on `stripe_events(id)`; replay ⇒
  `{received, replay:true}` no-op. Handler error ⇒ delete the event row +
  500 so Stripe retries (V1 adds the `stripe_webhook_failures` record first
  — doc 18 §3.4).
- **Ownership re-validation (preserved):** metadata `gnome_user_id` must
  match the DB row's `user_id` (`ownership_mismatch` log-and-drop).
- Money effect via RPC `billing_pay_seed_seasonal(p_session, p_livemode,
  p_sub, p_amount)` guarded on the unique `seed_orders.stripe_session_id`
  (0028) — a replayed session id can never pay twice. ⚠ Repo gap: this RPC
  is invoked by the webhook but its definition is not in
  `supabase/migrations/` (applied live via MCP); V1 work must land the repo
  record.
- `invoice.paid` (renewals) → `generate_seed_subscription_order(p_sub,
  p_paid => true)` (0067) — order `paid`, engine reserves, clock advances.
- `livemode` stamped everywhere (0083) — test traffic never contaminates
  revenue.

### 4.3 Payment failure → reservation release rules

| Event | Action | Status |
|---|---|---|
| Checkout session expired / abandoned (no completion before TTL) | §3.3 sweeper releases; order `expired` | NEW |
| `checkout.session.async_payment_failed` | Immediate `release_seed_drop_items(order,'payment_failed')`, order → `cancelled`, customer notified with retry link | NEW handler branch |
| `invoice.payment_failed` (renewal) | Sub → `payment_failed` (EXISTS). Reservation **held** for `renewal_payment_grace_hours` (default 72) for dunning; grace elapsed ⇒ sweeper releases (`'payment_grace_expired'`), order → `cancelled`, Payment exception lane entry | EXISTS + NEW grace |
| Refund after ship | Logged (`refund_logged`), shipped inventory never auto-restored (EXISTS, webhook refund branch) | EXISTS |

Rule of the house (from `SEASONAL_SUBSCRIPTION.md`): **unpaid orders are
never shipped; impossible fulfillment is never charged.** Pack (`§5`)
re-checks `status` and refuses anything not `paid`/`selected`/
`needs_review`-resolved.

---

## 5. Packing workflow (extends existing Pick Mode)

Existing chain (0077 + `admin/App.tsx` Fulfill tab), kept intact:

1. **Pick list per shipment** — order detail lists items with bin
   (`storage_location`), lot, qty; Pick Mode is the garage-usable big-type
   screen; `admin_pick_seed_item` enforces `reserved → picked` only
   (`BAD_STATE` otherwise). NEW: pick list is blocked with a red banner if
   the order entered the Recall-hold lane or any item's lot went
   `quarantined/recalled` after reservation (server re-check in
   `admin_seed_queue` payload — Pick Mode already shows `⚠️ lot_status`).
2. **Verify packet list (NEW step):** `admin_verify_seed_order(p_order)` —
   confirms every item is `picked`, count matches `packet_count`, and
   re-runs the compliance gates (state still sellable, no new restriction/
   suspension/recall on any packet — the same checks as precheck §1, gates
   2/3 + restrictions). Failure parks the order in `needs_review` with the
   reason. This is the last line of defense before sealing.
3. **Pack with override reason** — `admin_pack_seed_order(p_order,
   p_override_reason)` (EXISTS): packing with unpicked items requires an
   explicit override reason, audited (`SEED_ORDER_PACKED`). V1: overriding a
   failed **verify** additionally requires the NEW perm
   `seed_drop.replacements`-level judgment — compliance-gate failures are
   NOT overridable at all (hard error, owner must lift the suspension/
   restriction first).
4. **Ship once with tracking** — `admin_ship_seed_order(p_order, p_carrier,
   p_tracking)` (EXISTS): `packed`-only guard means an already-shipped order
   errors `BAD_STATE … cannot ship twice`; items → `shipped`; ledger gets
   the delta-0 "reservation consumed" rows. **Never double-decrements** —
   the decrement happened once at reservation (§3.1) and ship writes zero
   deltas by design. Costs recorded via `admin_set_seed_order_costs`
   (EXISTS).

---

## 6. Shipment tracking → delivery confirmation (NEW)

- `seed_shipment_events`: `order_id`, `event ('label_created','shipped',
  'in_transit','out_for_delivery','delivered','delivery_failed',
  'returned_to_sender','damage_reported','label_failed')`, `source
  ('manual','carrier','customer')`, `occurred_at`, `raw jsonb`. RLS: admin
  `seed_drop.view`; customer sees own order's rows.
- Sources: manual admin entry (V1 floor — USPS tracking pasted at ship, as
  today), optional carrier webhook edge function later (same
  insert-first-idempotency shape as the Stripe webhook, keyed on
  carrier event id).
- `seed_orders` gains status `delivered` + `delivered_at` (NEW). Delivered =
  carrier event, or customer taps "It arrived", or admin marks manually.
  `shipped` with no `delivered` after `delivery_overdue_days` ⇒ delivery-
  failure exception (doc 18 §3.4/§4).

---

## 7. Post-delivery guidance triggers (NEW orchestration, existing parts)

On `delivered` (transactionally after the status write, delivered via the
existing `notify` edge function + in-app):

1. **Planting instructions** per packet — rendered ONLY from catalog columns
   (`days_to_germination`, `days_to_maturity`, `planting_depth_inches`,
   `spacing_inches`, `sow_months`, `packet_seed_count`) plus the
   PLANT_NOW / SAVE_FOR_LATER tag (§2). The AI (`garden-planner` /
   `ask-gnome`) may *explain* this data, never replace or extend it —
   the 0028 principle ("the AI layer only explains/coaches afterward").
2. **Germination check-in scheduling** — NEW `seed_checkins`: per
   plant-now packet, scheduled at `delivered_at + days_to_germination +
   germination_checkin_offset_days` (config). Customer answers
   germinated / spotty / nothing; "nothing" offers a replacement request
   (§9) and writes a supplier-performance signal (doc 18 §3.5).
3. `seed_orders.planting_confirmed_at` (EXISTS, 0028) set when the customer
   confirms planting.

## 8. Feedback loop into the next drop

Inputs to the next composition run (all deterministic engine inputs, §2):
shipped-variety history (dedupe), `seed_user_inventory` (owned seeds),
check-in outcomes (a variety that failed for this user is down-ranked via a
NEW per-user exclusion suggestion the customer confirms — never auto-
excluded silently), updated `preferences/exclusions`, corrected zone.
Aggregate check-in failure rates per lot feed Supplier Performance and can
justify quarantine/recall (doc 18 §6).

---

## 9. Exception handling — every exception state

Every row: what the customer sees (honest copy), what the system does, and
the **owner-visible admin queue entry** (doc 18 §4 lanes / Seed Drop HQ).

| Exception | Customer experience | System action | Admin queue entry |
|---|---|---|---|
| Waitlist (capacity) | "Seed Drop is full for your area — join the waitlist" | NEW `seed_waitlist` row (user, state, size); invited FIFO when capacity opens via `admin_invite_waitlist` (`seed_drop.waitlist_manage`, audited) | Waitlist-by-state card (doc 18 §3.1) |
| Enrollment full mid-checkout | Same as above, precheck gate 5 | No reservation ever created | same |
| Seasonal closure | "Joining for {next season} — first Drop ships {window}" (after cutoff this is the existing next-window behavior, not an error) ; global closure copy if suspended | `seed_sub_next_window` picks the next window (EXISTS); GLOBAL suspension blocks checkout (NEW) | Suspensions screen; calendar shows PAST CUTOFF (EXISTS) |
| Unsupported destination | "We can't ship seeds to {state} yet" + notify-me option | Precheck gate 1/2 failure; nothing created; optional `seed_waitlist` row flagged `state_uncleared` | State-clearance grid + waitlist count |
| Restricted packet for destination | Packet never shown (BUILD_MY_BOX) / never composed; if restriction lands post-reservation, verify step catches it | Engine + verify re-check `seed_product_restrictions` | Needs-review lane with reason `RESTRICTED_DESTINATION` |
| Inventory unavailable (shortfall) | REVIEW_FIRST/BUILD_MY_BOX: live "out of stock" before payment. SURPRISE/GUIDED: order proceeds only if fillable; shortfall ⇒ not charged, admin resolves | Engine reserves what exists, order → `needs_review` (EXISTS) — charge only after resolution (wave path already generates before billing) | Review lane (EXISTS) |
| Payment failed | Retry link; renewal: dunning email, sub `payment_failed` | §4.3 release rules | Payment lane (NEW) |
| Reservation expired / abandoned checkout | "Your packets went back to stock — start again anytime" | §3.3 sweeper; order `expired` | Reservation-expiration count (doc 18 §3.4) |
| Replacement approval | "Request received — we'll confirm within X days." Approved ⇒ replacement ships; denied ⇒ reason given. **No silent substitution ever** — a swap the customer didn't approve does not happen; engine substitutions were disabled the moment `needs_review` became the shortfall path | NEW `seed_replacement_requests` (order_id, item_id?, reason `damaged/missing/failed_germination/wrong_item`, photo path?, status `REQUESTED/APPROVED/DENIED/FULFILLED`); approval (`seed_drop.replacements`, audited) creates a NEW zero-amount order through the normal reserve→pick→pack→ship pipeline | Replacements lane |
| Delayed shipment | Proactive "running late" notice at `ship_end`+ | Orders `paid/selected` past window `ship_end` flagged | Fulfill header + HQ |
| Damaged shipment | Report damage (photo optional) → replacement request | `seed_shipment_events 'damage_reported'` + auto `seed_replacement_requests` | Damaged-shipments count + Replacements lane |
| Missing packet | Same flow, reason `missing` | same | same |
| Recall / stop-sale | Recall: direct notice + destroy/return instructions + automatic replacement request. Stop-sale: silent to customers unless shipped | doc 18 §6: lots `recalled`, unshipped reservations released (`'recall'`), shipped orders → notification worklist | Recall-hold lane + Recalls screen |

## 10. Idempotency table — every money / webhook / expiry / release operation

| Operation | Idempotency key / guard | Status |
|---|---|---|
| Stripe event processing | `stripe_events.id` insert-first; duplicate ⇒ no-op replay | EXISTS |
| Checkout session creation | Stripe idempotency key `seedcheckout:{order_id}`; one open session per order | NEW |
| Seasonal payment application | `billing_pay_seed_seasonal` guarded on unique `seed_orders.stripe_session_id` | EXISTS (RPC needs repo migration) |
| Renewal order generation (`invoice.paid`) | `seed_orders_window_user_uq` partial unique index (one order per user per window) | EXISTS |
| Wave generation | same index — re-run skips generated subs (`created/skipped` counts) | EXISTS |
| Inventory reservation | guarded UPDATE `current_qty >= 1` inside one transaction; engine re-run releases-then-reserves | EXISTS |
| Reservation release (any reason) | releases only items `status='reserved'`; re-run is a no-op | EXISTS |
| Checkout-expiry sweeper | selects `pending_payment AND reservation_expires_at <= now()`; state flip inside the same transaction as release | NEW |
| Renewal-grace release | selects `cancelled`-eligible orders past grace, same release path | NEW |
| Pick | `reserved → picked` only (`BAD_STATE`) | EXISTS |
| Pack | acts on `reserved/picked` items of a non-packed order; second call finds none | EXISTS |
| Ship | `packed`-only guard — ship-once, cannot double-consume | EXISTS |
| Replacement approval | unique partial index one `APPROVED` per (order_id, item_id); replacement order carries `replacement_of` FK | NEW |
| Recall application | recall id + per-lot status transition; re-run finds lots already `recalled` | NEW |
| Refund handling | logged per event id; promo-credit clawback via `billing_refund_promo_credit(p_session)` session-guarded | EXISTS |
| Carrier webhook (if added) | carrier event id insert-first, same shape as `stripe_events` | NEW |

## 11. Cross-user access prevention — per endpoint

Statement per surface (existing enforcement cited; every NEW object copies
the template — RLS on, client writes revoked, definer RPCs re-check):

- `seed_orders` / `seed_order_items`: RLS select = own row or
  `seed_drop.view` admin (0028 + 0077 policies); customers cannot
  insert/update at all (service role + admin RPCs only).
- `seed_drop_subscriptions`: RLS own-row; column grants exclude billing
  state; `seed_sub_guard` trigger blocks illegal status transitions (0067).
- `seed_profiles` / `seed_user_inventory` / `seed_checkins` /
  `seed_waitlist` / `seed_replacement_requests`: own-row RLS; admin read via
  perm; writes via RPCs that check `auth.uid()` ownership.
- `billing-checkout`: JWT-derived uid; subscription/order ownership checked
  server-side (`NOT_YOUR_SUBSCRIPTION` 403); client can never direct credit
  to another user/market (server-authored metadata).
- `stripe-webhook`: signature-verified; metadata ownership re-validated
  against DB (`ownership_mismatch` drop); service role only.
- `seed_checkout_precheck`: takes destination inputs, returns eligibility
  only — no other user's data readable through it.
- Admin RPCs: every one gates on `admin_has_perm(...)` (or
  `admin_is_owner()`), so a non-admin authenticated user gets
  `NOT_AUTHORIZED` regardless of arguments; `admin_me()` gates the app shell.
- **Private address protection:** ship-to lives in
  `seed_orders.profile_snapshot.ship` and `seed_drop_subscriptions.ship_*` —
  readable only by the owner and `seed_drop.view` admins (above policies);
  never in `seed_products`/catalog reads, never in events/analytics
  (`events_guard` nulls user ids, 0028), never in AI room contexts beyond
  what the acting admin may already read, never in URLs (signed-URL rule,
  doc 18 §5.3 applies to all documents).

## 12. New objects introduced by this document

Tables: `seed_user_inventory`, `seed_checkins`, `seed_shipment_events`,
`seed_replacement_requests`, `zip_zone_lookup` (+ doc 18's set).
Columns: `seed_drop_subscriptions.selection_mode`;
`seed_orders.reservation_expires_at`, `delivered_at`, `replacement_of`;
status additions `seed_orders: 'expired','delivered'`.
RPCs/functions: `seed_checkout_precheck`, `seed_compose_drop` (mode wrapper
around `generate_seed_drop`), `expire_seed_checkout_reservations`,
`admin_verify_seed_order`, `admin_review_replacement`,
`request_seed_replacement`, `confirm_seed_delivery`.
Constraint delta: `packet_count` 4–20. Webhook branches:
`async_payment_failed`, renewal-grace sweep, failure logging.
