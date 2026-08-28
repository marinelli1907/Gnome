-- Unified Apple / Google Play / Stripe subscription entitlement ledger.
--
-- This migration does not enable billing, create a charge, or alter physical
-- marketplace payments. Production store transactions remain refused while
-- billing_config.payments_live_enabled is false; sandbox/test transactions can
-- be reconciled for QA. Complimentary grants remain a separate, non-billing
-- layer in admin_plan_grants.

-- ---------------------------------------------------------------------------
-- Provider product map. Store IDs are stable; prices remain store-authoritative.
-- ---------------------------------------------------------------------------
create table public.subscription_provider_products (
  provider text not null check (provider in ('APPLE','GOOGLE_PLAY','STRIPE')),
  product_id text not null,
  plan public.market_plan not null check (plan in ('grower','farm')),
  billing_period text not null default 'P1M' check (billing_period = 'P1M'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, product_id)
);

insert into public.subscription_provider_products(provider,product_id,plan) values
  ('APPLE','gnome.pro.monthly','grower'),
  ('APPLE','gnome.farm.monthly','farm'),
  ('GOOGLE_PLAY','gnome.pro.monthly','grower'),
  ('GOOGLE_PLAY','gnome.farm.monthly','farm'),
  ('STRIPE','GNOME_GROWER_MONTHLY','grower'),
  ('STRIPE','GNOME_FARM_MONTHLY','farm');

alter table public.subscription_provider_products enable row level security;
revoke all on public.subscription_provider_products from public, anon, authenticated;
grant select on public.subscription_provider_products to authenticated;
create policy subscription_provider_products_read
  on public.subscription_provider_products for select to authenticated using (active);

-- ---------------------------------------------------------------------------
-- Extend the existing authoritative subscription table. Provider credentials
-- and raw purchase tokens deliberately live in a separate service-only table.
-- ---------------------------------------------------------------------------
alter table public.market_subscriptions
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists billing_source text,
  add column if not exists external_product_id text,
  add column if not exists external_transaction_id text,
  add column if not exists original_transaction_id text,
  add column if not exists environment text,
  add column if not exists started_at timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists expires_at timestamptz,
  add column if not exists last_verified_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists status_detail text,
  add column if not exists updated_at timestamptz not null default now();

update public.market_subscriptions s set
  user_id = m.owner_id,
  billing_source = case lower(coalesce(s.provider,''))
    when 'stripe' then 'STRIPE'
    when 'apple' then 'APPLE'
    when 'google_play' then 'GOOGLE_PLAY'
    else null end,
  started_at = coalesce(s.current_period_start,s.created_at),
  expires_at = coalesce(s.expires_at,s.current_period_end),
  last_verified_at = coalesce(s.last_verified_at,s.created_at)
from public.markets m
where m.id=s.market_id
  and (s.user_id is null or s.billing_source is null or s.started_at is null or s.last_verified_at is null);

do $$ begin
  alter table public.market_subscriptions add constraint market_subscriptions_billing_source_chk
    check (billing_source is null or billing_source in ('APPLE','GOOGLE_PLAY','STRIPE'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.market_subscriptions add constraint market_subscriptions_environment_chk
    check (environment is null or environment in ('SANDBOX','TEST','PRODUCTION'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.market_subscriptions add constraint market_subscriptions_status_chk
    check (status is null or status in (
      'pending','active','trialing','grace_period','billing_retry','past_due','paused',
      'canceled','cancelled','expired','revoked','refunded','superseded','incomplete',
      'incomplete_expired','unpaid'));
exception when duplicate_object then null; end $$;

create unique index market_subscriptions_provider_external_uq
  on public.market_subscriptions(billing_source,external_transaction_id)
  where billing_source is not null and external_transaction_id is not null and kind='plan';
create index market_subscriptions_active_provider_idx
  on public.market_subscriptions(market_id,billing_source,status,current_period_end)
  where kind='plan';

create table public.subscription_provider_secrets (
  subscription_id uuid primary key references public.market_subscriptions(id) on delete cascade,
  provider text not null check (provider in ('APPLE','GOOGLE_PLAY')),
  purchase_token text not null,
  token_sha256 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,token_sha256)
);
alter table public.subscription_provider_secrets enable row level security;
revoke all on public.subscription_provider_secrets from public, anon, authenticated;

create table public.subscription_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('APPLE','GOOGLE_PLAY','STRIPE')),
  external_event_id text not null,
  event_type text not null,
  environment text not null check (environment in ('SANDBOX','TEST','PRODUCTION')),
  subscription_id uuid references public.market_subscriptions(id) on delete set null,
  payload_sha256 text not null,
  outcome text not null check (outcome in ('PROCESSED','DUPLICATE','REFUSED')),
  detail text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider,external_event_id)
);
alter table public.subscription_provider_events enable row level security;
revoke all on public.subscription_provider_events from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Provider reconciliation. Edge Functions must verify the provider response
-- before calling this service-role-only mutation. Client assertions never reach
-- the entitlement ledger.
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_market_paid_plan(p_market uuid)
returns public.market_plan language plpgsql security definer set search_path=public as $$
declare v_plan public.market_plan;
begin
  if auth.role() <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;

  select s.plan into v_plan
    from public.market_subscriptions s
   where s.market_id=p_market and s.kind='plan'
     and s.status in ('active','trialing','grace_period','canceled','cancelled')
     and (s.expires_at is null or s.expires_at>now())
   order by public.plan_rank(s.plan) desc, s.expires_at desc nulls first, s.updated_at desc
   limit 1;

  v_plan:=coalesce(v_plan,'free'::public.market_plan);
  update public.markets set plan=v_plan where id=p_market and plan is distinct from v_plan;
  return v_plan;
end $$;
revoke execute on function public.reconcile_market_paid_plan(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_market_paid_plan(uuid) to service_role;

create or replace function public.record_verified_subscription(
  p_provider text,
  p_user uuid,
  p_product_id text,
  p_external_subscription_id text,
  p_external_transaction_id text,
  p_status text,
  p_environment text,
  p_started_at timestamptz,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_expires_at timestamptz,
  p_event_id text,
  p_event_type text,
  p_payload_sha256 text,
  p_purchase_token text default null,
  p_purchase_token_sha256 text default null,
  p_replaces_external_id text default null,
  p_status_detail text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_provider text:=upper(trim(p_provider));
  v_environment text:=upper(trim(p_environment));
  v_market uuid;
  v_plan public.market_plan;
  v_sub uuid;
  v_existing_user uuid;
  v_live boolean;
  v_event uuid;
  v_effective public.market_plan;
begin
  if auth.role() <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if v_provider not in ('APPLE','GOOGLE_PLAY','STRIPE') then raise exception 'INVALID_PROVIDER'; end if;
  if v_environment not in ('SANDBOX','TEST','PRODUCTION') then raise exception 'INVALID_ENVIRONMENT'; end if;
  if p_status not in ('pending','active','trialing','grace_period','billing_retry','past_due','paused','canceled','cancelled','expired','revoked','refunded','superseded','incomplete','incomplete_expired','unpaid') then
    raise exception 'INVALID_SUBSCRIPTION_STATUS';
  end if;
  if nullif(trim(p_external_subscription_id),'') is null or nullif(trim(p_event_id),'') is null then
    raise exception 'MISSING_PROVIDER_REFERENCE';
  end if;

  select payments_live_enabled into v_live from public.billing_config where id;
  if v_environment='PRODUCTION' and not coalesce(v_live,false) then
    raise exception 'LIVE_PAYMENTS_DISABLED';
  end if;

  select plan into v_plan from public.subscription_provider_products
   where provider=v_provider and product_id=p_product_id and active;
  if v_plan is null then raise exception 'UNKNOWN_PROVIDER_PRODUCT'; end if;

  -- Claim the event before mutating entitlement state. The unique key makes
  -- simultaneous provider retries exact-once; a later failure rolls this
  -- insert back with the rest of the transaction.
  insert into public.subscription_provider_events(
    provider,external_event_id,event_type,environment,payload_sha256,outcome)
  values(v_provider,p_event_id,p_event_type,v_environment,p_payload_sha256,'PROCESSED')
  on conflict(provider,external_event_id) do nothing
  returning id into v_event;
  if v_event is null then
    select id into v_event from public.subscription_provider_events
     where provider=v_provider and external_event_id=p_event_id;
    return jsonb_build_object('outcome','DUPLICATE','event_id',v_event);
  end if;

  select id into v_market from public.markets where owner_id=p_user order by created_at limit 1 for update;
  if v_market is null then raise exception 'MARKET_NOT_FOUND'; end if;

  select user_id into v_existing_user from public.market_subscriptions
   where billing_source=v_provider and external_transaction_id=p_external_subscription_id and kind='plan'
   limit 1;
  if v_existing_user is not null and v_existing_user<>p_user then raise exception 'PURCHASE_ALREADY_CLAIMED'; end if;

  insert into public.market_subscriptions(
    market_id,user_id,plan,kind,provider,billing_source,customer_id,subscription_id,
    external_product_id,external_transaction_id,original_transaction_id,status,
    environment,current_period_start,current_period_end,started_at,cancel_at_period_end,
    expires_at,last_verified_at,revoked_at,status_detail,updated_at,stripe_livemode)
  values(
    v_market,p_user,v_plan,'plan',lower(v_provider),v_provider,null,p_external_subscription_id,
    p_product_id,p_external_subscription_id,nullif(p_external_transaction_id,''),p_status,
    v_environment,p_started_at,p_period_end,coalesce(p_started_at,now()),coalesce(p_cancel_at_period_end,false),
    coalesce(p_expires_at,p_period_end),now(),case when p_status in ('revoked','refunded') then now() end,
    nullif(p_status_detail,''),now(),case when v_provider='STRIPE' then v_environment='PRODUCTION' else null end)
  on conflict (billing_source,external_transaction_id) where billing_source is not null and external_transaction_id is not null and kind='plan'
  do update set
    user_id=excluded.user_id, market_id=excluded.market_id, plan=excluded.plan,
    external_product_id=excluded.external_product_id,
    original_transaction_id=excluded.original_transaction_id,
    status=excluded.status, environment=excluded.environment,
    current_period_start=excluded.current_period_start,
    current_period_end=excluded.current_period_end,
    cancel_at_period_end=excluded.cancel_at_period_end,
    expires_at=excluded.expires_at,last_verified_at=now(),
    revoked_at=excluded.revoked_at,status_detail=excluded.status_detail,updated_at=now()
  returning id into v_sub;

  if v_provider in ('APPLE','GOOGLE_PLAY') and p_purchase_token is not null and p_purchase_token_sha256 is not null then
    insert into public.subscription_provider_secrets(subscription_id,provider,purchase_token,token_sha256)
    values(v_sub,v_provider,p_purchase_token,p_purchase_token_sha256)
    on conflict(subscription_id) do update set purchase_token=excluded.purchase_token,
      token_sha256=excluded.token_sha256,updated_at=now();
  end if;

  if p_replaces_external_id is not null then
    update public.market_subscriptions set status='superseded',cancel_at_period_end=true,updated_at=now()
     where market_id=v_market and billing_source=v_provider and kind='plan'
       and external_transaction_id=p_replaces_external_id and id<>v_sub
       and status not in ('expired','revoked','refunded','superseded');
  end if;

  update public.subscription_provider_events
     set subscription_id=v_sub,processed_at=now()
   where id=v_event;

  v_effective:=public.reconcile_market_paid_plan(v_market);
  return jsonb_build_object('outcome','PROCESSED','event_id',v_event,'subscription_id',v_sub,
    'market_id',v_market,'paid_plan',v_effective,'source',v_provider);
end $$;
revoke execute on function public.record_verified_subscription(text,uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.record_verified_subscription(text,uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,text,text,text,text,text,text,text) to service_role;

-- Paid plan is resolved from live verified records. A complimentary grant only
-- wins when it is a higher rung; after it expires the paid source is visible
-- again without rewriting subscription history.
create or replace function public.market_effective_plan(p_market uuid)
returns table(plan public.market_plan, source text, grant_id uuid, grant_expires timestamptz)
language sql stable security definer set search_path=public as $$
  with legacy as (
    select m.plan from public.markets m where m.id=p_market
  ), provider_history as (
    select exists(select 1 from public.market_subscriptions s where s.market_id=p_market and s.kind='plan') present
  ), paid as (
    select s.plan,s.billing_source
      from public.market_subscriptions s
     where s.market_id=p_market and s.kind='plan'
       and s.status in ('active','trialing','grace_period','canceled','cancelled')
       and (s.expires_at is null or s.expires_at>now())
     order by public.plan_rank(s.plan) desc,s.expires_at desc nulls first,s.updated_at desc
     limit 1
  ), base as (
    select coalesce(p.plan,case when h.present then 'free'::public.market_plan else l.plan end,'free'::public.market_plan) plan,
      case when p.plan is not null then coalesce(p.billing_source,upper(nullif((select provider from public.market_subscriptions s
             where s.market_id=p_market and s.plan=p.plan and s.kind='plan'
             order by s.updated_at desc limit 1),'')),'legacy')
           when h.present then 'free'
           when l.plan='sponsor' then 'sponsor'
           when l.plan<>'free' then 'legacy'
           else 'free' end source
    from legacy l cross join provider_history h left join paid p on true
  ), best_grant as (
    select g.id,g.plan,g.expires_at from public.admin_plan_grants g
     where g.market_id=p_market and g.status='ACTIVE' and g.starts_at<=now()
       and (g.expires_at is null or g.expires_at>now())
     order by public.plan_rank(g.plan) desc,g.created_at desc limit 1
  )
  select
    case when bg.plan is not null and public.plan_rank(bg.plan)>public.plan_rank(b.plan) then bg.plan else b.plan end,
    case when bg.plan is not null and public.plan_rank(bg.plan)>public.plan_rank(b.plan) then 'complimentary' else b.source end,
    case when bg.plan is not null and public.plan_rank(bg.plan)>public.plan_rank(b.plan) then bg.id end,
    case when bg.plan is not null and public.plan_rank(bg.plan)>public.plan_rank(b.plan) then bg.expires_at end
  from base b left join best_grant bg on true;
$$;
revoke execute on function public.market_effective_plan(uuid) from public, anon, authenticated;

create or replace function public.my_subscription_summary()
returns jsonb language sql stable security definer set search_path=public as $$
  with my_market as (select id from public.markets where owner_id=auth.uid() order by created_at limit 1),
  ep as (select e.* from my_market m cross join lateral public.market_effective_plan(m.id) e),
  paid as (
    select s.* from public.market_subscriptions s join my_market m on m.id=s.market_id
     where s.kind='plan' and s.status in ('active','trialing','grace_period','billing_retry','pending','paused','canceled','cancelled')
     order by public.plan_rank(s.plan) desc,s.updated_at desc
  )
  select jsonb_build_object(
    'effective_plan',(select plan from ep),
    'effective_source',(select source from ep),
    'grant_expires_at',(select grant_expires from ep),
    'paid_subscriptions',coalesce((select jsonb_agg(jsonb_build_object(
      'plan',plan,'source',billing_source,'status',status,'product_id',external_product_id,
      'renews_at',current_period_end,'expires_at',expires_at,'cancel_at_period_end',cancel_at_period_end,
      'last_verified_at',last_verified_at,'environment',environment
    ) order by public.plan_rank(plan) desc,updated_at desc) from paid),'[]'::jsonb),
    'duplicate_paid_sources',(select count(distinct billing_source)>1 from paid
      where status in ('active','trialing','grace_period','canceled','cancelled')
        and (expires_at is null or expires_at>now()))
  );
$$;
revoke execute on function public.my_subscription_summary() from public, anon;
grant execute on function public.my_subscription_summary() to authenticated;

create or replace function public.admin_subscription_health()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when not public.admin_has_perm('subscriptions.view') then null else jsonb_build_object(
    'payments_live_enabled',(select payments_live_enabled from public.billing_config where id),
    'stripe_mode',(select stripe_mode from public.billing_config where id),
    'counts_by_source',coalesce((select jsonb_object_agg(billing_source,n) from (
      select billing_source,count(distinct user_id) n from public.market_subscriptions
       where kind='plan' and status in ('active','grace_period','canceled','cancelled') and environment='PRODUCTION'
         and (expires_at is null or expires_at>now()) group by billing_source
    ) q),'{}'::jsonb),
    'counts_by_plan',coalesce((select jsonb_object_agg(plan,n) from (
      select plan,count(distinct user_id) n from public.market_subscriptions
       where kind='plan' and status in ('active','grace_period','canceled','cancelled') and environment='PRODUCTION'
         and (expires_at is null or expires_at>now()) group by plan
    ) q),'{}'::jsonb),
    'active_trial_total',(select count(distinct user_id) from public.market_subscriptions
      where kind='plan' and status='trialing' and environment='PRODUCTION'
        and (expires_at is null or expires_at>now())),
    'test_subscription_total',(select count(distinct user_id) from public.market_subscriptions
      where kind='plan' and environment in ('SANDBOX','TEST')
        and status in ('active','trialing','grace_period','canceled','cancelled')
        and (expires_at is null or expires_at>now())),
    'complimentary_active',(select count(*) from public.admin_plan_grants
      where status='ACTIVE' and starts_at<=now() and (expires_at is null or expires_at>now())),
    'estimated_gross_mrr_cents',(select coalesce(sum(pl.price_cents),0)
      from public.market_subscriptions s join public.plan_limits pl on pl.plan=s.plan
      where s.kind='plan' and s.status in ('active','grace_period','canceled','cancelled')
        and (s.expires_at is null or s.expires_at>now()) and s.environment='PRODUCTION'),
    'subscriptions',coalesce((select jsonb_agg(jsonb_build_object(
      'user_id',s.user_id,'user',coalesce(p.name,u.email,'Unknown user'),'market_id',s.market_id,
      'plan',s.plan,'source',s.billing_source,'status',s.status,'renewal',s.current_period_end,
      'cancel_at_period_end',s.cancel_at_period_end,'last_verified',s.last_verified_at,
      'environment',s.environment
    ) order by s.updated_at desc)
      from public.market_subscriptions s
      left join public.profiles p on p.id=s.user_id left join auth.users u on u.id=s.user_id
      where s.kind='plan'),'[]'::jsonb)
  ) end;
$$;
revoke execute on function public.admin_subscription_health() from public, anon;
grant execute on function public.admin_subscription_health() to authenticated;

create or replace function public.subscription_finance_summary_service()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if auth.role()<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  return jsonb_build_object(
    'active_paying_total',(select count(distinct user_id) from public.market_subscriptions where kind='plan'
      and status in ('active','grace_period','canceled','cancelled') and environment='PRODUCTION'
      and (expires_at is null or expires_at>now())),
    'active_trial_total',(select count(distinct user_id) from public.market_subscriptions where kind='plan'
      and status='trialing' and environment='PRODUCTION' and (expires_at is null or expires_at>now())),
    'test_subscription_total',(select count(distinct user_id) from public.market_subscriptions where kind='plan'
      and environment in ('SANDBOX','TEST') and status in ('active','trialing','grace_period','canceled','cancelled')
      and (expires_at is null or expires_at>now())),
    'by_source',coalesce((select jsonb_object_agg(billing_source,n) from (
      select billing_source,count(distinct user_id) n from public.market_subscriptions where kind='plan'
        and status in ('active','grace_period','canceled','cancelled') and environment='PRODUCTION'
        and (expires_at is null or expires_at>now()) group by billing_source) q),'{}'::jsonb),
    'by_plan',coalesce((select jsonb_object_agg(plan,n) from (
      select plan,count(distinct user_id) n from public.market_subscriptions where kind='plan'
        and status in ('active','grace_period','canceled','cancelled') and environment='PRODUCTION'
        and (expires_at is null or expires_at>now()) group by plan) q),'{}'::jsonb),
    'complimentary_active',(select count(*) from public.admin_plan_grants where status='ACTIVE'
      and starts_at<=now() and (expires_at is null or expires_at>now())),
    'estimated_gross_mrr_cents',(select coalesce(sum(pl.price_cents),0)
      from public.market_subscriptions s join public.plan_limits pl on pl.plan=s.plan
      where s.kind='plan' and s.status in ('active','grace_period','canceled','cancelled')
        and (s.expires_at is null or s.expires_at>now()) and s.environment='PRODUCTION'),
    'net_revenue','DATA UNAVAILABLE: Apple/Google/Stripe fees, taxes, refunds, and settlements are not reconciled here',
    'payments_live_enabled',(select payments_live_enabled from public.billing_config where id)
  );
end $$;
revoke execute on function public.subscription_finance_summary_service() from public, anon, authenticated;
grant execute on function public.subscription_finance_summary_service() to service_role;

-- Production activation remains an explicit later owner action.
do $$ begin
  if coalesce((select payments_live_enabled from public.billing_config where id),false) then
    raise exception 'unified_native_subscriptions refuses to apply while payments_live_enabled=true';
  end if;
end $$;

notify pgrst,'reload schema';
