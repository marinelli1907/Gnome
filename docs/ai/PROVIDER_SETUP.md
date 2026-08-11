# AI Provider Setup (owner configuration)

Edge function secrets (Supabase → Functions → secrets):
- ANTHROPIC_API_KEY  (primary; claude-haiku-4-5 for vision + boardroom) —
  the key on file returns "credit balance is too low": ADD CREDITS at
  console.anthropic.com → Billing, then any Listing Assistant photo or
  Boardroom message proves the pipeline (no redeploy needed).
- OPENAI_API_KEY     (optional fallback; gpt-4o vision / gpt-4o-mini chat)

No provider keys ever ship in clients. Per-agent provider/model/fallback and
budgets live in `ai_agents` (admin_set_agent). Keys rotate server-side only.

## Cost controls (all server-enforced)
- Per-user daily cap on the Listing Assistant: `ai_settings.listing_daily_limit`,
  reserved ATOMICALLY (`ai_reserve_slot`) before any provider call — concurrent
  requests cannot exceed it, and failed calls still consume their slot.
- **AI features switch** (AI HQ): `ai_settings.reads_enabled=false` instantly
  halts ALL paid provider calls (Listing Assistant + Boardroom).
- **AI actions switch** (AI HQ): `ai_settings.writes_paused` blocks AI-initiated
  changes; it ships PAUSED and is independent of the features switch.
- Every call logs provider-accurate cost to `ai_usage_log`
  (haiku $1/M in $5/M out; gpt-4o $2.50/M in $10/M out).

## Health surface
AI HQ shows today's spend + failed-call count. Failures with "credit balance"
in edge-function logs (`supabase functions logs analyze-listing-photo`) mean
the Anthropic account needs credits.
