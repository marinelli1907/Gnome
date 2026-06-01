-- Gnome — M6 Map Discovery privacy. Run after 0001–0008.
-- HARD privacy rule (Vanth): a non-owner must NOT be able to read a listing's
-- EXACT lat/lng before a claim is approved. Client-side jitter is insufficient
-- because exact coords would still be in the API response — so we enforce it at
-- the column-privilege level:
--   * Add coarse, rounded approx_lat / approx_lng (generated, ~0.7 mi grid).
--   * REVOKE SELECT on the exact lat/lng columns from anon + authenticated.
-- The app reads ONLY approx_lat/approx_lng. Exact coords remain in the table for
-- server-side use (the `notify` matching function runs as service_role, which
-- bypasses column grants) and for the owner's own writes (INSERT/UPDATE are
-- unaffected by a SELECT revoke). No exact address is exposed to anyone via the
-- public API; precise pickup location is shared in chat after approval.

-- ---------------------------------------------------------------------------
-- Coarse, public-safe coordinates (~2 decimal places ≈ 0.7 mi).
-- ---------------------------------------------------------------------------
alter table public.listings
  add column if not exists approx_lat double precision
    generated always as (round(lat::numeric, 2)::double precision) stored,
  add column if not exists approx_lng double precision
    generated always as (round(lng::numeric, 2)::double precision) stored;

-- ---------------------------------------------------------------------------
-- Lock down exact coordinates. After this, selecting lat/lng as anon or
-- authenticated is denied; the app selects explicit columns (never lat/lng, and
-- never `*`), so its queries are unaffected. service_role/postgres keep access.
-- ---------------------------------------------------------------------------
revoke select (lat, lng) on public.listings from anon, authenticated;

-- Make sure the coarse columns ARE readable (default grants normally cover this;
-- explicit for clarity / re-runs).
grant select (approx_lat, approx_lng) on public.listings to anon, authenticated;

-- Refresh PostgREST's schema cache so the new columns + privileges take effect.
notify pgrst, 'reload schema';
