-- Gnome executive organization, permissions, deterministic intelligence packs,
-- findings, and heartbeat state.
--
-- This is prepared for normal migration review. It does not enable live
-- payments, phone OTP, store submission, arbitrary SQL, or autonomous yellow
-- mutations.

-- ---------------------------------------------------------------------------
-- 1. Executive metadata on the existing ai_agents table
-- ---------------------------------------------------------------------------
alter table public.ai_agents
  add column if not exists data_classification text not null default 'INTERNAL',
  add column if not exists heartbeat_interval_minutes integer,
  add column if not exists last_analysis_at timestamptz,
  add column if not exists next_check_at timestamptz,
  add column if not exists owner_summary text;

alter table public.ai_agents drop constraint if exists ai_agents_department_chk;
alter table public.ai_agents add constraint ai_agents_department_chk check (department in (
  'EXEC','MARKETPLACE','HORTICULTURE','COMMUNITY','GROWTH','MARKETING',
  'SECURITY','TECHNOLOGY','COMPLIANCE','FINANCE','CUSTOMER_EXPERIENCE',
  'DATA','OPERATIONS','GENERAL'
));

alter table public.ai_agents drop constraint if exists ai_agents_data_classification_chk;
alter table public.ai_agents add constraint ai_agents_data_classification_chk
  check (data_classification in ('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED'));

alter table public.ai_agents drop constraint if exists ai_agents_heartbeat_positive_chk;
alter table public.ai_agents add constraint ai_agents_heartbeat_positive_chk
  check (heartbeat_interval_minutes is null or heartbeat_interval_minutes between 15 and 10080);

insert into public.ai_agents (
  id,name,status,provider,model,fallback_provider,fallback_model,automation_level,
  permissions,daily_budget_cents,title,department,reports_to,authority_level,
  charter,data_classification,heartbeat_interval_minutes,owner_summary
) values
  ('gnome_hq','Zordy','read_only','gemini','gemini-3.6-flash',null,null,1,
   array['executive.summary.read','findings.read','heartbeat.read','boardroom.synthesize','create_owner_approval_request'],
   0,'President of Gnome','EXEC',null,'PROPOSE',
   'Owns Gnome health, launch readiness, cross-functional priorities, executive coordination, owner decision queues, and unresolved executive findings.',
   'INTERNAL',1440,'Daily president dashboard and escalation synthesis.'),
  ('boon','Boon','read_only','gemini','gemini-3.5-flash-lite',null,null,1,
   array['marketplace.summary.read','seller_concierge.summary.read','reservation.lifecycle.read','create_owner_approval_request'],
   0,'Chief Marketplace Officer','MARKETPLACE','gnome_hq','PROPOSE',
   'Runs seller activation, Markets, listings, inventory availability, reservation health, pickups, and Market operations.',
   'CONFIDENTIAL',240,'Marketplace operations and seller health.'),
  ('buddy','Buddy','read_only','gemini','gemini-3.5-flash-lite',null,null,1,
   array['horticulture.summary.read','garden_planner.summary.read','plant_diagnosis.summary.read'],
   0,'Chief Grower & Horticulture Officer','HORTICULTURE','gnome_hq','RECOMMEND',
   'Owns Garden Planner, plant health, grower education, seasonal crop intelligence, and horticulture quality monitoring.',
   'INTERNAL',1440,'Gardening and grower intelligence.'),
  ('enzo','Enzo','read_only','gemini','gemini-3.5-flash-lite',null,null,1,
   array['community.summary.read','market_follows.summary.read','retention.summary.read'],
   0,'Chief Community Officer','COMMUNITY','gnome_hq','RECOMMEND',
   'Owns community engagement, Market follows, repeat interactions, geographic community activity, and social marketplace health.',
   'INTERNAL',1440,'Community engagement and retention.'),
  ('gemma','Gemma','read_only','gemini','gemini-3.5-flash-lite',null,null,1,
   array['growth.summary.read','referrals.summary.read','promos.summary.read','create_owner_approval_request'],
   0,'Chief Growth & Rewards Officer','GROWTH','gnome_hq','PROPOSE',
   'Owns acquisition, activation, referrals, promo performance, retention, reactivation, and seller-density growth strategy.',
   'CONFIDENTIAL',1440,'Growth, referrals, and activation.'),
  ('reddy','Reddy','read_only','gemini','gemini-3.5-flash-lite',null,null,1,
   array['marketing.summary.read','campaign.summary.read','creative.draft'],
   0,'Chief Marketing & Creative Officer','MARKETING','gnome_hq','RECOMMEND',
   'Owns brand consistency, campaign drafts, seller marketing assistance, product storytelling, seasonal campaigns, and public launch messaging.',
   'PUBLIC',1440,'Marketing and creative intelligence.'),
  ('senior','Senior','read_only','gemini','gemini-3.6-flash',null,null,1,
   array['security.summary.read','audit.summary.read','agent.permissions.read','findings.create'],
   0,'Chief Security Officer','SECURITY','gnome_hq','RECOMMEND',
   'Protects authentication, RLS, authorization, agent/tool security, secrets posture, suspicious activity, rate limits, and audit integrity.',
   'RESTRICTED',60,'Security health and permission review.'),
  ('junior','Junior','read_only','gemini','gemini-3.6-flash',null,null,1,
   array['technology.summary.read','release.summary.read','migration.summary.read','errors.summary.read'],
   0,'Chief Technology Officer','TECHNOLOGY','gnome_hq','RECOMMEND',
   'Owns mobile, web, Admin, backend, Supabase, Edge Functions, releases, migrations, crashes, performance, and dependency health.',
   'INTERNAL',60,'Technical health and release readiness.'),
  ('debb','Debb','read_only','gemini','gemini-3.6-flash',null,null,1,
   array['compliance.summary.read','credentials.summary.read','taxonomy.compliance.read'],
   0,'Chief Compliance & Risk Officer','COMPLIANCE','gnome_hq','RECOMMEND',
   'Owns product compliance, seller credential metadata, permits, licensing, Ohio rules, prohibited products, and compliance audit trail.',
   'CONFIDENTIAL',1440,'Compliance risk and credential queues.'),
  ('gee','Gee','read_only','gemini','gemini-3.6-flash',null,null,1,
   array['finance.summary.read','subscriptions.summary.read','seller_gmv.summary.read','ai_cost.summary.read'],
   0,'Chief Financial Officer','FINANCE','gnome_hq','RECOMMEND',
   'Observes subscription revenue, complimentary-plan impact, promotion economics, costs, seller-recorded GMV, forecasts, and plan mix. Does not move money.',
   'CONFIDENTIAL',1440,'Financial intelligence without money movement.'),
  ('kay','Kay','read_only','gemini','gemini-3.5-flash-lite',null,null,1,
   array['support.summary.read','trust_safety.summary.read','reservation_disputes.summary.read'],
   0,'Chief Customer Experience & Trust/Safety Officer','CUSTOMER_EXPERIENCE','gnome_hq','RECOMMEND',
   'Owns support, complaints, disputes, moderation reports, scams, harassment, account issues, reservation friction, and user harm trends.',
   'CONFIDENTIAL',1440,'Support and trust/safety trends.'),
  ('marty','Marty','read_only','gemini','gemini-3.5-flash-lite',null,null,1,
   array['analytics.summary.read','funnels.summary.read','cohorts.summary.read','referrals.summary.read','zordy_usage.summary.read'],
   0,'Chief Data & Intelligence Officer','DATA','gnome_hq','RECOMMEND',
   'Owns metric definitions, KPI quality, funnels, cohorts, retention, attribution quality, anomalies, forecasting, and statistical confidence.',
   'INTERNAL',1440,'Company intelligence and metric skepticism.')
on conflict (id) do update set
  name=excluded.name,
  status=excluded.status,
  provider=excluded.provider,
  model=excluded.model,
  fallback_provider=null,
  fallback_model=null,
  automation_level=excluded.automation_level,
  permissions=(select array_agg(distinct p order by p)
                 from unnest(public.ai_agents.permissions || excluded.permissions) p),
  daily_budget_cents=0,
  title=excluded.title,
  department=excluded.department,
  reports_to=excluded.reports_to,
  authority_level=excluded.authority_level,
  charter=excluded.charter,
  data_classification=excluded.data_classification,
  heartbeat_interval_minutes=excluded.heartbeat_interval_minutes,
  owner_summary=excluded.owner_summary,
  updated_at=now();

update public.ai_agents
   set next_check_at = coalesce(next_check_at, now())
 where id in ('gnome_hq','boon','buddy','enzo','gemma','reddy','senior','junior','debb','gee','kay','marty');

-- ---------------------------------------------------------------------------
-- 2. Permission registry, event catalog, findings, and heartbeat runs
-- ---------------------------------------------------------------------------
create table if not exists public.ai_agent_permission_registry (
  id bigint generated always as identity primary key,
  agent_id text not null references public.ai_agents(id) on delete cascade,
  tool text not null,
  access_mode text not null check (access_mode in ('read','write','draft','propose','execute')),
  data_classification text not null check (data_classification in ('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
  approval_class text not null check (approval_class in ('GREEN','YELLOW','RED')),
  enabled boolean not null default true,
  reason text not null,
  last_reviewed date not null default current_date,
  created_at timestamptz not null default now(),
  unique(agent_id, tool, access_mode)
);

create table if not exists public.analytics_event_catalog (
  event_name text primary key,
  domain text not null,
  data_classification text not null check (data_classification in ('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
  retention_days integer check (retention_days is null or retention_days > 0),
  pii_allowed boolean not null default false,
  notes text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_findings (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.ai_agents(id) on delete restrict,
  domain text not null,
  severity text not null check (severity in ('INFO','WATCH','IMPORTANT','URGENT','CRITICAL')),
  title text not null,
  summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  metric_snapshot jsonb not null default '{}'::jsonb,
  confidence text not null default 'MEDIUM' check (confidence in ('LOW','MEDIUM','HIGH')),
  recommended_action text,
  status text not null default 'OPEN' check (status in ('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED')),
  escalated_to text[] not null default '{}',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists ai_findings_agent_status_idx on public.ai_findings(agent_id,status,created_at desc);
create index if not exists ai_findings_open_severity_idx on public.ai_findings(severity,created_at desc)
  where status in ('OPEN','ACKNOWLEDGED');

create table if not exists public.ai_heartbeat_runs (
  id bigint generated always as identity primary key,
  agent_id text not null references public.ai_agents(id) on delete cascade,
  deterministic_status text not null check (deterministic_status in ('NORMAL','NO_MATERIAL_CHANGE','WATCH','ANOMALY','MATERIAL_CHANGE','ERROR')),
  metric_snapshot jsonb not null default '{}'::jsonb,
  ai_interpretation_queued boolean not null default false,
  provider text,
  model text,
  created_at timestamptz not null default now()
);
create index if not exists ai_heartbeat_runs_agent_created_idx on public.ai_heartbeat_runs(agent_id,created_at desc);

alter table public.ai_agent_permission_registry enable row level security;
alter table public.analytics_event_catalog enable row level security;
alter table public.ai_findings enable row level security;
alter table public.ai_heartbeat_runs enable row level security;

drop policy if exists ai_perm_registry_read on public.ai_agent_permission_registry;
create policy ai_perm_registry_read on public.ai_agent_permission_registry
  for select using (public.admin_has_perm('ai.view') or public.admin_is_owner());
drop policy if exists analytics_catalog_read on public.analytics_event_catalog;
create policy analytics_catalog_read on public.analytics_event_catalog
  for select using (public.admin_has_perm('ai.view') or public.admin_has_perm('system.view') or public.admin_is_owner());
drop policy if exists ai_findings_read on public.ai_findings;
create policy ai_findings_read on public.ai_findings
  for select using (public.admin_has_perm('ai.view') or public.admin_is_owner());
drop policy if exists ai_heartbeat_runs_read on public.ai_heartbeat_runs;
create policy ai_heartbeat_runs_read on public.ai_heartbeat_runs
  for select using (public.admin_has_perm('ai.view') or public.admin_is_owner());

revoke insert, update, delete, truncate, references, trigger
  on public.ai_agent_permission_registry, public.analytics_event_catalog,
     public.ai_findings, public.ai_heartbeat_runs
  from anon, authenticated;
grant select on public.ai_agent_permission_registry, public.analytics_event_catalog,
  public.ai_findings, public.ai_heartbeat_runs to authenticated;

insert into public.analytics_event_catalog(event_name,domain,data_classification,retention_days,pii_allowed,notes)
values
  ('ACCOUNT_CREATED','account','INTERNAL',730,false,'Account creation event. Use first-party ids only; no passwords or secrets.'),
  ('ACCOUNT_READY','account','INTERNAL',730,false,'Account readiness completed.'),
  ('MARKET_CREATED','marketplace','INTERNAL',730,false,'Market created.'),
  ('MARKET_CLAIMED','marketplace','INTERNAL',730,false,'Prepared Market claimed by verified seller.'),
  ('MARKET_ACTIVATED','marketplace','INTERNAL',730,false,'Market reaches public active state.'),
  ('MARKET_FOLLOWED','community','INTERNAL',730,false,'Follower aggregate event. Do not expose passive identity to sellers.'),
  ('SEARCH_PERFORMED','analytics','INTERNAL',180,false,'Search action. Query text should be normalized or bucketed.'),
  ('SEARCH_ZERO_RESULTS','analytics','INTERNAL',180,false,'Search returned no results. Store coarse location/category only.'),
  ('LISTING_VIEWED','analytics','INTERNAL',180,false,'Public listing view. Exclude owner/admin views.'),
  ('LISTING_CREATED','marketplace','INTERNAL',730,false,'Listing draft or row created.'),
  ('LISTING_PUBLISHED','marketplace','INTERNAL',730,false,'Listing made public.'),
  ('LISTING_EXPIRED','marketplace','INTERNAL',730,false,'Listing expired by time or sweep.'),
  ('LISTING_ARCHIVED','marketplace','INTERNAL',730,false,'Listing archived.'),
  ('RESERVATION_REQUESTED','reservation','CONFIDENTIAL',730,false,'Buyer requests reservation; do not store pickup address in metadata.'),
  ('RESERVATION_APPROVED','reservation','CONFIDENTIAL',730,false,'Seller approves/reserves.'),
  ('RESERVATION_DECLINED','reservation','CONFIDENTIAL',730,false,'Seller declines.'),
  ('RESERVATION_CANCELLED','reservation','CONFIDENTIAL',730,false,'Party cancels.'),
  ('RESERVATION_READY','reservation','CONFIDENTIAL',730,false,'Seller marks ready.'),
  ('RESERVATION_ON_THE_WAY','reservation','CONFIDENTIAL',730,false,'Delivery/on-the-way state when supported.'),
  ('RESERVATION_PICKED_UP','reservation','CONFIDENTIAL',730,false,'Pickup recorded.'),
  ('RESERVATION_COMPLETED','reservation','CONFIDENTIAL',730,false,'Reservation completed.'),
  ('RESERVATION_OVERDUE','reservation','CONFIDENTIAL',365,false,'Derived overdue condition. Not a no-show.'),
  ('RESERVATION_RESCHEDULED','reservation','CONFIDENTIAL',365,false,'Reservation time changed.'),
  ('PROMOTION_STARTED','growth','INTERNAL',730,false,'Promotion starts. Distinguish credits from paid spend.'),
  ('PROMOTION_COMPLETED','growth','INTERNAL',730,false,'Promotion completes or expires.'),
  ('REFERRAL_CREATED','growth','CONFIDENTIAL',730,false,'Referral attribution created.'),
  ('REFERRAL_QUALIFIED','growth','CONFIDENTIAL',730,false,'Referral becomes qualified.'),
  ('REFERRAL_REWARDED','growth','CONFIDENTIAL',730,false,'Reward ledger row issued/deferred/tracked.'),
  ('PROMO_APPLIED','growth','CONFIDENTIAL',730,false,'Promo code applied.'),
  ('PROMO_REDEEMED','growth','CONFIDENTIAL',730,false,'Promo redeemed.'),
  ('ZORDY_REQUEST','ai','CONFIDENTIAL',180,false,'AI request metadata only; no full raw chats in event metadata.'),
  ('ZORDY_IMAGE_REQUEST','ai','CONFIDENTIAL',180,false,'Image analysis metadata only.'),
  ('COMPLIANCE_BLOCK','compliance','CONFIDENTIAL',1095,false,'Publication blocked by compliance gate.'),
  ('COMPLIANCE_VERIFICATION_REQUIRED','compliance','CONFIDENTIAL',1095,false,'Credential or verification required.'),
  ('SUPPORT_CASE_CREATED','support','CONFIDENTIAL',1095,false,'Support/trust case created.'),
  ('SUPPORT_CASE_RESOLVED','support','CONFIDENTIAL',1095,false,'Support/trust case resolved.')
on conflict (event_name) do update set
  domain=excluded.domain,
  data_classification=excluded.data_classification,
  retention_days=excluded.retention_days,
  pii_allowed=excluded.pii_allowed,
  notes=excluded.notes;

insert into public.ai_agent_permission_registry(agent_id,tool,access_mode,data_classification,approval_class,enabled,reason)
values
  ('gnome_hq','admin_executive_dashboard','read','INTERNAL','GREEN',true,'Aggregated summaries from every executive domain for president briefs.'),
  ('gnome_hq','boardroom_synthesis','draft','INTERNAL','GREEN',true,'Synthesizes bounded Boardroom output without expanding permissions.'),
  ('gnome_hq','yellow_action_request','propose','CONFIDENTIAL','YELLOW',true,'May file allowlisted proposals for owner/admin approval; never executes directly.'),
  ('boon','marketplace_operations_pack','read','CONFIDENTIAL','GREEN',true,'Markets, listings, seller pipeline, reservations, pickups, and operational health.'),
  ('boon','market_assistance_action','propose','CONFIDENTIAL','YELLOW',true,'May propose seller/Market assistance actions for approval.'),
  ('buddy','horticulture_pack','read','INTERNAL','GREEN',true,'Garden Planner, plant diagnosis, crop/category and seasonal grower aggregates.'),
  ('enzo','community_pack','read','INTERNAL','GREEN',true,'Market follows, repeat buyer aggregates, geographic activity, and community retention.'),
  ('gemma','growth_pack','read','CONFIDENTIAL','GREEN',true,'Acquisition, referrals, promo codes, reward ledger aggregates, and retention cohorts.'),
  ('gemma','reward_or_campaign_change','propose','CONFIDENTIAL','YELLOW',true,'May prepare reward/campaign recommendations; execution remains approval-scoped.'),
  ('reddy','marketing_pack','read','PUBLIC','GREEN',true,'Campaign performance aggregates, category trends, public Market/listing examples, and brand assets.'),
  ('reddy','campaign_content','draft','PUBLIC','GREEN',true,'May draft campaigns and copy; external send/publish requires approval.'),
  ('senior','security_pack','read','RESTRICTED','GREEN',true,'Security metadata, audit aggregates, permission registry, and suspicious activity summaries.'),
  ('senior','blocked_forbidden_action','propose','RESTRICTED','RED',false,'Red actions remain prohibited; Senior may only block/recommend under deterministic policy.'),
  ('junior','technology_pack','read','INTERNAL','GREEN',true,'Migrations, release metadata, Edge Function health, errors, and infrastructure aggregates.'),
  ('junior','production_deploy','propose','INTERNAL','YELLOW',false,'Deployments remain explicit owner/admin approvals outside autonomous agent authority.'),
  ('debb','compliance_pack','read','CONFIDENTIAL','GREEN',true,'Compliance rules, credential metadata/status, blocked attempts, and jurisdiction coverage.'),
  ('debb','credential_decision','propose','CONFIDENTIAL','YELLOW',false,'Credential approval/rejection requires existing authorized review workflow.'),
  ('gee','finance_pack','read','CONFIDENTIAL','GREEN',true,'Subscription aggregates, plan mix, comp grants, AI cost, infrastructure/campaign spend, and seller-recorded GMV.'),
  ('gee','money_movement','execute','RESTRICTED','RED',false,'Gee never moves money, changes bank destinations, or sees card/banking secrets.'),
  ('kay','support_trust_pack','read','CONFIDENTIAL','GREEN',true,'Support cases, reports, dispute metadata, status and trend summaries.'),
  ('kay','user_restriction','propose','CONFIDENTIAL','YELLOW',false,'Suspension/restriction requires approval and existing audited admin path.'),
  ('marty','company_intelligence_pack','read','INTERNAL','GREEN',true,'Cross-company aggregate metrics, funnels, cohorts, retention, anomalies, and attribution quality.'),
  ('marty','identity_reveal','read','RESTRICTED','RED',false,'Marty should use anonymized/pseudonymous user-level data when necessary, not direct identities.')
on conflict (agent_id,tool,access_mode) do update set
  data_classification=excluded.data_classification,
  approval_class=excluded.approval_class,
  enabled=excluded.enabled,
  reason=excluded.reason,
  last_reviewed=current_date;

-- ---------------------------------------------------------------------------
-- 3. Deterministic aggregate data packs
-- ---------------------------------------------------------------------------
create or replace function public._executive_marketplace_summary()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'markets', jsonb_build_object(
      'total', (select count(*) from public.markets),
      'active', (select count(*) from public.markets where status = 'active'),
      'inactive', (select count(*) from public.markets where status <> 'active'),
      'no_active_listings', (select count(*) from public.markets m
        where m.status = 'active' and not exists (
          select 1 from public.listings l
           where l.market_id = m.id and l.status = 'active' and l.expires_at > now()))
    ),
    'listings', jsonb_build_object(
      'active', (select count(*) from public.listings where status = 'active' and expires_at > now()),
      'published_24h', (select count(*) from public.listings where created_at >= now() - interval '24 hours'),
      'expired', (select count(*) from public.listings where status = 'expired' or expires_at <= now()),
      'sold_out', (select count(*) from public.listings where inventory_count is not null and inventory_count <= 0),
      'archived', (select count(*) from public.listings where archived_at is not null),
      'avg_active_per_market', (select round(count(l.id)::numeric / nullif(count(distinct m.id),0), 2)
        from public.markets m left join public.listings l
          on l.market_id = m.id and l.status = 'active' and l.expires_at > now())
    ),
    'claims', jsonb_build_object(
      'requested', (select count(*) from public.claims where status = 'pending'),
      'approved', (select count(*) from public.claims where status = 'approved'),
      'declined', (select count(*) from public.claims where status = 'declined'),
      'cancelled', (select count(*) from public.claims where status = 'cancelled'),
      'expired', (select count(*) from public.claims where status::text = 'expired'),
      'completed', (select count(*) from public.claims where status::text = 'completed'),
      'overdue', (select count(*) from public.claims where status = 'approved' and pickup_end is not null and pickup_end < now()),
      'completion_rate_pct', (select round(100.0 * count(*) filter (where status::text = 'completed') / nullif(count(*), 0), 1)
        from public.claims where status::text in ('approved','declined','cancelled','expired','completed'))
    ),
    'orders', jsonb_build_object(
      'requested', (select count(*) from public.market_orders where status = 'REQUESTED'),
      'approved_reserved', (select count(*) from public.market_orders where status = 'CONFIRMED'),
      'ready', (select count(*) from public.market_orders where status = 'READY'),
      'completed', (select count(*) from public.market_orders where status = 'COMPLETED'),
      'cancelled', (select count(*) from public.market_orders where status = 'CANCELLED'),
      'declined', (select count(*) from public.market_orders where status = 'DECLINED'),
      'overdue_not_no_show', (select count(*) from public.market_orders
        where status in ('CONFIRMED','READY') and coalesce(confirmed_end, requested_end) < now()),
      'completion_rate_pct', (select round(100.0 * count(*) filter (where status = 'COMPLETED') / nullif(count(*), 0), 1)
        from public.market_orders where status in ('CONFIRMED','READY','COMPLETED','CANCELLED','DECLINED'))
    ),
    'seller_activation', jsonb_build_object(
      'draft_only_sellers', (select count(*) from (
        select owner_id
          from public.listings
         group by owner_id
        having count(*) filter (where status = 'active') = 0
           and count(*) > 0
      ) s),
      'avg_hours_signup_to_first_listing', (select round(avg(extract(epoch from (first_listing_at - created_at)) / 3600.0)::numeric, 1)
        from (
          select p.created_at, min(l.created_at) as first_listing_at
            from public.profiles p
            join public.listings l on l.owner_id = p.id
           group by p.id, p.created_at
        ) x)
    ),
    'seller_concierge', jsonb_build_object(
      'prepared', (select count(*) from public.seller_concierge_cases where not is_qa),
      'invited', (select count(*) from public.seller_concierge_cases where not is_qa and invited_at is not null),
      'claimed', (select count(*) from public.seller_concierge_cases where not is_qa and claimed_at is not null),
      'account_ready', (select count(*) from public.seller_concierge_cases where not is_qa and account_ready_at is not null),
      'first_listing_published', (select count(*) from public.seller_concierge_cases where not is_qa and first_listing_published_at is not null),
      'active_seller', (select count(*) from public.seller_concierge_cases where not is_qa and active_seller_at is not null)
    )
  );
$$;
revoke all on function public._executive_marketplace_summary() from public, anon, authenticated;

create or replace function public._executive_finance_summary()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'definitions', jsonb_build_object(
      'gnome_revenue', 'money Boone Systems/Gnome actually earns',
      'seller_recorded_gmv', 'seller-recorded off-platform sales volume, not Gnome revenue',
      'promotion_credits', '$0 seller cash spend credits',
      'paid_promotion', 'actual seller-paid promotion amount'
    ),
    'gnome_revenue', jsonb_build_object(
      'mrr_cents', (select coalesce(sum(pl.price_cents), 0)
        from public.market_subscriptions s
        join public.plan_limits pl on pl.plan = s.plan
       where s.kind = 'plan' and s.status in ('active','trialing')),
      'paid_subscribers', (select count(*) from public.market_subscriptions
        where kind = 'plan' and status in ('active','trialing')),
      'plan_mix', (select coalesce(jsonb_object_agg(plan, n), '{}'::jsonb) from (
        select ep.plan::text as plan, count(*) as n
          from public.markets m
          cross join lateral public.market_effective_plan(m.id) ep
         group by 1
      ) t)
    ),
    'seller_recorded_gmv', jsonb_build_object(
      'gross_cents_30d', (select coalesce(sum(gross_cents),0) from public.seller_transactions
        where status = 'completed' and sold_at >= now() - interval '30 days'),
      'net_cents_30d', (select coalesce(sum(net_cents),0) from public.seller_transactions
        where status = 'completed' and sold_at >= now() - interval '30 days'),
      'definition', 'seller-recorded off-platform volume, not Gnome revenue'
    ),
    'promotion_credits', jsonb_build_object(
      'active_comp_grants', (select count(*) from public.admin_plan_grants
        where status = 'ACTIVE' and (expires_at is null or expires_at > now())),
      'paid_promotion_revenue_cents_30d', (select coalesce(sum(bp.unit_amount_cents * c.delta),0)
        from public.market_promotion_credits c
        cross join lateral (select unit_amount_cents from public.billing_products where key='GNOME_LISTING_PROMOTION') bp
        where c.source like 'PURCHASED%' and c.delta > 0 and c.created_at >= now() - interval '30 days'),
      'credit_redemptions_30d', (select count(*) from public.promotion_redemptions
        where redeemed_at >= now() - interval '30 days')
    ),
    'ai_cost', jsonb_build_object(
      'actual_cents_today', (select coalesce(sum(actual_cost_cents),0) from public.ai_usage_log
        where created_at >= date_trunc('day', now())),
      'paid_equivalent_cents_today', (select coalesce(sum(estimated_cost_cents),0) from public.ai_usage_log
        where created_at >= date_trunc('day', now())),
      'paid_use_prevented', (select coalesce(not allow_paid_fallback, true) from public.ai_settings limit 1)
    ),
    'payments_live_enabled', (select coalesce(payments_live_enabled,false) from public.billing_config limit 1)
  );
$$;
revoke all on function public._executive_finance_summary() from public, anon, authenticated;

create or replace function public._executive_growth_summary()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'referrals', (select public.referral_growth_summary_service()),
    'seller_funnel', jsonb_build_object(
      'prepared', (select count(*) from public.seller_concierge_cases where not is_qa),
      'contacted', (select count(*) from public.seller_concierge_cases where not is_qa and invited_at is not null),
      'invited', (select count(*) from public.seller_concierge_cases where not is_qa and invited_at is not null),
      'claimed', (select count(*) from public.seller_concierge_cases where not is_qa and claimed_at is not null),
      'first_listing', (select count(*) from public.seller_concierge_cases where not is_qa and first_listing_published_at is not null),
      'active_7_days', (select count(*) from public.seller_concierge_cases where not is_qa and active_seller_at <= now() - interval '7 days'),
      'active_30_days', (select count(*) from public.seller_concierge_cases where not is_qa and active_seller_at <= now() - interval '30 days')
    ),
    'buyer_funnel', jsonb_build_object(
      'accounts', (select count(*) from public.profiles),
      'searched_30d', (select count(distinct user_id) from public.events
        where event_type in ('SEARCH_PERFORMED','search_performed','web_zip_search') and created_at >= now() - interval '30 days'),
      'listing_viewers_30d', (select count(distinct user_id) from public.events
        where event_type in ('LISTING_VIEWED','listing_viewed') and created_at >= now() - interval '30 days'),
      'reservations_30d', (select count(distinct claimer_id) from public.claims
        where created_at >= now() - interval '30 days'),
      'completed_30d', (select count(distinct claimer_id) from public.claims
        where status::text = 'completed' and created_at >= now() - interval '30 days')
    )
  );
$$;
revoke all on function public._executive_growth_summary() from public, anon, authenticated;

create or replace function public._executive_analytics_summary()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'sample_size', jsonb_build_object(
      'claims', (select count(*) from public.claims),
      'market_orders', (select count(*) from public.market_orders),
      'listing_views_30d', (select count(*) from public.events where event_type in ('LISTING_VIEWED','listing_viewed') and created_at >= now() - interval '30 days')
    ),
    'confidence', case
      when (select count(*) from public.claims where created_at >= now() - interval '30 days') >= 100 then 'HIGH'
      when (select count(*) from public.claims where created_at >= now() - interval '30 days') >= 20 then 'MEDIUM'
      else 'LOW'
    end,
    'known_bias', 'Event coverage is uneven across web/mobile; QA/test exclusion depends on source-specific markers.',
    'attribution_limitations', 'Promotion and referral effects are observational unless tied to a controlled experiment.',
    'analytics_quality', jsonb_build_object(
      'qa_excluded', true,
      'unknown_vs_zero', 'Use DATA UNAVAILABLE / NOT CURRENTLY TRACKED when source events are absent; do not convert unknown to zero.'
    ),
    'marketplace', (select public._executive_marketplace_summary()),
    'growth', (select public._executive_growth_summary()),
    'finance', (select public._executive_finance_summary()),
    'search_demand', jsonb_build_object(
      'searches_30d', (select count(*) from public.events
        where event_type in ('SEARCH_PERFORMED','search_performed','web_zip_search') and created_at >= now() - interval '30 days'),
      'zero_results_30d', (select count(*) from public.events
        where event_type in ('SEARCH_ZERO_RESULTS','search_zero_results') and created_at >= now() - interval '30 days'),
      'zero_results_tracking', case
        when exists (select 1 from public.analytics_event_catalog where event_name='SEARCH_ZERO_RESULTS') then 'DEFINED'
        else 'NOT_CURRENTLY_TRACKED'
      end
    ),
    'zordy_usage', jsonb_build_object(
      'requests_today', (select count(*) from public.ai_usage_log where created_at >= date_trunc('day', now())),
      'failures_today', (select count(*) from public.ai_usage_log where created_at >= date_trunc('day', now()) and success = false),
      'actual_cost_cents_today', (select coalesce(sum(actual_cost_cents),0) from public.ai_usage_log where created_at >= date_trunc('day', now()))
    )
  );
$$;
revoke all on function public._executive_analytics_summary() from public, anon, authenticated;

create or replace function public.admin_agent_data_pack_service(p_agent text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  pack jsonb;
begin
  if auth.uid() is not null then
    raise exception 'SERVICE_ONLY' using errcode = 'P0001';
  end if;

  pack := case p_agent
    when 'gnome_hq' then jsonb_build_object(
      'zordy', public.admin_executive_dashboard_service(),
      'company_intelligence', public._executive_analytics_summary())
    when 'boon' then public._executive_marketplace_summary()
    when 'buddy' then jsonb_build_object(
      'generated_at', now(),
      'garden_planner_usage_30d', (select count(*) from public.ai_usage_log where feature in ('garden-planner','garden_planner') and created_at >= now() - interval '30 days'),
      'plant_diagnosis_usage_30d', (select count(*) from public.ai_usage_log where feature ilike '%diagnos%' and created_at >= now() - interval '30 days'),
      'crop_category_trends', (select coalesce(jsonb_object_agg(category, n), '{}'::jsonb) from (
        select category, count(*) as n from public.listings
         where created_at >= now() - interval '30 days'
         group by category order by n desc limit 12
      ) t),
      'data_gaps', jsonb_build_array('Plant diagnosis confidence is only available where AI usage metadata records it.'))
    when 'enzo' then jsonb_build_object(
      'generated_at', now(),
      'market_follows', jsonb_build_object(
        'total', (select count(*) from public.market_follows),
        'new_30d', (select count(*) from public.market_follows where created_at >= now() - interval '30 days')),
      'repeat_buyers', (select count(*) from (
        select claimer_id from public.claims where status::text = 'completed' group by claimer_id having count(*) > 1
      ) x),
      'active_towns', (select coalesce(jsonb_object_agg(city_state, n), '{}'::jsonb) from (
        select concat_ws(', ', nullif(city,''), nullif(state,'')) as city_state, count(*) as n
          from public.markets
         where status = 'active' and (city is not null or state is not null)
         group by 1 order by n desc limit 12
      ) t))
    when 'gemma' then public._executive_growth_summary()
    when 'reddy' then jsonb_build_object(
      'generated_at', now(),
      'campaigns', jsonb_build_object(
        'active', (select count(*) from public.promotion_campaigns where active),
        'redemptions_30d', (select count(*) from public.promotion_redemptions where redeemed_at >= now() - interval '30 days')),
      'category_trends_30d', (select coalesce(jsonb_object_agg(category, n), '{}'::jsonb) from (
        select category, count(*) as n from public.listings
         where created_at >= now() - interval '30 days'
         group by category order by n desc limit 12
      ) t),
      'draft_only', 'Reddy may draft content; sending or publishing remains approval-scoped.')
    when 'senior' then jsonb_build_object(
      'generated_at', now(),
      'audit', jsonb_build_object(
        'admin_actions_24h', (select count(*) from public.admin_audit_log where created_at >= now() - interval '24 hours'),
        'ai_actions_pending', (select count(*) from public.ai_action_requests where status = 'PENDING' and expires_at > now()),
        'permission_denials_logged', 'DATA UNAVAILABLE'),
      'permissions', (select coalesce(jsonb_agg(jsonb_build_object(
        'agent', agent_id, 'tool', tool, 'access', access_mode, 'class', approval_class, 'enabled', enabled
      ) order by agent_id, tool), '[]'::jsonb) from public.ai_agent_permission_registry),
      'secrets', jsonb_build_object('raw_values_exposed', false, 'represented_as', 'CONFIGURED/MISSING/ROTATION_DUE'),
      'payments_live_enabled', (select coalesce(payments_live_enabled,false) from public.billing_config limit 1))
    when 'junior' then jsonb_build_object(
      'generated_at', now(),
      'ai_failures_today', (select count(*) from public.ai_usage_log where created_at >= date_trunc('day', now()) and success = false),
      'migration_drift', 'DATA UNAVAILABLE',
      'edge_function_versions', 'DATA UNAVAILABLE',
      'release_status', 'DATA UNAVAILABLE',
      'known_release_blockers', 'Use docs/release/RELEASE_BOARD.md as source of truth outside database.')
    when 'debb' then jsonb_build_object(
      'generated_at', now(),
      'credentials', jsonb_build_object(
        'pending', (select count(*) from public.seller_credentials where status = 'PENDING'),
        'approved', (select count(*) from public.seller_credentials where status = 'APPROVED'),
        'expiring_30d', (select count(*) from public.seller_credentials where status = 'APPROVED' and expiration_date is not null and expiration_date < current_date + 30)),
      'blocked_publications', (select count(*) from public.events where event_type in ('COMPLIANCE_BLOCK','compliance_block') and created_at >= now() - interval '30 days'),
      'documents_in_llm_context', false)
    when 'gee' then public._executive_finance_summary()
    when 'kay' then jsonb_build_object(
      'generated_at', now(),
      'support', jsonb_build_object(
        'open_reports', (select count(*) from public.reports where resolved_at is null),
        'reports_30d', (select count(*) from public.reports where created_at >= now() - interval '30 days'),
        'resolved_30d', (select count(*) from public.reports where resolved_at >= now() - interval '30 days')),
      'reservation_disputes', 'DATA UNAVAILABLE',
      'message_contents_included', false)
    when 'marty' then public._executive_analytics_summary()
    else jsonb_build_object('status','DATA UNAVAILABLE','agent',p_agent)
  end;

  return jsonb_build_object(
    'agent', p_agent,
    'data_classification', coalesce((select data_classification from public.ai_agents where id = p_agent), 'INTERNAL'),
    'pack', pack
  );
end $$;
revoke all on function public.admin_agent_data_pack_service(text) from public, anon, authenticated;
grant execute on function public.admin_agent_data_pack_service(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Findings and Admin dashboard RPCs
-- ---------------------------------------------------------------------------
create or replace function public.admin_executive_dashboard_service()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'health_score', greatest(0, 100
      - (select count(*) * 20 from public.ai_findings where status in ('OPEN','ACKNOWLEDGED') and severity = 'CRITICAL')
      - (select count(*) * 12 from public.ai_findings where status in ('OPEN','ACKNOWLEDGED') and severity = 'URGENT')
      - (select count(*) * 6 from public.ai_findings where status in ('OPEN','ACKNOWLEDGED') and severity = 'IMPORTANT')
      - (select count(*) * 2 from public.ai_findings where status in ('OPEN','ACKNOWLEDGED') and severity = 'WATCH')),
    'attention_count', (select count(*) from public.ai_findings where status in ('OPEN','ACKNOWLEDGED') and severity in ('IMPORTANT','URGENT','CRITICAL')),
    'agents', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'name', a.name,
      'title', a.title,
      'department', a.department,
      'status', a.status,
      'authority_level', a.authority_level,
      'data_classification', a.data_classification,
      'heartbeat_interval_minutes', a.heartbeat_interval_minutes,
      'last_analysis_at', a.last_analysis_at,
      'next_check_at', a.next_check_at,
      'open_findings', jsonb_build_object(
        'info', (select count(*) from public.ai_findings f where f.agent_id=a.id and f.status in ('OPEN','ACKNOWLEDGED') and f.severity='INFO'),
        'watch', (select count(*) from public.ai_findings f where f.agent_id=a.id and f.status in ('OPEN','ACKNOWLEDGED') and f.severity='WATCH'),
        'important', (select count(*) from public.ai_findings f where f.agent_id=a.id and f.status in ('OPEN','ACKNOWLEDGED') and f.severity='IMPORTANT'),
        'urgent', (select count(*) from public.ai_findings f where f.agent_id=a.id and f.status in ('OPEN','ACKNOWLEDGED') and f.severity='URGENT'),
        'critical', (select count(*) from public.ai_findings f where f.agent_id=a.id and f.status in ('OPEN','ACKNOWLEDGED') and f.severity='CRITICAL')
      )
    ) order by case a.id when 'gnome_hq' then 0 else 1 end, a.department, a.name), '[]'::jsonb)
      from public.ai_agents a
     where a.id in ('gnome_hq','boon','buddy','enzo','gemma','reddy','senior','junior','debb','gee','kay','marty')),
    'findings', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'agent_id', f.agent_id,
      'agent_name', a.name,
      'domain', f.domain,
      'severity', f.severity,
      'title', f.title,
      'summary', f.summary,
      'confidence', f.confidence,
      'recommended_action', f.recommended_action,
      'status', f.status,
      'escalated_to', f.escalated_to,
      'created_at', f.created_at
    ) order by f.created_at desc), '[]'::jsonb)
      from public.ai_findings f join public.ai_agents a on a.id=f.agent_id
     where f.status in ('OPEN','ACKNOWLEDGED')),
    'pending_approvals', (select count(*) from public.ai_action_requests where status='PENDING' and expires_at > now()),
    'heartbeats', (select coalesce(jsonb_agg(jsonb_build_object(
      'agent_id', h.agent_id,
      'status', h.deterministic_status,
      'ai_interpretation_queued', h.ai_interpretation_queued,
      'created_at', h.created_at
    ) order by h.created_at desc), '[]'::jsonb)
      from (
        select distinct on (agent_id) agent_id, deterministic_status, ai_interpretation_queued, created_at
          from public.ai_heartbeat_runs
         order by agent_id, created_at desc
      ) h)
  );
$$;
revoke all on function public.admin_executive_dashboard_service() from public, anon, authenticated;
grant execute on function public.admin_executive_dashboard_service() to service_role;

create or replace function public.admin_executive_dashboard()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when not (public.admin_has_perm('ai.view') or public.admin_is_owner()) then null
              else public.admin_executive_dashboard_service() end;
$$;
revoke all on function public.admin_executive_dashboard() from public, anon;
grant execute on function public.admin_executive_dashboard() to authenticated;

create or replace function public.admin_company_intelligence()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when not (public.admin_has_perm('ai.view') or public.admin_is_owner()) then null
              else public._executive_analytics_summary() end;
$$;
revoke all on function public.admin_company_intelligence() from public, anon;
grant execute on function public.admin_company_intelligence() to authenticated;

create or replace function public.ai_record_finding_service(
  p_agent text,
  p_domain text,
  p_severity text,
  p_title text,
  p_summary text,
  p_evidence jsonb default '{}'::jsonb,
  p_metric_snapshot jsonb default '{}'::jsonb,
  p_confidence text default 'MEDIUM',
  p_recommended_action text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_escalated_to text[] := '{}';
begin
  if auth.uid() is not null then
    raise exception 'SERVICE_ONLY' using errcode = 'P0001';
  end if;
  if p_severity not in ('INFO','WATCH','IMPORTANT','URGENT','CRITICAL') then
    raise exception 'BAD_SEVERITY' using errcode = 'P0001';
  end if;
  if p_confidence not in ('LOW','MEDIUM','HIGH') then
    raise exception 'BAD_CONFIDENCE' using errcode = 'P0001';
  end if;
  if p_severity = 'IMPORTANT' then v_escalated_to := array['zordy'];
  elsif p_severity in ('URGENT','CRITICAL') then v_escalated_to := array['zordy','daniel'];
  end if;

  insert into public.ai_findings(agent_id,domain,severity,title,summary,evidence,metric_snapshot,confidence,recommended_action,escalated_to)
  values(p_agent,p_domain,p_severity,left(p_title,180),left(p_summary,2000),
         coalesce(p_evidence,'{}'::jsonb),coalesce(p_metric_snapshot,'{}'::jsonb),
         p_confidence,p_recommended_action,v_escalated_to)
  returning id into v_id;
  perform public.admin_audit('AI_FINDING_CREATED','ai_finding',v_id::text,null,
    jsonb_build_object('agent',p_agent,'severity',p_severity,'domain',p_domain,'title',p_title),
    null,'AI_AGENT',null);
  return v_id;
end $$;
revoke all on function public.ai_record_finding_service(text,text,text,text,text,jsonb,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.ai_record_finding_service(text,text,text,text,text,jsonb,jsonb,text,text) to service_role;

create or replace function public.ai_agent_tool_allowed_service(
  p_agent text,
  p_tool text,
  p_access_mode text
) returns boolean
language sql stable security definer set search_path = public
as $$
  select case when auth.uid() is not null then false else exists (
    select 1
      from public.ai_agent_permission_registry r
     where r.agent_id = p_agent
       and r.tool = p_tool
       and r.access_mode = p_access_mode
       and r.enabled
       and r.approval_class <> 'RED'
  ) end;
$$;
revoke all on function public.ai_agent_tool_allowed_service(text,text,text) from public, anon, authenticated;
grant execute on function public.ai_agent_tool_allowed_service(text,text,text) to service_role;

-- Keep the proposal allowlist in sync with executable actions. Campaign
-- creation stays draft-only until there is a dedicated audited executor branch.
create or replace function public.ai_file_action_request(
  p_agent text, p_action text, p_params jsonb, p_summary text, p_reason text
) returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_allowed jsonb := '{
    "gnome_hq":    ["pause_listing","restore_listing","adjust_inventory","quarantine_lot","end_promotion","grant_promo_credits","grant_comp_plan","cancel_seed_order","resolve_report"],
    "boon":        ["grant_comp_plan"],
    "gemma":       ["grant_promo_credits","end_promotion"],
    "operations":  ["pause_listing","restore_listing","cancel_seed_order","resolve_report"],
    "inventory":   ["adjust_inventory","quarantine_lot"],
    "seeds":       ["cancel_seed_order","quarantine_lot"],
    "marketplace": ["pause_listing","restore_listing","resolve_report"],
    "support":     ["resolve_report"],
    "finance":     ["grant_promo_credits","grant_comp_plan"],
    "growth":      ["grant_promo_credits"],
    "compliance":  ["pause_listing"],
    "security":    ["pause_listing"]
  }'::jsonb;
  v_risk int;
  v_id uuid;
begin
  if auth.uid() is not null then
    raise exception 'SERVICE_ONLY' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.ai_agents a where a.id = p_agent
                   and a.status <> 'disabled'
                   and 'create_owner_approval_request' = any(a.permissions)) then
    raise exception 'AGENT_NOT_PERMITTED: %', p_agent using errcode = 'P0001';
  end if;
  if not (v_allowed ? p_agent) or not (v_allowed->p_agent) ? p_action then
    raise exception 'ACTION_OUT_OF_SCOPE: % for %', p_action, p_agent using errcode = 'P0001';
  end if;
  v_risk := case p_action
    when 'grant_comp_plan' then 3
    else 2
  end;
  insert into public.ai_action_requests
    (agent_id, requested_action, resource_type, resource_id, parameters,
     payload_hash, human_summary, reason, risk_level, status, dry_run, expires_at)
  values
    (p_agent, p_action, split_part(p_action, '_', 2), null, coalesce(p_params, '{}'::jsonb),
     encode(extensions.digest(p_action || '|' || coalesce(p_params, '{}'::jsonb)::text, 'sha256'), 'hex'),
     left(coalesce(p_summary, p_action), 200), left(coalesce(p_reason, ''), 300),
     v_risk, 'PENDING', false, now() + interval '7 days')
  returning id into v_id;
  perform public.admin_audit('AI_ACTION_PROPOSED', 'ai_action_request', v_id::text,
    null, jsonb_build_object('agent', p_agent, 'action', p_action, 'params', p_params),
    p_reason, 'AI_AGENT');
  return v_id;
end $$;
revoke execute on function public.ai_file_action_request(text,text,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.ai_file_action_request(text,text,jsonb,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Deterministic heartbeat sweep. No model call happens here.
-- ---------------------------------------------------------------------------
create or replace function public.run_agent_heartbeats()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  a record;
  p jsonb;
  deterministic_status text;
  count_runs int := 0;
begin
  if auth.uid() is not null then
    raise exception 'SERVICE_ONLY' using errcode = 'P0001';
  end if;

  for a in
    select *
      from public.ai_agents
     where id in ('gnome_hq','boon','buddy','enzo','gemma','reddy','senior','junior','debb','gee','kay','marty')
       and public.ai_agents.status <> 'disabled'
       and (next_check_at is null or next_check_at <= now())
     order by coalesce(next_check_at, now())
  loop
    begin
      p := public.admin_agent_data_pack_service(a.id);
      deterministic_status := 'NO_MATERIAL_CHANGE';

      if a.id = 'senior' and coalesce((p #>> '{pack,payments_live_enabled}')::boolean,false) then
        deterministic_status := 'ANOMALY';
      elsif a.id = 'boon' and coalesce((p #>> '{pack,orders,overdue_not_no_show}')::int,0) > 0 then
        deterministic_status := 'WATCH';
      elsif a.id = 'debb' and coalesce((p #>> '{pack,credentials,pending}')::int,0) > 0 then
        deterministic_status := 'WATCH';
      elsif a.id = 'kay' and coalesce((p #>> '{pack,support,open_reports}')::int,0) > 0 then
        deterministic_status := 'WATCH';
      elsif a.id = 'junior' and coalesce((p #>> '{pack,ai_failures_today}')::int,0) > 0 then
        deterministic_status := 'WATCH';
      end if;

      insert into public.ai_heartbeat_runs(agent_id,deterministic_status,metric_snapshot,ai_interpretation_queued)
      values(a.id,deterministic_status,p,deterministic_status in ('ANOMALY','MATERIAL_CHANGE'));

      update public.ai_agents
         set last_analysis_at = now(),
             next_check_at = now() + make_interval(mins => coalesce(heartbeat_interval_minutes, 1440)),
             updated_at = now()
       where id = a.id;
      count_runs := count_runs + 1;
    exception when others then
      insert into public.ai_heartbeat_runs(agent_id,deterministic_status,metric_snapshot,ai_interpretation_queued)
      values(a.id,'ERROR',jsonb_build_object('error',sqlerrm),false);
    end;
  end loop;

  return jsonb_build_object('ran', count_runs, 'generated_at', now(), 'ai_calls', 0);
end $$;
revoke all on function public.run_agent_heartbeats() from public, anon, authenticated;
grant execute on function public.run_agent_heartbeats() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'gnome-agent-heartbeats') then
      perform cron.schedule('gnome-agent-heartbeats', '17 * * * *',
        'select public.run_agent_heartbeats();');
    end if;
  else
    raise notice 'gnome executive organization: pg_cron unavailable here; no agent heartbeat schedule registered';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Backstop invariants and schema cache
-- ---------------------------------------------------------------------------
do $$
declare
  bad text;
begin
  if exists (select 1 from public.billing_config where payments_live_enabled is true) then
    raise exception 'executive organization refuses to apply while payments_live_enabled is true';
  end if;

  select string_agg(agent_id || ':' || tool, ', ') into bad
    from public.ai_agent_permission_registry
   where enabled and approval_class = 'RED';
  if bad is not null then
    raise exception 'RED agent permissions must not be enabled: %', bad;
  end if;

  select string_agg(id, ', ') into bad
    from public.ai_agents
   where id in ('gnome_hq','boon','buddy','enzo','gemma','reddy','senior','junior','debb','gee','kay','marty')
     and '*' = any(permissions);
  if bad is not null then
    raise exception 'executive agents must not receive wildcard permissions: %', bad;
  end if;

  if has_function_privilege('authenticated', 'public.admin_agent_data_pack_service(text)', 'execute') then
    raise exception 'client can execute service-only agent data pack';
  end if;
  if has_function_privilege('anon', 'public.ai_record_finding_service(text,text,text,text,text,jsonb,jsonb,text,text)', 'execute') then
    raise exception 'anon can create AI findings';
  end if;
  if has_function_privilege('authenticated', 'public.run_agent_heartbeats()', 'execute') then
    raise exception 'client can run service-only heartbeats';
  end if;
end $$;

notify pgrst, 'reload schema';
