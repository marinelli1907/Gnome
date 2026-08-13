-- 0093 — markets: stop publishing exact location and seller contact details.
--
-- `markets` carries a TABLE-level SELECT grant, so every column is world-readable,
-- including lat, lng, zip, contact_email, contact_phone and pickup_instructions.
-- They are all NULL today only because no seller has filled them in — the moment
-- one does, their home coordinates and personal phone number become public. This
-- also contradicts the listings model, where exact lat/lng were deliberately
-- revoked and only approx_lat/approx_lng are published.
--
-- Same shape as 0059 (profiles.zip_code): drop the table-wide grant, then re-grant
-- every column EXCEPT the private ones. That is what makes a column added later
-- private by default instead of public by default.
--
-- pickup_instructions is included in the private set because the schema already
-- distinguishes it from public_pickup_note — the private one is the "come round
-- the back, the gate sticks" detail, meant for a confirmed buyer.

revoke select on public.markets from anon, authenticated;

grant select (
  id, owner_id, name, slug, description, market_type, plan, status,
  avatar_url, banner_url, city, county, state, approximate_location,
  website_url, instagram_url, facebook_url,
  accepts_free, accepts_trade, accepts_sales,
  public_pickup_note, verified, sponsor_visible,
  created_at, updated_at, tagline, theme, extra_pickup_locations
) on public.markets to anon, authenticated;

-- The owner still needs their whole row to edit it. Column grants are role-wide,
-- so the owner cannot simply be excepted — they authenticate as `authenticated`
-- like everyone else (the lesson from 0087). Hand it back through a definer RPC
-- pinned to auth.uid(), exactly as my_profile() does.
create or replace function public.my_market()
returns setof public.markets
language sql stable security definer set search_path = public as $$
  select m.* from public.markets m where m.owner_id = auth.uid();
$$;
revoke all on function public.my_market() from public, anon;
grant execute on function public.my_market() to authenticated;

-- Admins keep full access for moderation and support. is_admin() already reads
-- the active admin_users membership.
create or replace function public.admin_market(p_market uuid)
returns setof public.markets
language sql stable security definer set search_path = public as $$
  select m.* from public.markets m
   where m.id = p_market and public.is_admin();
$$;
revoke all on function public.admin_market(uuid) from public, anon;
grant execute on function public.admin_market(uuid) to authenticated;

-- Fail the migration rather than ship a half-applied grant.
do $$
declare leaked text;
begin
  select string_agg(c, ', ') into leaked from unnest(array[
    'lat','lng','zip','contact_email','contact_phone','pickup_instructions']) as c
   where has_column_privilege('anon', 'public.markets', c, 'SELECT')
      or has_column_privilege('authenticated', 'public.markets', c, 'SELECT');
  if leaked is not null then
    raise exception 'markets private columns still readable by a client role: %', leaked;
  end if;

  -- and the public ones must still work, or Browse breaks the way listings did
  select string_agg(c, ', ') into leaked from unnest(array[
    'id','name','slug','city','state','avatar_url','approximate_location','status']) as c
   where not has_column_privilege('anon', 'public.markets', c, 'SELECT');
  if leaked is not null then
    raise exception 'markets public columns lost their grant: %', leaked;
  end if;
end $$;

notify pgrst, 'reload schema';
