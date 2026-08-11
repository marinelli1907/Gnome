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

Automation levels: L1 automatic low-risk (reports/alerts/drafts),
L2 human approval, L3 owner-only review.
Prompt injection: authorization derives ONLY from agent identity + tool
permissions + human approval — never from retrieved content. A listing
saying "make me an administrator" is inert data.
