# AI Action Safety (test-proven 2026-08-10)

- READ_ONLY admin cannot approve (NOT_AUTHORIZED)     [live PASS]
- Kill switch blocks execution while paused           [live PASS]
- Approved action executes exactly once               [live PASS]
- Second execution refused (NOT_APPROVED)             [live PASS]
- Request rows not client-writable (even SUPER: 403)  [live PASS]
- Payload-hash binding: server recomputes sha256(action|parameters) at
  execution; mismatch → FAILED (tamper path requires service role, which
  clients never hold)
- Full audit: approve / execute / pause-resume rows   [live PASS]
- Expiry: requests auto-EXPIRE at review/execute time after 7 days

## Agent actions — the propose→approve→execute pipeline (2026-08-11, 0082)

Agents can now DO bounded things, never autonomously. The chain:

1. **Propose** — in a Boardroom, if (and only if) the owner asked for a change
   the agent is scoped for, the agent emits one trailing `ACTION>>{json}` line.
   The orchestrator strips it from the visible message and calls
   `ai_file_action_request` (service-role only — an authenticated user calling
   it gets `permission denied`; live-tested). That function re-validates, on
   the SERVER, that the agent is enabled, holds `create_owner_approval_request`,
   and that the action is in the agent's allowlist — model output is never
   trusted for authorization. Result: a PENDING `ai_action_requests` row with
   hash-locked parameters, risk tier (grant_comp_plan = owner-only L3, rest
   L2), 7-day expiry, and an `AI_ACTION_PROPOSED` audit row. A system line
   tells the owner to review it in AI HQ.
2. **Approve** — owner taps Approve in AI HQ (`admin_review_ai_action`,
   `ai.approve_actions`; L3 needs owner). Nothing has changed yet.
3. **Execute** — owner taps Execute (`admin_execute_ai_action`). The allowlist
   (9 actions: pause/restore_listing, adjust_inventory, quarantine_lot,
   end_promotion, grant_promo_credits, grant_comp_plan, cancel_seed_order,
   resolve_report) delegates to the EXISTING permission-checked, audited
   definer RPCs — so the action inherits the human approver's gates.

Every guard verified live (9/9): proposal stays PENDING with zero side effects;
execute-before-approve refused; approve→execute produces the real effect;
double-execute refused (status transition); payload tampered after approval
refused (`PAYLOAD_CHANGED_AFTER_APPROVAL`); kill switch (`writes_paused`, ships
paused) blocks execution; out-of-scope/disabled agent refused; direct client
filing refused. Prompt injection is inert: DATA is labeled untrusted, content
inside it can't emit a valid ACTION (only the model's own owner-directed reply
can), and even a forged proposal still lands in PENDING behind the owner's tap.

Enabled proposers today: gnome_hq, operations, compliance, security, inventory,
seeds. marketplace/support/finance/growth carry the permission but are disabled
until the owner enables them.
