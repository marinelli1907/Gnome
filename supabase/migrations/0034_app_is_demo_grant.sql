-- 0034: let API clients read listings.is_demo directly.
--
-- The listings table uses column-level SELECT grants (0009 pattern), and new
-- columns don't inherit them. 0023 added is_demo and exposed it through the
-- public_listings view, but the Expo app reads the base table (under RLS) and
-- its column list now includes is_demo so demo content can be labeled
-- "Preview" in the app exactly as on the web. Same visibility the public view
-- already grants — no new information is exposed.

grant select (is_demo) on public.listings to anon, authenticated;
