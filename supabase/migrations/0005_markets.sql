-- Gnome — M1 Markets foundation, per "Gnome Market Architecture v2".
-- Run after 0001–0004 on the live project. Additive only; V1 is untouched
-- (listings/claims/messaging/RLS/categories all survive).
--
-- A Market = a SELLER STOREFRONT identity (NOT a geographic area; geo "Area"
-- is a separate discovery concept). Markets still carry their own location.
-- M1 = single owner per market; market_members supports a future Farm tier.
-- Several enums/tables below are created now (dormant, no UI) to avoid churning
-- migrations across M2–M4. No payments/cart/checkout anywhere.

-- ---------------------------------------------------------------------------
-- Enums (create all now; harmless and avoids M2 churn)
-- ---------------------------------------------------------------------------
do $$ begin create type market_status as enum ('active','paused','suspended','deleted');
exception when duplicate_object then null; end $$;

do $$ begin create type market_type as enum
  ('neighbor','backyard_grower','farm','farm_stand','nursery','garden_center','sponsor','municipality','nonprofit');
exception when duplicate_object then null; end $$;

do $$ begin create type market_plan as enum ('free','grower','farm','sponsor');
exception when duplicate_object then null; end $$;

do $$ begin create type listing_type as enum ('free','trade','sale','wanted');
exception when duplicate_object then null; end $$;

do $$ begin create type listing_fulfillment_type as enum ('pickup','meetup','delivery');
exception when duplicate_object then null; end $$;

do $$ begin create type listing_payment_status as enum ('none','external','pending','paid','refunded','failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- slug helper
-- ---------------------------------------------------------------------------
create or replace function public.gnome_slugify(txt text)
returns text language sql immutable as $$
  select coalesce(
    nullif(trim(both '-' from regexp_replace(lower(coalesce(txt,'')), '[^a-z0-9]+', '-', 'g')), ''),
    'market'
  );
$$;

-- ---------------------------------------------------------------------------
-- markets (v2 §5)
-- ---------------------------------------------------------------------------
create table if not exists public.markets (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.profiles (id) on delete cascade,
  name                text not null default 'My Garden',
  slug                text unique,
  description         text,
  market_type         market_type not null default 'neighbor',
  plan                market_plan  not null default 'free',
  status              market_status not null default 'active',
  avatar_url          text,
  banner_url          text,
  city                text,
  county              text,
  state               text,
  zip                 text,
  lat                 double precision,
  lng                 double precision,
  approximate_location text,
  contact_email       text,
  contact_phone       text,
  website_url         text,
  instagram_url       text,
  facebook_url        text,
  accepts_free        boolean not null default true,
  accepts_trade       boolean not null default true,
  accepts_sales       boolean not null default true,
  pickup_instructions text,
  public_pickup_note  text,
  verified            boolean not null default false,
  sponsor_visible     boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists markets_owner_idx  on public.markets (owner_id);
create index if not exists markets_status_idx on public.markets (status);
create index if not exists markets_slug_idx   on public.markets (slug);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists markets_set_updated_at on public.markets;
create trigger markets_set_updated_at
  before update on public.markets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- market_members (v2 §6) — owner|manager|staff; M1 just creates the owner row
-- ---------------------------------------------------------------------------
create table if not exists public.market_members (
  id         uuid primary key default gen_random_uuid(),
  market_id  uuid not null references public.markets (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner','manager','staff')),
  created_at timestamptz not null default now(),
  unique (market_id, user_id)
);

create index if not exists market_members_market_idx on public.market_members (market_id);
create index if not exists market_members_user_idx   on public.market_members (user_id);

-- ---------------------------------------------------------------------------
-- listings.market_id
-- ---------------------------------------------------------------------------
alter table public.listings
  add column if not exists market_id uuid references public.markets (id) on delete set null;

create index if not exists listings_market_idx on public.listings (market_id);

-- ---------------------------------------------------------------------------
-- Dormant future tables (no UI yet, future-proof per v2)
-- ---------------------------------------------------------------------------
-- §9 plan_limits
create table if not exists public.plan_limits (
  plan                market_plan primary key,
  max_active_listings integer not null,
  max_photos          integer not null,
  analytics           boolean not null default false,
  featured            boolean not null default false,
  delivery_eligible   boolean not null default false,
  price_cents         integer not null default 0
);

insert into public.plan_limits (plan, max_active_listings, max_photos, analytics, featured, delivery_eligible, price_cents)
values
  ('free',   10,  5, false, false, false, 0),
  ('grower', 100, 10, true,  true,  false, 999),
  ('farm',   500, 10, true,  true,  true,  2999),
  ('sponsor',500, 10, true,  true,  true,  9900)
on conflict (plan) do nothing;

-- §10 market_subscriptions (no Stripe wiring)
create table if not exists public.market_subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  market_id            uuid not null references public.markets (id) on delete cascade,
  plan                 market_plan not null,
  provider             text,
  customer_id          text,
  subscription_id      text,
  status               text,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  created_at           timestamptz not null default now()
);
create index if not exists market_subscriptions_market_idx on public.market_subscriptions (market_id);

-- §11 market_follows
create table if not exists public.market_follows (
  id          uuid primary key default gen_random_uuid(),
  market_id   uuid not null references public.markets (id) on delete cascade,
  follower_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (market_id, follower_id)
);
create index if not exists market_follows_market_idx   on public.market_follows (market_id);
create index if not exists market_follows_follower_idx on public.market_follows (follower_id);

-- §12 market_metrics
create table if not exists public.market_metrics (
  id                     uuid primary key default gen_random_uuid(),
  market_id              uuid not null references public.markets (id) on delete cascade,
  date                   date not null,
  listing_views          integer not null default 0,
  profile_views          integer not null default 0,
  claims_received        integer not null default 0,
  claims_approved        integer not null default 0,
  messages_received      integer not null default 0,
  followers_gained       integer not null default 0,
  free_listings_created  integer not null default 0,
  trade_listings_created integer not null default 0,
  sale_listings_created  integer not null default 0,
  unique (market_id, date)
);
create index if not exists market_metrics_market_idx on public.market_metrics (market_id);

-- §13 sponsored_placements
create table if not exists public.sponsored_placements (
  id             uuid primary key default gen_random_uuid(),
  market_id      uuid not null references public.markets (id) on delete cascade,
  placement_type text,
  city           text,
  state          text,
  zip            text,
  start_date     date,
  end_date       date,
  status         text not null default 'active',
  created_at     timestamptz not null default now()
);
create index if not exists sponsored_placements_market_idx on public.sponsored_placements (market_id);

-- ---------------------------------------------------------------------------
-- Auto-create a default Market (+ owner membership) for every new profile.
-- Chains off handle_new_user: auth.users insert -> profile insert -> here.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  mid uuid := gen_random_uuid();
  nm  text := coalesce(nullif(trim(new.name), ''), 'Neighbor') || '''s Garden';
begin
  insert into public.markets (id, owner_id, name, slug)
  values (mid, new.id, nm, public.gnome_slugify(nm) || '-' || substr(mid::text, 1, 8));

  insert into public.market_members (market_id, user_id, role)
  values (mid, new.id, 'owner')
  on conflict (market_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_profile_created on public.profiles;
create trigger on_profile_created
  after insert on public.profiles
  for each row execute function public.handle_new_profile();

-- ---------------------------------------------------------------------------
-- BACKFILL existing data (idempotent): a default Market per profile, owner
-- membership, slugs, and attach every existing listing to its owner's market.
-- ---------------------------------------------------------------------------
insert into public.markets (owner_id, name)
select p.id, coalesce(nullif(trim(p.name), ''), 'Neighbor') || '''s Garden'
from public.profiles p
where not exists (select 1 from public.markets m where m.owner_id = p.id);

update public.markets
set slug = public.gnome_slugify(name) || '-' || substr(id::text, 1, 8)
where slug is null;

insert into public.market_members (market_id, user_id, role)
select m.id, m.owner_id, 'owner'
from public.markets m
where not exists (
  select 1 from public.market_members mm
  where mm.market_id = m.id and mm.user_id = m.owner_id
);

update public.listings l
set market_id = m.id
from public.markets m
where m.owner_id = l.owner_id and l.market_id is null;

-- ---------------------------------------------------------------------------
-- Row Level Security (v2 §14)
-- ---------------------------------------------------------------------------
alter table public.markets               enable row level security;
alter table public.market_members        enable row level security;
alter table public.plan_limits           enable row level security;
alter table public.market_subscriptions  enable row level security;
alter table public.market_follows        enable row level security;
alter table public.market_metrics        enable row level security;
alter table public.sponsored_placements  enable row level security;

-- markets: public reads active (or owner); owner inserts; owner + members
-- update; NO hard delete (soft-delete via status='deleted').
drop policy if exists "markets_select_active_or_owner" on public.markets;
create policy "markets_select_active_or_owner" on public.markets
  for select using (status = 'active' or auth.uid() = owner_id);

drop policy if exists "markets_insert_owner" on public.markets;
create policy "markets_insert_owner" on public.markets
  for insert with check (auth.uid() = owner_id);

drop policy if exists "markets_update_owner_or_member" on public.markets;
create policy "markets_update_owner_or_member" on public.markets
  for update using (
    auth.uid() = owner_id
    or exists (select 1 from public.market_members mm where mm.market_id = id and mm.user_id = auth.uid())
  ) with check (
    auth.uid() = owner_id
    or exists (select 1 from public.market_members mm where mm.market_id = id and mm.user_id = auth.uid())
  );
-- (no delete policy by design — markets are soft-deleted by setting status)

-- market_members: member or market owner read; owner manages.
drop policy if exists "market_members_select_involved" on public.market_members;
create policy "market_members_select_involved" on public.market_members
  for select using (
    auth.uid() = user_id
    or auth.uid() = (select owner_id from public.markets m where m.id = market_id)
  );

drop policy if exists "market_members_insert_owner" on public.market_members;
create policy "market_members_insert_owner" on public.market_members
  for insert with check (auth.uid() = (select owner_id from public.markets m where m.id = market_id));

drop policy if exists "market_members_update_owner" on public.market_members;
create policy "market_members_update_owner" on public.market_members
  for update using (auth.uid() = (select owner_id from public.markets m where m.id = market_id));

drop policy if exists "market_members_delete_owner" on public.market_members;
create policy "market_members_delete_owner" on public.market_members
  for delete using (auth.uid() = (select owner_id from public.markets m where m.id = market_id));

-- plan_limits: public read (pricing/limits are not secret). No client writes.
drop policy if exists "plan_limits_select_all" on public.plan_limits;
create policy "plan_limits_select_all" on public.plan_limits
  for select using (true);

-- market_follows: a user manages their own follows; reads limited to own rows.
drop policy if exists "market_follows_select_own" on public.market_follows;
create policy "market_follows_select_own" on public.market_follows
  for select using (auth.uid() = follower_id);

drop policy if exists "market_follows_insert_own" on public.market_follows;
create policy "market_follows_insert_own" on public.market_follows
  for insert with check (auth.uid() = follower_id);

drop policy if exists "market_follows_delete_own" on public.market_follows;
create policy "market_follows_delete_own" on public.market_follows
  for delete using (auth.uid() = follower_id);

-- market_subscriptions / market_metrics / sponsored_placements: owner read only,
-- no public read, no client writes (managed server-side later).
drop policy if exists "market_subscriptions_select_owner" on public.market_subscriptions;
create policy "market_subscriptions_select_owner" on public.market_subscriptions
  for select using (auth.uid() = (select owner_id from public.markets m where m.id = market_id));

drop policy if exists "market_metrics_select_owner" on public.market_metrics;
create policy "market_metrics_select_owner" on public.market_metrics
  for select using (auth.uid() = (select owner_id from public.markets m where m.id = market_id));

drop policy if exists "sponsored_placements_select_owner" on public.sponsored_placements;
create policy "sponsored_placements_select_owner" on public.sponsored_placements
  for select using (auth.uid() = (select owner_id from public.markets m where m.id = market_id));
