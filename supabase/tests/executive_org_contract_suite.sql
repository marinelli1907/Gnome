begin;

create or replace function public._exec_assert(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if not cond then
    raise exception 'FAIL: %', msg;
  end if;
  raise notice 'PASS: %', msg;
end
$$;

select public._exec_assert(to_regclass('public.ai_findings') is not null, 'ai_findings table exists');
select public._exec_assert(to_regclass('public.ai_agent_permission_registry') is not null, 'permission registry exists');
select public._exec_assert(to_regclass('public.analytics_event_catalog') is not null, 'analytics event catalog exists');
select public._exec_assert(to_regclass('public.ai_heartbeat_runs') is not null, 'heartbeat run table exists');

select public._exec_assert(
  (select count(*) from public.ai_agents where id in
    ('gnome_hq','boon','buddy','enzo','gemma','reddy','senior','junior','debb','gee','kay','marty')) = 12,
  'exact approved executive roster is present'
);

select public._exec_assert(
  not exists (
    select 1 from public.ai_agent_permission_registry
    where enabled and approval_class = 'RED'
  ),
  'no RED permission is enabled'
);

select public._exec_assert(
  not exists (
    select 1 from public.ai_agent_permission_registry
    where enabled and (tool = '*' or agent_id = '*')
  ),
  'no enabled wildcard agent permissions'
);

select public._exec_assert(
  has_function_privilege('service_role', 'public.admin_agent_data_pack_service(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_agent_data_pack_service(text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_agent_data_pack_service(text)', 'execute'),
  'service-only data-pack RPC is protected'
);

select public._exec_assert(
  has_function_privilege('service_role', 'public.run_agent_heartbeats()', 'execute')
  and not has_function_privilege('authenticated', 'public.run_agent_heartbeats()', 'execute')
  and not has_function_privilege('anon', 'public.run_agent_heartbeats()', 'execute'),
  'service-only heartbeat RPC is protected'
);

select public._exec_assert(
  has_function_privilege('service_role', 'public.ai_record_finding_service(text,text,text,text,text,jsonb,jsonb,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.ai_record_finding_service(text,text,text,text,text,jsonb,jsonb,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.ai_record_finding_service(text,text,text,text,text,jsonb,jsonb,text,text)', 'execute'),
  'service-only finding RPC is protected'
);

select public._exec_assert(
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_findings')
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_agent_permission_registry')
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'analytics_event_catalog')
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_heartbeat_runs'),
  'RLS policies exist for executive system tables'
);

select public._exec_assert(
  (select relrowsecurity from pg_class where oid = 'public.ai_findings'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.ai_agent_permission_registry'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.analytics_event_catalog'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.ai_heartbeat_runs'::regclass),
  'RLS enabled on executive system tables'
);

select public._exec_assert(
  exists (select 1 from public.ai_agent_permission_registry where agent_id = 'gnome_hq' and tool = 'admin_executive_dashboard' and enabled and approval_class = 'GREEN')
  and not exists (select 1 from public.ai_agent_permission_registry where agent_id = 'gnome_hq' and enabled and data_classification = 'RESTRICTED'),
  'Zordy has aggregate executive tools and no raw restricted permission'
);

select public._exec_assert(
  exists (select 1 from public.ai_agent_permission_registry where agent_id = 'boon' and tool = 'marketplace_operations_pack' and enabled)
  and not exists (select 1 from public.ai_agent_permission_registry where agent_id = 'boon' and enabled and tool like '%billing%'),
  'Boon has marketplace scope and no billing scope'
);

select public._exec_assert(
  exists (select 1 from public.ai_agent_permission_registry where agent_id = 'buddy' and tool = 'horticulture_pack' and enabled)
  and not exists (select 1 from public.ai_agent_permission_registry where agent_id = 'buddy' and enabled and tool like '%finance%'),
  'Buddy has horticulture scope and no finance scope'
);

select public._exec_assert(
  exists (select 1 from public.ai_agent_permission_registry where agent_id = 'enzo' and tool = 'community_pack' and enabled)
  and not exists (select 1 from public.ai_agent_permission_registry where agent_id = 'enzo' and enabled and tool like '%message%'),
  'Enzo has community aggregates and no message-content scope'
);

select public._exec_assert(
  exists (select 1 from public.ai_agent_permission_registry where agent_id = 'gemma' and tool = 'growth_pack' and enabled)
  and not exists (select 1 from public.ai_agent_permission_registry where agent_id = 'gemma' and enabled and tool like '%grant_reward%'),
  'Gemma has growth scope and no direct reward grant'
);

select public._exec_assert(
  exists (select 1 from public.ai_agent_permission_registry where agent_id = 'reddy' and tool = 'campaign_content' and enabled and approval_class = 'GREEN')
  and not exists (select 1 from public.ai_agent_permission_registry where agent_id = 'reddy' and enabled and tool like '%send%'),
  'Reddy can draft and cannot send/publish'
);

select public._exec_assert(
  exists (select 1 from public.ai_agent_permission_registry where agent_id = 'senior' and tool = 'security_pack' and enabled)
  and exists (select 1 from public.ai_agent_permission_registry where agent_id = 'senior' and approval_class = 'RED' and not enabled),
  'Senior has security metadata and forbidden mutation remains disabled'
);

select public._exec_assert(
  exists (select 1 from public.ai_agent_permission_registry where agent_id = 'junior' and tool = 'technology_pack' and enabled)
  and not exists (select 1 from public.ai_agent_permission_registry where agent_id = 'junior' and enabled and tool like '%deploy%'),
  'Junior has technical health and no deploy permission'
);

select public._exec_assert(
  exists (select 1 from public.ai_agent_permission_registry where agent_id = 'debb' and tool = 'compliance_pack' and enabled)
  and not exists (select 1 from public.ai_agent_permission_registry where agent_id = 'debb' and enabled and tool like '%approve_credential%'),
  'Debb has compliance metadata and no self-approval'
);

select public._exec_assert(
  exists (select 1 from public.ai_agent_permission_registry where agent_id = 'gee' and tool = 'finance_pack' and enabled)
  and exists (select 1 from public.ai_agent_permission_registry where agent_id = 'gee' and approval_class = 'RED' and not enabled),
  'Gee has finance aggregates and money movement remains disabled'
);

select public._exec_assert(
  exists (select 1 from public.ai_agent_permission_registry where agent_id = 'kay' and tool = 'support_trust_pack' and enabled)
  and not exists (select 1 from public.ai_agent_permission_registry where agent_id = 'kay' and enabled and tool like '%unrelated%'),
  'Kay has trust/support scope and no unrelated private browse permission'
);

select public._exec_assert(
  exists (select 1 from public.ai_agent_permission_registry where agent_id = 'marty' and tool = 'company_intelligence_pack' and enabled)
  and exists (select 1 from public.ai_agent_permission_registry where agent_id = 'marty' and approval_class = 'RED' and not enabled),
  'Marty has cross-domain aggregates and identity reveal is disabled'
);

select public._exec_assert(
  exists (select 1 from public.analytics_event_catalog where event_name = 'RESERVATION_REQUESTED')
  and exists (select 1 from public.analytics_event_catalog where event_name = 'RESERVATION_APPROVED')
  and exists (select 1 from public.analytics_event_catalog where event_name = 'RESERVATION_CANCELLED')
  and exists (select 1 from public.analytics_event_catalog where event_name = 'RESERVATION_OVERDUE')
  and exists (select 1 from public.analytics_event_catalog where event_name = 'RESERVATION_COMPLETED')
  and not exists (select 1 from public.analytics_event_catalog where event_name like '%NO_SHOW%'),
  'reservation lifecycle tracked and overdue is not no-show'
);

select public._exec_assert(
  exists (select 1 from public.analytics_event_catalog where event_name = 'SEARCH_ZERO_RESULTS')
  and exists (select 1 from public.analytics_event_catalog where event_name = 'REFERRAL_CREATED')
  and exists (select 1 from public.analytics_event_catalog where event_name = 'REFERRAL_QUALIFIED')
  and exists (select 1 from public.analytics_event_catalog where event_name = 'PROMO_APPLIED')
  and exists (select 1 from public.analytics_event_catalog where event_name = 'PROMOTION_STARTED'),
  'search, referral, promo, and promotion analytics events are cataloged'
);

select public._exec_assert(public.admin_agent_data_pack_service('gee')->'pack' ? 'gnome_revenue', 'Gee pack includes Gnome revenue');
select public._exec_assert(public.admin_agent_data_pack_service('gee')->'pack' ? 'seller_recorded_gmv', 'Gee pack includes seller-recorded GMV');
select public._exec_assert(public.admin_agent_data_pack_service('gee')->'pack' ? 'promotion_credits', 'Gee pack includes promotion credits');
select public._exec_assert((public._executive_finance_summary()->'definitions'->>'gnome_revenue') is not null, 'finance summary defines Gnome revenue');
select public._exec_assert((public._executive_finance_summary()->'definitions'->>'seller_recorded_gmv') is not null, 'finance summary defines seller GMV');
select public._exec_assert((public._executive_finance_summary()->'definitions'->>'promotion_credits') is not null, 'finance summary defines promotion credits');
select public._exec_assert((public._executive_finance_summary()->'definitions'->>'paid_promotion') is not null, 'finance summary defines paid promotion');

select public._exec_assert(
  coalesce((public._executive_analytics_summary()->'analytics_quality'->>'qa_excluded')::boolean, false),
  'company intelligence reports QA/test exclusion'
);

select public._exec_assert(
  (select payments_live_enabled from public.billing_config where id) is false,
  'payments remain disabled'
);

select public.ai_record_finding_service('boon','marketplace','INFO','Info test','info','{}','{}','HIGH',null);
select public.ai_record_finding_service('boon','marketplace','WATCH','Watch test','watch','{}','{}','HIGH',null);
select public.ai_record_finding_service('boon','marketplace','IMPORTANT','Important test','important','{}','{}','HIGH',null);
select public.ai_record_finding_service('boon','marketplace','URGENT','Urgent test','urgent','{}','{}','HIGH',null);
select public.ai_record_finding_service('boon','marketplace','CRITICAL','Critical test','critical','{}','{}','HIGH',null);

select public._exec_assert(
  exists (select 1 from public.ai_findings where severity = 'INFO' and escalated_to = '{}')
  and exists (select 1 from public.ai_findings where severity = 'WATCH' and escalated_to = '{}')
  and exists (select 1 from public.ai_findings where severity = 'IMPORTANT' and escalated_to = array['zordy']::text[])
  and exists (select 1 from public.ai_findings where severity = 'URGENT' and escalated_to = array['zordy','daniel']::text[])
  and exists (select 1 from public.ai_findings where severity = 'CRITICAL' and escalated_to = array['zordy','daniel']::text[]),
  'findings severity escalation is deterministic'
);

select public.run_agent_heartbeats();

select public._exec_assert(
  exists (select 1 from public.ai_heartbeat_runs where agent_id in
    ('gnome_hq','boon','buddy','enzo','gemma','reddy','senior','junior','debb','gee','kay','marty')),
  'heartbeat function records deterministic runs'
);

select public._exec_assert(
  not exists (
    select 1 from public.ai_heartbeat_runs
    where ai_interpretation_queued and deterministic_status = 'NORMAL'
  ),
  'normal heartbeat state does not queue AI interpretation'
);

rollback;
