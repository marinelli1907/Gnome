-- Gnome — M8 Public Website data layer. Run after 0001–0011.
-- The website reads ONLY the three public_* views below (never the base tables),
-- so private fields (exact lat/lng, phone/email, pickup instructions, seller/
-- buyer notes, claims, messages, plan/subscription/boost data) are unreachable.
-- The M6/M10 column lock on listings.lat/lng stays intact.

-- ---------------------------------------------------------------------------
-- 1) listings.slug (cosmetic; id stays canonical in /listing/[slug]-[id]).
-- ---------------------------------------------------------------------------
alter table public.listings add column if not exists slug text;
update public.listings set slug = public.gnome_slugify(title) where slug is null;

create or replace function public.set_listing_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug is null or btrim(new.slug) = '' then
    new.slug := public.gnome_slugify(new.title);
  end if;
  return new;
end;
$$;

drop trigger if exists set_listing_slug on public.listings;
create trigger set_listing_slug
  before insert or update on public.listings
  for each row execute function public.set_listing_slug();

-- ---------------------------------------------------------------------------
-- 2) Public read views (owner-defined => run with owner privileges; anon only
--    needs SELECT on the view and can never reach excluded base columns).
--    Each view restricts to ACTIVE, public-safe rows.
-- ---------------------------------------------------------------------------
create or replace view public.public_markets as
  select
    m.id, m.slug, m.name, m.description, m.market_type, m.status,
    m.avatar_url, m.banner_url, m.city, m.county, m.state,
    m.verified, m.sponsor_visible, m.website_url, m.instagram_url, m.facebook_url,
    m.created_at,
    (select count(*) from public.listings l
       where l.market_id = m.id and l.status = 'active' and l.expires_at > now())
      as active_listing_count
  from public.markets m
  where m.status = 'active';

create or replace view public.public_listings as
  select
    l.id, l.slug, l.title, l.description, l.category, l.listing_type, l.status,
    l.price_cents, l.currency, l.trade_for, l.quantity, l.unit, l.photos,
    l.city, l.county, l.state, l.fulfillment_type,
    l.market_id,
    m.name as market_name, m.slug as market_slug, m.avatar_url as market_avatar_url,
    m.market_type as market_type, m.verified as market_verified,
    l.created_at, l.expires_at, l.is_featured, l.featured_until,
    exists (
      select 1 from public.listing_promotions p
      where p.listing_id = l.id and p.status = 'active' and p.ends_at > now()
    ) as has_active_promotion
  from public.listings l
  join public.markets m on m.id = l.market_id
  where l.status = 'active' and l.expires_at > now() and m.status = 'active';

create or replace view public.public_active_promotions as
  select p.id, p.listing_id, p.market_id, p.starts_at, p.ends_at
  from public.listing_promotions p
  where p.status = 'active' and p.ends_at > now();

-- ---------------------------------------------------------------------------
-- Grant read on the views only. (Base-table column lock from 0010 stays — anon
-- still cannot select listings.lat/lng directly.)
-- ---------------------------------------------------------------------------
grant select on public.public_markets           to anon, authenticated;
grant select on public.public_listings          to anon, authenticated;
grant select on public.public_active_promotions to anon, authenticated;

notify pgrst, 'reload schema';
