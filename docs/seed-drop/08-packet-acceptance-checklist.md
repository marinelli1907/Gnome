# 08 — Packet Acceptance Checklist (Receiving Inspection)

**Doc:** Seed Drop V1 compliance procedures — receiving
**Entity:** Boone Systems LLC (Ohio) · Gnome Farmers Market · Seed Drop
**Date:** 2026-08-13 · **Owner:** Daniel Marinelli
**Status:** Operational procedure. This is not legal advice. Items that depend
on pending federal/Ohio/state research are marked `PENDING: <memo>` and must
not be treated as settled until the referenced memo lands.

Related: `09-shipment-compliance-checklist.md`, `10-record-retention.md`,
`11-recall-stop-sale.md`, `17-database-plan.md` (data model),
`02-federal-memo.md`, `03-ohio-memo.md`, `matrix/` (state matrix).

---

## Scope and rule

Run this checklist for **every inbound lot** of retail seed packets before any
unit becomes sellable inventory. A lot is one supplier lot number of one SKU
received on one date (`seed_lots` row). **No lot is eligible for reservation,
wave generation, or fulfillment until it has an ACCEPT disposition recorded
with a signature/audit entry.** Partial acceptance is allowed only by splitting
into separate lots with separate dispositions.

Business model constraint (LOCKED): we accept only **unopened, unaltered
retail seed packets** (ordinary vegetable/herb/flower) bought wholesale from
established domestic suppliers. The **original supplier label stays intact and
is controlling**. Anything else fails this checklist by definition.

---

## Section A — Order and supplier verification

| # | Check | Pass condition |
|---|-------|----------------|
| A1 | PO match | Shipment matches an open purchase order: supplier, SKU list, quantities, unit costs. Overages/unknown SKUs → REVIEW_REQUIRED. |
| A2 | Supplier approved | Supplier exists in `suppliers` with `active = true` and is an established **domestic** supplier. Unknown or inactive supplier → REJECT-RETURN (do not create the supplier at the receiving bench). |
| A3 | Supplier not suspended | Supplier is not under a recall/quality suspension per `11-recall-stop-sale.md`. Suspended → QUARANTINE, notify owner. |
| A4 | Domestic origin of goods | Packets are supplier-sourced domestic retail stock. **Imported seed is excluded from the model** — any indication the packets are import-labeled for import compliance we cannot verify → REVIEW_REQUIRED. Import documentation rules `PENDING: 02-federal-memo.md`. |

## Section B — Physical condition

| # | Check | Pass condition |
|---|-------|----------------|
| B1 | Sealed retail packaging intact | Every packet unopened, factory-sealed, unaltered. No re-taped, re-glued, re-stickered, or repackaged units. |
| B2 | No damage beyond threshold | Count crushed, torn, water-damaged, or stained packets. **Record the damage count on the lot record** (`condition_notes` + damaged qty). Damaged units are excluded from `current_qty` and dispositioned (return or discard, documented). |
| B3 | No contamination signs | No moisture, mold, insect activity, or pest evidence in the carton. Any pest sign → QUARANTINE the entire carton immediately (plant-pest exclusion is absolute). |
| B4 | No label tampering | Original supplier label present, legible, and unmodified on every sampled packet. We never over-sticker, correct, or supplement the supplier label. |

Sampling: inspect 100% of packets for seal/damage on lots ≤ 200 packets;
for larger lots inspect a documented sample of at least 20% per SKU plus all
visibly damaged cartons, and record the sampling basis in `condition_notes`.

## Section C — Label completeness (per SKU/lot, inspect at least one packet per lot)

The supplier label must show, legibly:

- [ ] C1 Kind (crop) — e.g., "Tomato"
- [ ] C2 Variety (or an accepted "mixture"/variety statement)
- [ ] C3 Lot number (matches `supplier_lot_number` we record)
- [ ] C4 Germination percentage
- [ ] C5 Germination test date
- [ ] C6 Treated-seed statement/warning **if the seed is treated** (treated
      seed is acceptable only when the supplier label carries the required
      treatment warning verbatim; record `treated = true` and the treatment
      name). Exact federal wording requirements `PENDING: 02-federal-memo.md`.
- [ ] C7 Origin (state/country) **where required** — whether origin labeling
      is required for these kinds, and for which destination states, is
      `PENDING: 02-federal-memo.md` and `PENDING: matrix/` (state matrix).
      Until resolved: record origin when printed; absence alone does not fail
      the lot but must be flagged on the lot record.
- [ ] C8 Net weight or seed count
- [ ] C9 Supplier (labeler) name and address

**Any missing item among C1–C5, C8, C9 → REVIEW_REQUIRED.** The AI/agent
layer may **never** infer or fill missing label data (see Section F). Missing
C6 on seed known to be treated → REJECT-RETURN.

## Section D — Germination and freshness

| # | Check | Rule |
|---|-------|------|
| D1 | Germination floor | Labeled `germination_pct >= 70`. Below 70% → REJECT-RETURN (or QUARANTINE pending supplier credit), never ACCEPT. |
| D2 | Fresh-untested eligibility | A lot without a germination figure is acceptable **only** with documented fresh-untested eligibility from the supplier (current-season packing, supplier attestation on file, referenced in the lot record). Otherwise REVIEW_REQUIRED. Whether "packed for" year labeling substitutes for a test figure is `PENDING: 02-federal-memo.md`. |
| D3 | Test-date currency | `germination_test_date` must be within the currency window for interstate sale. **The exact window (months, and whether stricter state windows apply) is `PENDING: 02-federal-memo.md` and `PENDING: matrix/`.** Interim conservative rule: flag any test date older than 5 months at receipt as REVIEW_REQUIRED rather than ACCEPT. |
| D4 | Retest date set | On ACCEPT, set `next_review_date` on the lot so the packet ages out of eligibility before its test date goes stale mid-inventory. Shipment-time enforcement is in `09-shipment-compliance-checklist.md`. |

## Section E — Eligibility screens

| # | Check | Rule |
|---|-------|------|
| E1 | No recall/quarantine on lot | Supplier lot number checked against active supplier recall notices and our internal quarantine list (`11-recall-stop-sale.md`). Match → QUARANTINE. |
| E2 | Species on the allowed list | Kind/variety is an **ordinary vegetable, herb, or flower** on the Gnome allowed-species list. Hard exclusions (never ACCEPT): hemp/cannabis in any form; noxious weeds (federal and any state list — full lists `PENDING: matrix/`); specially regulated or unusual species; live plants, bulbs, tubers, soil, inoculants with live organisms, insects; imported seed. Not on the allowed list → REJECT-RETURN. Not sure → REVIEW_REQUIRED, never ACCEPT. |
| E3 | Organic claims documented | If the packet claims organic (or "100% organic", USDA seal, etc.): the supplier's organic certificate reference must be on file and recorded on the lot (`organic_cert_ref`). No certificate reference → REVIEW_REQUIRED; the SKU may not be represented as organic anywhere in Gnome until documented. Retailer obligations under NOP `PENDING: 02-federal-memo.md`. |
| E4 | Destination-state constraints captured | If the supplier or the state matrix flags this kind as restricted/prohibited in specific states, record the per-lot excluded states now (see Section F). Enforcement happens at shipment (`09`), but the data is captured at receiving. |

## Section F — Data entry (required fields, mapped to the inventory model)

All receiving data lands in the existing model (see `17-database-plan.md` for
the authoritative plan; fields marked *(plan)* must exist there if not yet in
schema). **Every field below is REQUIRED for ACCEPT. A human enters them from
the physical label and documents. The AI/agent layer may never populate,
infer, or "correct" any required receiving field — missing data is
REVIEW_REQUIRED, full stop.**

SKU level — `seed_products`:

- `crop` (kind), `variety`, `category` (vegetable/herb/flower)
- `sku`, `supplier`, `supplier_product_code`, `packet_size`, `barcode`
- `cost_cents` (wholesale unit cost)

Lot level — `seed_lots`:

- `supplier`, `supplier_lot_number`, `internal_lot_number`
- `purchase_date` (PO date), `received_date`
- `original_qty`, `current_qty`, `unit` (normally `packets`)
- `germination_pct`, `germination_test_date`, `next_review_date`
- `storage_location` (assigned from `storage_locations`; climate-appropriate,
  cool/dry, away from quarantine shelving)
- `condition_notes` (damage count, sampling basis, anomalies)
- `status` (`fresh`/`active` on ACCEPT; `quarantined` on QUARANTINE)
- *(plan)* `treated` flag + treatment name (from C6)
- *(plan)* `origin` (from C7, when printed)
- *(plan)* `organic_cert_ref` (from E3)
- *(plan)* label photo: front + back of one packet per lot, stored in the
  private compliance bucket (signed URLs only), linked to the lot
  (`10-record-retention.md`)
- *(plan)* per-lot excluded destination states (from E4; consumed by `09`)

Documents attached to the lot (private storage, signed URLs): supplier
invoice, PO, packing list, germination/fresh-eligibility documentation,
organic certificate reference where applicable.

## Section G — Disposition

Exactly one, recorded via the admin app so it lands in `admin_audit`:

| Disposition | When | Effect |
|---|---|---|
| **ACCEPT** | Every section passes and all Section F fields are captured. | Lot `status = fresh/active`; quantity enters the inventory ledger; eligible for selection. |
| **REVIEW_REQUIRED** | Any required data missing, illegible, or uncertain; any "not sure" outcome. **AI may never fill the gap.** | Lot held non-sellable in the admin review queue until a human resolves it to ACCEPT / REJECT-RETURN / QUARANTINE. |
| **REJECT-RETURN** | Fails a hard rule (germination < 70%, excluded species, tampering, missing treated-seed warning, unapproved supplier). | Return to supplier documented (RMA reference, credit); units never enter sellable stock. |
| **QUARANTINE** | Recall/quarantine match, pest signs, suspended supplier, or safety uncertainty. | Lot `status = quarantined` (requires `inventory.quarantine`); physically segregated to the quarantine shelf; handled per `11-recall-stop-sale.md`. |

## Section H — Signature / audit line (one per lot)

Record in the admin app (mirrors to `admin_audit`); if done on paper first,
transcribe the same day and file the sheet in the compliance bucket.

```
Internal lot #: ______________   Supplier lot #: ______________
SKU / kind / variety: _________________________________________
Received date: ____________   Qty received: ______  Damaged: ____
Disposition: ACCEPT / REVIEW_REQUIRED / REJECT-RETURN / QUARANTINE
Basis (if not ACCEPT): _______________________________________
Inspected by (name): ______________  Signature: ______________
Date/time: ____________   Storage location: __________________
```

Retention of this record: per `10-record-retention.md`.
