# 13 — Acceptance Journey: Richmond Heights, OH 44143 · subscribed 2026-08-12

Product lane · **Status: SPECIFICATION ONLY — this is the acceptance scenario the
product spec (12) must satisfy end-to-end.** Ohio-origin fulfillment to an Ohio
destination (intrastate; Ohio memo 03 governs; the state matrix 04 must show OH cleared).

**The customer is fictional.** "Dana" — Richmond Heights, Ohio 44143, two 4×8 raised
beds and a few patio pots, full sun, feeding two people, some gardening experience,
excludes beets. No real address appears anywhere in this journey, matching the spec's
privacy rule (12 §3.4).

## The horticultural ground truth (verified, sourced)

| Fact | Value | Source |
|---|---|---|
| USDA hardiness zone, ZIP 44143 | **6b (−5 to 0 °F)** on the current (2023) USDA Plant Hardiness Zone Map — the Cleveland-area east suburbs moved from 6a on the 2012 map to 6b on the 2023 map | USDA PHZM: https://planthardiness.ars.usda.gov/ (ZIP lookup); corroboration: https://www.plantmaps.com/hardiness-zones-for-richmond-heights-ohio |
| Normal first frost, Cleveland area (Cuyahoga County) | **October 14** (first freeze Oct 28) per NWS Cleveland climatology | https://www.weather.gov/cle/frost_freeze |
| Fall direct-seeding dates for Ohio | leaf lettuce **Aug 1** · kale **Aug 1–15** · radish **Aug 1–15** · spinach **Sep 1** | OSU Extension (Wayne Co.), *Planning and Planting the Garden*: https://wayne.osu.edu/sites/wayne/files/imce/Program_Pages/ANR/Garden/Planning%20and%20Planting%20%20the%20Garden.pdf |
| Fall-garden crop set for Ohio | lettuce, radishes, kale, carrots highlighted for fall growing | OSU Extension, *Extension Today: Fall Planting*: https://extension.osu.edu/today/fall-planting |
| Garlic timing for Ohio | plant **mid-October**; cloves 2" deep, 4–6" apart, rows 12"; fall planting makes larger bulbs; harvest early-to-mid summer | OSU Extension Ohioline HYG-1627, *Growing Garlic in the Garden*: https://ohioline.osu.edu/factsheet/hyg-1627 |
| Warm-season reality check | tomatoes are planted **after the last spring frost** (~May 20 central Ohio) and need 40–50 days just from fruit set to mature green — a mid-August outdoor sowing in zone 6b has no season left | OSU Extension Ohioline HYG-1624, *Growing Tomatoes in the Home Garden*: https://ohioline.osu.edu/factsheet/HYG-1624 |

**Derived planting math for this journey:** a Drop arriving ~Aug 17 leaves ~58 days to
the Oct 14 normal first frost. That supports radish (28 days), arugula (~40), turnip
(~35), lettuce (~50–55, and it tolerates light frost), chard and kale (~55–60; kale
*improves* after light frost), and cilantro (cool-season). It does **not** support
outdoor-started tomatoes, peppers, zucchini, or cucumbers — recommending those in
mid-August as if a full season remained would be a lie, and the engine already prevents
it mechanically: none of them carries August in `sow_months`, so they never enter the
candidate pool (12 §6 check 7).

---

## The seventeen steps

**Timeline variant used below: prompt-ship first Drop** (order generated on approval,
shipped within 2 business days). The wave-aligned alternative is boxed at the end —
which variant V1 uses is Daniel's decision #1 in doc 12 §11.

### 1. Subscription — Wed 2026-08-12, evening

Dana taps "Start my Seed Drop" on gnome.market. A `seed_drop_subscriptions` row is
created `incomplete` (shipped `0067` model). Nothing is charged; nothing is promised yet.

### 2. Drop-size selection

Gnome shows all four sizes with plain descriptions — Patio 4 / Garden 8 / Harvest 12 /
Build Your Drop 4–20 — and **no recommendation yet** (it hasn't earned one; the profile
comes first). Dana can pick now or after the questions; she waits.

### 3. Frequency

Seasonal is presented as the default with the honest pitch: "Seeds when it's time to
plant, not a box for the box's sake." Dana keeps **seasonal**. (Monthly and
every-other-month appear with the volume warnings from doc 14 §3.)

### 4. Garden-profile questions — one at a time

The gnome-onboarding conversational pattern (12 §3.1). Nine turns, each one question:

> **Gnome:** "Where will these seeds grow? Pick everything that applies — in-ground
> garden, raised beds, containers or pots, indoors, a greenhouse, a community garden,
> not sure, or something else."
> **Dana:** *raised beds, containers/pots* (multi-select)
> **Gnome:** "Raised beds AND pots — a gardener after my own heart. How big are the beds?"
> **Dana:** "Two beds, 4 by 8 feet. Maybe five pots."

…and so on through sun (full), experience (some), preferences (salads, herbs),
exclusions (**no beets**), people fed (2), preservation (not this year), interest mix
(vegetables + herbs, mild flower interest), timing ("I'd plant this weekend if I
could"), and control level ("show me before you ship" → **Let Me Approve**).

### 5. Location / shipping validation

ZIP 44143 → geocode → **zone 6b derived**, shown with "adjust if you know better"
(Dana doesn't; it's correct per the 2023 USDA map). Ship-to state **OH** is checked
against the allowlist (04): Ohio-to-Ohio, cleared → proceed. Had Dana typed an Alaska
ZIP, this is the step that says so plainly (12 §8.2 "Unsupported destination") —
before any recommendation, so no promise is ever walked back.

### 6. Personalized recommendation — with the reason, always

> **Gnome:** "Two 4×8 beds is about 64 square feet, plus your pots — full sun, two
> people, and you want to plant *now*. My recommendation: a **Garden Drop — 8 packets**.
> That fills both beds with fall crops without crowding, and mid-August is genuinely
> one of the two best planting moments of the year here in zone 6b. A Homestead Drop (12)
> would mean saving several packets for spring — happy to do that if you'd like more.
> **Your garden, your call.**"

Dana picks **Garden Drop (8)**. The recommendation engine logged its inputs and reason
(12 §5); the choice is hers and is stored as hers.

### 7. Packet-scale explanation

Before approval, each proposed packet shows its "what can this packet grow?" panel
(doc 15): seed count *if the supplier printed one*, expected-plants **range**,
spacing, how much of the packet this planting uses, and the source + confidence of
every number. Where a figure isn't supplied, the panel says so — "Seed count not
supplied by the manufacturer." The panel is explicit that **the original supplier
packet remains the controlling label**: Gnome's panel explains, the packet governs.

### 8. Approval / selection — Let Me Approve in action

The engine (shipped `generate_seed_drop` selection logic — real lots, in-stock,
germination-gated, zone-6b August window, sun-matched, beginner rules N/A, **beets
excluded**) proposes 8 packets from its real August pool. Every packet shows a WHY and
a planting label:

| Packet (supplier label controls) | Label | WHY (customer-facing) |
|---|---|---|
| Radish 'French Breakfast' | **Plant now** | "28 days — you'll be eating these in September. OSU Extension's Ohio calendar backs Aug 1–15 radish sowing." |
| Lettuce 'Buttercrunch' | **Plant now** | "~55 days and it shrugs off light frost. OSU lists Aug 1 for fall lettuce." |
| Arugula 'Rocket' | **Plant now** | "About 40 days; cut-and-come-again into fall." |
| Turnip 'Tokyo Cross' | **Plant now** | "35 days — roots and greens both, well before the Oct 14 average first frost." |
| Kale 'Lacinato' | **Plant now** | "~60 days, and a light frost makes it *sweeter*. Fall is kale's season." |
| Swiss Chard 'Bright Lights' | **Plant now** | "Tolerates a light frost; one sowing carries you to hard freeze." |
| Cilantro 'Santo' | **Plant now** | "Cool fall air is what slow-bolt cilantro wants." |
| Spinach 'Bloomsdale Long Standing' | **Save for another specified window: sow Sep 1–15** | "OSU says September 1 for fall spinach — late-August soil here is still too warm for good germination. Hold it three weeks; it's worth it." |

The spinach line is the fourth label doing real work: the engine's `sow_months` are
month-granular (August is a legal spinach month in the shipped catalog), and the
**label layer refines within-month honesty** using extension guidance.

Gnome also proposed 'Sugar Snap' peas as an alternate and talked Dana *out* of them:
"Aug-planted snap peas here finish around Oct 18 — past the average first frost. They
often squeak through, but I won't sell you 'often.' Spring is their sure bet." Dana
approves the 8 as proposed. **The list is now frozen** — any later change requires her
explicit approval (12 §4.2).

What Dana never saw: tomato, zucchini, cucumber, basil, sunflower, zinnia — all in the
catalog, all excluded from the pool automatically because none is sowable in August in
zone 6b. (Had Dana answered "happy to hold packets," a **Save for spring** zinnia or
basil could be *offered as a labeled future-season packet* — the doc 14 §3 adaptation —
but Dana asked to plant now.)

### 9. Inventory reservation

On approval, the engine reserves: the guarded `UPDATE … WHERE current_qty >= 1` per lot
(race-safe, shipped `0028`), items → `reserved`, ledger rows written. If another
customer had taken the last Buttercrunch lot in the minutes between proposal and
approval, this step fails honestly into "Replacement approval required" — never a
silent swap (12 §8.2).

### 10. Payment

$24.99 seasonal charge (shipped `PAY_PER_SEASON` model; final sized-tier pricing is the
economics lane's, doc 16). Stripe checkout → signed webhook → insert-first idempotency
on the event id → order `paid`. A replayed webhook does nothing twice
(`stripe_session_id UNIQUE`, `stripe_events` — shipped).

### 11. Fulfillment status

Dana's dashboard walks the customer states (12 §8.1): Payment confirmed → Preparing
shipment as the admin queue (`admin_seed_queue`) picks each packet
(`admin_pick_seed_item`) and packs the box (`admin_pack_seed_order`). The box: plain
mailer, 8 sealed original supplier packets, packing slip with shipment ID, the 8-line
packet/lot list, support line, authenticated-QR to her Drop page, the Boone Systems
shipper-info block (contents pending the federal memo, doc 02), and no Ohio-specific
destination notice unless 03/04 require one.

### 12. Tracking — Fri 2026-08-14

`admin_ship_seed_order` (ship-once guard) records carrier + tracking; Dana gets the
"On its way" state with the live link. Intrastate Ohio: 1–3 mail days.

### 13. Delivery confirmation — ~Mon 2026-08-17

Carrier scan (or Dana tapping "It's here") → **Delivered**. Copy: "It's landed. No
rush — every packet says when it wants planting. Your beds have about 8 good weeks
before the average first frost (Oct 14 around Cleveland)."

### 14. Planting guidance

Per packet, the doc 15 panel plus zone-6b timing. **The supplier packet's own
directions remain the controlling instructions; Gnome's guidance supplements and
never contradicts the label.** Honest framing throughout — depth and spacing from the
packet, day counts as estimates, and the mandatory line where relevant: "Harvest
varies with germination, weather, soil, spacing, pests, care, and growing conditions."
Dana plants six packets the weekend of Aug 22–23 and taps "Planted" on each
(`planting_confirmed_at` → **Growing**). Spinach waits, labeled, for Sep 1.

### 15. Germination check-in

Radish germinates in ~5 days, lettuce ~7 (catalog reference values). Around Aug 31,
Gnome asks: "Seeing sprouts? Tell me roughly how many came up." Dana reports radish
"most of them," lettuce "patchy." Gnome's reply stays inside the evidence rules:
patchy fall lettuce germination in warm soil is common (Clemson notes lettuce seed
won't germinate above 95 °F soil; see doc 15 example 2) — "re-sow the gaps this week;
you have time." The report is stored against the **lot**, feeding the owner's real
germination picture (`germination_tests` exists for formal tests; customer reports are
journal data, clearly separated).

### 16. Garden journal

Photos of the beds, a note ("arugula already harvestable Sep 12"), first-harvest
entries. All private, owner-only (12 §7), editable, exportable.

### 17. Feedback into the next Drop

The FALL window closes; Dana's Drop reaches **Completed**. Her journal now informs the
EARLY_SEASON 2027 proposal (shipped window: join cutoff 2027-02-19): the recommendation
engine sees prior-Drop contents (don't duplicate the unplanted spinach if it never went
in), her germination reports, her "loved the arugula" note, and proposes accordingly —
including, at last, those Sugar Snap peas with a **Plant now** label in March, and
basil/zinnia as **Start indoors** / **Save for spring** candidates. The loop is the
product.

---

## Boxed alternative: wave-aligned first Drop

If V1 keeps every Drop on the shipped seasonal wave (`0081`): joining 2026-08-12 beats
the FALL 2026 join cutoff (2026-09-18), generation runs 2026-09-22, and the box ships
2026-09-24 → 10-06, arriving **early October** — a different honest mix, because labels
key to **delivery-date** plantability, not subscription-date:

- **Plant now** (early Oct, zone 6b): garlic if offered (OSU HYG-1627: mid-October is
  *ideal* — but garlic ships as bulbs, not sealed seed packets; Daniel's decision #5),
  spinach for overwintering, quick radish under row cover — a thinner honest list.
- **Save for spring** becomes the majority label: lettuce, peas, chard, kale for March.
- The mid-August "plant this weekend" delight in steps 6–14 is lost.

This trade-off is exactly why first-Drop timing is flagged as Daniel's decision #1
(doc 12 §11): the seasonal wave is operationally calm; the prompt first Drop is a far
better first impression for an August subscriber. Both are honest; the spec supports
either without changing any safeguard.

## Acceptance criteria distilled

The journey passes when: all 17 steps complete with the states of 12 §8; the August
pool contains **only** the crops the OSU calendar supports; tomato/pepper/squash never
appear in an August zone-6b proposal; every packet carries exactly one of the four
labels; the spinach packet demonstrates the "specified window" label; the frozen
approved list survives to the box unchanged (or fails loudly into Replacement approval
required); the packing slip QR exposes nothing without login; and every number shown
to Dana traces to the doc 15 evidence hierarchy.

**Sources:** [USDA Plant Hardiness Zone Map](https://planthardiness.ars.usda.gov/) ·
[Plantmaps — Richmond Heights, OH](https://www.plantmaps.com/hardiness-zones-for-richmond-heights-ohio) ·
[NWS Cleveland frost/freeze climatology](https://www.weather.gov/cle/frost_freeze) ·
[OSU Extension Wayne Co., Planning and Planting the Garden (PDF)](https://wayne.osu.edu/sites/wayne/files/imce/Program_Pages/ANR/Garden/Planning%20and%20Planting%20%20the%20Garden.pdf) ·
[OSU Extension, Fall Planting](https://extension.osu.edu/today/fall-planting) ·
[Ohioline HYG-1627, Growing Garlic in the Garden](https://ohioline.osu.edu/factsheet/hyg-1627) ·
[Ohioline HYG-1624, Growing Tomatoes in the Home Garden](https://ohioline.osu.edu/factsheet/HYG-1624)
