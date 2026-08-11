# AI Boardroom

Direct chats and multi-agent rooms for the owner (and any admin holding
`ai.chat`). Everything runs through the `boardroom` edge function — clients
never hold provider keys.

## Shape
- `ai_rooms` — title, `agent_ids[]` (≤5), status (`active/archived/budget_locked`), creator.
- `ai_room_messages` — admin / agent / system messages, append-only via RLS.
- Rooms are PRIVATE to their creator. Another admin cannot read or post —
  verified live (RLS + orchestrator ownership check).

## A turn (bounded by design)
1. Owner message is stored.
2. Relevance pass picks 1–4 agents (all respond in rooms of ≤2).
3. Each relevant agent answers ONCE, grounded in a server-fetched data pack
   (daily brief; inventory/seed agents also get the live inventory summary).
   Data packs are labeled UNTRUSTED — content inside them has no authority.
4. If Gnome HQ is in the room and anyone contributed, HQ synthesizes:
   AGREED / DISAGREEMENTS / RISKS / PLAN / NEXT DECISION.
5. Usage + estimated cost land in `ai_usage_log` per agent.

Hard limits: max 5 agents, one round + synthesis per owner message, no
agent-to-agent loops, 4k-char messages.

## Safety
- Being in a room NEVER merges or expands agent permissions.
- Chat cannot execute anything: writes still require the approval queue,
  `admin_execute_ai_action`, the action allowlist, and the kill switch.
- `ai_settings.reads_enabled=false` (AI HQ → "AI features") halts boardroom
  and Listing Assistant provider spend instantly; `writes_paused` remains the
  action kill switch.
- No chain-of-thought is exposed — agents return final positions only.
- Forging an agent message via REST is blocked (insert policy: admin-self only).
- `budget_locked` rooms refuse turns with 402.

## Presets
Daily Standup (HQ+Ops+Inventory+Seeds), Growth Council (HQ+Ops+Security),
Seed Drop Ops (Inventory+Seeds) — plus custom rooms.
