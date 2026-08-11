-- Gnome — expose taxonomy_node_id on the public web view.
--
-- The website is getting the app's category system (backend taxonomy tree +
-- subtree filtering) instead of the flat legacy `category` column. The tree
-- itself (marketplace_taxonomy_nodes) is already anon-readable; what the web
-- lacked was the listing's node pointer. taxonomy_node_id is a plain FK into
-- admin-managed reference data — no privacy dimension (unlike lat/lng or zip).
--
-- CREATE OR REPLACE VIEW only appends columns, so the column list below is the
-- LIVE production definition verbatim (0023/0034-era: is_demo, market_position,
-- market_featured included) with taxonomy_node_id appended at the end.

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
    l.is_demo,
    l.market_position,
    l.market_featured,
    l.taxonomy_node_id
  from public.listings l
  join public.markets m on m.id = l.market_id
  where l.status = 'active' and l.expires_at > now() and m.status = 'active';

grant select on public.public_listings to anon, authenticated;

notify pgrst, 'reload schema';
