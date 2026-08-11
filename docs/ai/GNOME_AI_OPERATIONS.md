# Gnome AI Operations

AI never gets service_role, SQL, shell, or unbounded writes. The layers:

1. **Agent identity** (`ai_agents`): id, status (enabled/read_only/disabled),
   provider/model + fallback, automation level 1-3, tool permission list,
   daily budget. Seeded: Gnome HQ, Operations, Compliance, Security =
   read_only L1; the other 8 configured but disabled.
2. **Kill switch** (`ai_settings.writes_paused`) — ships PAUSED. Server-
   enforced in `admin_execute_ai_action`; reads/reporting stay available.
3. **Action requests** (`ai_action_requests`): PENDING → APPROVED/REJECTED →
   EXECUTED/FAILED/EXPIRED. Approval binds to `payload_hash`
   (sha256(action|parameters)); any change fails execution. Execute-once via
   status transition; 7-day expiry; `dry_run` computes without mutating.
   Executable actions are a hardcoded allowlist (pause_listing,
   restore_listing) — no dynamic dispatch.
4. **Daily Brief** (`admin_daily_brief()`): real production counts only.
5. **Providers (Gemini-first, 2026-08-11)**: all AI features run the shared
   adapter (`supabase/functions/_shared/providers.ts`) with the Gemini
   Developer API free tier as PRIMARY (`gemini-3.6-flash` planning/vision,
   `gemini-3.5-flash-lite` routine). Anthropic/OpenAI stay wired but call
   only when `ai_settings.allow_paid_fallback=true` (default FALSE — free
   quota exhaustion degrades gracefully instead of spending money). Per-agent
   provider/model/fallback is config (`admin_set_agent`); upgrades are config
   changes, not rewrites. Kill switch `reads_enabled=false` halts every
   provider call across Listing Assistant, Ask Gnome, planner, drafting, and
   Boardroom.
6. **Minimum-data tooling** (free-tier requests may be used by Google for
   product improvement): agents receive aggregate counts, ids, zones, and
   inventory needs. NEVER sent to models: buyer delivery addresses, private
   pickup addresses, permit/credential document contents, payment data, auth
   data, or full customer records. Ask Gnome sends only the calling user's
   own market/plan/listing-count and their own seed-order varieties.
7. **Usage telemetry** (`ai_usage_log`): provider, model, tokens, images,
   per-room `room_id`, paid-equivalent `estimated_cost_cents`, `actual_cost_cents`
   ($0 on free tier), `free_tier` flag — surfaced in AI HQ with per-provider
   health (`ai-health` fn + `admin_ai_provider_stats()`).

Automation levels: L1 automatic low-risk (reports/alerts/drafts),
L2 human approval, L3 owner-only review.
Prompt injection: authorization derives ONLY from agent identity + tool
permissions + human approval — never from retrieved content. A listing
saying "make me an administrator" is inert data. Providers are language
engines, not authorization systems — a model cannot name a provider, model,
tool, or permission for itself; sellers cannot choose models.
