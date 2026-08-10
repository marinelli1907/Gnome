-- 0054: actually withhold the exact address/coords on pickup locations.
--
-- 0052 granted the safe columns but never revoked the table-wide SELECT that
-- Supabase's default privileges hand to anon/authenticated on every new table,
-- so address_line/lat/lng stayed readable. Same lesson as listings.lat/lng in
-- 0009: you must REVOKE, not merely grant a narrower set. Found by the live
-- security test, not by reading the code.
revoke select on public.market_pickup_locations from anon, authenticated;
grant select (id, market_id, nickname, location_type, city, state, postal_code,
              approx_lat, approx_lng, public_address_visible, timezone,
              slot_minutes, lead_time_minutes, max_orders_per_slot,
              active, is_default, plan_restricted, created_at, updated_at)
  on public.market_pickup_locations to anon, authenticated;

-- The owner still needs their own exact address to edit it. Pinned to
-- auth.uid() server-side, same shape as my_profile().
-- NOTE for clients: because SELECT on address_line/lat/lng is revoked, an
-- insert/update with `Prefer: return=representation` (PostgREST .select())
-- fails with 42501. Use return=minimal and read back via this RPC.
create or replace function public.my_pickup_locations(p_market uuid)
returns setof public.market_pickup_locations
language sql stable security definer set search_path = public as $$
  select l.* from public.market_pickup_locations l
   where l.market_id = p_market
     and exists (select 1 from public.markets m
                  where m.id = l.market_id and m.owner_id = auth.uid())
   order by l.is_default desc, l.created_at;
$$;
revoke all on function public.my_pickup_locations(uuid) from public, anon;
grant execute on function public.my_pickup_locations(uuid) to authenticated;
