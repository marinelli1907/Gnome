-- Extend the existing first-party event sink for Seasonal Discovery. This
-- preserves listing-view validation, anonymous metadata limits, and throttling.
create or replace function public.events_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_status public.listing_status;
  v_expires timestamptz;
  v_source text;
  v_recent integer;
begin
  if new.event_type = 'listing_viewed' then
    if v_uid is null or public.is_admin() then
      return null;
    end if;

    select l.owner_id, l.status, l.expires_at
      into v_owner, v_status, v_expires
      from public.listings l
     where l.id = new.listing_id;

    if not found
       or v_owner = v_uid
       or v_status <> 'active'
       or v_expires <= now() then
      return null;
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(new.listing_id::text || ':' || v_uid::text, 0)
    );

    if exists (
      select 1
        from public.events e
       where e.event_type = 'listing_viewed'
         and e.listing_id = new.listing_id
         and e.user_id = v_uid
         and e.created_at > now() - interval '30 minutes'
    ) then
      return null;
    end if;

    v_source := case new.metadata ->> 'source'
      when 'shared_link' then 'shared_link'
      when 'notification' then 'notification'
      when 'detail' then 'detail'
      else 'unknown'
    end;
    new.user_id := v_uid;
    new.metadata := jsonb_build_object('source', v_source);
    return new;
  end if;

  if coalesce(auth.jwt() ->> 'role', '') <> 'anon' then
    return new;
  end if;

  if new.event_type not in (
    'web_zip_search',
    'web_browse_location_set',
    'web_reserve_started',
    'web_reserve_submitted',
    'web_listing_published',
    'web_gnome_opened',
    'web_gnome_quick_action',
    'web_gnome_message',
    'web_drop_viewed',
    'web_drop_shared',
    'seasonal_section_viewed',
    'seasonal_listing_clicked',
    'seasonal_seller_cta_clicked',
    'seasonal_search_chip_clicked',
    'web_seasonal_section_viewed',
    'web_seasonal_listing_clicked',
    'web_seasonal_seller_cta_clicked',
    'web_seasonal_search_chip_clicked'
  ) then
    raise exception 'EVENT_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  if new.metadata is not null and pg_column_size(new.metadata) > 512 then
    raise exception 'EVENT_METADATA_TOO_LARGE' using errcode = 'P0001';
  end if;

  new.user_id := null;
  new.listing_id := null;

  select count(*) into v_recent
    from public.events e
   where e.user_id is null
     and e.created_at > now() - interval '1 minute';
  if v_recent >= 300 then
    raise exception 'EVENT_RATE_LIMITED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;
