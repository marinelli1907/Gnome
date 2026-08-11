-- 0080: Gemini-first provider pivot (pre-revenue $0 AI).
--
-- Gemini Developer API (free tier) becomes the PRIMARY provider for every AI
-- feature; Anthropic/OpenAI adapters stay wired but paid fallback is gated
-- behind ai_settings.allow_paid_fallback (default FALSE — Gemini exhausting
-- its free quota degrades gracefully instead of silently spending money).
-- Models (verified current on ai.google.dev, 2026-08-11):
--   gemini-3.6-flash       HQ / compliance / security / finance + vision
--   gemini-3.5-flash-lite  routine specialists + site assistant
-- Provider/model/fallback stay per-agent config (admin_set_agent) — business
-- logic reads config; it never hardwires a vendor.

-- ---- settings: the paid-fallback gate -------------------------------------
alter table public.ai_settings
  add column if not exists allow_paid_fallback boolean not null default false;

-- ---- usage log: free-tier cost telemetry ----------------------------------
alter table public.ai_usage_log
  add column if not exists actual_cost_cents numeric,
  add column if not exists free_tier boolean;

-- ---- agent defaults → Gemini ----------------------------------------------
update public.ai_agents set
  provider = 'gemini',
  model = case when id in ('gnome_hq','compliance','security','finance')
               then 'gemini-3.6-flash' else 'gemini-3.5-flash-lite' end,
  fallback_provider = 'openai',        -- inert until allow_paid_fallback=true
  fallback_model = 'gpt-4o-mini',
  updated_at = now();

-- ---- admin_set_agent grows fallback config (same permission gates) --------
drop function if exists public.admin_set_agent(text, text, integer, text, text, integer);
create or replace function public.admin_set_agent(
  p_agent text, p_status text default null, p_automation integer default null,
  p_provider text default null, p_model text default null, p_budget integer default null,
  p_fallback_provider text default null, p_fallback_model text default null
) returns void language plpgsql security definer set search_path = public as $$
declare old_row public.ai_agents;
begin
  if not public.admin_has_perm('ai.manage_agents') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if (p_automation is not null and p_automation >= 3) and not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  if p_provider is not null and p_provider not in ('gemini','openai','anthropic') then
    raise exception 'BAD_PROVIDER: %', p_provider using errcode = 'P0001';
  end if;
  if p_fallback_provider is not null and p_fallback_provider not in ('gemini','openai','anthropic','none') then
    raise exception 'BAD_PROVIDER: %', p_fallback_provider using errcode = 'P0001';
  end if;
  select * into old_row from public.ai_agents where id = p_agent for update;
  if old_row is null then raise exception 'AGENT_NOT_FOUND' using errcode = 'P0001'; end if;
  update public.ai_agents set
    status = coalesce(p_status, status),
    automation_level = coalesce(p_automation, automation_level),
    provider = coalesce(p_provider, provider),
    model = coalesce(p_model, model),
    daily_budget_cents = coalesce(p_budget, daily_budget_cents),
    fallback_provider = case when p_fallback_provider = 'none' then null
                             else coalesce(p_fallback_provider, fallback_provider) end,
    fallback_model = case when p_fallback_provider = 'none' then null
                          else coalesce(p_fallback_model, fallback_model) end,
    updated_at = now()
  where id = p_agent;
  perform public.admin_audit('AI_AGENT_UPDATED', 'ai_agent', p_agent,
    to_jsonb(old_row), (select to_jsonb(a) from public.ai_agents a where a.id = p_agent), null);
end $$;
revoke execute on function public.admin_set_agent(text,text,integer,text,text,integer,text,text) from public, anon;
grant execute on function public.admin_set_agent(text,text,integer,text,text,integer,text,text) to authenticated;

-- ---- paid-fallback toggle (kill-switch-tier permission, audited) ----------
create or replace function public.admin_set_paid_fallback(p_allow boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_has_perm('ai.pause_actions') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  update public.ai_settings set allow_paid_fallback = p_allow,
    updated_by = auth.uid(), updated_at = now() where id = true;
  perform public.admin_audit(
    case when p_allow then 'AI_PAID_FALLBACK_ENABLED' else 'AI_PAID_FALLBACK_DISABLED' end,
    'ai_settings', 'singleton', null, jsonb_build_object('allow_paid_fallback', p_allow), null);
end $$;
revoke execute on function public.admin_set_paid_fallback(boolean) from public, anon;
grant execute on function public.admin_set_paid_fallback(boolean) to authenticated;

-- ---- provider health stats for the Admin app (usage-derived; no keys) -----
create or replace function public.admin_ai_provider_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.admin_has_perm('ai.view') then null else
    coalesce((
      select jsonb_object_agg(p, s) from (
        select provider as p, jsonb_build_object(
          'last_success', max(created_at) filter (where success),
          'last_failure', max(created_at) filter (where not success),
          'calls_today', count(*) filter (where created_at >= date_trunc('day', now())),
          'fails_today', count(*) filter (where not success and created_at >= date_trunc('day', now())),
          'est_cents_today', coalesce(sum(estimated_cost_cents) filter (where created_at >= date_trunc('day', now())), 0),
          'actual_cents_today', coalesce(sum(actual_cost_cents) filter (where created_at >= date_trunc('day', now())), 0)
        ) as s
        from public.ai_usage_log where provider is not null
        group by provider) t
    ), '{}'::jsonb)
  end;
$$;
revoke execute on function public.admin_ai_provider_stats() from public, anon;
grant execute on function public.admin_ai_provider_stats() to authenticated;

notify pgrst, 'reload schema';

-- (applied separately as ai_usage_room_column, same session)
-- Per-room Boardroom cost attribution (Section 12: track usage by room).
alter table public.ai_usage_log add column if not exists room_id uuid;
create index if not exists ai_usage_room_idx on public.ai_usage_log (room_id) where room_id is not null;
