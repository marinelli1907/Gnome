# Gnome Agent Permission Matrix

Status: authoritative internal matrix. The database source of truth is `public.ai_agent_permission_registry`; this document explains the intended entries and review rules.

## Registry Contract

Each row must answer:

| Field | Meaning |
|---|---|
| agent_id | Executive identity, Gnome-only |
| tool | Deterministic RPC/service/report/action family |
| access_mode | `read`, `write`, `draft`, `propose`, or `execute` |
| data_classification | `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, or `RESTRICTED` |
| approval_class | `GREEN`, `YELLOW`, or `RED` |
| enabled | Whether the tool is callable/usable |
| reason | Least-privilege business reason |
| last_reviewed | Senior review date |

No executive agent may have wildcard permissions. No enabled registry row may be `RED`.

## Executive Matrix

| Agent | Green read/tools | Yellow prepare/propose | Red/prohibited |
|---|---|---|---|
| Zordy | `admin_executive_dashboard`, executive summaries, findings, heartbeats, Boardroom synthesis | Allowlisted `ai_action_requests` only | Secrets, raw SQL, unrestricted PII, payment/bank changes |
| Boon | Marketplace operations pack, seller concierge aggregates, reservation lifecycle | Complimentary plan proposal through approval queue | Billing changes, credential decisions, seller impersonation |
| Buddy | Horticulture pack, Garden Planner usage, plant-diagnosis metadata, crop trends | Horticultural recommendations/content drafts | Raw private images outside approved AI path, financial records |
| Enzo | Community pack, Market follows, retention aggregates, geographic activity | Community recommendations | Private messages outside scoped support/moderation task |
| Gemma | Growth pack, referral/promo aggregates, acquisition and funnel metrics | Promo/reward recommendations and allowlisted proposals | Grant rewards outside rules, fabricate attribution |
| Reddy | Marketing pack, campaign performance aggregates, public listing/Market trends, brand assets | Draft ads, social, email, push, seller campaign copy | External send/publish without approval |
| Senior | Security pack, audit aggregates, permission registry, provider status metadata | Security finding, kill-switch recommendation, deterministic pre-execution block | Reveal secrets, rotate prod secrets, disable users/services autonomously |
| Junior | Technology pack, release/migration/error/infrastructure aggregates | Fix/deploy recommendations | Production deployment without approval |
| Debb | Compliance pack, credential metadata/status, compliance rules, blocked attempts | Credential decision recommendations | Self-verify credentials, alter compliance rules without approval, send raw docs to general AI |
| Gee | Finance pack, subscription aggregates, plan mix, AI cost, seller-recorded GMV | Budget/campaign affordability recommendations | Move money, alter bank/payment destination, access complete card data |
| Kay | Support/trust pack, reports, dispute metadata, account/reservation friction trends | User restriction/moderation recommendations | Browse unrelated private content, suspend users without approval |
| Marty | Company intelligence pack, funnels, cohorts, retention, search demand, attribution quality | Experiment/metric recommendations | Reveal user identities unnecessarily, overstate tiny samples |

## Service-Only Tools

These functions are not client-callable:

- `admin_agent_data_pack_service(agent_id)`
- `ai_record_finding_service(...)`
- `ai_agent_tool_allowed_service(agent_id, tool, access_mode)`
- `run_agent_heartbeats()`
- `admin_executive_dashboard_service()`

Expected grants:

- `service_role`: execute where needed.
- `authenticated`: no execute on service-only functions.
- `anon`: no execute on service-only functions.

## Admin-Callable Tools

These are permission-checked for Admin users:

- `admin_executive_dashboard()` requires `ai.view` or owner.
- `admin_company_intelligence()` requires `ai.view` or owner.
- Existing approval functions still gate consequential actions: `admin_review_ai_action()` and `admin_execute_ai_action()`.

## Approval Integrity

Yellow action preview must show:

- Action
- Agent
- Why
- Evidence
- Affected records
- Expected result
- Risk
- Reversible
- Approval required

Execution remains a second audited step after approval. Payload hashes prevent post-approval parameter changes.

## Boardroom Isolation

Boardroom may invite any executive combination, but it does not combine permissions. Each agent receives only its own aggregate pack. Zordy sees summaries and the conversation for synthesis, not unrestricted raw rows.

## Security Tests

Required checks:

- Zordy can read summaries and cannot obtain secrets.
- Boon can inspect marketplace and cannot change billing.
- Buddy can inspect horticulture and cannot inspect private financial records.
- Enzo can inspect community aggregates and cannot read unrelated private messages.
- Gemma can inspect growth/referrals and cannot grant rewards outside approval/system rules.
- Reddy can draft campaign content and cannot send without approval.
- Senior can inspect security metadata and cannot reveal raw secrets.
- Junior can inspect technical state and cannot deploy without approval.
- Debb can inspect compliance metadata and cannot self-verify a seller credential.
- Gee can inspect financial aggregates and cannot move money.
- Kay can inspect authorized support context and cannot browse unrelated private data.
- Marty can inspect cross-company aggregates and cannot reveal user identities unnecessarily.

## Review Cadence

Senior reviews this registry before public release and whenever a new agent tool is added, enabled, or promoted from GREEN to YELLOW. RED capabilities remain disabled by design.
