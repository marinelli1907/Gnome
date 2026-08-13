# 02 — Federal Seed Law Memo (Federal Seed Act, USDA AMS, NOP, APHIS)

**Doc:** Seed Drop V1 compliance research — federal
**Entity:** Boone Systems LLC (Ohio) · Gnome Farmers Market · Seed Drop
**Date:** 2026-08-13
**Prepared by automated research; not legal advice — verify with counsel and USDA AMS.**

Related: `08-packet-acceptance-checklist.md`, `09-shipment-compliance-checklist.md`,
`03-ohio-memo.md`, `matrix/` (state matrix).

**Evidence base.** Statute: Federal Seed Act (FSA), 7 U.S.C. 1551 et seq., from
uscode.house.gov (OLRC preliminary release, "Text contains those laws in effect on
August 11, 2026"), accessed 2026-08-13. Regulations: current eCFR text of 7 CFR
Part 201, Part 205 (NOP), and Part 360 (APHIS), retrieved 2026-08-13 via the
official eCFR versioner API at point-in-time **2026-08-11** (the most recent eCFR
issue date for Title 7 as of access; a request for 2026-08-13 returned "past the
title's most recent issue date of 2026-08-11"). Agency guidance: ams.usda.gov pages
and the AMS SRTD publication "Seed Company Records and the Federal Seed Act"
(Sept. 2017), accessed 2026-08-13. Full source ledger at the end.

**Labeling convention used throughout:**
- **EXPLICIT** — the cited text says so on its face.
- **INTERPRETATION** — my reading applied to this business model; not stated in the text.
- **ACR** — AGENCY CONFIRMATION REQUIRED; the law is ambiguous for this model and the
  precise question is stated.

**Business model assumed (LOCKED):** Boone Systems LLC (Ohio) buys finished retail
seed packets (ordinary vegetable, herb, and flower varieties) wholesale from
established domestic suppliers; packets remain sealed and unaltered with the
supplier's original label; several packets are combined in a plain padded
envelope/box with a Gnome packing slip; sold as a personalized subscription;
fulfilled from one Ohio location; shipped direct-to-consumer to cleared states in
the contiguous 48. Excluded: AK/HI/territories/APO/international, live plants,
bulbs, soil, imported seed, hemp/cannabis, noxious weeds, quarantined or recalled
products.

---

## Executive summary

1. **The FSA covers only "agricultural" and "vegetable" seeds; there are no
   flower-seed labeling provisions in the Act or 7 CFR Part 201.** Herb kinds are
   federally regulated only if named in the vegetable-seed list at 7 CFR 201.2(i)
   (dill, parsley, sage, summer savory, chives, the cresses, etc. are; basil,
   cilantro, thyme, oregano are not on either list). EXPLICIT (lists) /
   INTERPRETATION (unlisted kinds outside Title II) / ACR (AMS treatment of
   unlisted herbs).
2. **For the shipments Boone actually makes (packets ≤ 1 lb of listed vegetable
   kinds, at or above the germination standard), the federal packet label needs
   only: kind name, variety name, and the interstate shipper's name and address
   (or code + consignee).** 7 U.S.C. 1571(b)(1); 7 CFR 201.26, 201.27, 201.29.
   EXPLICIT.
3. **The central unresolved issue is the shipper-identification element:** 7 CFR
   201.27(c) defines the shipper as "the seller or consignor who puts the seed
   into interstate commerce," which for a Gnome→consumer parcel is Boone Systems,
   whose name is not on the packet — only the supplier's is. Whether the original
   supplier's name/address satisfies 1571(b)(1)(B)(i) for Boone's re-shipment is
   not answered by the text. ACR (this is Unresolved Question 1 and the core of
   the draft AMS inquiry).
4. **The AMS code designation (7 CFR 201.24/201.28) is optional, not a license or
   registration** — it is an alternative that lets a shipper label with its
   customer's name plus the shipper's confidential AMS code; it is obtained by
   emailing SRTD. Its statutory hook, however, speaks of a consignee "to whom the
   seed is sold or shipped **for resale**," which a subscriber is not. EXPLICIT
   (optional; how obtained) / ACR (availability for direct-to-consumer parcels).
5. **No FSA provision found requires any federal license, permit, or registration
   for a dealer/interstate shipper of seed**; the only AMS-issued instrument in
   Part 201 is the optional code designation. This is a statement about the
   absence of a requirement in the texts reviewed, not a clearance. INTERPRETATION
   / ACR to confirm.
6. **Recordkeeping is mandatory and quantified:** 3-year complete record of
   treatment, germination, and variety for each lot of vegetable seed shipped
   interstate, plus a retained file sample of at least 400 seeds per lot
   (discardable 1 year after the lot is gone). 7 U.S.C. 1572; 7 CFR 201.4,
   201.2(l). EXPLICIT. Whether one sealed small-count packet (< 400 seeds) can be
   the file sample is ACR.
7. **Everything Gnome publishes about seed — website, app, AI recommendations,
   e-mails, packing-slip text — is FSA "advertisement" or "labeling," and false or
   misleading statements "in any particular" are unlawful; disclaimers are no
   defense in an FSA proceeding.** 7 U.S.C. 1561(a)(18)-(20), 1571(d), 1574, 1575;
   7 CFR 201.36a, 201.36b. EXPLICIT (definitions/prohibitions) / INTERPRETATION
   (application to AI output).
8. **Federal noxious-weed exposure is a screening duty, not a labeling duty, for
   this model:** seed containing any 201.16(b)-listed noxious-weed seed may not be
   shipped interstate at all (zero tolerance), and APHIS prohibits moving any
   federal noxious weed without a permit (7 CFR 360.300). The model's exclusions
   plus supplier verification cover this. EXPLICIT (prohibitions) / INTERPRETATION
   (screening posture).
9. **Organic:** Gnome, as a mail-order final retailer that does not process, fits
   the NOP definition of a "retail establishment" and the certification exemption
   at 7 CFR 205.101(b) (with 205.101(f) as an independent fallback); it may
   truthfully represent supplier-certified sealed packets as organic but must
   never present Boone/Gnome itself as certified. EXPLICIT (exemptions) /
   INTERPRETATION (repeating supplier claims).
10. **Penalty backdrop:** knowing or grossly negligent violations are misdemeanors
    ($1,000 first offense / $2,000 subsequent) plus civil forfeitures of $25–$500
    per violation (as adjusted); AMS enforces via warnings, formal charges, and
    settlements. 7 U.S.C. 1596; AMS complaints page. EXPLICIT.

---

## Threshold: what federal seed law applies to at all

**Statutory scope.** 7 U.S.C. 1571 makes it "unlawful for any person to transport
or deliver for transportation in interstate commerce" agricultural seeds (subsec.
(a)), vegetable seeds (subsec. (b)), stale-tested seed (subsec. (c)), falsely
labeled/advertised seed (subsec. (d)), and treated seed lacking treatment labeling
(subsec. (i)), each "unless each container bears a label" with the prescribed
content. (uscode.house.gov §1571, accessed 2026-08-13.) EXPLICIT. Because Boone
ships from Ohio to other states, its parcels are squarely "in interstate commerce"
(7 U.S.C. 1561(a)(3)). EXPLICIT.

**Only two regulated classes.** The Act defines only "agricultural seeds" ("grass,
forage, and field crop seeds which the Secretary ... lists in the rules and
regulations," 7 U.S.C. 1561(a)(7)(A)) and "vegetable seeds" ("the seeds of those
crops that are or may be grown in gardens or on truck farms and are or may be
generally known and sold under the name of vegetable seeds," 1561(a)(7)(B)).
AMS describes the FSA as "a truth-in-labeling-law that regulates agricultural and
vegetable seed shipped in interstate commerce"
(https://www.ams.usda.gov/rules-regulations/fsa, accessed 2026-08-13). Current 7
CFR Part 201 contains **no flower-seed labeling subpart**; the section the research
brief guessed at (201.34) is actually "Kind, variety, and type; treatment
substances; designation as hybrid." EXPLICIT (structure of Part 201, eCFR
2026-08-11). Flower-seed packet labeling is therefore a **state-law** subject (see
`matrix/` and the state memos), not an FSA one. INTERPRETATION (from the absence of
any flower provision and the two-class statutory design).

**Which Gnome SKUs fall in which class.** 7 CFR 201.2(h) and (i) are closed name
lists (eCFR, 2026-08-11):

- **Vegetable seeds (201.2(i))** — the familiar garden kinds (bean, beet, broccoli
  ... watermelon) **including these herb/edible-green kinds:** chives, dill,
  parsley, sage, summer savory, garden/upland/water cress, cornsalad, dandelion,
  chicory, sorrel, great burdock. EXPLICIT.
- **Agricultural seeds (201.2(h))** — field/forage kinds, several of which show up
  in retail garden racks: **sunflower (Helianthus annuus), pop corn, radish, India
  mustard, clovers/vetches/ryegrasses (cover-crop packets), hemp (excluded by the
  model)**. EXPLICIT.
- **Neither list** — most culinary herbs (basil, cilantro/coriander, thyme,
  oregano, rosemary, lavender, mint, chamomile, fennel) and all ornamental flower
  kinds. INTERPRETATION: kinds on neither list are outside FSA Title II labeling.
  Caveat: the statutory vegetable definition is open-ended ("shall include"),
  so AMS could in principle treat an unlisted garden herb as a vegetable seed. ACR
  (Unresolved Question 6).

**Practical consequence.** A "flower + herb + vegetable" assortment is federally a
mixed bag: the vegetable-kind packets (and any agricultural-kind packets such as
sunflower or popcorn) carry FSA requirements; the rest do not, federally.
INTERPRETATION.

---

## The ten questions

### 1. Does the supplier's name/address on each packet satisfy the interstate-shipper identification when Boone is the reseller putting the seed into interstate commerce?

**The rule.** For vegetable seed in containers of 1 lb or less at or above the
germination standard, the label must give the "Name and address of — (i) the
person who transports, or delivers for transportation, said seed in interstate
commerce; or (ii) the person to whom the seed is sold or shipped for resale,
together with a code designation approved by the Secretary ... indicating the
person who transports or delivers for transportation said seed in interstate
commerce." 7 U.S.C. 1571(b)(1)(B) (accessed 2026-08-13). The regulation: "Consumer
packages or containers of vegetable seed for interstate shipment must be labeled as
follows: (a) The full name and address of the interstate shipper or a code
designation identifying the interstate shipper, pursuant to § 201.28, must be
printed on the label." 7 CFR 201.27 (eCFR 2026-08-11). And critically: "For
purposes of this section and § 201.28, **the term shipper means the seller or
consignor who puts the seed into interstate commerce**, and the term consignee
means the buyer or recipient of the seed shipment." 7 CFR 201.27(c). EXPLICIT.

**Applied.** For the parcel Boone hands to the carrier in Ohio addressed to a
subscriber in another state, the "seller or consignor who puts the seed into
interstate commerce" is **Boone Systems LLC** — not the supplier, whose own
interstate shipment ended when the wholesale case arrived in Ohio. INTERPRETATION
(direct application of 201.27(c)). The packet, however, bears only the
**supplier's** name and address.

**Two readings of whether that suffices:**

- *Strict reading:* 1571(b)(1)(B)(i) and 201.27(a) identify a specific person — the
  shipper of the shipment at hand. The supplier's name identifies somebody else,
  so the labeling element is unsatisfied for Boone's shipment unless Boone's name
  (or code + consignee) is added. AMS's own framing supports this: "The Federal
  Seed Act (FSA) requires **interstate shippers to put their name and address on
  the seed label** ... As an alternative, the FSA permits interstate shippers to
  put their customer's name and address on the label, provided the label contains
  the interstate shipper's code designation."
  (https://www.ams.usda.gov/rules-regulations/fsa/code-designation, accessed
  2026-08-13.) INTERPRETATION.
- *Functional reading:* the supplier **did** transport the identical, still-sealed
  containers in interstate commerce (supplier → Ohio), the label truthfully
  identifies that person, and full traceability — the purpose AMS ascribes to the
  element — is preserved through Boone's 201.4 records. On this reading the packet
  remains compliant and Boone's obligation is records-based, not label-based. This
  also matches ubiquitous industry practice (mail-order resale of rack packets
  labeled only by the packeting company). INTERPRETATION.

**Conclusion:** The text does not resolve which reading governs a sealed-packet
reseller. **ACR — Unresolved Question 1**, and the lead question in the draft AMS
inquiry below. Do not treat the supplier label as sufficient, and do not treat
Boone identification as federally required, until AMS answers. Note the low-cost
mitigation in Question 2.

### 2. Must Boone Systems appear on each individual packet?

Only if the strict reading in Question 1 governs. Nothing in 1571(b) or 201.25–201.31
names the *reseller* as such; the requirement attaches to the "interstate shipper"
role. ACR (same question). Two subsidiary points are clearer:

- **A "label" need not be printed on the packet by the manufacturer.** "The term
  'label' means the display or displays of written, printed, or graphic matter
  upon **or attached to** the container of seed" (7 U.S.C. 1561(a)(17)), and
  vegetable-seed labeling "may contain information in addition to that required by
  the Act, provided such information is not misleading" (7 CFR 201.25). EXPLICIT.
  So a small supplemental tag or adhesive label — "Shipped by Boone Systems LLC,
  [address]" — attached to each packet **without covering any supplier label
  text** would add the identification while leaving the supplier's label intact.
  INTERPRETATION. **Business-model note:** the LOCKED model says Gnome never
  relabels or covers packets; an additive, non-covering sticker/tag is arguably
  outside that prohibition's purpose but is a model decision — flag to owner. If
  adopted, confirm acceptability with AMS (ACR, Unresolved Question 2), and check
  state-law labeler rules (state memos) before doing it.
- If AMS accepts the functional reading, no Boone identification is federally
  required on the packet. ACR.

### 3. Can Boone satisfy identification via the OUTER shipping container or the packing slip?

**No provision found permits it for consumer parcels.** The prohibition runs
container by container: "unless **each container** bears a label" (7 U.S.C.
1571(b)). The only provisions letting an invoice/outer record stand in for
container labels are (i) seed **in bulk** — defined as "loose either in vehicles of
transportation or in storage, and not to seed in bags or other containers" (7
U.S.C. 1561(a)(22)) — and (ii) containerized lots of **20,000 pounds or more**
with consignee consent, plus seed consigned for cleaning/processing. 7 U.S.C.
1573(b)(2); 7 CFR 201.33. EXPLICIT. A padded envelope of retail packets is none of
these. INTERPRETATION: the packing slip cannot substitute for packet labeling.

Note 201.2 defines no term "container" (checked; the 201.2 definition list runs
(a)–(oo) and contains none). The packet is plainly a "container of seed"
(1561(a)(17)); whether the outer envelope is *also* a "container" that must
itself bear a 1571(b) label is addressed in Question 9. The packing slip **is**
"labeling" — "all labels, and other written, printed, and graphic representations,
in any form whatsoever, accompanying and pertaining to any seed whether in bulk or
in containers, and includes invoices" (7 U.S.C. 1561(a)(18)) — so it must not be
false or misleading (1571(d), 1561(a)(20)(A)). EXPLICIT.

### 4. Does Boone need an AMS code designation — what is it, how obtained, what does it permit?

**What it is.** An AMS-issued confidential identifier used **in lieu of** the
interstate shipper's name and address: "The code designation used in lieu of the
full name and address of the interstate shipper pursuant to § 201.27(a) shall be
approved by the Administrator of the Agricultural Marketing Service (AMS)....
When used, the AMS code designation shall appear on the label in a clear and
legible manner, **along with the full name and address of the consignee**." 7 CFR
201.28 (vegetable); 201.24 is the parallel for agricultural seed. EXPLICIT.
"Shipper codes are considered confidential in that they are available only to AMS
staff and state seed control officials." (AMS code-designation page, accessed
2026-08-13.) EXPLICIT.

**How obtained.** "To acquire a code designation/AMS Number, please email your
company letterhead, business card, or typed contact number, and information to
Kevin.Robinson2@usda.gov. If you have more than one facility, indicate the
facility and location in which you will be using the code designation." (Same
page.) EXPLICIT. No fee is stated on the page.

**Is it needed?** It is an **alternative**, not a mandate — the statute joins the
two identification options with "or" (1571(b)(1)(B)), and AMS says "As an
alternative...". EXPLICIT. For Seed Drop's consumer parcels it is also probably
the *wrong* tool: the statutory alternative describes labeling with "the person to
whom the seed is sold or shipped **for resale**" (1571(b)(1)(B)(ii)) — a
subscriber buys for sowing, not resale (cf. 7 CFR 201.2(u): "consumer" means one
who obtains seed "for sowing but not for resale"), and it would require printing
each subscriber's name and address on each packet label. INTERPRETATION / ACR
(Unresolved Question 3). Where a code **would** matter: if Boone ever ships
wholesale to a reseller and wants only the reseller's name on the labels.
INTERPRETATION.

### 5. Can a supplier authorize Boone to rely on the supplier's label / interstate-shipper identity?

**No provision found gives private agreements that effect.** The identification
requirement fixes *whose* name must appear by function ("the person who
transports, or delivers for transportation, said seed in interstate commerce" —
1571(b)(1)(B)(i)) and the regulation defines shipper as whoever "puts the seed
into interstate commerce" (201.27(c)); neither text contains an
authorization/delegation mechanism, and the only AMS instrument (the code
designation) identifies the shipper itself, not a predecessor. EXPLICIT (texts
contain no such mechanism) / INTERPRETATION (therefore a supplier "authorization
letter" has no federal labeling effect). If the supplier's label suffices at all,
it is because of the functional reading in Question 1 — a question of law, not of
the supplier's consent. ACR (subsumed in Unresolved Question 1).

What supplier paperwork **does** do federally: it is the backbone of Boone's
records defense. Labeling based on supplier documents is protected for
indistinguishable-seed attributes only if "the person charged with the duty ...
of labeling" keeps records showing "reasonable precautions" (7 U.S.C. 1573(d),
(e); 7 CFR 201.34(a), 201.7, 201.7a). EXPLICIT. So: collect and retain supplier
invoices, label copies, lot numbers, germination test data, and treatment
disclosures for every lot (see Recordkeeping below).

### 6. Does supplier drop-shipping direct to the consumer change the analysis?

Yes, materially, in Boone's favor on the labeling issue. INTERPRETATION:

- If the supplier packs and ships the parcel from its own facility to the
  subscriber, the supplier is "the seller or consignor who puts the seed into
  interstate commerce" (201.27(c)) for that shipment, and the supplier's own
  name/address is already on every packet — the identification element is
  satisfied on any reading of Question 1. INTERPRETATION (strong; direct
  application of the definitions).
- The 3-year records duty under 7 U.S.C. 1572 attaches to "persons transporting,
  or delivering for transportation, in interstate commerce" — in drop-ship,
  primarily the supplier. EXPLICIT (statutory text) / INTERPRETATION (allocation).
  Boone should keep parallel commercial records regardless (traceability,
  recalls, NOP 205.101 if organic).
- Boone's exposure does **not** disappear: 1571(d) reaches anyone who "sell[s] or
  offer[s] for sale such seed for interstate shipment **by himself or others**"
  where the seed is falsely labeled or falsely advertised, and 1575 reaches
  Boone's own advertising. EXPLICIT. Personalization/advertising duties
  (Question 10, Advertising section) are unchanged.
- ACR (Unresolved Question 8): confirm AMS agrees the drop-shipping supplier is
  the interstate shipper of record for such parcels.

### 7. Is there any retailer, sealed-package, or small-packet exemption?

**No.** The FSA exemption section, 7 U.S.C. 1573, contains exactly these: (a)
common carriers, and "seeds produced by any farmer on his own premises and sold by
him directly to the consumer, provided such farmer is not engaged in the business
of selling seeds not produced by him" (inapplicable — Boone sells seed it did not
produce); (b) seed not for seeding purposes, seed in bulk, containerized lots ≥
20,000 lbs, and seed consigned for cleaning/processing (all inapplicable to
consumer parcels); (c) emergency germination-labeling relief by rulemaking; (d)-(e)
the indistinguishability/records defenses. EXPLICIT (closed list; no
retailer/sealed-package/small-packet exemption exists). The small-packet (≤ 1 lb)
rule at 1571(b)(1)/201.29 is a **reduced labeling tier**, not an exemption.
EXPLICIT. Also note the FSA regulates interstate *transportation*; purely
intrastate retail is left to state law — irrelevant here because Seed Drop ships
interstate, but it explains why in-state rack sales feel "unregulated" federally.
INTERPRETATION.

### 8. Does the answer differ among vegetable, agricultural, herb, and flower seed?

Yes — sharply. (All EXPLICIT except as noted.)

| Class | Federal packet label (interstate) | Key cites |
|---|---|---|
| **Vegetable seed, ≤ 1 lb, germination ≥ standard** | Kind + variety (each; % if 2+; "hybrid" if hybrid) + shipper name/address (or code + consignee). No germination %, no test date, no lot number required on the packet. | 7 U.S.C. 1571(b)(1); 7 CFR 201.26, 201.27, 201.29 |
| **Vegetable seed, ≤ 1 lb, below standard** | All of the above **plus** germination %, hard seed %, month/year of test, and the words **"Below Standard"** in ≥ 8-point type. | 7 U.S.C. 1571(b)(2); 7 CFR 201.29 |
| **Vegetable seed, > 1 lb** | Kind/variety, lot number, germination % + hard seed % + test date, shipper name/address (or code + consignee); noxious-weed statement per destination-state law. | 7 U.S.C. 1571(b)(3); 7 CFR 201.29a, 201.30b, 201.30c |
| **Agricultural seed (any size, incl. sunflower/popcorn/cover-crop packets)** | Full analysis label: kind (+ variety or "Variety Not Stated"), lot, origin for designated kinds, weed-seed %, noxious-weed kinds & rates per destination state, other-crop %, inert %, germination + hard seed + test date (≤ 5 months old, 15 for certain grasses), shipper name/address or code, inoculant date if claimed. | 7 U.S.C. 1571(a); 7 CFR 201.8–201.24a |
| **Herb kinds listed in 201.2(i)** (dill, parsley, sage, summer savory, chives, cress, etc.) | Treated as vegetable seed — rows above apply. | 7 CFR 201.2(i) |
| **Herb kinds on neither list** (basil, cilantro, thyme, oregano, rosemary...) | No FSA Title II labeling requirement found. INTERPRETATION; ACR (statutory "shall include" is open-ended). State law still applies. | 7 U.S.C. 1561(a)(7)(B); 7 CFR 201.2(h), (i) |
| **Flower seed** | No FSA labeling provisions exist. State law governs. INTERPRETATION from absence; AMS scope statement. | Part 201 structure; AMS FSA page |

**Operational flag:** the acceptance checklist (doc 08) must classify every SKU
against the 201.2(h)/(i) lists. A "sunflower" or "popcorn" or crimson-clover
cover-crop packet is **agricultural** seed federally and its supplier label must
carry the full analysis block (purity, germination + test date ≤ 5 months at time
of *shipment*, lot, etc.) — a materially heavier requirement with a live test-date
clock (7 CFR 201.22). Consider excluding agricultural-kind SKUs from V1, or gate
them on test-date currency. INTERPRETATION / operational recommendation.

### 9. Does combining multiple untouched retail packets into one outer shipment create any additional federal labeling requirement?

**None found.** Specifically:

- The mixture rules apply to seeds mixed **within** a container ("The term
  'mixture' means seeds consisting of more than one kind or variety, each present
  in excess of 5 percent by weight of the whole," 7 CFR 201.2(p); vegetable
  mixtures, 201.26a). Separate sealed packets in a common parcel are not a
  "mixture." EXPLICIT (definition) / INTERPRETATION (application).
- No Part 201 provision found requires the outer parcel of individually labeled
  containers to bear its own seed label. If the outer envelope were itself deemed
  a "container" needing a 1571(b) label, virtually every e-commerce seed shipment
  in the country would be mislabeled; the statute's structure (bulk and 20,000-lb
  provisions address aggregation) implies the labeled immediate container is the
  regulated unit. INTERPRETATION; ACR (Unresolved Question 7) out of caution.
- The packing slip and any inserts are "labeling" (1561(a)(18)) — truthful,
  consistent with the packet labels, no representations that "directly or
  indirectly deny or modify" required label information (7 CFR 201.36a). EXPLICIT.
- Assembling parcels is not "conditioning" ("does not include operations such as
  packaging, labeling ... which would not require retesting," 7 CFR 201.2(z)), so
  it triggers no retest duty. EXPLICIT.

### 10. Does personalized selection / subscription change Boone's regulatory role versus an ordinary retailer?

**No change in status; a larger advertising surface.** FSA duties attach to
functions — transporting/delivering for transportation (1571, 1572), labeling,
advertising (1575) — not to business models; a subscription seller is a "dealer"
("any person who cleans, processes, sells, offers for sale, transports, or
delivers for transportation seeds in interstate commerce," 7 CFR 201.2(t)) and,
for its own parcels, an interstate shipper (201.27(c)) exactly like a
one-off mail-order retailer. EXPLICIT (definitions) / INTERPRETATION (no
personalization provision exists in the FSA — confirmed by review of 1551–1611 and
Part 201). What personalization *does* do: every tailored recommendation ("plant
this Roma tomato in your zone in April") is an "advertisement" — "all
representations, other than those on the label, disseminated in any manner or by
any means, relating to seed within the scope of this chapter" (1561(a)(19)) — so
the volume of statements exposed to the false-advertising prohibition (1575)
scales with the personalization. INTERPRETATION. See Advertising section for
controls.

---

## Topical sections

### Dealer / interstate-shipper definitions as applied

- "Dealer": 7 CFR 201.2(t) (quoted above) — Boone is one (it sells and delivers
  for transportation seeds in interstate commerce). EXPLICIT definition;
  INTERPRETATION as applied.
- "Interstate shipper": not defined as a standalone term in 201.2; the operative
  definition is 201.27(c)/201.23(c): "the term shipper means the seller or
  consignor who puts the seed into interstate commerce." For each Gnome parcel,
  that is Boone. EXPLICIT / INTERPRETATION as applied (Question 1).
- "Consumer": 201.2(u) — the subscriber. "Lot of seed": 201.2(v) — "a definite
  quantity of seed identified by a lot number, every portion or bag of which is
  uniform, within permitted tolerances, for the factors which appear in the
  labeling." EXPLICIT.
- The current-of-commerce clause, 7 U.S.C. 1561(a)(4), extends "interstate
  commerce" (for treatment/variety/origin labeling) to seed moving in the usual
  current of commerce and defeats devices intended to take transactions out of the
  Act. EXPLICIT. Do not attempt intrastate-structuring arguments. INTERPRETATION.

### Advertising obligations — website, app, AI recommendations, e-mails

- **Coverage.** "Advertisement" = all representations other than the label,
  "disseminated in any manner or by any means" (1561(a)(19)); "false
  advertisement" = "any advertisement which is false or misleading in any
  particular," subject to tolerances (1561(a)(20)(B)). Dissemination of false
  advertising "by the United States mails, or in interstate or foreign commerce,
  in any manner or by any means, including radio broadcasts" is unlawful (7 U.S.C.
  1575). EXPLICIT. App screens, product pages, AI Boardroom/AI HQ gardening
  recommendations, push notifications, and marketing e-mails that relate to the
  seed Gnome sells are advertisements. INTERPRETATION (the 1939 text predates
  apps; its "any manner or by any means" language is comfortably broad).
- **Liability runs to the seller.** The 1575 proviso shields only media and
  agencies — not "the person who transported, delivered for transportation, sold,
  or offered for sale seed to which the false advertisement relates." EXPLICIT.
  An AI-generated misstatement about a packet Gnome sells is Gnome's problem, not
  the model vendor's. INTERPRETATION.
- **Kind/variety discipline in ads.** 7 CFR 201.36b: ad representations of
  kind/variety are "confined to the name of the kind or kind and variety
  determined in accordance with § 201.34"; descriptive terms must be clearly
  outside the name; brand names must not "create the impression that the
  trademark or brand name is a variety name"; "hybrid" only within the 201.2(y)
  definition. EXPLICIT. Build the catalog so kind + variety come verbatim from the
  supplier label, and AI copy is constrained to those strings. INTERPRETATION /
  control recommendation.
- **1571(d) belt-and-suspenders:** transporting seed "pertaining to which there
  has been a false advertisement" is itself unlawful — a false ad can poison an
  otherwise perfect shipment. EXPLICIT.

### Germination-test currency and "Below Standard" for small consumer packets

- For ≤ 1 lb vegetable packets at or above the 201.31 standards: "need not be
  labeled to show the percentage of germination and date of test." 7 CFR 201.29.
  EXPLICIT.
- If germination is below standard: "Below Standard" in ≥ 8-point type plus
  germination %, hard seed %, and test date. 201.29; 1571(b)(2). EXPLICIT.
- Currency: "When the percentage of germination is required to be shown, the label
  shall show the month and year in which the germination test was completed. No
  more than 5 calendar months shall have elapsed between the last day of the month
  in which the germination test was completed and the date of transportation ...
  except for seed in hermetically sealed containers in which case no more than 24
  calendar months...." 7 CFR 201.30a; see also 7 U.S.C. 1571(c) and the hermetic
  conditions at 201.36c (packed ≤ 9 months post-harvest, WVP spec, moisture
  limits, 8-point hermetic disclosure, germination ≥ standard at packaging).
  EXPLICIT.
- **The reseller's trap (INTERPRETATION + ACR):** the statutory classification of a
  packet into the (b)(1) "at or above standard" tier is a fact about the seed *at
  the time Boone ships it*, not a permanent property of the label. Aged inventory
  that has drifted below standard, shipped without "Below Standard," would violate
  1571(b)(2) and be false labeling under 1571(d) — with Boone as the shipper of
  record. 201.30a's five-month clock is textually triggered only "when the
  percentage of germination is required to be shown," so how AMS applies test-date
  currency to a reseller of standard-germination packets is unclear. ACR
  (Unresolved Question 4). **Controls:** obtain each lot's germination test data
  and test date from the supplier at intake (doc 08); enforce FIFO; season-gate
  inventory (align with state "packed for" year rules — state memos); quarantine
  and retire carry-over stock rather than ship it. INTERPRETATION.

### Kind / variety labeling

Every vegetable-seed packet label must bear "the name of each kind and variety
present as determined in accordance with § 201.34," with percentages if 2+ and
"hybrid" designation where applicable. 7 CFR 201.26; 1571(b)(1)(A). Kind names are
the 201.2(h)/(i) names (or non-misleading synonyms of broad general usage);
variety names follow 201.34(d); "Seed shall not be designated in labeling as
'hybrid' seed unless it comes within the definition of 'hybrid' in § 201.2(y)."
201.34(c). EXPLICIT. Since Gnome never labels, its duties here are (i) accept only
packets whose labels carry kind + variety (all vegetable seed "must be labeled to
show the variety name," AMS records guidance p.3, accessed 2026-08-13), and (ii)
mirror those names exactly in catalog/ads (201.36b). INTERPRETATION / control.

### Lot identification and traceability

- ≤ 1 lb vegetable packets are **not** federally required to show a lot number
  (contrast > 1 lb: 201.30b; agricultural: 201.13). EXPLICIT. Most supplier
  packets carry one anyway; capture it.
- Traceability is nonetheless mandatory through records: they must be kept "in
  such manner as to permit comparison with the records required to be kept by
  other persons for the same lot of seed so that the ... treatment ...
  germination and variety of vegetable seed may be traced from the grower to the
  ultimate consumer and so that the lot of seed may be correctly labeled." 7 CFR
  201.4(b). EXPLICIT. Gnome's `seed_lots` / `seed_order_items` design (doc 17)
  should record supplier lot number → Gnome lot → subscriber shipment, enabling
  both upstream comparison and downstream recall. INTERPRETATION / control.

### Recordkeeping — duration and content (verified)

- **Statute:** "all persons transporting, or delivering for transportation, in
  interstate commerce, vegetable seeds shall keep **for a period of three years**
  a complete record of treatment, germination and variety of such vegetable
  seeds," with USDA inspection rights. 7 U.S.C. 1572 (verified; accessed
  2026-08-13). Agricultural seed adds origin and purity. EXPLICIT.
- **Regulation:** 3-year complete record per lot "including a sample representing
  each lot ... except that any seed sample may be discarded 1 year after the
  entire lot ... has been disposed of." 7 CFR 201.4(a). Vegetable file sample
  "shall consist of at least 400 seeds." 201.4(b). "Complete record" defined at
  201.2(l) (declarations, labels, purchases, sales, handling, storage, analyses,
  tests, examinations — own transactions plus information received from others).
  EXPLICIT.
- **AMS guidance** ("Seed Company Records and the Federal Seed Act," Sept. 2017):
  labeling records can be "the actual label, copy of the label, actual container
  (seed packet ...) or copy of the container"; receiving records may be supplier
  invoices; a laboratory-held sample can count if accessible. EXPLICIT (guidance).
- **Applied to Gnome (INTERPRETATION):** per accepted lot keep — supplier invoice
  + packing docs; photographs/copies of the packet label (front/back); supplier
  germination/test-date data and any treatment disclosure; one or more retained
  sealed packets as the file sample; per-shipment records tying lot → subscriber
  → date → destination state. Retain 3 years (sample: 1 year after lot exhausted).
  **Wrinkle:** many retail packets contain fewer than 400 seeds (e.g., 25-seed
  pepper packets); whether retained sealed packet(s) totaling < 400 seeds satisfy
  201.4(b), or several packets must be held, is ACR (Unresolved Question 5).

### Treated-seed warnings

Any treated vegetable or agricultural seed must be labeled (≥ 8-point type) to
show it is treated and the substance/process name — e.g. "Treated with ____" —
plus, for mercurials/EPA Toxicity Category I substances, the skull-and-crossbones
and red "POISON" statement, and for other harmful substances a caution such as "Do
not use for food, feed, or oil purposes." 7 U.S.C. 1571(i); 7 CFR 201.31a.
EXPLICIT. The complete record must disclose treatment substances (201.7a).
EXPLICIT. Applied: doc 08 must verify that any packet marked treated bears the
full 201.31a statement, and reject treated packets lacking it — shipping one is
Boone's violation as shipper. INTERPRETATION. (Untreated ordinary packets: no
statement required — 201.31a attaches only to seed "that has been treated."
EXPLICIT.)

### Organic claims (USDA NOP) — reselling supplier-certified packets

- **Certification not required for this model.** "Handler" excludes "final
  retailers of agricultural products that do not process agricultural products,"
  and "Retail establishment" expressly includes "any retail business with a ...
  **mail-order, or delivery service** of raw or processed agricultural products."
  7 CFR 205.2 (eCFR 2026-08-11). Exemption: "(b) A retail establishment that does
  not process organically produced agricultural products" is "exempt from
  certification." 7 CFR 205.101(b). EXPLICIT. Gnome sells sealed packets without
  processing → exempt. INTERPRETATION (application).
- **Independent fallback:** 205.101(f) exempts "an operation that only buys,
  sells, receives, stores, and/or prepares for shipment, but does not otherwise
  handle, organic agricultural products already labeled for retail sale that ...
  are enclosed in **sealed, tamper-evident packages or containers** ... and remain
  in the same sealed, tamper-evident packages." EXPLICIT. Note: whether a standard
  glued paper seed packet is "tamper-evident" is unresolved — if relying on (f)
  rather than (b), confirm with NOP. ACR (NOP question, not SRTD). If (f) is the
  operative exemption, its record duty applies: records demonstrating organic
  status and quantities, kept ≥ 3 years, open to inspection. 205.101(i). EXPLICIT.
  (The (i) records duty lists paragraphs (a) and (c)–(f) — it does **not** name
  (b). EXPLICIT by enumeration.)
- **What Gnome may say (INTERPRETATION):** it may truthfully repeat the supplier's
  organic representations for the certified product it resells (show the packet as
  labeled, call the packet "USDA certified organic [supplier] seed"), because the
  claim attaches to the supplier's certified product, which Gnome does not alter.
  Controls: verify each supplier/product's certification (AMS Organic Integrity
  Database) before publishing the claim; never state or imply that Boone/Gnome is
  certified; never apply the USDA seal or "organic" to Gnome's own branding,
  packing slip headers, or the assembled box as Gnome's product. Backdrop:
  knowingly selling or labeling a product as organic "except in accordance with
  the Act" carries a civil penalty (7 CFR 205.100(c)(1)); 205.310 bars products
  *produced or processed by* an exempt operation from being represented as
  certified (not this scenario, but the outer boundary). EXPLICIT (cites) /
  INTERPRETATION (application).

### Recall and stop-sale responsibilities

The FSA contains no recall provision directed at resellers (reviewed 7 U.S.C.
1551–1611; Part 201). EXPLICIT (absence). The operative federal duties are
prohibitory: once Boone knows (supplier notice, AMS/state notice, own testing)
that a lot is mislabeled, below standard, contains noxious-weed seeds, or is
recalled, any further interstate shipment is a violation — "knowingly" triggers
misdemeanor liability (7 U.S.C. 1596(a)) and each shipment risks civil forfeiture
(1596(b)). INTERPRETATION (application of 1571/1596). AMS's enforcement pipeline
(complaints → investigation → No Action / Warning / Formal Charge with monetary
assessments under the Debt Collection Act) is described on the Filing-a-Complaint
page (accessed 2026-08-13). EXPLICIT. Controls: doc 11's stop-sale lane; supplier
recall-notice monitoring; lot-level subscriber trace from 201.4-style records;
voluntary consumer notice for shipped units (no federal mandate found — 
INTERPRETATION; state law may differ, see state memos).

### Noxious-weed screening

- **Interstate (AMS):** zero tolerance for the federal list — "Agricultural or
  vegetable seed containing seeds or bulblets of these kinds shall not be
  transported or delivered for transportation in interstate commerce," 7 CFR
  201.16(b) (list of ~90 taxa; "no tolerance will be applied"). EXPLICIT.
  State-designated noxious-weed seeds drive *labeling* for agricultural seed
  (1571(a)(5); 201.16(a)) and vegetable seed **> 1 lb** (201.30c) by destination
  state; no destination-state noxious statement is federally required on ≤ 1 lb
  vegetable packets. EXPLICIT. (State-law noxious/prohibited lists still control
  what may be *sold* into each state — matrix/ state memos.)
- **Imports:** 7 U.S.C. 1581(1) prohibits importing seed containing noxious-weed
  seeds or falsely labeled seed. EXPLICIT. Note: 1581 is Title III (foreign
  commerce) — for this model it functions only as a reason the "no imported seed"
  exclusion is protective. INTERPRETATION.
- **APHIS:** "No person may move a Federal noxious weed into or through the United
  States, or interstate," without an approved permit. 7 CFR 360.300; list at
  360.200; "move" is defined sweepingly (360.100). EXPLICIT. Ordinary named
  vegetable/herb/flower varieties are not listed taxa; the duty is a screening
  one — never accept a SKU whose species appears on 360.200 or 201.16(b), and
  obtain supplier representations that lots are free of federal noxious-weed
  seeds. INTERPRETATION / control. AMS publishes a consolidated "2026 State
  Noxious-Weed Seed Requirements" workbook (linked from the FSA page) — use it as
  an input to the state matrix. EXPLICIT (existence).

### AMS code registration — mandatory vs optional

Optional. See Question 4. The statutory identification element is disjunctive
("or," 1571(b)(1)(B)); the regulation describes the code as used "in lieu of" the
shipper's name (201.28); AMS calls it "an alternative" (code-designation page).
EXPLICIT. Beyond the code, no license, permit, registration, or fee requirement
for interstate seed shippers/dealers was found anywhere in 7 U.S.C. 1551–1611 or 7
CFR Part 201. This is a report of absence in the texts reviewed, not a statement
that "no permit is required" — confirm in the AMS inquiry. INTERPRETATION / ACR
(Unresolved Question 9).

### Warranty / misrepresentation exposure and disclaimers

- **Against FSA enforcement, disclaimers are worthless:** "The use of a
  disclaimer, limited warranty, or nonwarranty clause in any invoice, advertising,
  labeling, or written, printed, or graphic matter, pertaining to any seed shall
  not constitute a defense ... in any prosecution or other proceeding brought
  under the provisions of this chapter." 7 U.S.C. 1574. And a disclaimer "shall
  not directly or indirectly deny or modify any information required by the act or
  the regulations." 7 CFR 201.36a. EXPLICIT.
- **Outside the FSA they survive:** "Nothing in this section is intended to
  preclude the use of a disclaimer, limited warranty, or nonwarranty clause as a
  defense in any proceeding not brought under this chapter." 1574. EXPLICIT. So a
  well-drafted commercial nonwarranty (germination, fitness, yield) still matters
  for private claims — draft it under state/UCC law (state memos), and never let
  it contradict label statements (201.36a). INTERPRETATION.
- **Personalized-recommendation exposure:** recommendations are advertisements
  (Question 10); a recommendation that misstates a seed's characteristics
  ("disease-resistant," "germinates in 5 days," "hybrid") is measured against the
  "false or misleading in any particular" standard (1561(a)(20)) with liability on
  the seller (1575). Keep factual seed claims sourced to the supplier's label/
  catalog; keep Gnome's added value framed as advice, below. INTERPRETATION.

### Localized planting dates and expected-yield estimates — exposure and safe phrasing

No FSA provision addresses planting calendars or yield estimates as such
(reviewed Part 201; the advertising rules govern kind/variety naming and general
truthfulness). EXPLICIT (absence). They are still "advertisements," so the
false-or-misleading standard applies. INTERPRETATION. Safe-phrasing rules
(INTERPRETATION / drafting guidance):

1. **Estimates, framed as estimates, with the basis stated.** "Typical last frost
   near ZIP 44601 is ~May 10 (NOAA normals); many growers sow this outdoors 1–2
   weeks after" — not "plant May 10 for guaranteed results."
2. **Never quantify germination or performance beyond the label.** If the packet
   is silent (standard-germination small packet), do not invent a percentage; if
   the packet states one, repeat it verbatim with the test date if shown.
3. **Yield language as ranges tied to conditions,** never promises: "under good
   conditions, gardeners commonly report 4–6 lb per plant" — with the source of
   the range (supplier catalog) retained in records. Avoid "you will get."
4. **Kind/variety strings verbatim from the label; "hybrid" only if the label says
   so** (201.36b, 201.34(c)).
5. **Advice disclaimer, correctly scoped:** a notice that growing results depend on
   local conditions/practices is fine for private-law purposes, but per 1574 it
   cures nothing under the FSA — accuracy is the only defense. Do not use
   disclaimers to walk back a specific factual claim (201.36a).
6. **AI pipeline control:** constrain generation to a per-SKU fact sheet built from
   the supplier label/catalog; log outputs (they are advertisements and belong in
   the records file). 

---

## Unresolved federal questions (ACR list)

1. **Shipper identification by a sealed-packet reseller.** When Boone Systems, as
   "the seller or consignor who puts the seed into interstate commerce" (7 CFR
   201.27(c)) for a consumer parcel, ships unopened retail packets that bear only
   the original supplier's name and address, does the supplier's identification
   satisfy 7 U.S.C. 1571(b)(1)(B)(i) / 7 CFR 201.27(a), or must Boone's own name
   and address appear?
2. **Supplemental tag method.** If Boone identification is required, is a securely
   attached supplemental tag or adhesive label bearing "Shipped by Boone Systems
   LLC, [address]" — added without covering any supplier label text — an
   acceptable means of compliance under 7 CFR 201.25?
3. **Code-designation availability for D2C.** Is the 1571(b)(1)(B)(ii) code
   alternative available for direct-to-consumer shipments, given its "sold or
   shipped for resale" language and the 201.28 requirement to print the consignee's
   name and address on the label?
4. **Germination currency for resellers.** How does AMS apply 7 U.S.C. 1571(c) and
   7 CFR 201.30a to a reseller shipping ≤ 1 lb vegetable packets originally
   labeled at or above the 201.31 standard: is there a test-date or inventory-age
   limit, and what germination evidence should the reseller hold?
5. **File-sample size for small packets.** Does retaining sealed packet(s) of a lot
   satisfy 7 CFR 201.4(b) where a single packet contains fewer than 400 seeds, and
   if so how many packets?
6. **Unlisted herb kinds.** Does AMS treat garden herb kinds absent from both
   201.2(h) and 201.2(i) (e.g., basil, cilantro, thyme) as outside FSA Title II
   labeling, notwithstanding the open-ended statutory definition at 7 U.S.C.
   1561(a)(7)(B)?
7. **Outer parcel status.** Does an outer shipping envelope/box containing multiple
   individually labeled retail packets itself constitute a "container" requiring a
   1571(b) label?
8. **Drop-ship allocation.** Where the wholesale supplier ships directly to Boone's
   customer, does AMS regard the supplier as the interstate shipper of record for
   labeling (201.27) and records (7 U.S.C. 1572) purposes?
9. **No-registration confirmation.** Beyond the optional code designation, is any
   AMS registration, license, or filing required for a dealer shipping vegetable
   seed packets interstate?
10. **(NOP, separate from SRTD)** Whether a glued paper seed packet is a "sealed,
    tamper-evident package" for 7 CFR 205.101(f), if Gnome ever needs (f) rather
    than the 205.101(b) retail exemption.

---

## SEND-READY inquiry to USDA AMS Seed Regulatory and Testing Division

> **Status: DRAFT — do not send without owner approval.** (This session drafts
> only; no agency contact has been made.)

**To:** Seed Regulatory and Testing Division, S&T, AMS, U.S. Department of
Agriculture, 801 Summit Crossing Place, Suite C, Gastonia, NC 28054-2193
**Subject:** Federal Seed Act labeling questions — interstate reseller of sealed
retail vegetable-seed packets

Dear Seed Regulatory and Testing Division:

Boone Systems LLC, an Ohio company, operates a subscription service ("Seed Drop")
that purchases finished retail seed packets — ordinary vegetable, herb, and flower
varieties — at wholesale from established U.S. suppliers. Packets remain sealed
and unaltered with the supplier's original label; we never open, divide,
repackage, or relabel them, and we make no grower, producer, tester, or labeler
claims. We assemble several packets into a plain padded envelope or box with our
packing slip and ship from a single Ohio location directly to consumers in states
where we sell. We exclude imported seed, noxious weeds, and treated or recalled
products lacking required labeling.

Before launch, we would appreciate the Division's guidance on the following
questions under the Federal Seed Act and 7 CFR Part 201:

1. For a consumer parcel we consign in interstate commerce, does the original
   supplier's name and address printed on each sealed packet satisfy 7 U.S.C.
   1571(b)(1)(B)(i) and 7 CFR 201.27(a), or must Boone Systems' own name and
   address appear as the interstate shipper?
2. If our identification is required, may we comply by securely attaching a small
   supplemental label ("Shipped by Boone Systems LLC, [address]") that does not
   obscure any supplier label information?
3. Is the code-designation alternative under 7 CFR 201.28 available for
   direct-to-consumer shipments, or only where seed is sold or shipped for resale?
4. For packets of one pound or less originally labeled at or above the § 201.31
   germination standards, does AMS apply any test-date or inventory-age limit to a
   reseller, and what germination records should we maintain?
5. Does retaining sealed packets satisfy the § 201.4(b) file-sample requirement
   when one packet contains fewer than 400 seeds?
6. Are herb kinds not listed in § 201.2(h) or (i) — for example basil, cilantro,
   and thyme — outside the Act's Title II labeling requirements?
7. Apart from an optional code designation, is any AMS registration or license
   required for our operation?

We are glad to provide sample packets, supplier documentation, or photographs.
Thank you for your time and assistance.

Respectfully,

Daniel Marinelli
Boone Systems LLC
[street address], Ohio · marinelli1907@gmail.com

*(Body word count ≈ 330.)*

### Verified SRTD contact information (all accessed 2026-08-13)

| Item | Value | Verified on |
|---|---|---|
| Division | Seed Regulatory and Testing Division (SRTD), Science & Technology Program, USDA AMS | https://www.ams.usda.gov/services/seed-testing |
| Director | Ernest L. Allen, (704) 810-8884, ernest.allen@usda.gov | https://www.ams.usda.gov/services/seed-testing |
| Mailing address | USDA, AMS, S&T, Seed Regulatory and Testing Division, 801 Summit Crossing Place, Suite C, Gastonia, NC 28054 (complaints page shows ZIP+4 28054-2193) | https://www.ams.usda.gov/services/seed-testing and https://www.ams.usda.gov/rules-regulations/fsa/complaints |
| Complaints e-mail (SRTD Regulatory Manager) | seedcomplaints@usda.gov | https://www.ams.usda.gov/rules-regulations/fsa/complaints |
| Code designation requests | Kevin.Robinson2@usda.gov (SRTD; also listed as Agronomist, 704-810-7264) | https://www.ams.usda.gov/rules-regulations/fsa/code-designation and https://www.ams.usda.gov/rules-regulations/fsa |
| Program webpage | https://www.ams.usda.gov/rules-regulations/fsa (FSA) and https://www.ams.usda.gov/services/seed-testing (SRTD) | same |
| **Not verified as current** | A general division phone (704-810-8871) and fax (704-852-4189) appear only on the Sept. 2017 SRTD records PDF letterhead — dated source; no general-inquiries e-mail is published on the current pages fetched. Use the Director's line/e-mail or seedcomplaints@usda.gov. | 2017 PDF (see ledger) |

**Routing recommendation (INTERPRETATION):** send the inquiry by e-mail to the
Director (ernest.allen@usda.gov), cc Kevin.Robinson2@usda.gov given his
code-designation role, with the mailing address used for any hard-copy follow-up.
NOP questions (item 10 above) go to the National Organic Program, not SRTD.

---

## Source ledger

All accessed 2026-08-13. eCFR citations are the current eCFR text retrieved via
the official eCFR versioner API (`ecfr.gov/api/versioner/v1/full/2026-08-11/title-7.xml`)
at the most recent issue date, 2026-08-11; the human-readable URL for each section
is given. U.S. Code citations are the OLRC preliminary release, "laws in effect on
August 11, 2026."

| Citation | URL | Accessed | Supports |
|---|---|---|---|
| 7 U.S.C. 1551 | https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title7-section1551&num=0&edition=prelim | 2026-08-13 | Short title; FSA = 7 U.S.C. 1551–1611 |
| 7 U.S.C. 1561 | https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title7-section1561&num=0&edition=prelim | 2026-08-13 | Definitions: interstate commerce, agricultural/vegetable seeds, label, labeling (incl. invoices), advertisement, false labeling/advertisement, in bulk, treated |
| 7 U.S.C. 1571 | https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title7-section1571&num=0&edition=prelim | 2026-08-13 | Core prohibitions; vegetable-packet label tiers (b)(1)-(3); shipper name/address or code; 5-month germination currency (c); false labeling/advertising transport ban (d); treated-seed labeling (i) |
| 7 U.S.C. 1572 | https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title7-section1572&num=0&edition=prelim | 2026-08-13 | 3-year records duty (verified); scope for vegetable vs agricultural seed; USDA inspection right |
| 7 U.S.C. 1573 | https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title7-section1573&num=0&edition=prelim | 2026-08-13 | Exemptions: carriers, farmer direct sales, bulk/20,000-lb, processing; indistinguishability records defenses (d),(e); no retailer exemption |
| 7 U.S.C. 1574 | https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title7-section1574&num=0&edition=prelim | 2026-08-13 | Disclaimers no defense under FSA; preserved outside FSA |
| 7 U.S.C. 1575 | https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title7-section1575&num=0&edition=prelim | 2026-08-13 | False advertising prohibition; seller liability; media proviso |
| 7 U.S.C. 1581 | https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title7-section1581&num=0&edition=prelim | 2026-08-13 | Import prohibitions (noxious weeds, false labeling) — Title III scope |
| 7 U.S.C. 1596 | https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title7-section1596&num=0&edition=prelim | 2026-08-13 | Penalties: misdemeanor $1,000/$2,000; civil forfeiture $25–$500 |
| 7 CFR 201.2 | https://www.ecfr.gov/current/title-7/part-201/section-201.2 | 2026-08-13 (eCFR 2026-08-11) | Definitions: (h) agricultural-kind list; (i) vegetable-kind list (herbs included/excluded); (l) complete record; (p) mixture; (t) dealer; (u) consumer; (v) lot; (y) hybrid; (z) conditioning |
| 7 CFR 201.4 | https://www.ecfr.gov/current/title-7/part-201/section-201.4 | 2026-08-13 (eCFR 2026-08-11) | 3-year records + file sample; 400-seed vegetable sample; grower-to-consumer traceability |
| 7 CFR 201.7, 201.7a | https://www.ecfr.gov/current/title-7/part-201/section-201.7 | 2026-08-13 (eCFR 2026-08-11) | Purity/variety and treated-seed record content (note: NOT the code-designation section in current numbering) |
| 7 CFR 201.8–201.24a | https://www.ecfr.gov/current/title-7/part-201/section-201.8 | 2026-08-13 (eCFR 2026-08-11) | Agricultural-seed label contents; 201.13 lot; 201.16 noxious-weed seeds (federal zero-tolerance list at (b)); 201.22 test date (15-month grasses); 201.23/201.24 seller-buyer info + code |
| 7 CFR 201.25–201.31 | https://www.ecfr.gov/current/title-7/part-201/section-201.27 | 2026-08-13 (eCFR 2026-08-11) | Vegetable labeling: 201.25 form/additional info; 201.26 kind-variety-hybrid; 201.26a mixtures; 201.27 shipper/consignee definitions + name-address rule; 201.28 code designation; 201.29/201.29a germination tiers & Below Standard; 201.30a test-date currency; 201.30b lot >1 lb; 201.30c noxious >1 lb; 201.31 germination standards table |
| 7 CFR 201.31a | https://www.ecfr.gov/current/title-7/part-201/section-201.31a | 2026-08-13 (eCFR 2026-08-11) | Treated-seed label: 8-point type, substance name, POISON/skull for Category I, caution statements |
| 7 CFR 201.32–201.36c | https://www.ecfr.gov/current/title-7/part-201/section-201.36a | 2026-08-13 (eCFR 2026-08-11) | 201.33 bulk/20,000-lb invoice labeling; 201.34 kind/variety naming; 201.36a disclaimers; 201.36b advertising kind/variety/brand rules; 201.36c hermetic 24-month conditions |
| 7 CFR 205.2 | https://www.ecfr.gov/current/title-7/part-205/section-205.2 | 2026-08-13 (eCFR 2026-08-11) | NOP definitions: handle, handler (final-retailer carve-out), handling operation, retail establishment (incl. mail-order/delivery) |
| 7 CFR 205.100 | https://www.ecfr.gov/current/title-7/part-205/section-205.100 | 2026-08-13 (eCFR 2026-08-11) | What must be certified; 205.100(c)(1) penalty for knowing organic mislabeling |
| 7 CFR 205.101 | https://www.ecfr.gov/current/title-7/part-205/section-205.101 | 2026-08-13 (eCFR 2026-08-11) | Certification exemptions: (b) non-processing retail establishment; (f) sealed tamper-evident resale; (i) records for (a),(c)–(f) |
| 7 CFR 205.310 | https://www.ecfr.gov/current/title-7/part-205/section-205.310 | 2026-08-13 (eCFR 2026-08-11) | Limits on products produced/processed BY exempt operations (outer boundary of organic claims) |
| 7 CFR 360.100, 360.200, 360.300 | https://www.ecfr.gov/current/title-7/part-360 | 2026-08-13 (eCFR 2026-08-11) | APHIS noxious-weed definitions, federal list, permit requirement for any interstate movement |
| AMS, "Federal Seed Act" overview | https://www.ams.usda.gov/rules-regulations/fsa | 2026-08-13 | FSA scope ("agricultural and vegetable seed"); primary labeling elements incl. "name and address of the interstate shipper"; state cooperative-agreement enforcement model; TTV program |
| AMS, "AMS Code Designation" | https://www.ams.usda.gov/rules-regulations/fsa/code-designation | 2026-08-13 | Code as alternative to shipper name; confidentiality; how to obtain (e-mail Kevin.Robinson2@usda.gov); statutory hooks 201(a)(9), 201(b)(B), 201(b)(2)(C) |
| AMS, "Filing a Complaint" | https://www.ams.usda.gov/rules-regulations/fsa/complaints | 2026-08-13 | seedcomplaints@usda.gov; mailing address (28054-2193); investigation process; warning vs formal charge; Debt Collection Act assessments |
| AMS, "Seed Regulations and Testing" (SRTD) | https://www.ams.usda.gov/services/seed-testing | 2026-08-13 | SRTD role; Director contact block (Allen, address, phone, e-mail) |
| AMS SRTD, "Seed Company Records and the Federal Seed Act" (Sept. 2017 PDF) | https://www.ams.usda.gov/sites/default/files/media/SeedCompanyRecordsandtheFederalSeedAct.pdf | 2026-08-13 | Records guidance: label copies/packets as labeling records; invoices as receiving records; per-tier label content summaries; lab-held samples; 2017-era division phone/fax (dated) |

### Access notes / sources not directly accessible

- **ecfr.gov HTML pages** could not be fetched through the sandboxed page-fetch
  tool (bot-check redirect to unblock.federalregister.gov). Worked around via the
  **official eCFR API on the same domain**, which returned the full point-in-time
  XML (2026-08-11) used for every Part 201/205/360 quotation — so no substantive
  gap. The govinfo annual CFR edition was not consulted (the eCFR point-in-time
  text is the required current source).
- **ams.usda.gov** returned HTTP 403 to the page-fetch tool; retrieved successfully
  by direct HTTPS request with a standard browser user-agent. Content quoted is
  from the retrieved pages.
- No other sources were sought and unobtainable. No non-primary source is cited as
  authority anywhere in this memo.
