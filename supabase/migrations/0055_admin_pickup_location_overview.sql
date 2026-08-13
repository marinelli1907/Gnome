-- 0055: admin visibility into pickup locations WITHOUT exact addresses.
--
-- Admins need to see how sellers are using the perk (type, active/restricted,
-- plan allowance, order usage) to support them and to spot abuse. They do not
-- need people's home addresses, so this deliberately returns the coarse
-- point and a has_address boolean instead of address_line — the column-level
-- revoke already blocks the raw table for every authenticated role, and this
-- RPC does not hand it back.
create or replace function public.admin_pickup_location_overview()
returns table(
  market_id uuid,
  market_name text,
  plan text,
  allowance int,
  location_id uuid,
  nickname text,
  location_type text,
  city text,
  state text,
  has_address boolean,
  public_address_visible boolean,
  approx_lat double precision,
  approx_lng double precision,
  active boolean,
  is_default boolean,
  plan_restricted boolean,
  schedule_windows int,
  orders_total bigint,
  orders_open bigint,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return query
    select m.id, m.name, m.plan::text,
           coalesce(pl.max_pickup_locations, 1),
           l.id, l.nickname, l.location_type, l.city, l.state,
           (l.address_line is not null),
           l.public_address_visible, l.approx_lat, l.approx_lng,
           l.active, l.is_default, l.plan_restricted,
           (select count(*)::int from public.market_pickup_hours h where h.location_id = l.id),
           (select count(*) from public.market_orders o where o.pickup_location_id = l.id),
           (select count(*) from public.market_orders o
             where o.pickup_location_id = l.id
               and o.status in ('REQUESTED','CONFIRMED','READY','TIME_PROPOSED')),
           l.created_at
      from public.market_pickup_locations l
      join public.markets m on m.id = l.market_id
      left join public.plan_limits pl on pl.plan = m.plan
     order by m.name, l.is_default desc, l.created_at;
end $$;
revoke all on function public.admin_pickup_location_overview() from public, anon;
grant execute on function public.admin_pickup_location_overview() to authenticated;