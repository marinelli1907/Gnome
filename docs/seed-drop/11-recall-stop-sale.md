# 11 — Recall / Stop-Sale Procedure

**Doc:** Seed Drop V1 compliance procedures — recall & stop-sale
**Entity:** Boone Systems LLC (Ohio) · Gnome Farmers Market · Seed Drop
**Date:** 2026-08-13 · **Owner:** Daniel Marinelli
**Status:** Operational procedure. This is not legal advice. Regulator
notification duties are `PENDING` the federal/Ohio/state memos.

Related: `08-packet-acceptance-checklist.md`,
`09-shipment-compliance-checklist.md`, `10-record-retention.md`,
`17-database-plan.md`, `02-federal-memo.md`, `03-ohio-memo.md`, `matrix/`.

---

## 1. Triggers

Open a recall/stop-sale incident when ANY of the following occurs:

| Trigger | Examples |
|---|---|
| **Supplier notice** | Supplier recall, withdrawal, mislabeling notice, germination correction, treated-seed labeling error affecting a lot we hold or shipped. |
| **Agency stop-sale** | Stop-sale, withdrawal-from-sale, or removal order from ODA or any destination state's seed control official, or federal action. An agency order is executed **immediately and without debate**; questions go to the agency afterward. |
| **Internal QA failure** | Receiving or storage discovers pest signs, contamination, tampering, or a lot that shipped despite failing `08`/`09` (gate defect). |
| **Customer-reported defect pattern** | ≥ 3 independent complaints on the same lot (empty/short packets, wrong seed, contamination, near-zero germination) — pattern, not a single anecdote; a single credible safety report (e.g., pest in packet) triggers on its own. |

Anyone (admin or support) can raise a suspected trigger; only the **owner
(Daniel) declares an incident open or closed** — except an agency stop-sale,
which is effective the moment received.

## 2. Immediate actions (same day, in order)

1. **Freeze the lot(s):** set lot `status = quarantined` via the admin
   quarantine action (`inventory.quarantine` — permission-checked RPC,
   ledger + `admin_audit` entry). Quarantined lots are automatically
   ineligible at both gates (`08` E1, `09` C1).
2. **Halt affected shipments:** any order containing the lot that is
   reserved/picked/packed but **not yet shipped** goes to the exception
   queue; nothing with the lot passes the `09` gate. Wave generation
   (`admin_seed_wave_generate`) cannot draw on quarantined stock.
3. **Suspend the blast radius via admin controls:** as scope requires —
   the packet/SKU (archive/suspend the `seed_products` row from selection),
   additional lots of the same SKU, or the **supplier** (mark suspended per
   `08` A3) pending investigation.
4. **Physically segregate** on-hand units to the quarantine shelf, labeled
   with the incident ID. No physical destruction yet (Section 6).
5. **Open the incident record:** incident ID, trigger, source document
   (supplier notice / agency order scanned to the compliance bucket),
   lots/SKUs in scope, declared by, date/time.

## 3. Identification — trace the exposure

Trace runs on existing lot-to-shipment records; it must complete within 1
business day of opening the incident.

1. From each affected `seed_lots` row, pull every `seed_order_items` row
   referencing the lot, joined to `seed_orders` and shipment records
   (carrier + tracking + ship date).
2. Produce the **exposure list**: every shipped order containing the lot —
   customer, destination state, ship date, packet(s) affected — plus every
   unshipped reservation (now held in the exception queue).
3. Snapshot the exposure list into the incident record (it is the
   notification list and the regulator answer if asked "where did it go").
4. Cross-check the ledger (`seed_inventory_log`): received − on hand −
   shipped − damaged/disposed must reconcile; any drift is investigated and
   documented before the incident closes.

## 4. Customer notification

Owner approves the notice text and the send. Send **email + in-app message**
to every customer on the exposure list. Rules: **factual, no admission of
fault, no speculation about cause, always a refund-or-replacement offer,**
and never instruct anything unsafe. Attorney review of templates before first
real use — these are DRAFT:

**Email (DRAFT — attorney review required):**

> Subject: Important notice about a seed packet in your recent Seed Drop
>
> Hi {{first_name}},
>
> We're writing about your Seed Drop shipped on {{ship_date}} (order
> {{order_id}}). The supplier of one packet in that shipment —
> {{supplier}} {{kind}} '{{variety}}', lot {{supplier_lot_number}} — has
> issued a notice affecting that lot{{agency_clause}}.
>
> What to do: please don't plant seeds from this packet. You can set it
> aside or discard it — no need to return it unless we ask.
>
> What we'll do: your choice of a replacement packet in your next Drop or a
> refund of {{refund_amount}} for the affected packet. Reply to this email
> or tap the link below and we'll take care of it within 2 business days.
>
> {{authenticated_link}}
>
> The rest of your Drop is not affected by this notice. We're sorry for the
> trouble — thanks for growing with us.
>
> — Gnome support, Boone Systems LLC

`{{agency_clause}}` is filled only when an agency action exists, stating the
fact neutrally ("in coordination with {{agency}}"). **In-app message:** short
version of the same facts + the same choice, linked to the order; shown until
acknowledged.

Log every notice sent (who, when, channel, template version) in the incident
record.

## 5. Regulator notification — placeholder

Whether, when, and to whom Boone Systems must proactively report a recall or
stop-sale (Ohio Department of Agriculture; destination-state seed control
officials; any federal contact) is
**`PENDING: 02-federal-memo.md`, `PENDING: 03-ohio-memo.md`, and
`PENDING: matrix/` (per destination state)**. Until those land:

- If an **agency initiated** the action, respond to that agency through the
  channel it used, and log all correspondence (`10-record-retention.md` §4).
- For self-initiated recalls, the owner decides on counsel's advice whether
  to notify ODA voluntarily; the decision and basis are recorded either way.
- This section MUST be completed with concrete contacts and thresholds
  before Seed Drop live-gate flips true.

## 6. Disposition of affected stock

- **Per supplier or agency instruction only**, and documented: return (RMA
  number, credit memo, ship-back tracking) or destroy (method, date, photo,
  witness). Agency instruction overrides supplier preference.
- Absent instruction: hold in quarantine until the incident closes; then
  owner decides destroy vs. return, documented the same way.
- Ledger entries record every unit's exit (returned/discarded) — quantities
  must reconcile to the Section 3 trace.
- Disposal records retained per `10-record-retention.md` (indefinite for
  recall-related).

## 7. Shipped-inventory rule

**History is preserved, never rewritten, and never auto-restored.** Shipped
`seed_order_items` stay `shipped`; the ledger keeps every movement; refunds/
replacements are new records, not edits. If a quarantine is later lifted
(false alarm), remaining on-hand stock returns to `active` only by an
explicit, audited owner decision — **nothing flips back automatically**, and
nothing that shipped is retroactively relabeled as unaffected.

## 8. Post-incident review

Within 10 business days of closing: written review in the incident record —
what triggered it, timeline, exposure size, gate that failed (if any),
corrective actions (checklist changes to `08`/`09`, supplier status, data
model gaps for `17-database-plan.md`), and template improvements. Incident
record set is retained **indefinitely** (`10-record-retention.md`).

## 9. RACI

| Step | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|
| Detect / raise trigger | Any admin, support, or system alert | Owner (Daniel) | Supplier | — |
| Declare incident / approve recall | Owner (Daniel) | Owner (Daniel) | Attorney (as needed) | Admins |
| Freeze, halt, suspend (execution) | System via permission-checked RPCs; fulfillment admin | Owner | — | Support |
| Trace exposure | Fulfillment/inventory admin | Owner | — | — |
| Customer notices | Support (send) | Owner (approves text + send) | Attorney (templates) | — |
| Regulator contact | Owner only | Owner | Attorney | — |
| Disposition | Fulfillment admin | Owner | Supplier / agency | — |
| Post-incident review | Owner | Owner | Admins involved | — |

**Audit trail is mandatory at every step** — every state change goes through
the permission-checked RPCs and lands in `admin_audit` plus the incident
record. An action that can't be audited doesn't happen.
