# Gnome Inventory Operations

The inventory system extends the original Seed Drop tables (`seed_products`,
`seed_lots`, `seed_inventory_log`) — one model, no duplicates. Units are
**packets**. Every mutation is a permission-checked SECURITY DEFINER RPC that
writes the ledger and the admin audit log.

## Model
- **Item** (`seed_products`): crop + variety + category, plus SKU, supplier,
  supplier product code, packet size, barcode, cost, reorder threshold,
  suggested reorder qty, `archived` flag.
- **Lot** (`seed_lots`): a received batch — internal lot #, supplier lot #,
  original/current packet qty, germination %, storage bin, status
  (`fresh/active/aging/needs_test/quarantined/failed/depleted/discarded`).
- **Ledger** (`seed_inventory_log`): append-only deltas with reasons
  (`received`, `reserved`, `released`, `packed`, `adjust_up/down: …`,
  `status: a → b`, `shipped (reservation consumed)`).
- **Bins** (`storage_locations`) and **suppliers** are lightweight lookup
  tables managed from the admin app.

## Quantity semantics
`current_qty` is what is AVAILABLE. Seed Drop reservation decrements it at
order generation; shipping consumes the reservation (no second decrement);
cancel/release restores it. Reserved stock is visible through
`seed_order_items` in `reserved/picked/packed` status.

## RPCs (all audited)
| RPC | Permission |
| --- | --- |
| `admin_upsert_seed_product` | `inventory.create` / `inventory.edit` |
| `admin_delete_seed_product` | `inventory.delete_unused` (owner-tier) |
| `admin_receive_lot` | `inventory.receive` |
| `admin_adjust_lot` (reason required, floor 0) | `inventory.adjust` |
| `admin_move_lot` | `inventory.move` |
| `admin_set_lot_status` (quarantine/release/…) | `inventory.quarantine` |
| `admin_manage_storage` | `inventory.edit` |
| `admin_inventory_summary` | `inventory.view` |

## Delete vs archive
Delete is HARD and allowed only for items with zero lots and zero order items.
Anything with history raises:
> This item has fulfillment history and can't be permanently deleted. Archive it instead.

Archive hides the item from active pickers/lists; reactivate any time.

## Roles
`INVENTORY_FULFILLMENT` preset: full inventory CRUD except `delete_unused`
(owner keeps that via `*`; grantable as an extra permission), plus the
Seed Drop pick/pack/ship set and `ai.chat`.

## Demand forecasting (2026-08-11)
Wave preview (admin_seed_wave_preview) returns an HONEST packet-demand range
(0.75×–1.10× of eligible subscribers' target counts) against current
fresh/active stock with a SHORT/OK flag — reorder recommendations remain
recommendations; nothing purchases autonomously. Inventory CRUD, ledger,
quarantine, archive-vs-delete rules are unchanged from the Owner Hub round.
