-- Gnome — extend the anon analytics allowlist (0025) with the redesign's
-- gnome-assistant events. Same guard, same caps; only the name list grows.
-- Message CONTENT is never sent to analytics — event names + chip labels only.

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
    'web_zip_search',
    'web_browse_location_set',
    'web_reserve_started',
    'web_reserve_submitted',
    'web_listing_published',
    'web_gnome_opened',
    'web_gnome_quick_action',
    'web_gnome_message'
  ) then
    raise exception 'EVENT_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  if length(coalesce(new.metadata::text, '')) > 512 then
    raise exception 'EVENT_METADATA_TOO_LARGE' using errcode = 'P0001';
  end if;

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
