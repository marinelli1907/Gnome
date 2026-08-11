# AI Provider Setup (owner configuration)

## Strategy: Gemini free tier FIRST (pre-revenue = $0 AI)

Gnome's PRIMARY provider is the **Google Gemini Developer API free tier**.
Anthropic/OpenAI adapters remain fully wired as future/premium options, but
they are **opt-in paid fallbacks** — nothing calls them unless
`ai_settings.allow_paid_fallback = true` (default **FALSE**) AND their key is
set. Anthropic credits are NOT required to run Gnome.

Selected models (verified current on ai.google.dev, 2026-08-11 — all free-tier):

| Role | Model | Why |
|---|---|---|
| Gnome HQ, Compliance, Security, Finance | `gemini-3.6-flash` | latest stable Flash-class: strongest reasoning of the free line, agentic, multimodal, structured output |
| Routine specialists (ops/inventory/seeds/support/marketplace/growth/marketing/plots) + Ask Gnome | `gemini-3.5-flash-lite` | current Flash-Lite-class: fastest, highest free-tier rate headroom |
| Vision (Listing Assistant, draft-listing, planner photo diagnosis) | `gemini-3.6-flash` | Flash-class image understanding for identification/pricing quality |

Per-agent provider/model/fallback lives in `ai_agents`
(`admin_set_agent(p_agent, …, p_fallback_provider, p_fallback_model)`), so a
future upgrade — Gemini paid, OpenAI, or Anthropic — is an **Admin config
change, not a rewrite**. The shared adapter is
`supabase/functions/_shared/providers.ts` (bundled into every AI function).

## Owner setup — GEMINI_API_KEY (one time, ~2 minutes, free)

1. Go to **aistudio.google.com** → sign in with any Google account (no paid
   account or card needed for the free tier).
2. **Get API key** → *Create API key* → copy it.
3. Supabase Dashboard → project `fgybyghwcjlstqxkclch` → **Project Settings →
   Edge Functions → Secrets** → add `GEMINI_API_KEY` = the key → Save.
   (CLI alternative: `supabase secrets set GEMINI_API_KEY=...`.)
4. Done. Functions read the secret at invoke time — **no app rebuild or
   redeploy is needed to set or rotate the key.** AI HQ → provider health
   flips to "Gemini: configured" on the next refresh.

Keys live ONLY in edge-function secrets: never in Expo public env, web
bundles, the database, or either app binary. The Admin app shows
configured/healthy/last-success — never key material.

## Free-tier privacy (why tools send minimum data)

Google may use **free-tier** request content for product improvement (paid
tiers don't). Gnome therefore keeps MINIMUM-DATA tooling: agents receive
aggregate counts, ids, zones, and inventory needs — never buyer delivery
addresses, private pickup addresses, permit document contents, payment or
auth data, or full customer records. See GNOME_AI_OPERATIONS.md.

## Rate limits & fallback

- Free tiers 429 under load. The adapter does ONE bounded retry (~1.5s), then
  the next provider in the configured chain, then fails gracefully with
  **"Gnome AI is temporarily busy. Try again shortly."** No spinning retries.
- Boardroom turns never lose the owner's message — it is stored before any
  provider call; the room stays intact and resumes.
- With `allow_paid_fallback = false` (default): Gemini exhausted → graceful
  AI-unavailable state. **No silent paid spend.** Flip it (owner/kill-switch
  permission, audited: `admin_set_paid_fallback(true)`) only when you want
  OpenAI/Anthropic to catch overflow with real money.

## Cost controls (all server-enforced)

- Per-user daily caps: Listing Assistant via atomic `ai_reserve_slot`
  (`ai_settings.listing_daily_limit`); assistant/planner/draft via
  `ai_usage_increment` per-plan caps.
- **AI features switch** (`reads_enabled=false`) instantly halts ALL provider
  calls — Listing Assistant, Ask Gnome, planner, drafting, Boardroom.
- **AI actions switch** (`writes_paused`, ships PAUSED) blocks AI-initiated
  changes; independent of the features switch.
- Every call logs to `ai_usage_log`: provider, model, tokens, per-Boardroom
  `room_id`, `estimated_cost_cents` (paid-equivalent), `actual_cost_cents`
  ($0 on Gemini free tier), and `free_tier` flag.

## Health surface

`ai-health` edge function (admins with `ai.view`): per-provider configured
booleans, HQ's active provider/model, kill-switch + paid-fallback state, and
optional `{ping:true}` — one tiny real Gemini call, logged. AI HQ shows all
of it plus per-provider last-success/failures from `admin_ai_provider_stats()`.
