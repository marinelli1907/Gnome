# 15 — "What Can This Packet Grow?" Specification

Product lane · **Status: SPECIFICATION ONLY.** This is the honesty engine of Seed Drop:
the panel every packet gets on the dashboard (12 §7), in approval flows (12 §4), and in
planting guidance (journey step 14). Its one rule: **every number has a source, every
estimate has a confidence, and anything unsupported says so instead of guessing.**

The **original supplier packet remains the controlling label** in every case. This
panel explains; it never overrides, contradicts, or restates label claims as Gnome's own.

---

## 1. The evidence hierarchy (verbatim, in force for every number)

1. **Original supplier packet**
2. **Supplier official documentation**
3. **University extension**
4. **USDA / state guidance**
5. **Clearly-labeled calculated estimate from verified inputs**

Lower-numbered sources beat higher-numbered ones. A Tier-5 calculation may only be
built from inputs that are themselves Tier 1–4 (e.g., seeds-per-gram from a supplier
chart × net weight from the packet), and is always labeled as calculated. One
adjacent case: **Gnome's own lot data** (`germination_tests`, `seed_lots` — shipped
`0028`) is measured fact, not an estimate; it displays with its test date and outranks
any assumption, but never overrides what the packet itself prints.

## 2. Mandatory honest fallbacks (exact strings)

- When no seed count is printed or supplier-documented:
  **"Seed count not supplied by the manufacturer."**
- On every panel that discusses outcomes:
  **"Harvest varies with germination, weather, soil, spacing, pests, care, and growing
  conditions."**

**Never promise 30 seeds → 30 plants. Never promise a guaranteed harvest.** Expected
plants are always a **range**; harvest quantities appear **only** when a Tier 1–4
source supports them, and always as a range with the harvest-varies line beside it.

## 3. Display fields

Every field carries its **source tier + confidence (HIGH / MEDIUM / LOW)**. Fields with
no supportable value render their honest fallback or are omitted with a stated reason —
never silently filled.

| # | Field | Rules |
|---|---|---|
| 1 | Exact supplier packet name | Verbatim from the packet (Tier 1) |
| 2 | Brand / supplier | Tier 1; matches `seed_lots.supplier` records |
| 3 | Kind (crop) | Tier 1 |
| 4 | Variety | Tier 1 |
| 5 | Net weight **or** seed count | **Only when supplied** (packet or supplier doc). Otherwise the seed-count fallback string |
| 6 | Approximate seed count | **Only when supportable** — Tier 2 seeds-per-weight × Tier 1 net weight = labeled Tier 5 calculation with source + confidence shown |
| 7 | Germination % + test date | **When available**: packet-printed (Tier 1) or Gnome lot test (`germination_tests`, with date). Untested: "not yet tested" |
| 8 | Expected successful plants | Always a **RANGE**, derived from count × germination × a stated establishment discount; tier-labeled; never count = plants |
| 9 | Recommended plants for *this customer's* space | From profile dimensions + spacing (Tier 3/4); the "you need 4, not 25" line |
| 10 | Plant / row spacing | Tier 1 first; Tier 3 extension when the packet is silent |
| 11 | Container suitability + minimum size | Tier-labeled; ties to profile growing spaces |
| 12 | Approximate square footage this planting uses | Tier 5 calculation from spacing (shown) |
| 13 | Thinning needed? | Tier 1/3 |
| 14 | Succession sowing sensible? | Tier 3 |
| 15 | How much to plant now vs save | Recommendation from fields 8–9 vs space; always framed as advice |
| 16 | Storage life under proper conditions | Tier 3/4 (extension viability tables); "under cool, dark, dry storage" wording required |
| 17 | Expected harvest type | What you get (leaves, roots, fruit, flowers) — Tier 1/3 |
| 18 | Approximate harvest range | **Only when a Tier 1–4 source supports it**; otherwise omitted with "no supported source." Never bare numbers |
| 19 | Planting label | Exactly one of **Plant now / Start indoors / Save for spring / Save for another specified window** (window stated), computed from zone + calendar + delivery date (12 §1, journey step 8) |
| 20 | Source + confidence, per estimate | The footer that makes the panel auditable |

Data model note (database lane, 17): `seed_products` already carries spacing, depth,
days-to-maturity, and reference `packet_seed_count` (shipped `0028`); V1 needs
per-field **source + confidence** records and per-lot label-data capture at receiving
(08 packet-acceptance checklist) — extension, not replacement.

## 4. AI rules

- AI may **draft** the customer-facing sentences — tone, ordering, warmth.
- **Every number in the draft must come from the hierarchy** — the panel's data layer
  hands the AI resolved values; the AI never computes, recalls, or invents one.
- **AI never fills missing regulatory, label, germination, or lot data.** Missing
  required data → the field shows its fallback / "unavailable" and the packet or panel
  enters **REVIEW_REQUIRED** for a human (the shipped `needs_review` posture, applied
  to content).
- Same division of labor as everywhere in Gnome: the deterministic layer is the source
  of truth; AI explains and coaches (shipped `0028` architecture principle).

## 5. Worked examples

Brands below are **fictional** ("Example Seed Co.") — the field structure, not the
brand, is what's being specified. Horticultural figures are real and cited.

### Example 1 — Tomato packet (spring context)

> **Example Seed Co. — Tomato, 'Roma VF' — 30 seeds**

| Field | Value | Source · confidence |
|---|---|---|
| Seed count | 30 (printed) | Tier 1 · HIGH |
| Germination | 85%, tested 03/2026 (printed) | Tier 1 · HIGH |
| Expected successful plants | **roughly 18–25 seedlings** if all 30 are started (30 × 85% germ, minus normal damping-off/transplant losses — stated discount) — *not 30* | Tier 5 calc from Tier 1 inputs · MEDIUM |
| Recommended for your space (4×8 bed) | **3–4 staked plants** — staked tomatoes want 2 ft in-row, 3–4 ft between rows | Tier 3: OSU Extension HYG-1624 · HIGH |
| How much to plant now vs save | Start **6–8 seeds**, keep the best 3–4 plants; save the rest of the packet | Derived from above · MEDIUM |
| Spacing | staked 2 ft in-row / 3–4 ft rows; caged 2.5–3 ft | Tier 3: HYG-1624 · HIGH |
| Container | Suitable in large containers — minimum size: *no supported figure on file* → shown as "large container; ask Gnome" pending a Tier 1–4 source | REVIEW_REQUIRED example |
| Sq ft used | ~24–32 sq ft for 4 staked plants (calc from spacing) | Tier 5 · MEDIUM |
| Thinning / succession | Thin to strongest seedling per cell; succession not typical | Tier 3 · MEDIUM |
| Storage life | ~4 years, cool-dark-dry | Tier 3: Illinois Extension seed-viability table (https://extension.illinois.edu/sites/default/files/seed_viability.pdf) · MEDIUM (published tables range 4–6) |
| Harvest type | Paste-type fruit | Tier 1 · HIGH |
| Approximate harvest range | **8–10 lb or more per staked plant** under good conditions | Tier 3: HYG-1624 · MEDIUM |
| Label (delivered in April, zone 6b) | **Start indoors** — plant out after the last spring frost (~May 20 for central Ohio per HYG-1624; adjusted for the customer's zone) | Tier 3 · HIGH |

*"Harvest varies with germination, weather, soil, spacing, pests, care, and growing
conditions."*

### Example 2 — Lettuce packet (the journey's fall context)

> **Example Seed Co. — Lettuce, 'Buttercrunch' — net wt 1 g** (no count printed)

| Field | Value | Source · confidence |
|---|---|---|
| Seed count | **"Seed count not supplied by the manufacturer."** | mandatory fallback |
| Approximate seed count | ~700–900 seeds (supplier's seeds-per-gram chart × printed net weight — clearly-labeled calculation) | Tier 5 from Tier 2 + Tier 1 inputs · LOW |
| Germination | 88%, Gnome lot test 2026-06-15 | lot data (`germination_tests`) · HIGH |
| Expected successful plants | far more than any home garden needs — plan by *space*, not by count | honest framing · — |
| Recommended for your space | **10–12 plants now**: sow ¼" deep, thin to 6–10" apart in the row, rows 1–2 ft | Tier 3: Clemson HGIC, *Lettuce* (https://hgic.clemson.edu/factsheet/lettuce/) · HIGH |
| Plant now vs save | Sow a few feet of row now, again in 2 weeks (succession); the packet holds several seasons of sowings | Tier 3 · MEDIUM |
| Container | Yes — shallow, wide pots work; catalog flags it container-friendly | Tier 3 / catalog · MEDIUM |
| Sq ft used | ~5–6 sq ft for 12 plants at ~8" | Tier 5 calc · MEDIUM |
| Thinning | Yes — thin when plants are 1–2 in tall; thinnings are salad | Tier 3: Clemson HGIC · HIGH |
| Fall notes | Withstands light frost; survives to ~28 °F under row cover; seed won't germinate above 95 °F soil — why patchy August germination happens (journey step 15) | Tier 3: Clemson HGIC · HIGH |
| Storage life | ~5 years, cool-dark-dry (published tables range 4–6) | Tier 3: Illinois Extension viability table · MEDIUM |
| Harvest type | Loose butterhead leaves/heads | Tier 1 · HIGH |
| Approximate harvest range | omitted — **no supported per-plant weight source on file** | honest omission |
| Label (delivered mid-August, zone 6b) | **Plant now** — OSU's Ohio calendar backs Aug 1 fall lettuce sowing | Tier 3: OSU Extension (Wayne Co. planting calendar) · HIGH |

*"Harvest varies with germination, weather, soil, spacing, pests, care, and growing
conditions."*

### Example 3 — Basil packet (fall delivery, saved for spring)

> **Example Seed Co. — Basil, 'Genovese' — 70 seeds** (no germination % printed; lot not yet tested)

| Field | Value | Source · confidence |
|---|---|---|
| Seed count | 70 (printed) | Tier 1 · HIGH |
| Germination | **not yet tested — no rate printed or on file.** Fresh-untested lots remain sellable under the shipped ≥70%-or-fresh rule (`seed_lot_eligible`), but no germination *number* is displayed, because none exists | honest gap · — |
| Expected successful plants | shown as guidance only, no numeric range (no germination input to calculate from): "start 8–12 seeds; a household usually wants 2–4 plants" | REVIEW_REQUIRED for numeric range · — |
| Recommended for your space | 2–4 plants in pots or bed edge; thin/transplant to 6–12 in apart | Tier 3: UMN Extension, *Growing basil* (https://extension.umn.edu/vegetables/growing-basil) · HIGH |
| Sowing | cover with ¼ in of soil; germinates in 5–7 days | Tier 3: UMN · HIGH |
| Start indoors | sow indoors 6–8 weeks before planting outside | Tier 3: UMN · HIGH |
| Container | Yes — catalog flags container-friendly; needs 6–8 h bright light | Tier 3: UMN · MEDIUM |
| Sq ft used | ~2–4 sq ft for 4 plants | Tier 5 calc · MEDIUM |
| Thinning / succession | Thin after true leaves; pinch to delay flowering (flowering turns leaves bitter and cuts yield) | Tier 3: UMN/USU basil guidance · MEDIUM |
| Plant now vs save | **None now** (fall delivery): tender annual, killed by frost, won't survive winter outdoors in zone 6b | Tier 3: UMN · HIGH |
| Storage life | ~3–5 years, cool-dark-dry (herb tables vary; low end conservative) | Tier 3 viability tables · LOW-MEDIUM |
| Harvest type | Fresh leaves, cut-and-come-again from ~6–8 leaves per stem | Tier 3: USU basil guidance (https://extension.usu.edu/yardandgarden/research/basil-in-the-garden) · MEDIUM |
| Approximate harvest range | omitted — no supported source | honest omission |
| Label (delivered mid-August, zone 6b) | **Save for spring** — start indoors ~late March–April, plant out after frost danger passes | Tier 3 · HIGH |

*"Harvest varies with germination, weather, soil, spacing, pests, care, and growing
conditions."*

## 6. What the three examples deliberately demonstrate

1. Tier-1 packet data always wins and is quoted verbatim (tomato count/germ).
2. The seed-count fallback string and a properly-labeled Tier-5 calculation living
   side by side (lettuce).
3. Lot-test germination shown with its date (lettuce) vs the honest "not yet tested"
   gap with **no** invented number (basil).
4. Expected plants as ranges with stated discounts — and suppressed entirely when the
   inputs don't exist (basil).
5. Harvest ranges only where a Tier-3 source exists (tomato: OSU's 8–10 lb) and
   honestly omitted where none does (lettuce, basil).
6. REVIEW_REQUIRED as a normal, visible state, not an error (tomato container size).
7. All four planting labels exercised across docs 13 and 15 (Plant now · Start
   indoors · Save for spring · Save for another specified window — the journey's
   September spinach).
