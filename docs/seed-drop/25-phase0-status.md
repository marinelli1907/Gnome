# 25 — Seed Drop Phase 0: what is built, and what it deliberately does not do

2026-08-13. Companion to [17-database-plan.md](17-database-plan.md) and
[23-implementation-sequence.md](23-implementation-sequence.md). Reflects
Daniel's 2026-08-13 directive, which takes precedence over the plan where the
two differ.

## Status in one line

`supabase/migrations/0089_seed_drop_compliance_foundation.sql` is written,
tested (59/59), proven idempotent and reversible — and **not applied to any
database**. It is declared in `supabase/migrations/UNAPPLIED.txt`.

**Seed Drop sells nothing, nowhere.** Applying 0089 would not change that:
every gate ships closed and the state allowlist is seeded empty.

## The one rule the schema exists to enforce

Eligibility is decided at **supplier × labeled entity × packet/lot ×
destination state × date**, and it fails closed. Concretely, `seed_ship_state_allowed()`
returns false unless *all* of the following hold:

1. the destination is one of the contiguous 48 (AK, HI, territories, APO/FPO/DPO
   and DC are structurally unsupported in V1);
2. `seed_drop_enabled` is on, and — while `interstate_enabled` is off — the
   destination is Ohio with `ohio_pilot_enabled` on;
3. a `seed_state_clearance` row exists with `status = 'CLEARED'`;
4. **and** that row has `enabled_for_checkout = true` — a separate, audited,
   human act. Research never opens a state;
5. the clearance date window is open and any required Gnome registration has a
   reference recorded;
6. the product is sellable in V1 and the state passes its allowed/excluded
   arrays and product-class restrictions;
7. the lot is not recalled, quarantined, expired, past sell-by, or flagged
   `compliance_review_required`;
8. **and** the lot's `labeled_entity` holds a `VERIFIED`, in-date credential for
   that state.

Point 8 is the one worth restating: **a cleared state never clears a packet
whose labeled entity lacks that state's credential.** A "cleared" state with an
uncredentialed supplier ships nothing — test `T-CRED-01`.

## What was built

| Structure | Purpose |
|---|---|
| `seed_supplier_credentials` | Per-labeled-entity, per-state credential ledger. `UNVERIFIED` by default; `VERIFIED` requires a citable source (`T-CRED-03`). |
| `seed_state_clearance` | The allowlist. `status` is the research conclusion; `enabled_for_checkout` is Daniel's act. Seeded **empty**. |
| `seed_capacity_controls` | Singleton: master/checkout/Ohio-pilot/interstate gates, enrollment mode, caps, per-state caps, seasonal window, supplier + carrier outage, recall pause, emergency pause, reservation TTL. |
| `seed_packet_reservations` | 48-hour holds with atomic single-decrement, idempotency keys, bounded payment-failure recovery, idempotent release/expiry. |
| `seed_purchase_orders`, `seed_lot_documents` | PO ledger and private regulatory documents (bucket `seed-lot-docs`, admin-only, signed-URL reads). |
| 30 columns on `seed_products` / `seed_lots` | Labeled entity, treatment, organic claim + cert, country of origin, sell-by, recall status, exact vs estimated seed counts with source and confidence, damaged/recalled/expired buckets, destination arrays, regulatory class. |
| 7 columns on `seed_drop_subscriptions` | Size tier, drop size, frequency, control mode, opt-in substitution, pause/cancel timestamps. |
| 10 new `seed_orders` statuses | delivered · delivery_issue · missing_packet · damaged_packet · replacement_pending · replacement_shipped · refunded · recalled · compliance_blocked (+ cancelled/needs_review). |

## Locked product decisions, as implemented

- **Patio 4 · Garden 8 · Homestead 12 · Build Your Drop 4–20.** "Harvest Drop"
  is gone; `seed_drop_tier_label()` is the single source of the names, and a
  check constraint makes tier and size agree (`T-SUB-04/05/06`).
- **Monthly · Every other month · Seasonal · One-time** (`T-SUB-07/08`).
- **Four selection modes:** `SURPRISE_ME`, `LET_ME_APPROVE`, `BUILD_WITH_ME`,
  `CHOOSE_THEN_ADD` (`T-SUB-09`).
- **Pause · skip · change frequency · change size · cancel** are all
  recordable (`T-SUB-10`).
- **48-hour reservation** (`reservation_ttl_minutes` default 2880, `T-RES-02`),
  atomic allocation, idempotent release, expiry worker, bounded payment-failure
  window, and **no silent substitution** — `auto_substitution` is opt-in and
  defaults false (`T-SUB-11`).
- **Garlic and all planting stock are excluded from V1** structurally, via
  `regulatory_class = 'BULB_OR_PLANTING_STOCK'` and
  `seed_product_sellable_v1()` (`T-PROD-03`). See
  [26-roadmap-bulbs-planting-stock.md](26-roadmap-bulbs-planting-stock.md).

## The `packet_seed_count` correction

`seed_products.packet_seed_count int NOT NULL DEFAULT 25` asserted a measured
fact about every packet that nobody had measured. 0089:

- adds `packet_seed_count_source`;
- labels every pre-existing row — a 25 that was never verified becomes
  `LEGACY_ASSUMED_25`, **not** 0 and **not** NULL (`T-LOT-04`);
- then drops the default and the NOT NULL, so "unknown" is finally
  representable (`T-LOT-03`);
- adds lot-level `seed_count_exact` (only when the supplier states it) and
  `seed_count_estimated` + source + confidence, kept in separate columns so an
  estimate can never masquerade as a supplier-stated count.

The rollback restores the old contract, writing 25 back into any NULL — the one
place the down-migration touches data, and deliberately the same value the old
default asserted.

## Security posture

Written against the 0087 finding rather than around it. Supabase's default
privileges grant `anon`/`authenticated` ALL on every new table, and
`revoke … from public` does **not** remove a role grant — so 0089 revokes from
the roles by name, and then **fails the migration** if any of the six new tables
is left writable by a client role. The suite re-asserts it independently
(`T-SEC-01/02/03`). Regulatory tables are not client-readable at all; only
`seed_state_clearance` is public (it must answer "we don't ship to your state
yet" before sign-in, and holds no personal data). Every admin mutation runs
through an audited definer RPC and is refused for non-admins
(`T-SEC-04/05/06`).

## Tests

```bash
cd ~/BooneSystems/Gnome && bash supabase/tests/run_seed_drop_phase0_tests.sh
```

**59/59 pass.** The harness builds a throwaway local database (Supabase shim +
a fixture mirroring production's shapes), applies 0089, runs the suite, applies
0089 a second time (idempotent), then applies the down-migration and verifies
all six tables are gone and `packet_seed_count NOT NULL` is restored.

Coverage maps to the directive's list: default-deny · cleared-without-credential
· valid/expired/revoked/unverified credential · wrong labeled entity · packet
and lot restrictions · nullable seed count · 4/8/12/custom · custom out of
bounds · four frequencies · four modes · pause/cancel · 48-hour reservation ·
expiry · double release · oversell · payment failure · recall · stop-sale ·
admin authorization · cross-user isolation · view/grant regression ·
Ohio-pilot-disabled · unsupported address classes.

**Not covered here** (needs a running PostgREST/Stripe, so it belongs to a later
phase): true concurrent-session inventory races (the guarded UPDATE is the
mechanism, and single-session oversell is covered), abandoned Stripe checkout,
and signed-URL document retrieval.

## What Phase 0 deliberately does not include

No customer-facing screens, no checkout path, no Stripe changes, no pricing, no
state data (the allowlist is empty), no wave/engine changes, and no
`seed_drop_selections` / `seed_waitlist` / `seed_journal_entries` tables — those
belong to Phases 2–3 in doc 23, after the gates that Phase 0 exists to build.
