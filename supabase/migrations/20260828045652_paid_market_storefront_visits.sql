-- Paid Market storefront calendar + visit requests.
--
-- This extends the existing pickup scheduler and order lifecycle instead of
-- introducing a second appointment system. A visit request is a zero-item
-- market_order with request_kind='VISIT': the seller can confirm, propose a
-- different generated slot, or decline it through the same guarded RPCs.
--
-- Privacy invariants:
--   * follower identities remain self-scoped; public pages receive a count.
--   * exact pickup addresses remain behind order_pickup_details() and are not
--     added to public_markets.
--   * paid-plan eligibility is decided in this SECURITY DEFINER RPC from the
--     server's effective plan, never from a client-supplied flag.

begin;

alter table public.market_orders
  add column if not exists request_kind text not null default 'ORDER'
    check (request_kind in ('ORDER', 'VISIT'));

comment on column public.market_orders.request_kind is
  'ORDER has one or more market_order_items. VISIT is a zero-item request for a generated storefront time slot.';

-- market_orders has an intentionally enumerated SELECT grant because delivery
-- address snapshots are withheld. Keep the new harmless discriminator in that
-- public-to-parties projection without widening any private column grant.
grant select (request_kind) on public.market_orders to authenticated;

create or replace function public.create_market_visit_request(
  p_market uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer uuid := auth.uid();
  v_market public.markets;
  v_location public.market_pickup_locations;
  v_plan public.market_plan;
  v_slot_ok boolean := false;
  v_order uuid;
begin
  if v_buyer is null then
    raise exception 'NOT_SIGNED_IN' using errcode = 'P0001';
  end if;

  select * into v_market
    from public.markets
   where id = p_market and status = 'active';
  if v_market is null then
    raise exception 'MARKET_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if v_market.owner_id = v_buyer then
    raise exception 'OWN_MARKET: you cannot request a visit to your own Market'
      using errcode = 'P0001';
  end if;

  select ep.plan into v_plan from public.market_effective_plan(p_market) ep;
  if coalesce(v_plan, 'free'::public.market_plan) = 'free'::public.market_plan then
    raise exception 'SUBSCRIPTION_REQUIRED: visit scheduling is available for Pro and Farm Markets'
      using errcode = 'P0001';
  end if;

  select * into v_location
    from public.market_pickup_locations
   where market_id = p_market
     and is_default
     and active
     and not plan_restricted
   limit 1;
  if v_location is null then
    raise exception 'PICKUP_NOT_CONFIGURED' using errcode = 'P0001';
  end if;

  select true into v_slot_ok
    from public.location_available_slots(v_location.id, 21) slot
   where slot.slot_start = p_start and slot.slot_end = p_end
   limit 1;
  if not coalesce(v_slot_ok, false) then
    raise exception 'SLOT_UNAVAILABLE: pick one of the offered visit times'
      using errcode = 'P0001';
  end if;

  insert into public.market_orders (
    market_id,
    buyer_id,
    request_kind,
    requested_start,
    requested_end,
    timezone,
    buyer_note,
    pickup_location_id,
    pickup_location_name,
    pickup_location_type,
    fulfillment_type,
    subtotal_cents
  ) values (
    p_market,
    v_buyer,
    'VISIT',
    p_start,
    p_end,
    v_location.timezone,
    nullif(left(btrim(coalesce(p_note, '')), 500), ''),
    v_location.id,
    v_location.nickname,
    v_location.location_type,
    'pickup',
    0
  ) returning id into v_order;

  return v_order;
end;
$$;

revoke all on function public.create_market_visit_request(uuid, timestamptz, timestamptz, text)
  from public, anon;
grant execute on function public.create_market_visit_request(uuid, timestamptz, timestamptz, text)
  to authenticated;

-- public_markets is the web-safe storefront projection. The two additions are
-- aggregate/boolean values only; no follower identity, plan source, exact
-- location, or private contact data is exposed.
create or replace view public.public_markets as
select
  m.id,m.slug,m.name,m.description,m.market_type,m.status,m.avatar_url,m.banner_url,
  m.city,m.county,m.state,m.verified,m.sponsor_visible,m.website_url,
  m.instagram_url,m.facebook_url,m.created_at,m.created_at as member_since,
  (select count(*) from public.listings l where l.market_id=m.id and l.status='active'
    and l.expires_at>now() and l.listing_type<>'wanted') as active_listing_count,
  (select count(*) from public.listings l where l.market_id=m.id and l.status='completed'
    and l.listing_type='free') as listings_shared,
  (select count(*) from public.claims claim join public.listings l on l.id=claim.listing_id
    where l.market_id=m.id and claim.claim_type='purchase_request' and claim.status='completed') as listings_sold,
  (select count(*) from public.claims claim join public.listings l on l.id=claim.listing_id
    where l.market_id=m.id and claim.claim_type='trade_offer' and claim.status='completed') as trades_completed,
  response.response_rate,
  exists(select 1 from public.account_email_verification_proofs proof
    where proof.user_id=m.owner_id) as verified_email,
  m.tagline,m.theme,
  (select count(*)::integer from public.market_follows follow_row where follow_row.market_id=m.id) as follower_count,
  (
    coalesce((select ep.plan <> 'free'::public.market_plan
                from public.market_effective_plan(m.id) ep), false)
    and exists (
      select 1
        from public.market_pickup_locations location
        join public.market_pickup_hours hours on hours.location_id=location.id
       where location.market_id=m.id
         and location.is_default
         and location.active
         and not location.plan_restricted
    )
  ) as scheduling_enabled
from public.markets m
join public.profiles owner_profile on owner_profile.id=m.owner_id
left join lateral (
  select case when count(*)>=5 then round(100.0*count(*) filter(
    where claim.responded_at is not null and claim.responded_at<=claim.created_at+interval '48 hours')::numeric/count(*)::numeric)
    else null::numeric end as response_rate
  from public.claims claim
  join public.listings l on l.id=claim.listing_id
  where l.market_id=m.id and claim.status<>'cancelled'
) response on true
where m.status='active' and not coalesce(owner_profile.suspended,false);

grant select on public.public_markets to anon, authenticated;
alter view public.public_markets set (security_barrier = true);

-- The legacy single-location editors still write market_id. Attach newly
-- created windows/exceptions to the current default location so the newer
-- location_available_slots() engine sees them immediately.
create or replace function public.attach_default_pickup_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market uuid;
begin
  if new.location_id is null then
    select id, market_id into new.location_id, v_market
      from public.market_pickup_locations
     where market_id = new.market_id and is_default
     order by created_at
     limit 1;
    if new.location_id is null then
      raise exception 'PICKUP_NOT_CONFIGURED' using errcode = 'P0001';
    end if;
  else
    select market_id into v_market
      from public.market_pickup_locations
     where id = new.location_id;
  end if;
  if v_market is null or v_market is distinct from new.market_id then
    raise exception 'PICKUP_LOCATION_MARKET_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists market_pickup_hours_attach_default on public.market_pickup_hours;
create trigger market_pickup_hours_attach_default
  before insert or update of market_id, location_id on public.market_pickup_hours
  for each row execute function public.attach_default_pickup_location();

drop trigger if exists market_pickup_exceptions_attach_default on public.market_pickup_exceptions;
create trigger market_pickup_exceptions_attach_default
  before insert or update of market_id, location_id on public.market_pickup_exceptions
  for each row execute function public.attach_default_pickup_location();

-- Keep the default location's slot rules aligned with the existing cross-
-- platform settings editors. Address visibility remains explicit.
create or replace function public.sync_default_pickup_location_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.market_pickup_locations location
     set timezone = new.timezone,
         slot_minutes = new.slot_minutes,
         lead_time_minutes = new.lead_time_minutes,
         max_orders_per_slot = new.max_orders_per_slot,
         location_type = case new.location_type
           when 'PUBLIC_BUSINESS' then 'PUBLIC_BUSINESS'
           when 'CUSTOM_PICKUP_POINT' then 'CUSTOM_PICKUP_POINT'
           else 'PRIVATE_RESIDENCE'
         end,
         address_line = case
           when new.location_type = 'PUBLIC_BUSINESS' then new.public_address
           else location.address_line
         end,
         public_address_visible = new.location_type = 'PUBLIC_BUSINESS'
                                   and new.public_address is not null,
         updated_at = now()
   where location.market_id = new.market_id and location.is_default;
  return new;
end;
$$;

drop trigger if exists market_pickup_settings_sync_default on public.market_pickup_settings;
create trigger market_pickup_settings_sync_default
  after insert or update on public.market_pickup_settings
  for each row execute function public.sync_default_pickup_location_settings();

-- Backfill any schedule rows created by the legacy editors after 0052.
update public.market_pickup_hours hours
   set location_id = location.id
  from public.market_pickup_locations location
 where hours.location_id is null
   and location.market_id = hours.market_id
   and location.is_default;

update public.market_pickup_exceptions exception_row
   set location_id = location.id
  from public.market_pickup_locations location
 where exception_row.location_id is null
   and location.market_id = exception_row.market_id
   and location.is_default;

do $$
begin
  if exists (
    select 1 from public.market_pickup_hours where location_id is null
    union all
    select 1 from public.market_pickup_exceptions where location_id is null
  ) then
    raise exception 'paid_market_storefront_visits: schedule rows remain detached from pickup locations';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
