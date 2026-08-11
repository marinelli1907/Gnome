-- Gnome — expose inventory_count on the public web view (append-only, like
-- 0060). Multi-plot listings (0072) advertise "N plots available"; sale
-- listings can show remaining stock the same way. No privacy dimension.

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
    l.taxonomy_node_id,
    l.inventory_count
  from public.listings l
  join public.markets m on m.id = l.market_id
  where l.status = 'active' and l.expires_at > now() and m.status = 'active';

grant select on public.public_listings to anon, authenticated;

notify pgrst, 'reload schema';
