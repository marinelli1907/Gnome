# Seed Drop Economics

Honest-numbers policy: nothing is manufactured. Missing costs render blank.

**Per packet:** COGS derives from each order item's LOT —
`seed_lots.cost_cents / original_qty × qty_packets` (landed cost = whatever
the owner recorded at receive time).

**Per shipment (`seed_orders` columns):** `postage_cents`,
`packaging_cents`, `insert_cents`, `payment_fee_cents`, `other_cost_cents` —
recorded at/after ship via `admin_set_seed_order_costs()` (seed_drop.ship).

**Rollup:** `admin_seed_economics(window?)` (finance.view_summary or
seed_drop.view) → orders, shipped, revenue, packet COGS, each cost bucket,
gross profit, and `costs_recorded_orders` so the owner can see how much of
the picture is actually filled in. Margin % renders only when revenue > 0.
Surface: Admin → More → Revenue & Promotions.

**Capacity estimator (same screen):** deterministic math only —
orders/pick-rate + orders/pack-rate vs available hours ("Can I fulfill 200
Drops this weekend?"). Agents may explain it; they don't compute it.
