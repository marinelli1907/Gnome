# Seasonal Seed Drop Subscription

**Customer promise:** One personalized Seed Drop each growing season — up to
4 per year. Gnome sends seeds when it's time to plant, not every month. Each
Drop is selected for location/zone, garden setup, sun, experience,
preferences, exclusions, the season, previously received varieties, and REAL
eligible inventory (the deterministic selection engine remains authoritative;
AI only ranks/explains and can never invent stock).

**Price:** $24.99 per seasonal Drop (`seed_drop_subscriptions.price_cents`,
default 2499; `billing_products.GNOME_SEED_DROP_SEASONAL`). Billing model
`PAY_PER_SEASON` (schema also admits `ANNUAL_PREPAID` later).

## Commercial paths

Owner direction: Seed Drop does not replace the existing marketplace ladder.
Customers who do not want seeds keep the current Free/Pro/Farm choices and
prices. Seed Drop can be purchased by itself, or combined with Pro/Farm at a
member bundle price.

The product must retain Seed-only customers as their own measurable segment.
They receive order management and Seed Drop Grow-Along, remain on the Free
marketplace plan, and do not need a public Market. The harvest experience may
invite them to create a Market or upgrade, but declining cannot remove care or
history. See [30 — Zordy Grow-Along](30-zordy-grow-along.md#commercial-paths-and-customer-segments).

Bundle prices are not final in this document. Physical Seed Drop charges and
digital Pro/Farm entitlements keep separate billing and audit records even when
the customer-facing product presents them together.

## Future Grow-Along experience

The planned subscription experience includes a scoped **Zordy Grow-Along**:
each fulfilled variety becomes a private Crop Project with its own schedule,
check-ins, weather-aware care, photos, and harvest history. At harvest, Zordy
may prepare a listing draft that the customer reviews and publishes through the
normal marketplace rules. This entitlement does not grant Pro/Farm or increase
listing allowances. See [30 — Zordy Grow-Along](30-zordy-grow-along.md).

This is a future-release specification only. It does not change the current
Seed Drop coming-soon posture, open ordering, authorize fulfillment, or enable
live payments.

## Season windows (`seed_season_windows` — config rows, not code)
Each row: season_code (EARLY_SEASON/SPRING/SUMMER/FALL) + year + zone range +
`window_start` → `join_cutoff` → `generation_date` → `ship_start`–`ship_end`.
Seeded baseline (zones 4–9): FALL 2026 (cutoff Sep 18), EARLY_SEASON 2027
(Feb 19), SPRING 2027 (Apr 23), SUMMER 2027 (Jul 2). Owner tunes rows —
seasons are explicitly NOT fixed 90-day blocks.

## Join / start rule (live-tested)
`seed_sub_next_window(sub)`: the next active window where the subscriber's
zone fits, TODAY ≤ join_cutoff, **the subscriber joined on or before
join_cutoff**, not skipped, and no order already exists for that window.
Join early enough → current season; join after the cutoff → first Drop is the
NEXT season. No rushed late-season shipments, ever.

## Lifecycle
- **Skip** (`skip_season_window`, owner-of-sub or seed_drop.manage): allowed
  until `generation_date`; recorded in `seed_sub_season_skips`; no charge, no
  reservation, subscription continues. Skips are never counted as shipped.
- **Cancel**: status change only — history, shipments, and the inventory
  ledger are preserved forever.
- **Pause**: kept out of customer UI until Stripe sync is real (a paused
  label with live charges is forbidden); Admin can hold via status.

## Billing vs fulfillment (documented sequence, PAY_PER_SEASON)
1. Window's `generation_date` arrives → Admin (Seasons screen) previews the
   wave: eligible subscribers + honest demand range vs stock.
2. `admin_seed_wave_generate(window)` creates ONE order per eligible
   subscriber (`pending_payment`, amount = sub price, tagged with the
   window; a partial unique index makes re-runs idempotent — double
   generation is impossible, live-tested). The selection engine reserves
   inventory exactly once at generation.
3. **Charge step: OWNER CONFIG REQUIRED** — Stripe price for
   GNOME_SEED_DROP_SEASONAL is not configured; nothing pretends to charge.
   When configured: charge → order flips to `paid` → fulfillment lanes
   (pick → pack → ship-once) proceed. Unpaid orders are never shipped;
   impossible fulfillment is never charged (generation happens before
   billing and inventory shortfalls land in needs_review first).
