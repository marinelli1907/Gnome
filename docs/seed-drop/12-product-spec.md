# 12 — Seed Drop V1 Product Specification

Product lane · Assembled 2026-08-13 for Boone Systems LLC / Gnome Farmers Market.
**Status: SPECIFICATION ONLY. Nothing here is deployed, migrated, or enabled.**
Companion documents: [13 — Richmond Heights journey](13-richmond-heights-journey.md) ·
[14 — Drop structure](14-drop-structure.md) · [15 — Packet-scale spec](15-packet-scale-spec.md).
Compliance authority: 02 (federal memo), 03 (Ohio memo), 04 (state matrix — **allowlist**),
08–11 (procedures). Prices: 16 (economics lane). Exact DDL: 17 (database lane) — this
document names the tables and RPCs that need extension but writes no SQL.

---

## 1. Overview and goals

Seed Drop V1 turns the existing, live Seed Drop engine into a customer-sized product:
a personalized box of **unopened, original supplier-labeled seed packets**, matched to a
real person's real garden, real hardiness zone, and the real contents of Gnome's inventory
shelf — never to a fantasy of any of those.

Goals, in priority order:

1. **Never lie to a customer.** No promised packet Gnome doesn't physically hold; no
   crop recommendation the customer's zone and calendar can't support; no yield claim
   the evidence hierarchy (doc 15) can't back.
2. **Customer chooses, Gnome recommends.** Drop size, frequency, and control mode are
   the customer's decisions. Gnome's recommendation engine is advisory only and always
   shows its reasons. (Locked decision — restated bluntly in doc 14 §5.)
3. **The backend stays the source of truth.** Every safeguard already live in the
   deterministic engine is preserved and extended, never bypassed (see §6). The AI
   layer drafts words; it never selects stock, fills label data, or overrides a check.
4. **Every packet leaves with a plan.** Each packet is clearly marked for the customer
   as exactly one of: **Plant now** / **Start indoors** / **Save for spring** /
   **Save for another specified window** (with the window stated). (Locked decision.)
5. **Capacity is protected by configuration, not code deploys** (§10), because this is
   a one-location Ohio fulfillment operation run at part-time velocity.

### 1.1 What V1 builds on (implementation inventory)

The spec **extends** the shipped system; it does not restart it. The load-bearing pieces,
by migration:

| Shipped piece | Where | What V1 does with it |
|---|---|---|
| `seed_products`, `seed_lots`, `germination_tests`, `seed_inventory_log` | `0028_seed_drop_v1.sql` (+ SKU/supplier/storage extensions in `0077`) | **Keep.** Extend `seed_products` with per-packet destination restrictions and planting-label metadata. |
| `seed_lot_eligible()` quality gate | `0028` | **Keep verbatim** (in-stock ≥ 1, packet-unit, no `quarantined`/`failed` lots, germination ≥ 70% or eligible fresh-untested, retest `next_review_date` not overdue). |
| `generate_seed_drop()` deterministic engine | `0028`, multi-space rule in `0030_seed_multi_size.sql` | **Keep as the only selector.** Extend with: destination-restriction filter, capacity gates, sized packet counts, and a propose-without-reserving path for approval modes (§4). |
| Race-safe reservation (guarded `UPDATE … WHERE current_qty >= 1`) + `release_seed_drop_items()` | `0028` | **Keep verbatim.** Add reservation expiry for approval/checkout holds (§8). |
| `seed_profiles` incl. multi-select `garden_sizes[]` | `0028`, `0030` | **Extend** with the full V1 question set (§3). |
| `seed_orders` / `seed_order_items` (incl. `substituted_from`, `substitution_reason`, `planting_confirmed_at`) | `0028`, `picked` status in `0077` | **Keep.** Customer-facing states become a presentation layer plus a few new tracked facts (§8). |
| `seed_drop_subscriptions` + `seed_sub_guard` transition trigger + `skip_next_seed_order` + `generate_seed_subscription_order` | `0067_seed_drop_subscriptions.sql`, snapshot fix `0070_seed_sub_snapshot_fix.sql` | **Extend**: size presets 4/8/12/custom 4–20, control mode, auto-substitution opt-in, added cadences (doc 14). |
| Seasonal commercial model: `seed_season_windows` (FALL 2026 join cutoff 2026-09-18 → join later, get next season), `seed_sub_season_skips`, `seed_sub_next_window`, `skip_season_window`, `admin_seed_wave_preview` / `admin_seed_wave_generate` (double-generation impossible via the `seed_orders_window_user_uq` partial unique index), `admin_set_seed_order_costs`, `admin_seed_economics`, **$24.99/season `PAY_PER_SEASON`** (`price_cents` 2499; `billing_products.GNOME_SEED_DROP_SEASONAL`) | `0081_commercial_model.sql` | **Keep as the seasonal backbone.** Sized drops ride the same windows and waves. |
| Fulfillment lanes: `admin_pick_seed_item` → `admin_pack_seed_order` → `admin_ship_seed_order` (ship-once guard), `admin_seed_queue`, permission family `seed_drop.*` / `inventory.*` | `0077_inventory_fulfillment_boardroom.sql` | **Keep.** §8's customer states map onto these. |
| Stripe webhook idempotency: insert-first on `stripe_events(event.id)`; `seed_orders.stripe_session_id UNIQUE`; `billing_pay_seed_seasonal` | `supabase/functions/stripe-webhook/index.ts` | **Keep verbatim.** All V1 payment effects run through it. |
| Conversational onboarding pattern (model returns structured JSON; a SECURITY DEFINER RPC re-validates every field; the model never writes; always skippable; plain-form fallback) | `supabase/functions/gnome-onboarding/index.ts` | **Reuse the exact pattern** for the garden-profile conversation (§3). |
| ZIP → zone derivation with user correction | `web/app/seeds/SeedProfileClient.tsx` | **Keep** (zone is derived, never dictated — §3.3). |

Anything not in this table that V1 needs is **new** and belongs to the database lane
(17): capacity-limit config rows, waitlist, approval/substitution-approval records,
checkout reservation expiry, delivery confirmation, and the garden journal tables
(plantings, germination check-ins, photos, harvest notes).

---

## 2. Product shape (summary — full detail in doc 14)

- **Sizes (customer's choice):** Patio Drop **4** packets · Garden Drop **8** ·
  Harvest Drop **12** · Build Your Drop **custom 4–20**. Names are provisional;
  doc 14 §4 evaluates them against Gnome's voice and recommends one rename while
  preserving the locked 4/8/12/custom structure.
- **Frequencies:** seasonal (**default**, matches `seed_season_windows`), every-other-month,
  monthly (with the volume adaptations in doc 14 §3), and one-time; plus pause / skip /
  cancel. Change-cutoff rules in doc 14 §2–3.
- **Control modes:** Surprise Me · Let Me Approve · Build It With Me · Choose For Me
  Then Add More (§4).
- **Price:** set by the economics lane (16). The shipped default is $24.99/season
  `PAY_PER_SEASON`; sized tiers must not hard-code prices anywhere in product copy or code.

---

## 3. Onboarding and the garden profile

### 3.1 Conversational, one question at a time

The garden profile is collected the same way Gnome already welcomes a new neighbor —
the `gnome-onboarding` pattern, reused wholesale:

- The gnome asks **one question per turn**, acknowledges the answer, and never re-asks
  anything already collected.
- The model returns **structured JSON only**; a SECURITY DEFINER RPC re-validates every
  field server-side. A hallucinated or injected value can become a rejected value,
  never a write. **The model never writes.**
- If AI is paused or unconfigured, the flow **degrades to a plain form** that calls the
  same RPC. The conversation is **always skippable** — never trap someone in a chat.
- Tone: warm, neighborly, plain-spoken. No jargon, no pressure, no emoji spam.

### 3.2 The full question list (in order)

1. **Name / identity** — usually already known from account onboarding; never re-asked
   if present.
2. **Shipping location** — ZIP first (drives zone, §3.3), full address collected at
   checkout. Validated against the state **allowlist** (doc 04) before any promise is made.
3. **Where will your seeds grow?** — **MULTI-SELECT**, exactly:
   in-ground garden · raised beds · containers/pots · indoors · greenhouse ·
   community garden · not sure · other. (Extends the shipped `garden_sizes[]`
   multi-select from `0030`; "every selected space is small → container-friendly only"
   logic carries forward.)
4. **Sun exposure** — full / partial / shade / not sure.
5. **Experience** — first time / beginner / some / experienced.
6. **Preferences** — crops, cuisines, themes ("salsa garden").
7. **Exclusions** — anything they never want; enforced by the engine by crop AND category.
8. **Space** — bed dimensions, container count and sizes, approximate square footage.
9. **How many people are you growing for?**
10. **Preservation interest** — canning/freezing/storage, or fresh-eating only.
11. **Interest mix** — vegetables / herbs / flowers / pollinator plants.
12. **Timing preference** — "plant right away" vs "happy to hold packets for the right
    window" (drives the Plant-now vs Save-for-later balance).
13. **Desired control level** — maps to the four modes in §4, in plain words
    ("Want Gnome to surprise you, or do you want the final say?").

The profile is **editable later** from the dashboard (§7), any field, any time; changes
affect future selections, never already-approved ones.

### 3.3 Hardiness zone: derived, correctable

Zone is **derived from ZIP** (shipped behavior: geocode + calibrated estimate, ±1 zone
typical) and always shown with **"adjust if you know better."** The customer's correction
wins and is stored. The engine's zone-adjusted sowing shift (`0028`: coarse ±1 month for
zones ≥ 8 / ≤ 4 against the zone-6 baseline `sow_months`) consumes whichever zone is on
the profile. V1 should upgrade derivation to the 2023 USDA map data where feasible —
database lane decision — but the correction affordance is non-negotiable.

### 3.4 Privacy

- The **exact address is never public**. Ship-to fields live on the subscription/order
  (`0067`), readable only by the owner and permitted admins under RLS.
- The **garden profile is never public**. Same pattern as contact onboarding: private
  tables, no world-read policy; the world-readable `profiles` projection stays
  name-and-initial only.
- Packing slips, QR codes, and notifications follow the auth rule in §9.

---

## 4. The four customer-control modes

One invariant above all of them, stated once and enforced everywhere:

> **No mode bypasses inventory, destination restrictions, entitlements, packet counts,
> eligibility, capacity, or compliance. Nothing is silently substituted after approval —
> a replacement requires the customer's explicit approval unless the customer has
> opted in to auto-substitutions.**

The deterministic engine (`generate_seed_drop`) is the **only** component that selects
and reserves stock in every mode. The modes differ only in *when the customer sees the
list and who fills the slots first* — never in which safety checks run.

### 4.1 Surprise Me

- Customer sets size + frequency + profile; Gnome selects everything.
- Flow: profile → engine selects and reserves → payment → fulfillment. No approval step.
- Every selection still shows its **WHY** on the dashboard after the fact (§7).
- Substitution posture: because there is no approval step, Surprise Me implies
  auto-substitution consent **within the customer's exclusions and eligibility** —
  stated plainly at mode selection, changeable any time.

### 4.2 Let Me Approve

- Engine builds a full proposed Drop; the customer sees every packet with its WHY and
  approves or asks for changes before anything ships.
- Flow: profile → engine **proposes** (no reservation, or a short-hold reservation —
  database-lane choice; either way expiry-protected, §8 "Reservation expired") →
  customer approves → reservation confirmed → payment → fulfillment.
- After approval the list is **frozen**. If a lot fails between approval and pack
  (quarantine, breakage), the order enters **Replacement approval required** (§8) —
  the customer explicitly approves the offered replacement or a refund of the
  difference per the policy lane. Never a silent swap. (`seed_order_items.substituted_from`
  / `substitution_reason` from `0028` record what happened; the approval record is new.)

### 4.3 Build It With Me

- A conversation: the gnome proposes candidates one theme at a time ("Want a salad
  corner? Here's what's in stock and in season for zone 6b…"); the customer picks each
  slot with Gnome coaching.
- The pick list the customer chooses from is **server-filtered to eligible, in-stock,
  in-season, destination-legal candidates only** — the shipped pattern (SeedProfileClient
  already shows "Gnome's picks from REAL stock"; the buyer can overrule any pick, but
  only onto another eligible candidate).
- Ends in the same approval + reservation + payment sequence as 4.2.

### 4.4 Choose For Me Then Add More

- Gnome fills the base Drop (as Surprise Me), then the customer may add packets up to
  their size's count — or up to the Build-Your-Drop cap of 20 — from the same
  server-filtered eligible list.
- Additions re-run every check (counts, capacity, entitlement, destination) at add time.
- Substitution posture follows 4.1 for the Gnome-chosen base and 4.2 for
  customer-added packets, unless the customer sets one posture for the whole Drop.

---

## 5. Drop-size recommendation engine

Advisory only. The recommendation **never auto-selects** a size; it pre-highlights one
with its reasoning, and the customer taps whichever they want.

**Inputs:** people fed · garden dimensions · container count and sizes · bed dimensions ·
sun · experience · diversity desire · preservation plans · existing seed inventory the
customer reports owning · prior Drops (what Gnome already sent them) · current season ·
time the customer says they have.

**Output contract:** a recommended size **plus the reason, always shown**, in Gnome's
voice. The canonical example:

> "You've got two 4×8 raised beds — about 64 square feet — full sun, and you're feeding
> three people. A **Garden Drop (8 packets)** fills that nicely without crowding: roughly
> 6 vegetables, an herb, and a flower for the pollinators. A Harvest Drop would mean
> either crowding the beds or saving several packets for later — fine if you want them,
> but you don't need them."

**Rules:**

- The engine may recommend **down** as readily as up. Over-selling seed a customer can't
  plant violates goal 1.
- If the customer picks a size far above what their stated space supports, Gnome says so
  once, plainly, and then respects the choice ("Your call — I'll mark the extras
  **Save for spring** so nothing goes to waste.").
- Prior-Drop awareness: don't recommend a size whose fill would largely duplicate
  unplanted packets from the last Drop (the journal, §7, knows what was planted).
- Recommendation math is deterministic and server-side; AI phrases it but does not
  compute it (same division of labor as the shipped capacity estimator in ECONOMICS.md).

---

## 6. Server-side eligibility checklist

Every Drop, every mode, every packet, enforced in the database layer. Items 1–12 are
**shipped today** and are preserved by name; items 13–18 are **V1 extensions** the
database lane owns.

| # | Check | Status · mechanism |
|---|---|---|
| 1 | **Real inventory lots only** — selections join physical `seed_lots` rows; nothing is invented | Shipped — engine joins `seed_lots`, `0028` |
| 2 | **Race-safe reservation** — guarded `UPDATE … WHERE current_qty >= 1`; the update is the lock | Shipped — `0028` |
| 3 | **In-stock only** — `current_qty >= 1` at selection time | Shipped — `seed_lot_eligible()` |
| 4 | **No quarantined/failed lots** — lot status must be fresh/active/aging | Shipped — `seed_lot_eligible()` |
| 5 | **Germination ≥ 70% or eligible fresh-untested** — `coalesce(germination_pct, 100) >= 70` | Shipped — `seed_lot_eligible()` |
| 6 | **Retest date not overdue** — `next_review_date` null or ≥ today | Shipped — `seed_lot_eligible()` |
| 7 | **Zone-adjusted sowing period** — `sow_months` zone-6 baseline, coarse zone shift | Shipped — `0028` engine |
| 8 | **Sun matching** — product's preferred sun vs profile | Shipped — `0028` engine |
| 9 | **Container compatibility** — container-friendly only when *every* selected growing space is small | Shipped — `0030` |
| 10 | **Beginner compatibility** — first-timers get `beginner_friendly` only | Shipped — `0028` engine |
| 11 | **User exclusions** — by crop and by category | Shipped — `0028` engine |
| 12 | **Stripe webhook idempotency** — insert-first on `stripe_events`; `stripe_session_id UNIQUE`; replay-safe money effects | Shipped — stripe-webhook + `0028`/`0083` |
| 13 | **Destination allowlist** — ship-to state explicitly cleared in the state matrix (04); absence from a blocklist is never clearance | V1 — new config check at profile, approval, and pack time |
| 14 | **Per-packet destination restriction** — a packet restricted for the destination state is excluded from the candidate pool for that customer | V1 — `seed_products` extension |
| 15 | **Entitlement / payment state** — no fulfillment on unpaid orders; the seasonal rule stands: generation may precede billing, shipping never precedes payment | Shipped posture (`0081` wave sequence) — restated as a named check |
| 16 | **Packet count matches the chosen size** — 4/8/12 or custom 4–20; shortfalls park in `needs_review`, never silently under-ship | V1 — constraint extension on shipped `packet_count` |
| 17 | **Capacity limits** — every §10 limit evaluated before enrollment, selection, and generation | V1 — config rows |
| 18 | **Compliance state** — recall/stop-sale flags (doc 11) exclude affected lots instantly; seasonal window rules (`seed_sub_next_window`: join by `join_cutoff` or wait for next season) | Window logic shipped (`0081`); recall flag is V1 |

The checklist is one server-side function in spirit: if any line fails, the packet or
Drop does not proceed, and the customer-facing state (§8) says which line, honestly.

---

## 7. Customer dashboard

One screen, "My Seed Drop," owner-only under RLS. Contents:

**Current Drop** — size · frequency · control mode · ship-to (masked to city/state until
tapped, owner-auth required for full address) · profile summary (tap to edit) ·
current status in customer language (§8) · every selection with **WHY Gnome picked it** ·
**what each packet can grow** (the doc 15 panel) · each packet's **Plant now / Start
indoors / Save for spring / Save for another specified window** label · any substitution
issue awaiting their approval · tracking + delivery info.

**History** — previous Drops · planting history (which packets went in the ground, when —
extends `planting_confirmed_at`) · germination results the customer reported · photos ·
harvest notes.

**Controls** — pause / skip (per season window, shipped `skip_season_window` semantics:
allowed until the window's `generation_date`) / cancel · change size · change frequency
(cutoff rules, doc 14) · update preferences and exclusions · **Ask Gnome** (the existing
assistant, with this Drop's context).

The journal entries (plantings, germination, photos, harvest notes) are **new tables**
(database lane) and feed the next Drop's selection (§5 prior-Drop awareness; journey
step 17 in doc 13).

---

## 8. Fulfillment states

### 8.1 The ten happy-path states (customer-facing)

Customer language on the left; the system facts on the right. Customer states are a
**presentation layer** over the shipped `seed_orders` / `seed_order_items` statuses plus
a small number of new tracked facts — the database lane maps them; the copy belongs here.

| # | Customer state | System reality |
|---|---|---|
| 1 | **Preferences received** — "Got it. Your garden profile is safe with me." | Profile saved; subscription exists (`incomplete` or `active`); no order yet |
| 2 | **Seeds being matched** — "I'm out in the seed shed matching packets to your garden." | Order row created; engine proposing/selecting |
| 3 | **Awaiting customer approval** — "Your Drop is picked out — take a look and tell me it's right." | Approval modes only; proposal awaiting customer; expiry clock running |
| 4 | **Inventory reserved** — "Your packets are set aside with your name on them." | `seed_order_items` `reserved`; order `selected` |
| 5 | **Payment confirmed** — "All squared away." | Order `paid` via webhook (idempotent) |
| 6 | **Preparing shipment** — "Packing your box." | Items `picked` → `packed` (`0077` lanes) |
| 7 | **Shipped** — "On its way. Here's your tracking." | Order `shipped` + tracking; ship-once guard |
| 8 | **Delivered** — "It's landed. No rush — every packet says when it wants planting." | New: carrier scan or customer confirmation |
| 9 | **Growing** — "In the ground! I'll check on you." | `planting_confirmed_at` + journal activity |
| 10 | **Completed** — "That's a wrap on this Drop. Your notes are saved for the next one." | New: season closed / customer marked done; feeds §5 |

Sequencing note: the shipped system supports two orderings (one-time: pay → reserve;
seasonal wave: reserve → pay, `0081`). The customer-facing sequence above is canonical
for approval modes; either underlying ordering may satisfy it. **Unpaid orders are never
shipped; impossible fulfillment is never charged** — both already shipped posture.

### 8.2 Exception states — all of them

Copy tone for every exception: warm, specific, blame-free, and **honest about which
limit or problem applies**. Never "something went wrong." Never fake scarcity.

| Exception | Entry | Exit | Customer copy sketch |
|---|---|---|---|
| **Waitlisted** | Enrollment cap (§10) reached at signup | Admin raises cap / spots free; FIFO offer with response window | "Every Drop is packed by hand, and the bench is full right now. You're #N in line — I'll email the moment a spot opens." |
| **Enrollment full** | Hard `max_active_subscribers` reached and waitlist also closed | Admin config change | "Seed Drop is full for this season. Accounts and the marketplace stay open — and I'll holler when enrollment reopens." |
| **Outside seasonal window** | Joined after `join_cutoff` (shipped `seed_sub_next_window` logic) | Next window's cutoff passes with them enrolled | "You just missed the fall cutoff (Sep 18) — no rushed late boxes, ever. You're first in line for the next season." |
| **Unsupported destination** | Ship-to state not on the allowlist (04) | State cleared by compliance lane | "I can't ship seeds to {state} yet — the paperwork isn't cleared, and I don't ship where I'm not certain it's right. Your account works everywhere; I'll let you know if this changes." |
| **Packet restricted for destination** | Check 14 excludes a candidate/approved packet | Engine substitutes pre-approval; post-approval → Replacement approval required | "One packet in your Drop isn't allowed into {state}, so I swapped in {alt} before you approved — here's why." |
| **Inventory unavailable** | Shortfall at selection (order parks `needs_review` — shipped) | Restock; engine re-run; or size-down offer with price difference per policy lane | "I'm short {n} packets of what your garden deserves. Options: wait for restock, or take a smaller Drop now and the difference back." |
| **Payment failed** | Webhook `payment_failed` (shipped sub status) | Retry succeeds / method updated; reservation released after grace | "The payment didn't go through — happens to everyone. Your packets stay set aside until {date}." |
| **Reservation expired** | Approval/checkout hold passed its expiry | New checkout re-reserves; stock returns to shelf via `release_seed_drop_items` (shipped) | "I held your packets as long as I could, then put them back on the shelf for the neighbors. Rebuild your Drop any time — most of it is probably still in stock." |
| **Replacement approval required** | Post-approval lot failure/restriction and no auto-substitution consent | Customer approves the replacement / declines (refund of difference per policy lane) | "One of your packets failed my quality check after you approved it. I won't swap behind your back: here's the replacement I'd pick and why — yes or no?" |
| **Shipment delayed** | Carrier exception / missed `ship_end` | Delivered, or refund path per policy lane | "Your box is moving slower than promised. Tracking says {fact}. Seeds keep just fine in transit — and I'm watching it." |
| **Damaged shipment** | Customer report + photo | Reship from real stock / refund per policy lane; never "hope it's fine" | "That's not how it left my bench. Send a photo and I'll make it right — replacement or refund, your pick." |
| **Missing packet** | Customer reports count short vs packing slip | Ship missing packet / refund per policy lane; ledger + audit reconciliation | "The slip says {n} packets and you got {m} — that's on me. The missing one ships now, no charge." |
| **Recall / stop-sale** | Compliance flag (doc 11) on a lot/product | Per doc 11 procedure; affected states/orders notified | "A supplier recalled {packet}. Don't plant it — here's exactly what to do, and here's what I'm doing about it." |

Recall copy is the one place tone turns fully serious: plain instructions first,
reassurance second, no cuteness.

---

## 9. Packing and fulfillment contents

Locked physical rules (compliance authority: docs 02, 03, 08, 09):

- **Original sealed supplier packets only.** Gnome never opens, divides, repackages,
  relabels, or covers a packet. **The supplier's packet remains the controlling label.**
- **Plain envelope or box.** No custom packaging at launch — no branded boxes, no
  printed liners. (Revisit post-launch; economics lane owns the cost case.)
- **Packing slip**, one per shipment:
  - shipment ID
  - packet list: supplier · kind · variety · lot number — matching `seed_order_items`
    → `seed_lots` exactly (the slip is generated from the reservation, not typed)
  - short support instructions ("Questions? Ask Gnome from your Drop page.")
  - **QR code to the customer's Drop page.** The QR target shows nothing private
    without login: **authentication is required for any private data** (profile,
    address, journal). Unauthenticated scans see only a sign-in prompt and generic
    Drop-arrived copy — a slip left on a porch leaks nothing.
  - **placeholder block for legally required Boone Systems shipper information** —
    exact required contents **pending the federal memo (doc 02)**; the slip template
    ships with the reserved space so adding the final text is copy, not redesign.
  - destination notices: any state-specific notice the matrix (04) requires for the
    ship-to state.
- Fulfillment flow is the shipped one: `admin_seed_queue` → pick each item
  (`admin_pick_seed_item`) → pack with unpicked-item guard (`admin_pack_seed_order`) →
  ship once with carrier + tracking (`admin_ship_seed_order`), every step
  permission-checked and audited.

---

## 10. Capacity protection

Every limit below is a **configuration value changeable by the owner/admin without a
code deploy** (the `seed_season_windows` config-rows pattern; database lane owns the
table shape). All are evaluated inside the server-side checklist (§6, check 17).

| Limit | Effect when hit |
|---|---|
| Global Seed Drop enable/disable | Product hidden from enrollment; existing paid orders complete |
| Enrollment state: open / waitlist / closed | New signups flow to waitlist or a clear closed notice |
| Max active subscribers | Waitlist |
| Max new subscribers per day | Same-day waitlist; auto-reopens next day |
| Max monthly fulfillment volume (orders/period) | Generation deferred; customers see honest timing |
| Max packets per period (packet-level throughput cap) | Wave sizing respects it; preview flags SHORT (shipped `admin_seed_wave_preview` demand-vs-stock pattern) |
| Seasonal availability | The shipped window rows: no window, no generation |
| State allowlist | §8 Unsupported destination |
| Per-lot inventory | Shipped: `seed_lot_eligible` + race-safe reservation |
| Per-user reservation cap | One active reservation per user per window (shipped `seed_orders_window_user_uq` idea, extended to holds) |
| Checkout reservation expiry | §8 Reservation expired; stock auto-returns |
| Emergency pause (one switch) | Freezes enrollment + generation + shipping; in-flight paid orders decided by admin |
| Supplier outage flag | Affected products leave the candidate pool |
| Carrier outage flag | Ship step held; §8 Shipment delayed copy |
| Recall pause (per lot/product/all) | Doc 11 procedure |

**When any capacity limit is hit:**

- **Account creation stays open nationwide.** Capacity never closes the marketplace.
- **No overselling, ever.** A limit discovered mid-checkout ends in waitlist or refund,
  never a promise against stock or capacity that doesn't exist.
- **Waitlist** with position feedback and FIFO offers.
- **The UI names WHICH limit applies** — "the fall shipping window closed," "the
  subscriber bench is full," "I can't ship to Oregon yet" — never a generic
  "unavailable."

---

## 11. Decisions reserved for Daniel

1. **First-Drop timing for new subscribers:** ship the first Drop promptly after
   approval + payment (one-time engine path), or hold every Drop to the seasonal wave
   (`0081` model). Doc 13 walks the prompt-ship variant and shows how the packet mix
   changes under the wave variant. This changes warehouse rhythm; not a spec call.
2. **Harvest Drop rename** (doc 14 §4 recommends "Homestead Drop"; structure unchanged).
3. **Monthly cadence: offer at launch or defer** (doc 14 §3 specifies it fully either way).
4. **Approval-hold semantics:** propose-without-reserving vs short-hold reservation
   (inventory-fairness trade-off, doc 14 §2.3; database lane implements either).
5. **Garlic:** October-planted, NE-Ohio-perfect, but ships as **bulbs, not sealed seed
   packets** — outside the locked packet rules. Include as a special line (needs its own
   compliance pass in 02/03) or leave out of V1. Doc 13 flags where it would shine.
