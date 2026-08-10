-- 0052: multiple pickup locations, gated by plan.
--
-- Basic selling stays free: every Market keeps exactly one pickup location at
-- no cost, and the existing single-location setup is migrated into it so no
-- seller notices a change. Paid plans unlock additional locations (a farm
-- stand, a market booth, a workplace meetup) — scale, not basic access.
--
-- Privacy is unchanged and now per-location: exact street addresses live in a
-- column that is NOT granted to anon/authenticated, coarse approx_* generated
-- columns (same ~0.7mi rounding as listings) are what the world can read, and
-- the exact address is released per-order only after confirmation.
--
-- Downgrade behaviour (documented, non-destructive): nothing is ever deleted.
-- The default location plus the oldest allowed-by-plan locations stay active;
-- the rest get plan_restricted = true, which excludes them from slot
-- generation and new orders while preserving their address, instructions,
-- hours, exceptions and order history. Upgrading clears the flag.

-- ---------------------------------------------------------------------------
-- Plan allowance lives in the existing plan source of truth.
alter table public.plan_limits
  add column if not exists max_pickup_locations int not null default 1;
update public.plan_limits set max_pickup_locations = 1  where plan = 'free';
update public.plan_limits set max_pickup_locations = 3  where plan = 'grower';
update public.plan_limits set max_pickup_locations = 10 where plan in ('farm', 'sponsor');

-- ---------------------------------------------------------------------------
create table if not exists public.market_pickup_locations (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  nickname text not null,
  location_type text not null default 'PRIVATE_RESIDENCE'
    check (location_type in ('PRIVATE_RESIDENCE','PUBLIC_FARM_STAND','PUBLIC_BUSINESS',
                             'PUBLIC_MEETUP_POINT','CUSTOM_PICKUP_POINT')),
  -- Exact address: never granted to anon/authenticated (see grants below).
  address_line text,
  city text,
  state text,
  postal_code text,
  lat double precision,
  lng double precision,
  -- Public-safe coarse point, same rounding as listings.approx_*.
  approx_lat double precision generated always as (round(lat::numeric, 2)::double precision) stored,
  approx_lng double precision generated always as (round(lng::numeric, 2)::double precision) stored,
  instructions text,
  -- Seller opt-in: only meaningful for the PUBLIC_* types. Enforced in the
  -- release RPC, not just the UI.
  public_address_visible boolean not null default false,
  timezone text not null default 'America/New_York',
  slot_minutes int not null default 30 check (slot_minutes in (15, 30, 60)),
  lead_time_minutes int not null default 120 check (lead_time_minutes between 0 and 10080),
  max_orders_per_slot int check (max_orders_per_slot is null or max_orders_per_slot > 0),
  active boolean not null default true,
  is_default boolean not null default false,
  -- Set when a downgrade pushes this location past the plan allowance. The row
  -- and all its history stay intact; it just stops accepting new business.
  plan_restricted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mpl_market_idx on public.market_pickup_locations(market_id);
-- At most one default per Market.
create unique index if not exists mpl_one_default
  on public.market_pickup_locations(market_id) where is_default;

alter table public.market_pickup_locations enable row level security;

-- The world may read the SHAPE of a pickup location (nickname, type, coarse
-- point, hours) so buyers can choose one; the exact address column is withheld
-- at the GRANT level below, so it cannot leak through any policy.
create policy mpl_select_all on public.market_pickup_locations
  for select to anon, authenticated using (true);
create policy mpl_owner_write on public.market_pickup_locations
  for all to authenticated
  using (exists (select 1 from public.markets m where m.id = market_id and m.owner_id = auth.uid()))
  with check (exists (select 1 from public.markets m where m.id = market_id and m.owner_id = auth.uid()));

-- COLUMN-level grants: address_line/lat/lng are deliberately absent.
grant select (id, market_id, nickname, location_type, city, state, postal_code,
              approx_lat, approx_lng, public_address_visible, timezone,
              slot_minutes, lead_time_minutes, max_orders_per_slot,
              active, is_default, plan_restricted, created_at, updated_at)
  on public.market_pickup_locations to anon, authenticated;
grant insert, update, delete on public.market_pickup_locations to authenticated;

-- ---------------------------------------------------------------------------
-- Schedules become location-scoped. Existing rows keep working: they are
-- backfilled onto the Market's migrated default location.
alter table public.market_pickup_hours
  add column if not exists location_id uuid references public.market_pickup_locations(id) on delete cascade;
alter table public.market_pickup_exceptions
  add column if not exists location_id uuid references public.market_pickup_locations(id) on delete cascade;
create index if not exists mph_loc_idx on public.market_pickup_hours(location_id);
create index if not exists mpe_loc_idx on public.market_pickup_exceptions(location_id, date);

-- ---------------------------------------------------------------------------
-- Which locations can fulfil a listing. No rows = "use the Market default",
-- so existing listings need no backfill and Create Listing stays simple.
create table if not exists public.listing_pickup_locations (
  listing_id uuid not null references public.listings(id) on delete cascade,
  location_id uuid not null references public.market_pickup_locations(id) on delete cascade,
  primary key (listing_id, location_id)
);
create index if not exists lpl_loc_idx on public.listing_pickup_locations(location_id);
alter table public.listing_pickup_locations enable row level security;
create policy lpl_select_all on public.listing_pickup_locations
  for select to anon, authenticated using (true);
create policy lpl_owner_write on public.listing_pickup_locations
  for all to authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()));
grant select on public.listing_pickup_locations to anon, authenticated;
grant insert, delete on public.listing_pickup_locations to authenticated;

-- ---------------------------------------------------------------------------
-- Orders remember WHERE, and snapshot the public-safe display bits so history
-- still reads correctly after a rename/deactivation.
alter table public.market_orders
  add column if not exists pickup_location_id uuid references public.market_pickup_locations(id) on delete set null,
  add column if not exists pickup_location_name text,
  add column if not exists pickup_location_type text;

-- ---------------------------------------------------------------------------
-- MIGRATE existing single-location setups into a default location.
insert into public.market_pickup_locations
  (market_id, nickname, location_type, address_line, instructions,
   public_address_visible, timezone, slot_minutes, lead_time_minutes,
   max_orders_per_slot, active, is_default)
select s.market_id,
       'Pickup',
       case s.location_type
         when 'PUBLIC_BUSINESS' then 'PUBLIC_BUSINESS'
         when 'CUSTOM_PICKUP_POINT' then 'CUSTOM_PICKUP_POINT'
         else 'PRIVATE_RESIDENCE' end,
       coalesce(p.pickup_address, s.public_address),
       p.pickup_instructions,
       (s.location_type <> 'PRIVATE_RESIDENCE' and s.public_address is not null),
       s.timezone, s.slot_minutes, s.lead_time_minutes, s.max_orders_per_slot,
       true, true
  from public.market_pickup_settings s
  left join public.market_pickup_private p on p.market_id = s.market_id
 where not exists (select 1 from public.market_pickup_locations l where l.market_id = s.market_id);

-- Attach existing hours/exceptions to that default location.
update public.market_pickup_hours h
   set location_id = l.id
  from public.market_pickup_locations l
 where l.market_id = h.market_id and l.is_default and h.location_id is null;
update public.market_pickup_exceptions e
   set location_id = l.id
  from public.market_pickup_locations l
 where l.market_id = e.market_id and l.is_default and e.location_id is null;

-- Existing orders point at the default location, with their snapshot.
update public.market_orders o
   set pickup_location_id = l.id,
       pickup_location_name = l.nickname,
       pickup_location_type = l.location_type
  from public.market_pickup_locations l
 where l.market_id = o.market_id and l.is_default and o.pickup_location_id is null;

-- ---------------------------------------------------------------------------
-- Plan enforcement. Runs on the server for every write, whatever the client.
create or replace function public.market_pickup_location_allowance(p_market uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(pl.max_pickup_locations, 1)
    from public.markets m
    left join public.plan_limits pl on pl.plan = m.plan
   where m.id = p_market;
$$;
grant execute on function public.market_pickup_location_allowance(uuid) to anon, authenticated;

create or replace function public.enforce_pickup_location_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  allowance int;
  live int;
begin
  -- Only newly-active, unrestricted rows consume allowance.
  if not new.active or new.plan_restricted then return new; end if;
  if tg_op = 'UPDATE' and old.active and not old.plan_restricted then return new; end if;

  allowance := public.market_pickup_location_allowance(new.market_id);
  select count(*) into live
    from public.market_pickup_locations
   where market_id = new.market_id and active and not plan_restricted
     and id <> new.id;

  if live >= allowance then
    raise exception 'PICKUP_LOCATION_LIMIT:%:%', allowance,
      'Your plan includes ' || allowance || ' active pickup location' ||
      case when allowance = 1 then '' else 's' end || '.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists mpl_limit_trg on public.market_pickup_locations;
create trigger mpl_limit_trg
  before insert or update on public.market_pickup_locations
  for each row execute function public.enforce_pickup_location_limit();

-- Exactly one default while pickup is enabled: first location wins, and
-- setting a new default clears the old one.
create or replace function public.market_pickup_locations_default_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and not exists (
      select 1 from public.market_pickup_locations
       where market_id = new.market_id and is_default and id <> new.id) then
    new.is_default := true;   -- first location is automatically the default
  end if;
  if new.is_default then
    new.active := true;
    new.plan_restricted := false;
    update public.market_pickup_locations
       set is_default = false, updated_at = now()
     where market_id = new.market_id and id <> new.id and is_default;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists mpl_default_trg on public.market_pickup_locations;
create trigger mpl_default_trg
  before insert or update on public.market_pickup_locations
  for each row execute function public.market_pickup_locations_default_guard();

-- Downgrade sweep: keep the default + oldest allowed locations active,
-- restrict (never delete) the rest. Upgrading and re-running clears flags.
create or replace function public.reconcile_pickup_locations(p_market uuid)
returns table(kept int, restricted int)
language plpgsql security definer set search_path = public as $$
declare
  allowance int := public.market_pickup_location_allowance(p_market);
  v_kept int; v_restricted int;
begin
  if p_market is null then return; end if;
  if not (exists (select 1 from public.markets m
                   where m.id = p_market and m.owner_id = auth.uid())
          or public.is_admin() or auth.uid() is null) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  with ranked as (
    select id, row_number() over (
             order by is_default desc, created_at asc) as rn
      from public.market_pickup_locations
     where market_id = p_market and active
  ), upd as (
    update public.market_pickup_locations l
       set plan_restricted = (r.rn > allowance), updated_at = now()
      from ranked r
     where l.id = r.id
       and l.plan_restricted <> (r.rn > allowance)
    returning l.plan_restricted
  )
  select count(*) filter (where not plan_restricted),
         count(*) filter (where plan_restricted)
    into v_kept, v_restricted from upd;

  return query select coalesce(v_kept, 0), coalesce(v_restricted, 0);
end $$;
grant execute on function public.reconcile_pickup_locations(uuid) to authenticated;

-- A plan change re-runs the sweep automatically (restrict on downgrade,
-- release on upgrade), so the state can never drift from the subscription.
create or replace function public.markets_plan_change_reconcile()
returns trigger language plpgsql security definer set search_path = public as $$
declare allowance int; begin
  if new.plan is distinct from old.plan then
    allowance := coalesce((select max_pickup_locations from public.plan_limits where plan = new.plan), 1);
    with ranked as (
      select id, row_number() over (order by is_default desc, created_at asc) as rn
        from public.market_pickup_locations where market_id = new.id and active
    )
    update public.market_pickup_locations l
       set plan_restricted = (r.rn > allowance), updated_at = now()
      from ranked r where l.id = r.id;
  end if;
  return new;
end $$;
drop trigger if exists markets_plan_reconcile_trg on public.markets;
create trigger markets_plan_reconcile_trg
  after update on public.markets
  for each row execute function public.markets_plan_change_reconcile();
