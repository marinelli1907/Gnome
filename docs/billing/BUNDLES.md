# Bundles — Grower/Farm + Seed Drop

Working commercial targets (config only, NOT live prices):
- **Grower + Seed Drop ≈ $199/yr** (`GNOME_GROWER_SEED_BUNDLE`, 19900)
- **Farm + Seed Drop ≈ $429/yr** (`GNOME_FARM_SEED_BUNDLE`, 42900)
Both rows exist in `billing_products` with `active=false` and null Stripe
IDs — OWNER CONFIG REQUIRED before any exposure.

**Entitlement architecture (no fake plan types):** a bundle purchase resolves
into the two EXISTING entitlement systems — the webhook records a normal
`market_subscriptions` plan row (grower/farm → seller capabilities keep
flowing through `market_effective_plan()` untouched) AND activates the
buyer's `seed_drop_subscriptions` row (seasonal access). Cancelling the
bundle ends both at period end. There is deliberately no
`GROWER_SEED_SUPER_SPECIAL` plan enum; composition over new types. Mixed
states (comp Grower + paid Seed Drop, etc.) already work because the two
systems are independent.

Pricing page shows the bundles as "coming" prose only — no purchase UI until
Stripe products/prices exist and the webhook mapping is exercised.
