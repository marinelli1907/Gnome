-- 0128: Zordy AI daily allowance.
--
-- One shared daily bucket for the customer-facing assistant:
--   Free  = 5 successful Zordy requests/day
--   Pro   = 25 successful Zordy requests/day  (internal enum: grower)
--   Farm  = 100 successful Zordy requests/day
--
-- The counter reuses ai_daily_counter from 0078 instead of introducing a second
-- entitlement system. Reservations are server-only; clients can only read
-- their own remaining count through my_zordy_usage().

begin;

create or replace function public.zordy_daily_limit(p_plan public.market_plan)
returns int
language sql
immutable
set search_path = public
as $$
  select case p_plan
    when 'grower'::public.market_plan then 25
    when 'farm'::public.market_plan then 100
    when 'sponsor'::public.market_plan then 100 -- retired Legacy Farm comp rung; no unlimited AI tier.
    else 5
  end;
$$;

create or replace function public.zordy_effective_plan_for_user(p_user uuid)
returns public.market_plan
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m uuid;
  p public.market_plan := 'free'::public.market_plan;
begin
  select id into m
  from public.markets
  where owner_id = p_user
  order by created_at asc
  limit 1;

  if m is null then
    return 'free'::public.market_plan;
  end if;

  select ep.plan into p
  from public.market_effective_plan(m) ep
  limit 1;

  return coalesce(p, 'free'::public.market_plan);
end;
$$;

create or replace function public.my_zordy_usage()
returns table (
  plan public.market_plan,
  plan_display text,
  daily_limit int,
  used int,
  remaining int,
  resets_on date
)
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select public.zordy_effective_plan_for_user(auth.uid()) as plan
  ),
  c as (
    select coalesce(count, 0) as used
    from public.ai_daily_counter
    where user_id = auth.uid()
      and feature = 'zordy'
      and day = (now() at time zone 'utc')::date
  )
  select
    p.plan,
    case p.plan
      when 'grower'::public.market_plan then 'Pro'
      when 'farm'::public.market_plan then 'Farm'
      when 'sponsor'::public.market_plan then 'Legacy Farm'
      else 'Free'
    end as plan_display,
    public.zordy_daily_limit(p.plan) as daily_limit,
    coalesce((select used from c), 0) as used,
    greatest(public.zordy_daily_limit(p.plan) - coalesce((select used from c), 0), 0) as remaining,
    ((now() at time zone 'utc')::date + 1) as resets_on
  from p;
$$;

create or replace function public.zordy_usage_for_user(p_user uuid)
returns table (
  plan public.market_plan,
  plan_display text,
  daily_limit int,
  used int,
  remaining int,
  resets_on date
)
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select public.zordy_effective_plan_for_user(p_user) as plan
  ),
  c as (
    select coalesce(count, 0) as used
    from public.ai_daily_counter
    where user_id = p_user
      and feature = 'zordy'
      and day = (now() at time zone 'utc')::date
  )
  select
    p.plan,
    case p.plan
      when 'grower'::public.market_plan then 'Pro'
      when 'farm'::public.market_plan then 'Farm'
      when 'sponsor'::public.market_plan then 'Legacy Farm'
      else 'Free'
    end as plan_display,
    public.zordy_daily_limit(p.plan) as daily_limit,
    coalesce((select used from c), 0) as used,
    greatest(public.zordy_daily_limit(p.plan) - coalesce((select used from c), 0), 0) as remaining,
    ((now() at time zone 'utc')::date + 1) as resets_on
  from p;
$$;

create or replace function public.zordy_reserve_request(p_user uuid)
returns table (
  allowed boolean,
  plan public.market_plan,
  plan_display text,
  daily_limit int,
  used int,
  remaining int,
  resets_on date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.market_plan;
  lim int;
  reserved boolean;
  used_now int;
begin
  p := public.zordy_effective_plan_for_user(p_user);
  lim := public.zordy_daily_limit(p);

  select coalesce(public.ai_reserve_slot(p_user, 'zordy', lim), false) into reserved;

  select coalesce((
    select c.count
    from public.ai_daily_counter c
    where c.user_id = p_user
      and c.feature = 'zordy'
      and c.day = (now() at time zone 'utc')::date
  ), 0) into used_now;

  return query select
    reserved,
    p,
    case p
      when 'grower'::public.market_plan then 'Pro'
      when 'farm'::public.market_plan then 'Farm'
      when 'sponsor'::public.market_plan then 'Legacy Farm'
      else 'Free'
    end,
    lim,
    used_now,
    greatest(lim - used_now, 0),
    ((now() at time zone 'utc')::date + 1);
end;
$$;

create or replace function public.zordy_release_request(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_daily_counter
     set count = greatest(count - 1, 0)
   where user_id = p_user
     and feature = 'zordy'
     and day = (now() at time zone 'utc')::date
     and count > 0;
$$;

revoke execute on function public.zordy_daily_limit(public.market_plan) from public, anon, authenticated;
revoke execute on function public.zordy_effective_plan_for_user(uuid) from public, anon, authenticated;
revoke execute on function public.zordy_usage_for_user(uuid) from public, anon, authenticated;
revoke execute on function public.zordy_reserve_request(uuid) from public, anon, authenticated;
revoke execute on function public.zordy_release_request(uuid) from public, anon, authenticated;
grant execute on function public.zordy_usage_for_user(uuid) to service_role;
grant execute on function public.zordy_reserve_request(uuid) to service_role;
grant execute on function public.zordy_release_request(uuid) to service_role;

revoke execute on function public.my_zordy_usage() from public, anon;
grant execute on function public.my_zordy_usage() to authenticated;

do $$
begin
  if public.zordy_daily_limit('free'::public.market_plan) <> 5
     or public.zordy_daily_limit('grower'::public.market_plan) <> 25
     or public.zordy_daily_limit('farm'::public.market_plan) <> 100 then
    raise exception '0128 self-check: Zordy daily limits drifted';
  end if;

  if has_function_privilege('anon', 'public.my_zordy_usage()', 'execute') then
    raise exception '0128 self-check: anon can execute my_zordy_usage';
  end if;

  if has_function_privilege('authenticated', 'public.zordy_reserve_request(uuid)', 'execute') then
    raise exception '0128 self-check: client can reserve Zordy usage directly';
  end if;

  if not has_function_privilege('service_role', 'public.zordy_reserve_request(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.zordy_release_request(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.zordy_usage_for_user(uuid)', 'execute') then
    raise exception '0128 self-check: service_role cannot execute server Zordy RPCs';
  end if;

  if to_regclass('public.billing_config') is not null and exists (
    select 1 from public.billing_config where payments_live_enabled is true
  ) then
    raise exception '0128 self-check: payments_live_enabled must stay false';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
