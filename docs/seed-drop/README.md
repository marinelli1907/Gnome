# Seed Drop V1 — research, compliance, and product specification

Assembled 2026-08-13 for Boone Systems LLC / Gnome Farmers Market.
**Status: RESEARCH & SPECIFICATION ONLY. Nationwide Seed Drop fulfillment is
NOT enabled. Nothing in this pack authorizes shipping to any state.** The
application must treat the state matrix as an **allowlist**: a state is
eligible only when explicitly cleared, never because it is absent from a
blocklist. Daniel must approve the compliance model, pricing, Drop structure,
and implementation sequence before any production activation.

Not legal advice. Regulatory memoranda are research summaries with primary-source
citations; verify with counsel and, where marked, with the agencies in writing.

## Deliverable index (numbering follows the original directive)

| # | Document | Lane |
|---|----------|------|
| 1 | [Executive conclusion](01-executive-conclusion.md) | synthesis |
| 2 | [Federal compliance memorandum](02-federal-memo.md) | federal research |
| 3 | [Ohio compliance memorandum](03-ohio-memo.md) | Ohio research |
| 4 | [Contiguous-48 state matrix](04-state-matrix.md) — detail: [NE+Pacific](matrix/region-ne-pacific.md) · [Southeast](matrix/region-southeast.md) · [Midwest](matrix/region-midwest.md) · [South-central+Mountain](matrix/region-south-mountain.md) | 4 regional lanes |
| 5 | [Unresolved questions](05-unresolved-questions.md) | synthesis |
| 6 | [Agency inquiries (send-ready, NOT sent)](06-agency-inquiries.md) | synthesis |
| 7 | [Supplier comparison + due diligence](07-supplier-review.md) | supplier lane |
| 8 | [Packet-acceptance checklist](08-packet-acceptance-checklist.md) | compliance procedures |
| 9 | [Shipment-compliance checklist](09-shipment-compliance-checklist.md) | compliance procedures |
| 10 | [Record-retention procedure](10-record-retention.md) | compliance procedures |
| 11 | [Recall & stop-sale procedure](11-recall-stop-sale.md) | compliance procedures |
| 12 | [Seed Drop V1 product specification](12-product-spec.md) | product lane |
| 13 | [Richmond Heights OH 44143 · 2026-08-12 journey](13-richmond-heights-journey.md) | product lane |
| 14 | [Drop sizes, frequency, control modes](14-drop-structure.md) | product lane |
| 15 | ["What can this packet grow?" specification](15-packet-scale-spec.md) | product lane |
| 16 | [Pricing & unit economics (ranges, no final prices)](16-pricing-economics.md) | economics lane |
| 17 | [Database change plan](17-database-plan.md) | DB lane |
| 18 | [Admin command center](18-admin-command-center.md) | ops lane |
| 19 | [Checkout & fulfillment plan](19-checkout-fulfillment.md) | ops lane |
| 20 | [Legal & policy copy requirements](20-legal-policy-copy.md) | compliance procedures |
| 21 | [Test & acceptance plan](21-test-plan.md) | ops lane |
| 22 | [Exact repository changes](22-repo-changes.md) | DB lane |
| 23 | [Prioritized implementation sequence](23-implementation-sequence.md) | DB lane |
| 24 | [Final launch verdict](24-launch-verdict.md) | synthesis |

Deliverable 25 (the verdict value itself) is stated in 01 and 24.

## Locked decisions this pack is built around

- Customer **chooses** the Drop size — Gnome recommends, never dictates.
  Sizes: 4 (Patio) / 8 (Garden) / 12 (Harvest) / Build-Your-Drop 4–20.
- Packets are **unopened, unaltered, original supplier-labeled**; the supplier
  packet remains the controlling label. Gnome never opens, divides, repackages,
  relabels, or covers packets and never claims to be grower/producer/labeler.
- Fulfillment from one Ohio location to explicitly cleared contiguous-48 states
  only. AK/HI/territories/APO/international excluded from fulfillment, but
  account creation and lawful marketplace participation stay open nationwide.
- No mode bypasses inventory, destination restrictions, entitlements, packet
  counts, eligibility, capacity, or compliance. Nothing is silently substituted
  after approval.
- Existing safeguards preserved: real lots only, race-safe reservation,
  germination ≥70% or eligible fresh-untested, retest-date currency,
  zone-adjusted sowing, sun/container/beginner matching, user exclusions,
  Stripe webhook idempotency.
- AI never fills regulatory, label, germination, lot, or compliance data —
  missing required data → REVIEW_REQUIRED / unavailable.

## Standing prohibitions until Daniel's approval

No nationwide enablement · no Seed Drop migrations applied · no Stripe changes ·
no inventory purchases · no agency contact (drafts only) · no supplier
agreements · no final prices published · unresolved states are never
represented as cleared.
