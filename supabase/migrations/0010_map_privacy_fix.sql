-- Gnome — M6 privacy FIX. Run after 0001–0009.
-- 0009 used `revoke select (lat,lng)`, but Supabase grants TABLE-level SELECT to
-- anon/authenticated, and a column-level revoke does NOT override a table grant —
-- so exact lat/lng were still readable. Correct approach: drop the table-level
-- SELECT grant, then grant SELECT on every column EXCEPT lat/lng.
--
-- Column list verified against the live schema (information_schema-equivalent:
-- keys of select=* on listings, 39 columns) — lat + lng excluded, 37 granted.
-- service_role / postgres keep full access (notify matching reads exact coords).
-- INSERT/UPDATE are unaffected by a SELECT revoke, so owners still post coords.

-- 1) Drop the broad table-level SELECT grant (this is what kept lat/lng readable).
revoke select on public.listings from anon, authenticated;

-- 2) Re-grant SELECT on every column EXCEPT lat, lng.
grant select (
  id,
  owner_id,
  market_id,
  title,
  description,
  category,
  quantity,
  photos,
  status,
  created_at,
  expires_at,
  kind,
  fulfilled_by_listing_id,
  listing_type,
  price_cents,
  currency,
  trade_for,
  unit,
  inventory_count,
  allow_partial_claim,
  fulfillment_type,
  payment_status,
  seller_note,
  buyer_note_required,
  is_featured,
  featured_until,
  view_count,
  claim_count,
  weight_estimate,
  organic_flag,
  delivery_available,
  city,
  county,
  state,
  zip,
  approx_lat,
  approx_lng
) on public.listings to anon, authenticated;

-- 3) Refresh PostgREST's schema cache.
notify pgrst, 'reload schema';
