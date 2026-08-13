# 09 — Shipment Compliance Checklist (Pre-Carrier Gate)

**Doc:** Seed Drop V1 compliance procedures — outbound
**Entity:** Boone Systems LLC (Ohio) · Gnome Farmers Market · Seed Drop
**Date:** 2026-08-13 · **Owner:** Daniel Marinelli
**Status:** Operational procedure. This is not legal advice. Items that depend
on pending federal/Ohio/state research are marked `PENDING: <memo>`.

Related: `08-packet-acceptance-checklist.md`, `10-record-retention.md`,
`11-recall-stop-sale.md`, `17-database-plan.md`, `02-federal-memo.md`,
`03-ohio-memo.md`, `matrix/` (state matrix).

---

## Scope and rule

Run this gate for **every shipment, before handoff to the carrier** — at the
pack→ship transition in the fulfillment lane (`seed_order_items`:
reserved → picked → packed → **[this gate]** → shipped). **A shipment that
fails any check is pulled to the admin exception queue. Nothing is ever
"shipped anyway", silently substituted, or hand-waved past a failed check.**
The system should enforce as many of these checks as possible at
`seed_drop.ship` time; the human packer confirms the physical ones.

Shipping model (LOCKED): several unopened, supplier-labeled retail packets per
plain padded envelope/box, with a Gnome packing slip, shipped **from one Ohio
location** to consumers in **explicitly cleared contiguous-48 states only**.

---

## Section A — Destination eligibility

| # | Check | Rule |
|---|-------|------|
| A1 | State on the CURRENT allowlist | Destination state appears on the current cleared-state **allowlist** (maintained from `matrix/` clearances). **The test is presence on the allowlist — never absence from a blocklist.** An empty, stale, or ambiguous allowlist entry = FAIL. |
| A2 | Contiguous-48 only | Destination is one of the contiguous 48 states. AK, HI, US territories, APO/FPO/DPO, and international addresses are hard FAIL regardless of the allowlist. |
| A3 | State clearance not expired | The allowlist entry for the destination state has a current clearance record (license/registration/no-license-required determination per `matrix/`; stored per `10-record-retention.md`). Expired or under-review clearance → FAIL until renewed. |

## Section B — Per-lot destination eligibility

| # | Check | Rule |
|---|-------|------|
| B1 | Every packet's lot cleared for the destination | For **each** `seed_order_item` in the shipment, the lot's per-lot allowed/excluded-state data (captured at receiving, `08` Section E4/F) permits the destination state. One ineligible packet fails the whole shipment (route to exceptions; do not strip the packet and ship silently — substitution is an admin decision recorded as `substituted`). |
| B2 | No excluded categories | No live plants, bulbs, soil, insects, imported seed, hemp/cannabis, noxious-weed, quarantined, recalled, or destination-prohibited items. (These should be impossible post-`08`, but the gate re-checks — defense in depth.) |
| B3 | State-specific kind restrictions | Destination-state restrictions for specific kinds `PENDING: matrix/`. Until the matrix row for the state is complete, that state must not be on the allowlist (A1 covers this). |

## Section C — Lot status and freshness

| # | Check | Rule |
|---|-------|------|
| C1 | No recalled/quarantined lot | Every item's lot `status` is `active`/`fresh`. Lots in `quarantined`, `failed`, `needs_test`, `discarded`, or `depleted` FAIL. Recall state per `11-recall-stop-sale.md`. |
| C2 | No expired/stale lot | Lot has not passed `next_review_date`, and its germination test date remains within the currency window at ship time. **Exact window `PENDING: 02-federal-memo.md` and `PENDING: matrix/`**; interim rule: past `next_review_date` → FAIL, route to retest/review. |
| C3 | Germination floor still holds | Lot's recorded `germination_pct >= 70` (or documented fresh-untested eligibility still current). |

## Section D — Contents match

| # | Check | Rule |
|---|-------|------|
| D1 | Packet list matches reservation | Physical packets scanned/checked against the reserved `seed_order_items` for this order: same SKU, same lot, same count. Any mismatch → FAIL to exception queue (mis-pick or inventory drift; reconcile before shipping). |
| D2 | One reservation, one shipment | The order is in a payable/shipped-eligible state (`paid`; unpaid orders are never shipped) and has not already shipped (ship-once rule). |
| D3 | Labels unaltered | Spot-check: every packet still carries its intact, unmodified original supplier label. No Gnome stickers, corrections, or over-labels on packets — the supplier label is controlling. |

## Section E — Packing slip completeness

The Gnome packing slip (in every envelope/box) must include:

- [ ] E1 Shipment ID (and order reference)
- [ ] E2 Full packet list — for each packet: supplier, kind, variety,
      supplier lot number
- [ ] E3 Support instructions (how to reach Gnome support; replacement/refund
      pointer per `20-legal-policy-copy.md`)
- [ ] E4 Authenticated QR link (signed/tokenized URL to the customer's order
      view — never a guessable URL; no personal data in the QR beyond the
      opaque token)
- [ ] E5 Boone Systems shipper identification (legal name + Ohio address) —
      **whether this is legally required on the slip and in what form is
      `PENDING: 02-federal-memo.md`.** Interim rule: include "Shipped by
      Boone Systems LLC, [city], Ohio — seeds packed and labeled by the
      original suppliers listed above" until the memo says otherwise.
- [ ] E6 Destination-state notices — any state-required consumer notice text
      is `PENDING: matrix/`. The slip template must support per-state notice
      blocks keyed off the destination state.
- [ ] E7 No prohibited claims — the slip never states or implies germination
      guarantees, harvest outcomes, or "fully compliant" language
      (`20-legal-policy-copy.md`).

## Section F — Carrier handoff

| # | Check | Rule |
|---|-------|------|
| F1 | Address format valid | Street address validated/normalized; deliverable per carrier. If the selected carrier restricts PO boxes, a PO-box address FAILs to the exception queue for address correction or carrier switch — never guessed. |
| F2 | Plain packaging | Plain padded envelope/box; no external content markings beyond what the carrier requires. |
| F3 | Carrier + tracking recorded | Carrier name and tracking number recorded on the shipment before handoff. No tracking = not shipped. |
| F4 | Weight sanity check | Measured weight is within tolerance of expected weight (packet count × nominal packet weight + packaging). Out-of-tolerance → FAIL (possible mis-pick, missing/extra packet); recount against D1. |

## Section G — Failure handling

- Any FAIL → shipment status goes to the **admin exception queue** with the
  failing check ID; the order stays unshipped; inventory stays reserved.
- Resolution paths: fix and re-run the full gate; substitute (recorded as
  `substituted`, re-run gate); or cancel/refund per policy. Every resolution
  is a permission-checked admin action landing in `admin_audit`.
- **Never silently ship.** No override path exists that skips this gate;
  emergency overrides do not exist in V1.

## Section H — Sign-off (per shipment)

System-recorded at `seed_drop.ship` (who, when, checklist version) in
`admin_audit`; the packer's identity is the signature. For any manual
exception resolution, the resolving admin and basis are recorded on the
exception. Retention per `10-record-retention.md`.

```
Shipment ID: ____________  Order ID: ____________  Date: __________
Destination state (allowlist-verified): ______
Items verified against reservation: YES / NO (NO = exception queue)
Carrier: __________  Tracking: ______________  Weight: ______
Packed/shipped by: ______________  Checklist version: 09 (2026-08-13)
```
