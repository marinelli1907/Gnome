-- Gnome — expose the privacy-safe coarse coordinates on the public web view.
--
-- approx_lat/approx_lng are the 0009 generated columns (rounded to 2 decimals,
-- ~0.7 mile cells) designed for public display; the app already shows them to
-- anonymous users. Adding them to public_listings lets the website do
-- browser-side "near me" radius filtering. Exact lat/lng stay locked (0010).
-- CREATE OR REPLACE VIEW only appends columns, so the existing column order is
-- preserved verbatim.

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
    l.approx_lng
  from public.listings l
  join public.markets m on m.id = l.market_id
  where l.status = 'active' and l.expires_at > now() and m.status = 'active';

grant select on public.public_listings to anon, authenticated;

notify pgrst, 'reload schema';
