# Reserve a Plot (M11)

A buyer reserves a plot in a pro grower's garden and picks the crop; the
grower grows it. "Turn your whole garden into income" — growers pre-sell the
season before planting.

## Phase 1 — SHIPPED 2026-08-06 (no money handling)

Everything settles in person, exactly like every other Gnome sale. Gnome
stays a facilitation platform: no escrow, no cut, no funds held.

**Schema** (migrations 0021 + 0022, applied live):
- `listing_type` enum + `'plot'`. One listing = ONE reservable plot
  (post one listing per plot). Price required = reservation price.
  Default expiry 45 days.
- Plan gate: `enforce_plot_plan` BEFORE-insert trigger — offering plots
  requires a grower/farm/sponsor market plan (`PLOTS_REQUIRE_PLAN` errcode,
  caught by the web sell form → upgrade prompt).
- Reservations = claims with `claim_type='plot_reservation'`,
  `buyer_note` = requested crop (required), `agreed_price_cents` = price
  snapshot, `payment_status='external'`. The existing claim-approval trigger
  does the heavy lifting: approve → listing flips 'claimed' (off the
  marketplace) + sibling requests auto-decline.

**Web:**
- `/plots` — marketplace page: how-it-works, open plots grid, grower CTA.
- `/sell?type=plot` — 5th listing type: reservation price, plot-size field,
  plan-gate error handling.
- Listing detail — "Reserve this plot" flow (sign-in, crop request → claim).
- `/my` — "Plot reservations" section: grower approves/declines requests.
- `/browse?type=plot` filter chip, homepage band, nav + footer links,
  pricing-page plan bullets.

**Not in Phase 1:** app (expo) UI for plots (plot listings render in the app
feed with generic styling; reservations appear in the app's Requests view),
multi-plot inventory on one listing, grower progress updates, deposits.

## Phase 2 — escrowed reservations (SPEC ONLY, gated on Vanth review)

The buyer pays at reservation; funds are released to the grower when the
harvest is delivered. This is the version where Gnome earns a cut.

- **Rails:** Stripe Connect Express accounts for pro growers. Buyer pays a
  destination charge at approval; funds transfer to the grower on confirmed
  delivery (delayed transfer / separate charge+transfer). Structured this
  way, Stripe is the regulated money transmitter — Gnome avoids MTL/surety
  bond territory. Platform fee 10–15% of the reservation.
- **Delivery confirmation:** buyer taps "harvest received" (or N-day
  auto-release after the grower marks delivered, with a dispute window).
- **Crop-failure policy (required before first dollar):** written refund
  rules — e.g. full refund if nothing is delivered, pro-rated for partial
  harvest; grower can offer a replant. Buyer protection is the product.
- **Terms rework (lawyer hour):** seller responsibility for food laws,
  indemnification, Gnome's role as payment facilitator, dispute process.
- **Risk/insurance posture** (researched 2026-08-06, not legal advice):
  - Phase 1 changes nothing: same bulletin-board posture as today.
  - Phase 2: tech E&O + cyber + general liability for the LLC runs roughly
    $1–3k/yr from Hiscox/Next/local commercial broker — get real quotes.
  - Food liability stays with the grower (cottage food laws), but expect
    Gnome to be named in any suit → Terms indemnification + the insurance
    above are the two lines of defense.
  - Help-center note for growers: homeowner's policies usually EXCLUDE
    business activity — tell pro growers to check their coverage.
  - Dispute losses are handled by policy design (confirmation flow, refund
    reserve, capped reservation amounts early), not insurance.
- **Launch order:** validate Phase 1 demand first. If plots get reserved,
  spec the Connect build in detail for Vanth; the fee only makes sense once
  escrow is the service being sold.
