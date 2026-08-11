# AI Listing Assistant

Eligibility: resolved effective plan ≠ free (paid OR complimentary
Grower/Farm/Sponsor) — checked SERVER-SIDE in the edge function via
`market_effective_plan`, never "a Stripe sub exists". Neighbor sees the
locked upsell.

Flow: Sell → "Take a photo — Gnome drafts it" → camera/library → on-device
resize+re-encode (EXIF/GPS stripped, image never stored) →
`analyze-listing-photo` → validated structured draft (title, warm human
description, price range, unit, quantity guess, seller questions,
multi-item detection) + taxonomy candidates matched against the REAL tree
(AI cannot invent nodes) → seller picks category → normal post editor opens
prefilled → seller edits → publishes. AI never publishes; plan limits,
taxonomy, and compliance enforcement run unchanged at publish.

Failure UX: "Gnome couldn't confidently identify this item" → Try Another
Photo / Create Manually. Provider down → manual listing unaffected.
Multi-item: contract returns up to 4 extra items; v1 UI ships single-draft
and names the others (documented limitation).

Cost control: per-user daily cap (`ai_settings.listing_daily_limit`, default
20), every call logged to `ai_usage_log` (provider/model/tokens/est. cost).
