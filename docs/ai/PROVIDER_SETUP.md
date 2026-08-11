# AI Provider Setup (owner configuration)

Edge function secrets (Supabase → Functions → secrets):
- ANTHROPIC_API_KEY  (primary; claude-sonnet-5 vision) — a key exists for
  ask-gnome but was returning 502s at build time; verify billing/credits.
- OPENAI_API_KEY     (optional fallback; gpt-4o)

No provider keys ever ship in clients. Per-agent provider/model/fallback and
budgets live in `ai_agents` (admin_set_agent). Keys rotate server-side only.
