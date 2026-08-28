-- Complimentary subscriptions (admin_plan_grants) + ONE effective-plan
-- resolver every enforcement point reads. Grants are an INDEPENDENT
-- entitlement source: Stripe never touches them, they never touch Stripe.
-- Effective = highest currently-valid source; expiry is computed from
-- timestamps at read time (no cron dependency). Sponsor keeps its existing
-- business rules (markets.plan='sponsor' wins outright).

create table if not exists public.admin_plan_grants (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan market_plan not null check (plan in ('grower','farm','sponsor')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,                -- null = no expiration
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED')),
  reason text not null,
  internal_note text,
  granted_by uuid,
  created_at timestamptz not null default now(),
  modified_by uuid,
  modified_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz
);
create index if not exists plan_grants_market_idx on public.admin_plan_grants (market_id) where status = 'ACTIVE';

alter table public.admin_plan_grants enable row level security;
drop policy if exists plan_grants_read on public.admin_plan_grants;
create policy plan_grants_read on public.admin_plan_grants
  for select using (public.admin_has_perm('subscriptions.view') or user_id = auth.uid());
revoke insert, update, delete on public.admin_plan_grants from anon, authenticated;
grant select on public.admin_plan_grants to authenticated;

-- ---------------------------------------------------------------------------
-- THE resolver. plan_rank orders entitlement strength.
-- ---------------------------------------------------------------------------
create or replace function public.plan_rank(p market_plan)
returns int language sql immutable
as $$ select case p when 'free' then 0 when 'grower' then 1 when 'farm' then 2 when 'sponsor' then 3 end; $$;

create or replace function public.market_effective_plan(p_market uuid)
returns table (plan market_plan, source text, grant_id uuid, grant_expires timestamptz)
language sql stable security definer set search_path = public
as $$
  with base as (
    select m.plan as base_plan from public.markets m where m.id = p_market
  ), best_grant as (
    select g.id, g.plan, g.expires_at
      from public.admin_plan_grants g
     where g.market_id = p_market and g.status = 'ACTIVE'
       and g.starts_at <= now()
       and (g.expires_at is null or g.expires_at > now())
     order by public.plan_rank(g.plan) desc, g.created_at desc
     limit 1
  )
  select
    case
      when b.base_plan = 'sponsor' then 'sponsor'::market_plan
      when bg.plan is not null and public.plan_rank(bg.plan) > public.plan_rank(b.base_plan) then bg.plan
      else b.base_plan
    end,
    case
      when b.base_plan = 'sponsor' then 'sponsor'
      when bg.plan is not null and public.plan_rank(bg.plan) > public.plan_rank(b.base_plan) then 'complimentary'
      when b.base_plan <> 'free' then 'stripe'
      else 'free'
    end,
    case when b.base_plan <> 'sponsor' and bg.plan is not null
          and public.plan_rank(bg.plan) > public.plan_rank(b.base_plan) then bg.id end,
    case when b.base_plan <> 'sponsor' and bg.plan is not null
          and public.plan_rank(bg.plan) > public.plan_rank(b.base_plan) then bg.expires_at end
  from base b left join best_grant bg on true;
$$;
revoke execute on function public.market_effective_plan(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rewire every enforcement point to the effective plan.
-- ---------------------------------------------------------------------------
create or replace function public.market_pickup_location_allowance(p_market uuid)
returns integer
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(pl.max_pickup_locations, 1)
       + case when pl.extra_location_fee_cents is not null
              then coalesce(m.extra_pickup_locations, 0) else 0 end
    from public.markets m
    cross join lateral public.market_effective_plan(m.id) ep
    left join public.plan_limits pl on pl.plan = ep.plan
   where m.id = p_market;
$$;

create or replace function public.enforce_plan_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  pl market_plan; cap integer; cur integer;
begin
  if new.status <> 'active' or new.market_id is null then return new; end if;
  select ep.plan into pl from public.market_effective_plan(new.market_id) ep;
  if pl is null then return new; end if;
  select max_active_listings into cap from public.plan_limits where plan = pl;
  if cap is null then return new; end if;
  cur := public.market_active_listing_count(new.market_id);
  if cur >= cap then
    raise exception 'PLAN_LIMIT_REACHED'
      using errcode = 'P0001',
            hint = format('active listing cap of %s reached for plan %s', cap, pl);
  end if;
  return new;
end $$;

create or replace function public.enforce_delivery_plan()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare pl market_plan;
begin
  select ep.plan into pl from public.market_effective_plan(new.market_id) ep;
  if pl is null or pl = 'free' then
    if new.radius_miles is not null and new.radius_miles > 15 then
      raise exception 'DELIVERY_PLAN_LIMIT:radius:Free Markets deliver up to 15 miles. Upgrade to go farther.'
        using errcode = 'P0001';
    end if;
    if new.surcharge_after_miles is not null
       or new.same_day or new.next_day or new.scheduled then
      raise exception 'DELIVERY_PLAN_LIMIT:features:Distance surcharges and delivery scheduling are Grower & Farm features.'
        using errcode = 'P0001';
    end if;
  end if;
  if not new.same_day then new.same_day_cutoff := null; end if;
  if not new.next_day then new.next_day_cutoff := null; end if;
  if not new.scheduled then new.order_by_dow := null; new.delivery_dows := '{}'; end if;
  new.updated_at := now();
  return new;
end $$;

-- Entitlements: now source-aware, with the AI Listing Assistant capability.
drop function if exists public.my_plan_entitlements();
create function public.my_plan_entitlements()
returns table (
  market_id uuid,
  plan market_plan,
  entitlement_source text,
  grant_expires_at timestamptz,
  grant_reason text,
  plan_price_cents int,
  subscription_status text,
  max_active_listings int,
  active_listings int,
  max_pickup_locations int,
  extra_location_fee_cents int,
  extra_pickup_locations int,
  effective_pickup_locations int,
  delivery_advanced boolean,
  ai_listing_assistant boolean
)
language sql stable security definer set search_path to 'public'
as $$
  select
    m.id,
    ep.plan,
    ep.source,
    ep.grant_expires,
    (select g.reason from public.admin_plan_grants g where g.id = ep.grant_id),
    pl.price_cents,
    (select s.status from public.market_subscriptions s
      where s.market_id = m.id and s.kind = 'plan' order by s.created_at desc limit 1),
    pl.max_active_listings,
    public.market_active_listing_count(m.id),
    pl.max_pickup_locations,
    pl.extra_location_fee_cents,
    m.extra_pickup_locations,
    public.market_pickup_location_allowance(m.id),
    ep.plan <> 'free',
    ep.plan <> 'free'
  from public.markets m
  cross join lateral public.market_effective_plan(m.id) ep
  join public.plan_limits pl on pl.plan = ep.plan
  where m.owner_id = auth.uid()
  limit 1;
$$;
grant execute on function public.my_plan_entitlements() to authenticated;

-- ---------------------------------------------------------------------------
-- Audited grant lifecycle RPCs (permission-checked).
-- ---------------------------------------------------------------------------
create or replace function public.admin_grant_plan(
  p_market uuid, p_plan market_plan, p_expires timestamptz,
  p_reason text, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_owner uuid; v_old record; v_new record; v_id uuid;
begin
  if not public.admin_has_perm('subscriptions.grant_complimentary') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_plan not in ('grower','farm') and not public.admin_is_owner() then
    raise exception 'OWNER_ONLY: sponsor grants are owner-level' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from public.markets where id = p_market;
  if v_owner is null then raise exception 'MARKET_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into v_old from public.market_effective_plan(p_market);

  insert into public.admin_plan_grants
    (market_id, user_id, plan, expires_at, reason, internal_note, granted_by)
  values (p_market, v_owner, p_plan, p_expires, btrim(p_reason), p_note, auth.uid())
  returning id into v_id;

  select * into v_new from public.market_effective_plan(p_market);
  perform public.reconcile_pickup_locations(p_market);
  perform public.admin_audit('COMP_GRANTED', 'market', p_market::text,
    jsonb_build_object('effective_plan', v_old.plan, 'source', v_old.source),
    jsonb_build_object('effective_plan', v_new.plan, 'source', v_new.source,
                       'grant_id', v_id, 'plan', p_plan, 'expires_at', p_expires),
    p_reason);
  return v_id;
end $$;

create or replace function public.admin_modify_grant(
  p_grant uuid, p_expires timestamptz, p_note text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare g public.admin_plan_grants;
begin
  if not public.admin_has_perm('subscriptions.modify_complimentary') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into g from public.admin_plan_grants where id = p_grant for update;
  if g is null then raise exception 'GRANT_NOT_FOUND' using errcode = 'P0001'; end if;
  update public.admin_plan_grants
     set expires_at = p_expires, internal_note = coalesce(p_note, internal_note),
         modified_by = auth.uid(), modified_at = now()
   where id = p_grant;
  perform public.reconcile_pickup_locations(g.market_id);
  perform public.admin_audit('COMP_MODIFIED', 'plan_grant', p_grant::text,
    jsonb_build_object('expires_at', g.expires_at),
    jsonb_build_object('expires_at', p_expires), null);
end $$;

create or replace function public.admin_revoke_grant(p_grant uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare g public.admin_plan_grants; v_old record; v_new record;
begin
  if not public.admin_has_perm('subscriptions.revoke_complimentary') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into g from public.admin_plan_grants where id = p_grant for update;
  if g is null then raise exception 'GRANT_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into v_old from public.market_effective_plan(g.market_id);
  update public.admin_plan_grants
     set status = 'REVOKED', revoked_by = auth.uid(), revoked_at = now()
   where id = p_grant;
  select * into v_new from public.market_effective_plan(g.market_id);
  perform public.reconcile_pickup_locations(g.market_id);
  perform public.admin_audit('COMP_REVOKED', 'market', g.market_id::text,
    jsonb_build_object('effective_plan', v_old.plan, 'source', v_old.source),
    jsonb_build_object('effective_plan', v_new.plan, 'source', v_new.source),
    p_reason);
end $$;

grant execute on function public.admin_grant_plan(uuid, market_plan, timestamptz, text, text) to authenticated;
grant execute on function public.admin_modify_grant(uuid, timestamptz, text) to authenticated;
grant execute on function public.admin_revoke_grant(uuid, text) to authenticated;

notify pgrst, 'reload schema';