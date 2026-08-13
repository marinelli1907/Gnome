# 22 — Seed Drop V1: Repository Change Plan

**Status:** PLAN ONLY — nothing in this file is to be implemented yet.
**Date:** 2026-08-13
**Companion docs:** 17-database-plan.md (field-level schema), 23-implementation-sequence.md (order + gates), 21-test-plan.md (parallel lane, pending).

Risk legend: **L** low (additive, isolated) · **M** medium (touches shared
paths) · **H** high (touches the engine, money, or compliance enforcement).

---

## 1. Pre-work: repo hygiene before any new migration

| Item | What | Depends on | Risk |
|---|---|---|---|
| P1 | **Recover the missing 0084 repo record.** The webhook calls `billing_pay_seed_seasonal`, `billing_purchase_and_promote`, `billing_activate_bundle` — none exist in `supabase/migrations/`. The file numbered 0084 is absent (0083 → 0085). Reconstruct from production (`list_migrations` / function bodies) the way 0043 documents it was done, commit as `0084_<live-name>.sql` marked "repo record of applied migration". | production access | **M** — new migrations must not collide with or redefine these live functions blindly |
| P2 | Confirm live column state of `seed_profiles` (0030/0056 are stub files — `garden_sizes`, `suns`, `experiences`, `packet_count` documented but bodies live only in production) before writing DDL that touches it. | production access | L |
| P3 | Resolve the duplicate `0087_*.sql` pair (up + down share the number — fine, but the next number must be checked against production migration history, not just the directory listing). | P1 | L |

## 2. New migrations (`supabase/migrations/`) — names + one-line contents

Numbering assumes 0088 is next free after P1–P3 confirm; renumber mechanically
if production says otherwise. Order is a dependency chain.

| File | One-line contents | Depends on | Risk |
|---|---|---|---|
| `0088_seed_inventory_compliance.sql` | Identity/compliance columns from 17 §2 on `seed_products` (8 cols) + `seed_lots` (21 cols incl. buckets + `compliance_review_required`) + `storage_locations.conditions`; extend `seed_lots.status` check (+`recalled`,`expired`); extend `seed_lot_eligible()` (sell-by + recall + review-required gates); `seed_purchase_orders` table + `admin_upsert_purchase_order`; `admin_move_lot_bucket` RPC; `seed_lot_position` view; extend `admin_receive_lot` signature (compliance params + `p_purchase_order`); `seed_lot_documents` table + private bucket `seed-lot-docs` + storage policies. | P1–P3 | **H** (touches `seed_lot_eligible`, which the live engine calls) |
| `0089_seed_state_clearance.sql` | `seed_state_clearance` allowlist table (empty seed) + `seed_ship_state_allowed()` + `admin_set_state_clearance()` (audited) + ship-address guard trigger on `seed_drop_subscriptions` + recheck inside `admin_pack_seed_order`. | 0088 | **H** (compliance enforcement; an empty allowlist blocks all shipping by design) |
| `0090_seed_drop_sizes.sql` | Five subscription columns (`size_tier`, `drop_size`, `frequency`, `control_mode`, `auto_substitution`) + cross-check constraint + `seed_sub_guard()` extension (packet_count mirror + new-column transition rules) + column-grant additions + frequency predicate in `seed_sub_next_window` / `admin_seed_wave_preview` / `admin_seed_wave_generate` + `billing_products` keys `GNOME_SEED_DROP_S4/S8/S12` (inactive, unit amounts = owner pricing decision). | 0088 | **M** (trigger + wave predicates; engine body untouched) |
| `0091_seed_capacity_reservations.sql` | `seed_capacity_controls` singleton + `admin_set_capacity_controls()` (audited) + `seed_ordering_open()` public reader + `seed_packet_reservations` table + `reserve_seed_packets()` / `expire_seed_reservations()` / `convert_seed_reservation()` definer RPCs (single-decrement + idempotent release per 17 §4.3) + `seed_waitlist` table + `join_seed_waitlist()` / `admin_invite_from_waitlist()`. | 0089, 0090 | **M** |
| `0092_seed_drop_selections.sql` | `seed_drop_selections` table + approval guard trigger + RPCs (`propose_drop_selections` — engine/AI-draft writer, `approve_drop_selection`, `admin_substitute_selection`) + engine-adjacent change: `generate_seed_drop` writes selection rows with `why` sourced from `seed_recommendations()` text; honor `control_mode` + `auto_substitution` at generation (unapproved + no-auto-sub → `needs_review`). | 0090, 0091 | **H** (the ONLY migration that edits `generate_seed_drop`; carries the 0028 body forward verbatim except the additions) |
| `0093_seed_journal.sql` | `seed_journal_entries` (owner-only RLS, `user_private_contact` pattern) + `admin_seed_lot_feedback` aggregate view + retest-prompt query in `admin_inventory_summary`. | 0088 | L |
| (per migration) | Matching `_down` sketch or `NNNN_down_*.sql` where warranted (0087 convention). | each | L |

**Waitlist table note:** `seed_waitlist` (17 §3 tally) rides in 0091 with the
capacity controls that decide when it activates.

## 3. Edge functions (`supabase/functions/`)

| Function | Change | Depends on | Risk |
|---|---|---|---|
| `billing-checkout/index.ts` | Extend for size tiers: accept `GNOME_SEED_DROP_S4/S8/S12` keys; before session create — `seed_ship_state_allowed()` recheck on the sub's ship_state, `seed_ordering_open()` + capacity check, convert any HELD reservation intent; unchanged live-gate/ownership-binding logic. | 0090, 0091 | **M** |
| `stripe-webhook/index.ts` | Map the new per-size price keys; on `checkout.session.completed` for seed sizes call `convert_seed_reservation()`; on activation over capacity → keep `incomplete` + waitlist path (no silent overshoot); keep every effect idempotent + `billing_log_event`'d. | 0090, 0091 | **H** (money path; full test-mode round-trip required per 21) |
| `notify/` | New notification kinds: reservation-expiring, selection-approval-window, drop-shipped journal nudge, waitlist invite. | 0091–0093 | L |
| `gnome-assistant/`, `garden-planner/` | Read-only additions: journal context + approved guidance sources; enforce 17 §4.5 (no tool may write compliance/lot data; selection proposals go through `propose_drop_selections` as `AI_SUGGESTED` drafts). | 0092, 0093 | **M** (prompt/tool-schema review needed) |
| NEW `seed-eligibility/` (optional; else a view/RPC) | Single endpoint the web/app signup calls: state status, ordering open, window countdown, size availability. Prefer plain RPCs; create the function only if response shaping demands it. | 0089, 0091 | L |

## 4. Client apps

### 4.1 Expo customer app (`expo/app/`) — customer subscription UI is NEW (nothing references `seed_drop_subscriptions` in expo today)
| File | New/changed | Contents | Depends on | Risk |
|---|---|---|---|---|
| `expo/app/seed-drop/index.tsx` | NEW | Landing: state eligibility (allowlist-aware copy), season window countdown, size tiers, waitlist CTA when closed. | 0089, 0091 | L |
| `expo/app/seed-drop/profile.tsx` | NEW | Port of web SeedProfile five-question flow against `seed_profiles` (multi-select columns). | P2 | L |
| `expo/app/seed-drop/size.tsx` | NEW | Size 4/8/12/custom slider (4–20, gated by `custom_sizes_enabled`), frequency, control mode, auto-substitution opt-in → column-granted insert/update. | 0090 | L |
| `expo/app/seed-drop/review.tsx` | NEW | `REVIEW_AND_APPROVE` / `I_CHOOSE` screens: proposed selections with WHY, approve/reject, pick-with-reservation (TTL countdown from `reservation_ttl_minutes`). | 0091, 0092 | **M** |
| `expo/app/seed-drop/journal.tsx` | NEW | Germination journal: entries per order item, photo attach, observed germination. | 0093 | L |
| `expo/app/(tabs)/index.tsx`, `garden.tsx` | CHANGED | Entry points/links; planner gains "my Drop" context (read-only). | screens above | L |
| `expo/app/orders.tsx` | CHANGED | Show seed orders + statuses incl. `needs_review` explanation copy. | 0092 | L |

### 4.2 Web (`web/app/`)
| File | New/changed | Contents | Depends on | Risk |
|---|---|---|---|---|
| `web/app/seeds/SeedProfileClient.tsx` | CHANGED | Replace `NEXT_PUBLIC_SEED_LINK_STARTER` Payment-Link checkout with `billing-checkout` server sessions; add state-eligibility banner + waitlist. | edge fns §3 | **M** (touches live purchase path) |
| `web/app/seeds/subscribe/page.tsx` (+client) | NEW | Size/frequency/control-mode signup mirroring expo `size.tsx`. | 0090, 0091 | L |
| `web/app/seeds/manage/page.tsx` (+client) | NEW | Pause/skip/cancel (existing RPCs), selections review, journal. | 0092, 0093 | L |
| `web/app/components/GnomeAssistant.tsx` | CHANGED | Same read-only guidance surface as expo assistant. | 0093 | L |

### 4.3 Admin app (`admin/App.tsx` — Home/Fulfill/AI HQ/More; split into modules as it grows)
| Area | Change | Contents | Depends on | Risk |
|---|---|---|---|---|
| Inventory item/lot screens | CHANGED | Receive/edit forms gain the 17 §2 compliance fields (treatment, organic + cert ref, origin, sell-by, counts w/ source+confidence, PO link); label-image capture → `seed-lot-docs` signed-URL upload/view; bucket moves via `admin_move_lot_bucket`; `seed_lot_position` reconciliation strip; "total lot cost" copy fix (17 §2 row 20). | 0088 | **M** |
| NEW "State Clearance" screen (More) | NEW | Allowlist editor: per-state status + sources + verified date; owner/compliance perm; shows "states currently sellable" count. | 0089 | **M** |
| NEW "Capacity" screen (More) | NEW | `seed_capacity_controls` editor + audit trail viewer; ordering-paused kill switch. | 0091 | L |
| NEW "Waitlist" screen (More) | NEW | Queue view + invite (audited RPC). | 0091 | L |
| Fulfill tab | CHANGED | Queue shows selections + approval states + substitution audit; substitute action (`admin_substitute_selection`); pack blocked by state recheck with clear error; review-required lot badge. | 0089, 0092 | **M** |
| Seasons screen | CHANGED | Wave preview shows per-state breakdown vs allowlist + capacity headroom before generate. | 0089, 0091 | L |
| Revenue screen | CHANGED | Per-size revenue split; unchanged live/test separation. | 0090 | L |

## 5. Docs (`docs/seed-drop/`)

| File | Change | Depends on | Risk |
|---|---|---|---|
| `matrix/` | Populate the state regulatory matrix (Phase 0 input to the allowlist; Daniel-approved). | — | **H** (compliance source of truth) |
| `21-test-plan.md` | Parallel lane; 23 references its gate IDs. | — | — |
| `SEASONAL_SUBSCRIPTION.md`, `ECONOMICS.md`, `SEASONAL_WINDOWS.md` | Update for sizes, control modes, reservations, allowlist, per-size pricing. | 0090–0092 | L |
| `docs/release/` store-release checklist | Add Seed Drop V1 items (new expo screens → app-store review). | 4.1 | L |

## 6. The three riskiest schema decisions (called out for review)

1. **Lot quantity-state model (17 §3.1).** `current_qty` stays the single
   decrementable number (= available); damaged/recalled/expired are bucket
   columns moved only by one audited RPC; reserved/shipped are derived. Any
   future code path that mutates a bucket outside `admin_move_lot_bucket`
   silently breaks the reconciliation identity — the `seed_lot_position`
   view + log make drift visible but cannot prevent a rogue write.
2. **`drop_size` authoritative with `packet_count` mirrored by trigger
   (17 §3.2).** Chosen so `generate_seed_drop` / wave functions stay
   untouched. If the mirror ever desyncs (e.g. a direct SQL update bypassing
   the trigger), a customer gets the wrong box size. Alternative — rewriting
   the live engine to read `drop_size` — was judged higher risk.
3. **Allowlist enforcement points + precedence (17 §3.3, §4.2).** Ship-legal
   = clearance CLEARED ∩ product allowed − product excluded, rechecked at
   subscribe, checkout, generate, and pack. Getting precedence wrong ships
   illegally; enforcing at pack means a state un-cleared after payment
   strands paid orders in an explicit blocked state (correct, but a support
   burden Daniel must accept as part of the compliance model).
