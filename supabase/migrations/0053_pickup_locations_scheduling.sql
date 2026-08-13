create or replace function public.location_available_slots(p_location uuid, p_days int default 10)
returns table(slot_start timestamptz, slot_end timestamptz, remaining int)
language plpgsql stable security definer set search_path = public as $$
declare
  loc public.market_pickup_locations;
  d int; w record; local_date date; slot_min int;
  v_start timestamptz; v_end timestamptz; taken int;
  has_exceptions boolean;
begin
  select * into loc from public.market_pickup_locations where id = p_location;
  if loc is null or not loc.active or loc.plan_restricted then return; end if;
  p_days := least(greatest(p_days, 1), 21);

  for d in 0..(p_days - 1) loop
    local_date := (now() at time zone loc.timezone)::date + d;
    if exists (select 1 from public.market_pickup_exceptions e
                where e.location_id = p_location and e.date = local_date and e.closed) then
      continue;
    end if;
    select exists (select 1 from public.market_pickup_exceptions e
                    where e.location_id = p_location and e.date = local_date and not e.closed)
      into has_exceptions;

    for w in
      select * from (
        select e.start_minute, e.end_minute
          from public.market_pickup_exceptions e
         where e.location_id = p_location and e.date = local_date and not e.closed and has_exceptions
        union all
        select h.start_minute, h.end_minute
          from public.market_pickup_hours h
         where h.location_id = p_location
           and h.weekday = extract(dow from local_date)::int
           and not has_exceptions
      ) windows order by start_minute
    loop
      slot_min := w.start_minute;
      while slot_min + loc.slot_minutes <= w.end_minute loop
        v_start := (local_date::timestamp + make_interval(mins => slot_min)) at time zone loc.timezone;
        v_end   := v_start + make_interval(mins => loc.slot_minutes);
        if v_start >= now() + make_interval(mins => loc.lead_time_minutes) then
          select count(*) into taken
            from public.market_orders o
           where o.pickup_location_id = p_location
             and o.status in ('REQUESTED','CONFIRMED','READY','TIME_PROPOSED')
             and coalesce(o.confirmed_start, o.requested_start) = v_start;
          if loc.max_orders_per_slot is null or taken < loc.max_orders_per_slot then
            slot_start := v_start; slot_end := v_end;
            remaining := case when loc.max_orders_per_slot is null then null
                              else loc.max_orders_per_slot - taken end;
            return next;
          end if;
        end if;
        slot_min := slot_min + loc.slot_minutes;
      end loop;
    end loop;
  end loop;
end $$;
revoke all on function public.location_available_slots(uuid, int) from public;
grant execute on function public.location_available_slots(uuid, int) to anon, authenticated;

create or replace function public.market_available_slots(p_market uuid, p_days int default 10)
returns table(slot_start timestamptz, slot_end timestamptz, remaining int)
language plpgsql stable security definer set search_path = public as $$
declare v_loc uuid;
begin
  select id into v_loc from public.market_pickup_locations
   where market_id = p_market and is_default and active and not plan_restricted;
  if v_loc is null then return; end if;
  return query select * from public.location_available_slots(v_loc, p_days);
end $$;
grant execute on function public.market_available_slots(uuid, int) to anon, authenticated;

create or replace function public.cart_pickup_locations(p_market uuid, p_listings uuid[])
returns table(location_id uuid, nickname text, location_type text,
              approx_lat double precision, approx_lng double precision, is_default boolean)
language sql stable security definer set search_path = public as $$
  with live as (
    select l.* from public.market_pickup_locations l
     where l.market_id = p_market and l.active and not l.plan_restricted
  ), per_listing as (
    select li.id as listing_id,
           coalesce(
             (select array_agg(lp.location_id) from public.listing_pickup_locations lp
               where lp.listing_id = li.id),
             (select array_agg(d.id) from live d where d.is_default)
           ) as allowed
      from public.listings li
     where li.id = any(p_listings)
  )
  select v.id, v.nickname, v.location_type, v.approx_lat, v.approx_lng, v.is_default
    from live v
   where not exists (
     select 1 from per_listing p
      where p.allowed is null or not (v.id = any(p.allowed))
   )
   order by v.is_default desc, v.nickname;
$$;
grant execute on function public.cart_pickup_locations(uuid, uuid[]) to anon, authenticated;

create or replace function public.create_market_order(
  p_market uuid, p_items jsonb, p_start timestamptz, p_end timestamptz,
  p_note text default null, p_location uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_buyer uuid := auth.uid();
  loc public.market_pickup_locations;
  v_order uuid; item jsonb; l record;
  v_qty numeric; v_subtotal int := 0; v_line int; v_ok boolean := false;
  v_ids uuid[];
begin
  if v_buyer is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  if exists (select 1 from public.markets m where m.id = p_market and m.owner_id = v_buyer) then
    raise exception 'OWN_MARKET: you cannot order from your own Market' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = 'P0001';
  end if;

  select array_agg((value->>'listing_id')::uuid) into v_ids
    from jsonb_array_elements(p_items);

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
     pickup_location_id, pickup_location_name, pickup_location_type)
  values (p_market, v_buyer, p_start, p_end, loc.timezone,
          nullif(btrim(coalesce(p_note,'')), ''),
          loc.id, loc.nickname, loc.location_type)
  returning id into v_order;

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
revoke all on function public.create_market_order(uuid, jsonb, timestamptz, timestamptz, text, uuid) from public, anon;
grant execute on function public.create_market_order(uuid, jsonb, timestamptz, timestamptz, text, uuid) to authenticated;

drop function if exists public.order_pickup_details(uuid);
create function public.order_pickup_details(p_order uuid)
returns table(address text, instructions text, location_type text, nickname text)
language plpgsql stable security definer set search_path = public as $$
declare o public.market_orders; v_is_owner boolean;
begin
  select * into o from public.market_orders where id = p_order;
  if o is null then return; end if;
  v_is_owner := exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid());
  if not v_is_owner and (o.buyer_id is distinct from auth.uid()
                         or o.status not in ('CONFIRMED','READY','COMPLETED')) then
    return;
  end if;
  return query
    select l.address_line, l.instructions, l.location_type,
           coalesce(o.pickup_location_name, l.nickname)
      from public.market_pickup_locations l
     where l.id = o.pickup_location_id;
end $$;
revoke all on function public.order_pickup_details(uuid) from public, anon;
grant execute on function public.order_pickup_details(uuid) to authenticated;

create or replace function public.public_pickup_locations(p_market uuid)
returns table(location_id uuid, nickname text, location_type text,
              public_address text, approx_lat double precision,
              approx_lng double precision, is_default boolean)
language sql stable security definer set search_path = public as $$
  select l.id, l.nickname, l.location_type,
         case when l.public_address_visible
                   and l.location_type in ('PUBLIC_FARM_STAND','PUBLIC_BUSINESS','PUBLIC_MEETUP_POINT')
              then l.address_line else null end,
         l.approx_lat, l.approx_lng, l.is_default
    from public.market_pickup_locations l
   where l.market_id = p_market and l.active and not l.plan_restricted
   order by l.is_default desc, l.nickname;
$$;
grant execute on function public.public_pickup_locations(uuid) to anon, authenticated;