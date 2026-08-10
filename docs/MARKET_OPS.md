# Market operating tools — design decisions (0048/0049 round)

Payment handles, pickup scheduling, multi-item pickup orders, and the plot
Grow Log. This file records the judgment calls the build round required.

## Payment handles (market_payment_methods)
- Seller-to-buyer routing only. Gnome never takes custody of funds and NOTHING
  auto-marks a payment complete — opening Venmo/PayPal/Cash App is just a link;
  the seller confirms payment via Complete Order / Sales Notebook. The buyer UI
  carries: "Payment is handled outside Gnome. The seller confirms payment
  separately."
- An ENABLED method is storefront signage (public by design); disabled rows are
  private drafts, invisible to everyone but the owner (RLS).
- Handles, not PII: venmo username / PayPal.me name / $cashtag / a Zelle
  *display identifier* (free text — sellers who prefer not to expose an
  email/phone can write "I'll text you my Zelle"). No universal Zelle deep
  link exists; the app shows the identifier instead.
- Links: venmo.com/<user>?txn=pay&amount=X, paypal.me/<user>/X,
  cash.app/$tag/X. Amount prefill only — never marked paid.

## Pickup availability
- `market_pickup_settings` (timezone is stored explicitly, IANA name; slots are
  generated in the market's zone, never the viewer's device zone).
- Recurring weekly windows = rows in `market_pickup_hours` (multiple windows
  per day = multiple rows). Date overrides in `market_pickup_exceptions`:
  `closed=true` kills the whole day; custom-window rows REPLACE the recurring
  hours for that date.
- Defaults: 30-minute slots, 120-minute lead time, unlimited per-slot capacity
  unless the seller sets `max_orders_per_slot`.
- `market_available_slots(market, days)` is the single source of truth — the
  same function feeds the pickers AND validates `create_market_order`, so a
  client can never book an off-schedule/full/too-soon slot.

## Orders
- Cart is client-side; an order is born REQUESTED (no DRAFT row).
- States: REQUESTED → CONFIRMED → READY → COMPLETED, with TIME_PROPOSED
  (one proposal at a time, seller-initiated), DECLINED (seller), CANCELLED
  (either party). History is trigger-written to `market_order_events`
  (actor, old→new, reason, timestamp) — clients cannot fabricate or rewrite it.
- Items snapshot title/unit/price at request time; a later listing edit never
  rewrites an existing order.
- **Inventory timing** (per directive, documented):
  - REQUESTED: no reservation. The soft guard is slot capacity; a request is
    an ask, not a hold. Two buyers can request the last dozen eggs.
  - CONFIRMED (or buyer accepting a proposal): the authoritative reservation —
    row-locked, refuses to go negative (INSUFFICIENT_INVENTORY names the item),
    marks each line `reserved` so release restores exactly what was taken.
  - DECLINED/CANCELLED: releases reserved lines.
  - COMPLETED: no further inventory change (already reserved at confirm);
    the ledger row is written with listing NULL so the legacy `record_sale`
    decrement path can never double-count.
- **Complete idempotency**: `complete_market_order` returns the existing ledger
  txn on repeat calls, and `seller_transactions(order_id)` carries a partial
  unique index — a duplicate ledger row is structurally impossible.
- The existing single-item claim/request flow is untouched and remains the
  quick path; Market orders are the multi-item path. Both record into the same
  Sales Notebook.

## Pickup address privacy
- Public tables never carry the exact address. `market_pickup_private`
  (address + instructions) is owner-only under RLS; buyers receive it ONLY via
  `order_pickup_details(order)` and only while their own order is
  CONFIRMED/READY/COMPLETED. Verified live: pre-confirm and unrelated-user
  calls return nothing.
- `location_type` = PRIVATE_RESIDENCE (default) | PUBLIC_BUSINESS (opt-in
  `public_address` may be displayed publicly) | CUSTOM_PICKUP_POINT.

## Notifications
- Server push events (notify fn v9, all party-verified via caller JWT):
  pickup_request, pickup_confirmed, pickup_time_proposed, pickup_cancelled,
  pickup_ready, buyer_on_the_way, buyer_arrived, grow_log_update,
  plot_owner_note.
- "I'm On My Way" / "I'm Here" are single button presses — no GPS is shared,
  no live tracking exists.
- **Reminders**: implemented as a LOCAL notification on the buyer's device
  (scheduled 1 hour before the confirmed window when they view the confirmed
  order). Rationale: no server scheduler dependency, zero spam risk, works per
  device. A server-side 24h reminder via pg_cron+edge invocation is deliberately
  deferred until push credentials/traffic justify it.

## Grow Log
- Attached to the plot-reservation CLAIM. grower = claimer, owner = plot
  listing's owner.
- Permissions (live-tested): parties read; grower writes `entry` rows, owner
  writes `owner_note` rows; each edits/deletes only their own; a BEFORE trigger
  freezes author/kind/claim/created_at on update (append-oriented journal —
  edits change content, never provenance). Owner can NEVER rewrite the
  grower's history. Unrelated users see nothing, including photos.
- Photos: EXIF-stripped through the existing pipeline into the PRIVATE
  `grow-log` bucket (folder = claim id), party-scoped storage policies,
  signed URLs only. delete-account v3 purges grow-log folders for every claim
  the departing account dissolves.
- Stage progress is mapped to explicit stages (8 of them) — no fabricated
  percentages.
- `grow_log_context(claim)` returns read-only structured JSON (crops, stage,
  days-since-planted, recent entries, photo count) for Ask Gnome; party-gated;
  nothing lets AI write the journal.
- Harvest → "List Harvest on Gnome" prefills Create Listing (taxonomy node from
  the crop, title, description) and NEVER auto-publishes — the normal
  compliance gate runs on publish. Reusing a private Grow Log photo on a
  public listing is deliberately deferred (privacy boundary crossing needs an
  explicit copy flow).
