-- Gnome — buyer ordering learns delivery (2026-08-10).
--
-- DELIVERY ORIGIN MODEL (Part 11 decision, Option A — simplest safe): the
-- Market's DEFAULT active pickup location is its delivery origin; a Market
-- with no pickup locations falls back to its own private lat/lng. One origin
-- per Market. Browse's median-of-listings distance is never used here.
--
-- PRIVACY MODEL: browse distance uses public approx coords; delivery
-- eligibility/fees use PRIVATE coords (seller origin + buyer address) inside
-- SECURITY DEFINER functions only. No RPC in this file returns a coordinate.
--
-- SNAPSHOT MODEL (Part 13): the order row freezes address text, fee
-- breakdown, distance, and the delivery rule used. Seller setting changes
-- never rewrite old orders.

-- ---------------------------------------------------------------------------
-- Order columns (additive)
-- ---------------------------------------------------------------------------
alter table public.market_orders
  add column if not exists fulfillment_type text not null default 'pickup'
    check (fulfillment_type in ('pickup','delivery')),
  add column if not exists delivery_address_id uuid references public.buyer_delivery_addresses(id) on delete set null,
  add column if not exists delivery_address text,
  add column if not exists delivery_city text,
  add column if not exists delivery_state text,
  add column if not exists delivery_postal_code text,
  add column if not exists delivery_notes text,
  add column if not exists delivery_distance_miles numeric(5,1),
  add column if not exists delivery_base_fee_cents integer,
  add column if not exists delivery_surcharge_cents integer,
  add column if not exists delivery_fee_cents integer,
  add column if not exists delivery_rule jsonb;

-- Sales Notebook: delivery fee is its own line so item revenue and delivery
-- revenue never blur (Part 17).
alter table public.seller_transactions
  add column if not exists delivery_fee_cents integer not null default 0;

-- The buyer-address snapshot must never leak through the table read path:
-- buyers and sellers both SELECT market_orders under RLS, which is correct
-- for fee totals, but the address text goes through order_delivery_details()
-- so the "seller only after confirmation" rule is enforceable. Withhold the
-- address columns at the grant level (0054/0059 pattern).
revoke select on public.market_orders from anon, authenticated;
grant select (
  id, market_id, buyer_id, status,
  requested_start, requested_end, confirmed_start, confirmed_end,
  proposed_start, proposed_end, timezone, subtotal_cents,
  buyer_note, decline_reason, created_at, updated_at,
  pickup_location_id, pickup_location_name, pickup_location_type,
  fulfillment_type, delivery_distance_miles,
  delivery_base_fee_cents, delivery_surcharge_cents, delivery_fee_cents
) on public.market_orders to authenticated;

-- ---------------------------------------------------------------------------
-- Compliance: a delivery order refuses items whose ACTIVE rule says
-- pickup-only. Convention: compliance_rules.pickup_policy = 'PICKUP_ONLY'
-- (rule must be review_status='active'). No active rule → current policy
-- (allowed). Checks the item's node and every ancestor by path.
-- ---------------------------------------------------------------------------
create or replace function public.delivery_allowed_for_node(p_node uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select not exists (
    select 1
      from public.marketplace_taxonomy_nodes child
      join public.marketplace_taxonomy_nodes anc
        on child.path = anc.path or child.path like anc.path || '/%'
      join public.compliance_rules r
        on r.taxonomy_node_id = anc.id
     where child.id = p_node
       and r.review_status = 'active'
       and upper(coalesce(r.pickup_policy, '')) = 'PICKUP_ONLY'
  );
$$;

-- ---------------------------------------------------------------------------
-- Private delivery origin (server-side only; never exposed via API)
-- ---------------------------------------------------------------------------
create or replace function public.market_delivery_origin(p_market uuid)
returns table (lat double precision, lng double precision)
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(l.lat, m.lat), coalesce(l.lng, m.lng)
    from public.markets m
    left join public.market_pickup_locations l
      on l.market_id = m.id and l.is_default and l.active and not l.plan_restricted
   where m.id = p_market;
$$;

create or replace function public.haversine_miles(
  a_lat double precision, a_lng double precision,
  b_lat double precision, b_lng double precision
) returns double precision
language sql immutable
as $$
  select 2 * 3958.8 * asin(sqrt(
    sin(radians(b_lat - a_lat) / 2) ^ 2 +
    cos(radians(a_lat)) * cos(radians(b_lat)) * sin(radians(b_lng - a_lng) / 2) ^ 2
  ));
$$;

-- ---------------------------------------------------------------------------
-- Authoritative quote: eligibility + fee. Client shows it; create_market_order
-- re-runs it — the client number is never trusted.
-- ---------------------------------------------------------------------------
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
    return query select false, 'OUT_OF_RANGE: Outside this Market''s delivery area',
      round(d::numeric, 1), null::int, null::int, null::int, null::jsonb; return;
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

grant execute on function public.delivery_quote(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- One canonical create_market_order (the 0048/0053 overloads are folded in;
-- both old call shapes still resolve here via the defaulted parameters —
-- there has never been a released app build, only dev clients).
-- ---------------------------------------------------------------------------
drop function if exists public.create_market_order(uuid, jsonb, timestamptz, timestamptz, text);
drop function if exists public.create_market_order(uuid, jsonb, timestamptz, timestamptz, text, uuid);

create function public.create_market_order(
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
      -- next-day request (also satisfied by a weekly schedule that covers it)
      if not ds.next_day and not (ds.scheduled and extract(dow from p_start at time zone v_tz)::int = any(ds.delivery_dows)) then
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

grant execute on function public.create_market_order(uuid, jsonb, timestamptz, timestamptz, text, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Seller marks a delivery on its way (CONFIRMED/READY → OUT_FOR_DELIVERY).
-- Pickup orders never enter this state.
-- ---------------------------------------------------------------------------
create or replace function public.mark_out_for_delivery(p_order uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare o public.market_orders;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if o.fulfillment_type <> 'delivery' then
    raise exception 'NOT_A_DELIVERY: pickup orders cannot go out for delivery' using errcode = 'P0001';
  end if;
  if o.status not in ('CONFIRMED','READY') then
    raise exception 'BAD_STATE: % order cannot go out for delivery', o.status using errcode = 'P0001';
  end if;
  update public.market_orders set status = 'OUT_FOR_DELIVERY', updated_at = now() where id = p_order;
end $$;

grant execute on function public.mark_out_for_delivery(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Address release: the buyer always sees their own; the SELLER sees the
-- snapshot only once the order is CONFIRMED or later. Before that a delivery
-- request shows city + distance, not the door.
-- ---------------------------------------------------------------------------
create or replace function public.order_delivery_details(p_order uuid)
returns table (
  order_id uuid,
  fulfillment_type text,
  delivery_address text,
  delivery_city text,
  delivery_state text,
  delivery_postal_code text,
  delivery_notes text,
  delivery_distance_miles numeric,
  delivery_base_fee_cents int,
  delivery_surcharge_cents int,
  delivery_fee_cents int,
  subtotal_cents int,
  total_cents int
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  o public.market_orders;
  v_is_buyer boolean;
  v_is_seller boolean;
  v_released boolean;
begin
  select * into o from public.market_orders where id = p_order;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  v_is_buyer := o.buyer_id = auth.uid();
  v_is_seller := exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid());
  if not (v_is_buyer or v_is_seller) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  v_released := v_is_buyer or o.status in ('CONFIRMED','READY','OUT_FOR_DELIVERY','COMPLETED');

  return query select
    o.id, o.fulfillment_type,
    case when v_released then o.delivery_address else null end,
    o.delivery_city, o.delivery_state,
    case when v_released then o.delivery_postal_code else null end,
    case when v_released then o.delivery_notes else null end,
    o.delivery_distance_miles,
    o.delivery_base_fee_cents, o.delivery_surcharge_cents, o.delivery_fee_cents,
    o.subtotal_cents,
    o.subtotal_cents + coalesce(o.delivery_fee_cents, 0);
end $$;

grant execute on function public.order_delivery_details(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Completion: delivery orders may complete from OUT_FOR_DELIVERY too, and the
-- Sales Notebook line records the delivery fee separately from item revenue.
-- ---------------------------------------------------------------------------
create or replace function public.complete_market_order(
  p_order uuid,
  p_record_payment boolean default false,
  p_method text default 'cash',
  p_amount_cents integer default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  o public.market_orders; v_txn uuid; v_items int; v_qty numeric;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select id into v_txn from public.seller_transactions
   where order_id = p_order and status = 'completed' limit 1;
  if o.status = 'COMPLETED' then
    if not p_record_payment or v_txn is not null then return v_txn; end if;
  elsif o.status not in ('CONFIRMED','READY','OUT_FOR_DELIVERY') then
    raise exception 'BAD_STATE: % order cannot be completed', o.status using errcode = 'P0001';
  end if;

  update public.market_orders set status = 'COMPLETED', updated_at = now()
   where id = p_order and status <> 'COMPLETED';

  if p_record_payment and v_txn is null then
    if p_method not in ('cash','venmo','zelle','cashapp','check','external_card','other','paypal') then
      raise exception 'BAD_METHOD' using errcode = 'P0001';
    end if;
    select count(*), coalesce(sum(quantity), 0) into v_items, v_qty
      from public.market_order_items where order_id = p_order;
    insert into public.seller_transactions
      (market_id, listing_id, claim_id, order_id, source, quantity,
       gross_cents, discount_cents, fee_cents, delivery_fee_cents,
       payment_method, buyer_label, notes, status)
    values
      (o.market_id, null, null, p_order, 'request', v_qty,
       coalesce(p_amount_cents, o.subtotal_cents + coalesce(o.delivery_fee_cents, 0)),
       0, 0, coalesce(o.delivery_fee_cents, 0),
       case when p_method = 'paypal' then 'other' else p_method end,
       null,
       case when o.fulfillment_type = 'delivery'
            then 'Market delivery order (' || v_items || ' items)'
            else 'Market pickup order (' || v_items || ' items)' end,
       'completed')
    returning id into v_txn;
  end if;
  return v_txn;
end $$;

notify pgrst, 'reload schema';
