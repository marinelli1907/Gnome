# 16 — Pricing & Unit Economics Model: Sized Seed Drops (4 / 8 / 12 / custom 4–20)

**Gnome Seed Drop V1 — Boone Systems LLC (Ohio). Drafted 2026-08-13.**

Purpose: model viable **price ranges and contribution margins** for the new sized
drop structure. **No final prices are set here.** Every input below is an
**ESTIMATE** with its basis stated; real supplier quotes and a timed fulfillment
pilot replace them before pricing is finalized (§9). This planning model is
separate from the app's honest-numbers actuals system (`docs/seed-drop/ECONOMICS.md`
— the app records real per-order costs; it never renders these estimates).

Existing anchor: the current seasonal drop charges **$24.99/season**
(`seed_drop_subscriptions.price_cents` default 2499, migration 0081). Sanity check
against it in §8.

---

## 1. Input assumptions (ALL ESTIMATES)

| Input | LOW | EXPECTED | HIGH | Basis |
|---|---|---|---|---|
| Wholesale packet cost | $1.10 | $1.75 | $2.40 | ESTIMATE. 40–60% off $2.50–$4.50 SRP → $1.00–$2.70. Real data points: Seed Savers Exchange publishes **$1.75/packet** rack pricing (≥50% off SRP); High Mowing SRP **$4.15** with two unpublished cost tiers (~$2.08 at 50%). Pending quotes (07-supplier-review.md). |
| Inbound freight /packet | $0.00 | $0.06 | $0.15 | ESTIMATE. $0 if free-freight thresholds met (High Mowing free >$200 contiguous US); else ~$15–25 UPS/FedEx inbound per ~250-packet order. |
| Loss/damage allowance | 2% | 3% | 4% | ESTIMATE per task spec (~2–4% of packet cost: crushed corners, misprints, aging stock written off). |
| Packaging: 4-pkt | $0.35 | $0.55 | $0.80 | ESTIMATE. Padded mailer #000–#0 ($0.20–$0.45 at qty) + packing slip/insert ($0.10–$0.20). |
| Packaging: 8-pkt | $0.45 | $0.65 | $0.90 | ESTIMATE. Padded mailer #1–#2 + slip. |
| Packaging: 12-pkt | $0.80 | $1.05 | $1.40 | ESTIMATE. Small rigid kraft box + slip. |
| Packaging: 20-pkt | $1.00 | $1.35 | $1.75 | ESTIMATE. Lightweight box + slip. (NOT a heavy gift box — see postage cliff, §4.) |
| Labor rate (loaded) | $16/hr | $20/hr | $25/hr | ESTIMATE. Ohio pick/pack labor incl. taxes/overhead. Costed even while Daniel does it himself — unpriced labor is a subsidy. |
| Pick/pack minutes 4/8/12/20 | 4/5/6/8 | 5/6.5/8/10 | 6/8/10/12 | ESTIMATE pending timed pilot. Includes pick, verify lot, pack, label. |
| Postage (GA commercial, sub-1-lb) | $6.95 | $7.50 | $8.40 | See §3. Post-2026-07-12 sub-1-lb commercial = $6.93 (Z1) – $8.40 (Z8). EXPECTED = Ohio-origin zone mix (most of the eastern/central US is Z2–Z5 from Columbus). |
| Tracking | $0 | $0 | $0 | USPS Ground Advantage includes tracking at no extra cost (usps.com/ship/ground-advantage.htm, accessed 2026-08-13). |
| Failed-delivery allowance | 1.0% | 1.5% | 2.5% | ESTIMATE: % of shipments reshipped × (postage + packaging). |
| Replacement allowance | 1% | 2% | 3% | ESTIMATE: % of packet cost re-sent for damage/complaint. |
| Customer-support allocation | $0.25 | $0.50 | $0.75 | ESTIMATE per shipment (support minutes × loaded rate ÷ shipments). |
| Software/AI per shipment | $0.20 | $0.35 | $0.50 | ESTIMATE. VPS hosting exists (Hostinger KVM2); AI drop-generation tokens + email/notifications, amortized. |
| Compliance amortization | $0.40 | $0.75 | $1.50 | **PLACEHOLDER until the compliance matrix lands** (docs/seed-drop/matrix/). Assumes ~$300–$900/yr Ohio seed dealer/labeler licensing + fees ÷ 300–1,200 shipments/yr. |
| Payment processing | — | 2.9% + $0.30 | — | Stripe standard card pricing (stripe.com/pricing, accessed 2026-08-13). Stripe Billing/Tax fees on Boone's account to be confirmed (§9). |
| Sales tax | — | — | — | **Note only:** handled by Stripe Tax; prices modeled tax-exclusive. Not a margin line. |
| Required margin target | — | ≥40% EXPECTED | — | POLICY (proposed): every advertised size clears ≥40% contribution margin at EXPECTED costs and stays positive at HIGH. Alarm at <30% EXPECTED. |

---

## 2. Weight math per size (ESTIMATES)

Per task spec: retail seed packet ≈ **7–10 g** (0.25–0.35 oz). Model uses 9 g
(0.32 oz) expected. Packing slip + insert ≈ 5 g. Mailers: #000/#0 ≈ 20 g; #2 ≈
30 g; small rigid box ≈ 110 g; lightweight 20-pkt box ≈ 130 g.

| Size | Seed weight | + slip + packaging (EXP) | Total | Ounces | USPS tier |
|---|---|---|---|---|---|
| 4-pkt | 4 × 9 g = 36 g | 5 + 20 g | 61 g | **2.2 oz** | sub-1-lb |
| 8-pkt | 72 g | 5 + 30 g | 107 g | **3.8 oz** | sub-1-lb |
| 12-pkt | 108 g | 5 + 110 g | 223 g | **7.9 oz** | sub-1-lb |
| 20-pkt | 180 g | 5 + 130 g | 315 g | **11.1 oz** | sub-1-lb |

Worst case (10 g packets, heavy 175 g box): 20 pkt → 380 g = **13.4 oz** — still
sub-1-lb. **Every size 4–20 ships sub-1-lb** as long as packaging stays under ~9 oz
(255 g) at the 20-packet size.

---

## 3. Postage: 2026 USPS Ground Advantage facts (sourced, volatile — re-verify at launch)

2026 has been a violent year for rates: **+7.8% avg in January**, an **additional
~8% temporary surcharge in April**, and a structural change in July. Model uses an
August 2026 snapshot; **re-pull live rates from the chosen label platform before
setting final prices.**

- **Commercial rates effective 2026-04-26** (DimMath rate tables, accessed
  2026-08-13): 4 oz $5.50–$6.36; 8 oz $6.03–$6.74; 12 oz $6.16–$7.13; 15.999 oz
  $6.93–$8.40 (Zones 1–8). 1 lb: $7.61 (Z1) – $10.67 (Z8).
  https://dimmath.com/blog/usps-ground-advantage-rates-zone-chart-weight-breaks/
- **2026-07-12 change:** USPS **eliminated the 4 oz and 8 oz commercial tiers** —
  all sub-1-lb commercial parcels now price at the former 12–15.999 oz rate:
  **$6.93 (Z1) to $8.40 (Z8)** regardless of ounces. Average GA commercial increase
  ~**11.8%**. Retail prices were unchanged by the consolidation.
  https://sellerlegend.com/usps-ground-advantage-ounce-pricing-change-2026 ;
  https://transimpact.com/blog/usps-rate-to-increase-ground-advantage-commercial-rates-by-11.8 (accessed 2026-08-13)
- **Retail rates** (for comparison only): start ~$7.90 lightweight/short-zone; 1 lb
  retail ≈ $9.55–$12.90 by zone.
  https://idshipthat.app/shipping-rates/usps-ground-advantage/ (accessed 2026-08-13)
- **Consequence:** always buy **commercial** labels (Pirate Ship / Shippo / etc. —
  free tiers exist). Retail counter postage burns $1.50–$4.00+ per shipment for
  nothing.

### Postage cliff points

| Cliff | Cost jump | Exposure |
|---|---|---|
| **Within sub-1-lb: NONE (commercial)** | $0 | Since 2026-07-12, 2.2 oz and 13.4 oz cost the same commercially. Postage is a **fixed cost per shipment**, not per packet, for every size 4–20. |
| **15.999 oz → 1 lb** | +$0.68 (Z1) to +$2.27 (Z8) | Only reachable via heavy packaging at 20 pkts (packaging >~9 oz). Rule: no gift-box packaging without repricing. |
| **1 lb → 2 lb** | ~+$0.38+ commercial | Not reachable in V1 sizes. |
| **Commercial → retail** | +$1.50–$4.00+ | Operational discipline: never hand-buy counter postage. |

**The flip point where shipping eats the margin is at the SMALL end, not the large
end.** At 4 packets, the delivery stack (postage + packaging + pack labor ≈ $9.70
EXPECTED) is ~50% of total cost; at 20 packets it's ~24%. Small drops are
postage-dominated; large drops are product-dominated.

---

## 4. Cost stacks per shipment (LOW / EXPECTED / HIGH)

All lines from §1. Payment processing excluded here (it depends on price; added in
§6). Figures rounded to cents.

### EXPECTED scenario

| Cost line | 4-pkt | 8-pkt | 12-pkt | 20-pkt |
|---|---|---|---|---|
| Wholesale packets ($1.75 × N) | 7.00 | 14.00 | 21.00 | 35.00 |
| Inbound freight ($0.06 × N) | 0.24 | 0.48 | 0.72 | 1.20 |
| Loss/damage (3% of packets) | 0.21 | 0.42 | 0.63 | 1.05 |
| Packaging + slip | 0.55 | 0.65 | 1.05 | 1.35 |
| Labor (min × $20/hr) | 1.67 | 2.17 | 2.67 | 3.33 |
| Postage (GA commercial) | 7.50 | 7.50 | 7.50 | 7.50 |
| Tracking | 0.00 | 0.00 | 0.00 | 0.00 |
| Failed-delivery (1.5%) | 0.12 | 0.12 | 0.13 | 0.13 |
| Replacement (2% of packets) | 0.14 | 0.28 | 0.42 | 0.70 |
| Customer support | 0.50 | 0.50 | 0.50 | 0.60 |
| Software/AI | 0.35 | 0.35 | 0.35 | 0.35 |
| Compliance (placeholder) | 0.75 | 0.75 | 0.75 | 0.75 |
| **Total before payment fees** | **19.03** | **27.22** | **35.72** | **51.96** |

### LOW scenario (totals)

| | 4-pkt | 8-pkt | 12-pkt | 20-pkt |
|---|---|---|---|---|
| **Total before payment fees** | **13.82** | **18.72** | **23.87** | **33.67** |

### HIGH scenario (totals)

| | 4-pkt | 8-pkt | 12-pkt | 20-pkt |
|---|---|---|---|---|
| **Total before payment fees** | **25.55** | **37.36** | **49.58** | **72.66** |

### Break-even price floors (CM = $0, incl. Stripe 2.9% + $0.30)

Floor = (cost + 0.30) ÷ 0.971.

| Scenario | 4-pkt | 8-pkt | 12-pkt | 20-pkt |
|---|---|---|---|---|
| LOW | $14.54 | $19.59 | $24.89 | $34.98 |
| EXPECTED | $19.91 | $28.34 | $37.10 | $53.82 |
| **HIGH (the guardrail)** | **$26.62** | **$38.78** | **$51.37** | **$75.14** |

**Never-subsidize-postage rule:** no advertised price may sit below the HIGH-scenario
floor for its size. "Free shipping" is fine as copy only because postage is inside
the price — any promo, discount code, or recurring discount that nets the customer
below the HIGH floor is accidentally subsidized shipping. Enforce at promo-config
time, not after.

---

## 5. Viable price RANGES (NOT final prices)

Ranges bounded below by HIGH-scenario floors (+ margin headroom) and above by
retail credibility (SRP of the packets alone: 4 × $3.50–$4.15 ≈ $14–$17 at retail —
the price must be defensible as curation + personalization + delivery, not just
seeds).

| Offer | Viable range (ESTIMATE) | Effective $/packet at range midpoint |
|---|---|---|
| 4-packet drop | **$27.99 – $36.99** | ~$8.12 |
| 8-packet drop | **$44.99 – $56.99** | ~$6.37 |
| 12-packet drop | **$57.99 – $71.99** | ~$5.42 |
| 20-packet (custom max) | **$89.99 – $109.99** | ~$5.00 |
| Custom 4–20 | **base $11.99–$14.99 + $3.25–$4.50 per packet** | consistency check: 4 pkts ≈ $26–33; 20 pkts ≈ $77–105 ✔ |
| Additional packet add-on (to an existing scheduled drop) | **$3.49 – $4.99 each** | marginal cost ≈ $2.07 + fee → 40–55% marginal CM; no extra postage while sub-1-lb |
| Premium packet uplift (organic/Art Pack swap) | **+$1.25 – $2.50 per premium packet** | premium wholesale delta est. +$0.50–$1.25; keep ≥45% CM on the delta |
| Split/extra shipment (if ever offered) | **$8.99 – $11.99 per extra parcel** | true cost of a second parcel: $8.30 LOW / $9.29 EXP / $11.45 HIGH (postage + packaging + labor + failed-allowance). Default: combined shipping only. |

**Per-packet ladder logic:** the descending $/packet (≈$8 → $5) is the fixed
delivery stack amortizing over more packets — it honestly rewards larger drops and
matches the marginal-cost curve. Custom pricing (base + per-packet) makes that
explicit and can't be gamed at any N between 4 and 20.

**One-time vs recurring:** price one-time at list; recurring (seasonal
subscription) at **8–12% off list**. Basis: retention economics plus real wave
efficiency (batch picking cuts labor minutes). Discount ceiling rule: recurring
price must keep EXPECTED CM ≥ 35%. Worked check at 8-pkt midpoint $48.99 − 10% =
$44.09 → EXPECTED CM $15.29 = **34.7%** — i.e., ~10% is the ceiling at that
midpoint; deeper discounts require pricing at the top of the range first.

---

## 6. Contribution margin tables (at reference midpoint prices)

Reference midpoints: 4-pkt $31.99, 8-pkt $48.99, 12-pkt $63.99, 20-pkt $95.99.
Payment fee = 2.9% × price + $0.30. CM = price − total cost − fee.

### 4-packet @ $31.99 (fee $1.23)

| Scenario | Total cost + fee | Contribution margin | CM % |
|---|---|---|---|
| LOW | $15.05 | **$16.94** | **53.0%** |
| EXPECTED | $20.26 | **$11.73** | **36.7%** |
| HIGH | $26.78 | **$5.21** | **16.3%** |

### 8-packet @ $48.99 (fee $1.72)

| Scenario | Total cost + fee | Contribution margin | CM % |
|---|---|---|---|
| LOW | $20.44 | **$28.55** | **58.3%** |
| EXPECTED | $28.94 | **$20.05** | **40.9%** |
| HIGH | $39.08 | **$9.91** | **20.2%** |

### 12-packet @ $63.99 (fee $2.16)

| Scenario | Total cost + fee | Contribution margin | CM % |
|---|---|---|---|
| LOW | $26.03 | **$37.96** | **59.3%** |
| EXPECTED | $37.88 | **$26.11** | **40.8%** |
| HIGH | $51.74 | **$12.25** | **19.1%** |

### 20-packet @ $95.99 (fee $3.08)

| Scenario | Total cost + fee | Contribution margin | CM % |
|---|---|---|---|
| LOW | $36.75 | **$59.24** | **61.7%** |
| EXPECTED | $55.04 | **$40.95** | **42.7%** |
| HIGH | $75.74 | **$20.25** | **21.1%** |

Reading: at midpoints, 8/12/20 all clear the proposed ≥40% EXPECTED target; the
4-packet sits at 36.7% — structurally postage-burdened. Options: price 4-packet
nearer the top of its range, treat it as an acquisition tier with a consciously
accepted ~37% CM, or push customers toward 8+.

---

## 7. Where shipping flips the margin

- **4-packet is the danger size.** Delivery stack ≈ $9.70 EXPECTED ≈ 50% of cost.
  Below **$26.62** (HIGH floor) a 4-packet drop can lose cash outright; below
  ~$29.50 it can't hold 30% CM at EXPECTED costs. Postage doesn't scale down with
  packet count — this is the accidental-subsidy zone.
- **8 packets and up, postage is a shrinking fixed cost** (28% → 14% of EXPECTED
  cost from 8 → 20). Margins are made or lost on packet cost and labor, not
  shipping.
- **The only real postage cliff is packaging-induced:** a 20-packet drop in heavy
  gift packaging can cross 16 oz → 1-lb tier (+$0.68–$2.27). Keep 20-pkt packaging
  under ~9 oz.
- **Split shipments are never free:** each extra parcel costs $8.30–$11.45 all-in.
  Combined shipping is the default; a split option only exists at $8.99–$11.99.

---

## 8. Sanity check vs the existing $24.99/season price

At $24.99 (fee $1.02): a **4-packet** drop yields CM **$10.15 (40.6%)** LOW,
**$4.94 (19.8%)** EXPECTED, and **−$1.58 (loss)** HIGH. An 8-packet drop at $24.99
loses money even at EXPECTED costs (−$3.25).

Conclusion: $24.99 was a plausible intro price for a small (~4-packet) drop under
favorable costs with owner-donated labor, but it sits **below the HIGH-scenario
floor for even the smallest new size**. The sized structure must not inherit it:
either grandfather $24.99 as a legacy/intro 4-packet tier with eyes open, or
migrate existing subscribers to the new 4-packet range at the next season boundary.
Do not attach $24.99 to anything larger than 4 packets.

---

## 9. Open inputs needed before final prices (blockers, in order)

1. **Real wholesale price lists** from the first-approach suppliers (Botanical
   Interests, Seed Savers Exchange, High Mowing) — replaces the $1.10–$2.40 band;
   the single highest-leverage unknown.
2. **Written resale authorization + brand/image license terms** per supplier —
   gates launch and determines which brands can be named in-app (07-supplier-review.md §2).
3. **Minimums and inbound freight terms** (free-freight thresholds, order cadence)
   — sets inbound allocation and upfront cash need.
4. **Actual packet weights** per supplier line (large-format Botanical Interests
   packets may exceed the 10 g HIGH assumption).
5. **Live commercial postage rates** from the chosen label platform at launch —
   2026 rates changed three times; this model is an August snapshot.
6. **Packaging quotes at quantity** (100/500 units: mailers, 12/20-pkt box, slip
   stock) — replaces the packaging band.
7. **Timed pick/pack pilot** (10–20 drops) — replaces labor-minute estimates and
   calibrates the wave-efficiency assumption behind the recurring discount.
8. **Compliance matrix outputs** (docs/seed-drop/matrix/): Ohio seed
   dealer/labeler license fees and destination-state restrictions — replaces the
   $0.40–$1.50 placeholder and may add per-state blocking logic.
9. **Stripe account fee confirmation** (acct on file): Billing tier and Stripe Tax
   pricing on top of 2.9% + $0.30.
10. **Observed failed-delivery / replacement rates** after the first waves —
    replaces the 1–3% allowances.
11. **Demand mix forecast across sizes** — drives compliance/support amortization
    and whether the 4-packet tier is worth its thin margin.
12. **Premium packet lineup decision** (which organic/Art Pack SKUs, and their
    wholesale delta) — finalizes the uplift price.

---

*Model policy: consistent with the app's honest-numbers rule, none of these
estimates enter the product. `admin_set_seed_order_costs()` records actuals per
shipment; this document only decides what prices are safe to test.*
