# 14 — Drop Sizes, Frequencies, and Control Modes

Product lane · **Status: SPECIFICATION ONLY.** Pricing is deliberately absent — the
structure below is **pricing-tier-agnostic**, and every dollar figure attached to a size
or frequency comes from the economics lane (doc 16) and the owner's Stripe configuration
(`billing_products` pattern), never from this document or from code.

---

## 1. Sizes (locked structure)

| Size | Packets | Built for |
|---|---|---|
| **Patio Drop** | 4 | pots, windowsills, a small corner |
| **Garden Drop** | 8 | a bed or two — the recommended default for most |
| **Homestead Drop** *(renamed from "Harvest Drop", decided 2026-08-13)* | 12 | big gardens, preservers, sharers |
| **Build Your Drop** | custom **4–20** | people who know exactly what they want |

Mechanics:

- `seed_drop_subscriptions.packet_count` (shipped, currently constrained 1–24) is
  **extended, not replaced**: named sizes pin it to {4, 8, 12}; Build Your Drop allows
  4–20. The database lane (17) owns the constraint change. The legacy Starter (6) maps
  to Build Your Drop 6 for grandfathered orders.
- The count is a **server-enforced entitlement** (12 §6 check 16): no mode, screen, or
  AI suggestion can ship more or fewer packets than the chosen size, and a shortfall
  parks the order in `needs_review` (shipped behavior) rather than under-shipping.
- Build Your Drop floors at 4 because below that, postage dominates and the box
  disappoints — the recommendation engine says this out loud if asked.

## 2. Frequencies

### 2.1 The set

| Frequency | Status | Notes |
|---|---|---|
| **Seasonal** | **Default.** Shipped (`0067` cadence + `0081` season windows) | Up to 4 Drops/year on `seed_season_windows`; matches planting reality and sealed-packet inventory. |
| **Every-other-month** | V1 extension (new cadence value) | ~6/year; only sensible with the §3 adaptations active. |
| **Monthly** | V1 extension (cadence value exists in `0067`; volume rules below are mandatory) | ~12/year; §3 governs or it becomes a seed-hoarding machine. |
| **One-time** | Shipped (the `0028` one-time `seed_orders` path) | A single Drop, any size; the natural gift and trial shape. |

Every frequency rides the same engine, the same eligibility checklist (12 §6), and the
same fulfillment lanes. Frequency changes **what the calendar does**, never what the
safeguards do.

### 2.2 Change cutoffs (size and frequency)

The fulfillment cycle has one hard line, already shipped for seasonal: the window's
`generation_date` (orders + reservations are created; `admin_seed_wave_generate`).
Generalized:

- **Size or frequency changes take effect on the next uncommitted cycle.** A change
  submitted **before** the cycle's generation moment applies to that cycle; **after**
  generation, it applies to the following one. The UI always states which Drop the
  change touches ("This applies to your Spring Drop, not the one being packed now").
- For monthly/every-other-month cadences the generation moment is the cycle's
  generation date (database lane defines it relative to ship date; recommended:
  generation T−5 days, mirroring the FALL 2026 spacing of cutoff → generate → ship).
- **Seasonal joins keep the shipped rule** (`seed_sub_next_window`): join on/before
  `join_cutoff` → this season; after → next season. No rushed late boxes, ever
  (FALL 2026: cutoff 2026-09-18).
- An **approved-but-unpaid** Drop (Let Me Approve flow) is committed content: size
  changes can't touch it; the customer can cancel it outright (releasing the
  reservation) and rebuild.

### 2.3 Reservation holds

Approval modes hold inventory between proposal and payment. Two legal designs —
propose-without-reserving (stock risk at approval) vs short-hold reservation with
expiry (fairness risk if holds are long). Spec requirement either way: **holds expire
automatically** (12 §8.2 "Reservation expired"), expiry releases stock via the shipped
`release_seed_drop_items`, and the customer is told warmly, not punished. The choice
is Daniel's decision #4 (12 §11); recommended default: 48-hour hold.

## 3. Monthly reality check — the adaptations

Honest math: a Garden Drop monthly is 96 packets/year. Almost nobody plants 96 packets
well, and zone 6b has roughly two sowing pulses (spring, late summer) plus an indoor
window. **If monthly (or every-other-month) is offered, ALL of the following
adaptations are in force** — they're what keeps the cadence honest:

1. **Smaller selections** — monthly recommends Patio (4); the recommendation engine
   warns before allowing Garden+ monthly, then respects the choice.
2. **Storage planning** — every Drop includes storage guidance (cool, dark, dry;
   packet-level storage life per doc 15) so held packets stay viable.
3. **Seasonal packets** — in-season months lean **Plant now**; the calendar, not the
   subscription clock, decides content.
4. **Flowers and herbs** — off-pulse months draw on successive herbs, cut-flowers, and
   pollinator packets where the window genuinely supports them.
5. **Customer pauses** — pausing is one tap, suggested proactively ("Your beds are
   full. Want me to skip until spring?"). A pause is never friction.
6. **Future-season packets** — clearly labeled **Save for spring** / **Save for
   another specified window** packets are legitimate monthly content *only when the
   customer opted into holding* (the 12 §3.2 timing question).
7. **Reduced frequency** — Gnome recommends dropping to every-other-month or seasonal
   when the journal shows unplanted backlog; recommendation only, customer decides.
8. **Add-ons instead** — when a month has nothing honest to send, the right offer is a
   small add-on to the next real Drop — or nothing. **Skipping a month Gnome can't
   fill honestly beats shipping filler.** A skipped month is never charged.

Cutoffs for monthly changes follow §2.2. If these adaptations feel heavier than the
cadence is worth, defer monthly at launch — Daniel's decision #3 (12 §11); the spec is
complete either way.

## 4. Naming: evaluation and recommendation

House voice: warm, neighborly, plain-spoken garden-gnome; existing plans are
**Neighbor / Grower / Farm** — short, concrete, people-and-place words with a natural
size progression. Against that bar:

| Provisional | Verdict | Reasoning |
|---|---|---|
| **Patio Drop (4)** | **Keep** | Concrete place word; instantly self-sizing; sits perfectly beside Neighbor/Grower/Farm. |
| **Garden Drop (8)** | **Keep** | Same virtues; the obvious middle. |
| **Harvest Drop (12)** | **RENAMED to "Homestead Drop" — Daniel approved 2026-08-13** | Two problems: (a) *Harvest* quietly promises an outcome, and doc 15's first commandment is that Gnome never promises harvest — the product's biggest box shouldn't have the word we refuse to guarantee; (b) Patio→Garden are *places you grow*, Harvest is a *result*, breaking the ladder. **Homestead** restores the place progression (patio → garden → homestead), matches the Neighbor/Grower/Farm register, and implies scale without promising outcomes. |
| **Build Your Drop (4–20)** | **Keep** | Plain-spoken, verb-first, says exactly what it is. Second choice "Your Drop, Your Way" is warmer but vaguer; not recommended. |

The 4 / 8 / 12 / custom 4–20 **structure is locked and untouched** by any rename.
Final naming is Daniel's decision #2 (12 §11).

## 5. Pause / skip / cancel semantics

| Action | Effective when | Money (policy lane owns refunds) | Reservations |
|---|---|---|---|
| **Pause** | Immediately for all *future* cycles; the in-flight committed Drop completes. Shipped guard: user transitions active⇄paused are theirs to make (`seed_sub_guard`, `0067`). No auto-resume; Gnome nudges before each window's cutoff. | Nothing is charged while paused. No refund arises — paused cycles simply don't bill. | None held while paused. |
| **Skip** | Per-cycle. Seasonal: shipped `skip_season_window` — allowed until the window's `generation_date`, recorded in `seed_sub_season_skips`, idempotent, double-generation impossible (`seed_orders_window_user_uq`). Monthly cadences: same rule against the cycle's generation date (shipped `skip_next_seed_order` pattern). | A skipped cycle is never charged. Skips are never counted as shipped Drops. | Never created for skipped cycles. |
| **Cancel** | Subscription ends now; the committed in-flight Drop either completes (if paid) or is cancelled with its reservation released. Status change only — history, journal, ledger survive forever (shipped posture). | Future cycles: never billed. In-flight paid-but-unshipped: refund per the policy lane (doc 20); this spec's rule is only that *whatever the policy says happens automatically and is stated before the customer confirms*. | Released via `release_seed_drop_items` for any uncompleted order; stock returns to the shelf same-transaction. |

Copy rule for all three: zero guilt. "Your garden, your pace. Everything's saved for
whenever you're back."

## 6. The recommendation-vs-choice invariant, bluntly

**Gnome recommends. The customer decides. Always.**

- The recommendation engine (12 §5) may pre-highlight a size, cadence, or packet — with
  its reasons shown — and may argue once, honestly, against a choice it considers a
  mistake. Then it yields.
- No flow may default-submit a recommendation, hide the other options, or require a
  justification to deviate. Changing away from the recommendation is never more taps
  than accepting it.
- The one thing choice can never override is the safety layer: **no choice bypasses
  inventory, destination restrictions, entitlements, packet counts, eligibility,
  capacity, or compliance** (12 §4). Gnome never dictates taste; the checklist never
  negotiates facts. Both halves are the product.
