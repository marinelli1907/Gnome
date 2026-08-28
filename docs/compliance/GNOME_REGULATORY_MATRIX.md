# Gnome Regulatory Matrix

Checked: 2026-08-24
Scope: Federal baseline plus Ohio-first launch model.
Status: Research matrix for Boone Systems review. Not legal advice.

## Rule for Publication

If law or Gnome policy requires seller/product verification, Gnome should allow drafting but block public publication until the requirement is satisfied. Unknown high-risk combinations should fail closed.

Server-side enforcement already exists conceptually:

- Rules live in `compliance_rules`.
- Credentials live in `seller_credentials`.
- Documents live in private `compliance-docs`.
- `can_publish_in_node` evaluates seller credentials and rule data.
- `listings_enforce_compliance` runs on active listing insert/update.

The remaining launch question is rule-data coverage and legal validation, not whether the app can theoretically gate.

## Current Taxonomy Families

Migration `0040_marketplace_taxonomy_seed.sql` seeds about 308 nodes. Top-level active roots include: Vegetables, Fruit, Herbs, Meat, Eggs, Honey & Syrups, Baked Goods, Preserves & Pantry, Seeds, Plants, Pet, Fishing & Bait, Flowers, Garden Goods, and Wood / Firewood.

## Federal Baseline

| Family | Federal issue | Gnome action |
|---|---|---|
| Whole raw produce | FSMA Produce Safety Rule may apply to farms over thresholds; some farms exempt/qualified exempt. Sprouts have special high-risk requirements. | Allow ordinary backyard whole produce with attestation; flag sprouts/microgreens for review. |
| Cut produce/prepared meals | Processing can leave farm/raw-produce exemption; FDA/state retail food rules may apply. | Block unless licensed/verified. |
| Acidified/low-acid canned foods | FDA rules cover acidified and low-acid canned foods under 21 CFR 108/113/114. | Block home-canned pickles, salsa, canned vegetables unless licensed/verified. |
| Meat | USDA/FSIS or state-equivalent inspection generally required for meat sold in commerce; custom exempt meat is not for sale. | Verify inspected source and labeling; otherwise block. |
| Poultry | Federal poultry exemptions exist but are narrow and state-dependent. | Ohio legal review required before allowing; default verify/block. |
| Eggs | Federal/state labeling and refrigeration rules; state small-flock rules matter. | Ohio matrix controls. |
| Dairy/raw milk | Pasteurized dairy regulated; raw milk sale often restricted/prohibited by state. | Block raw milk for human consumption in Ohio unless counsel says otherwise. |
| Seeds | Federal Seed Act may apply in interstate commerce; state seed labeling/permit rules apply. | Ohio seed labeler/label compliance required for self-labeled seed. |
| Plants/nursery stock | USDA APHIS and state plant health rules; interstate shipment can require certificates/quarantine compliance. | Local pickup/in-state default; verify nursery/dealer credential for regulated plants. |
| Pet food/feed | FDA/state commercial feed registration/labeling. | Verify or block. |
| Claims | Organic, health, pesticide, supplement, medical, disease-treatment claims trigger extra federal/state rules. | Ban unverified medical/health/legal claims in listings. |

Federal sources checked:

- FDA FSMA Produce Safety Rule: <https://www.fda.gov/food/food-safety-modernization-act-fsma/fsma-final-rule-produce-safety>
- 21 CFR Part 112: <https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-112>
- FDA acidified/low-acid canned foods: <https://www.fda.gov/food/registration-food-facilities-and-other-submissions/establishment-registration-process-filing-acidified-and-low-acid-canned-foods-lacf>
- 21 CFR Part 114: <https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-114>
- USDA FSIS poultry exemptions: <https://www.fsis.usda.gov/guidelines/2010-0006>
- USDA FSIS retail exemption limits: <https://www.fsis.usda.gov/policy/federal-register-rulemaking/federal-register-notices/retail-exemptions-adjusted-dollar-8>

## Launch Matrix

| Product family | Federal risk | Ohio/local risk | Launch status | Gnome action |
|---|---|---|---|---|
| Whole raw produce | Low for small local sellers; FSMA thresholds for farms | Farm-market/RFE exemptions may apply | Allow | Attest whole/uncut/unprocessed; no medical/organic claims unless verified |
| Cut produce | FDA/state retail food risk | RFE/food service likely | Block | Require licensed facility before publication |
| Sprouts | FDA high-risk produce | High | Research required | Fail closed pending expert review |
| Microgreens | Produce/retail food line can vary | Local health view may matter | Allow with conditions | Attest grown/cut/packaged safely; no TCS/prepared-food claims; review if processed |
| Eggs | State-specific | Ohio small egg rules, refrigeration/labels | Allow with conditions | Local pickup, refrigeration, label attestation; verify if off-farm/retail channel |
| Honey raw/comb/creamed | Low if single ingredient | Ohio beekeeper exemption | Allow | Attest 75% own hives, label fields |
| Infused honey | Cottage-food/ingredient label | Ohio cottage-food scope | Allow with conditions | Cottage-food label attestation, Ohio-only |
| Non-TCS baked goods | Cottage-food | Ohio CFPO label rules | Allow with conditions | Cottage-food label fields, allergen/ingredient disclosure |
| Refrigerated/cream/custard baked goods | TCS food | Home Bakery/license | Verify seller | Require Home Bakery or licensed facility |
| Jams/jellies/fruit preserves | Cottage-food if allowed product | Ohio label rules | Allow with conditions | Cottage-food label and Ohio-only |
| Pickles/salsa/acidified sauces | FDA acidified foods | Not ordinary cottage food | Verify/block | Licensed process/facility required |
| Fermented foods | Food safety process risk | Unclear by product | Research required | Fail closed outside clearly allowed products |
| Prepared meals/frozen meals | High | RFE/food service | Block | Licensed kitchen/RFE required |
| Meat/beef/pork/lamb | FSIS/state inspection | ODA meat inspection | Verify seller | Require inspected product/source; block custom-exempt/not-for-sale |
| Poultry/rabbit | Exemptions complex | Ohio confirmation needed | Research required | Fail closed pending ODA/counsel review |
| Seafood/shellfish | High | State/federal traceability | Block | Do not launch |
| Dairy/cheese | Regulated | ODA dairy licensing | Verify/block | Pasteurized/licensed only |
| Raw milk | High | Ohio generally prohibits direct retail human-consumption sale per current public agency/news reporting; counsel required | Block | No raw milk listings |
| Cultivated mushrooms | Produce/food safety | Likely local/label considerations | Allow with conditions | Cultivated only, no wild/foraged; safe handling attestation |
| Wild mushrooms/foraged food | Poisoning risk | Expert ID/local rules | Block | Do not launch |
| Maple syrup | Ohio small processor exemption | Label rules | Allow with conditions | Attest 75% own sap and labeling |
| Seeds | Federal/state seed law | Ohio seed labeler permit if labeling seed | Verify/conditions | Reseller sealed packets allowed with attestation; self-labeled seed requires permit |
| Nursery stock/live plants | APHIS/interstate risk | Ohio nursery/dealer certificate/license | Verify seller | Require ODA nursery/dealer credential for regulated plants |
| Seedlings/annual starts | Ambiguous Ohio "hardy" boundary | Needs ODA confirmation | Research required | Allow only with seller attestation or fail closed for launch |
| Pet food/treats | Feed/pet-food registration/labeling | ODA feed rules | Verify/block | Require registration/label proof |
| Animal feed | Commercial feed | ODA feed rules | Verify/block | Require registration; block homemade unregistered |
| Live bait | Wildlife/aquaculture rules | ODNR/ODA | Research required | Fail closed unless permit verified |
| Firewood | Pest/quarantine rules | ODA/APHIS movement restrictions | Allow with conditions | Local-only, no quarantine-area movement claims |

## Professional Review Required

Attorney/regulatory expert review is required before enabling: meat, poultry, rabbit, raw milk/dairy, cheese, seafood/shellfish, acidified/canned foods, prepared meals, wild mushrooms/foraged foods, pet food/feed, bait, interstate plant shipment, nursery stock, self-labeled seeds, any CBD/cannabis/tobacco/alcohol-adjacent item.

## Coverage Model for 50 States + DC

Use a status field per state/category:

- `FULL`: primary-source matrix complete, attorney/regulator reviewed, server rule active.
- `PARTIAL`: research exists but has open questions; allow only low-risk products.
- `UNRESEARCHED`: fail closed for regulated categories.

Ohio is `PARTIAL` today. No other state should be represented as complete.
