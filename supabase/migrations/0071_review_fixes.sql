-- Gnome — adversarial-review fixes (2026-08-10 round, 32-agent review).
--
-- 1) market_subscriptions.kind: 'plan' vs 'addon'. Add-on-only checkouts are
--    their own Stripe subscription; without a tracked row their later
--    updated/deleted events could never be mapped to a market (paid extras
--    were unrevokable), and plan-sub events were zeroing extras bought on a
--    separate sub. The webhook now writes addon rows with kind='addon' and
--    handles the two kinds independently.
-- 2) delivery_quote: OUT_OF_RANGE no longer discloses the measured distance —
--    repeated quotes from attacker-chosen addresses could trilaterate the
--    seller's private origin. Eligible quotes keep the distance (the seller
--    is delivering to that address anyway).
-- 3) create_market_order: (a) a weekly order-by deadline now also applies
--    when the requested day is tomorrow and accepted via the schedule;
--    (b) a same/next-day-only Market no longer silently accepts windows 2+
--    days out (the "any future window" fallback now requires NO timing modes).

alter table public.market_subscriptions
  add column if not exists kind text not null default 'plan'
    check (kind in ('plan','addon'));

create or replace function public.delivery_quote(p_market uuid, p_address uuid)
returns table (
  eligible boolean,
  reason text,
  distance_miles numeric,
  base_fee_cents int,
  surcharge_cents int,
  total_fee_cents int,
  rule jsonb
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  ds public.market_delivery_settings;
  addr public.buyer_delivery_addresses;
  o record;
  d double precision;
  v_sur int := 0;
begin
  select * into addr from public.buyer_delivery_addresses
   where id = p_address and buyer_id = auth.uid();
  if addr is null then
    return query select false, 'ADDRESS_NOT_FOUND', null::numeric, null::int, null::int, null::int, null::jsonb; return;
  end if;

  select * into ds from public.market_delivery_settings where market_id = p_market;
  if ds is null or not ds.enabled then
    return query select false, 'PICKUP_ONLY: This Market currently offers pickup only', null::numeric, null::int, null::int, null::int, null::jsonb; return;
  end if;

  if addr.lat is null or addr.lng is null then
    return query select false, 'ADDRESS_NOT_LOCATED: Save the address again so we can place it on the map', null::numeric, null::int, null::int, null::int, null::jsonb; return;
  end if;

  select * into o from public.market_delivery_origin(p_market);
  if o.lat is null or o.lng is null then
    return query select false, 'NO_ORIGIN: This Market has not set a delivery starting point', null::numeric, null::int, null::int, null::int, null::jsonb; return;
  end if;

  d := public.haversine_miles(o.lat, o.lng, addr.lat, addr.lng);

  if ds.radius_miles is null or d > ds.radius_miles then
    -- No distance on the rejection path: it would let crafted addresses
    -- trilaterate the private origin from outside the radius.
    return query select false, 'OUT_OF_RANGE: Outside this Market''s delivery area',
      null::numeric, null::int, null::int, null::int, null::jsonb; return;
  end if;

  if ds.surcharge_after_miles is not null and d > ds.surcharge_after_miles then
    v_sur := coalesce(ds.surcharge_fee_cents, 0);
  end if;

  return query select
    true, null::text,
    round(d::numeric, 1),
    ds.flat_fee_cents,
    v_sur,
    ds.flat_fee_cents + v_sur,
    jsonb_build_object(
      'radius_miles', ds.radius_miles,
      'flat_fee_cents', ds.flat_fee_cents,
      'surcharge_after_miles', ds.surcharge_after_miles,
      'surcharge_fee_cents', ds.surcharge_fee_cents,
      'same_day', ds.same_day, 'same_day_cutoff', ds.same_day_cutoff,
      'next_day', ds.next_day, 'next_day_cutoff', ds.next_day_cutoff,
      'scheduled', ds.scheduled, 'order_by_dow', ds.order_by_dow,
      'delivery_dows', ds.delivery_dows, 'tz', ds.tz,
      'version', ds.updated_at);
end $$;

create or replace function public.create_market_order(
  p_market uuid,
  p_items jsonb,
  p_start timestamptz,
  p_end timestamptz,
  p_note text default null,
  p_location uuid default null,
  p_fulfillment text default 'pickup',
  p_address uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_buyer uuid := auth.uid();
  loc public.market_pickup_locations;
  addr public.buyer_delivery_addresses;
  q record; ds public.market_delivery_settings;
  v_order uuid; item jsonb; l record;
  v_qty numeric; v_subtotal int := 0; v_line int; v_ok boolean := false;
  v_ids uuid[];
  v_tz text;
begin
  if v_buyer is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  if p_fulfillment not in ('pickup','delivery') then
    raise exception 'BAD_FULFILLMENT' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.markets m where m.id = p_market and m.owner_id = v_buyer) then
    raise exception 'OWN_MARKET: you cannot order from your own Market' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = 'P0001';
  end if;

  select array_agg((value->>'listing_id')::uuid) into v_ids
    from jsonb_array_elements(p_items);

  if p_fulfillment = 'pickup' then
    if p_location is null then
      select id into p_location from public.market_pickup_locations
       where market_id = p_market and is_default and active and not plan_restricted;
    end if;
    if p_location is null then raise exception 'PICKUP_NOT_CONFIGURED' using errcode = 'P0001'; end if;

    if not exists (select 1 from public.cart_pickup_locations(p_market, v_ids) c
                    where c.location_id = p_location) then
      raise exception 'NO_COMMON_PICKUP_LOCATION: these items aren''t available for pickup at the same location'
        using errcode = 'P0001';
    end if;

    select * into loc from public.market_pickup_locations where id = p_location;

    select true into v_ok from public.location_available_slots(p_location, 21) a
     where a.slot_start = p_start and a.slot_end = p_end limit 1;
    if not coalesce(v_ok, false) then
      raise exception 'SLOT_UNAVAILABLE: pick one of the offered pickup times' using errcode = 'P0001';
    end if;

    insert into public.market_orders
      (market_id, buyer_id, requested_start, requested_end, timezone, buyer_note,
       pickup_location_id, pickup_location_name, pickup_location_type, fulfillment_type)
    values (p_market, v_buyer, p_start, p_end, loc.timezone,
            nullif(btrim(coalesce(p_note,'')), ''),
            loc.id, loc.nickname, loc.location_type, 'pickup')
    returning id into v_order;

  else -- delivery
    if p_address is null then raise exception 'ADDRESS_REQUIRED' using errcode = 'P0001'; end if;
    select * into addr from public.buyer_delivery_addresses
     where id = p_address and buyer_id = v_buyer;
    if addr is null then raise exception 'ADDRESS_NOT_FOUND' using errcode = 'P0001'; end if;

    -- Authoritative quote (never the client's math).
    select * into q from public.delivery_quote(p_market, p_address);
    if not q.eligible then
      raise exception 'DELIVERY_INELIGIBLE: %', coalesce(q.reason, 'not available') using errcode = 'P0001';
    end if;

    select * into ds from public.market_delivery_settings where market_id = p_market;
    v_tz := coalesce(ds.tz, 'America/New_York');

    -- Requested-window validation against the seller's timing rules.
    -- No timing mode enabled → any future window; exact day is arranged in
    -- the existing propose/confirm negotiation, like pickup.
    if p_start is null or p_end is null or p_end <= p_start then
      raise exception 'BAD_WINDOW' using errcode = 'P0001';
    end if;
    if (p_start at time zone v_tz)::date = (now() at time zone v_tz)::date then
      -- same-day request
      if not ds.same_day then
        raise exception 'SAME_DAY_UNAVAILABLE: this Market does not offer same-day delivery' using errcode = 'P0001';
      end if;
      if ds.same_day_cutoff is not null and (now() at time zone v_tz)::time > ds.same_day_cutoff then
        raise exception 'CUTOFF_PASSED: same-day orders close at %', to_char(ds.same_day_cutoff, 'HH12:MI AM') using errcode = 'P0001';
      end if;
    elsif (p_start at time zone v_tz)::date = (now() at time zone v_tz)::date + 1 then
      -- next-day request (also satisfied by a weekly schedule that covers it —
      -- but the schedule's order-by deadline applies either way)
      if ds.scheduled and extract(dow from p_start at time zone v_tz)::int = any(ds.delivery_dows) then
        if ds.order_by_dow is not null
           and (now() at time zone v_tz)::date >
               ((p_start at time zone v_tz)::date
                 - ((7 + extract(dow from p_start at time zone v_tz)::int - ds.order_by_dow) % 7))
           and not ds.next_day then
          raise exception 'ORDER_BY_PASSED: order by % for that delivery day',
            trim(to_char(((p_start at time zone v_tz)::date - ((7 + extract(dow from p_start at time zone v_tz)::int - ds.order_by_dow) % 7)), 'Day')) using errcode = 'P0001';
        end if;
      elsif not ds.next_day then
        raise exception 'NEXT_DAY_UNAVAILABLE: this Market does not offer next-day delivery' using errcode = 'P0001';
      end if;
      if ds.next_day and ds.next_day_cutoff is not null
         and not (ds.scheduled and extract(dow from p_start at time zone v_tz)::int = any(ds.delivery_dows))
         and (now() at time zone v_tz)::time > ds.next_day_cutoff then
        raise exception 'CUTOFF_PASSED: next-day orders close at %', to_char(ds.next_day_cutoff, 'HH12:MI AM') using errcode = 'P0001';
      end if;
    elsif ds.scheduled then
      if not (extract(dow from p_start at time zone v_tz)::int = any(ds.delivery_dows)) then
        raise exception 'NOT_A_DELIVERY_DAY: this Market delivers on scheduled days only' using errcode = 'P0001';
      end if;
      if ds.order_by_dow is not null then
        -- order-by day must not already be past in the current week window
        if (now() at time zone v_tz)::date >
           ((p_start at time zone v_tz)::date
             - ((7 + extract(dow from p_start at time zone v_tz)::int - ds.order_by_dow) % 7)) then
          raise exception 'ORDER_BY_PASSED: order by % for that delivery day',
            trim(to_char(((p_start at time zone v_tz)::date - ((7 + extract(dow from p_start at time zone v_tz)::int - ds.order_by_dow) % 7)), 'Day')) using errcode = 'P0001';
        end if;
      end if;
    elsif ds.same_day or ds.next_day then
      -- same/next-day-only Market: a window 2+ days out has no valid mode
      raise exception 'NOT_A_DELIVERY_DAY: this Market offers same-day or next-day delivery only' using errcode = 'P0001';
    end if;
    if p_start < now() then
      raise exception 'BAD_WINDOW: that time is in the past' using errcode = 'P0001';
    end if;

    -- Item-level compliance: active pickup-only rules refuse delivery.
    if exists (
      select 1 from jsonb_array_elements(p_items) x
      join public.listings li on li.id = (x->>'listing_id')::uuid
      where li.taxonomy_node_id is not null
        and not public.delivery_allowed_for_node(li.taxonomy_node_id)
    ) then
      raise exception 'DELIVERY_RESTRICTED: an item in this order is pickup-only' using errcode = 'P0001';
    end if;

    insert into public.market_orders
      (market_id, buyer_id, requested_start, requested_end, timezone, buyer_note,
       fulfillment_type, delivery_address_id,
       delivery_address, delivery_city, delivery_state, delivery_postal_code, delivery_notes,
       delivery_distance_miles, delivery_base_fee_cents, delivery_surcharge_cents,
       delivery_fee_cents, delivery_rule)
    values (p_market, v_buyer, p_start, p_end, v_tz,
            nullif(btrim(coalesce(p_note,'')), ''),
            'delivery', addr.id,
            addr.address_line, addr.city, addr.state, addr.postal_code, addr.delivery_notes,
            q.distance_miles, q.base_fee_cents, q.surcharge_cents, q.total_fee_cents, q.rule)
    returning id into v_order;
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((item->>'quantity')::numeric, 1);
    if v_qty <= 0 then raise exception 'BAD_QUANTITY' using errcode = 'P0001'; end if;
    select id, title, unit, price_cents, market_id, status, taxonomy_node_id
      into l from public.listings where id = (item->>'listing_id')::uuid;
    if l is null or l.market_id is distinct from p_market then
      raise exception 'ITEM_NOT_IN_MARKET' using errcode = 'P0001';
    end if;
    if l.status <> 'active' then
      raise exception 'ITEM_UNAVAILABLE: %', l.title using errcode = 'P0001';
    end if;
    v_line := coalesce(l.price_cents, 0) * v_qty;
    v_subtotal := v_subtotal + v_line;
    insert into public.market_order_items
      (order_id, listing_id, title, unit, quantity, unit_price_cents, item_total_cents, taxonomy_node_id)
    values (v_order, l.id, l.title, l.unit, v_qty, coalesce(l.price_cents, 0), v_line, l.taxonomy_node_id);
  end loop;

  update public.market_orders set subtotal_cents = v_subtotal, updated_at = now()
   where id = v_order;
  return v_order;
end $$;


notify pgrst, 'reload schema';
