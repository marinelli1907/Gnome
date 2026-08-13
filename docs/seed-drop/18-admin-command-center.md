# 18 — Seed Drop V1 Operations: Admin Command Center

Status: SPECIFICATION (2026-08-13). No production changes in this document.
Companion docs: `19-checkout-fulfillment.md` (flow), `21-test-plan.md` (tests),
`SEASONAL_SUBSCRIPTION.md`, `SEASONAL_WINDOWS.md`, `ECONOMICS.md`,
`docs/ops/SEED_DROP_FULFILLMENT.md`, `docs/ops/INVENTORY_OPERATIONS.md`,
`docs/admin/ADMIN_PERMISSION_MATRIX.md`, and the regulatory matrix under
`docs/seed-drop/matrix/` (the compliance source of truth this spec consumes).

Everything below is a **delta spec**: each requirement is mapped to the
existing screen/RPC it extends, or explicitly marked **NEW**.

---

## 1. Where the command center lives

The Gnome Admin Expo app (`admin/App.tsx`) already has the operational bones:

| Existing surface | What it does today (RPCs) |
|---|---|
| **Home** tab | `admin_daily_brief` — attention counts incl. `seed_orders_needing_review`, `low_inventory_lots`, `seed_orders_to_pack` |
| **Fulfill** tab | `admin_seed_queue` lanes Review / To pick / Packed / Shipped; Pick Mode (`admin_pick_seed_item`), `admin_pack_seed_order` (override reason), `admin_ship_seed_order` (carrier + tracking, ship-once) |
| More → **Inventory** | `admin_inventory_summary`, `seed_products` / `seed_lots` reads, `admin_upsert_seed_product`, `admin_receive_lot`, `admin_adjust_lot`, `admin_move_lot`, `admin_set_lot_status` (quarantine), archive/delete |
| More → **Seed Drop Seasons** | `seed_season_windows` calendar, `admin_seed_wave_preview` (0.75–1.10× demand range), `admin_seed_wave_generate` (idempotent) |
| More → **Revenue & Promotions** | `admin_commercial_overview`, `admin_seed_economics`, deterministic fulfillment-capacity estimator |
| More → **Billing Health** | `admin_billing_health`, owner-only `admin_set_payments_live` |
| More → **Audit Log** | `admin_audit_log` reads |

**V1 additions (NEW):**

1. **More → "Seed Drop HQ"** — the command center screen. One screen, card
   sections in the order of §3, backed by a single dashboard RPC (§2).
   Gated by `seed_drop.view` (existing perm).
2. **Fulfill tab header strip** — three numbers pulled from the same RPC:
   awaiting packing, exceptions open, reservations expiring < 24 h. Tapping
   the strip opens Seed Drop HQ.
3. **New Fulfill lanes** (§4) — the existing four lanes grow exception lanes.
4. **Sub-screens** reachable from Seed Drop HQ: State Clearances, Suspensions,
   Recalls & Stop-Sales, Restrictions, Replacements, Supplier Performance,
   Compliance Documents, Config. All NEW screens; all reuse the existing
   `Card` / `MenuRow` / `SmallBtn` components and `can(perm)` gating pattern
   already in `admin/App.tsx`.

---

## 2. The dashboard RPC — `admin_seed_command_center()` (NEW)

Pattern: identical to `admin_daily_brief` / `admin_commercial_overview` —
`security definer`, `set search_path = public`, returns one `jsonb`, returns
`null` unless `admin_has_perm('seed_drop.view')`. One round trip; the client
renders sections and never computes business numbers (same posture as the
capacity estimator note in `ECONOMICS.md`: deterministic server math only).

Optional `p_window uuid default null` filter, mirroring
`admin_seed_economics(p_window)`.

---

## 3. Metric catalog

Every metric below names its data source. "EXISTS" = queryable today with
current schema; "NEW" = requires the schema deltas in §9 (specified here,
built later). No metric is ever fabricated — missing data renders as `—`
(the `ECONOMICS.md` honest-numbers policy applies to the whole dashboard).

### 3.1 Growth & mix

| Metric | Source | Status |
|---|---|---|
| New Seed Drop subscribers (7d / 30d / season) | `seed_drop_subscriptions.created_at` | EXISTS |
| Subscribers by state | `seed_drop_subscriptions.ship_state` (normalized to USPS code, see §9 `ship_state` check) | EXISTS (normalization NEW) |
| Waitlist by state | `seed_waitlist` (NEW table, §9) grouped by state | NEW |
| Drop-size mix | histogram of `seed_drop_subscriptions.packet_count` over active subs (4 / 8 / 12 / custom) | EXISTS |
| Frequency mix | `cadence` × `billing_model` over active subs | EXISTS |
| Packets per shipment | avg/min/max of `sum(seed_order_items.qty_packets)` per shipped `seed_orders` | EXISTS |
| Selection-mode mix | `seed_drop_subscriptions.selection_mode` (NEW column, doc 19 §2) | NEW |

### 3.2 Matching & approvals

| Metric | Source | Status |
|---|---|---|
| Matching status | `seed_orders.status` counts: `selected` (fully matched), `needs_review` (shortfall — the engine's honest fallback in `generate_seed_drop`), `pending_payment` | EXISTS |
| Approvals pending | `seed_replacement_requests` status `REQUESTED` (NEW) + `REVIEW_FIRST`-mode drops awaiting customer approval past reminder age (NEW) + existing `ai_action_requests` PENDING (already on Home/AI HQ) | NEW + EXISTS |

### 3.3 Inventory position

One card, seven buckets. All derive from `seed_lots` (statuses today:
`fresh,active,aging,needs_test,quarantined,failed,depleted,discarded`) plus
the reservation ledger:

| Bucket | Definition | Status |
|---|---|---|
| Available | `sum(current_qty)` over lots passing `seed_lot_eligible()` (0028) minus none — `current_qty` is already net of reservations because **reserve-at-generate is the only decrement** (0077 header; `generate_seed_drop` guarded UPDATE) | EXISTS |
| Reserved | `seed_order_items` in `reserved`/`picked`/`packed` on orders not yet shipped (packets committed but physically present) | EXISTS |
| Low | products where available ≤ `reorder_threshold` — exactly `admin_inventory_summary().low_stock_items` | EXISTS |
| Unavailable | lots `failed` / `depleted` / `discarded` | EXISTS |
| Quarantined | lots `quarantined` — `admin_set_lot_status` flow | EXISTS |
| Recalled | lots referenced by an open `seed_recalls` row (NEW, §6); **`recalled` added to the `seed_lots.status` check** | NEW |
| Expired | lots `needs_test` or `next_review_date <= current_date` — today surfaced as `needs_retest` in `admin_inventory_summary` | EXISTS (relabel) |

### 3.4 Fulfillment & failures

| Metric | Source | Status |
|---|---|---|
| Fulfillment capacity | the existing deterministic estimator (Revenue & Promotions screen) fed with live "orders awaiting packing" instead of a typed number | EXISTS (wiring NEW) |
| Orders awaiting packing | `admin_seed_queue` lanes `paid`/`selected` + `needs_review` count | EXISTS |
| Shipping failures | `seed_shipment_events` (NEW, doc 19 §6) with event `label_failed` / `returned_to_sender` and no terminal `delivered` | NEW |
| Delivery failures | `seed_shipment_events` event `delivery_failed`, or shipped > N days (config `delivery_overdue_days`) with no `delivered` event | NEW |
| Payment failures | `seed_drop_subscriptions.status = 'payment_failed'` (webhook sets this on `invoice.payment_failed`) + `seed_orders.pending_payment` older than grace (doc 19 §4.3) | EXISTS + NEW |
| Webhook failures | NEW `stripe_webhook_failures` table: today the handler logs the error, **deletes the `stripe_events` row and returns 500** for Stripe retry (`stripe-webhook/index.ts` catch block) — invisible to the owner. The catch block additionally inserts `{event_id, type, livemode, error, at}`; the dashboard counts open rows (auto-resolved when the same event id later lands in `stripe_events`) | NEW |
| Reservation expirations | rows written by the expiry sweeper (doc 19 §3.4) to `seed_inventory_log` with reason `checkout_expired` — count last 7d, plus currently-pending reservations with `reservation_expires_at` < 24 h | NEW |
| Replacement requests | `seed_replacement_requests` open count (NEW, doc 19 §9) | NEW |
| Damaged shipments | `seed_replacement_requests` where reason `damaged` + `seed_shipment_events` `damage_reported` | NEW |

### 3.5 Supplier performance (NEW screen)

Source: existing `suppliers` table (0077) joined to `seed_lots`,
`germination_tests`, and the NEW tables. Per supplier:

- lots received / packets received (`seed_inventory_log` reason `received`)
- germination pass rate (`germination_tests.pct` vs the 70 % floor in
  `seed_lot_eligible`)
- quarantine + recall counts, replacement-request rate attributable to their
  lots, % of products in `REVIEW_REQUIRED` catalog status (§8)
- on-time restock vs `suggested_reorder_qty` (informational)

No score is invented: each cell shows the count and its denominator.

### 3.6 Compliance & clearance

| Panel | Source | Status |
|---|---|---|
| State-clearance status | `seed_state_clearances` (NEW, §5) — count cleared / pending / blocked / expiring ≤ 60d | NEW |
| Agency-confirmation status | `seed_state_clearances.agency_confirmed_at` null ⇒ "awaiting confirmation" even if internally marked cleared — **a state is not sellable until both cleared AND agency-confirmed** | NEW |
| Compliance documents | `seed_compliance_documents` (NEW, §5.3) — private storage, signed URLs only | NEW |

### 3.7 System health

- Existing: `admin_billing_health` (Stripe mode, live gate, product price
  readiness, last events), `ai-health` edge function (provider status),
  `admin_daily_brief` attention counts.
- NEW `admin_seed_system_health()` adds: expiry-sweeper last run + lag,
  shipping-webhook last event, open `stripe_webhook_failures`, oldest
  unpacked paid order age, allowlist table row count sanity (0 cleared
  states ⇒ giant red card: "Seed Drop is effectively OFF — no state is
  cleared", which is the correct fail-closed reading of an allowlist).

### 3.8 Audit

Existing More → Audit Log screen over `admin_audit_log` is the surface.
Requirement: **every** mutation named in this document calls
`admin_audit(action, resource_type, resource_id, old, new, reason)` exactly
as `admin_receive_lot` / `admin_pack_seed_order` / `admin_set_payments_live`
do today. Seed Drop HQ gets a filtered audit view (`resource_type in
('seed_order','seed_lot','seed_suspension','seed_recall',
'seed_state_clearance','seed_drop_config', …)`).

---

## 4. Exception queues (Fulfill tab lanes)

Existing lanes (client-side over `admin_seed_queue`): Review / To pick /
Packed / Shipped. V1 adds server-known exception states so nothing lives
only in someone's memory:

| NEW lane | Feeds from |
|---|---|
| Payment | `pending_payment` past grace; subscriptions `payment_failed` |
| Ship/Deliver problems | shipping failures + delivery failures (§3.4) |
| Replacements | `seed_replacement_requests` REQUESTED |
| Recall hold | orders containing a recalled/stop-sale lot not yet shipped (auto-frozen, doc 19 §9) |

`admin_seed_queue` (0077) is extended to return these states; the client
lane filter grows accordingly. Every exception row deep-links to the order
detail with the applicable action buttons (perm-gated as today).

---

## 5. State clearance, agency confirmation, compliance documents

### 5.1 The allowlist — normative statement

> A destination state is eligible for Seed Drop **only if it has an explicit,
> current, agency-confirmed row in `seed_state_clearances` with status
> `CLEARED`.** Absence of a row means NOT eligible. There is no blocklist
> semantics anywhere in Seed Drop: a state never becomes sellable by being
> "not blocked", by default values, by AI suggestion, or by client-side
> logic. Alaska, Hawaii, territories, and APO/FPO/DPO are ineligible in V1
> simply because they are never entered in the allowlist.

The allowlist is **driven by the regulatory matrix** in
`docs/seed-drop/matrix/`: an admin enters/updates a clearance row only with a
citation reference into the matrix (`matrix_ref` column). The matrix is the
research artifact; `seed_state_clearances` is the runtime gate the server
checks (doc 19 §1 precheck; re-checked at wave generation and at pack).

### 5.2 `seed_state_clearances` (NEW table)

`state (pk, 2-letter USPS)`, `status ('CLEARED','PENDING','BLOCKED')`,
`matrix_ref`, `license_or_permit_no`, `agency_name`,
`agency_confirmation_ref`, `agency_confirmed_at`, `cleared_at`,
`expires_at`, `notes`, `updated_by`, `updated_at`.
RLS: select requires `seed_drop.view`; writes only via NEW RPC
`admin_set_state_clearance(...)` gated by NEW perm
`seed_drop.compliance_manage`, reason required, audited
(`STATE_CLEARANCE_SET`). Sellable = `status='CLEARED' AND
agency_confirmed_at IS NOT NULL AND (expires_at IS NULL OR expires_at >=
current_date)`. Screen: Seed Drop HQ → State Clearances — 50-state grid,
green only when fully sellable, tap for detail + documents.

### 5.3 Compliance documents (NEW)

`seed_compliance_documents`: `id`, `state`, `kind ('license','permit',
'agency_correspondence','lab_report','recall_notice','other')`,
`storage_path`, `uploaded_by`, `valid_from`, `valid_to`, `notes`.
Files live in a **private** storage bucket (`seed-compliance`); the admin app
renders them via short-TTL signed URLs (same pattern as the existing
compliance-credential uploads, `expo/app/compliance/upload.tsx`). **Never a
public URL, never a public bucket policy.** Read gated by NEW perm
`seed_drop.compliance_view`; upload/delete by `seed_drop.compliance_manage`.

---

## 6. Recall and stop-sale tools (NEW)

`seed_recalls`: `id`, `kind ('RECALL','STOP_SALE')`, `scope_type
('lot','product','supplier')`, `scope_id`, `reason (required)`,
`matrix_ref/agency_ref (nullable)`, `status ('OPEN','RESOLVED')`,
`created_by`, `created_at`, `resolved_at`, `resolution_notes`.

RPC `admin_open_recall(kind, scope_type, scope_id, reason)` — NEW perm
`seed_drop.recall` (OWNER/SUPER_ADMIN preset only by default). Effects, all
in one transaction, all audited:

1. Affected lots (direct, by product, or by supplier) get status `recalled`
   (NEW status; behaves like `quarantined` for `seed_lot_eligible` — that
   function already fails any status outside `fresh,active,aging`, so
   eligibility is automatically closed).
2. **Unshipped** orders holding affected reservations: items released via the
   existing `release_seed_drop_items(order, 'recall')` ledger path, order
   moved to `needs_review`, and a Recall-hold queue entry appears (§4).
   Shipped inventory is never auto-restored (matches the refund posture in
   `stripe-webhook/index.ts`).
3. **Shipped** orders in scope: enumerated into a notification worklist
   (customer contact via the existing `notify` edge function); RECALL kind
   auto-creates `seed_replacement_requests` rows in `REQUESTED` for owner
   decision — never silent.
4. STOP_SALE = effects 1–2 only (stop selling/fulfilling; no customer
   outreach worklist unless escalated to RECALL).

Screen: Seed Drop HQ → Recalls & Stop-Sales: open list, affected counts
(lots / reserved packets / shipped orders), per-recall checklist, resolve
with notes.

---

## 7. Suspension controls (NEW)

One mechanism, ten scopes. `seed_suspensions`: `id`, `scope` enum, `scope_ref
text`, `reason (required)`, `created_by`, `created_at`, `lifted_by`,
`lifted_at`. A suspension is active while `lifted_at IS NULL`. Enforced
**server-side** in the eligibility precheck, the composition engine, wave
generation, and pack (doc 19 §1, §5) — never client-side only.

| Scope | `scope_ref` | Effect while active | Minimum perm |
|---|---|---|---|
| `GLOBAL` | — | Seed Drop closed: no checkout, no wave generation; fulfillment of already-paid orders continues unless owner also freezes packing | **owner-only** (like `admin_set_payments_live`) |
| `STATE` | USPS code | State fails precheck even if cleared | `seed_drop.suspend` |
| `SUPPLIER` | `suppliers.id` | All that supplier's lots excluded from composition; existing reservations flagged for review | `seed_drop.suspend` |
| `PACKET` (product) | `seed_products.id` | Product excluded from composition + Build-My-Box catalog | `seed_drop.suspend` |
| `LOT` | `seed_lots.id` | Same as quarantine but reversible-with-audit through this UI (delegates to `admin_set_lot_status`) | `inventory.quarantine` (existing) |
| `SPECIES_VARIETY` | `crop` or `crop∥variety` | All matching products excluded (covers multi-SKU species issues) | `seed_drop.suspend` |
| `DESTINATION` | ZIP3 or ZIP5 | Finer than state (local quarantine zones) — precheck fails | `seed_drop.suspend` |
| `FULFILLMENT_LOCATION` | `storage_locations.id` | Lots binned there are non-pickable; Pick Mode shows the bin struck through | `seed_drop.suspend` |
| `SUBSCRIPTION_SIZE` | 4/8/12/custom | Size not offered at checkout; existing subs unaffected until next drop | `seed_drop.suspend` |
| `SHIPPING_METHOD` | method key (doc 19 §6) | Method not selectable / not printable | `seed_drop.suspend` |

RPCs `admin_suspend_seed_scope(scope, ref, reason)` /
`admin_lift_seed_suspension(id, reason)` — reason mandatory (the
`REASON_REQUIRED` pattern from `admin_adjust_lot`), audited
(`SEED_SUSPENDED` / `SEED_SUSPENSION_LIFTED`). Screen: Seed Drop HQ →
Suspensions: active list grouped by scope, one-tap lift (confirm dialog),
history.

---

## 8. Product / destination restrictions & catalog data gate (NEW)

- `seed_product_restrictions`: `product_id | species`, `state`, `basis`
  (`matrix_ref` required — e.g. noxious-weed listing), `notes`. Subtractive
  layer **on top of** the state allowlist: the state may be cleared while a
  specific packet is barred there. Checked per-item during composition and
  re-checked at pack. Managed by `seed_drop.compliance_manage`, audited.
- Catalog data gate: `seed_products.catalog_status
  ('ACTIVE','REVIEW_REQUIRED','ARCHIVED')` (NEW column; `archived` boolean
  folds in). A product ingested with missing required label data (species,
  variety, packed-for-year/lot on the receiving side, seed count if the
  manufacturer supplies one) lands in `REVIEW_REQUIRED` and is **not
  sellable** until an admin with `inventory.edit` completes the record.
  Dashboard counts it; Inventory screen badges it.

---

## 9. Authorization model & audit trail

**Existing system (cited, reused as-is):** `admin_users` (role + status +
`extra_permissions` + `denied_permissions`), role presets in
`admin_role_permissions()` (0077, updated 0081), `admin_me()` gate in the
app, `admin_has_perm(p)` checked inside every definer RPC, owner checks via
`admin_is_owner()`, and `admin_audit(...)` → `admin_audit_log` (see
`docs/admin/ADMIN_PERMISSION_MATRIX.md` and `docs/admin/ADMIN_ARCHITECTURE.md`).
Every NEW RPC in this spec follows that exact template: perm check first,
`REASON_REQUIRED` where destructive, audit write, `P0001` errors.

**Existing perms reused:** `seed_drop.view/generate/pick/pack/ship/fulfill`,
`inventory.*`, `finance.view_summary`, `subscriptions.view`.

**NEW perms:** `seed_drop.suspend`, `seed_drop.recall`,
`seed_drop.compliance_view`, `seed_drop.compliance_manage`,
`seed_drop.replacements` (approve/deny), `seed_drop.config`,
`seed_drop.waitlist_manage`.

**Preset updates:** INVENTORY_FULFILLMENT gains `seed_drop.replacements`;
COMPLIANCE_ADMIN gains `seed_drop.compliance_view/compliance_manage` and
`seed_drop.view`; OPERATIONS_ADMIN gains `seed_drop.suspend`,
`seed_drop.waitlist_manage`; `seed_drop.recall` and `seed_drop.config` stay
OWNER/SUPER_ADMIN (wildcard) only. **Known gap fixed here:**
`seed_drop.manage` is already checked by `skip_season_window` (0081) but
granted by **no** preset — add it to OPERATIONS_ADMIN and
INVENTORY_FULFILLMENT.

Owner-only (role, not perm — the `admin_is_owner()` pattern): GLOBAL
suspension, recall resolution, config changes to money-adjacent limits.

---

## 10. Config tables — every limit changeable without a deploy

NEW `seed_drop_config` (key/value jsonb, seeded defaults), read by all
server logic, edited only via `admin_set_seed_drop_config(key, value,
reason)` (`seed_drop.config`, audited `SEED_CONFIG_CHANGED` with old/new).
This is the same "config rows, not code" posture as `seed_season_windows`
(0081) and `billing_config` (0083).

| Key | Default | Consumed by |
|---|---|---|
| `enrollment_cap_global` / `enrollment_cap_per_state` | null (off) / null | precheck → waitlist (doc 19 §1, §9) |
| `waitlist_enabled` | true | precheck |
| `drop_sizes_fixed` | `[4,8,12]` | checkout UI + server validation |
| `custom_size_min` / `custom_size_max` | 4 / 20 | server validation (doc 19 §1) |
| `checkout_reservation_ttl_minutes` | 30 | reservation expiry (doc 19 §3.3) |
| `renewal_payment_grace_hours` | 72 | wave-order release (doc 19 §4.3) |
| `max_pending_reservations_per_user` | 1 | reservation cap |
| `max_packets_per_user_per_season` | 20 | reservation cap |
| `delivery_overdue_days` | 12 | delivery-failure detection |
| `replacement_auto_approve` | false | replacements are always human-approved in V1 |
| `germination_checkin_offset_days` | 14 | post-delivery scheduler (doc 19 §7) |
| `shipping_methods` | `["USPS_FIRST_CLASS"]` | ship UI + suspension scope |

Season dates remain in `seed_season_windows` rows (already no-deploy);
prices remain in `billing_products` + Stripe (already no-deploy).

---

## 11. New DB objects introduced by this document (summary)

Tables: `seed_state_clearances`, `seed_compliance_documents`,
`seed_recalls`, `seed_suspensions`, `seed_product_restrictions`,
`seed_waitlist`, `seed_replacement_requests` (detail in doc 19),
`seed_shipment_events` (detail in doc 19), `stripe_webhook_failures`,
`seed_drop_config`.
Columns: `seed_lots.status + 'recalled'`, `seed_products.catalog_status`,
`seed_drop_subscriptions.selection_mode`, `seed_orders.reservation_expires_at
/ delivered_at` (doc 19).
RPCs: `admin_seed_command_center`, `admin_seed_system_health`,
`admin_set_state_clearance`, `admin_open_recall`, `admin_resolve_recall`,
`admin_suspend_seed_scope`, `admin_lift_seed_suspension`,
`admin_set_seed_drop_config`, `admin_review_replacement`.
All new tables: RLS enabled, client writes revoked (the 0077/0081 template),
select gated on the relevant `seed_drop.*`/`inventory.*` perm, customer-facing
rows additionally readable by their owner where applicable
(`seed_replacement_requests`, `seed_waitlist`).

## 12. Biggest deltas vs. today (so nobody re-specs what exists)

Already live and only *surfaced* here: queue/lanes, Pick Mode, pack
override, ship-once, reserve-at-generate ledger, wave preview/generate,
economics, capacity estimator, quarantine, audit log, role/perm system,
billing health. Genuinely NEW: the entire compliance layer (allowlist,
agency confirmation, documents, restrictions), suspensions, recalls,
waitlist, replacements, shipment/delivery event tracking, webhook-failure
surfacing, reservation TTLs, and the config table.
