-- Apple Guideline 3.1.1 boundary for one-time listing overages.
--
-- A Stripe authorization for GNOME_LISTING_PUBLISH or GNOME_LISTING_RENEWAL is
-- a web-only purchase. It is not an equivalent App Store IAP product, so a
-- native request must never consume it to publish or renew digital content.
-- Included plan allowance and unlimited verified subscription tiers continue
-- to work on every platform. Missing or malformed platform context fails
-- closed; only the Gnome web client marks requests as web.

create or replace function public.enforce_publish_allowance()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  eff              record;
  per              record;
  lim              record;
  v_kind           text;
  used             int;
  allowed          int;
  auth_row         public.listing_publish_authorizations;
  request_platform text := lower(coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-gnome-platform',
    ''
  ));
begin
  if new.status <> 'active' or new.market_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' then return new; end if;

  if not public.listing_type_spends_allowance(new.listing_type) then return new; end if;

  select ep.plan into eff from public.market_effective_plan(new.market_id) ep;
  if eff.plan is null then return new; end if;

  select * into per from public.market_allowance_period(new.market_id);
  select pl.* into lim from public.plan_limits pl where pl.plan = eff.plan;

  v_kind := case
    when exists (select 1 from public.listing_publish_events e
                  where e.listing_id = new.id and e.kind = 'publish')
    then 'renewal' else 'publish' end;

  allowed := case when v_kind = 'publish'
                  then lim.monthly_publish_allowance
                  else lim.included_renewals_per_period end;

  if allowed is null then
    insert into public.listing_publish_events
      (market_id, listing_id, kind, funded, period_start, period_source, plan_at_time)
    values (new.market_id, new.id, v_kind, 'unlimited', per.period_start, per.source, eff.plan);
    return new;
  end if;

  select count(*)::int into used
  from public.listing_publish_events
  where market_id = new.market_id
    and period_start = per.period_start
    and kind = v_kind
    and funded = 'included';

  if used < allowed then
    insert into public.listing_publish_events
      (market_id, listing_id, kind, funded, period_start, period_source, plan_at_time)
    values (new.market_id, new.id, v_kind, 'included', per.period_start, per.source, eff.plan);
    return new;
  end if;

  -- Paid one-time authorizations are web items. Native/missing platform
  -- requests intentionally behave as though no such authorization exists.
  if request_platform = 'web' then
    select * into auth_row
    from public.listing_publish_authorizations
    where market_id = new.market_id
      and intent = v_kind
      and status = 'paid'
      and (listing_id is null or listing_id = new.id)
    order by (listing_id = new.id) desc nulls last, paid_at asc
    limit 1
    for update skip locked;

    if found then
      update public.listing_publish_authorizations
         set status = 'consumed', consumed_at = now(), listing_id = new.id
       where id = auth_row.id;

      insert into public.listing_publish_events
        (market_id, listing_id, kind, funded, period_start, period_source, plan_at_time, authorization_id)
      values (new.market_id, new.id, v_kind, 'paid', per.period_start, per.source, eff.plan, auth_row.id);
      return new;
    end if;
  end if;

  raise exception 'PUBLISH_ALLOWANCE_EXHAUSTED'
    using errcode = 'P0001',
          hint = format('%s allowance of %s spent for plan %s in period starting %s',
                        v_kind, allowed, eff.plan, per.period_start);
end $$;

do $$
declare body text := pg_get_functiondef('public.enforce_publish_allowance()'::regprocedure);
begin
  if body not like '%request_platform = ''web''%' then
    raise exception 'iOS overage boundary self-check failed';
  end if;
  if (select payments_live_enabled from public.billing_config where id) then
    raise exception 'payments_live_enabled must remain false';
  end if;
end $$;
