-- 0047: restore SELECT on listings.market_position / market_featured.
--
-- Found during the compliance-UI acceptance round: these 0032 storefront
-- columns had INSERT/UPDATE but no SELECT for anon/authenticated, so the web
-- My Market page's listings query (which names them) died with 42501 for every
-- seller. They are presentation-only ordering fields for the PUBLIC storefront
-- — nothing sensitive — so the read grant is correct for both roles.
grant select (market_position, market_featured) on public.listings to anon, authenticated;
