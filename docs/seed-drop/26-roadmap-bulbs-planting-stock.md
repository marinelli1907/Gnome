# 26 — Roadmap: Bulbs and Planting Stock Compliance

**Status: NOT IN SEED DROP V1. Blocked pending its own compliance pass.**
Created 2026-08-13 at Daniel's direction, so the garlic exclusion is a tracked
decision rather than an omission.

## Scope

Every product in this class stays out of Seed Drop until cleared separately:

- Garlic (hardneck and softneck)
- Onion sets
- Shallots
- Seed potatoes
- Other bulbs, corms, rhizomes, tubers and planting stock (dahlia, iris,
  asparagus crowns, strawberry crowns, sweet-potato slips, rooted cuttings)

## Why it is a separate pass, not a catalog addition

The V1 research pack ([02-federal-memo.md](02-federal-memo.md),
[04-state-matrix.md](04-state-matrix.md)) answers one question: may Boone
resell **unopened, originally-labeled retail seed packets**. Planting stock is a
different legal object and the answer does not carry over:

1. **The Federal Seed Act mostly does not reach it.** 7 CFR Part 201 governs
   agricultural and vegetable *seed*. Bulbs, tubers and crowns are largely
   outside it — which removes the framework the V1 conclusions were built on
   rather than making the products freer.
2. **Plant-pest and quarantine law reaches it instead.** Living propagative
   material moves under state nursery-stock law and USDA APHIS plant-health
   rules. Several states require a **nursery dealer licence** and/or a
   **phytosanitary certificate** for interstate shipment, and some maintain
   destination-specific quarantines (potato pests, allium white rot, nematodes)
   that have no analogue in packet-seed law.
3. **"Nursery stock" is often defined to include the reseller.** Where seed
   permits attach to *labeling*, nursery-dealer licences frequently attach to
   *selling or distributing* — so the ORC 907.13 negative inference that carries
   the V1 Ohio position may not carry here at all.
4. **Seed potatoes carry their own certification regime**, typically
   certified-seed-only requirements plus origin documentation.
5. **The physical model breaks too.** Bulbs are perishable, temperature- and
   humidity-sensitive, and have planting windows measured in weeks. The
   home-fulfilment posture in [03-ohio-memo.md](03-ohio-memo.md) was scoped to
   shelf-stable sealed packets.

None of the above is a conclusion — it is the reason a conclusion has not been
reached.

## How the exclusion is enforced today

Structural, not editorial. `seed_products.regulatory_class` accepts
`BULB_OR_PLANTING_STOCK`, and `seed_product_sellable_v1()` excludes that class
along with `PROHIBITED`. `seed_ship_state_allowed()` calls it, so such a product
cannot pass eligibility at any checkpoint even if someone lists it. Regression:
`T-PROD-03` in `supabase/tests/seed_drop_phase0_suite.sql`.

## What clearing this class would require

1. A federal memorandum on APHIS/plant-health authority for interstate movement
   of each sub-class, to the same evidence standard as
   [02-federal-memo.md](02-federal-memo.md).
2. An Ohio memorandum on nursery-dealer licensing and inspection (ODA Plant
   Health, a different program from Grain, Feed & Seed).
3. A 48-state nursery-stock matrix — dealer licensing, phytosanitary
   certificates, destination quarantines — defaulting to
   `AGENCY CONFIRMATION REQUIRED`, exactly as the seed matrix did.
4. Supplier credential requirements: nursery-stock licences are usually a
   different credential from a seed-labeler permit, so
   `seed_supplier_credentials.credential_type` gains values here.
5. A cold-chain and planting-window operating spec, plus revised unit economics
   (bulbs are heavier; postage assumptions in
   [16-pricing-economics.md](16-pricing-economics.md) do not transfer).
6. Daniel's explicit approval to open the class, then per-state
   `enabled_for_checkout` flips through the same audited flow.

## Trigger

Revisit after the Ohio pilot is running and the USDA/ODA seed answers are in
hand — not before. Garlic is the most-requested item in this class and is
expected to be the first candidate.
