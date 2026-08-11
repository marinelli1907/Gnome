# AI Listing Assistant (photo → draft → seller publishes)

Flow (unchanged by the provider pivot):
seller photo → EXIF/GPS stripped client-side → `analyze-listing-photo` edge
function → **Gemini `gemini-3.6-flash` multimodal** (JSON response mode) →
server-side field-by-field validation → taxonomy candidates matched against
the REAL `marketplace_taxonomy_nodes` tree (the model cannot invent nodes) →
draft populates the normal listing editor → **the seller reviews and
publishes; AI never auto-publishes.**

Server-side gates, in order:
1. JWT identity (payload identity is never trusted).
2. Effective-plan entitlement via `market_effective_plan` (paid OR
   complimentary Grower/Farm/Sponsor).
3. `reads_enabled` kill switch.
4. Atomic daily-cap reservation (`ai_reserve_slot`) BEFORE any provider call.
5. Provider chain: Gemini free tier; OpenAI `gpt-4o` / Anthropic
   `claude-haiku-4-5` only when `allow_paid_fallback=true` and keys exist.

Structured output: the model must return ONLY JSON matching the draft schema
(candidate_name, confidence, alternatives, title, description, taxonomy
terms, unit, price range/cents, listing type, quantity, compliance flag,
seller questions, multiple_items). Every field is clamped/validated in the
function; provider output never becomes authoritative data unchecked.

Rate limited (free tier): the app receives 503 `AI_BUSY` with "Gnome AI is
temporarily busy. Try again shortly." — manual listing creation always works.

Images are analyzed in memory, never stored; usage is logged per call with
provider-accurate paid-equivalent + $0 actual cost on the free tier.

`draft-listing` (the older quick-draft endpoint) follows the same pattern
with the 15-category enum enforced server-side.
