-- Listing-level seller performance and recoverable deletion.
-- Reuses the existing events, claims, seller ledger, promotion, and publish
-- ledgers. No payment state or pricing configuration changes here.

alter table public.listings
  add column if not exists archived_at timestamptz,
  add column if not exists analytics_started_at timestamptz;

alter table public.listings
  alter column analytics_started_at set default now();

-- Existing rows are deliberately not backfilled. For historical listings,
-- missing view tracking is unknown, not zero. New rows and legitimate future
-- active transitions are stamped by the default/trigger below.

create or replace function public.stamp_listing_analytics_start()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.analytics_started_at := coalesce(new.analytics_started_at, now());
  elsif new.status = 'active'
        and old.status is distinct from 'active'
        and new.analytics_started_at is null then
    new.analytics_started_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists z_listing_analytics_start on public.listings;
create trigger z_listing_analytics_start
  before insert or update of status on public.listings
  for each row execute function public.stamp_listing_analytics_start();

-- archived_at is harmless on publicly visible rows (it is always NULL there)
-- and is needed by the owner list's PostgREST filter. analytics_started_at is
-- intentionally server-only.
grant select (archived_at) on public.listings to anon, authenticated;
revoke insert (archived_at, analytics_started_at),
       update (archived_at, analytics_started_at)
  on public.listings from anon, authenticated;

create index if not exists listings_owner_unarchived_created_idx
  on public.listings (owner_id, created_at desc)
  where archived_at is null;

create index if not exists events_listing_viewer_recent_idx
  on public.events (listing_id, user_id, created_at desc)
  where event_type = 'listing_viewed' and user_id is not null;

create index if not exists seller_txn_listing_completed_idx
  on public.seller_transactions (listing_id, sold_at desc)
  where listing_id is not null and status = 'completed';

create index if not exists claims_listing_status_created_idx
  on public.claims (listing_id, status, created_at);

-- Harden the existing generic event sink for listing views. A legitimate view
-- is a signed-in non-owner opening a currently public listing. Repeated opens
-- by the same viewer inside 30 minutes collapse to one event. The stored
-- metadata is reduced to a coarse source category; no buyer identity is ever
-- returned to the seller.
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

    -- Serialize this viewer/listing pair so simultaneous refreshes cannot both
    -- pass the recent-event check.
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

  -- Preserve the latest anonymous funnel-event contract from 0117.
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
    'web_drop_shared'
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

-- Consistent seller deletion is always a soft archive. Financial, request,
-- moderation, and promotion relationships remain intact.
create or replace function public.archive_listing(p_listing uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select l.owner_id into v_owner
    from public.listings l
   where l.id = p_listing
   for update;

  if not found then
    raise exception 'LISTING_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_owner <> v_uid then
    raise exception 'NOT_YOUR_LISTING' using errcode = 'P0001';
  end if;

  update public.listings
     set status = 'removed',
         archived_at = coalesce(archived_at, now())
   where id = p_listing;
  return true;
end;
$$;

drop policy if exists "listings_delete_owner" on public.listings;
revoke delete on public.listings from anon, authenticated;
revoke execute on function public.archive_listing(uuid) from public, anon;
grant execute on function public.archive_listing(uuid) to authenticated;

-- Owner-only aggregate. It deliberately returns counts and money totals only:
-- viewer identities never cross this boundary.
create or replace function public.my_listing_performance(p_listing uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  l public.listings;
  v_views bigint := 0;
  v_unique bigint := 0;
  v_requests bigint := 0;
  v_reservations bigint := 0;
  v_completed_requests bigint := 0;
  v_reserved_quantity numeric := 0;
  v_completed_sales bigint := 0;
  v_quantity_sold numeric := 0;
  v_revenue_cents bigint := 0;
  v_manual_revenue_cents bigint := 0;
  v_request_revenue_cents bigint := 0;
  v_paid_promotions bigint := 0;
  v_included_promotions bigint := 0;
  v_promotion_spend_cents bigint;
  v_promotion_spend_known boolean := true;
  v_renewals bigint := 0;
  v_last_activity timestamptz;
  v_payment_breakdown jsonb := '[]'::jsonb;
  v_promotion_periods jsonb := '[]'::jsonb;
  v_conversion numeric;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select * into l from public.listings where id = p_listing;
  if not found then
    raise exception 'LISTING_NOT_FOUND' using errcode = 'P0001';
  end if;
  if l.owner_id <> v_uid then
    raise exception 'NOT_YOUR_LISTING' using errcode = 'P0001';
  end if;

  if l.analytics_started_at is not null then
    select count(*), count(distinct e.user_id)
      into v_views, v_unique
      from public.events e
     where e.listing_id = p_listing
       and e.event_type = 'listing_viewed'
       and e.user_id is not null
       and e.created_at >= l.analytics_started_at;
  end if;

  select
    count(*),
    count(*) filter (where c.status in ('approved', 'completed')),
    count(*) filter (where c.status = 'completed'),
    coalesce(sum(c.quantity_requested) filter (where c.status in ('approved', 'completed')), 0)
    into v_requests, v_reservations, v_completed_requests, v_reserved_quantity
    from public.claims c
   where c.listing_id = p_listing;

  select
    count(*),
    coalesce(sum(t.quantity), 0),
    coalesce(sum(t.gross_cents - t.discount_cents), 0),
    coalesce(sum(t.gross_cents - t.discount_cents) filter (where t.source = 'manual'), 0),
    coalesce(sum(t.gross_cents - t.discount_cents) filter (where t.source = 'request'), 0)
    into v_completed_sales, v_quantity_sold, v_revenue_cents,
         v_manual_revenue_cents, v_request_revenue_cents
    from public.seller_transactions t
   where t.listing_id = p_listing
     and t.status = 'completed';

  select coalesce(jsonb_agg(jsonb_build_object(
           'method', p.payment_method,
           'revenue_cents', p.revenue_cents,
           'sales', p.sales
         ) order by p.revenue_cents desc), '[]'::jsonb)
    into v_payment_breakdown
    from (
      select t.payment_method,
             sum(t.gross_cents - t.discount_cents)::bigint as revenue_cents,
             count(*)::bigint as sales
        from public.seller_transactions t
       where t.listing_id = p_listing and t.status = 'completed'
       group by t.payment_method
    ) p;

  select
    count(*) filter (where lp.source = 'paid'),
    count(*) filter (where lp.source <> 'paid'),
    case
      when count(*) filter (where lp.source = 'paid') = 0 then 0
      when bool_and(lp.price_cents is not null) filter (where lp.source = 'paid')
        then sum(lp.price_cents) filter (where lp.source = 'paid')
      else null
    end,
    count(*) filter (where lp.source = 'paid') = 0
      or coalesce(bool_and(lp.price_cents is not null) filter (where lp.source = 'paid'), false)
    into v_paid_promotions, v_included_promotions,
         v_promotion_spend_cents, v_promotion_spend_known
    from public.listing_promotions lp
   where lp.listing_id = p_listing
     and lp.status <> 'cancelled';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', lp.id,
           'source', lp.source,
           'status', lp.status,
           'starts_at', lp.starts_at,
           'ends_at', lp.ends_at,
           'seller_paid_cents', case when lp.source = 'paid' then lp.price_cents else 0 end,
           'views_during', case when l.analytics_started_at is null then null else (
             select count(*) from public.events e
              where e.listing_id = p_listing
                and e.event_type = 'listing_viewed'
                and e.created_at >= greatest(lp.starts_at, l.analytics_started_at)
                and e.created_at <= least(coalesce(lp.ends_at, now()), now())
           ) end,
           'requests_during', (
             select count(*) from public.claims c
              where c.listing_id = p_listing
                and c.created_at between lp.starts_at and least(coalesce(lp.ends_at, now()), now())
           ),
           'recorded_sales_during', (
             select count(*) from public.seller_transactions t
              where t.listing_id = p_listing
                and t.status = 'completed'
                and t.sold_at between lp.starts_at and least(coalesce(lp.ends_at, now()), now())
           )
         ) order by lp.created_at desc), '[]'::jsonb)
    into v_promotion_periods
    from public.listing_promotions lp
   where lp.listing_id = p_listing
     and lp.starts_at is not null
     and lp.status <> 'cancelled';

  select count(*) into v_renewals
    from public.listing_publish_events e
   where e.listing_id = p_listing and e.kind = 'renewal';

  select max(activity_at) into v_last_activity
    from (
      select l.created_at as activity_at
      union all select max(e.created_at) from public.events e
        where e.listing_id = p_listing and e.event_type = 'listing_viewed'
      union all select max(coalesce(c.responded_at, c.created_at)) from public.claims c
        where c.listing_id = p_listing
      union all select max(t.sold_at) from public.seller_transactions t
        where t.listing_id = p_listing
      union all select max(lp.created_at) from public.listing_promotions lp
        where lp.listing_id = p_listing
      union all select max(pe.occurred_at) from public.listing_publish_events pe
        where pe.listing_id = p_listing
    ) activity;

  -- A conversion percentage is withheld until five unique signed-in viewers;
  -- below that threshold it is volatile and not useful for a seller decision.
  if l.analytics_started_at is not null and v_unique >= 5 then
    v_conversion := round((v_completed_requests::numeric / v_unique::numeric) * 100, 1);
  end if;

  return jsonb_build_object(
    'listing_id', l.id,
    'status', case when l.archived_at is not null then 'archived'
                   when l.status = 'active' and l.expires_at <= now() then 'expired'
                   else l.status::text end,
    'posted_at', l.created_at,
    'expires_at', l.expires_at,
    'archived_at', l.archived_at,
    'analytics_started_at', l.analytics_started_at,
    'views_tracked', l.analytics_started_at is not null,
    'views', case when l.analytics_started_at is null then null else v_views end,
    'unique_viewers', case when l.analytics_started_at is null then null else v_unique end,
    'requests', v_requests,
    'reservations', v_reservations,
    'completed_requests', v_completed_requests,
    'reserved_quantity', v_reserved_quantity,
    'completed_sales', v_completed_sales,
    'quantity_sold', v_quantity_sold,
    'recorded_revenue_cents', v_revenue_cents,
    'manual_revenue_cents', v_manual_revenue_cents,
    'request_revenue_cents', v_request_revenue_cents,
    'payment_breakdown', v_payment_breakdown,
    'paid_promotions', v_paid_promotions,
    'included_promotions', v_included_promotions,
    'promotion_spend_known', v_promotion_spend_known,
    'promotion_spend_cents', v_promotion_spend_cents,
    'net_after_promotion_cents', case when v_promotion_spend_known
      then v_revenue_cents - coalesce(v_promotion_spend_cents, 0) else null end,
    'promotion_periods', v_promotion_periods,
    'conversion_rate', v_conversion,
    'conversion_basis', 'completed_requests_per_unique_signed_in_viewer',
    'conversion_minimum_viewers', 5,
    'days_listed', greatest(0, floor(extract(epoch from
      (least(now(), l.expires_at) - l.created_at)) / 86400))::integer,
    'renewal_count', v_renewals,
    'repost_count', null,
    'last_activity_at', v_last_activity,
    'quantity_remaining', l.inventory_count,
    'unit', l.unit
  );
end;
$$;

revoke execute on function public.my_listing_performance(uuid) from public, anon;
grant execute on function public.my_listing_performance(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.my_listing_performance(uuid)', 'execute') then
    raise exception 'listing performance self-check: anon can read owner analytics';
  end if;
  if has_function_privilege('anon', 'public.archive_listing(uuid)', 'execute') then
    raise exception 'listing performance self-check: anon can archive listings';
  end if;
  if has_table_privilege('authenticated', 'public.listings', 'delete') then
    raise exception 'listing performance self-check: authenticated can still hard-delete listings';
  end if;
  if exists (select 1 from public.billing_config where payments_live_enabled is true) then
    raise exception 'listing performance self-check: payments_live_enabled must remain false';
  end if;
end;
$$;

notify pgrst, 'reload schema';
