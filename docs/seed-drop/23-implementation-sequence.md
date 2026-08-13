# 23 — Seed Drop V1: Implementation Sequence

**Status:** PLAN ONLY. Phases execute in order; a phase does not start until
the previous phase's test gate passes and its approval items are signed.
**Date:** 2026-08-13
**Companions:** 17-database-plan.md (schema), 22-repo-changes.md (files).
**Test gates** reference 21-test-plan.md (parallel lane, pending). Gate IDs
below use stable prefixes (T-INV, T-STATE, T-CAP, T-SUB, T-RES, T-SEL, T-FUL,
T-JRN, T-PRC) so the 21 lane can adopt them; reconcile IDs when that file
lands — until then each gate's plain-English criterion is authoritative.

---

## Phase 0 — REGULATORY GATE (nothing ships before this)

**Work:** populate `docs/seed-drop/matrix/` (per-state seed-sales/labeling
requirements with sources); Daniel reviews and approves the **compliance
model** (what Gnome claims, what the label/insert says, which statuses in
`seed_state_clearance` mean what, the pack-time block policy from 22 §6.3);
derive the initial CLEARED state list from the matrix.
**Output:** approved matrix + a signed list of launch states. The
`seed_state_clearance` table (Phase 1) is populated ONLY from this output.
**Test gate:** none (document gate) — but 21's T-STATE cases are written
against the approved matrix here.
**Rollback:** n/a (docs only).
**Daniel approval required:** compliance model + launch states. **Hard
stop:** no migration, screen, or price activates before this sign-off.

## Phase 1 — Backend foundations

**Work:** pre-work P1–P3 (22 §1: recover 0084 record, verify live
`seed_profiles`, confirm next migration number), then migrations
`0088_seed_inventory_compliance.sql` and `0089_seed_state_clearance.sql`;
populate the allowlist from Phase 0 output via `admin_set_state_clearance`
(audited rows, sources cited into `matrix/`).
**Test gate (blocks Phase 2):**
- T-INV-01..n: every 17 §2 field writable/readable through the extended
  RPCs; `seed_lot_eligible()` excludes recalled/expired/sell-by-past/
  review-required lots; existing engine behavior on pre-0088 lots unchanged
  (regression: 53/53 owner-hub checks still pass).
- T-INV-R1: `seed_lot_position` identity holds after receive → reserve →
  bucket-move → release → ship on a scratch lot.
- T-STATE-01..n: missing row blocks; only CLEARED ships; product
  allowed/excluded precedence; address-change trigger; pack-time recheck.
**Rollback:** migrations are additive — rollback = the paired down-sketches
(drop new tables/columns, restore prior `seed_lot_eligible` +
`admin_pack_seed_order` bodies). No data loss possible before Phase 3 since
no customer flow writes yet.

## Phase 2 — Admin controls

**Work:** migration `0091_seed_capacity_reservations.sql` (capacity singleton
+ reservations + waitlist, RPCs); admin screens from 22 §4.3: Inventory
compliance fields + label-image upload, State Clearance editor, Capacity
screen, Waitlist screen; Seasons preview gains state/capacity breakdown.
**Test gate (blocks Phase 3):**
- T-CAP-01..n: every cap enforced server-side (RPC-level tests with UI
  bypassed); `ordering_paused` kill switch; audit rows on every change.
- T-RES-01..n: reservation single-decrement; expiry idempotent under double
  fire; conversion never double-decrements; TTL honored.
- T-INV-UI: label image upload → signed URL render round-trip (private
  bucket; anon fetch fails).
**Rollback:** feature-level — `ordering_paused = true` freezes everything new
instantly; migration down-sketch drops the three tables (no customer rows
exist until Phase 3 launches).

## Phase 3 — Customer flows

**Work:** migration `0090_seed_drop_sizes.sql` (may be applied in Phase 2
window if convenient — it is a Phase 3 dependency); edge-function changes
(billing-checkout sizes + eligibility/capacity prechecks; stripe-webhook
size keys + reservation conversion — TEST MODE ONLY, live gate stays FALSE);
web `seeds/` checkout swap + subscribe/manage pages; expo `seed-drop/`
screens (landing, profile, size, review shell).
**Test gate (blocks Phase 4):**
- T-SUB-01..n: size/frequency/control-mode/auto-sub persistence;
  `packet_count` mirror never diverges from `drop_size` (property test:
  direct-grant update paths); guard trigger still blocks billing-state theft.
- T-SUB-STRIPE: full test-mode round-trip per size key (session → webhook →
  order/reservation conversion → `billing_events` rows, livemode=false),
  replayed events change nothing — repeat of the 2026-08-12 QA discipline.
- T-STATE-E2E: signup from a non-cleared state is blocked at UI, checkout,
  AND RPC layers independently.
**Rollback:** billing product keys stay `active=false` until this gate
passes; deactivating the keys + `ordering_paused=true` fully retracts the
flow; web keeps the legacy Payment-Link code path behind a flag for one
release as the fallback.
**Daniel approval required:** drop naming/copy on the customer screens.

## Phase 4 — Packing & fulfillment

**Work:** migration `0092_seed_drop_selections.sql` (selections + approval +
substitution audit; the one engine edit); Fulfill-tab changes (selections,
substitute action, blocked-state errors, review-required badges); notify
kinds for approval windows.
**Test gate (blocks Phase 5):**
- T-SEL-01..n: GNOME_PICKS auto-approval WHY text matches
  `seed_recommendations()`; REVIEW_AND_APPROVE unapproved + auto-sub=false →
  `needs_review` (never silent substitution); substitution audit trio
  recorded; AI can only create `AI_SUGGESTED/PROPOSED` rows.
- T-FUL-01..n: pick→pack→ship with selections attached; pack blocked on
  un-cleared state; wave generate honors frequency + selections; engine
  regression suite (0028 behaviors) green — this is the highest-risk gate.
**Rollback:** the engine edit ships as a carried-forward 0028 body + guarded
additions; rollback = re-apply prior `generate_seed_drop` body (kept in the
down file). Selections table is additive and ignorable by the old body.

## Phase 5 — Guidance & journal

**Work:** migration `0093_seed_journal.sql`; expo/web journal screens;
assistant/planner read-only context; shipped-journal nudge notifications;
guidance-source drafting (AI drafts, admin approves).
**Test gate (blocks Phase 6):**
- T-JRN-01..n: owner-only RLS (cross-user read fails); aggregate view exposes
  no prose; journal germination never writes `seed_lots.germination_pct`.
- T-AI-01: assistant tool surface cannot mutate any 17 §4.5 field
  (tool-schema audit + negative tests).
**Rollback:** screens behind a flag; table additive.

## Phase 6 — Pricing activation & launch

**Work:** Daniel sets per-size prices; test→live Stripe product/price mapping
on `billing_products` (test columns first, live columns only at launch);
docs updates (22 §5); store release build for the new expo screens.
**Test gate (launch gate):**
- T-PRC-01..n: `admin_billing_health` shows test_ready per size key; one
  final full test-mode round-trip per purchasable key; revenue split correct
  in Revenue screen (live=0 until launch).
- Launch checklist: Phase 0 states loaded, capacity caps set, kill switch
  tested, refund/cancel paths verified (existing webhook refund handling).
**Rollback:** `admin_set_payments_live(false)` + `ordering_paused=true` — two
audited switches return the system to pre-launch state without a migration.
**Daniel approval required (explicit, each its own sign-off):**
1. Compliance model (Phase 0 — prerequisite for everything),
2. Pricing (per-size amounts + custom-size formula),
3. Drop naming (customer-facing copy, Phase 3),
4. Launch states (the initial CLEARED list, and every later addition),
5. Store release (app-store submission of the new expo screens),
6. Live-gate flip (`payments_live_enabled` — stays FALSE until this line).

---

## Sequence summary

```
P0 regulatory gate ─► P1 backend (0088, 0089)
                      ─► P2 admin controls (0091 + screens)
                         ─► P3 customer flows (0090 + checkout/webhook + web/expo)
                            ─► P4 packing/fulfillment (0092 engine edit)
                               ─► P5 guidance/journal (0093)
                                  ─► P6 pricing activation + launch
```
One executor per round (concurrent-session rule); each phase lands as one
reviewed PR; migrations apply to production only at their phase boundary,
never ahead of their gate.
