-- expose request_options + allow_custom_request on the public listings view so
-- web plot-reserve can show grower-supported crops. Additive (columns appended).
create or replace view public.public_listings as
 SELECT l.id, l.slug, l.title, l.description, l.category, l.listing_type, l.status,
    l.price_cents, l.currency, l.trade_for, l.quantity, l.unit, l.photos, l.city,
    l.county, l.state, l.fulfillment_type, l.market_id,
    m.name AS market_name, m.slug AS market_slug, m.avatar_url AS market_avatar_url,
    m.market_type, m.verified AS market_verified, l.created_at, l.expires_at,
    l.is_featured, l.featured_until,
    (EXISTS ( SELECT 1 FROM listing_promotions p
              WHERE p.listing_id = l.id AND p.status = 'active'::promotion_status AND p.ends_at > now())) AS has_active_promotion,
    l.approx_lat, l.approx_lng, l.is_demo, l.market_position, l.market_featured,
    l.taxonomy_node_id, l.inventory_count,
    l.request_options, l.allow_custom_request
   FROM listings l
     JOIN markets m ON m.id = l.market_id
  WHERE l.status = 'active'::listing_status AND l.expires_at > now() AND m.status = 'active'::market_status;