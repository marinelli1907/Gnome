-- Gnome — label demonstration inventory honestly. Run after 0022.
--
-- Every current listing belongs to the @gnome.demo seed accounts; the public
-- site presented them as real neighborhood inventory. Additive fix: an
-- is_demo flag, backfilled from the demo accounts' ownership, exposed through
-- public_listings so the web can render "Preview listing" labels. New real
-- listings default to false and need no changes anywhere.
--
-- Reversible: drop column + recreate the 0020 view.

alter table public.listings
  add column if not exists is_demo boolean not null default false;

update public.listings l
set is_demo = true
from auth.users u
where u.id = l.owner_id and u.email like '%@gnome.demo';

-- Recreate the public view with the flag appended (CREATE OR REPLACE keeps
-- the existing column order; append-only, same as 0020).
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
    ) as has_active_promotion,
    l.approx_lat,
    l.approx_lng,
    l.is_demo
  from public.listings l
  join public.markets m on m.id = l.market_id
  where l.status = 'active' and l.expires_at > now() and m.status = 'active';

grant select on public.public_listings to anon, authenticated;

notify pgrst, 'reload schema';
