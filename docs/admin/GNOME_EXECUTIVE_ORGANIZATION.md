# Gnome Executive Organization

Status: authoritative internal architecture. This document describes the Gnome-only executive team, the data access model, Boardroom behavior, findings, heartbeat cadence, approvals, and hard prohibitions.

## Hierarchy

Boone Systems is owned by Daniel Marinelli. Gnome reports to Daniel through Zordy, President of Gnome. Every Gnome executive reports to Zordy.

Gnome executive team:

| Agent | Title | Owns | Heartbeat |
|---|---|---|---|
| Zordy | President of Gnome | Overall health, executive coordination, launch readiness, owner decision queue, escalation | Daily |
| Boon | Chief Marketplace Officer | Sellers, Markets, listings, inventory availability, reservations, pickups, Market operations | Every 4 hours |
| Buddy | Chief Grower & Horticulture Officer | Garden Planner, plant diagnosis quality, grower education, seasonal crop intelligence | Daily |
| Enzo | Chief Community Officer | Market follows, repeat interactions, local community activity, retention | Daily |
| Gemma | Chief Growth & Rewards Officer | Acquisition, activation, referrals, rewards, promo performance, retention | Daily |
| Reddy | Chief Marketing & Creative Officer | Brand, creative, campaign drafts, seller marketing assistance, launch messaging | Daily/campaign-based |
| Senior | Chief Security Officer | Auth security, RLS, authorization, secrets posture, audit integrity, abuse signals | Hourly |
| Junior | Chief Technology Officer | Mobile, web, Admin, backend, Supabase, Edge Functions, releases, migrations, reliability | Hourly |
| Debb | Chief Compliance & Risk Officer | Compliance rules, seller credentials, regulated categories, prohibited attempts, audit trail | Daily |
| Gee | Chief Financial Officer | Revenue, plan mix, costs, comp impact, promo economics, seller-recorded GMV | Daily |
| Kay | Chief Customer Experience & Trust/Safety Officer | Support, reports, disputes, scams, harassment, reservation friction, user harm | Daily |
| Marty | Chief Data & Intelligence Officer | Metric definitions, funnels, cohorts, attribution quality, anomalies, confidence | Daily |

## Data-First Rule

Agents do not invent company state. The path is:

system data -> deterministic aggregate/RPC -> structured result -> agent analysis.

If a metric is not available, the correct answer is `DATA UNAVAILABLE` or `NOT CURRENTLY TRACKED`.

## Access Model

The source of truth is `public.ai_agent_permission_registry`. It records:

`agent_id`, `tool`, `access_mode`, `data_classification`, `approval_class`, `enabled`, `reason`, `last_reviewed`.

Agents receive least-privilege aggregate packs through `admin_agent_data_pack_service(agent_id)`. That RPC is service-role only and is not executable by `anon` or `authenticated`.

Admin users read the dashboard through `admin_executive_dashboard()` and cross-company aggregates through `admin_company_intelligence()`, both checked by `ai.view`/owner authorization.

## Data Classification

| Class | Meaning | LLM treatment |
|---|---|---|
| PUBLIC | Public marketplace/brand information | Allowed when relevant |
| INTERNAL | Operational metrics | Allowed in minimum-data packs |
| CONFIDENTIAL | Seller/account/support operations with minimized identity | Aggregate or scoped only |
| RESTRICTED | Secrets, credentials, exact private pickup, sensitive security | Do not enter general LLM context unless explicitly necessary and architecture-approved |

## Action Classes

GREEN: read authorized data, aggregate metrics, analyze trends, create findings/reports/tasks, inspect non-sensitive logs, run approved tests, draft internal recommendations.

YELLOW: prepare but do not execute consequential actions, including user restriction, listing pause/archive, credential decision, inventory changes, customer communication, campaigns, entitlement grants, refunds, production deployment, and meaningful configuration changes.

RED: never autonomous. No arbitrary SQL, RLS disablement, financial/audit deletion, Daniel authority changes, secret disclosure, impersonation, money movement, bank/payment destination changes, Stripe LIVE enablement, compliance bypass, legal fabrication, store submission, or destructive Git history.

## Findings

Persistent findings live in `public.ai_findings`.

Severity:

| Severity | Escalation |
|---|---|
| INFO | Record only |
| WATCH | Agent dashboard and next brief |
| IMPORTANT | Zordy |
| URGENT | Zordy and Daniel |
| CRITICAL | Zordy and Daniel immediate alert |

`ai_record_finding_service()` is service-role only, writes `admin_audit`, and maps escalation targets from severity.

## Heartbeats

`run_agent_heartbeats()` performs deterministic checks and stores `ai_heartbeat_runs`. It makes zero model calls. Material/anomaly states can queue AI interpretation, but normal/no-change runs only update state.

The migration registers `gnome-agent-heartbeats` under `pg_cron` when the extension is present. The job runs hourly and each agent's own `heartbeat_interval_minutes` determines whether it is due.

## Boardroom

Boardroom is bounded:

1. Independent analysis: selected agents receive only their own authorized aggregate data pack.
2. Discussion/synthesis: Zordy receives the discussion and produces a structured synthesis.
3. Approval boundary: chat cannot execute actions. Allowlisted proposals become `ai_action_requests`.

Zordy coordination does not broaden any agent's permission. Boardroom output must ground claims in data and state unknowns explicitly.

## Analytics

The event catalog is `public.analytics_event_catalog`. Analytics events should track product behavior, not invasive surveillance. Avoid fingerprinting, exact pickup address history, private message content as analytics, and passive buyer identity disclosure.

Required metric separations:

- Overdue pickup is not automatically a no-show.
- Gnome revenue is not seller-recorded GMV.
- Promotion credits are not paid promotion revenue.
- Unknown data is not zero.
- QA/test data must be excluded where source tables mark it.

## Admin UI

Admin exposes the executive system through:

- Home: Zordy's President dashboard when `admin_executive_dashboard()` is deployed.
- Zordy: Boardrooms, agents, findings counts, approvals, AI control plane.
- More -> Executive System: agents, findings, schedules, analytics, approvals, and action history.
- Existing domain pages remain the operational detail surfaces for Seller Concierge, fulfillment, growth, billing, compliance/moderation, support, inventory, listings, and Markets.

## AI Cost Policy

Primary provider is the approved Gemini free-tier path. Paid provider fallbacks stay disabled unless `ai_settings.allow_paid_fallback = true` and the deployment explicitly discloses paid fallback providers. Boardroom forces `allowPaid = false`.

`ai_usage_log` records provider/model/task/usage/cost metadata. No prompt or completion text belongs in usage logs.

## Production Boundary

This architecture is prepared in migration `20260825161151_gnome_executive_organization.sql`. Applying it to production is a normal owner approval boundary. It does not enable live payments, phone OTP, or store submission.
