-- 0081: the locked commercial model.
--   Plans: Neighbor 5 / Grower 25 (was 50) / Farm unlimited; promotions 0/3/10;
--   plan capability booleans become explicit config (no derived plan-name checks).
--   Promotions: $3.99 / 7 days; included credits stay HISTORY-COUNTED per
--   calendar month (auditable, no mutable counter, upgrade-cycling can't farm
--   allowance because usage is counted from immutable rows); purchased credits
--   live in an append-only ledger (webhook/admin writes only).
--   Seed Drop: seasonal subscription model — configurable season windows with
--   join cutoffs, per-window skips, wave generation with double-generation
--   protection, and shipment economics columns.
-- All changes additive. Entitlement authority stays plan_limits +
-- market_effective_plan()/my_plan_entitlements().

-- ============================================================ 1. PLAN VALUES
update public.plan_limits set max_active_listings = 25, included_boost_credits = 3
 where plan = 'grower';
update public.plan_limits set included_boost_credits = 10 where plan = 'farm';
update public.plan_limits set included_boost_credits = 10 where plan = 'sponsor';
update public.plan_limits set included_boost_credits = 0  where plan = 'free';

alter table public.plan_limits
  add column if not exists ai_listing_assistant boolean not null default false,
  add column if not exists advanced_delivery boolean not null default false;
update public.plan_limits set ai_listing_assistant = (plan <> 'free'),
                              advanced_delivery = (plan <> 'free');

-- ==================================== 2. PROMOTION CREDITS (effective plan!)
-- BUGFIX: 0011 read markets.plan RAW — complimentary Grower/Farm grants got 0
-- credits. Allowance now follows the effective plan, same as every other
-- entitlement. Usage = count of plan_credit promotions this calendar month.
create or replace function public.market_boost_credits_remaining(p_market_id uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select greatest(
    0,
    coalesce((select pl.included_boost_credits
              from public.market_effective_plan(p_market_id) ep
              join public.plan_limits pl on pl.plan = ep.plan), 0)
    - coalesce((select count(*)::int
                from public.listing_promotions lp
                where lp.market_id = p_market_id
                  and lp.source = 'plan_credit'
                  and date_trunc('month', lp.created_at) = date_trunc('month', now())), 0)
  );
$$;

-- Purchased-credit ledger: append-only; clients NEVER write (webhook / admin /
-- definer RPCs only). Balance = sum(delta). Purchased credits do NOT expire at
-- the monthly included reset.
create table if not exists public.market_promotion_credits (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  delta integer not null check (delta <> 0),
  reason text not null,
  source text not null check (source in
    ('PURCHASED_SINGLE','PURCHASED_PACK_3','PURCHASED_PACK_10','ADMIN_COMP','REFUND','CONSUMED')),
  stripe_session_id text unique,
  promotion_id uuid references public.listing_promotions(id),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists mpc_market_idx on public.market_promotion_credits (market_id);
alter table public.market_promotion_credits enable row level security;
drop policy if exists mpc_owner_read on public.market_promotion_credits;
create policy mpc_owner_read on public.market_promotion_credits
  for select using (
    public.admin_has_perm('promotions.view')
    or auth.uid() = (select owner_id from public.markets m where m.id = market_id));
revoke insert, update, delete on public.market_promotion_credits from anon, authenticated;
grant select on public.market_promotion_credits to authenticated;

create or replace function public.market_purchased_promo_balance(p_market uuid)
returns integer language sql stable security definer set search_path = public
as $$ select coalesce(sum(delta), 0)::int from public.market_promotion_credits where market_id = p_market; $$;

-- One call for the seller Promotions screen.
create or replace function public.market_promotion_status(p_market uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when auth.uid() <> (select owner_id from public.markets where id = p_market)
              and not public.admin_has_perm('promotions.view') then null else
  jsonb_build_object(
    'included_allowance', coalesce((select pl.included_boost_credits
        from public.market_effective_plan(p_market) ep
        join public.plan_limits pl on pl.plan = ep.plan), 0),
    'included_remaining', public.market_boost_credits_remaining(p_market),
    'included_used_this_month', coalesce((select count(*)::int from public.listing_promotions
        where market_id = p_market and source = 'plan_credit'
          and date_trunc('month', created_at) = date_trunc('month', now())), 0),
    'purchased_balance', public.market_purchased_promo_balance(p_market),
    'resets_on', (date_trunc('month', now()) + interval '1 month')::date,
    'price_cents', coalesce((select unit_amount_cents from public.billing_products
        where key = 'GNOME_LISTING_PROMOTION'), 399),
    'duration_days', 7,
    'active', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', lp.id, 'listing_id', lp.listing_id, 'ends_at', lp.ends_at, 'source', lp.source)), '[]'::jsonb)
      from public.listing_promotions lp
      where lp.market_id = p_market and lp.status = 'active' and lp.ends_at > now())
  ) end;
$$;
revoke execute on function public.market_promotion_status(uuid) from public, anon;
grant execute on function public.market_promotion_status(uuid) to authenticated;
revoke execute on function public.market_purchased_promo_balance(uuid) from public, anon;
grant execute on function public.market_purchased_promo_balance(uuid) to authenticated;

-- ======================================= 3. PROMOTION RULES (trigger v2)
-- Adds: 7-day defaults, no stacking on one listing, listing must be live,
-- purchased ('paid') promotions allowed ONLY through the definer RPC below
-- (clients still cannot insert source='paid' — RLS unchanged).
create or replace function public.enforce_promotion()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_existing timestamptz;
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.listings l
      where l.id = new.listing_id and l.market_id = new.market_id
    ) then
      raise exception 'listing does not belong to this market';
    end if;
    if new.status = 'active' then
      if not exists (select 1 from public.listings l where l.id = new.listing_id
                       and l.status = 'active' and l.expires_at > now()) then
        raise exception 'LISTING_NOT_PROMOTABLE: only live listings can be promoted' using errcode = 'P0001';
      end if;
      select max(ends_at) into v_existing from public.listing_promotions
       where listing_id = new.listing_id and status = 'active' and ends_at > now();
      if v_existing is not null then
        raise exception 'PROMO_ALREADY_ACTIVE:%', v_existing using errcode = 'P0001';
      end if;
      new.starts_at := coalesce(new.starts_at, now());
      new.ends_at := coalesce(new.ends_at, new.starts_at + interval '7 days');
      if new.ends_at > new.starts_at + interval '31 days' then
        raise exception 'PROMO_TOO_LONG' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if new.source = 'plan_credit' and new.status = 'active'
     and (tg_op = 'INSERT' or old.status <> 'active') then
    if public.market_boost_credits_remaining(new.market_id) <= 0 then
      raise exception 'NO_BOOST_CREDITS' using errcode = 'P0001';
    end if;
  end if;

  -- Sellers can never extend a promotion window after activation.
  if tg_op = 'UPDATE' and old.status = 'active' and new.ends_at is distinct from old.ends_at
     and not public.admin_has_perm('promotions.manage') and auth.uid() is not null then
    raise exception 'PROMO_WINDOW_LOCKED' using errcode = 'P0001';
  end if;

  return new;
end $$;

-- Redeem a PURCHASED credit (definer path; consumes ledger atomically).
create or replace function public.promote_listing_purchased(p_listing uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_market uuid; v_owner uuid; v_promo uuid;
begin
  select l.market_id, m.owner_id into v_market, v_owner
    from public.listings l join public.markets m on m.id = l.market_id
   where l.id = p_listing;
  if v_market is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_owner <> auth.uid() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  -- Lock the market's ledger rows to serialize concurrent redemptions.
  perform 1 from public.market_promotion_credits where market_id = v_market for update;
  if public.market_purchased_promo_balance(v_market) <= 0 then
    raise exception 'NO_PURCHASED_CREDITS' using errcode = 'P0001';
  end if;
  insert into public.listing_promotions (listing_id, market_id, source, status, created_by)
  values (p_listing, v_market, 'paid', 'active', auth.uid())
  returning id into v_promo;
  insert into public.market_promotion_credits (market_id, delta, reason, source, promotion_id, created_by)
  values (v_market, -1, 'Promotion activated', 'CONSUMED', v_promo, auth.uid());
  return v_promo;
end $$;
revoke execute on function public.promote_listing_purchased(uuid) from public, anon;
grant execute on function public.promote_listing_purchased(uuid) to authenticated;

-- Expire promotions lazily (called by reads/admin; also safe under pg_cron).
create or replace function public.expire_finished_promotions()
returns integer language sql security definer set search_path = public
as $$
  with upd as (
    update public.listing_promotions set status = 'expired'
    where status = 'active' and ends_at <= now()
    returning 1)
  select count(*)::int from upd;
$$;
revoke execute on function public.expire_finished_promotions() from public, anon;
grant execute on function public.expire_finished_promotions() to authenticated;

-- ==================================== 4. ADMIN PROMOTION MANAGEMENT + AUDIT
create or replace function public.admin_grant_promo_credits(
  p_market uuid, p_qty int, p_reason text
) returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.admin_has_perm('promotions.grant') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty > 100 then raise exception 'BAD_QTY' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  insert into public.market_promotion_credits (market_id, delta, reason, source, created_by)
  values (p_market, p_qty, p_reason, 'ADMIN_COMP', auth.uid());
  perform public.admin_audit('PROMO_CREDITS_GRANTED', 'market', p_market::text,
    null, jsonb_build_object('qty', p_qty), p_reason);
end $$;
revoke execute on function public.admin_grant_promo_credits(uuid,int,text) from public, anon;
grant execute on function public.admin_grant_promo_credits(uuid,int,text) to authenticated;

create or replace function public.admin_end_promotion(
  p_promo uuid, p_reason text, p_restore_credit boolean default false
) returns void language plpgsql security definer set search_path = public
as $$
declare pr public.listing_promotions;
begin
  if not public.admin_has_perm('promotions.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into pr from public.listing_promotions where id = p_promo for update;
  if pr is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  update public.listing_promotions set status = 'cancelled', ends_at = least(ends_at, now())
   where id = p_promo;
  if p_restore_credit then
    if not public.admin_has_perm('promotions.refund_credit') then
      raise exception 'NOT_AUTHORIZED: promotions.refund_credit' using errcode = 'P0001';
    end if;
    -- plan_credit restore: a compensating purchased credit (the month count is
    -- history and never rewritten); paid restore: ledger +1.
    insert into public.market_promotion_credits (market_id, delta, reason, source, promotion_id, created_by)
    values (pr.market_id, 1, coalesce(p_reason,'Admin restore'), 'REFUND', p_promo, auth.uid());
  end if;
  perform public.admin_audit('PROMOTION_ENDED', 'listing_promotion', p_promo::text,
    to_jsonb(pr), jsonb_build_object('restored_credit', p_restore_credit), p_reason);
end $$;
revoke execute on function public.admin_end_promotion(uuid,text,boolean) from public, anon;
grant execute on function public.admin_end_promotion(uuid,text,boolean) to authenticated;

-- Promotion performance (computed honestly from market_metrics + claims;
-- no fabricated impressions).
create or replace function public.market_promotion_performance(p_market uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when auth.uid() <> (select owner_id from public.markets where id = p_market)
              and not public.admin_has_perm('promotions.view') then null else
  coalesce((select jsonb_agg(jsonb_build_object(
    'promotion_id', lp.id, 'listing_id', lp.listing_id,
    'listing_title', (select title from public.listings where id = lp.listing_id),
    'source', lp.source, 'status', lp.status,
    'starts_at', lp.starts_at, 'ends_at', lp.ends_at,
    'market_listing_views_during', (
       select coalesce(sum(mm.listing_views), 0) from public.market_metrics mm
        where mm.market_id = lp.market_id
          and mm.date between lp.starts_at::date and least(lp.ends_at, now())::date),
    'claims_started_during', (
       select count(*) from public.claims c
        where c.listing_id = lp.listing_id
          and c.created_at between lp.starts_at and least(lp.ends_at, now())),
    'claims_completed_during', (
       select count(*) from public.claims c
        where c.listing_id = lp.listing_id and c.status = 'completed'
          and c.created_at between lp.starts_at and least(lp.ends_at, now()))
    ) order by lp.created_at desc)
    from public.listing_promotions lp where lp.market_id = p_market), '[]'::jsonb)
  end;
$$;
revoke execute on function public.market_promotion_performance(uuid) from public, anon;
grant execute on function public.market_promotion_performance(uuid) to authenticated;

-- ============================= 5. ENTITLEMENTS EXPOSE THE COMMERCIAL FIELDS
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
  ai_listing_assistant boolean,
  included_promotions_monthly int,
  promotions_remaining int,
  purchased_promotion_credits int,
  promotions_reset_on date
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
    pl.advanced_delivery,
    pl.ai_listing_assistant,
    pl.included_boost_credits,
    public.market_boost_credits_remaining(m.id),
    public.market_purchased_promo_balance(m.id),
    (date_trunc('month', now()) + interval '1 month')::date
  from public.markets m
  cross join lateral public.market_effective_plan(m.id) ep
  join public.plan_limits pl on pl.plan = ep.plan
  where m.owner_id = auth.uid()
  limit 1;
$$;
grant execute on function public.my_plan_entitlements() to authenticated;

-- =============================== 6. SEED DROP: SEASONAL SUBSCRIPTION MODEL
create table if not exists public.seed_season_windows (
  id uuid primary key default gen_random_uuid(),
  season_code text not null check (season_code in ('EARLY_SEASON','SPRING','SUMMER','FALL')),
  year int not null check (year between 2026 and 2100),
  zone_min int not null check (zone_min between 2 and 11),
  zone_max int not null check (zone_max between 2 and 11),
  window_start date not null,
  join_cutoff date not null,
  generation_date date not null,
  ship_start date not null,
  ship_end date not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  check (zone_max >= zone_min),
  check (join_cutoff >= window_start),
  check (generation_date >= join_cutoff),
  check (ship_end >= ship_start),
  unique (season_code, year, zone_min, zone_max)
);
alter table public.seed_season_windows enable row level security;
drop policy if exists ssw_read on public.seed_season_windows;
create policy ssw_read on public.seed_season_windows for select using (true);
revoke insert, update, delete on public.seed_season_windows from anon, authenticated;
grant select on public.seed_season_windows to authenticated, anon;

-- Baseline national windows (owner-tunable rows, not code):
insert into public.seed_season_windows
  (season_code, year, zone_min, zone_max, window_start, join_cutoff, generation_date, ship_start, ship_end, notes)
values
  ('FALL', 2026, 4, 9, '2026-08-20', '2026-09-18', '2026-09-22', '2026-09-24', '2026-10-06', 'fall greens/roots/garlic'),
  ('EARLY_SEASON', 2027, 4, 9, '2027-01-20', '2027-02-19', '2027-02-23', '2027-02-25', '2027-03-08', 'indoor starts + cold crops'),
  ('SPRING', 2027, 4, 9, '2027-03-20', '2027-04-23', '2027-04-27', '2027-04-29', '2027-05-11', 'main season'),
  ('SUMMER', 2027, 4, 9, '2027-06-01', '2027-07-02', '2027-07-07', '2027-07-09', '2027-07-20', 'succession + fall-start')
on conflict (season_code, year, zone_min, zone_max) do nothing;

alter table public.seed_drop_subscriptions
  add column if not exists billing_model text not null default 'PAY_PER_SEASON'
    check (billing_model in ('PAY_PER_SEASON','ANNUAL_PREPAID')),
  add column if not exists price_cents int not null default 2499;

alter table public.seed_orders
  add column if not exists season_window_id uuid references public.seed_season_windows(id),
  add column if not exists postage_cents int,
  add column if not exists packaging_cents int,
  add column if not exists insert_cents int,
  add column if not exists payment_fee_cents int,
  add column if not exists other_cost_cents int;
-- One Drop per subscriber per season window — double generation impossible.
create unique index if not exists seed_orders_window_user_uq
  on public.seed_orders (season_window_id, user_id)
  where season_window_id is not null and status not in ('cancelled','refunded');

create table if not exists public.seed_sub_season_skips (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.seed_drop_subscriptions(id) on delete cascade,
  window_id uuid not null references public.seed_season_windows(id),
  source text not null default 'user' check (source in ('user','admin')),
  created_at timestamptz not null default now(),
  unique (subscription_id, window_id)
);
alter table public.seed_sub_season_skips enable row level security;
drop policy if exists skips_own on public.seed_sub_season_skips;
create policy skips_own on public.seed_sub_season_skips
  for select using (
    public.admin_has_perm('seed_drop.view')
    or auth.uid() = (select user_id from public.seed_drop_subscriptions s where s.id = subscription_id));
revoke insert, update, delete on public.seed_sub_season_skips from anon, authenticated;
grant select on public.seed_sub_season_skips to authenticated;

-- Next eligible window for a subscription: zone match, joined before cutoff
-- (or window still upcoming), not skipped, not already generated.
create or replace function public.seed_sub_next_window(p_sub uuid)
returns table (window_id uuid, season_code text, year int, join_cutoff date,
               ship_start date, ship_end date, eligible_now boolean)
language sql stable security definer set search_path = public
as $$
  with s as (
    select sub.*, coalesce((sub.profile_snapshot->>'zone')::int,
                  (select zone from public.seed_profiles sp where sp.user_id = sub.user_id), 6) as zone
    from public.seed_drop_subscriptions sub where sub.id = p_sub
      and (auth.uid() = sub.user_id or public.admin_has_perm('seed_drop.view') or auth.uid() is null)
  )
  select w.id, w.season_code, w.year, w.join_cutoff, w.ship_start, w.ship_end,
         (current_date <= w.join_cutoff)
  from public.seed_season_windows w, s
  where w.active
    and s.zone between w.zone_min and w.zone_max
    and w.ship_end >= current_date
    and current_date <= w.join_cutoff            -- window still joinable
    and s.created_at::date <= w.join_cutoff      -- joined in time (QA fix)
    and not exists (select 1 from public.seed_sub_season_skips k
                     where k.subscription_id = s.id and k.window_id = w.id)
    and not exists (select 1 from public.seed_orders o
                     where o.season_window_id = w.id and o.user_id = s.user_id
                       and o.status not in ('cancelled','refunded'))
  order by w.generation_date
  limit 1;
$$;
revoke execute on function public.seed_sub_next_window(uuid) from public, anon;
grant execute on function public.seed_sub_next_window(uuid) to authenticated;

create or replace function public.skip_season_window(p_sub uuid, p_window uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare s public.seed_drop_subscriptions; w public.seed_season_windows;
begin
  select * into s from public.seed_drop_subscriptions where id = p_sub;
  if s is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if s.user_id <> auth.uid() and not public.admin_has_perm('seed_drop.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into w from public.seed_season_windows where id = p_window;
  if w is null then raise exception 'WINDOW_NOT_FOUND' using errcode = 'P0001'; end if;
  if current_date > w.generation_date then
    raise exception 'TOO_LATE_TO_SKIP: this Drop has already been generated' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.seed_orders o where o.season_window_id = p_window
              and o.user_id = s.user_id and o.status not in ('cancelled','refunded')) then
    raise exception 'ALREADY_GENERATED' using errcode = 'P0001';
  end if;
  insert into public.seed_sub_season_skips (subscription_id, window_id, source)
  values (p_sub, p_window, case when s.user_id = auth.uid() then 'user' else 'admin' end)
  on conflict do nothing;
end $$;
revoke execute on function public.skip_season_window(uuid,uuid) from public, anon;
grant execute on function public.skip_season_window(uuid,uuid) to authenticated;

-- ============================== 7. WAVES: PREVIEW / GENERATE / ECONOMICS
create or replace function public.admin_seed_wave_preview(p_window uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when not public.admin_has_perm('seed_drop.view') then null else
  jsonb_build_object(
    'window', (select to_jsonb(w) from public.seed_season_windows w where w.id = p_window),
    'eligible_subscribers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'subscription_id', s.id, 'user', (select name from public.profiles where id = s.user_id),
        'zone', coalesce((s.profile_snapshot->>'zone')::int, 6),
        'packet_count', s.packet_count, 'joined', s.created_at::date,
        'joined_before_cutoff', s.created_at::date <= w.join_cutoff)), '[]'::jsonb)
      from public.seed_drop_subscriptions s
      join public.seed_season_windows w on w.id = p_window
      where s.status = 'active'
        and coalesce((s.profile_snapshot->>'zone')::int,
             (select zone from public.seed_profiles sp where sp.user_id = s.user_id), 6)
            between w.zone_min and w.zone_max
        and s.created_at::date <= w.join_cutoff
        and not exists (select 1 from public.seed_sub_season_skips k
                         where k.subscription_id = s.id and k.window_id = w.id)
        and not exists (select 1 from public.seed_orders o
                         where o.season_window_id = w.id and o.user_id = s.user_id
                           and o.status not in ('cancelled','refunded'))),
    'demand_forecast', (
      -- packets needed = eligible subscribers × target packet count (range ±25%);
      -- availability from active/fresh lots. Honest range, not certainty.
      select jsonb_build_object(
        'eligible_count', count(*),
        'packets_expected_min', (sum(s.packet_count) * 0.75)::int,
        'packets_expected_max', (sum(s.packet_count) * 1.10)::int,
        'packets_available_total', (select coalesce(sum(l.current_qty),0)::int
           from public.seed_lots l where l.status in ('fresh','active'))
      )
      from public.seed_drop_subscriptions s
      join public.seed_season_windows w on w.id = p_window
      where s.status = 'active'
        and coalesce((s.profile_snapshot->>'zone')::int,
             (select zone from public.seed_profiles sp where sp.user_id = s.user_id), 6)
            between w.zone_min and w.zone_max
        and s.created_at::date <= w.join_cutoff
        and not exists (select 1 from public.seed_sub_season_skips k
                         where k.subscription_id = s.id and k.window_id = w.id))
  ) end;
$$;
revoke execute on function public.admin_seed_wave_preview(uuid) from public, anon;
grant execute on function public.admin_seed_wave_preview(uuid) to authenticated;

-- Generate the wave: one order per eligible subscriber, tagged to the window.
-- Unique index makes re-runs idempotent (skips already-generated subs).
-- BILLING SEQUENCE (documented, PAY_PER_SEASON): orders are generated as
-- 'pending_payment' with amount_cents = sub price. The seasonal charge step
-- (Stripe invoice/checkout per drop) is OWNER CONFIG REQUIRED — no fake
-- payment success. Admin releases to fulfillment only for paid orders (or
-- explicitly, audited, for comped drops).
create or replace function public.admin_seed_wave_generate(p_window uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare w public.seed_season_windows; s record; v_order uuid;
        v_created int := 0; v_skipped int := 0; v_errors jsonb := '[]'::jsonb;
begin
  if not public.admin_has_perm('seed_drop.generate') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into w from public.seed_season_windows where id = p_window for update;
  if w is null then raise exception 'WINDOW_NOT_FOUND' using errcode = 'P0001'; end if;
  for s in
    select sub.* from public.seed_drop_subscriptions sub
    where sub.status = 'active'
      and coalesce((sub.profile_snapshot->>'zone')::int,
           (select zone from public.seed_profiles sp where sp.user_id = sub.user_id), 6)
          between w.zone_min and w.zone_max
      and sub.created_at::date <= w.join_cutoff
      and not exists (select 1 from public.seed_sub_season_skips k
                       where k.subscription_id = sub.id and k.window_id = w.id)
      and not exists (select 1 from public.seed_orders o
                       where o.season_window_id = w.id and o.user_id = sub.user_id
                         and o.status not in ('cancelled','refunded'))
  loop
    begin
      v_order := public.generate_seed_subscription_order(s.id, false);
      update public.seed_orders
         set season_window_id = w.id, amount_cents = s.price_cents
       where id = v_order;
      v_created := v_created + 1;
    exception when others then
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_object('sub', s.id, 'err', sqlerrm);
    end;
  end loop;
  perform public.admin_audit('SEED_WAVE_GENERATED', 'seed_season_window', p_window::text,
    null, jsonb_build_object('created', v_created, 'skipped', v_skipped), null);
  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'errors', v_errors);
end $$;
revoke execute on function public.admin_seed_wave_generate(uuid) from public, anon;
grant execute on function public.admin_seed_wave_generate(uuid) to authenticated;

create or replace function public.admin_set_seed_order_costs(
  p_order uuid, p_postage int default null, p_packaging int default null,
  p_insert int default null, p_payment_fee int default null, p_other int default null
) returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.admin_has_perm('seed_drop.ship') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  update public.seed_orders set
    postage_cents = coalesce(p_postage, postage_cents),
    packaging_cents = coalesce(p_packaging, packaging_cents),
    insert_cents = coalesce(p_insert, insert_cents),
    payment_fee_cents = coalesce(p_payment_fee, payment_fee_cents),
    other_cost_cents = coalesce(p_other, other_cost_cents),
    updated_at = now()
  where id = p_order;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
end $$;
revoke execute on function public.admin_set_seed_order_costs(uuid,int,int,int,int,int) from public, anon;
grant execute on function public.admin_set_seed_order_costs(uuid,int,int,int,int,int) to authenticated;

-- Economics: revenue, packet COGS (from each item's lot unit cost), fulfillment
-- costs, gross profit/margin. NULL-honest: missing costs stay missing.
create or replace function public.admin_seed_economics(p_window uuid default null)
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when not public.admin_has_perm('finance.view_summary')
                and not public.admin_has_perm('seed_drop.view') then null else
  (with orders as (
    select o.*,
      (select coalesce(sum((l.cost_cents::numeric / nullif(l.original_qty,0)) * i.qty_packets), 0)::int
         from public.seed_order_items i join public.seed_lots l on l.id = i.lot_id
        where i.order_id = o.id and i.status <> 'released') as packet_cogs_cents
    from public.seed_orders o
    where (p_window is null or o.season_window_id = p_window)
      and o.status in ('paid','selected','needs_review','packed','shipped'))
  select jsonb_build_object(
    'orders', count(*),
    'shipped', count(*) filter (where status = 'shipped'),
    'revenue_cents', coalesce(sum(amount_cents), 0),
    'packet_cogs_cents', coalesce(sum(packet_cogs_cents), 0),
    'postage_cents', sum(postage_cents),
    'packaging_cents', sum(packaging_cents),
    'insert_cents', sum(insert_cents),
    'payment_fee_cents', sum(payment_fee_cents),
    'other_cost_cents', sum(other_cost_cents),
    'gross_profit_cents', coalesce(sum(amount_cents), 0) - coalesce(sum(packet_cogs_cents), 0)
      - coalesce(sum(postage_cents), 0) - coalesce(sum(packaging_cents), 0)
      - coalesce(sum(insert_cents), 0) - coalesce(sum(payment_fee_cents), 0)
      - coalesce(sum(other_cost_cents), 0),
    'costs_recorded_orders', count(*) filter (where postage_cents is not null)
  ) from orders) end;
$$;
revoke execute on function public.admin_seed_economics(uuid) from public, anon;
grant execute on function public.admin_seed_economics(uuid) to authenticated;

-- ==================================== 8. COMMERCIAL OVERVIEW FOR ADMIN
create or replace function public.admin_commercial_overview()
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when not public.admin_has_perm('subscriptions.view') then null else
  jsonb_build_object(
    'plan_mix', (select jsonb_object_agg(plan, n) from (
       select ep.plan::text as plan, count(*) n from public.markets m
       cross join lateral public.market_effective_plan(m.id) ep group by 1) t),
    'source_mix', (select jsonb_object_agg(source, n) from (
       select ep.source, count(*) n from public.markets m
       cross join lateral public.market_effective_plan(m.id) ep group by 1) t),
    'mrr_cents', (select coalesce(sum(pl.price_cents), 0) from public.market_subscriptions s
       join public.plan_limits pl on pl.plan = s.plan
       where s.kind = 'plan' and s.status in ('active','trialing')),
    'active_comp_grants', (select count(*) from public.admin_plan_grants
       where status = 'ACTIVE' and (expires_at is null or expires_at > now())),
    'pickup_addons', (select coalesce(sum(extra_pickup_locations), 0) from public.markets),
    'seed_subscribers_active', (select count(*) from public.seed_drop_subscriptions where status = 'active'),
    'seed_revenue_cents_90d', (select coalesce(sum(amount_cents), 0) from public.seed_orders
       where status in ('paid','selected','packed','shipped') and created_at > now() - interval '90 days'),
    'promotions_active', (select count(*) from public.listing_promotions where status = 'active' and ends_at > now()),
    'promotions_30d', (select count(*) from public.listing_promotions where created_at > now() - interval '30 days'),
    'promo_purchases_cents_30d', (select coalesce(sum(bp.unit_amount_cents * c.delta), 0)
       from public.market_promotion_credits c
       cross join lateral (select unit_amount_cents from public.billing_products where key='GNOME_LISTING_PROMOTION') bp
       where c.source in ('PURCHASED_SINGLE','PURCHASED_PACK_3','PURCHASED_PACK_10')
         and c.created_at > now() - interval '30 days'),
    'growers_near_cap', (select count(*) from public.markets m
       cross join lateral public.market_effective_plan(m.id) ep
       where ep.plan = 'grower' and public.market_active_listing_count(m.id) >= 20)
  ) end;
$$;
revoke execute on function public.admin_commercial_overview() from public, anon;
grant execute on function public.admin_commercial_overview() to authenticated;

-- ============================= 9. PRODUCT KEYS (prices = owner Stripe config)
insert into public.billing_products (key, kind, description, unit_amount_cents, currency, active) values
  ('GNOME_LISTING_PROMOTION', 'one_time', 'Featured listing promotion, 7 days', 399, 'usd', true),
  ('GNOME_PROMOTION_PACK_3', 'one_time', 'Promotion pack: 3 credits', 999, 'usd', false),
  ('GNOME_PROMOTION_PACK_10', 'one_time', 'Promotion pack: 10 credits', 2999, 'usd', false),
  ('GNOME_SEED_DROP_SEASONAL', 'subscription', 'Seasonal Seed Drop, per-season charge', 2499, 'usd', true),
  ('GNOME_GROWER_SEED_BUNDLE', 'subscription', 'Grower + Seed Drop bundle, annual (working target)', 19900, 'usd', false),
  ('GNOME_FARM_SEED_BUNDLE', 'subscription', 'Farm + Seed Drop bundle, annual (working target)', 42900, 'usd', false)
on conflict (key) do update set unit_amount_cents = excluded.unit_amount_cents,
  description = excluded.description;

-- ======================================== 10. ROLE PRESETS: promotions.*
create or replace function public.admin_role_permissions(p_role text)
returns text[] language sql immutable as $$
  select case p_role
    when 'OWNER'        then array['*']
    when 'SUPER_ADMIN'  then array['*']
    when 'OPERATIONS_ADMIN' then array[
      'users.view','markets.view','markets.edit','markets.pause','markets.restore','markets.feature',
      'listings.view','listings.moderate','listings.pause','listings.restore',
      'orders.view','orders.manage','orders.cancel','orders.complete',
      'pickups.view','pickups.manage','delivery.view','delivery.manage',
      'inventory.view','seed_drop.view','plots.view','support.view','taxonomy.view',
      'subscriptions.view','system.view','ai.view','ai.chat',
      'promotions.view','promotions.manage']
    when 'COMPLIANCE_ADMIN' then array[
      'users.view','markets.view','listings.view','listings.moderate','listings.pause','listings.restore',
      'compliance.view','compliance.view_documents','compliance.review','compliance.approve',
      'compliance.deny','compliance.revoke','compliance.rules_manage','taxonomy.view','system.view','ai.view']
    when 'INVENTORY_FULFILLMENT' then array[
      'inventory.view','inventory.create','inventory.edit','inventory.receive','inventory.adjust',
      'inventory.move','inventory.quarantine','inventory.archive','inventory.reconcile',
      'seed_drop.view','seed_drop.generate','seed_drop.pick','seed_drop.pack','seed_drop.ship',
      'seed_drop.fulfill','system.view','ai.view','ai.chat']
    when 'SUPPORT_MODERATOR' then array[
      'users.view','markets.view','listings.view','listings.moderate',
      'support.view','support.respond','support.resolve','orders.view','system.view',
      'promotions.view']
    when 'ACCOUNTING_FINANCE' then array[
      'finance.view_summary','finance.view_transactions','finance.export',
      'subscriptions.view','system.view','promotions.view']
    when 'MARKETING_GROWTH' then array[
      'marketing.view','marketing.draft','users.view','markets.view','listings.view','system.view',
      'promotions.view']
    when 'READ_ONLY' then array[
      'users.view','markets.view','listings.view','orders.view','pickups.view','delivery.view',
      'compliance.view','inventory.view','seed_drop.view','plots.view','support.view',
      'taxonomy.view','subscriptions.view','finance.view_summary','system.view','ai.view',
      'promotions.view']
    else array[]::text[]
  end;
$$;

notify pgrst, 'reload schema';
