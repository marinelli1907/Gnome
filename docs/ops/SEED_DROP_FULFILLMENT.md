# Seed Drop Fulfillment

The 📦 Fulfill tab in Gnome Admin is the garage workflow: lanes → order →
Pick Mode → pack → ship.

## Lanes (`admin_seed_queue`, permission `seed_drop.view`)
- **Review** — `needs_review` (substitution / stock problems)
- **To pick** — `paid` / `selected`
- **Packed** — sealed, waiting on a label
- **Shipped** — done (tracking shown)

Each order carries its packets with **bin + internal lot** (and a ⚠️ when the
lot isn't fresh/active), the customer name, and the ship-to snapshot.

## Pick Mode (`admin_pick_seed_item`, `seed_drop.pick`)
Huge type, one-handed: BIN on top, packet + lot under it, tap when in hand.
`reserved → picked`, one item at a time; double-pick is rejected.

## Pack (`admin_pack_seed_order`, `seed_drop.pack`)
All-picked is the happy path. Packing with unpicked items requires an
explicit override reason (audited). Order → `packed`.

## Ship (`admin_ship_seed_order`, `seed_drop.ship`)
Carrier + tracking. Only a `packed` order can ship, exactly once — a second
ship call errors (`BAD_STATE`). Items → `shipped`; the ledger records
`shipped (reservation consumed)` with delta 0 — stock was already decremented
at reservation, so shipping never double-decrements.

## State machine
`paid/selected → (needs_review) → picked-items → packed → shipped`
Cancel/release paths (existing RPCs) restore stock and write `released`.
Fulfillment history is never deleted; items with history are archived.

## Seasonal waves (2026-08-11)
Fulfillment now begins from SEASON WINDOWS (docs/seed-drop/SEASONAL_WINDOWS.md):
Admin → Seed Drop Seasons → preview wave (eligible subscribers, demand range
vs stock) → generate (one pending_payment order per subscriber, inventory
reserved once, idempotent re-runs — double generation impossible). Orders then
flow through the existing lanes: needs_review → pick (bin + lot on every
packet) → pack → ship-once with tracking + per-shipment costs
(admin_set_seed_order_costs). Seasonal charge step awaits owner Stripe config;
unpaid orders are never shipped.
