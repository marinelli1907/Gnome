# 17 — Seed Drop V1: Database Change Plan

**Status:** PLAN ONLY. No migration in this document has been written or applied.
**Date:** 2026-08-13
**Author lane:** Database plan (this file), Repo plan (22), Sequence (23). Test plan (21) is a parallel lane.
**Method:** every mapping below was verified against the actual SQL in
`supabase/migrations/` — specifically 0028, 0030, 0056, 0067, 0070, 0077, 0081,
0083, 0086 — plus `supabase/functions/stripe-webhook/index.ts`,
`supabase/functions/billing-checkout/index.ts`, and `admin/App.tsx`. Nothing
here is guessed from memory.

---

## 1. Existing schema — what is actually in the database today

The delta plan in §2 only makes sense against the real current columns. Read
from the migration SQL (not from docs):

### 1.1 `seed_products` (0028, +0067, +0077) — public catalog, safe fields only
0028: `id`, `crop`, `variety`, `botanical_name`, `description`,
`category` check (`vegetable|herb|flower|pollinator|salad|fruit`),
`days_to_germination`, `days_to_maturity`, `preferred_sun`
(`full|partial|shade|any`), `direct_sow_allowed`, `transplant_recommended`,
`spacing_inches`, `planting_depth_inches`, `sow_months int[]` (zone-6
baseline), `beginner_friendly`, `container_friendly`, `packet_seed_count`
(catalog default per-crop pack quantity), `tags text[]`, `active`,
`created_at`, `updated_at`. Unique `(crop, variety)`.
0067: `reorder_threshold int`.
0077: `sku text unique`, `supplier text`, `supplier_product_code text`,
`packet_size text` (human label, e.g. "25 seeds"), `barcode text`,
`cost_cents int`, `suggested_reorder_qty int`, `image_url text`,
`archived boolean`.
RLS: world-read of active rows (`seed_products_public_read`), admin write
(`seed_products_admin_write`); 0077 loosened select to `using (true)`.

### 1.2 `seed_lots` (0028) — admin-only; supplier + cost live here
`id`, `seed_product_id`, `supplier text`, `supplier_lot_number`,
`internal_lot_number` (unique), `purchase_date`, `received_date`
(default current_date), `original_qty numeric`, `current_qty numeric`,
`unit` (`packets|grams|seeds`; V1 engine only draws `packets`),
`seeds_per_unit`, `cost_cents int` (TOTAL landed lot cost — the 0081
economics fn divides `cost_cents / original_qty`), `germination_pct` (0–100),
`germination_test_date`, `next_review_date`, `storage_location text`,
`condition_notes`, `status`
(`fresh|active|aging|needs_test|quarantined|failed|depleted|discarded`),
`notes`, `created_at`, `updated_at`.
RLS: admin-only (`seed_lots_admin`; 0077 read via `admin_has_perm('inventory.view')`).

### 1.3 `germination_tests` (0028)
`id`, `lot_id` (cascade), `test_date`, `seeds_tested`, `germinated`,
`pct` (generated stored), `tester`, `notes`, `next_review_date`, `created_at`.
RLS admin-only.

### 1.4 `seed_inventory_log` (0028) — append-only quantity audit
`id`, `lot_id`, `delta numeric`, `reason text`
(`received|reserved|released|packed|adjusted|wasted|status:…`), `order_id`,
`actor`, `created_at`. RLS: admin select; admin insert requires
`actor = auth.uid()` (0028 tail, applied as 0029).

### 1.5 `seed_profiles` (0028, +0030, +0056) — one per user, own-row RLS
0028: `user_id` PK → profiles, `zip`, `zone` (2–11), `garden_size`,
`sun`, `experience`, `preferences text[]`, `exclusions text[]`, `updated_at`.
0030: `garden_sizes text[]` (multi-select; legacy singular kept as fallback).
0056: `suns text[]`, `experiences text[]`, `packet_count` (legacy singulars
kept and mirrored). NOTE: 0030/0056 repo files are stubs; full bodies live in
production migration history — verify live columns before writing new DDL.

### 1.6 `seed_orders` (0028, +0081, +0083)
0028: `id`, `user_id`, `product` (`'starter'|'subscription'`),
`packet_count` (default 6), `status`
(`pending_payment|paid|selected|needs_review|packed|shipped|cancelled|refunded`),
`profile_snapshot jsonb` (frozen at order time), `stripe_session_id unique`
(webhook idempotency), `amount_cents`, `tracking`, `planting_confirmed_at`,
`notes`, timestamps.
0081: `season_window_id → seed_season_windows`, `postage_cents`,
`packaging_cents`, `insert_cents`, `payment_fee_cents`, `other_cost_cents`;
partial unique `(season_window_id, user_id)` where status not in
(`cancelled`,`refunded`) — double generation impossible.
0083: `stripe_livemode boolean`.
RLS: own-read or admin; customer can never insert/update (webhook + admins only).

### 1.7 `seed_order_items` (0028, +0077)
`id`, `order_id` (cascade), `seed_product_id`, `lot_id`, `qty_packets`
(default 1), `status` — 0077 widened to
(`reserved|picked|packed|shipped|released|substituted`), `substituted_from`
(product FK), `substitution_reason`, timestamps. RLS: own-read via parent
order, admin update.

### 1.8 `seed_drop_subscriptions` (0067, +0081)
0067: `id`, `user_id` (cascade), `cadence` (`monthly|seasonal`, default
seasonal), `status` (`active|paused|cancelled|payment_failed|incomplete`),
`packet_count` (1–24, default 6), `next_order_date`, `ship_name`,
`ship_address_line`, `ship_city`, `ship_state`, `ship_postal_code`,
`profile_snapshot jsonb`, `preferences text[]`, `exclusions text[]`,
`stripe_customer_id`, `stripe_subscription_id unique`, timestamps.
0081: `billing_model` (`PAY_PER_SEASON|ANNUAL_PREPAID`), `price_cents`
(default 2499).
RLS/grants (0067): own-row policy; column-grant hardening — authenticated may
insert/update ONLY the address/preference/cadence/packet_count columns; billing
state transitions guarded by `seed_sub_guard()` trigger (user may only
pause/resume/cancel; `incomplete → active` belongs to the webhook).

### 1.9 `seed_season_windows` (0081)
`id`, `season_code` (`EARLY_SEASON|SPRING|SUMMER|FALL`), `year`, `zone_min`,
`zone_max`, `window_start`, `join_cutoff`, `generation_date`, `ship_start`,
`ship_end`, `active`, `notes`, `created_at`; ordering checks; unique
`(season_code, year, zone_min, zone_max)`. World-readable; no client writes.

### 1.10 `seed_sub_season_skips` (0081)
`id`, `subscription_id` (cascade), `window_id`, `source` (`user|admin`),
`created_at`, unique `(subscription_id, window_id)`. Own/admin read; writes
only via `skip_season_window()` definer RPC.

### 1.11 `suppliers` / `storage_locations` (0077)
`suppliers`: `id`, `name unique`, `contact`, `website`, `account_ref`,
`notes`, `active`, `created_at`.
`storage_locations`: `id`, `name unique`, `zone`, `archived`, `created_at`.
Both: read via `admin_has_perm('inventory.view')`, no client writes
(RPC `admin_manage_storage` for locations).

### 1.12 `admin_seed_queue` — NOT a table
It is a **function** (0077): `admin_seed_queue() returns jsonb`, a definer
read that joins orders → items → lots → products for the Fulfill tab. Any new
fulfillment fields must be added to this function's projection, not to a table
of the same name.

### 1.13 Billing touch points (0068/0081/0083)
`billing_products` (`key`, `kind`, `description`, `unit_amount_cents`,
`currency`, `active`, + 0083 `stripe_product_id_test/_live`,
`stripe_price_id_test/_live`). Seed keys already present:
`GNOME_SEED_DROP_SEASONAL` (active, 2499), `GNOME_GROWER_SEED_BUNDLE`,
`GNOME_FARM_SEED_BUNDLE` (inactive).
`billing_config` singleton — `payments_live_enabled` (default FALSE),
`stripe_mode`; owner-only audited flip via `admin_set_payments_live()`.
`billing_events` — append-only ledger, service-role writer
`billing_log_event()`. `stripe_events` — insert-first replay guard,
`livemode` column.

### 1.14 Existing functions the plan builds on (do not duplicate)
`seed_lot_eligible(l)` — single quality gate (status, qty ≥ 1, unit
'packets', germination ≥ 70 or untested, review date).
`generate_seed_drop(order)` — deterministic engine; race-safe **single
decrement** (`update seed_lots set current_qty = current_qty - 1 … where
current_qty >= 1` is the lock); shortfall → `needs_review`.
`release_seed_drop_items(order, reason)` — idempotent release (only rows
still `reserved`).
`seed_profile_matches(...)` / `seed_recommendations(...)` (0056) — the ONE
definition of suitability + a no-reservation preview with a plain-English
`why`. Drop selections (§3.7) must reuse this `why`, not invent a new one.
`generate_seed_subscription_order(sub, paid)` (0067/0070),
`seed_sub_next_window`, `skip_season_window`, `admin_seed_wave_preview`,
`admin_seed_wave_generate`, `admin_set_seed_order_costs`,
`admin_seed_economics`, fulfillment RPCs (`admin_pick_seed_item`,
`admin_pack_seed_order`, `admin_ship_seed_order`), inventory RPCs
(`admin_upsert_seed_product`, `admin_receive_lot`, `admin_adjust_lot`,
`admin_move_lot`, `admin_set_lot_status`, `admin_manage_storage`,
`admin_inventory_summary`).
NOTE: `billing_pay_seed_seasonal`, `billing_purchase_and_promote`,
`billing_activate_bundle` are called by the webhook but exist **only in
production** (the 0084 migration file is missing from the repo — see 22 §1
pre-work).

---

## 2. Field-level mapping — every required inventory field

Legend: **(a)** existing column · **(b)** new column on an existing table ·
**(c)** new table/structure. "Lot" = `seed_lots`, "Product" = `seed_products`.

| # | Required field | Disposition | Exact home | Notes |
|---|----------------|-------------|-----------|-------|
| 1 | Supplier | (a)+(b) | (a) `seed_lots.supplier text`, `seed_products.supplier text`; (b) `seed_lots.supplier_id uuid → suppliers(id)` | The 0077 `suppliers` table exists but nothing FKs it. Add the FK; keep the text columns as denormalized display/back-compat. Backfill by name match. |
| 2 | Supplier SKU | (a) | `seed_products.supplier_product_code` (0077) | Product-level. Per-lot supplier reference stays `supplier_lot_number`. |
| 3 | Brand | (b) | `seed_products.brand text` | e.g. "Botanical Interests". Distinct from supplier (a distributor may sell several brands). |
| 4 | Original packet name | (b) | `seed_lots.original_packet_name text` | Exactly as printed on the received packets. Lot-level on purpose: the same catalog product re-bought later can carry a renamed label. Canonical display stays `crop + variety`. |
| 5 | Kind | (a) | `seed_products.crop` + `seed_products.category` | "Kind" = crop ("Radish") within a checked category enum. No new column. |
| 6 | Variety | (a) | `seed_products.variety` | Unique with crop. |
| 7 | Packet weight | (a)+(b) | (a) `seed_products.packet_size text` (human label); (b) `seed_lots.packet_weight_grams numeric` | Numeric, per-lot — suppliers change fill weights between print runs. |
| 8 | Exact seed count (if supplied) | (b) | `seed_lots.seed_count_exact int` | NULL when the supplier doesn't state it. Never estimated into this column. |
| 9 | Estimated seed count + source + confidence | (a)+(b) | (a) `seed_products.packet_seed_count` (catalog default); (b) `seed_lots.seed_count_estimated int`, `seed_lots.seed_count_source text` check (`SUPPLIER_STATED|WEIGHT_CALC|SAMPLE_COUNT|CATALOG_DEFAULT`), `seed_lots.seed_count_confidence text` check (`HIGH|MEDIUM|LOW`) | Exact and estimated are separate columns so an estimate can never masquerade as supplier-stated. |
| 10 | Lot / batch | (a) | `seed_lots.supplier_lot_number`, `seed_lots.internal_lot_number` (unique) | Complete as-is. |
| 11 | Germination % | (a) | `seed_lots.germination_pct` + `germination_tests` history | Complete as-is; `seed_lot_eligible()` already gates on it. |
| 12 | Test date | (a) | `seed_lots.germination_test_date`, `germination_tests.test_date` | Complete as-is. |
| 13 | Retest / sell-by date | (a)+(b) | (a) `seed_lots.next_review_date` (internal retest clock, already gates eligibility); (b) `seed_lots.sell_by_date date` (printed "packed for / sell by") | Two different facts; the printed date is compliance data, the review date is ops. Eligibility recheck must respect BOTH (`sell_by_date >= current_date` joins the `seed_lot_eligible` gate). |
| 14 | Treatment info | (b) | `seed_lots.treatment text` check (`UNTREATED|FUNGICIDE_TREATED|PELLETED|PRIMED|INOCULATED|UNKNOWN`) default `UNKNOWN`, + `seed_lots.treatment_notes text` | `UNKNOWN` ≠ `UNTREATED`. UNKNOWN triggers REVIEW_REQUIRED (§4.5). |
| 15 | Organic claim + certification reference | (b) | `seed_lots.organic_claim text` check (`CERTIFIED_ORGANIC|OMRI_LISTED|UNTREATED_CONVENTIONAL|CONVENTIONAL|UNKNOWN`) default `UNKNOWN`, + `seed_lots.organic_cert_ref text` (certifier + certificate #) | Lot-level (certification follows the seed lot, not the catalog entry). Admin-entered only; the AI never writes it (§4.5). |
| 16 | Country of origin | (b) | `seed_lots.country_of_origin text` | Free text, ISO-3166 alpha-2 preferred; label images (row 17) are the evidence. |
| 17 | Supplier label image (signed-URL storage) | (c) | table `seed_lot_documents` + private bucket `seed-lot-docs` | See §3.9. Signed-URL pattern copied from the 0043 `compliance-docs` private bucket. |
| 18 | Supplier documentation | (c) | `seed_lot_documents` rows with `kind` in (`SUPPLIER_DOC`,`COA`,`GERM_TEST_REPORT`,…) | Same table as row 17. |
| 19 | Purchase order | (c)+(b) | table `seed_purchase_orders`; (b) `seed_lots.purchase_order_id uuid → seed_purchase_orders(id)` | See §3.10. PO PDFs attach via `seed_lot_documents.purchase_order_id`. |
| 20 | Unit cost | (a, redefined) | `seed_lots.cost_cents` | DECISION to ratify: `cost_cents` = **total landed lot cost** (this is what `admin_seed_economics` already assumes: `cost_cents / original_qty`). Add a column comment; unit cost stays derived. `admin_receive_lot`'s prompt copy in the admin app must say "total cost for this lot". |
| 21 | Received date | (a) | `seed_lots.received_date` | Complete as-is. |
| 22 | Qty received | (a) | `seed_lots.original_qty` | Complete as-is. |
| 23 | Qty on-hand / reserved / available / damaged / recalled / quarantined / expired / shipped | (a)+(b)+view | See §3.1 — the quantity-state model | The single riskiest change; designed to preserve the engine's single-decrement rule. |
| 24 | Allowed destination states | (b) | `seed_products.ship_states_allowed text[]` (NULL = "all states cleared in `seed_state_clearance`") | Product-level: species restrictions (noxious/invasive lists) are per-crop. Effective set = clearance allowlist ∩ allowed − excluded (§3.3). |
| 25 | Excluded destination states | (b) | `seed_products.ship_states_excluded text[]` default `'{}'` | Always subtracts, even from an explicit allowed list. |
| 26 | Regulatory classification | (b) | `seed_products.regulatory_class text` check (`STANDARD_VEGETABLE|HERB|FLOWER|RESTRICTED|PROHIBITED`) default `STANDARD_VEGETABLE`, + `seed_products.regulatory_notes text` | `RESTRICTED` forces per-state arrays to be populated before the product is sellable; `PROHIBITED` is never sellable. |
| 27 | Current status | (a, enum extended) | `seed_lots.status` | Extend the check constraint with `'recalled'` and `'expired'` (drop + re-add constraint; additive to the value set — no data rewrite). `seed_lot_eligible()` already whitelists only fresh/active/aging, so new statuses are excluded automatically. |
| 28 | Recall status | (b) | `seed_lots.recall_status text` check (`NONE|SUPPLIER_RECALL|INTERNAL_RECALL|RESOLVED`) default `NONE`, + `seed_lots.recall_ref text` | Whole-lot recall also sets `status='recalled'` via `admin_set_lot_status` (audited). Partial recall uses the `qty_recalled` bucket (§3.1). |
| 29 | Admin notes | (a) | `seed_lots.notes`, `seed_lots.condition_notes` | Complete as-is. |
| 30 | Storage location | (a)+(b) | (a) `seed_lots.storage_location text` + `storage_locations` table; (b) `seed_lots.storage_location_id uuid → storage_locations(id)` | FK added; text kept as display/back-compat (same shape as row 1). |
| 31 | Storage conditions | (b) | `storage_locations.conditions text` (e.g. "cool/dark/dry, <50% RH") | Location-level fact; per-lot deviations already fit `condition_notes`. |
| 32 | Packet-scale + planting-guidance sources | (b) | `seed_products.packet_coverage_note text` ("sows ~10 row-ft") + `seed_products.guidance_sources jsonb` default `'[]'` (array of `{source, url, retrieved_on}`) + `seed_products.guidance_review_status text` check (`DRAFT|ADMIN_APPROVED`) default `DRAFT` | Non-compliance content: the AI MAY draft it, but only `ADMIN_APPROVED` guidance renders to customers (listing_drafts approval posture). |

**New-column tally:** `seed_products` 8 · `seed_lots` 21 · `storage_locations`
1 · `seed_drop_subscriptions` 5 (§3.2) = **35 new columns**, plus 2 new values
on the `seed_lots.status` check.

---

## 3. New structures

### 3.1 Quantity-state model (row 23) — buckets, not a second counter
The engine's correctness rests on one rule (0028): **`current_qty` is
decremented exactly once, inside a guarded UPDATE, at reservation time.**
Nothing in this plan introduces a second decrementable stock number.

- `current_qty` keeps its exact meaning: **available** sellable packets.
- **Reserved** is *derived*: open `seed_order_items` in
  (`reserved`,`picked`,`packed`) + `seed_packet_reservations` in `HELD`
  (§3.5), summed per lot. Never stored.
- **Shipped** is *derived*: `seed_order_items.status = 'shipped'` per lot.
- New **bucket columns** on `seed_lots`, all `numeric not null default 0
  check (>= 0)`: `qty_damaged`, `qty_recalled`, `qty_expired`. (Whole-lot
  quarantine stays what it is today — `status='quarantined'`, which
  `seed_lot_eligible()` already excludes; a *partial* quarantine is modeled
  as damage or recall bucket + note.)
- Buckets change ONLY via a new definer RPC
  `admin_move_lot_bucket(p_lot, p_bucket, p_qty, p_reason)`
  (perm `inventory.adjust`): decrements `current_qty`, increments the bucket
  (or the reverse for `RESOLVED` recalls), writes `seed_inventory_log` with
  reason `bucket:<name>: <reason>`, calls `admin_audit`. The generic
  `admin_adjust_lot` remains for plain count corrections.
- **On-hand** = `current_qty` + reserved(derived) + buckets. **Received** =
  `original_qty`.
- Reconciliation identity, exposed as view `seed_lot_position`
  (select-only, `inventory.view`):
  `original_qty = current_qty + reserved_open + qty_damaged + qty_recalled +
  qty_expired + shipped_total + net_manual_adjustments` — where
  `net_manual_adjustments` comes from `seed_inventory_log`. A nonzero
  residual renders as "unreconciled" in the admin Inventory screen; it is a
  displayed fact, never auto-corrected.

### 3.2 Drop-size subscriptions — columns on `seed_drop_subscriptions`
| Column | Definition |
|---|---|
| `size_tier` | `text check (size_tier in ('SIZE_4','SIZE_8','SIZE_12','CUSTOM'))` default `'SIZE_8'` |
| `drop_size` | `int check (drop_size between 4 and 20)` default 8 |
| `frequency` | `text check (frequency in ('EVERY_SEASON','EVERY_OTHER_SEASON','ONE_SEASON_TRIAL'))` default `'EVERY_SEASON'` |
| `control_mode` | `text check (control_mode in ('GNOME_PICKS','REVIEW_AND_APPROVE','I_CHOOSE'))` default `'GNOME_PICKS'` |
| `auto_substitution` | `boolean not null default false` — **opt-in**; false means a stock-out on an approved pick parks the order in `needs_review`, it does not silently swap |

Cross-check constraint: `(size_tier='SIZE_4' and drop_size=4) or
(size_tier='SIZE_8' and drop_size=8) or (size_tier='SIZE_12' and
drop_size=12) or (size_tier='CUSTOM' and drop_size between 4 and 20)`.

**Single-source rule:** `drop_size` is authoritative. `packet_count`
(1–24, read by `generate_seed_subscription_order` → engine) becomes a synced
mirror: extend the existing `seed_sub_guard()` trigger to set
`new.packet_count := new.drop_size` whenever `drop_size` is not null. The
engine, wave preview/generate, and economics are untouched. (Risk discussion
in 22 §6 — this is deliberate: the alternative is editing the live engine.)
Legacy `cadence` stays; `frequency` is the new authority for the seasonal
model (`cadence='seasonal'` enforced for new rows; `monthly` retired for V1
signup, kept in the check for old rows).
Grants: add the five new columns to the existing 0067 column-grant lists for
authenticated insert/update — EXCEPT nothing new touches billing state.
Eligibility: `EVERY_OTHER_SEASON` and `ONE_SEASON_TRIAL` are implemented as
generated skips inside `seed_sub_next_window` / wave-generate predicates (a
frequency check joins the existing skip/already-generated exclusions), not as
a scheduler.

### 3.3 `seed_state_clearance` — the ALLOWLIST (new table)
```
state          text primary key check (state ~ '^[A-Z]{2}$')
status         text not null check (status in
                 ('CLEARED','REGISTRATION_REQUIRED',
                  'AGENCY_CONFIRMATION_REQUIRED','BLOCKED'))
source_refs    jsonb not null default '[]'   -- citations into docs/seed-drop/matrix/
verified_date  date
verified_by    uuid                          -- admin user
review_by      date                          -- when to re-verify
notes          text
updated_at     timestamptz not null default now()
```
**Allowlist semantics (invariant):** a state ships ONLY if a row exists with
`status = 'CLEARED'`. A missing row, or any other status, blocks — the other
three statuses exist to tell Daniel *why* and what unblocks it. The app never
treats this table as a blocklist.
Enforcement function `seed_ship_state_allowed(p_state text, p_product uuid
default null) returns boolean` (stable, definer): clearance row CLEARED
**and** (product's `ship_states_allowed` is null or contains state) **and**
state not in product's `ship_states_excluded` **and** product
`regulatory_class <> 'PROHIBITED'`. Called server-side at: subscription
create/address change (trigger on `seed_drop_subscriptions`), checkout
(billing-checkout), wave generate (predicate + per-order recheck), and pack
(`admin_pack_seed_order` gains the recheck) — see §4.2.
RLS: world/anon **select** (contains nothing sensitive; the web signup form
needs it pre-auth) — `seed_season_windows` read pattern. Writes: NO client
grants; owner/compliance-only definer RPC
`admin_set_state_clearance(p_state, p_status, p_sources, p_notes)` gated on
`compliance.rules_manage` OR `admin_is_owner()`, always via `admin_audit` —
the `billing_config` / `admin_set_payments_live` pattern.
Population source: the state matrix (`docs/seed-drop/matrix/`, Phase 0 in
doc 23). Seeded EMPTY by migration — an empty allowlist correctly ships
nowhere until Daniel clears states.

### 3.4 `seed_capacity_controls` — admin-editable caps/toggles (new table)
Singleton, exactly the `billing_config` shape (`id boolean primary key
default true check (id)`, one row inserted by migration):
`ordering_paused boolean default false` (kill switch),
`waitlist_enabled boolean default true`,
`custom_sizes_enabled boolean default true`,
`max_active_subscribers int`, `max_new_subscribers_per_window int`,
`max_packets_per_window int`, `max_custom_size int default 20`,
`reservation_ttl_minutes int default 30 check (between 5 and 1440)`,
`per_state_caps jsonb default '{}'` (e.g. `{"OH": 200}`),
`updated_by uuid`, `updated_at`.
NULL cap = unlimited. RLS: select for `admin_has_perm('seed_drop.view')` +
a public-safe reader function `seed_ordering_open() returns jsonb` (definer,
returns only `{open, waitlist_enabled, reason}`) for the signup screens.
Writes: no client grants; RPC `admin_set_capacity_controls(...)` gated
`seed_drop.manage` or owner, audited via `admin_audit` with old/new jsonb —
copies `admin_set_payments_live` exactly. Every cap is enforced
**server-side** in `join_seed_drop` / checkout / wave-generate; UI copies are
display-only.

### 3.5 `seed_packet_reservations` — reservations with expiry (new table)
Today the only reservation is engine-at-generate. Customer-facing size
selection and `I_CHOOSE` picks need a short-lived hold between "chose" and
"paid".
```
id               uuid pk
user_id          uuid not null → profiles
subscription_id  uuid → seed_drop_subscriptions
order_id         uuid → seed_orders          -- set on conversion
seed_product_id  uuid not null → seed_products
lot_id           uuid not null → seed_lots
qty_packets      int not null default 1 check (qty_packets > 0)
status           text not null default 'HELD' check (status in
                   ('HELD','CONVERTED','RELEASED','EXPIRED'))
expires_at       timestamptz not null
created_at / released_at timestamptz
```
Index `(status, expires_at)` partial where `status='HELD'`; index `(user_id)`.
**Atomicity (invariant §4.3):** creating a HELD row uses the SAME guarded
single-decrement as the engine — `update seed_lots set current_qty =
current_qty - qty where id = … and current_qty >= qty`, then insert the row
and a `seed_inventory_log` entry (`reason 'reserved'`), all in one definer
RPC `reserve_seed_packets(...)`. Release/expiry is the mirror image and is
**idempotent**: `update … set status='EXPIRED' where id=… and status='HELD'`
guards the increment — a double-fired expiry job restores stock once.
`expire_seed_reservations()` (definer, callable by service role/admin, safe
under pg_cron or lazy invocation from reads — the `expire_finished_promotions`
0081 pattern). Conversion to an order re-tags the row `CONVERTED` and creates
the `seed_order_items` rows WITHOUT touching `current_qty` again (the
decrement already happened).
RLS: own-read (`user_id = auth.uid()` or `seed_drop.view`); **no** client
insert/update/delete grants — all writes through the definer RPCs
(`listing_drafts` service-role-insert posture).

### 3.6 `seed_waitlist` (new table)
Activates when `seed_capacity_controls` closes ordering (`waitlist_enabled`).
```
id                uuid pk
user_id           uuid not null → profiles (cascade)
ship_state        text not null check (ship_state ~ '^[A-Z]{2}$')
desired_size_tier text check (in ('SIZE_4','SIZE_8','SIZE_12','CUSTOM'))
window_id         uuid → seed_season_windows   -- optional: waiting for a window
status            text not null default 'WAITING' check (in
                    ('WAITING','INVITED','CONVERTED','EXPIRED','REMOVED'))
created_at        timestamptz not null default now()
invited_at        timestamptz
invite_expires_at timestamptz
```
Partial unique `(user_id)` where `status = 'WAITING'` — one live spot per
person; position is derived from `created_at`, never stored.
Joins go through definer RPC `join_seed_waitlist()` which re-validates
`seed_ship_state_allowed()` and that ordering is actually closed (no
waitlisting a state that can just order). Invites are admin-only
(`admin_invite_from_waitlist`, audited) with an expiry; conversion happens in
the normal signup flow which flips the row `CONVERTED`.
RLS: own-read (`user_id = auth.uid()` or `seed_drop.view`); no client
insert/update/delete grants — RPC-only writes (`listing_drafts` posture).

### 3.7 `seed_drop_selections` — per-drop picks with WHY + approval + substitution audit (new table)
`seed_order_items` stays the *physical* truth (which packet from which lot).
Selections are the *intent/approval* layer that `REVIEW_AND_APPROVE` and
`I_CHOOSE` modes need, and the substitution audit trail.
```
id                        uuid pk
subscription_id           uuid → seed_drop_subscriptions
order_id                  uuid → seed_orders        -- null until generated
window_id                 uuid → seed_season_windows
seed_product_id           uuid not null → seed_products
qty_packets               int not null default 1
source                    text check (source in
                            ('ENGINE','CUSTOMER','ADMIN','AI_SUGGESTED'))
why                       text            -- plain-English reason
why_source                text check (why_source in
                            ('ENGINE_RULES','SEED_RECOMMENDATIONS',
                             'CUSTOMER','ADMIN','AI_DRAFT'))
approval_state            text not null default 'PROPOSED' check (in
                            ('PROPOSED','AUTO_APPROVED','CUSTOMER_APPROVED',
                             'ADMIN_APPROVED','REJECTED','SUBSTITUTED'))
approved_by               uuid
approved_at               timestamptz
substituted_from_product  uuid → seed_products
substitution_reason       text
substitution_actor        text check (in ('ENGINE','ADMIN','CUSTOMER'))
substituted_at            timestamptz
created_at / updated_at   timestamptz
```
Unique `(order_id, seed_product_id)` where order_id is not null.
Flow: `GNOME_PICKS` → engine writes rows `source='ENGINE'`,
`approval_state='AUTO_APPROVED'`, `why` from `seed_recommendations()`'s
existing text (one suitability definition — never a second one).
`REVIEW_AND_APPROVE` → rows land `PROPOSED`; customer approves before the
join cutoff; unapproved at generation follows `auto_substitution` (true →
engine substitutes and records the audit trio; false → order `needs_review`).
`I_CHOOSE` → customer picks write `source='CUSTOMER'` backed by a §3.5
reservation. AI participation is `source='AI_SUGGESTED'` +
`approval_state='PROPOSED'` ONLY — the `listing_drafts` rule: drafts never
self-publish (§4.5).
RLS: own-read via subscription/order ownership or `seed_drop.view`; customer
UPDATE limited by column grants to `approval_state` transitions
(`PROPOSED → CUSTOMER_APPROVED|REJECTED`) enforced by a guard trigger
(`seed_sub_guard` pattern); all other writes via definer RPCs.

### 3.8 `seed_journal_entries` — feedback / germination journal (new table)
```
id                  uuid pk
user_id             uuid not null → profiles (cascade)
seed_order_id       uuid → seed_orders
seed_order_item_id  uuid → seed_order_items
seed_product_id     uuid → seed_products
lot_id              uuid → seed_lots        -- copied from the item at write
entry_type          text check (in ('PLANTED','GERMINATED','GROWING',
                      'HARVEST','FEEDBACK','ISSUE','PHOTO_NOTE'))
seeds_planted       int
seeds_germinated    int
germination_pct_observed numeric check (between 0 and 100)
rating              int check (between 1 and 5)
body                text
photos              text[] not null default '{}'
created_at          timestamptz
```
The lot linkage is the point: customer-observed germination aggregates per
lot in an admin view `admin_seed_lot_feedback` (perm `inventory.view`) and
can *prompt* a real `germination_tests` retest — it NEVER auto-writes
`seed_lots.germination_pct` (§4.5).
RLS: **owner-only full policy** — `for all using (auth.uid() = user_id) with
check (auth.uid() = user_id)`, the `user_private_contact` 0086 pattern; no
world/admin row-level read of prose (admins see only the aggregate view).
Photos → existing user-scoped storage posture (grow-log 0049 bucket pattern,
own-folder).

### 3.9 `seed_lot_documents` + private bucket `seed-lot-docs` (new)
```
id                 uuid pk
lot_id             uuid → seed_lots
seed_product_id    uuid → seed_products
purchase_order_id  uuid → seed_purchase_orders
kind               text not null check (in ('LABEL_IMAGE','SUPPLIER_DOC',
                     'COA','GERM_TEST_REPORT','PO_DOCUMENT','OTHER'))
storage_path       text not null            -- object in seed-lot-docs
uploaded_by        uuid not null
notes              text
created_at         timestamptz
```
Check: at least one of lot/product/PO set. Bucket `seed-lot-docs` is
**private** (`public = false`), reads via short-lived signed URLs — the 0043
`compliance-docs` pattern, but org-scoped instead of owner-folder: storage
select/insert/delete policies require `admin_has_perm('inventory.view')` /
`('inventory.edit')`. Table RLS the same perms; uploader recorded; no anon or
plain-authenticated grants. Label images are the evidence backing rows
14–16/26 — the admin UI shows the image beside the typed fields at receive
time.

### 3.10 `seed_purchase_orders` (new table)
```
id             uuid pk
supplier_id    uuid not null → suppliers
po_number      text not null
status         text not null default 'ORDERED' check (in
                 ('DRAFT','ORDERED','PARTIAL','RECEIVED','CANCELLED'))
ordered_at     date
expected_at    date
received_at    date
subtotal_cents int / shipping_cents int / tax_cents int / total_cents int
notes          text
created_by     uuid
created_at / updated_at timestamptz
unique (supplier_id, po_number)
```
`seed_lots.purchase_order_id` links each received lot to its PO;
`admin_receive_lot` gains an optional `p_purchase_order uuid`. RLS: the 0028
`seed_lots` admin posture (perm `inventory.view` read / `inventory.edit`
write via RPC `admin_upsert_purchase_order`, audited).

**New-structure tally: 8 new tables** (`seed_state_clearance`,
`seed_capacity_controls`, `seed_packet_reservations`, `seed_waitlist`,
`seed_drop_selections`, `seed_journal_entries`, `seed_lot_documents`,
`seed_purchase_orders`) **+ 1 view** (`seed_lot_position`) **+ 1 new private
storage bucket** (`seed-lot-docs`).

---

## 4. Invariants (binding on every migration and RPC in this plan)

### 4.1 Additive, reversible migrations only
Every migration adds tables/columns/values or replaces function bodies. No
column drops, no type rewrites, no destructive backfills. Check-constraint
changes only widen value sets. Each file ends with a rollback sketch (0028
convention) and pairs with a `_down` file where state changes are non-trivial
(0087 convention). `notify pgrst, 'reload schema'` closes every file.

### 4.2 Server-side eligibility rechecks
State/capacity/season eligibility is checked where the money or the mutation
happens, never only in the UI: (1) subscription create + ship-address change
(trigger calls `seed_ship_state_allowed`), (2) billing-checkout before a
session is created, (3) wave generation predicate AND per-order, (4)
`admin_pack_seed_order` — the last gate before a box leaves. A state
un-cleared between payment and pack blocks at pack with an explicit error;
resolution is a human decision (refund or hold), never silent.

### 4.3 Atomic reservation — the single-decrement rule
Reservation of stock happens exactly once per packet, inside a guarded
UPDATE (`… where current_qty >= qty`), in one transaction with the item/
reservation row and the `seed_inventory_log` entry — exactly as
`generate_seed_drop` does today (0028). `seed_packet_reservations` reuses the
rule; conversion to an order NEVER decrements again; release/expiry restores
exactly once, guarded by the status transition. No second stock counter
exists anywhere (§3.1).

### 4.4 Idempotent payment / webhook / expiry / release
Stripe events: insert-first on `stripe_events.id` (webhook v15). Money
effects: unique keys per session/order (`seed_orders.stripe_session_id`,
partial unique `(season_window_id, user_id)`, `unique_violation → false`
pattern of `billing_grant_promo_credit`). New paths inherit this:
reservation conversion keys on the reservation id; expiry/release are
status-guarded (§3.5); wave generation is re-runnable (0081). Every new
billing effect also logs to `billing_events` with `livemode`.

### 4.5 AI never writes compliance / label / lot data
Germination %, treatment, organic claim + cert ref, country of origin,
sell-by, recall status, state clearance, regulatory class, lot quantities,
and destination-state arrays are **admin-human-entered only** — no AI agent,
edge function acting for an agent, or draft pipeline may write them.
AI may: draft `guidance_sources` / coverage notes (rendered only after
`ADMIN_APPROVED`), and propose `seed_drop_selections` rows
(`source='AI_SUGGESTED'`, `approval_state='PROPOSED'`) — the `listing_drafts`
0086 posture: the AI's only arm writes drafts a human approves.
**Missing data → REVIEW_REQUIRED:** a lot whose compliance-critical fields
are UNKNOWN/NULL (treatment, organic_claim when marketed organic,
country_of_origin, sell_by) gets `compliance_review_required = true`
(new boolean on `seed_lots`, set by a completeness check inside
`admin_receive_lot` and on edit); `seed_lot_eligible()` is extended to
exclude such lots, so the engine can physically never pick them —
shortfalls surface as `needs_review` orders, the honest failure mode the
engine already has.

### 4.6 Money and revenue
All new billing rows carry `stripe_livemode`; live revenue counts
`livemode = true` only (0083). `billing_config.payments_live_enabled` stays
FALSE until Daniel flips it — no schema in this plan changes that gate.
