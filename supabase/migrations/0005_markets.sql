-- Gnome — M1 Markets foundation. Run after 0001–0004 on the live project.
-- Architectural change: User -> Market -> Listings. Every profile quietly gets a
-- lightweight "Market" (a local garden/storefront identity). M1 = single owner
-- per market; market_members exists for a future multi-manager Farm tier.
-- Nothing in V1 is removed: listings/claims/messaging/RLS all survive.

-- ---------------------------------------------------------------------------
-- markets
-- ---------------------------------------------------------------------------
create table if not exists public.markets (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null default 'My Garden',
  avatar_url  text,
  description text,
  -- territory (reuse existing geo pattern; unused in M1 UI):
  city        text,
  county      text,
  state       text,
  zip         text,
  status      text not null default 'active',
  created_at  timestamptz not null default now()
);

create index if not exists markets_owner_idx  on public.markets (owner_id);
create index if not exists markets_status_idx on public.markets (status);

-- ---------------------------------------------------------------------------
-- market_members (future multi-manager; M1 just creates the owner row)
-- ---------------------------------------------------------------------------
create table if not exists public.market_members (
  id         uuid primary key default gen_random_uuid(),
  market_id  uuid not null references public.markets (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'owner',
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
-- Auto-create a default Market (+ owner membership) for every new profile.
-- Chains off the existing handle_new_user trigger: auth.users insert ->
-- profile insert -> this trigger.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  mid uuid;
begin
  insert into public.markets (owner_id, name)
  values (new.id, coalesce(nullif(trim(new.name), ''), 'Neighbor') || '''s Garden')
  returning id into mid;

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
-- membership, and attach every existing listing to its owner's market.
-- ---------------------------------------------------------------------------
insert into public.markets (owner_id, name)
select p.id, coalesce(nullif(trim(p.name), ''), 'Neighbor') || '''s Garden'
from public.profiles p
where not exists (select 1 from public.markets m where m.owner_id = p.id);

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
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.markets        enable row level security;
alter table public.market_members enable row level security;

-- markets: anyone can read ACTIVE markets (public garden profile); the owner can
-- also read their own in any status. Only the owner writes (members in a future
-- milestone).
drop policy if exists "markets_select_active_or_owner" on public.markets;
create policy "markets_select_active_or_owner" on public.markets
  for select using (status = 'active' or auth.uid() = owner_id);

drop policy if exists "markets_insert_owner" on public.markets;
create policy "markets_insert_owner" on public.markets
  for insert with check (auth.uid() = owner_id);

drop policy if exists "markets_update_owner" on public.markets;
create policy "markets_update_owner" on public.markets
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "markets_delete_owner" on public.markets;
create policy "markets_delete_owner" on public.markets
  for delete using (auth.uid() = owner_id);

-- market_members: readable by the member themselves or the market owner; only
-- the market owner can add/manage members.
drop policy if exists "market_members_select_involved" on public.market_members;
create policy "market_members_select_involved" on public.market_members
  for select using (
    auth.uid() = user_id
    or auth.uid() = (select owner_id from public.markets m where m.id = market_id)
  );

drop policy if exists "market_members_insert_owner" on public.market_members;
create policy "market_members_insert_owner" on public.market_members
  for insert with check (
    auth.uid() = (select owner_id from public.markets m where m.id = market_id)
  );

drop policy if exists "market_members_update_owner" on public.market_members;
create policy "market_members_update_owner" on public.market_members
  for update using (
    auth.uid() = (select owner_id from public.markets m where m.id = market_id)
  );

drop policy if exists "market_members_delete_owner" on public.market_members;
create policy "market_members_delete_owner" on public.market_members
  for delete using (
    auth.uid() = (select owner_id from public.markets m where m.id = market_id)
  );
