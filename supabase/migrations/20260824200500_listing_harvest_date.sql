-- Add a seller-entered picked/harvest date to listings.
--
-- NOTE: This migration must apply before any client release selects or writes
-- `harvest_date`; the mobile app reads `listings` with explicit column grants
-- and the website reads `public_listings`.

alter table public.listings
  add column if not exists harvest_date date;

comment on column public.listings.harvest_date is
  'Seller-entered date the listed item was picked or harvested. Null for wanted posts, plots, legacy rows, or non-harvest items.';

grant select (harvest_date) on public.listings to anon, authenticated;
grant insert (harvest_date), update (harvest_date) on public.listings to authenticated;

-- Rebuild the public website boundary with harvest_date appended. Appending
-- preserves the older CREATE OR REPLACE VIEW contract.
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
    l.request_options, l.allow_custom_request,
    l.is_bundle,
    (SELECT count(*)::int FROM listing_components c WHERE c.listing_id = l.id) AS component_count,
    l.harvest_date
   FROM listings l
     JOIN markets m ON m.id = l.market_id
  WHERE l.status = 'active'::listing_status AND l.expires_at > now() AND m.status = 'active'::market_status
    AND l.listing_type <> 'wanted'::listing_type
    AND (NOT l.is_bundle OR public.bundle_components_available(l.id));

grant select on public.public_listings to anon, authenticated;
