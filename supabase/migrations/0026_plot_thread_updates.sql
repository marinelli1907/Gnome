-- Gnome — M11 Phase 1.5: grower↔buyer communication + growth updates on
-- reserved plots. Run after 0025.
--
-- Reuses the 0004 claim-scoped chat wholesale (a plot reservation IS a
-- claim, and approval already opens the thread to exactly the two parties).
-- Additions:
--   1. claim_messages.kind — 'message' (default) or 'update'. An update is a
--      growth report; only the GROWER (listing owner) may post one.
--   2. claim_messages.photo_url — optional photo, restricted to this
--      project's public listing-images bucket so the column can't be used to
--      smuggle arbitrary links into threads.
--   3. listings_select_claimer — a claimer may read the listing their claim
--      points at even after it leaves 'active' (a reserved plot flips to
--      'claimed', which used to make the listing invisible to its own buyer).
--      Uses a SECURITY DEFINER helper to avoid listings→claims→listings
--      policy recursion.

alter table public.claim_messages
  add column if not exists kind text not null default 'message'
    check (kind in ('message','update')),
  add column if not exists photo_url text
    check (
      photo_url is null
      or (
        length(photo_url) < 500
        and photo_url like 'https://fgybyghwcjlstqxkclch.supabase.co/storage/v1/object/public/listing-images/%'
      )
    );

-- Growth updates are the grower's voice only.
create or replace function public.claim_messages_kind_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.kind = 'update' then
    if auth.uid() is distinct from (
      select l.owner_id from public.claims c
      join public.listings l on l.id = c.listing_id
      where c.id = new.claim_id
    ) then
      raise exception 'UPDATES_ARE_GROWER_ONLY' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists claim_messages_kind_guard on public.claim_messages;
create trigger claim_messages_kind_guard
  before insert on public.claim_messages
  for each row execute function public.claim_messages_kind_guard();

-- A claimer can always read the listing their claim references (title/photos
-- for the reservation card and thread header) — read-only; write policies
-- are untouched.
create or replace function public.has_claim_on(lid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.claims c
    where c.listing_id = lid and c.claimer_id = auth.uid()
  );
$$;

drop policy if exists listings_select_claimer on public.listings;
create policy listings_select_claimer on public.listings
  for select using (public.has_claim_on(id));

-- Rollback: drop policy listings_select_claimer; drop function has_claim_on;
-- drop trigger claim_messages_kind_guard + function; drop the two columns.
