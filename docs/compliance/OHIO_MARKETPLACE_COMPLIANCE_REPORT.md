# Ohio Marketplace Compliance Report — Gnome Farmers Market

**Version:** 1.0 (draft) · **Jurisdiction:** Ohio (US-OH) · **Last compiled:** 2026-08-10

## Disclaimer — read first

Gnome Farmers Market is a **private, hyperlocal marketplace platform**. Gnome is
**not** a government licensing agency, is not affiliated with the Ohio Department
of Agriculture (ODA), the Ohio Department of Natural Resources (ODNR), Ohio EPA,
the Ohio Department of Taxation, the USDA, the FDA, or any other regulator, and
**issues no licenses, permits, certifications, or approvals of any kind.**

This document is **compliance research, not legal advice.** It is a good-faith
summary of statutes and agency guidance assembled to drive Gnome's internal
listing-gate logic. It does not create an attorney–client relationship, may be
incomplete or out of date, and must not be relied on by any seller as a
determination of what they may lawfully sell. Sellers are solely responsible for
their own legal compliance. Statutory citations, quarantine county lists, fee
schedules, and agency positions **change**; every item flagged
**“LEGAL/AGENCY REVIEW REQUIRED”** must be confirmed with counsel or the relevant
Ohio agency before Gnome relies on it in production. Where the underlying research
could not resolve a question from an authoritative source, that uncertainty is
**preserved here and NOT resolved by guessing.**

Primary agencies referenced: **ODA Division of Food Safety** (cottage food, home
bakery, eggs, honey/maple/sorghum/apple exemptions, farm-market registration);
**ODA Division of Plant Health** (nursery stock, seed labeling, fertilizer,
firewood/pest quarantine, commercial feed); **ODA Division of Meat Inspection
(DMI)**; **ODNR Division of Wildlife** (live bait, native wildlife, bait-dealer
permits); **ODNR Division of Natural Areas & Preserves (DNAP)** (endangered/
threatened native plants); **Ohio EPA** (composting facilities); **local health
districts** (retail food establishment licensing); **USDA/FSIS/APHIS** and **FDA**
federally.

## How to read each entry

Each product node lists: **Ohio classification** · **Credential required** ·
**Regulator** · **Credential name** · **Seller restrictions** · **Labeling** ·
**Sales-channel restrictions** · **Shipping restrictions** · **Exemptions** ·
**Official sources** · **Gnome enforcement recommendation** · **Paid-plan
requirement** · **Required listing fields** · **Open questions**.

Classification vocabulary (5 states used throughout and in the summary matrix):
`GENERALLY_UNRESTRICTED` · `CONDITIONAL` · `REGULATED` · `REVIEW_REQUIRED` ·
`PROHIBITED`. A separate **enforcement mechanism** — attestation, credential
upload, paid plan, local-pickup-only, Ohio-only, or hard block — is noted per
node; classification and mechanism are independent axes.

---

# CLUSTER 1 — Fresh produce, fruit, fresh herbs, seeds, plants

### 1.1 Fresh vegetables (whole, uncut, unprocessed)
- **Ohio classification:** GENERALLY_UNRESTRICTED
- **Credential required:** No (market-level farm/farmers-market ODA registration is free, not a per-seller credential)
- **Regulator:** ODA Division of Food Safety
- **Credential name:** None to sell
- **Seller restrictions:** Product must be whole and unprocessed; cutting/peeling/value-adding exits this node
- **Labeling:** None mandated for whole raw produce; organic claims >$5,000/yr trigger USDA NOP certification
- **Sales-channel:** Farmers market / roadside / farm / direct all exempt from RFE license (ORC 3717.22(B)(2)(a),(B)(3),(B)(16))
- **Shipping:** No Ohio-specific ban for in-state
- **Exemptions:** The produce itself is the exemption (ORC 3717.22)
- **Official sources:** ORC 3717.22 (codes.ohio.gov/ohio-revised-code/section-3717.22); ODA Farm Markets program
- **Gnome recommendation:** Allow all users; attestation "whole, uncut, unprocessed; grown lawfully"; no upload
- **Paid-plan requirement:** No
- **Required listing fields:** product type, variety (optional), whole/uncut = yes, grown-by attestation
- **Open questions:** None material. Cut/value-added produce is a *different* node.

### 1.2 Fresh fruit (whole, unprocessed)
- Identical treatment to 1.1. **GENERALLY_UNRESTRICTED**, no credential, attestation only, no paid plan.
- **Caveat:** juice/cider leaves this node — on-site farm-market cider has a narrow exemption (3717.22(B)(16)); bottled juice needs a license + juice-HACCP. Keep juice out of this node.
- **Required listing fields:** product type, variety, whole/uncut attestation.

### 1.3 Fresh herbs (culinary, cut/bunched, unprocessed)
- **GENERALLY_UNRESTRICTED**; treated as fresh produce under ORC 3717.22.
- **Regulator:** ODA Food Safety. **Credential:** none.
- **Gnome recommendation:** Allow all; attestation "fresh, unprocessed; not an infused oil or dried product."
- **Paid-plan:** No. **Fields:** herb type, fresh/unprocessed attestation.
- **Open questions:** A *potted living* herb intended for planting is nursery stock (§1.7), not this node. Let seller pick "for eating (fresh herb)" vs "living plant/start" and route accordingly.

### 1.4 Dried herbs / dry herb & seasoning blends / dry tea blends
- **Ohio classification:** CONDITIONAL (permitted as **Cottage Food**)
- **Credential required:** No license/registration/fee — must operate as a Cottage Food Production Operation (CFPO) and comply with cottage-food labeling
- **Regulator:** ODA Division of Food Safety
- **Credential name:** None (CFPO status requires no license/registration/inspection/fee, no sales cap)
- **Seller restrictions:** Home-produced; on ODA's allowed cottage-food list; correctly labeled
- **Labeling (required):** product name; CFPO name + address; ingredients descending by weight; net weight/volume; major-allergen declaration; **"This product is home produced"** (OAC 901:3-20; ORC 3715.023)
- **Sales-channel:** Direct + Ohio retail allowed; **interstate not authorized**
- **Shipping:** **In-Ohio pickup/ship only**
- **Exemptions:** This node is the cottage-food exemption (ORC 3717.22(B)(6),(B)(2)(b))
- **Official sources:** ORC 3717.22; ORC 3715.023; OAC 901:3-20-04; ODA Cottage Food fact sheet; OSU Ag Law "Ohio's Cottage Food Law"
- **Gnome recommendation:** Allow; require cottage-food labeling attestation + Ohio-only fulfillment; gate free-text name against allowed list / require seller to confirm the item is a permitted cottage food; no upload
- **Paid-plan requirement:** No (business decision only)
- **Required listing fields:** ingredient list, net weight, allergen declaration, producer name + Ohio address, "home produced" confirmation, Ohio-only fulfillment flag
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** on the exact mandatory label string / any 2025–26 OAC 901:3-20 amendments (ODA fact-sheet URL 404'd during research).

### 1.5 Seeds — vegetable, herb, flower seed (packaged for sale)
- **Ohio classification:** REGULATED / CONDITIONAL (Ohio Agricultural Seed law, ORC Ch. 907)
- **Credential required:** Effectively YES for anyone who **labels** seed for sale — **Seed Labeler's Permit** + compliant analysis label
- **Regulator:** ODA (Grain Warehouse, Feed & Seed / Plant Health — Seed program)
- **Credential name:** Seed Labeler's Permit (ODA form PLNT-4203-008)
- **Seller restrictions:** The person who labels seed is the regulated party. Reselling factory-sealed packets relies on that labeler's permit; packaging one's own seed makes the seller a labeler needing the permit + compliant label
- **Labeling (ORC 907.03, ≤8 oz):** kind + variety; lot number; germination % + hard-seed %; year packed/sale year; **labeler name + address**; treated-seed disclosure
- **Sales-channel:** No channel barred, but all require compliant labeling + (for labeler) permit
- **Shipping:** In-Ohio governed by Ohio seed law; interstate adds Federal Seed Act + USDA/APHIS; **noxious/prohibited-weed-seed species may not be sold**
- **Exemptions:** Very limited; **no small-seller exemption** from label + permit found
- **Official sources:** ORC 907.03; ORC 907.07; ODA Seed Labeler's Permit form + Seed Labeler search; Ohio noxious-weed list
- **Gnome recommendation:** Credential-or-attestation gated. Minimum: attest packet carries ORC 907.03 fields AND holds a Seed Labeler's Permit or is reselling permitted-labeler seed. Best practice: **require permit upload for self-packaged seed.** Block any prohibited noxious-weed species
- **Paid-plan requirement:** Reasonable to gate paid given credential/label burden — not legally required
- **Required listing fields:** kind/variety, germination % + test month/year, lot number, labeler name + address, treated-seed disclosure, noxious-weed confirmation, Seed Labeler Permit # (if self-labeled)
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — ODA enforcement threshold against small/occasional home seed-savers, and the exact current permit fee (ODA form page did not render).

### 1.6 Native / pollinator / wildflower seed
- **Ohio classification:** CONDITIONAL for cultivated/commercial seed; **REVIEW_REQUIRED / potentially PROHIBITED** for wild-collected state-listed species
- **Credential required:** CONDITIONAL (seed-labeler permit per §1.5) plus ODNR DNAP permission if wild-collected listed species
- **Regulator:** ODA (seed labeling); **ODNR DNAP** for endangered/threatened native plants (ORC Ch. 1518)
- **Seller restrictions:** Commercially propagated seed with compliant labels ≈ flower seed; **wild-collected seed/plants of state-listed endangered/threatened species for commercial sale are restricted** (ORC 1518.03, DNAP rules)
- **Labeling/channel/shipping:** Per §1.5; wild-collected listed-species material effectively local/permitted only
- **Official sources:** ORC 1518.03; ODNR DNAP collecting-permit page; seed law per §1.5
- **Gnome recommendation:** §1.5 attestation PLUS attest seed is nursery/commercially propagated and **not wild-collected from a state-listed species**; block "wild-collected" native seed of protected species
- **Paid-plan:** Same as §1.5. **Fields:** §1.5 fields + "commercially propagated, not wild-collected" attestation + scientific name (to screen against listed species)
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — pull the current ODNR DNAP rare-plant list rather than hard-code; build the screened-species list.

### 1.7 Nursery stock / live plants / vegetable & herb starts / trees & shrubs
- **Ohio classification:** REGULATED (ORC Ch. 927); **REVIEW_REQUIRED** specifically for annual vegetable/herb starts
- **Credential required:** YES for true nursery stock (no small-seller/hobbyist exemption in statute)
- **Regulator:** ODA Division of Plant Health
- **Credential name:** **Certificate of Nursery Inspection** (grower; inspection fee $100 + $11/acre for brambles/herbaceous/perennial per ORC 927.53) **or** **Dealer in Nursery Stock license** ($125/yr per place of business; annual affidavit) **or** Collector license (wild-dug)
- **Definition (ORC 927.51):** nursery stock = "any hardy tree, shrub, plant, or bulb, whether wild or cultivated, except turfgrass, and any cutting, graft, scion, or bud thereof"
- **Seller restrictions:** Anyone selling/offering/distributing nursery stock must be licensed/certified; **no minimum-quantity or casual-seller exemption** (ORC 927.53)
- **Labeling:** Stock from inspected/certified sources; provenance/certification is the compliance artifact
- **Sales-channel:** All channels — farmers market does not exempt live-plant sales
- **Shipping:** Out-of-Ohio requires inspection/certification + often a phytosanitary certificate + destination-state rules → **local pickup / in-Ohio default**
- **Exemptions:** Listed native plants sellable by licensed nurseries/dealers only when commercially grown/legally imported (not wild-dug; ties to ORC 1518 / DNAP)
- **Official sources:** ORC 927.51, 927.53, 927.52, 927.69; ODA Nurseries & Dealers program + Dealer License page
- **Gnome recommendation:** **Require credential upload** (nursery certificate OR dealer license #) to list woody/hardy plants; **block free/unverified users**; local-pickup / in-Ohio default; block interstate unless phytosanitary attestation. For wild-dug/native add §1.6 attestation
- **Paid-plan requirement:** **Yes — recommended** (licensed inspected commercial activity)
- **Required listing fields:** plant type + species, woody/hardy vs annual, ODA nursery certificate or dealer license #, source (self-grown/resold/wild-collected), phytosanitary/interstate attestation, local-pickup flag
- **Open questions (preserve all):**
  1. **Annual vegetable/herb starts/transplants** — ORC 927.51 says "hardy"; annuals are arguably not hardy and many states exempt them, but Ohio's statute is not explicit and ODA has historically inspected greenhouse vegetable-transplant growers. **Classification = REVIEW_REQUIRED; LEGAL/AGENCY REVIEW REQUIRED.** Interim: treat starts as CONDITIONAL — attestation + ODA-contact prompt, do not freely allow.
  2. Exact current fee schedule / reduced small-grower tier (ODA HTML pages 404'd).
  3. Whether hobbyist houseplants/indoor tropicals are enforced as nursery stock (statutorily covered; threshold unclear).

---

# CLUSTER 2 — Cottage foods (baked goods, jams, dry mixes, candy, granola, coffee, tea)

**Framework:** ORC 3715.01(A) (CFPO definition, non-PHF); OAC 901:3-20-04 (20 allowed categories); ORC 3715.023 (labeling); Home Bakery License (ORC Ch. 3711 / OAC 901:3-2) for PHF baked goods. **A CFPO needs NO license/registration/permit/fee/inspection.** Cottage-food label (every package): business name + address; product name; ingredients descending by weight; net weight + volume (US + metric); **"This product is home produced"** in ≥10-pt type. **Cottage food is intrastate only — interstate shipping is NOT covered** (treat as prohibited pending review). No item here legally requires a paid Gnome plan.

### 2.1 Non-PHF baked goods (bread, cookies, brownies, cakes, cupcakes, muffins, fruit pies, unfilled baked donuts, pizzelles, waffle cones)
- **GENERALLY_UNRESTRICTED** (cottage food) · **Credential:** No · **Regulator:** ODA Food Safety
- **Seller restrictions:** home-produced, non-PHF. Fruit pies OK; cream/custard/meringue/cheese/pumpkin pies are NOT (see §2.6). Buttercream generally OK; cream-cheese-frosting / whipped-cream fillings are a gray area
- **Labeling:** full ORC 3715.023 · **Channel:** direct statewide + licensed retail · **Shipping:** intrastate only, local pickup safest
- **Sources:** OAC 901:3-20-04; ORC 3715.01, 3715.023; ODA CFPO fact sheet; OSU Ag Law
- **Gnome recommendation:** Free tier + cottage-food attestation checkbox + hard Ohio-only shipping flag; no upload
- **Paid-plan:** No · **Fields:** ingredient list, allergen declaration, "home produced" ack, net weight, pickup/delivery method, Ohio-only shipping toggle
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** for cream-cheese-frosted / whipped-topping cakes (water-activity/pH fact-specific).

### 2.2 Muffins & cupcakes
- Same as §2.1 — **GENERALLY_UNRESTRICTED**, cottage attestation. Cream-filled → §2.6.

### 2.3 Pastries & donuts
- **Ohio classification:** CONDITIONAL (split node)
- Unfilled baked donuts = cottage food. **Fried donuts, cream/custard-filled donuts, filled pastries (éclairs, cream horns) are PHF → require Home Bakery License** or licensed kitchen
- **Gnome recommendation:** Split taxonomy: "Unfilled baked" → cottage attestation, free tier; "Filled/cream/custard" → **credential required (Home Bakery License) + local-pickup-only**
- **Paid-plan:** No · **Fields:** fill type (none/fruit/cream-custard); Home Bakery License # if filled; refrigeration/pickup method
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — fried-but-shelf-stable cake donut PHF status.

### 2.4 Granola & granola bars
- **GENERALLY_UNRESTRICTED** (cottage; OAC limits to **commercially dried fruit** only)
- **Gnome recommendation:** Free + attestation incl. "dried fruit is commercially dried" · **Paid-plan:** No
- **Fields:** ingredient list, "commercially dried fruit" checkbox, allergen (nuts) · **Open questions:** none significant.

### 2.5 Candy / confections (brittle, chocolate-covered pretzels/nuts, caramels, fudge-type, popcorn confections)
- **GENERALLY_UNRESTRICTED with carve-out** — cottage food **"excluding fresh fruit dipped or covered with candy"** (candy/caramel apples, chocolate-dipped fresh strawberries = PHF, NOT cottage). Popcorn confections OK excluding raw popping corn
- **Gnome recommendation:** Free + attestation; block fresh-fruit-dipped confections (those are `REGULATED` / Home Bakery)
- **Paid-plan:** No · **Fields:** ingredient list, allergen declaration, "no fresh fruit dipped in candy" attestation
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — water-activity status of soft fudge / fresh-cream caramels.

### 2.6 PHF baked goods (cream/custard/pumpkin pies, cheesecakes, meringue, cream/custard-filled pastries & cakes)
- **Ohio classification:** REGULATED · **Credential:** YES
- **Credential name:** **Home Bakery License** ($10/yr; one-time home-kitchen inspection) or licensed commercial facility
- **Seller restrictions:** TCS foods; cannot use cottage exemption · **Labeling:** standard commercial (follow ODA guidance) · **Channel:** direct + licensed retail, refrigerated · **Shipping:** **local pickup / refrigerated delivery only**, no interstate
- **Sources:** OSU Ag Law "Ohio's Home Bakery License"; ODA Food Safety Home Bakery program (ORC Ch. 3711)
- **Gnome recommendation:** **Require Home Bakery License # + local-pickup-only; block free-tier without credential**
- **Paid-plan:** Not legally required · **Fields:** Home Bakery License #, issuing county/ODA, refrigeration/pickup-only, allergen declaration
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — exact ODA labeling spec for licensed home bakeries; no confirmed public ODA license-verification API (treat numbers as attestation-grade).

### 2.7 Roasted coffee (whole bean / ground)
- **GENERALLY_UNRESTRICTED** (cottage; OAC 901:3-20-04). Brewed/RTD/cold-brew = NOT cottage (separate PHF/RFE node)
- **Gnome recommendation:** Free + attestation; scope node to roasted beans/grounds only · **Paid-plan:** No
- **Fields:** roast/grind, net weight, ingredient/allergen (if flavored) · **Open questions:** flavored coffees with dairy/creamer change PHF status — restrict to dry roasted product.

**Cluster-2 cross-cutting open items — LEGAL/AGENCY REVIEW REQUIRED:** FALCPA Big-9 allergen obligation for CFPOs; precise legal basis limiting interstate cottage-food shipment; edge-PHF items (cream-cheese/whipped cakes, soft fudge, fried cake donuts, vegetable-heavy "chutneys"); herbal-tea/herb-blend wellness claims (FDA supplement/drug); Home Bakery license-verification mechanism.

---

# CLUSTER 3 — Eggs, honey, maple/other syrups

**Framework:** ORC 3715.021 packs most of this cluster into small-producer exemptions (≤500-bird eggs; beekeeper ≥75% own hives; maple/sorghum/apple processors ≥75% own source). ODA fact sheets don't squarely address mail-order — **local-pickup default** for home/farm-exempt products until ODA confirms. (Note: ODA honey fact sheet's stray "3717.021" is a typo; operative cite is **3715.021**.)

### 3.1 Chicken eggs (small flock ≤500 birds)
- **Ohio classification:** CONDITIONAL (unrestricted on-farm; registered off-farm)
- **Credential required:** CONDITIONAL — No for on-farm/own-farm-market/farm-auction; YES (ODA Small Egg Processor Certificate of Registration + local health-dept farmers-market license) for retail/restaurant/registered-market sale
- **Regulator:** ODA Food Safety; local health department
- **Seller restrictions:** ≤500 birds annually; >500 → full egg grading regulation
- **Labeling (6 elements):** name + address; quantity by count; pack date; **"ungraded"/"unclassified"**; **"mixed size"**; safe-handling statement. Reused cartons: deface prior non-pertinent info
- **Refrigeration:** ≤45°F ambient
- **Channel:** on-farm/own market/auction = no inspection; retail/restaurant/registered market = registration + inspection + local license
- **Shipping:** temperature-sensitive; **recommend local-pickup-only**
- **Exemptions:** ≤500-bird small egg operation (ORC 3715.021; OAC 901:3-6)
- **Sources:** ODA Small Egg Production fact sheet; ORC 3715.021; OAC 901:3-6
- **Gnome recommendation:** Attestation (≤500 birds; ≤45°F; 6-element carton label). If off-farm/market fulfillment → **require ODA registration cert upload**. Default local pickup; block shipping unless credential + cold-chain attestation
- **Paid-plan:** No hard legal reason; credential-upload for off-farm could be a paid feature
- **Fields:** flock size ≤500, refrigeration attestation, pack date, "ungraded/unclassified" + "mixed size" ack, safe-handling ack, fulfillment method, ODA registration cert (conditional upload)
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** if enabling shipping (cold-chain); local farmers-market license fee varies by county.

### 3.2 Duck / quail / turkey / goose eggs
- **Ohio classification:** REVIEW_REQUIRED (leaning CONDITIONAL, same as chicken)
- ORC 3715.021 speaks of "birds"/"egg production" (not "chickens"), strongly suggesting coverage, **but** USDA grade/size labeling conventions are chicken-specific
- **Gnome recommendation:** Treat like chicken eggs (attestation + conditional credential) but flag internally REVIEW_REQUIRED; require species named; default local-pickup-only
- **Paid-plan:** same as chicken · **Fields:** species + §3.1 fields
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — confirm with ODA that small-egg exemption + labeling apply identically to non-chicken species and how grade/size labeling reads.

### 3.3 Raw / liquid honey (beekeeper ≥75% own hives)
- **GENERALLY_UNRESTRICTED** · **Credential:** No if ≥75% own hives (else food-processor registration)
- **Regulator:** ODA Food Safety
- **Labeling:** statement of identity ("Honey"/floral source); net quantity (oz on-site; **oz + grams off-site**, bottom 30% of PDP); no ingredient list (single-ingredient); business name + address. Nutrient/health claims trigger Nutrition Facts; antibiotics = adulterated
- **Channel:** broad incl. retail; off-site requires dual oz+g · **Shipping:** shelf-stable; intra-Ohio focus
- **Exemptions:** small honey processor (ORC 3715.021)
- **Sources:** ODA Honey fact sheet (Nov 2021); ORC 3715.021; ORC 3715.023; FDA honey labeling
- **Gnome recommendation:** Attestation (≥75% own hives; off-site net-weight); intra-Ohio shipping OK; validate dual net-weight
- **Paid-plan:** No · **Fields:** ≥75%-own-hives attestation, statement of identity, net weight (oz; oz+g if off-site/shipped), business name + address, no-medical-claims ack
- **Open questions:** none material.

### 3.4 Creamed honey & comb honey
- **GENERALLY_UNRESTRICTED** — same beekeeper exemption; single-ingredient. Attestation, no upload, no paid plan.
- **Fields:** §3.3 + form (raw/creamed/comb). **Open questions:** none significant.

### 3.5 Flavored / infused honey
- **Ohio classification:** CONDITIONAL (reclassified as **cottage food**)
- **Credential:** No license, but comply with cottage-food rules (OAC 901:3-20); underlying beekeeper must be 3715.021(A)-exempt
- **Labeling:** cottage-food label incl. ingredient list (now multi-ingredient) + **"This product is home produced"**
- **Channel/shipping:** **Ohio-only** (block out-of-state)
- **Sources:** ODA Honey fact sheet; ORC 3715.023; OAC 901:3-20-04
- **Gnome recommendation:** Attestation (3715.021-exempt beekeeper + full cottage-food label); **hard-restrict to in-Ohio / local pickup**; ingredient-list field
- **Paid-plan:** No · **Fields:** ingredient list, net weight + volume, "home produced" ack, business name/address, in-Ohio ack, beekeeper-exempt attestation
- **Open questions:** confirm Gnome can enforce Ohio-only buyer geofencing before enabling shipping.

### 3.6 Maple syrup (≥75% own-tree sap)
- **GENERALLY_UNRESTRICTED** · **Credential:** No (≥75% own sap; standard of identity ≥66° Brix)
- **Labeling:** statement of identity; net qty (oz on-site; oz+g off-site); ingredient list only if optional ingredients added; business name + address. Lead ≥500 ppb = adulterated
- **Channel:** direct sale clearly permitted · **Shipping:** shelf-stable; intra-Ohio focus
- **Sources:** ODA Maple Syrup fact sheet (Dec 2017); ORC 3715.021; ORC 3715.24; OAC 901:3-14-01
- **Gnome recommendation:** Attestation (≥75% own sap; ≥66° Brix; off-site oz+g; declare salt/preservatives) · **Paid-plan:** No
- **Fields:** ≥75%-own-sap attestation, statement of identity, net weight, business name/address, added-ingredient Y/N, optional grade
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — whether an exempt maple processor may sell into licensed retail/restaurant channels (flag before enabling wholesale listing types).

### 3.7 Sorghum syrup (≥75% own sorghum juice)
- **GENERALLY_UNRESTRICTED** — same exemption family as maple; labeling inferred from parallel fact sheets + ORC 3715.023
- Attestation, no upload, no paid plan. **Fields:** ≥75%-own-juice attestation, statement of identity, net weight, business name/address, added-ingredient declaration
- **Open questions:** no dedicated ODA sorghum fact sheet found — **minor REVIEW** on sorghum-specific labeling; same retail-channel question as maple.

### 3.8 Apple syrup / apple butter (≥75% own-tree apples)
- **Ohio classification:** CONDITIONAL (exempt processor OR cottage food)
- Apple syrup → 3715.021 exempt-processor labeling; **apple butter → cottage food (fruit butter), Ohio-only + "home produced"**
- **Gnome recommendation:** Attestation (≥75% own-tree apples); apple butter treated as cottage food (in-Ohio only)
- **Paid-plan:** No · **Fields:** ≥75%-own-apple attestation, product name, ingredient list, net weight + volume, cottage disclosure (apple butter), in-Ohio ack (apple butter)
- **Open questions:** whether a given canned apple butter is a potentially-hazardous/acidified food excluded from cottage food — flag unusual recipes for review.

### 3.9 Other fruit / flavored / infused syrups (NOT maple, sorghum, apple)
- **Ohio classification:** REGULATED (no exemption applies)
- **Credential:** YES — ODA **Food Processing Establishment** registration/license (outside every 3715.021 exemption and not on the cottage-food list)
- **Labeling:** full processed-food (21 CFR 101; ORC 3715.023) incl. Nutrition Facts where required
- **Gnome recommendation:** **Require food-processing registration upload or block on free plan**; no home/attestation-only listing
- **Paid-plan requirement:** **Yes — recommended** (legitimate seller is a licensed processor)
- **Fields:** ODA food-processing registration #, full ingredient list, Nutrition Facts confirmation, net contents, business name/address
- **Open questions:** thin-jam "fruit syrups" near the jam/jelly cottage boundary — case-by-case; **default REGULATED** unless seller demonstrates a listed cottage food.

---

# CLUSTER 4 — Meat, poultry, game/venison

**Framework (whole cluster = highest risk):** ORC Ch. 918 (Ohio Meat Inspection, ODA DMI, (614) 728-6260); OAC Ch. 901:2; FMIA (cattle/swine/sheep/goats mandatory USDA/FSIS); PPIA / P.L. 90-492 (poultry exemptions); retail food establishment licensing (ORC 3717, local health districts); ODNR OAC 1501:31-15 (wild-animal parts). **Default posture: paid-plan + credential-gated + local-pickup-only + no shipping; block free users.** Two credential objects: (a) inspection source, (b) retail food establishment license. "Custom-exempt / Not For Sale / locker-processed / home-slaughtered" red meat = **auto-flag and block** (keyword + attestation check).

### 4.1 Beef · 4.2 Pork · 4.3 Lamb/mutton · 4.4 Goat (FMIA-mandatory species)
- **Ohio classification:** REGULATED · **Credential:** YES
- **Regulator:** ODA DMI + USDA/FSIS (inspection); local health department (retail license)
- **Credential name:** ODA "shape-of-Ohio" or USDA mark of inspection **plus** Retail Food Establishment license (commonly Mobile/Temporary from county/city health district); ODA warehouse/food-processing registration if storing frozen off-farm
- **Seller restrictions:** slaughter/process at USDA- or ODA-inspected establishment (NOT custom-exempt). Home slaughter legal only for owner's personal use — **no meat may be sold** (ORC 918.10(A))
- **Labeling:** inspection legend + establishment #, product name, net weight, safe-handling, ingredients (processed), keep-refrigerated/frozen. Custom-exempt stamped "Not For Sale" = illegal to resell
- **Channel:** farmers market/direct only with inspected product + retail license · **Shipping:** **local pickup only, no shipping**
- **Exemptions:** personal/family-use slaughter (no sale). Custom-exempt returns "Not For Sale" meat to owner — cannot be sold
- **Sources:** ORC 918.01, 918.10, 918.25; OAC 901:2; FMIA 21 U.S.C. 601 et seq.; ODA DMI Laws & Rules
- **Gnome recommendation:** **Block free users;** require (a) USDA/ODA-inspected attestation, (b) retail food license upload, (c) local-pickup-only, no shipping. No generic "homegrown beef" without credential. Pork adds a stricter cured/smoked/RTE sub-node (inspected establishment + HACCP; home-cured for sale NOT permitted). Goat: on-farm religious slaughter for personal use OK only if no meat sold
- **Paid-plan requirement:** **Yes** · **compliance_classification:** `credential_required_regulated`
- **Fields:** inspection authority (USDA/ODA), establishment/plant name or #, retail food license # + issuing health district, product form, storage state, pickup location, "no shipping" flag
- **Open questions (preserve):** **LEGAL/AGENCY REVIEW REQUIRED** — live-animal / freezer-share ("half a cow on the hoof") legality (route to REVIEW_REQUIRED, do not silently allow under a meat node); goat on-farm religious slaughter-for-money (recommend: do not touch); whether ODA warehouse registration should be a required field; value-added/cured pork sub-node.

### 4.5 Rabbit
- **Ohio classification:** REVIEW_REQUIRED (leaning CONDITIONAL) · **Credential:** CONDITIONAL/REVIEW_REQUIRED
- Not FMIA/PPIA-mandatory; USDA inspection voluntary (9 CFR 354). Sale to public still needs **retail food establishment license** + processing in an FDA/ODA-registered/inspected facility. Only ~2 voluntary-inspection rabbit facilities in Ohio; compliant supply chain is thin
- **Gnome recommendation:** **Block free users;** require retail food license upload + attestation of licensed/registered processing facility; local pickup only; mark node REVIEW_REQUIRED and require compliance sign-off before enabling
- **Paid-plan:** **Yes** · **compliance_classification:** `review_required`
- **Fields:** processing facility name + registration type, retail food license #, storage state, pickup location
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — precise ODA/FDA facility-registration requirement for rabbit slaughter-for-sale in Ohio.

### 4.6 Chicken / turkey / other poultry
- **Ohio classification:** CONDITIONAL · **Credential:** CONDITIONAL (exemption attestation + retail license for market sales)
- **Regulator:** ODA DMI (state runs exempt-poultry program) + USDA-FSIS framework; local health dept
- **Credential name:** Producer/Grower exemption (ORC 918.10/918.27, P.L. 90-492) — **1,000-bird** and **20,000-bird** exemptions; plus retail food establishment/mobile license for market sale
- **Thresholds:** 1,000-bird: ≤1,000 own-raised birds/yr, on-premises; **Ohio (ORC 918.27) forbids buying live poultry**; sell only to household consumers/hotels/restaurants/institutions (not retailers-for-resale). 20,000-bird: ≤20,000 own-raised/yr under sanitary standards. Above 20,000 or buying birds to resell → full inspection
- **Labeling:** producer name + address; **"Exempt P.L. 90-492"** (required >1,000/yr); safe-handling; keep-refrigerated/frozen; no inspection legend
- **Channel:** on-farm + farmers-market direct to consumers under exemption; **retail food license still needed to vend at market**; no resale channel · **Shipping:** local pickup only
- **Sources:** ORC 918.10, 918.27; PPIA / P.L. 90-492; OSU Meat Science "Planning to Go Exempt?"; ODA DMI
- **Gnome recommendation:** **Block free users;** require exemption type + own-raising attestation, "did not buy live poultry" (1,000-bird), retail license upload for off-farm, "Exempt P.L. 90-492" labeling attestation, local pickup only. Support this — it's the one legitimate small-farm path — but gate it
- **Paid-plan:** **Yes** · **compliance_classification:** `conditional_exemption_attestation`
- **Fields:** exemption type (1,000/20,000/fully inspected), annual bird-volume band, "raised on my premises" checkbox, "did not purchase live poultry" checkbox (1,000-bird), retail food license # (off-farm), label-statement confirmation, pickup location
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — confirm Ohio adopted both exemptions and current retail-license expectations at markets vs on-farm (ODA DMI). Shell eggs are a separate cluster (§3.1) — do not fold in.

### 4.7 Game / venison (wild-harvested)
- **Ohio classification:** PROHIBITED (for meat) · **Credential:** none legalizes selling wild venison meat
- **Regulator:** ODNR Division of Wildlife (OAC Ch. 1501:31)
- **Rule:** no person shall buy/sell/offer any part of wild animals except as permitted; for white-tailed deer **only legally acquired hides, feet, and antlers** may be sold — **meat may NOT be sold in any form**
- **Exemptions:** donation via approved programs (FHFH) is charitable, not a sale; no commercial-sale exemption
- **Distinguish:** meat from **licensed captive white-tailed deer / farmed elk/red deer** processed at an inspected establishment is a *different* pathway = **REVIEW_REQUIRED** (ODNR/ODA propagation license + inspection). A typical "venison" listing is presumptively wild-harvested → block
- **Sources:** OAC 1501:31-15-02, 1501:31-15-11; ODNR Pub 5514; ORC Ch. 1533/1531
- **Gnome recommendation:** **PROHIBIT wild game/venison meat outright — hard block for ALL tiers** with an explainer. If Gnome later wants farm-raised venison/elk, create a separate `review_required` node with propagation-license + inspected-processor upload
- **Paid-plan:** N/A · **compliance_classification:** `prohibited`
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — farm-raised cervid pathway before enabling any "venison" listing type.

---

# CLUSTER 5 — Pet food, treats, chews, bakery, feed, live feed

**Governing finding:** under Ohio law **"pet food" is a subtype of "commercial feed"** (ORC 923.41). Anyone who manufactures pet food/treats/feed, or whose name is on the label as distributor, must **register annually with ODA** (ORC 923.42, $50/yr, due Feb 1, expires Jan 31) — enforced from **Jan 1, 2026.** Tonnage/inspection fee $0.25/ton with first 200 tons exempt (ORC 923.44). **Ohio has NO cottage-food exemption for pet products** (cottage food = human food only; ORC 3715.025). Federal FDA/AAFCO overlay applies (labeling per ORC 923.43; "snack/treat" designation; **no nutritional claims on chews**; disease claims = unapproved animal drug, prohibited).

### 5.1 Pet food (complete/complementary diets, any species)
- **REGULATED** · **Credential:** YES — Ohio Commercial Feed Registration (ORC 923.42) + tonnage statement (923.44)
- **Regulator:** ODA Commercial Feed program; FDA · **Labeling:** ORC 923.43 full set + AAFCO nutritional-adequacy statement
- **Channel:** all once registered · **Shipping:** shelf-stable, shippable
- **Gnome recommendation:** Require ODA registration # (attestation minimum, upload preferred) before publishing; **block free/unverified users;** no-medical-claims ack
- **Paid-plan:** **Yes** · **compliance_classification:** `REGULATED_LICENSE_REQUIRED`
- **Fields:** ODA registration #, manufacturer name + address, species, guaranteed analysis, full ingredient list, net weight, nutritional-adequacy statement, no-medical-claims ack
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — de-minimis enforcement floor (statute has none; ODA practice unpublished; ask ODA foodsafety@agri.ohio.gov / (614) 728-6250 before relaxing any gate).

### 5.2 Pet treats / snacks (dog & cat treats, jerky, biscuits)
- **REGULATED** · same commercial-feed registration; home dog-treat bakers are NOT covered by cottage food · **Labeling:** ORC 923.43 + conspicuous "snack"/"treat"
- **Gnome recommendation:** as §5.1 (highest "innocent-looking" risk — homemade dog biscuits; enforce firmly) · **Paid-plan:** **Yes** · `REGULATED_LICENSE_REQUIRED`
- **Fields:** ODA registration #, "treat/snack" designation, ingredients, net weight, manufacturer name/address, medical-claim ack · **Open questions:** de-minimis enforcement (REVIEW).

### 5.3 Bones / chews (rawhide, antlers, bully sticks, dental chews, natural bones)
- **REGULATED (edible)** vs **GENERALLY_UNRESTRICTED (inedible toy)** — split node
- Edible/consumable chews = commercial feed → registration; purely inedible toys (nylon) = general goods. Slaughter-byproduct chews should originate from inspected sources. AAFCO: **no nutritional claims on chews**
- **Gnome recommendation:** edible → registration + attestation, block free users; inedible toy → allow as general goods with "not for consumption" field
- **Paid-plan:** Yes (edible) / No (inedible) · `REGULATED_LICENSE_REQUIRED` (edible) / `GENERALLY_UNRESTRICTED` (inedible)
- **Fields:** edible/inedible flag, ODA registration # (if edible), animal-material source, net weight, manufacturer/distributor
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — sourcing-inspection expectations for slaughter-byproduct chews.

### 5.4 Pet bakery ("pupcakes", decorated dog treats)
- **REGULATED** · Ohio cottage-food/home-bakery does NOT apply · **Credential:** YES (commercial feed registration)
- **Gnome recommendation:** as treats; surface explicit "pet baked goods are NOT covered by cottage food law" notice at listing time (high-education node); perishable frosted → local pickup
- **Paid-plan:** **Yes** · `REGULATED_LICENSE_REQUIRED` · **Fields:** ODA registration #, ingredients, "treat" designation, perishable flag, pickup-vs-ship · **Open questions:** de-minimis (REVIEW).

### 5.5 Commercial / livestock & poultry feed (rabbit pellets, bird-seed mixes, chicken feed)
- **REGULATED (mixed/processed)** vs **CONDITIONAL (unmixed whole seed)** — **unmixed whole/physically-altered-entire seeds are excluded** from "commercial feed" (ORC 923.41); mixed bird seed or processed/ground feed IS feed
- **Credential:** YES for registrable feed (ORC 923.42 + tonnage) · **Labeling:** ORC 923.43 incl. guaranteed analysis; medicated feed adds VFD/FDA
- **Gnome recommendation:** mixed/processed → registration attestation, block free users; whole single-seed grain → GENERALLY_UNRESTRICTED with a routing question ("single unmixed whole seed vs mix/processed?")
- **Paid-plan:** Yes (registrable) / No (whole seed) · `REGULATED_LICENSE_REQUIRED` (mixed) / `CONDITIONAL` (unmixed)
- **Fields:** mix-vs-unmixed-seed flag, ODA registration # (if feed), species, guaranteed analysis, ingredient list, medicated Y/N · **Open questions:** whether ODA treats specific bagged whole-grain products as exempt in practice (REVIEW).

### 5.6 Frozen feed (frozen feeder rodents/chicks/fish)
- **Ohio classification:** CONDITIONAL (shipping/sourcing constraints dominate) · **Credential:** CONDITIONAL/REVIEW_REQUIRED
- Frozen whole prey arguably outside "commercial feed"; if sold as a branded/labeled reptile-food product it may be pulled into registration. Frozen feeders **ARE shippable** with cold-chain packaging (unlike live rodents)
- **Gnome recommendation:** allow with keep-frozen disclosure + captive-bred/"not wild-caught" attestation; attestation not full credential unless marketed as branded feed (then §5.1); route ambiguous cases to review
- **Paid-plan:** recommend Yes (classification uncertainty) · `CONDITIONAL_ATTESTATION` (REVIEW_REQUIRED fallback)
- **Fields:** species, frozen-state confirmation, captive-bred attestation, cold-chain shipping method, net weight/count
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — does ODA classify branded frozen whole-prey as registrable commercial feed?

### 5.7 Live feeder insects (crickets, mealworms, superworms, dubia roaches, waxworms)
- **GENERALLY_UNRESTRICTED** (shipping + invasive caveats) · **Credential:** No
- Not manufactured "commercial feed"; standard feeders routinely shipped (USPS Pub 52 §526 "live, harmless, feeder insects"); avoid quarantine/invasive species (dubia not prohibited in Ohio as of research)
- **Gnome recommendation:** allow incl. lower tiers; attestation "captive-reared, non-quarantine"; no upload
- **Paid-plan:** No · `GENERALLY_UNRESTRICTED` · **Fields:** species, live count/weight, captive-reared attestation, ship-vs-pickup · **Open questions:** confirm no ODA plant-pest quarantine species slip in (low risk).

### 5.8 Live feeder rodents (mice, rats, "pinkies")
- **Ohio classification:** CONDITIONAL (lawful to sell; **cannot ship live → local-pickup-only**) · **Credential:** No state feed/wildlife credential for domestic mice/rats
- **Shipping:** **PROHIBITED via USPS; refused by UPS/FedEx** (warm-blooded nonmailable; USPS Pub 52 §525). Large commercial breeders may need USDA APHIS/AWA dealer license
- **Gnome recommendation:** **force local-pickup-only** (disable shipping at node level); humane-handling attestation; USDA AWA prompt for large breeders
- **Paid-plan:** conditional (recommend paid/attested) · `CONDITIONAL_LOCAL_PICKUP_ONLY`
- **Fields:** species, live count/size, pickup-only enforced flag, humane-handling attestation · **Open questions:** USDA APHIS/AWA dealer-licensing threshold (REVIEW).

### 5.9 Live feeder fish / minnows (as feed or bait)
- **REGULATED** · **Credential:** CONDITIONAL→YES for baitfish/minnows — **ODNR Bait Dealer Permit** ($40/yr, exp Dec 31; OAC 1501:31-13-04) or Aquaculture Class A/B
- **Regulator:** ODNR Division of Wildlife; ODA if aquaculture-raised
- **Seller restrictions:** only species already established in Ohio waters; invasive/non-established prohibited; daily transaction records
- **Shipping:** local pickup strongly preferred; interstate live aquatics → Lacey Act/invasive
- **Gnome recommendation:** require bait-dealer/aquaculture permit #, block free users, restrict species to Ohio-established list, local-pickup-only, invasive-release warning
- **Paid-plan:** **Yes** · `REGULATED_LICENSE_REQUIRED` · **Fields:** permit #, species (Ohio-established), count, pickup-only, "do not release/invasive" ack
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — whether feeder-only ornamental fish (not sold as bait) still trigger the bait permit.

### 5.10 Live reptiles / amphibians (native species, as feeder or pet)
- **Ohio classification:** PROHIBITED (wild-caught native) / REGULATED (captive-bred native); recommend **REVIEW_REQUIRED gate for all live herps at launch**
- **Credential:** YES for captive-bred natives — **Commercial Propagating License** ($40; ORC 1533.71; OAC 1501:31-25-04); wild-caught natives PROHIBITED
- **Seller restrictions:** "unlawful to buy/sell/barter/trade any reptile or amphibian taken from the wild in Ohio"; non-natives may not be released
- **Gnome recommendation:** **prohibit wild-caught native outright;** captive-bred natives require propagating license # upload + captive-bred attestation + origin docs; block free users; **REVIEW-gate the whole live-herp category at launch** (ORC 935 dangerous-wild-animal/venomous overlay)
- **Paid-plan:** **Yes** · `PROHIBITED` (wild-caught) + `REGULATED_LICENSE_REQUIRED` (captive-bred); interim `REVIEW_REQUIRED`
- **Fields:** species (scientific), native/non-native flag, wild-caught vs captive-bred (wild-caught native = block), propagating license #, origin docs
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — venomous/constrictor + Dangerous Wild Animal Act (ORC 935) overlay before enabling any live reptile category.

### 5.11 Feeder birds (chicks, quail) & rabbits sold as feed
- **Ohio classification:** CONDITIONAL · **Credential:** CONDITIONAL/REVIEW_REQUIRED
- Domestic poultry chicks + domestic rabbits are livestock, not ODNR wildlife; no feed registration for live whole animals; large-scale breeding may implicate USDA APHIS/AWA; game-bird propagation (quail/pheasant) may need ODNR propagation license (ORC 1533.71)
- **Shipping:** live rabbits nonmailable → local pickup; day-old poultry USPS-mailable under Pub 52 but specialized → default local pickup for a marketplace
- **Gnome recommendation:** default local-pickup-only; humane-handling + health attestation; ODNR-license prompt for game species; do not enable live-animal shipping in v1
- **Paid-plan:** recommend conditional/paid · `CONDITIONAL_LOCAL_PICKUP_ONLY` (REVIEW_REQUIRED for game species)
- **Fields:** species, domestic-vs-game flag, live count, pickup-only, health/humane attestation · **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — NPIP/poultry-health sale rules and USDA AWA thresholds.

### 5.12 Cross-cutting: medical / health claims on ANY pet product
- **PROHIBITED (claim-level content rule)** — a product intended to diagnose/cure/mitigate/treat/prevent disease is an unapproved animal drug (FDA). Structure/function claims may be permissible if carefully worded; disease claims ("treats arthritis", "kills worms") are prohibited
- **Gnome enforcement:** **global content filter + mandatory attestation** ("I will not make disease claims") on every pet-cluster listing; auto-flag disease/treatment keywords; applies to all tiers · `PROHIBITED_CLAIM` (validation layer, not a node type).

---

# CLUSTER 6 — Live bait & fishing

**Framework:** ORC 1533.40 (bait dealer/collector permit, ODNR — **$40/yr, exp Dec 31**, covers "minnows, crayfish, or hellgrammites"; form DNR 8826); OAC 1501:31-13-04 (sellable species, ½-inch receptacle marking with name/address/permit #, daily records kept 2 yrs, non-permittee possession cap 100 crayfish / 500 aggregate); OAC 1501:31-19-01 (injurious aquatic invasive species — **red swamp crayfish prohibited live**); federal USDA APHIS VHS order (interstate baitfish). Retail sales need an Ohio vendor's license (tax; blanket seller obligation, not per-node).

### 6.1 Nightcrawlers / earthworms / garden worms
- **GENERALLY_UNRESTRICTED** · No credential (bait permit covers only minnows/crayfish/hellgrammites — not terrestrial worms) · ship freely · attestation only · no paid plan
- **Fields:** bait type, quantity/count, live-or-preserved, pickup vs ship · **Open questions:** none material.

### 6.2 Wax worms · 6.3 Mealworms
- **GENERALLY_UNRESTRICTED** · terrestrial larvae outside permit scope · attestation only · no paid plan · **Fields:** larva type, count/weight, live-or-not, feed-vs-bait use
- **Open questions:** if marketed explicitly as **animal feed** (not bait), ODA commercial-feed labeling could attach — **LEGAL/AGENCY REVIEW** if a "feeder insect" feed node is added (cross-ref §5.7).

### 6.4 Minnows / baitfish
- **REGULATED** · **Credential:** YES to sell — Bait Dealer/Collector Permit (DNR 8826) · **Regulator:** ODNR Division of Wildlife
- **Seller restrictions:** lawful bait species only; certain sunfish/bullheads only from permittee/aquaculture/out-of-state; endangered excluded · **Labeling:** ½-inch receptacle marking · **Channel:** market/direct/retail with permit; live skipjack herring barred in Lake Erie drainage · **Shipping:** interstate implicates VHS order → **local pickup only**
- **Gnome recommendation:** require permit # + expiration; local pickup only (block shipping); block free users; species-lawful + receptacle-marked attestation
- **Paid-plan:** **Yes** · `CREDENTIAL_REQUIRED` / `LOCAL_PICKUP_ONLY`
- **Fields:** species (allowed-bait list), live/preserved, quantity, bait dealer permit #, expiration, source (wild vs aquaculture), pickup county. **Validate permit expiration ≥ listing date**
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — exact interstate VHS/APHIS obligations before ever enabling baitfish shipping.

### 6.5 Crayfish / crawfish (live, bait)
- **REGULATED + PROHIBITED sub-species** · **Credential:** YES (DNR 8826)
- **Red swamp crayfish (Procambarus clarkii) live possession/sale is UNLAWFUL** (48-hr-kill-for-consumption exception only); live takes restricted 9 p.m.–4 a.m.
- **Gnome recommendation:** require permit upload; local pickup only; block free users; **hard-block red swamp crayfish (and any live listed invasive)** via prohibited-species attestation; block shipping
- **Paid-plan:** **Yes** · `CREDENTIAL_REQUIRED` / `LOCAL_PICKUP_ONLY` + `PROHIBITED_SPECIES_BLOCK`
- **Fields:** species/ID, "not red swamp crayfish" attestation, live/preserved, quantity, permit #, expiration, pickup county
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — lock the full prohibited-crayfish list (marbled crayfish, etc.) before launch.

### 6.6 Hellgrammites / larval aquatic insects
- **REGULATED** · **Credential:** YES (explicitly named in ORC 1533.40) · local pickup only; block free users · **Paid-plan:** **Yes** · `CREDENTIAL_REQUIRED` / `LOCAL_PICKUP_ONLY`
- **Fields:** species, quantity, permit #, expiration, pickup county · **Open questions:** none beyond shared interstate-shipping question.

### 6.7 Other live bait (leeches, misc listed species)
- **REVIEW_REQUIRED** (species-dependent) · **Credential:** CONDITIONAL. Listed baitfish → permit; **leeches not clearly in the 1533.40 triad → REVIEW_REQUIRED**
- **Gnome recommendation:** default REVIEW_REQUIRED / credential + local pickup; route leeches + free-text "other live bait" to manual review; block free users
- **Paid-plan:** Yes (credentialed subset) · `REVIEW_REQUIRED` · **Fields:** exact species, live/preserved, quantity, permit # (if applicable), pickup county
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — is a live-bait leech a "minnow/fish" under 1533.40? Ask ODNR.

### 6.8 Preserved bait (salted minnows, cured eggs, preserved crayfish/nymphs)
- **REVIEW_REQUIRED** · **Credential:** REVIEW_REQUIRED. 1533.40 lacks an express live/dead distinction; 1501:31-13-04 exempts preserved minnows from possession caps (implies leniency). Preserved (non-living) avoids VHS/live-transport → shipping likely permissible
- **Gnome recommendation:** default REVIEW_REQUIRED; conservatively allow clearly-dead/preserved with "non-living, preserved" attestation but **do not represent as permit-free until confirmed;** prohibit endangered-species material
- **Paid-plan:** conditional · `REVIEW_REQUIRED` (interim `ATTESTATION_ONLY` for clearly dead) · **Fields:** "preserved/non-living" flag, base species, preservation method, quantity
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — does 1533.40 reach dealers in preserved minnows/crayfish?

### 6.9 Artificial bait / lures / tackle
- **GENERALLY_UNRESTRICTED** · no credential, no wildlife nexus · ship freely · no paid plan · **Fields:** product type, new/used, quantity · **Open questions:** none.

---

# CLUSTER 7 — Firewood, wood, compost, fertilizer, garden goods, cut flowers

**Framework:** ORC Ch. 927 (plant pest/quarantine, ODA Plant Health — **firewood is ODA, not ODNR**); ORC Ch. 905 (fertilizer); OAC Ch. 3745-560 (Ohio EPA composting facilities); nursery-stock definition (ODA). County quarantine lists and fee schedules change — ODA is the live authority.

### 7.1 Firewood / kindling / firewood bundles (untreated hardwood/ash/mixed)
- **Ohio classification:** CONDITIONAL (movement-restricted; local sale generally unrestricted) · **Credential:** CONDITIONAL — ODA **Compliance Agreement** to move regulated wood out of a quarantined county; none for local intra-county pickup
- **Regulator:** ODA Plant Health (state EAB/spongy-moth/box-tree-moth/ALB quarantines remain even though USDA deregulated federal EAB in 2021)
- **Seller restrictions:** moving ash/all hardwood firewood out of a quarantined county without a compliance agreement is prohibited (fines up to ~$4,000); certified heat-treated/kiln-dried firewood is the clean shipping path
- **Labeling:** sold by measure (cord/face cord/bundle) with volume disclosed (weights & measures); heat-treated product should carry the treatment cert
- **Shipping:** **LOCAL PICKUP ONLY by default** unless heat-treatment/kiln certification or compliance agreement; hard-block "ship anywhere" on untreated ash/hardwood
- **Gnome recommendation:** attestation + local-pickup-only for untreated; to enable shipping require heat-treat/kiln cert attestation/upload; show "Don't Move Firewood" notice
- **Paid-plan requirement:** **No** — do not paywall a public-safety pest control
- **compliance_classification:** `movement_restricted_pickup_default`
- **Fields:** species (ash/mixed hardwood/softwood); treatment status (untreated/kiln-dried/USDA heat-treated certified); county of origin; sold-by measure + volume; fulfillment (pickup vs ship-if-certified); quarantine attestation checkbox
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — current EAB + spongy-moth quarantined county lists (dynamic — pull from ODA; consider auto-geofencing origin counties); whether ash kindling/sub-1" chips are exempt.

### 7.1a Kindling / wood chips / bark mulch (wood-derived)
- CONDITIONAL — same quarantine logic for ash/hardwood chips; commercially processed/bagged bark mulch → treat under §7.3 (GENERALLY_UNRESTRICTED local sale). **Open question:** sub-1" chip exemption — **REVIEW_REQUIRED**.

### 7.2 Fertilizer (bagged/bulk plant nutrients, incl. organic/compost-based, manure sold with guaranteed analysis)
- **Ohio classification:** REGULATED · **Credential:** YES
- **Regulator:** ODA (Fertilizer / Ag Additives program)
- **Credential name:** **Fertilizer manufacturer/distributor license** (ORC 905.32, ~$50/location) PLUS **Specialty Fertilizer registration** (ORC 905.33) for consumer/lawn/garden products
- **Seller restrictions:** the **guaranteed-analysis tripwire** — plain manures/lime/marl are NOT "fertilizer" UNLESS mixed with fertilizer materials or distributed with a guaranteed analysis (ORC 905.31). Printing "5-3-2"/"guaranteed N-P-K" makes it regulated fertilizer
- **Labeling:** ORC 905.35 — net weight, brand/grade, guaranteed analysis, guarantor name/address, nutrient derivation
- **Gnome recommendation:** **two lanes.** Lane A (labeled fertilizer / guaranteed analysis) → block unless ODA fertilizer license # provided; block free users. Lane B (plain soil amendment, no N-P-K claim) → allowed as unregulated soil product (§7.3) with "no guaranteed analysis" attestation
- **Paid-plan requirement:** **Yes** for Lane A; No for Lane B · **compliance_classification:** `regulated_credential_required`
- **Fields:** product type; makes nutrient/guaranteed-analysis claim (Y/N); guaranteed analysis N-P-K; net weight; ODA fertilizer license #; specialty-fertilizer registration #; material derivation
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — small-manufacturer de-minimis threshold (no clear statutory small-batch exemption; enforcement posture unknown) for homemade compost-tea/worm-casting "fertilizer".

### 7.3 Compost, mulch, topsoil/soil, soil amendments, potting mix (no guaranteed nutrient analysis)
- **Ohio classification:** CONDITIONAL (regulation attaches to the *production facility*, not the retail sale, above exempt scale); GENERALLY_UNRESTRICTED as a small-quantity product · **Credential:** CONDITIONAL — no credential to sell at small scale; **producing** compost above exempt scale needs **Ohio EPA composting facility registration/license** (Class I–IV; OAC 3745-560)
- **Regulator:** Ohio EPA (production); ODA if nutrient claims made
- **Seller restrictions:** backyard/small on-farm composting generally exempt from facility permitting (OAC 3745-560-01/-02); larger ops accepting off-site yard waste/food scraps need Class IV+
- **Labeling:** none if no guaranteed analysis / nutrient claim (else → §7.2 fertilizer); weights-and-measures net-quantity if packaged
- **Gnome recommendation:** attestation ("no guaranteed nutrient claim" + "produced per Ohio composting rules / small-scale exempt"); nutrient claims → fertilizer lane (block + credential); no paywall for plain amendments
- **Paid-plan:** No (plain) / escalates to Yes on nutrient claim · `low_risk_attestation` → `regulated_credential_required`
- **Fields:** product type; feedstock (yard waste/manure/food scraps/peat/coir); nutrient claim (must be "no"); net volume/weight; bagged vs bulk
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — exact Ohio EPA volume/feedstock thresholds separating exempt small composting from Class IV; **flag manure/biosolids compost** (extra Class I/II licensing + land-application rules).

### 7.4 Pots, raised-bed kits, tools, garden decor, stakes, trellises (hard goods)
- **GENERALLY_UNRESTRICTED** · no credential · standard retail; ship freely · no attestation beyond TOS · no paid plan
- **Caveat:** a raised-bed kit shipping untreated ash/hardwood from a quarantined county → apply §7.1 logic (commercially milled lumber is fine) · **Fields:** item, materials, dimensions, condition · **Open questions:** none material.

### 7.5 Cut flowers & fresh bouquets (annual, cut stems)
- **GENERALLY_UNRESTRICTED** · **Credential:** No nursery license (cut flowers/annuals are **not** "nursery stock" — limited to *hardy* stock). Vendor's license for sales tax only
- **Labeling:** none mandated · **Channel:** market/direct/retail/online all fine · **Shipping:** generally none for Ohio-grown domestic cut flowers (perishability, not law, favors local pickup)
- **Gnome recommendation:** allow freely; optional attestation "fresh-cut/annual" (to distinguish from §7.7 live nursery stock); TOS reminder on vendor's license
- **Paid-plan:** No · `general_unrestricted` · **Fields:** flower type; fresh-cut vs potted (routing field); locally-grown attestation; pickup/delivery · **Open questions:** none material for Ohio-grown fresh cut flowers.

### 7.6 Dried flowers / dried botanicals / wreaths
- **GENERALLY_UNRESTRICTED** (non-food, non-living) · no credential · ship freely · no paid plan
- **Gnome recommendation:** allow freely; attestation "decorative, not for consumption" (edible dried flowers/herbs route to a food/cottage-food node) · **Fields:** type, decorative-only attestation · **Open questions:** edible dried flowers → route to food cluster.

### 7.7 Potted / live flowering plants, perennials, bulbs (hardy nursery stock)
- **Ohio classification:** REGULATED (nursery-stock licensing) — the boundary case sellers misfile under "flowers" · **Credential:** CONDITIONAL→YES for **hardy** nursery stock; No for potted **annuals**
- **Regulator:** ODA Plant Health · **Credential name:** **Dealer in Nursery Stock license** (reseller) or **Certificate of Nursery Inspection** (grower); nursery stock = any *hardy* tree/shrub/plant/bulb (except turfgrass) + cuttings/grafts/scions/buds
- **Seller restrictions:** hardy live plants → dealer license + trade only inspected/certified stock; **annuals exempt** (like cut flowers). Certain hosts face pest quarantines (box tree moth on *Buxus*)
- **Shipping:** local pickup does NOT remove the license requirement (license attaches to selling); interstate adds destination-state phytosanitary rules
- **Gnome recommendation:** **routing + conditional credential.** Split "flowers/plants": (a) cut/dried/annual → unrestricted (§7.5/7.6 + annuals); (b) **hardy/perennial/potted live nursery stock → require Dealer in Nursery Stock license # or block; block free users**; inspected-certified attestation
- **Paid-plan:** **Yes** for hardy nursery stock; No for annuals/cut/dried · `regulated_credential_required` (hardy) / `general_unrestricted` (annual)
- **Fields:** plant type; **hardy perennial vs annual** (load-bearing routing field); ODA nursery/dealer license #; inspected-certified attestation; species (to catch quarantined hosts); pickup vs ship
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — whether occasional home perennial/potted-plant sales need a dealer license (no clear hobby de-minimis); current dealer-license fee; active host quarantines. (Cross-references §1.7 — same ORC 927 regime; reconcile these two nodes to one taxonomy subtree.)

---

# CLUSTER 8 — Dairy / farm fresh (no dedicated research cluster supplied)

The taxonomy seed includes a `farm-fresh` (Dairy & Farm Fresh) branch flagged
`dairy_licensing`, with **raw milk marked PROHIBITED**. No dedicated Ohio dairy
compliance research was provided for this report.

- **Milk, cheese, butter, yogurt, goat-dairy:** **REVIEW_REQUIRED** — Ohio dairy is
  licensed/inspected (Grade A / dairy-processing); cottage food does not cover
  dairy. Treat as credential-gated + local-pickup-only pending research.
- **Raw (unpasteurized) milk:** **PROHIBITED** for retail sale in Ohio; the herdshare/
  cow-share model is a separate legal arrangement, not a marketplace sale. Keep the
  node for context but **hard-block listing**.
- **Gnome recommendation:** REVIEW-gate the entire dairy branch at launch; hard-block
  raw milk on all tiers.
- **Open questions:** **LEGAL/AGENCY REVIEW REQUIRED** — full Ohio dairy licensing
  research (Grade A permits, ORC/OAC dairy rules, herdshare status) must be
  commissioned before enabling any dairy listing type. Do not guess.

---

# SUMMARY MATRIX A — classification & gate by taxonomy node

Legend: **Class** = GU (Generally_Unrestricted) · CO (Conditional) · RG (Regulated) ·
RV (Review_Required) · PR (Prohibited). **Gate** = attestation / credential /
local-pickup / Ohio-only / block. **Paid** = paid plan recommended.

| Node | Class | Credential | Paid | Ship default |
|---|---|---|---|---|
| Fresh vegetables (whole) | GU | none | No | Ship OK |
| Fresh fruit (whole) | GU | none | No | Ship OK |
| Fresh herbs (cut) | GU | none | No | Ship OK |
| Dried herbs / seasoning / tea blends | CO (cottage) | attestation | No | **Ohio-only** |
| Seeds (veg/herb/flower) | RG/CO | Seed Labeler Permit / attestation | Optional | Ship OK (block noxious) |
| Native/pollinator seed | CO / **RV / PR** (wild-listed) | permit + species screen | Optional | Ship OK |
| Nursery stock / hardy live plants | RG | Nursery cert OR Dealer license | **Yes** | Local pickup |
| Vegetable/herb **starts (annual)** | **RV** | attestation + ODA prompt | TBD | Local pickup |
| Non-PHF baked goods | GU (cottage) | attestation | No | **Ohio-only** |
| Pastries/donuts (unfilled) | GU (cottage) | attestation | No | Ohio-only |
| Filled/cream/custard donuts & pastries | RG | Home Bakery License | No | Local pickup |
| Granola | GU (cottage) | attestation | No | Ohio-only |
| Candy/confections (shelf-stable) | GU (cottage) | attestation (block fruit-dipped) | No | Ohio-only |
| Candy/caramel apples, dipped fresh fruit | RG | Home Bakery License | No | Local pickup |
| Jam/jelly/fruit butter/chutney | GU (cottage) | attestation | No | Ohio-only |
| Roasted coffee (bean/ground) | GU (cottage) | attestation | No | Ohio-only |
| PHF pies/cheesecake/meringue | RG | Home Bakery License | No | Local pickup |
| Chicken eggs (≤500) | CO | attestation → cert (off-farm) | No | Local pickup |
| Duck/quail/turkey/goose eggs | **RV** | attestation (mirror chicken) | No | Local pickup |
| Raw/creamed/comb honey (≥75%) | GU | attestation | No | Intra-OH |
| Flavored/infused honey | CO (cottage) | attestation | No | **Ohio-only** |
| Maple syrup (≥75%) | GU | attestation | No | Intra-OH |
| Sorghum syrup (≥75%) | GU | attestation | No | Intra-OH |
| Apple syrup / apple butter (≥75%) | CO | attestation | No | Apple butter Ohio-only |
| Other fruit/flavored syrups | RG | Food Processing registration | **Yes** | Ship OK (licensed) |
| Beef / Pork / Lamb / Goat | RG | Inspection + Retail Food license | **Yes** | **Local pickup, no ship** |
| Rabbit | **RV** | Retail Food license + facility | **Yes** | Local pickup |
| Chicken/turkey/poultry | CO | P.L. 90-492 exemption + license | **Yes** | Local pickup |
| Wild venison / game meat | **PR** | none (block all tiers) | — | N/A |
| Pet food / treats / bakery | RG | ODA Commercial Feed reg | **Yes** | Ship OK |
| Bones/chews (edible) | RG | ODA Commercial Feed reg | **Yes** | Ship OK |
| Bones/chews (inedible toy) | GU | none | No | Ship OK |
| Commercial feed (mixed/processed) | RG | ODA Commercial Feed reg | **Yes** | Ship OK |
| Whole unmixed seed/grain | CO | routing question | No | Ship OK |
| Frozen feeder rodents/chicks/fish | CO / **RV** | attestation (cred if branded) | Rec. Yes | Cold-chain ship OK |
| Live feeder insects | GU | attestation | No | Ship OK |
| Live feeder rodents | CO | attestation | Rec. Yes | **Local pickup only** |
| Live feeder fish/minnows | RG | Bait Dealer Permit | **Yes** | Local pickup only |
| Live native reptiles/amphibians | **PR** (wild) / RG (captive) / **RV** at launch | Propagating license | **Yes** | Local pickup |
| Feeder birds/rabbits | CO / **RV** (game) | attestation | Rec. Yes | Local pickup |
| Nightcrawlers / earthworms | GU | attestation | No | Ship OK |
| Wax worms / mealworms | GU | attestation | No | Ship OK |
| Minnows / baitfish | RG | Bait Dealer Permit | **Yes** | Local pickup only |
| Crayfish (live) | RG + **PR** sub-species | Bait Dealer Permit + species block | **Yes** | Local pickup only |
| Hellgrammites / aquatic larvae | RG | Bait Dealer Permit | **Yes** | Local pickup only |
| Other live bait (leeches, misc) | **RV** | conditional | Yes | Local pickup only |
| Preserved bait | **RV** | conditional | Conditional | Likely ship OK |
| Artificial bait / lures / tackle | GU | none | No | Ship OK |
| Firewood (untreated ash/hardwood) | CO | attestation + compliance agmt to move | **No** | **Local pickup only** |
| Firewood (kiln-dried/heat-treated) | CO | treatment cert | No | Ship w/ cert |
| Bark/landscape mulch (processed) | GU | none | No | Ship OK |
| Fertilizer w/ guaranteed analysis | RG | ODA Fertilizer license + specialty reg | **Yes** | Ship OK |
| Compost/soil/potting mix (no claim) | CO | attestation | No | Ship OK |
| Pots/tools/kits/decor | GU | none | No | Ship OK |
| Cut flowers / bouquets (annual) | GU | none | No | Local favored |
| Dried flowers / botanicals / wreaths | GU | none | No | Ship OK |
| Potted hardy/perennial plants, bulbs | RG | Dealer in Nursery Stock license | **Yes** | Local pickup |
| Milk/cheese/butter/yogurt/goat dairy | **RV** | dairy licensing (research pending) | **Yes** | Local pickup |
| Raw milk | **PR** | none (block all tiers) | — | N/A |

# SUMMARY MATRIX B — nodes by classification

- **GENERALLY_UNRESTRICTED:** fresh vegetables, fresh fruit, fresh herbs, all non-PHF
  cottage baked goods (bread/cookies/cakes/muffins/fruit pies/unfilled donuts),
  granola, shelf-stable candy, jam/jelly/fruit butter/chutney, roasted coffee,
  raw/creamed/comb honey, maple syrup, sorghum syrup, inedible chew toys, live
  feeder insects, nightcrawlers/earthworms, wax worms, mealworms, artificial
  tackle, processed bark mulch, pots/tools/decor, cut flowers (annual), dried
  flowers/wreaths. *(Paid plan: none.)*
- **CONDITIONAL:** dried herbs/seasoning/tea (cottage), unfilled pastries/donuts,
  flavored/infused honey (cottage), apple syrup/apple butter, chicken eggs (≤500),
  whole unmixed seed/grain, frozen feeder animals, live feeder rodents, feeder
  birds/rabbits, firewood (untreated + treated), compost/soil/potting mix.
  *(Paid plan: only where noted — none legally required.)*
- **REGULATED:** seeds (labeler permit), nursery/hardy live plants, PHF baked goods,
  filled cream/custard donuts & pastries, fresh-fruit-dipped candy, other fruit/
  flavored syrups, beef/pork/lamb/goat, pet food/treats/bakery/edible chews,
  commercial mixed feed, live feeder fish/minnows, minnows/baitfish, crayfish,
  hellgrammites, fertilizer (guaranteed analysis), potted hardy plants.
  *(Paid plan recommended for: nursery stock, other syrups, meats, pet-feed cluster,
  bait cluster, fertilizer, hardy plants.)*
- **REVIEW_REQUIRED:** annual vegetable/herb starts, native/pollinator seed
  (wild-collected sub-case), duck/quail/turkey/goose eggs, rabbit meat, frozen
  branded whole-prey, live native reptiles/amphibians (whole category at launch),
  feeder game-bird species, other live bait / leeches, preserved bait, all dairy
  (research pending).
- **PROHIBITED:** wild venison / wild game meat (all tiers), wild-caught native
  reptiles/amphibians, red swamp crayfish (live), raw milk (retail). Content-level
  prohibition: medical/health/disease claims on any pet product.

# SUMMARY MATRIX C — nodes requiring a paid plan (recommended, not legally mandated unless noted)

Nursery stock / hardy live plants (§1.7, §7.7); other fruit/flavored syrups (§3.9);
beef/pork/lamb/goat (§4.1–4.4); rabbit (§4.5); chicken/turkey/poultry (§4.6); pet
food/treats/bakery/edible chews (§5.1–5.4); commercial mixed feed (§5.5); live
feeder fish/minnows (§5.9); live native reptiles (§5.10); minnows/baitfish (§6.4);
crayfish (§6.5); hellgrammites (§6.6); fertilizer with guaranteed analysis (§7.2);
dairy (§8, pending). **Firewood is explicitly NOT paywalled** (public-safety pest
control). No cottage-food or honey/maple/sorghum node legally requires a paid plan.

# CONSOLIDATED "LEGAL/AGENCY REVIEW REQUIRED" REGISTER (preserved, unresolved)

1. Annual vegetable/herb **starts/transplants** under ORC 927 — licensable nursery
   stock or de-minimis? (§1.7)
2. Seed-labeler-permit **enforcement threshold** for small home seed-savers; exact
   permit fee. (§1.5)
3. Exact current **cottage-food label string** / 2025–26 OAC 901:3-20 amendments;
   FALCPA Big-9 allergen obligation for CFPOs. (§1.4, §2)
4. ODNR DNAP **listed native-plant** species list (pull live, don't hard-code). (§1.6)
5. Non-chicken **egg** exemption + grade/size labeling parity. (§3.2)
6. Whether **exempt maple/sorghum** processors may sell into licensed retail. (§3.6–3.7)
7. **Interstate shipping** legal basis for cottage foods; Ohio-only geofencing
   feasibility. (§2, §3.5)
8. Edge-PHF determinations (cream-cheese/whipped cakes, soft fudge, fried cake
   donuts, vegetable-heavy chutneys). (§2)
9. Herbal-tea/herb-blend **wellness claims** (FDA supplement/drug). (§2.7)
10. Home Bakery **license-verification** mechanism. (§2.6)
11. **Live-animal / freezer-share** ("half beef on the hoof") legality. (§4.1)
12. Goat **on-farm religious slaughter-for-money**. (§4.4)
13. **Rabbit** slaughter-for-sale facility-registration path in Ohio. (§4.5)
14. Ohio adoption of both **poultry exemptions** + current retail-license
    expectations. (§4.6)
15. **Farm-raised cervid** (venison/elk) pathway. (§4.7)
16. **Commercial-feed de-minimis** enforcement against micro pet-treat/bakery
    sellers. (§5.1–5.5)
17. **Branded frozen whole-prey** classification as commercial feed. (§5.6)
18. **Feeder-only ornamental fish** vs bait-dealer permit. (§5.9, §6.4)
19. USDA APHIS/**AWA dealer-licensing** thresholds for live rodents/rabbits/poultry.
    (§5.8, §5.11)
20. **Dangerous Wild Animal Act (ORC 935)** / venomous overlay for live reptiles.
    (§5.10)
21. Whether **1533.40** reaches dealers in **preserved** minnows/crayfish; whether
    **leeches** are in scope; the full **prohibited-crayfish/invasive** list;
    interstate live-baitfish **VHS/APHIS** obligations. (§6.4–6.8)
22. Current **EAB/spongy-moth quarantined county lists**; ash kindling/sub-1" chip
    exemption. (§7.1)
23. **Fertilizer micro-seller** de-minimis under ORC 905. (§7.2)
24. **Ohio EPA composting** exempt-vs-Class-IV thresholds; manure/biosolids extra
    licensing. (§7.3)
25. **Occasional home perennial/potted-plant** dealer-license requirement + fee;
    active host quarantines. (§7.7)
26. Full **Ohio dairy licensing** research incl. herdshare status. (§8)

*End of Deliverable 1.*
