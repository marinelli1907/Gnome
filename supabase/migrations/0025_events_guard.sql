-- Gnome — harden the anonymous analytics sink. Run after 0024.
--
-- 0001 allowed anonymous inserts into events (user_id null) so the public
-- web could log funnel events without cookies. Unbounded, that means anyone
-- with the anon key can write arbitrary rows. This trigger constrains the
-- ANON role only: event-name allowlist, 512-byte metadata cap, forced-null
-- user/listing references, and a global 300/min anon throttle. Authenticated
-- app events and server-side (service-role / auth-trigger) writes pass
-- through untouched — checked via the JWT role claim, so internal triggers
-- (e.g. handle_new_profile's market_created) keep working.

create or replace function public.events_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  cnt int;
begin
  -- Only constrain requests made with the anonymous API role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'anon' then
    return new;
  end if;

  if new.event_type is null or new.event_type not in (
    'web_zip_search',
    'web_browse_location_set',
    'web_reserve_started',
    'web_reserve_submitted',
    'web_listing_published'
  ) then
    raise exception 'EVENT_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  if length(coalesce(new.metadata::text, '')) > 512 then
    raise exception 'EVENT_METADATA_TOO_LARGE' using errcode = 'P0001';
  end if;

  -- Anonymous rows can never claim an identity or reference other rows.
  new.user_id := null;
  new.listing_id := null;

  select count(*) into cnt
  from public.events
  where user_id is null and created_at > now() - interval '1 minute';
  if cnt >= 300 then
    raise exception 'EVENT_RATE_LIMITED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists events_before_insert_guard on public.events;
create trigger events_before_insert_guard
  before insert on public.events
  for each row execute function public.events_guard();

-- Cheap throttle lookups.
create index if not exists events_anon_recent_idx
  on public.events (created_at) where user_id is null;

-- Rollback: drop trigger events_before_insert_guard on events;
--           drop function events_guard(); drop index events_anon_recent_idx;
