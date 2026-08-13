# Unresolved questions — the complete list

Compiled 2026-08-13. Everything below is a question that research could not
resolve from primary sources alone and that must NOT be treated as resolved
until a written agency answer (or counsel opinion) exists. Full question text
and context live in the linked documents; this is the master index.

**Rule restated: uncertainty is never converted to approval.** A state with an
open question ships nothing until the question is closed and the allowlist row
is flipped by an explicit admin action.

## A. Federal (10 questions — full text in [02-federal-memo.md](02-federal-memo.md))

| # | Question (short form) | Blocking? |
|---|---|---|
| F1 | Does the supplier's name on the packet satisfy interstate-shipper identification when Boone is the reseller placing seed into interstate commerce (7 CFR 201.27(c))? | **Yes — the central federal question** |
| F2 | Is a supplemental, non-covering Boone Systems sticker permitted, and does adding it make Gnome a labeler? | Mitigation path for F1 |
| F3 | Is the AMS code designation available/appropriate for a D2C reseller? | No (optional tool) |
| F4 | How do germination-test currency rules apply to a reseller holding inventory? | Operational |
| F5 | How does the ≥400-seed file-sample duty (201.4) apply to small retail packets a reseller never opens? | Operational |
| F6 | Status of herbs NOT on the 201.2(i) vegetable list (basil, cilantro, thyme…)? | Catalog scoping |
| F7 | Is the outer parcel a "container" with its own labeling consequence? | Yes, pairs with F1 |
| F8 | In supplier drop-shipping, who is the interstate shipper? | Future model only |
| F9 | Written confirmation that no FSA license/registration applies to this model | Confirmation |
| F10 | Tamper-evidence/organic presentation expectations (NOP, not SRTD) | Copy/ops |

## B. Ohio (9 questions — full text in [03-ohio-memo.md](03-ohio-memo.md))

| # | Question (short form) |
|---|---|
| O1 | Written confirmation a reseller of another permitted labeler's sealed packets needs no Ohio labeler permit (the ORC 907.13 negative inference) |
| O2 | Whether the outer envelope + packing slip constitutes "labeling" |
| O3 | Fee/annual-report exposure for a non-permit-holder, incl. out-of-state suppliers |
| O4 | Supplier-permit verification duty and exposure if an upstream labeler is unpermitted (ORC 907.08(H)) |
| O5 | Whether the fulfillment address must be disclosed; inspection-access expectations |
| O6 | Handling of inventory whose germination test date lapses (12/36-month rule) |
| O7 | Reliance on supplier labels without independent testing |
| O8 | Records ODA expects from a non-permit-holder seller |
| O9 | Inoculant-registration coverage for pre-inoculated legume packets |

## C. Destination states — AGENCY CONFIRMATION REQUIRED (17)

Full field-level detail, citations, and a send-ready inquiry for every state
below live in the region files. One-line core questions:

| State | Core unresolved question | Region file |
|---|---|---|
| ME | License attaches to labeling; statute silent on resellers — who must hold it? | [NE+Pacific](matrix/region-ne-pacific.md) |
| VT | Agency says "all seed companies" register ($85); rule text reaches only "manufacturing or processing" — which controls? | [NE+Pacific](matrix/region-ne-pacific.md) |
| CT | Registration attaches to whoever performs labeling — confirm reseller is out and supplier must be CT-registered | [NE+Pacific](matrix/region-ne-pacific.md) |
| WA | Sealed-package ≤8 oz dealer exemption hinges on supplier holding WSDA labeling registration — confirm per-supplier | [NE+Pacific](matrix/region-ne-pacific.md) |
| OR | Packet exemption (≤½ lb) requires packets "prepared by a seed company licensed under this section" — confirm supplier licensure; brassica blackleg rule scope | [NE+Pacific](matrix/region-ne-pacific.md) |
| VA | License attaches to "person whose name appears on the label" — confirm packing slip doesn't count | [Southeast](matrix/region-southeast.md) |
| KY | Permits attach to labeling / ≥40-lb ag dealers — confirm reseller needs nothing (KRS 250 chain partially verified) | [Southeast](matrix/region-southeast.md) |
| TN | § 43-10-118 license likely, but TDA frames it as a guarantor instrument; official T.C.A. Lexis-gated | [Southeast](matrix/region-southeast.md) |
| AR | License scoped to agricultural field-crop seed; confirm veg/herb/flower packets outside it | [South+Mountain](matrix/region-south-mountain.md) |
| LA | Dealer registration reaches out-of-state distributors ($150/yr) — confirm whether "one pound or more" leaves sub-1-lb packets out | [South+Mountain](matrix/region-south-mountain.md) |
| TX | §61.013(e) exempts sellers of containers bearing a TX licensee's name — verify each supplier's TX license | [South+Mountain](matrix/region-south-mountain.md) |
| CO | Prepackaged ≤1 lb retail exemption requires the supplying labeler to be CO-registered — verify suppliers, else $130/yr | [South+Mountain](matrix/region-south-mountain.md) |
| WY | License reaches "any person who sells… in Wyoming," fee tied to in-state places of business — ambiguous for no-nexus shipper | [South+Mountain](matrix/region-south-mountain.md) |
| NM | Labeling-only regime per rules/agency page, but primary NMSA text unreadable at the official portal | [South+Mountain](matrix/region-south-mountain.md) |
| NV | Retail container ≤½ lb fee exemption names vegetable/flower — confirm herb seed is included | [South+Mountain](matrix/region-south-mountain.md) |
| MN | Non-labeling resellers "generally" need no permit — confirm in writing; supplier Category B permit dependency; "first sale in the state" fee mechanics | [Midwest](matrix/region-midwest.md) |
| NE | Permit attaches to labeling, but "labeling" includes representations on invoices — confirm a packing slip doesn't capture the reseller | [Midwest](matrix/region-midwest.md) |

## D. Cross-cutting questions surfaced by the research

1. **Supplier-credential dependency** (WI, IA, MN, CT, WA, OR, TX, CO, and the
   Ohio 907.08(H) duty): lawful resale in these states depends on the SUPPLIER
   holding that state's labeler/permit/registration. → One supplier-credential
   audit (which states is each supplier licensed in?) is a launch prerequisite
   and a contract representation (see [07-supplier-review.md](07-supplier-review.md)).
2. **Brassica destination restrictions** (WA crucifer quarantine, OR blackleg):
   possibly the first per-product `excluded_states` rows in the inventory
   model — scope unresolved.
3. **Flower and unlisted-herb seed** are outside the FSA and outside several
   state acts, but fully covered in others (WI, MI, NE, ND, SD…) — catalog
   classification must be per-state, not global.
4. **Auto-renewal statute specifics** and **state privacy-law specifics** for
   the subscription copy (flagged in [20-legal-policy-copy.md](20-legal-policy-copy.md)) —
   needs its own lane; not a seed-law question.
5. **Garlic** ships as bulbs, not sealed seed packets — outside the locked
   model; include only after its own compliance pass (see 12-product-spec §11).

## E. Non-regulatory open inputs

- Real wholesale price lists, minimums, freight terms → final pricing
  ([16-pricing-economics.md](16-pricing-economics.md) §9 lists all 12).
- Supplier written authorizations (resale, trademarks, images, drop-ship).
- Facility decision (home vs storage-unit-dead-storage vs flex space) —
  zoning/lease/insurance confirmations per [03-ohio-memo.md](03-ohio-memo.md).
