-- 0127_hide_wanted_from_public.sql
--
-- Gnome does not launch with Wanted listings. This removes them from the two
-- PUBLIC read surfaces and nothing else.
--
-- WHAT THIS IS NOT: no rows are deleted or altered, the listing_type enum is
-- untouched, no table is dropped, no RLS policy is created, changed or
-- weakened, and no column is added or removed. Every historical Wanted row
-- stays exactly as it is and remains readable through the base `listings`
-- table by its owner and by admin tooling, whose access is governed by the
-- existing RLS policies this migration does not touch.
--
-- WHY A VIEW AND NOT A FILTER IN THE CLIENTS: public.public_listings is the
-- anon read boundary for the whole website, the sitemap and market drops.
-- Filtering in each client would leave the data itself still served, and would
-- have to be repeated correctly in every present and future caller.
--
-- CREATE OR REPLACE VIEW cannot reorder, rename, add or drop columns, so both
-- bodies below are the previous definitions reproduced verbatim — extracted
-- programmatically from 0121 and 0033 rather than retyped — with a single
-- added predicate each. That is the only semantic change.
--
-- ROLLBACK: re-run the `public_listings` body from
-- 0121_market_bundles.sql and the `public_markets` body from
-- 0033_storefront_views.sql. Both are plain CREATE OR REPLACE VIEW statements
-- with no dependants to drop, so rollback is a single re-apply with no data
-- implications.

-- ---------------------------------------------------------------------------
-- 1. public_listings — 0121's definition plus the Wanted exclusion.
-- ---------------------------------------------------------------------------
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
    (SELECT count(*)::int FROM listing_components c WHERE c.listing_id = l.id) AS component_count
   FROM listings l
     JOIN markets m ON m.id = l.market_id
  WHERE l.status = 'active'::listing_status AND l.expires_at > now() AND m.status = 'active'::market_status
    AND l.listing_type <> 'wanted'::listing_type
    AND (NOT l.is_bundle OR public.bundle_components_available(l.id));
grant select on public.public_listings to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. public_markets — 0033's definition. ONLY the active_listing_count
--    subquery changes: a Wanted post is not available inventory, and this
--    count also gates featured-market eligibility, so counting Wanted would
--    let a market with nothing actually for sale present as stocked.
--    listings_shared, listings_sold and trades_completed are claim-scoped and
--    are deliberately left byte-identical.
-- ---------------------------------------------------------------------------
create or replace view public.public_markets as
 SELECT m.id,
    m.slug,
    m.name,
    m.description,
    m.market_type,
    m.status,
    m.avatar_url,
    m.banner_url,
    m.city,
    m.county,
    m.state,
    m.verified,
    m.sponsor_visible,
    m.website_url,
    m.instagram_url,
    m.facebook_url,
    m.created_at,
    m.created_at AS member_since,
    ( SELECT count(*) AS count
           FROM listings l
          WHERE l.market_id = m.id AND l.status = 'active'::listing_status AND l.expires_at > now()
            AND l.listing_type <> 'wanted'::listing_type) AS active_listing_count,
    ( SELECT count(*) AS count
           FROM listings l
          WHERE l.market_id = m.id AND l.status = 'completed'::listing_status AND l.listing_type = 'free'::listing_type) AS listings_shared,
    ( SELECT count(*) AS count
           FROM claims c
             JOIN listings l ON l.id = c.listing_id
          WHERE l.market_id = m.id AND c.claim_type = 'purchase_request'::text AND c.status = 'completed'::claim_status) AS listings_sold,
    ( SELECT count(*) AS count
           FROM claims c
             JOIN listings l ON l.id = c.listing_id
          WHERE l.market_id = m.id AND c.claim_type = 'trade_offer'::text AND c.status = 'completed'::claim_status) AS trades_completed,
    rr.response_rate,
    (EXISTS ( SELECT 1
           FROM auth.users u
          WHERE u.id = m.owner_id AND u.email_confirmed_at IS NOT NULL)) AS verified_email,
    m.tagline,
    m.theme
   FROM markets m
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN count(*) >= 5 THEN round(100.0 * count(*) FILTER (WHERE c.responded_at IS NOT NULL AND c.responded_at <= (c.created_at + '48:00:00'::interval))::numeric / count(*)::numeric)
                    ELSE NULL::numeric
                END AS response_rate
           FROM claims c
             JOIN listings l ON l.id = c.listing_id
          WHERE l.market_id = m.id AND c.status <> 'cancelled'::claim_status) rr ON true
  WHERE m.status = 'active'::market_status;
grant select on public.public_markets to anon, authenticated;
