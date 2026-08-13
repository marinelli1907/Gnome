# 20 — Legal / Policy Copy Requirements (Seed Drop V1)

**Doc:** Seed Drop V1 — required changes to customer-facing legal & policy copy
**Entity:** Boone Systems LLC (Ohio) · Gnome Farmers Market · Seed Drop
**Date:** 2026-08-13 · **Owner:** Daniel Marinelli
**Status:** Requirements + draft language. **This is not legal advice. Every
block marked DRAFT requires attorney review before publication.** Items
depending on pending research are marked `PENDING: <memo>`.

Related: `02-federal-memo.md`, `03-ohio-memo.md`, `matrix/`,
`08`–`11` procedures, `17-database-plan.md`.

---

## 0. Global rules (apply to every document below)

**G1 — Mandatory disclosure set.** Wherever Seed Drop is described (ToS, Seed
Drop terms, product pages, checkout, FAQ), the copy must accurately disclose
ALL of the following. None may be contradicted anywhere:

1. Packets are **unopened, original supplier-labeled retail seed packets**
   resold by Boone Systems LLC.
2. **Gnome does not produce, test, or repackage seeds**; the original
   supplier's label is the **controlling** source of kind, variety, lot,
   germination, and any treatment information.
3. **Availability varies** — by state, season, inventory, and fulfillment
   capacity; specific varieties are never guaranteed.
4. **Recommendations depend on customer-provided information** (location/
   zone, garden setup, sun, experience, preferences, exclusions).
5. **Outcomes are not guaranteed**; germination and harvest depend on
   environment, timing, and care.
6. **Some packets are selected for future planting windows** — receiving
   seeds before their planting season is intended behavior.
7. **Drop size/frequency can change** at the customer's request subject to
   published season cutoffs.
8. **Gnome may stop sale of, replace, refund, or recall** affected packets
   at any time.

**G2 — Prohibited copy.** Never publish, in any document, page, email, or AI
output: (a) any claim that Gnome/Seed Drop is **"fully compliant nationwide"**
or equivalent ("legal in all 50 states", "approved by regulators");
(b) germination/harvest guarantees; (c) organic claims beyond §12;
(d) any statement that Gnome tests, certifies, or verifies seed quality.
Safe alternative framing: *"available in the states we currently ship to."*

**G3 — Savings clause required.** Every disclaimer/limitation section must
carry a savings clause because some consumer rights cannot be waived, and the
enforceable scope of seed-quality disclaimers has limits (Federal Seed Act
"nonwarranty" clauses do not shield against FSA labeling duties —
**scope `PENDING: 02-federal-memo.md`**; state consumer-protection floors
generally). DRAFT — attorney review required:

> Some jurisdictions do not allow the exclusion of certain warranties or the
> limitation of certain damages, and nothing in these terms waives rights
> you have under applicable law that cannot be waived. Where any part of
> this section is unenforceable, the remainder applies to the fullest
> extent permitted.

**G4 — Plain language + placement.** Disclosures appear before purchase (not
only in the ToS), in plain language, not buried; subscription cost terms
appear adjacent to the purchase button (§4).

---

## 1. Terms of Service — required changes

- R1.1 Add a **Seed Drop section** (or incorporate the Seed Drop Terms, §3,
  by reference) carrying the full G1 disclosure set.
- R1.2 State the **reseller role**: Boone Systems LLC sells packets produced
  and labeled by third-party suppliers; supplier label controls (G1.1–1.2).
- R1.3 **Geographic scope**: sales offered only to shipping addresses in
  states Gnome currently ships to; the current list is shown at checkout and
  may change. Never enumerate "all states except…" — reference the live
  allowlist (`09` §A). No copy may promise future state availability.
- R1.4 **Warranty disclaimer** limited per G3: disclaim implied warranties
  **to the extent permitted**, with the savings clause, and without
  purporting to disclaim accuracy of supplier label information (limits
  **PENDING: 02-federal-memo.md** on FSA nonwarranty treatment).
- R1.5 **Remedy framing**: replacement or refund of the affected packet(s)
  as the standard remedy (§8), stated as Gnome's policy remedy — attorney to
  confirm limitation-of-liability enforceability; savings clause applies.
- R1.6 **Recall cooperation**: customer agrees Gnome may contact them about
  recalls/stop-sales and may cancel-and-refund affected items (G1.8).
- R1.7 **AI features**: recommendations are informational, based on
  customer-provided info and real inventory; the deterministic engine and
  supplier label control; AI never overrides label instructions (§10).

## 2. Privacy Policy — required changes

- R2.1 Disclose collection/use of **garden profile data** (location/ZIP,
  zone, garden setup, sun, experience, preferences, exclusions) to
  personalize Drops (G1.4), and that recommendation quality depends on it.
- R2.2 Disclose **shipping data** shared with carriers (name, address,
  tracking) and payment processing via Stripe (Gnome does not store full
  card numbers).
- R2.3 Disclose **retention of order/shipment/compliance records** for the
  periods in `10-record-retention.md` and that these are retained even after
  account deletion where required by law (recall traceability); deletion
  requests honor this carve-out expressly.
- R2.4 Disclose **recall contact** as a service/legal communication that
  cannot be opted out of while an order is affected.
- R2.5 State-privacy-law specifics (rights notices, categories tables)
  **PENDING** general privacy research — not covered by the seed memos;
  attorney to confirm applicability thresholds for a business of this size.

## 3. Seed Drop Terms (dedicated document) — required content

- R3.1 The full **G1 set verbatim-equivalent**, plus: what a Drop is, how
  seasons work (windows, join cutoffs, generation dates per
  `SEASONAL_SUBSCRIPTION.md`), skip rules, and that a skipped season is
  never charged.
- R3.2 **Selection disclosure** (DRAFT — attorney review required):
  > Each Drop is chosen from real, in-stock packets using the details you
  > give us — your location and zone, garden setup, sun, experience, and
  > preferences — plus the season and what we've sent you before. We pick
  > from what's actually available, so specific varieties are never
  > guaranteed, and availability differs by state, season, inventory, and
  > our capacity to fulfill.
- R3.3 **Future-window disclosure** (DRAFT — attorney review required):
  > Some packets in your Drop are chosen for planting windows that haven't
  > opened yet. Getting seeds early is on purpose — store them cool and dry
  > and check the packet and your Drop notes for timing.
- R3.4 **Change/cutoff disclosure** (G1.7): size/frequency/preference
  changes apply to the next Drop only if made before that season's cutoff;
  the cutoff date is shown in-app.
- R3.5 **Stop/replace/refund/recall right** (G1.8) with pointer to §8/§11.

## 4. Subscription & auto-renewal disclosures — required changes

Auto-renewal statutes (state ARL/negative-option laws, and FTC negative-
option rules) impose specific duties. **Statute-by-statute specifics are
PENDING research** (not covered by the seed memos — flag for a dedicated
lane). The design floor that must ship regardless:

- R4.1 **Clear and conspicuous pre-purchase disclosure**, adjacent to the
  consent button: price per seasonal Drop ($24.99 or then-current), that it
  recurs **each season (up to 4×/year) until cancelled**, when charges
  occur (at season generation), and how to cancel.
- R4.2 **Affirmative consent** to the recurring charge (its own checkbox or
  unambiguous button copy — not pre-checked, not bundled into ToS assent).
- R4.3 **Post-purchase acknowledgment** (email) restating price, cadence,
  and cancellation method.
- R4.4 **Easy cancellation**: online, in-app, no phone call required, no
  retention wall; effective for any season whose cutoff hasn't passed.
  ("Click-to-cancel" symmetry: cancelling is as easy as subscribing.)
- R4.5 **Renewal reminders** where required (some states require notice
  before renewal for certain terms — **PENDING** ARL research; build the
  pre-season email regardless: "your {{season}} Drop generates on {{date}},
  skip or cancel by {{cutoff}}").
- R4.6 **Price-change notice**: advance notice + fresh consent where
  required — **PENDING** ARL research; interim rule: notify ≥ 1 full season
  ahead and require an affirmative continue for price increases.
- DRAFT checkout copy (attorney review required):
  > Seasonal Seed Drop — $24.99 per seasonal Drop, up to 4 seasons per
  > year. We charge when your seasonal Drop is generated, each season,
  > until you cancel. Skip any season free before its cutoff. Cancel
  > anytime in the app — takes effect for any season whose cutoff hasn't
  > passed.

## 5. Cancellation / renewal disclosures — required changes

- R5.1 A standalone help/policy page: how to cancel (exact in-app steps),
  what happens to an already-generated season (generated-but-unshipped
  handling must match actual system behavior — sync with billing docs),
  skip vs. cancel, and that history is preserved after cancellation.
- R5.2 No copy may imply refunds of past seasons on cancellation; refunds
  are governed by §8.
- R5.3 "Pause" must not appear in customer copy until pause is real
  (per `SEASONAL_SUBSCRIPTION.md` — a paused label with live charges is
  forbidden).

## 6. Shipping policy — required changes

- R6.1 State: ships **from Ohio** to addresses in the **states we currently
  ship to** (live list at checkout); **no** AK/HI/territories/APO/FPO/
  international (allowlist framing per G2/R1.3).
- R6.2 Plain padded envelope/box; several packets per Drop; packing slip
  contents summary; carrier + tracking provided.
- R6.3 Seasonal timing: Drops ship inside season ship windows, not
  on-demand; joining after a cutoff means the next season (G1.6–1.7).
- R6.4 Destination-state notice requirements on the slip/policy
  **PENDING: matrix/**; shipper-identification wording
  **PENDING: 02-federal-memo.md** (`09` §E5–E6).
- R6.5 Address-change cutoff mirrors season cutoff; PO-box handling matches
  carrier constraints (`09` §F1).

## 7. Prohibited-items policy — required changes

- R7.1 Publish the exclusion list as customer-facing copy: no live plants,
  bulbs, soil, insects, imported seed, hemp/cannabis, noxious or specially
  regulated species, quarantined or recalled products, and no items
  prohibited for the destination.
- R7.2 Frame as "Gnome does not sell/ship", not as legal conclusions about
  any jurisdiction; per-state specifics **PENDING: matrix/**.

## 8. Replacement / refund policy — required changes

- R8.1 Standard remedy: **replacement in the next Drop or refund of the
  affected packet(s)** — customer's choice where both are offered — for
  damaged, missing, wrong, or recalled packets; whole-Drop refund when the
  Drop itself failed (not shipped, lost).
- R8.2 Response-time promise only if operationally real (2 business days
  per `11` §4 template — keep consistent).
- R8.3 No requirement to return seed packets unless Gnome asks (recall
  logistics per `11` §6).
- R8.4 Must not condition refunds on waiving other rights; savings clause
  (G3) applies.

## 9. Seller rules (marketplace side) — required changes

- R9.1 Make explicit that **Seed Drop packets are sold by Boone Systems
  LLC**, not by marketplace growers/sellers; marketplace listings and Seed
  Drop are distinct programs with distinct terms.
- R9.2 Marketplace seller rules must prohibit sellers from listing items on
  the §7 exclusion list, and from using Seed Drop branding for their own
  listings.

## 10. Growing-guidance disclaimers — required changes

Everywhere guidance appears (AI gardener, Drop notes, packet pages):

- R10.1 DRAFT (attorney review required):
  > Growing guidance is general information based on what you've told us
  > about your garden. It isn't a guarantee — germination and harvest
  > depend on your soil, weather, timing, and care. Always follow the
  > instructions and any warnings on the supplier's packet label; if our
  > guidance and the label differ, the label wins.
- R10.2 AI outputs must never contradict a supplier label, state germination
  figures not on the label, or make outcome promises (ties to G2; enforce in
  AI system prompts, not just policy copy).
- R10.3 No edible/medicinal-use claims beyond ordinary culinary use of
  common vegetables/herbs.

## 11. Recall notices — required changes

- R11.1 Templates live in `11-recall-stop-sale.md` §4 (DRAFT — attorney
  review required before first use); policy copy must reserve the right to
  send them (R1.6, R2.4).
- R11.2 A public recall page pattern (published only during an active
  incident): factual identification of supplier/kind/variety/lot, do-not-
  plant instruction, remedy offer, contact — **no fault admission, no cause
  speculation**, and no naming of agencies except factually.

## 12. Supplier attribution & organic claims — required changes

- R12.1 **Attribution**: every packet display shows the supplier's name as
  producer/labeler; Gnome identified as reseller. Packing slip lists
  supplier per packet (`09` §E2).
- R12.2 **Organic**: Gnome may repeat a supplier's organic claim **only
  verbatim and only with attribution** — e.g., *"Labeled by {{supplier}} as
  USDA Certified Organic"* — and only when the certificate reference is on
  file (`08` §E3). Gnome never applies the word "organic" to anything in
  its own voice, never uses the USDA seal in Gnome UI, and drops the claim
  entirely if documentation is missing. Whether a reseller of sealed
  packets is NOP-exempt and any retailer duties:
  **PENDING: 02-federal-memo.md** (NOP retailer treatment).
- R12.3 No "non-GMO", "heirloom", "pesticide-free" etc. in Gnome's voice —
  same verbatim-with-attribution rule as organic.

## 13. Customer support content — required changes

- R13.1 Macros/FAQ answers must use this doc's framing: reseller role,
  supplier label controls, availability varies, outcomes not guaranteed,
  future-window packets are intentional, cutoff-based changes, standard
  remedy. Support never freelances legal-sounding assurances
  (G2 applies to support replies and AI support drafts).
- R13.2 FAQ entries required at launch: "Why did I get seeds I can't plant
  yet?" (G1.6); "Why is a variety unavailable / different from last
  season?" (G1.3); "Do you ship to my state?" (allowlist framing);
  "Are your seeds organic?" (§12 framing); "A packet arrived damaged"
  (§8); "How do I cancel or skip?" (§4–5).
- R13.3 Escalation rule in support playbook: anything mentioning an agency,
  attorney, injury, or recall goes to the owner — no templated reply
  (`11` §9 RACI).

---

## 14. Launch gate for this doc

Copy work is DONE when: every R-item is implemented or consciously deferred
by the owner; every DRAFT block has attorney sign-off; every PENDING item is
resolved against its landed memo; and a re-read confirms no page anywhere
violates G2. Track PENDING closures here:

| Item | Blocked on |
|---|---|
| R1.4 / G3 warranty-disclaimer scope | 02-federal-memo.md (FSA nonwarranty) |
| R4.5 / R4.6 ARL specifics; R4 statute list | Dedicated auto-renewal research lane |
| R6.4 destination notices + shipper ID wording | matrix/ + 02-federal-memo.md |
| R7.2 per-state prohibited specifics | matrix/ |
| R12.2 NOP retailer treatment | 02-federal-memo.md |
| R2.5 state privacy specifics | Dedicated privacy research lane |
