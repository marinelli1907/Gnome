# Gnome Commercial Model (locked 2026-08-11)

Gnome never takes a cut of neighbor-to-neighbor sales. Revenue = seller
subscriptions + Seasonal Seed Drop + listing promotions + pickup add-ons +
bundles. Flywheel: GROW → LIST → PROMOTE → SELL → FULFILL → GROW AGAIN.

| | Neighbor | Grower | Farm | Sponsor* |
|---|---|---|---|---|
| Price | Free | $9.99/mo | $29.99/mo | invite |
| Active listings | 5 | **25** (was 50) | Unlimited | Unlimited |
| Pickup locations | 1 | 2 (+$5/mo each) | 5 | 10 |
| Delivery | basic (15 mi) | advanced | advanced | advanced |
| AI Listing Assistant | — | ✓ | ✓ | ✓ |
| Promotions/month | 0 | 3 | 10 | 10 |

*Sponsor is not a public pricing tier.

**Single source of truth:** every number above lives in `plan_limits`
(`max_active_listings`, `max_pickup_locations`, `included_boost_credits`,
`ai_listing_assistant`, `advanced_delivery`, `extra_location_fee_cents`,
`price_cents`) and is served to clients via `my_plan_entitlements()` /
`market_effective_plan()`. Web pricing + app upgrade screens render from the
live table; hardcoded copy is fallback-only.

**Grower 50→25:** applied as a `plan_limits` UPDATE. The existing
`enforce_plan_limit` trigger blocks NEW activations at the cap and never
touches existing rows — an over-cap Grower keeps every listing and simply
can't publish more until below 25. At change time production had one Grower
market with 2 active listings (nobody over cap). No data was archived.

**Other products:** Featured Listing Promotion $3.99 / 7 days (see
PROMOTIONS.md); Seasonal Seed Drop $24.99/season, up to 4/year (see
docs/seed-drop/SEASONAL_SUBSCRIPTION.md); bundles (see BUNDLES.md).
Canonical product keys live in `billing_products`; Stripe price IDs are
**owner config, all currently null — no live checkout for any of them yet.**
