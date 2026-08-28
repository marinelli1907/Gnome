-- Minimal contract fixture for the listing-performance migration. This is not
-- a product schema; it models only objects the migration reads or changes.

create type public.listing_status as enum
  ('active', 'claimed', 'completed', 'expired', 'removed', 'paused');
create type public.market_plan as enum ('free', 'grower', 'farm', 'sponsor');

create table public.profiles (
  id uuid primary key,
  name text,
  account_ready boolean not null default true
);

create table public.markets (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  name text not null,
  plan public.market_plan not null default 'free',
  status text not null default 'active'
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  market_id uuid references public.markets(id),
  title text not null,
  category text not null,
  listing_type text not null,
  status public.listing_status not null default 'active',
  price_cents int,
  unit text,
  inventory_count int,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);
alter table public.listings enable row level security;
create policy listings_select_active_or_owner on public.listings
  for select using (status = 'active' or (select auth.uid()) = owner_id);
create policy listings_update_owner on public.listings
  for update using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy listings_delete_owner on public.listings
  for delete using ((select auth.uid()) = owner_id);
grant select, insert, update, delete on public.listings to authenticated;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  event_type text not null,
  listing_id uuid references public.listings(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.events enable row level security;
create policy events_insert_self on public.events
  for insert with check ((select auth.uid()) = user_id or user_id is null);
grant insert on public.events to anon, authenticated;

create or replace function public.is_admin()
returns boolean language sql stable set search_path = '' as $$ select false $$;

create or replace function public.events_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  return new;
end;
$$;
create trigger events_before_insert_guard
  before insert on public.events
  for each row execute function public.events_guard();

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id),
  claimer_id uuid not null references public.profiles(id),
  status text not null default 'pending',
  claim_type text,
  quantity_requested numeric,
  agreed_price_cents int,
  payment_status text,
  payment_method text,
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.seller_transactions (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id),
  listing_id uuid references public.listings(id),
  claim_id uuid references public.claims(id),
  source text not null,
  quantity numeric not null,
  gross_cents int not null,
  discount_cents int not null default 0,
  fee_cents int not null default 0,
  payment_method text not null,
  status text not null default 'completed',
  sold_at timestamptz not null default now()
);

create table public.listing_promotions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id),
  market_id uuid not null references public.markets(id),
  source text not null,
  status text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  price_cents int,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.listing_publish_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id),
  kind text not null,
  occurred_at timestamptz not null default now()
);

create table public.billing_config (
  id boolean primary key default true,
  payments_live_enabled boolean not null default false
);
insert into public.billing_config (id, payments_live_enabled) values (true, false);

insert into public.profiles (id, name, account_ready)
values
  ('02104010-0000-0000-0000-000000000099', 'Historical Not Ready Seller', false);

insert into public.markets (id, owner_id, name, plan, status)
values
  ('02104010-1000-0000-0000-000000000099',
   '02104010-0000-0000-0000-000000000099',
   'Historical Not Ready Market',
   'free',
   'active');

insert into public.listings
  (id, owner_id, market_id, title, category, listing_type, status,
   price_cents, unit, inventory_count, created_at, expires_at)
values
  ('02104010-2000-0000-0000-000000000099',
   '02104010-0000-0000-0000-000000000099',
   '02104010-1000-0000-0000-000000000099',
   'Historical Active Not Ready Listing',
   'vegetables',
   'sale',
   'active',
   250,
   'lb',
   7,
   now() - interval '2 days',
   now() + interval '5 days');

create or replace function public.p0_test_gate_listing_account_ready()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and exists (
       select 1
         from public.profiles p
        where p.id = new.owner_id
          and not p.account_ready
     ) then
    raise exception 'ACCOUNT_NOT_READY:listing:verified_email,age_18,terms,privacy,marketplace_rules'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger p0_test_gate_listing_account_ready
  before update on public.listings
  for each row execute function public.p0_test_gate_listing_account_ready();
