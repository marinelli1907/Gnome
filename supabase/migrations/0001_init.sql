-- Gnome — initial schema for the surplus-produce sharing loop.
-- Run this in the Supabase SQL Editor (or via `supabase db push`) against a
-- fresh project. Idempotent-ish: safe to re-run on a clean project.
--
-- Loop: post a listing -> neighbors browse nearby -> claim -> owner approves.
-- No payments, no messaging, no reviews (per v1 scope lock).
--
-- NOTE (per CTO/Vanth): several columns/tables below are NOT used by V1 UI
-- (user_type, business_*, city/county/state, weight_estimate, organic_flag,
-- events). They exist so the data layer is future-proof for territory-based
-- monetization and analytics without a painful retrofit later. They are
-- additive and have safe defaults — they do not affect the P0 loop.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type listing_status as enum ('active', 'claimed', 'completed', 'expired', 'removed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type claim_status as enum ('pending', 'approved', 'declined', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_type as enum ('neighbor', 'grower', 'farm', 'business', 'market', 'municipality');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  name              text not null default 'Neighbor',
  avatar_url        text,
  -- Geography stored separately (territory-level monetization, future):
  zip_code          text,
  city              text,
  county            text,
  state             text,
  -- Account typing / monetization future-proofing (hidden in V1 UI).
  -- user_type is for segmentation/analytics ONLY. Gate features off the
  -- capability flags below (e.g. can_sponsor), never off user_type, so roles
  -- never require a migration to grant a capability.
  user_type         user_type not null default 'neighbor',
  business_account  boolean not null default false,
  business_category text,
  can_post              boolean not null default true,
  can_claim             boolean not null default true,
  can_sponsor           boolean not null default false,
  can_create_promotions boolean not null default false,
  can_offer_delivery    boolean not null default false,  -- future (V2 delivery); generic, no cross-app tie
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- listings
-- ---------------------------------------------------------------------------
create table if not exists public.listings (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  title           text not null,
  description     text,
  category        text not null,
  quantity        text,
  weight_estimate text,                              -- future-proofing (nullable)
  organic_flag    boolean not null default false,    -- future-proofing
  delivery_available boolean not null default false, -- future (V2 delivery); V1 listings stay pickup
  photos          text[] not null default '{}',
  -- Precise location:
  lat             double precision,
  lng             double precision,
  -- Territory location (future sponsorship sales by territory):
  city            text,
  county          text,
  state           text,
  zip             text,
  status          listing_status not null default 'active',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '7 days'),
  -- V1 constraint: at most 5 photos per listing.
  constraint listings_photo_limit check (coalesce(array_length(photos, 1), 0) <= 5)
);

create index if not exists listings_status_idx     on public.listings (status);
create index if not exists listings_owner_idx       on public.listings (owner_id);
create index if not exists listings_created_at_idx  on public.listings (created_at desc);

-- ---------------------------------------------------------------------------
-- claims
-- ---------------------------------------------------------------------------
create table if not exists public.claims (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings (id) on delete cascade,
  claimer_id  uuid not null references public.profiles (id) on delete cascade,
  status      claim_status not null default 'pending',
  -- future (V2 delivery) — dormant in V1, nothing reads these:
  fulfillment_method     text not null default 'pickup',  -- pickup | delivery | meetup
  assigned_fulfiller_id  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (listing_id, claimer_id)
);

create index if not exists claims_listing_idx on public.claims (listing_id);
create index if not exists claims_claimer_idx on public.claims (claimer_id);

-- ---------------------------------------------------------------------------
-- events  (analytics, future-proofing — stays empty until instrumented)
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles (id) on delete set null,
  event_type  text not null,        -- listing_created, listing_viewed,
                                     -- listing_claimed, listing_completed,
                                     -- listing_expired, profile_viewed,
                                     -- search_performed, radius_changed
  listing_id  uuid references public.listings (id) on delete set null,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists events_type_idx on public.events (event_type);
create index if not exists events_user_idx on public.events (user_id);

-- ---------------------------------------------------------------------------
-- New-user trigger: auto-create a profile row when someone signs up.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'Neighbor'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- When a claim is approved, mark the listing claimed and decline other pending
-- claims on the same listing. When a claim is cancelled/declined and the
-- listing was claimed by it, reopen the listing.
-- ---------------------------------------------------------------------------
create or replace function public.handle_claim_status()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    update public.listings set status = 'claimed' where id = new.listing_id;
    update public.claims
      set status = 'declined'
      where listing_id = new.listing_id
        and id <> new.id
        and status = 'pending';
  elsif new.status in ('cancelled', 'declined') and old.status = 'approved' then
    update public.listings set status = 'active'
      where id = new.listing_id and status = 'claimed';
  end if;
  return new;
end;
$$;

drop trigger if exists on_claim_status_change on public.claims;
create trigger on_claim_status_change
  after update on public.claims
  for each row execute function public.handle_claim_status();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.claims   enable row level security;
alter table public.events   enable row level security;

-- profiles: world-readable; you can only write your own row.
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select using (true);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- listings: anyone (incl. anonymous) can read ACTIVE listings. The owner can
-- additionally read all of their own listings regardless of status (for the
-- profile "your listings" view). Only the owner can edit/delete.
drop policy if exists "listings_select_active_or_owner" on public.listings;
create policy "listings_select_active_or_owner" on public.listings
  for select using (status = 'active' or auth.uid() = owner_id);

drop policy if exists "listings_insert_owner" on public.listings;
create policy "listings_insert_owner" on public.listings
  for insert with check (auth.uid() = owner_id);

drop policy if exists "listings_update_owner" on public.listings;
create policy "listings_update_owner" on public.listings
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "listings_delete_owner" on public.listings;
create policy "listings_delete_owner" on public.listings
  for delete using (auth.uid() = owner_id);

-- claims: visible to the claimer and to the listing owner.
drop policy if exists "claims_select_involved" on public.claims;
create policy "claims_select_involved" on public.claims
  for select using (
    auth.uid() = claimer_id
    or auth.uid() = (select owner_id from public.listings l where l.id = listing_id)
  );

-- A signed-in user can claim someone else's listing.
drop policy if exists "claims_insert_claimer" on public.claims;
create policy "claims_insert_claimer" on public.claims
  for insert with check (
    auth.uid() = claimer_id
    and auth.uid() <> (select owner_id from public.listings l where l.id = listing_id)
  );

-- The listing owner can approve/decline; the claimer can cancel their own.
-- (Both can issue UPDATE; the app only ever sets owner->approved/declined and
-- claimer->cancelled, and the claim-status trigger keeps listings consistent.)
drop policy if exists "claims_update_involved" on public.claims;
create policy "claims_update_involved" on public.claims
  for update using (
    auth.uid() = claimer_id
    or auth.uid() = (select owner_id from public.listings l where l.id = listing_id)
  );

-- events: a user can insert their own events (or anonymous ones) and read only
-- their own. Analytics aggregation happens server-side with the service role.
drop policy if exists "events_insert_self_or_anon" on public.events;
create policy "events_insert_self_or_anon" on public.events
  for insert with check (user_id is null or auth.uid() = user_id);

drop policy if exists "events_select_self" on public.events;
create policy "events_select_self" on public.events
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Storage bucket for listing photos.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do nothing;

drop policy if exists "listing_images_read" on storage.objects;
create policy "listing_images_read" on storage.objects
  for select using (bucket_id = 'listing-images');

drop policy if exists "listing_images_insert" on storage.objects;
create policy "listing_images_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'listing-images');

drop policy if exists "listing_images_update" on storage.objects;
create policy "listing_images_update" on storage.objects
  for update to authenticated using (bucket_id = 'listing-images' and owner = auth.uid());

drop policy if exists "listing_images_delete" on storage.objects;
create policy "listing_images_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'listing-images' and owner = auth.uid());
