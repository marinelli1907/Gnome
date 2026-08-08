-- Gnome — Seed Drop V1: inventory-aware, season-aware, location-aware.
-- Run after 0027.
--
-- ARCHITECTURE PRINCIPLE (from the product spec): the BACKEND is the source
-- of truth for inventory, eligibility, and reservations. The deterministic
-- engine below (generate_seed_drop) builds the box inside one transaction
-- with row locks — the AI layer only explains/coaches afterward and can
-- never invent stock, pick a quarantined lot, or override an exclusion.
--
-- V1 scope: one Starter product (6 packets), prepacked-packet lots fully
-- supported (bulk-seed fields exist but the engine only draws packet-unit
-- lots for now), Build-My-Box mode, admin inventory + fulfillment via the
-- existing is_admin() layer, order-to-seed tracking for the AI.

-- ---------------------------------------------------------------------------
-- Catalog: seed products (public, safe fields only — no costs/suppliers here)
-- ---------------------------------------------------------------------------
create table if not exists public.seed_products (
  id                  uuid primary key default gen_random_uuid(),
  crop                text not null,             -- 'Radish'
  variety             text not null,             -- 'French Breakfast'
  botanical_name      text,
  description         text,
  category            text not null check (category in
    ('vegetable','herb','flower','pollinator','salad','fruit')),
  days_to_germination int,
  days_to_maturity    int,
  preferred_sun       text not null default 'full'
    check (preferred_sun in ('full','partial','shade','any')),
  direct_sow_allowed  boolean not null default true,
  transplant_recommended boolean not null default false,
  spacing_inches      numeric,
  planting_depth_inches numeric,
  -- Sow window as months for a ZONE 6 baseline garden; the engine shifts
  -- roughly by hardiness zone. A coarse, honest approximation the AI refines.
  sow_months          int[] not null default '{}',
  beginner_friendly   boolean not null default true,
  container_friendly  boolean not null default false,
  packet_seed_count   int not null default 25,   -- per-crop pack quantity rule
  tags                text[] not null default '{}',
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists seed_products_crop_variety_idx
  on public.seed_products (crop, variety);

-- ---------------------------------------------------------------------------
-- Physical lots (ADMIN-ONLY: supplier + cost data lives here)
-- ---------------------------------------------------------------------------
create table if not exists public.seed_lots (
  id                    uuid primary key default gen_random_uuid(),
  seed_product_id       uuid not null references public.seed_products (id),
  supplier              text,
  supplier_lot_number   text,
  internal_lot_number   text not null,
  purchase_date         date,
  received_date         date not null default current_date,
  original_qty          numeric not null check (original_qty >= 0),
  current_qty           numeric not null check (current_qty >= 0),
  unit                  text not null default 'packets'
    check (unit in ('packets','grams','seeds')),
  seeds_per_unit        numeric,                 -- bulk support (grams → seeds)
  cost_cents            integer,
  germination_pct       numeric check (germination_pct between 0 and 100),
  germination_test_date date,
  next_review_date      date,
  storage_location      text,
  condition_notes       text,
  status                text not null default 'active' check (status in
    ('fresh','active','aging','needs_test','quarantined','failed','depleted','discarded')),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists seed_lots_product_idx on public.seed_lots (seed_product_id);
create unique index if not exists seed_lots_internal_idx on public.seed_lots (internal_lot_number);

create table if not exists public.germination_tests (
  id            uuid primary key default gen_random_uuid(),
  lot_id        uuid not null references public.seed_lots (id) on delete cascade,
  test_date     date not null default current_date,
  seeds_tested  int not null check (seeds_tested > 0),
  germinated    int not null check (germinated >= 0),
  pct           numeric generated always as (round(germinated::numeric / seeds_tested * 100, 1)) stored,
  tester        text,
  notes         text,
  next_review_date date,
  created_at    timestamptz not null default now()
);

-- Immutable-ish audit of every quantity change.
create table if not exists public.seed_inventory_log (
  id         uuid primary key default gen_random_uuid(),
  lot_id     uuid not null references public.seed_lots (id),
  delta      numeric not null,
  reason     text not null,   -- received | reserved | released | packed | adjusted | wasted
  order_id   uuid,
  actor      uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Customer profile (one per user; the order freezes a snapshot)
-- ---------------------------------------------------------------------------
create table if not exists public.seed_profiles (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  zip         text,
  zone        int check (zone between 2 and 11),  -- USDA-ish; 6 = unsure default
  garden_size text check (garden_size in
    ('windowsill','containers','small_bed','medium','large','unsure')),
  sun         text check (sun in ('full','partial','shade','unsure')),
  experience  text check (experience in ('first_time','beginner','some','experienced')),
  preferences text[] not null default '{}',   -- e.g. {'vegetables','salsa garden'}
  exclusions  text[] not null default '{}',   -- crop or category names, lowercased
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Orders + items (order-to-seed relationship the AI relies on)
-- ---------------------------------------------------------------------------
create table if not exists public.seed_orders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id),
  product           text not null default 'starter',
  packet_count      int not null default 6,
  status            text not null default 'paid' check (status in
    ('pending_payment','paid','selected','needs_review','packed','shipped','cancelled','refunded')),
  profile_snapshot  jsonb not null default '{}',
  stripe_session_id text unique,               -- idempotency for webhook retries
  amount_cents      int,
  tracking          text,
  planting_confirmed_at timestamptz,           -- user-confirmed planting date
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists seed_orders_user_idx on public.seed_orders (user_id, created_at desc);

create table if not exists public.seed_order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.seed_orders (id) on delete cascade,
  seed_product_id  uuid not null references public.seed_products (id),
  lot_id           uuid not null references public.seed_lots (id),
  qty_packets      int not null default 1,
  status           text not null default 'reserved' check (status in
    ('reserved','packed','shipped','released','substituted')),
  substituted_from uuid references public.seed_products (id),
  substitution_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists seed_order_items_order_idx on public.seed_order_items (order_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.seed_products      enable row level security;
alter table public.seed_lots          enable row level security;
alter table public.germination_tests  enable row level security;
alter table public.seed_inventory_log enable row level security;
alter table public.seed_profiles      enable row level security;
alter table public.seed_orders        enable row level security;
alter table public.seed_order_items   enable row level security;

-- Catalog: anyone may read active products (safe fields only by design).
drop policy if exists seed_products_public_read on public.seed_products;
create policy seed_products_public_read on public.seed_products
  for select using (active or public.is_admin());
drop policy if exists seed_products_admin_write on public.seed_products;
create policy seed_products_admin_write on public.seed_products
  for all using (public.is_admin()) with check (public.is_admin());

-- Lots / tests / log: admins only (suppliers + costs stay private).
drop policy if exists seed_lots_admin on public.seed_lots;
create policy seed_lots_admin on public.seed_lots
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists germination_tests_admin on public.germination_tests;
create policy germination_tests_admin on public.germination_tests
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists seed_inventory_log_admin on public.seed_inventory_log;
create policy seed_inventory_log_admin on public.seed_inventory_log
  for select using (public.is_admin());

-- Profiles: own row only.
drop policy if exists seed_profiles_own on public.seed_profiles;
create policy seed_profiles_own on public.seed_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Orders: customers read their own; admins read/update all. Customers cannot
-- insert or mutate orders/items — only the webhook (service role) and admins.
drop policy if exists seed_orders_own_read on public.seed_orders;
create policy seed_orders_own_read on public.seed_orders
  for select using (auth.uid() = user_id or public.is_admin());
drop policy if exists seed_orders_admin_update on public.seed_orders;
create policy seed_orders_admin_update on public.seed_orders
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists seed_order_items_own_read on public.seed_order_items;
create policy seed_order_items_own_read on public.seed_order_items
  for select using (
    public.is_admin()
    or auth.uid() = (select o.user_id from public.seed_orders o where o.id = order_id)
  );
drop policy if exists seed_order_items_admin_update on public.seed_order_items;
create policy seed_order_items_admin_update on public.seed_order_items
  for update using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Lot eligibility (quality gate) — one place, used everywhere.
-- ---------------------------------------------------------------------------
create or replace function public.seed_lot_eligible(l public.seed_lots)
returns boolean
language sql stable
as $$
  select l.status in ('fresh','active','aging')
     and l.current_qty >= 1
     and l.unit = 'packets'                       -- V1: prepacked only
     and coalesce(l.germination_pct, 100) >= 70   -- untested new stock passes; failed doesn't
     and (l.next_review_date is null or l.next_review_date >= current_date);
$$;

-- ---------------------------------------------------------------------------
-- THE ENGINE. Deterministic, transactional, race-safe.
-- Called with service role by the Stripe webhook (and by admins to re-run).
-- ---------------------------------------------------------------------------
create or replace function public.generate_seed_drop(p_order uuid)
returns int  -- number of packets reserved
language plpgsql
security definer set search_path = public
as $$
declare
  o        record;
  prof     jsonb;
  zone     int;
  month0   int;
  shift    int;
  sun      text;
  size     text;
  exper    text;
  prefs    text[];
  excl     text[];
  pick     record;
  reserved int := 0;
  small    boolean;
begin
  select * into o from seed_orders where id = p_order for update;
  if not found then raise exception 'order % not found', p_order; end if;
  if o.status not in ('paid','needs_review') then
    raise exception 'order % is %, not selectable', p_order, o.status;
  end if;

  -- Idempotency: re-running releases prior reservations first.
  perform public.release_seed_drop_items(p_order, 'reselect');

  prof  := o.profile_snapshot;
  zone  := coalesce((prof->>'zone')::int, 6);
  sun   := coalesce(prof->>'sun', 'unsure');
  size  := coalesce(prof->>'garden_size', 'unsure');
  exper := coalesce(prof->>'experience', 'beginner');
  prefs := coalesce((select array_agg(lower(x)) from jsonb_array_elements_text(prof->'preferences') x), '{}');
  excl  := coalesce((select array_agg(lower(x)) from jsonb_array_elements_text(prof->'exclusions') x), '{}');
  small := size in ('windowsill','containers');

  -- Zone-shifted sowing month (coarse: warmer zones run ~a month ahead,
  -- colder a month behind; the AI refines timing after delivery).
  shift  := case when zone >= 8 then 1 when zone <= 4 then -1 else 0 end;
  month0 := ((extract(month from now())::int - 1 - shift) % 12 + 12) % 12 + 1;

  -- Candidate pool: strictly suitable + in-stock, diversity-capped, scored.
  for pick in
    with candidates as (
      select
        p.id as product_id,
        p.crop, p.category,
        l.id as lot_id,
        l.received_date,
        coalesce(l.germination_pct, 85) as germ,
        row_number() over (partition by p.id order by l.received_date asc) as lot_rank, -- FIFO
        (lower(p.crop) = any(prefs) or lower(p.category) = any(prefs)
          or exists (select 1 from unnest(p.tags) t where lower(t) = any(prefs))) as preferred
      from seed_products p
      join seed_lots l on l.seed_product_id = p.id
      where p.active
        and public.seed_lot_eligible(l)
        and p.sow_months @> array[month0]
        and not (lower(p.crop) = any(excl))
        and not (lower(p.category) = any(excl))
        and (sun = 'unsure' or p.preferred_sun = 'any'
             or p.preferred_sun = sun
             or (sun = 'full' and p.preferred_sun = 'partial'))
        and (not small or p.container_friendly)
        and (exper not in ('first_time') or p.beginner_friendly)
    ),
    best_lot as (
      select * from candidates where lot_rank = 1   -- oldest healthy lot per product
    ),
    scored as (
      select *,
        (case when preferred then 3.0 else 0 end)
        + (germ / 100.0)
        + least(2.0, extract(day from now() - received_date::timestamptz) / 180.0) -- gentle FIFO pressure
        as score,
        row_number() over (partition by crop order by
          (case when preferred then 3.0 else 0 end) + (germ / 100.0) desc) as crop_rank
      from best_lot
    )
    select * from scored
    where crop_rank = 1            -- one variety per crop → diversity
    order by score desc, crop
    limit o.packet_count
  loop
    -- Race-safe reservation: the guarded UPDATE is the lock.
    update seed_lots
       set current_qty = current_qty - 1, updated_at = now(),
           status = case when current_qty - 1 <= 0 then 'depleted' else status end
     where id = pick.lot_id and current_qty >= 1;
    if found then
      insert into seed_order_items (order_id, seed_product_id, lot_id)
      values (p_order, pick.product_id, pick.lot_id);
      insert into seed_inventory_log (lot_id, delta, reason, order_id)
      values (pick.lot_id, -1, 'reserved', p_order);
      reserved := reserved + 1;
    end if;
  end loop;

  update seed_orders
     set status = case when reserved >= packet_count then 'selected' else 'needs_review' end,
         updated_at = now()
   where id = p_order;

  return reserved;
end;
$$;

-- Release reservations (cancellation, failed payment cleanup, re-selection).
create or replace function public.release_seed_drop_items(p_order uuid, p_reason text default 'released')
returns void
language plpgsql
security definer set search_path = public
as $$
declare it record;
begin
  for it in
    select * from seed_order_items
    where order_id = p_order and status = 'reserved'
    for update
  loop
    update seed_lots
       set current_qty = current_qty + it.qty_packets,
           status = case when status = 'depleted' then 'active' else status end,
           updated_at = now()
     where id = it.lot_id;
    insert into seed_inventory_log (lot_id, delta, reason, order_id)
    values (it.lot_id, it.qty_packets, p_reason, p_order);
    update seed_order_items set status = 'released', updated_at = now() where id = it.id;
  end loop;
end;
$$;

-- Locked down: only service role / admins may run the engine.
revoke execute on function public.generate_seed_drop(uuid) from public, anon, authenticated;
revoke execute on function public.release_seed_drop_items(uuid, text) from public, anon, authenticated;
grant execute on function public.generate_seed_drop(uuid) to service_role;
grant execute on function public.release_seed_drop_items(uuid, text) to service_role;

-- Admins run them through thin RPCs that re-check is_admin().
create or replace function public.admin_generate_seed_drop(p_order uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return public.generate_seed_drop(p_order);
end $$;
create or replace function public.admin_release_seed_drop(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  perform public.release_seed_drop_items(p_order, 'released');
end $$;

-- ---------------------------------------------------------------------------
-- Analytics allowlist: + seed events (names only, never chat content)
-- ---------------------------------------------------------------------------
create or replace function public.events_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  cnt int;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'anon' then
    return new;
  end if;
  if new.event_type is null or new.event_type not in (
    'web_zip_search','web_browse_location_set','web_reserve_started',
    'web_reserve_submitted','web_listing_published',
    'web_gnome_opened','web_gnome_quick_action','web_gnome_message',
    'web_seed_profile_started','web_seed_profile_completed','web_seed_checkout_started'
  ) then
    raise exception 'EVENT_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if length(coalesce(new.metadata::text, '')) > 512 then
    raise exception 'EVENT_METADATA_TOO_LARGE' using errcode = 'P0001';
  end if;
  new.user_id := null;
  new.listing_id := null;
  select count(*) into cnt from public.events
  where user_id is null and created_at > now() - interval '1 minute';
  if cnt >= 300 then
    raise exception 'EVENT_RATE_LIMITED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Starter catalog: real horticultural reference data (products, NOT stock —
-- inventory stays empty until real seed is received via the admin screen).
-- Sow months are zone-6 baseline.
-- ---------------------------------------------------------------------------
insert into public.seed_products
  (crop, variety, category, days_to_germination, days_to_maturity, preferred_sun,
   direct_sow_allowed, spacing_inches, planting_depth_inches, sow_months,
   beginner_friendly, container_friendly, packet_seed_count, tags, description)
values
  ('Radish','French Breakfast','vegetable',5,28,'full',true,2,0.5,'{3,4,5,8,9}',true,true,60,'{salad,fast,beginner}','Crisp, mild, ready in under a month — the classic confidence builder.'),
  ('Lettuce','Buttercrunch','salad',7,55,'partial',true,8,0.25,'{3,4,5,8,9}',true,true,120,'{salad,container}','Tender heads that handle warm days better than most butterheads.'),
  ('Spinach','Bloomsdale Long Standing','salad',8,45,'partial',true,4,0.5,'{3,4,8,9}',true,true,80,'{salad,cool-season}','Savoyed leaves, slow to bolt, loves the shoulder seasons.'),
  ('Kale','Lacinato','vegetable',6,60,'full',true,12,0.5,'{3,4,5,7,8}',true,true,60,'{cool-season,fall}','Dinosaur kale — sweetens after a light frost.'),
  ('Arugula','Rocket','salad',5,40,'partial',true,4,0.25,'{3,4,5,8,9}',true,true,150,'{salad,fast}','Peppery greens in about a month; cut-and-come-again.'),
  ('Turnip','Tokyo Cross','vegetable',5,35,'full',true,3,0.5,'{4,5,7,8}',true,false,100,'{fast,fall}','Small sweet white turnips — roots and greens both eat well.'),
  ('Cilantro','Santo','herb',9,50,'partial',true,4,0.25,'{4,5,8,9}',true,true,80,'{herb,salsa garden}','Slow-bolt cilantro for salsa season.'),
  ('Basil','Genovese','herb',8,65,'full',true,10,0.25,'{5,6}',true,true,70,'{herb,container}','The pesto classic; pinch often, harvest forever.'),
  ('Dill','Bouquet','herb',10,55,'full',true,6,0.25,'{4,5,6}',true,true,90,'{herb,pollinator}','Feathery leaves for pickles; flowers the pollinators adore.'),
  ('Carrot','Scarlet Nantes','vegetable',12,68,'full',true,2,0.25,'{4,5,7}',false,false,200,'{storage}','Sweet, blunt-tipped, the home-garden standard.'),
  ('Beet','Detroit Dark Red','vegetable',8,58,'full',true,3,0.5,'{4,5,7,8}',true,false,80,'{storage,fall}','Deep red roots plus tasty greens.'),
  ('Bush Bean','Provider','vegetable',8,50,'full',true,4,1.0,'{5,6,7}',true,false,40,'{fast,summer}','Reliable early bean that sets in cool soil.'),
  ('Zucchini','Black Beauty','vegetable',8,55,'full',true,24,1.0,'{5,6}',true,false,15,'{summer}','The famous over-producer. You will share.'),
  ('Cucumber','Marketmore 76','vegetable',7,63,'full',true,12,0.5,'{5,6}',true,false,25,'{summer}','Dependable slicer bred for disease resistance.'),
  ('Sunflower','Mammoth','flower',8,90,'full',true,18,1.0,'{5,6}',true,false,25,'{flower,pollinator,kids}','Twelve feet of neighborhood entertainment.'),
  ('Zinnia','California Giant','flower',6,75,'full',true,9,0.25,'{5,6}',true,true,50,'{flower,pollinator,cut-flower}','Cut-and-come-again color until frost.'),
  ('Peas','Sugar Snap','vegetable',9,62,'full',true,2,1.0,'{3,4,8}',true,false,50,'{cool-season,kids}','Eat-the-pod sweetness; kids strip the vines bare.'),
  ('Swiss Chard','Bright Lights','vegetable',7,55,'partial',true,6,0.5,'{4,5,6,7,8}',true,true,50,'{salad,container,colorful}','Rainbow stems; one sowing feeds you all season.')
on conflict (crop, variety) do nothing;

-- Rollback sketch: drop functions admin_*/generate_seed_drop/release_seed_drop_items/
-- seed_lot_eligible; drop tables seed_order_items, seed_orders, seed_profiles,
-- seed_inventory_log, germination_tests, seed_lots, seed_products; restore 0027
-- events_guard body.

-- (applied as 0029 live) Admin UI writes audit rows for manual adjustments.
drop policy if exists seed_inventory_log_admin_insert on public.seed_inventory_log;
create policy seed_inventory_log_admin_insert on public.seed_inventory_log
  for insert with check (public.is_admin() and actor = auth.uid());
