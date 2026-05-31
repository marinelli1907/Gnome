-- Gnome — V1.1 Wanted Posts. EXTENDS public.listings (no separate table).
-- Run after 0001_init.sql and 0002_push.sql, against the live project.
-- Idempotent-ish: enum create is guarded; column/index/policy adds use IF NOT
-- EXISTS / drop-and-recreate like 0001.
--
-- Model: a listing is either an OFFER ("I have extra") or a WANTED
-- ("I'm looking for"). Same listing_status enum drives both:
--   active = still looking / available, claimed = someone offered / claimed,
--   completed = fulfilled, expired, removed.

-- ---------------------------------------------------------------------------
-- Enum + columns
-- ---------------------------------------------------------------------------
do $$ begin
  create type listing_kind as enum ('offer', 'wanted');
exception when duplicate_object then null; end $$;

alter table public.listings
  add column if not exists kind listing_kind not null default 'offer';

-- When an offer is created in response to a wanted post ("I Have This"), the
-- offer points back at the wanted post it fulfills.
alter table public.listings
  add column if not exists fulfilled_by_listing_id uuid references public.listings (id) on delete set null;

create index if not exists listings_kind_idx on public.listings (kind);

-- ---------------------------------------------------------------------------
-- Expiry by kind (offers 7 days, wanted 30 days), enforced at the DB layer so
-- the app is never solely trusted. We drop the static 7-day default and let a
-- BEFORE INSERT trigger compute expires_at by kind WHEN the caller didn't
-- provide one (i.e. it arrives NULL). Also validates fulfilled_by linkage.
-- ---------------------------------------------------------------------------
alter table public.listings alter column expires_at drop default;

create or replace function public.listings_before_write()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  want record;
begin
  -- Expiry by kind, only when not explicitly provided.
  if tg_op = 'INSERT' and new.expires_at is null then
    new.expires_at := now() + (case when new.kind = 'wanted'
                                     then interval '30 days'
                                     else interval '7 days' end);
  end if;

  -- Integrity for the "offer against a want" link: only the owner of the offer
  -- can set it (enforced by listings insert/update RLS = owner-only writes), and
  -- it must reference someone else's WANTED post — never your own.
  if new.fulfilled_by_listing_id is not null then
    select kind, owner_id into want
      from public.listings where id = new.fulfilled_by_listing_id;
    if not found then
      raise exception 'fulfilled_by_listing_id % does not exist', new.fulfilled_by_listing_id;
    end if;
    if want.kind <> 'wanted' then
      raise exception 'fulfilled_by_listing_id must reference a wanted post';
    end if;
    if want.owner_id = new.owner_id then
      raise exception 'cannot fulfill your own wanted post';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists listings_before_write on public.listings;
create trigger listings_before_write
  before insert or update on public.listings
  for each row execute function public.listings_before_write();

-- ---------------------------------------------------------------------------
-- RLS — current policies already enforce the V1.1 rules:
--   * "listings_update_owner" (from 0001): ONLY the owner can update their
--     listing, so only the owner can mark their own wanted post
--     completed/removed.
--   * "listings_insert_owner" / "listings_update_owner": fulfilled_by_listing_id
--     lives on the OFFER row, which only its owner can write — so only the
--     owner of a matching offer can connect it to someone else's wanted (and
--     the trigger above blocks linking to your own / non-wanted listing).
--   * "claims_insert_claimer" (from 0001): self-claim stays blocked.
-- No policy changes are required; these statements re-assert them idempotently
-- so 0003 is self-documenting if applied to a partially-migrated DB.
-- ---------------------------------------------------------------------------
drop policy if exists "listings_update_owner" on public.listings;
create policy "listings_update_owner" on public.listings
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "listings_insert_owner" on public.listings;
create policy "listings_insert_owner" on public.listings
  for insert with check (auth.uid() = owner_id);
