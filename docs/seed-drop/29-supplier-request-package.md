# 29 — Supplier quote and credential request package — **NOT SENT**

2026-08-13. Botanical Interests · Seed Savers Exchange · High Mowing Organic
Seeds. **No supplier has been contacted.** Nothing is selected, negotiated,
signed, or purchased, and no price in the economics model changes until real
quotes land.

Companion to [07-supplier-review.md](07-supplier-review.md) (why these three)
and [16-pricing-economics.md](16-pricing-economics.md) (where the numbers go).

## The one thing this package exists to extract

Every supplier will happily send a wholesale price list. The answer that
actually gates launch is different, and it is easy to get a vague reply to:

> **Which legal entity is printed on the packet, and which states is *that
> entity* credentialed in?**

At least eight states make lawful resale depend on the **supplier** holding
that state's labeler credential (WI, IA, MN, CT, WA, OR, TX, CO), plus Ohio's
ORC 907.08(H) seller duty. A brand name is not an entity: "Botanical Interests"
the brand and the legal entity printed on the packet may differ, and a parent
company's permit does not cover a subsidiary's label. §B Q1–Q4 are written to
make that unambiguous, and `seed_supplier_credentials.labeled_entity` in
migration 0089 is the column their answer populates.

---

## Part 1 — Shared due-diligence questionnaire

Send as an attachment or a follow-up once a supplier responds to the outreach
email. Ask them to answer inline.

### A. Commercial terms
1. Wholesale price list for retail-size seed packets, with price breaks.
2. Minimum **opening** order (dollars or units).
3. Minimum **reorder** (dollars or units).
4. Case-pack / packet-count requirements per SKU — must we buy in multiples?
5. Current catalog with availability, and typical restock lead time.
6. Payment terms, and terms available to a new account.
7. Freight terms, typical shipping cost, and any free-freight threshold.
8. Seasonal ordering deadlines or blackout periods.

### B. Legal entity and credentials — **the gating section**
1. **What is the exact legal entity name printed on the packet label?** If it
   differs by product line, list each line and its entity.
2. In which **states** does that entity currently hold a seed labeler permit,
   dealer licence, or equivalent registration?
3. For each: **credential number**, issuing agency, effective date, and
   **expiration date**.
4. Please attach copies, or point to the public registry entries.
5. Do you hold a **current Ohio** seed labeler permit? (ODA maintains a public
   Seed Labeler Search; we will verify independently either way.)
6. Who at your company do we notify of a credential change or lapse, and will
   you notify us proactively?
7. Are there states you decline to ship to, or where you know your credential
   does not reach?

### C. Product and lot data (per shipment, ideally per lot)
1. Lot / batch number.
2. Germination percentage.
3. Germination test date.
4. Retest or "sell by" / "packed for" date printed on the packet.
5. Treatment status — untreated, fungicide-treated, pelleted, primed,
   inoculated — and the treatment name if any.
6. Country of origin, where available.
7. Organic certification: certifier name and certificate number, where
   applicable.
8. Are all packets supplied **sealed, original retail packets** that we resell
   unopened? (We do not repackage or relabel — please confirm this matches your
   expectation.)
9. Can this data be supplied **with each shipment** rather than on request?

### D. Recall, quality and liability
1. Your recall procedure, start to finish.
2. **How quickly** are customers notified of a recall or stop-sale, and by what
   channel?
3. Do you carry product-liability insurance, and what are the limits? Can we be
   named as an additional insured?
4. Your remedy if a lot fails germination after we have sold it.
5. Have you had a recall or state stop-sale order in the last three years?

### E. Rights and permissions (get these in writing)
1. Written permission to **resell** your packets at retail, unaltered.
2. Permission to display your **packet images** in our app and website.
3. Permission to reproduce your **variety descriptions and growing
   instructions**, and any required attribution.
4. Trademark and logo restrictions we must observe.
5. Is a small **supplemental sticker** identifying Boone Systems LLC as the
   shipper acceptable, provided it covers no part of your label?
   *(This is the mitigation under discussion with USDA AMS — see
   [02-federal-memo.md](02-federal-memo.md) F2. We will not apply one without
   both your consent and USDA's answer.)*

### F. Operations and data
1. Do you offer **drop-shipping** direct to consumers on our behalf, and on
   what terms?
2. If so, whose name appears as shipper on the parcel and the packing slip?
3. Is there a **data feed, API, or CSV** for catalog, pricing and stock?
4. Substitution policy when an item is out of stock — do you substitute, and
   may we opt out? *(We will opt out: our customers approve specific packets.)*
5. Returns policy, and handling of damaged or short shipments.
6. Do you run an existing **wholesale, marketplace, or subscription-box
   program**, and can you share references from a similar buyer?

---

## Part 2 — Outreach emails (one per supplier, tailored)

Each is short on purpose: the questionnaire carries the detail, and a first
email that asks 40 questions does not get answered.

### 2.1 Botanical Interests

> **Subject:** Wholesale inquiry — Ohio seed subscription box (Boone Systems LLC)

Hello,

I'm Daniel Marinelli, founder of Boone Systems LLC in Ohio. We operate Gnome
Farmers Market and are preparing to launch a seasonal seed subscription for
home gardeners: **4, 8, or 12 sealed retail packets** per shipment, chosen to
match the customer's growing space and zone, with plain-language growing
guidance included.

We would resell your packets **unopened and unaltered** — no repackaging, no
relabeling. Your packet reaches our customer exactly as it left you, which is
the point: your seed information and variety descriptions are among the best in
the industry, and that is what we want the customer to read.

Could you tell me about your wholesale program — pricing, opening and reorder
minimums, case requirements, and lead times?

I have a short due-diligence questionnaire I send to every supplier, covering
lot and germination data, recall procedures, and the state seed credentials
held by the entity named on the packet. Our first phase ships **within Ohio
only**, and we expand state by state as we confirm requirements. If you can
send it along with your wholesale terms it will save us both a round trip.

Happy to talk by phone if that's easier.

Best regards,
Daniel Marinelli · Boone Systems LLC — Gnome Farmers Market
[phone] · [business email] · [website]

### 2.2 Seed Savers Exchange

> **Subject:** Wholesale inquiry — heirloom seed subscription, Ohio (Boone Systems LLC)

Hello,

I'm Daniel Marinelli of Boone Systems LLC in Ohio. We're launching a seasonal
seed subscription for home gardeners — **4, 8, or 12 sealed retail packets** per
shipment, matched to the customer's space and zone, with growing guidance.

Your heirloom and open-pollinated varieties are a natural fit: a meaningful
share of our customers want to save seed and grow something with a history, and
your catalog tells that story better than a commodity line does. We resell
packets **unopened and unaltered**, so your descriptions reach the customer
intact.

Could you share your wholesale terms — pricing, opening and reorder minimums,
case requirements, and lead times? I'd also like to understand how your
non-profit mission shapes the wholesale relationship, since aligning with it
matters more to us than a small price difference.

I send every supplier a short due-diligence questionnaire covering lot and
germination data, recall procedures, and the state seed credentials held by the
entity named on the packet. Our first phase is **Ohio-only**, expanding state by
state as we confirm requirements.

Best regards,
Daniel Marinelli · Boone Systems LLC — Gnome Farmers Market
[phone] · [business email] · [website]

### 2.3 High Mowing Organic Seeds

> **Subject:** Wholesale inquiry — certified-organic seed subscription, Ohio (Boone Systems LLC)

Hello,

I'm Daniel Marinelli of Boone Systems LLC in Ohio, launching a seasonal seed
subscription for home gardeners — **4, 8, or 12 sealed retail packets** per
shipment, matched to space and zone, with growing guidance.

We want a **certified-organic tier**, and your 100% organic catalog is the
cleanest way to offer one honestly. We resell packets unopened and unaltered,
so your certification and label reach the customer exactly as you issued them.

Could you share your wholesale terms — pricing, opening and reorder minimums,
case requirements, and lead times? Two specifics matter to us: the **certifier
name and certificate number** we may cite, and exactly **what organic claims we
may make** in our own copy without overstating them.

I send every supplier a short due-diligence questionnaire covering lot and
germination data, recall procedures, and state seed credentials held by the
entity named on the packet. Our first phase is **Ohio-only**, expanding as we
confirm requirements.

Best regards,
Daniel Marinelli · Boone Systems LLC — Gnome Farmers Market
[phone] · [business email] · [website]

---

## Part 3 — Comparison scorecard

Score each 1–5; **weight** reflects what actually blocks launch, which is not
the same as what feels important. Any **red flag** is disqualifying regardless
of total.

| # | Criterion | Weight | BI | SSE | HM |
|---|---|---|---|---|---|
| 1 | **Ohio credential held by the labeled entity** | ×5 | | | |
| 2 | **Credential coverage across the 15 CLEARED states** | ×5 | | | |
| 3 | Lot / germination / test-date data supplied per shipment | ×4 | | | |
| 4 | Written resale + image + description permission | ×4 | | | |
| 5 | Recall procedure and notification speed | ×4 | | | |
| 6 | Wholesale margin at our volumes | ×3 | | | |
| 7 | Opening and reorder minimums vs pilot scale | ×3 | | | |
| 8 | Catalog breadth for 4/8/12 themed Drops | ×3 | | | |
| 9 | Product-liability insurance, additional-insured available | ×3 | | | |
| 10 | Data feed / API / CSV | ×2 | | | |
| 11 | Organic depth | ×2 | | | |
| 12 | Substitution policy (opt-out available) | ×2 | | | |
| 13 | Freight cost and free-freight threshold | ×2 | | | |
| 14 | Brand fit and story | ×2 | | | |
| 15 | References / existing similar programs | ×1 | | | |
| | **Weighted total (max 225)** | | | | |

**Red flags — stop, regardless of score**

- Cannot or will not name the legal entity printed on the packet.
- No Ohio credential and no willingness to obtain one *(blocks the pilot
  entirely)*.
- Refuses written resale permission.
- No recall procedure, or no commitment to notify us.
- Requires us to repackage or relabel *(destroys the entire compliance model)*.
- Opening minimum that exceeds the pilot's whole inventory budget.

**Decision rule.** Expect to start with **two** suppliers, not one — single-source
is a stop-sale away from having no product — and not three, which triples the
credential-audit surface for a pilot. Pick the highest scorer plus the best
complementary catalog.

---

## Part 4 — Credential document checklist

For each supplier, collect and file in the private `seed-lot-docs` bucket, then
create one `seed_supplier_credentials` row per (entity × state) via
`admin_set_supplier_credential`. Nothing is marked `VERIFIED` without a source.

- [ ] Legal entity name printed on the packet (exact, as printed)
- [ ] W-9 or equivalent business identification
- [ ] Ohio seed labeler permit — number, effective and expiration dates
- [ ] Independent verification via ODA's public Seed Labeler Search
      (screenshot with date)
- [ ] Each additional state credential — number, agency, dates, copy
- [ ] Certificate of insurance (product liability), limits, additional-insured
      endorsement if obtained
- [ ] Organic certificate — certifier, certificate number, expiry (if organic)
- [ ] Written resale authorization
- [ ] Written image / description / trademark authorization
- [ ] Recall procedure document
- [ ] Substitution policy, in writing, with our opt-out confirmed
- [ ] Named contact for credential changes
- [ ] Renewal dates entered on the compliance calendar

**Verification rule.** A supplier's own statement is a *claim*. Where a public
registry exists (Ohio's Seed Labeler Search, and equivalents in other states),
verify there and record the registry URL and retrieval date as
`verification_source`. Only then is the row `VERIFIED` — and only a `VERIFIED`,
in-date row lets a packet ship into that state
([25-phase0-status.md](25-phase0-status.md)).

---

## Part 5 — Quote-import template

CSV, one row per SKU quoted. Feeds
[16-pricing-economics.md](16-pricing-economics.md) directly; the derived
columns are computed, never typed.

```csv
supplier,labeled_entity,supplier_sku,brand,crop,variety,category,packet_size,
seed_count_stated,seed_count_source,organic,treatment,case_pack,
wholesale_unit_cents,price_break_qty,price_break_unit_cents,msrp_cents,
min_opening_order_cents,min_reorder_cents,lead_time_days,freight_terms,
free_freight_threshold_cents,availability,notes
```

| Column | Rule |
|---|---|
| `labeled_entity` | Exact legal name printed on the packet — **not** the brand. |
| `seed_count_stated` | Leave **empty** when the supplier does not state it. Never estimate into this column. |
| `seed_count_source` | `SUPPLIER_STATED` only when they stated it; otherwise `WEIGHT_CALC`, `SAMPLE_COUNT`, or blank. |
| `wholesale_unit_cents` | Integer cents, per packet, before freight. |
| `msrp_cents` | Their suggested retail — the anchor customers will compare against. |

Derived downstream (do not put in the CSV): landed unit cost
(wholesale + allocated freight), packet margin, per-Drop COGS at 4/8/12, and
contribution margin at low / expected / high cost scenarios.

**Pricing stays unpublished** until real quotes populate this file and Daniel
approves the resulting prices. The legacy $24.99 survives at most as a
grandfathered 4-packet tier and must not be attached to 8-, 12-, or custom-size
Drops.

---

## Before any of this is sent

- [ ] Fill every `[bracket]` — phone, business email, website.
- [ ] Send from a Boone Systems address.
- [ ] Daniel approves the shortlist (approval #4 in
      [24-launch-verdict.md](24-launch-verdict.md)).
- [ ] One supplier at a time, or all three together — but log each send.
- [ ] Nothing is signed and nothing is purchased on the strength of a quote
      alone.
