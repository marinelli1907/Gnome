-- Gnome — plan security + single entitlements source (2026-08-10).
--
-- SECURITY FIX (pre-existing, found in this round's audit): markets and
-- profiles carried table-wide UPDATE grants, so with the owner/self RLS
-- policies any owner could PATCH privileged columns on their own row:
--   markets:  plan, verified, status, extra_pickup_locations, owner_id
--   profiles: can_* capability flags, suspended
-- A free seller could self-upgrade to farm; a suspended user could
-- un-suspend themselves. Same class of bug as 0054/0059 (grants are
-- table-wide by default) — fixed the proven way: revoke the table grant,
-- re-grant only the columns client flows legitimately write. Service role
-- (webhook, admin tooling) is unaffected.
--
-- SINGLE SOURCE OF TRUTH: plan_limits is the plan configuration; the
-- resolver below is the one place plan + subscription + add-ons combine
-- into effective entitlements. Clients render from it; triggers enforce
-- from the same underlying rows.

-- ---------------------------------------------------------------------------
-- markets: client may edit its storefront, never its entitlements.
-- ---------------------------------------------------------------------------
revoke update on public.markets from anon, authenticated;
grant update (
  name, slug, description, market_type, avatar_url, banner_url,
  city, county, state, zip, lat, lng, approximate_location,
  contact_email, contact_phone, website_url, instagram_url, facebook_url,
  accepts_free, accepts_trade, accepts_sales,
  pickup_instructions, public_pickup_note, sponsor_visible,
  tagline, theme, updated_at
) on public.markets to authenticated;

revoke insert on public.markets from anon, authenticated;
grant insert (
  owner_id, name, slug, description, market_type, avatar_url, banner_url,
  city, county, state, zip, lat, lng, approximate_location,
  contact_email, contact_phone, website_url, instagram_url, facebook_url,
  accepts_free, accepts_trade, accepts_sales,
  pickup_instructions, public_pickup_note, sponsor_visible,
  tagline, theme
) on public.markets to authenticated;
-- plan/status/verified/extra_pickup_locations fall to their defaults
-- ('free' / 'active' / false / 0) on insert and only the service role
-- (Stripe webhook, admin) can change them afterward.

-- ---------------------------------------------------------------------------
-- profiles: self-describing fields stay editable; moderation and
-- capability flags do not.
-- ---------------------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;
grant update (
  name, avatar_url, zip_code, city, county, state,
  user_type, business_account, business_category
) on public.profiles to authenticated;

-- The web Admin Center used to PATCH profiles.suspended directly; with the
-- column grant gone that moves behind an is_admin()-gated definer RPC (which
-- is also what stops a suspended user from un-suspending themselves).
create or replace function public.admin_set_suspended(p_user uuid, p_suspended boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  update public.profiles set suspended = p_suspended where id = p_user;
end $$;

grant execute on function public.admin_set_suspended(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Entitlements resolver — plan + latest subscription + purchased add-ons
-- in one row. This is what "what am I allowed?" means everywhere.
-- ---------------------------------------------------------------------------
create or replace function public.my_plan_entitlements()
returns table (
  market_id uuid,
  plan market_plan,
  plan_price_cents int,
  subscription_status text,          -- null when no billing record (e.g. free)
  max_active_listings int,           -- null = unlimited
  active_listings int,
  max_pickup_locations int,          -- included with the plan
  extra_location_fee_cents int,      -- null = add-ons not offered on this plan
  extra_pickup_locations int,        -- purchased add-on slots (webhook-set)
  effective_pickup_locations int,    -- included + purchased, the enforced cap
  delivery_advanced boolean          -- surcharges/scheduling (paid plans)
)
language sql
stable security definer
set search_path to 'public'
as $$
  select
    m.id,
    m.plan,
    pl.price_cents,
    (select s.status from public.market_subscriptions s
      where s.market_id = m.id order by s.created_at desc limit 1),
    pl.max_active_listings,
    public.market_active_listing_count(m.id),
    pl.max_pickup_locations,
    pl.extra_location_fee_cents,
    m.extra_pickup_locations,
    public.market_pickup_location_allowance(m.id),
    m.plan <> 'free'
  from public.markets m
  join public.plan_limits pl on pl.plan = m.plan
  where m.owner_id = auth.uid()
  limit 1;
$$;

grant execute on function public.my_plan_entitlements() to authenticated;

notify pgrst, 'reload schema';
