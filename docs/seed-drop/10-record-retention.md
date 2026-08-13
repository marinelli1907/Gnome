# 10 — Record Retention Procedure

**Doc:** Seed Drop V1 compliance procedures — records
**Entity:** Boone Systems LLC (Ohio) · Gnome Farmers Market · Seed Drop
**Date:** 2026-08-13 · **Owner:** Daniel Marinelli
**Status:** Operational procedure. This is not legal advice. Retention floors
below are defaults; items depending on pending research are marked
`PENDING: <memo>`.

Related: `08-packet-acceptance-checklist.md`,
`09-shipment-compliance-checklist.md`, `11-recall-stop-sale.md`,
`17-database-plan.md`, `02-federal-memo.md`, `03-ohio-memo.md`, `matrix/`.

---

## 1. Principles

1. **Records live in the existing Supabase project** — structured data in the
   existing tables, documents/images in a **private storage bucket accessed
   only via short-lived signed URLs. Nothing in this program is ever in a
   public bucket.** RLS and admin permissions gate every read.
2. **Append-only where it matters.** The inventory ledger
   (`seed_inventory_log`), `admin_audit`, order/shipment history, and recall
   actions are never edited or deleted — corrections are new entries.
3. **Retention floor: 3 years minimum from the record's close date for every
   record class below.** This default is
   **`PENDING: 02-federal-memo.md` confirmation of the Federal Seed Act
   complete-records rule (period and what "complete records" must include)**
   and may only lengthen, never shorten. Where a cleared state requires
   longer (`PENDING: matrix/`), the longer period wins for records touching
   that state.
4. **Nothing under legal hold, open complaint, or active recall is deleted
   regardless of age** (`11-recall-stop-sale.md`).

## 2. What we keep, and where

| Record class | System of record | Retention (from) |
|---|---|---|
| Supplier invoices & POs | Compliance bucket (PDF/scan) + PO reference on `seed_lots.purchase_date` / `suppliers` | 3 yr min from lot depletion `PENDING: 02-federal-memo.md`; also kept ≥ tax retention for LLC books |
| Lot data + label images | `seed_lots` (all fields incl. germination, treated, origin, organic ref) + front/back label photos per lot in compliance bucket | 3 yr min from lot depletion/disposal `PENDING: 02-federal-memo.md` |
| Germination / test / fresh-eligibility docs | Compliance bucket, linked to `seed_lots` | Same as lot data |
| Receiving checklists (doc 08, incl. signatures/dispositions) | Admin app records + `admin_audit`; paper sheets scanned to compliance bucket | Same as lot data |
| Shipment manifests + tracking | `seed_orders` / `seed_order_items` + shipment records (carrier, tracking, packing-slip snapshot) | 3 yr min from ship date; longer per state `PENDING: matrix/` |
| Customer orders & subscription history | `seed_orders`, `seed_drop_subscriptions`, `seed_sub_season_skips`, billing records | 3 yr min from order close; billing per Stripe/tax obligations |
| Complaints & support tickets (Seed Drop) | Support records, linked to order/lot where identified | 3 yr min from resolution; indefinitely if part of a recall |
| Recall / stop-sale actions | Recall record set per `11-recall-stop-sale.md` (trigger, scope, trace, notices sent, dispositions) + `admin_audit` | **Indefinite** (never deleted) |
| Disposal / destruction records | Admin records + compliance bucket (photos, certificates, supplier RMA/credit docs) | 3 yr min from disposal `PENDING: 02-federal-memo.md`; indefinite if recall-related |
| Agency correspondence | Compliance bucket (letters, emails exported to PDF), indexed by agency + date | **Indefinite** |
| Per-state compliance clearances (licenses, registrations, no-license determinations feeding the ship allowlist) | Compliance bucket + the allowlist table (`17-database-plan.md`), with effective/expiry dates | **Indefinite** history; current-status row drives `09` A1/A3 |

## 3. Access control

- Read access to compliance records requires admin permissions:
  `inventory.view` for lot/receiving data, `seed_drop.view` for
  orders/shipments, `compliance.view` / `compliance.view_documents` for the
  document bucket and clearances, `finance.view_transactions` for billing.
- Write is only via the permission-checked definer RPCs (which write
  `admin_audit`); no direct table writes, no service-role use outside
  migrations and server code.
- Signed URLs for documents: short expiry, generated per request, never
  embedded in emails or customer-facing pages.
- Customers see only their own orders/shipments through customer RLS —
  never lot documents, supplier invoices, or compliance files.

## 4. Export procedure — agency inspection

When an agency (ODA, another state's seed control official, USDA/AMS)
requests records:

1. **Log the request** as agency correspondence (who, agency, date, scope,
   how received) before anything is exported.
2. **Owner approves the export** (Daniel). No one else releases records to an
   agency in V1.
3. **Assemble the package** scoped to the request: SQL exports (CSV) of the
   relevant `seed_lots`, ledger entries, orders/shipments; plus the linked
   documents from the compliance bucket. Include the receiving and shipment
   checklist records for the lots/shipments in scope.
4. **Redact only other customers' personal data** not in scope; never redact
   lot, supplier, or shipment facts.
5. **Deliver** by the agency's requested method; record what was sent (file
   list + hashes) as part of the correspondence record.
6. **Freeze**: every record touched by the request goes under hold (no
   deletion) until the matter closes.

Target turnaround: acknowledge within 2 business days; produce within the
agency's deadline or 10 business days, whichever is shorter.

## 5. Annual review (every August, owner)

- [ ] Confirm retention floors against the now-final `02-federal-memo.md` /
      `03-ohio-memo.md` / `matrix/` requirements; update Section 2 table.
- [ ] Verify the compliance bucket is still private (no public policies) and
      spot-check 5 signed-URL documents open correctly.
- [ ] Spot-check 3 random lots end-to-end: receiving checklist → lot record →
      label photos → ledger → any shipments.
- [ ] Confirm per-state clearance records match the live ship allowlist
      exactly (any state on the allowlist without a current clearance record
      is removed immediately).
- [ ] Identify records past retention **and** not under hold; deletion is an
      owner-approved, audited action — never automatic.
- [ ] Record the review itself as a compliance record (this checklist,
      dated, signed).
