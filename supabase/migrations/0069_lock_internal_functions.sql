-- Gnome — internal functions are not API surface (2026-08-10).
--
-- Postgres grants EXECUTE to PUBLIC on new functions by default, and PostgREST
-- exposes anything executable as /rpc/*. market_delivery_origin() returns the
-- SELLER'S PRIVATE COORDINATES — it exists only for delivery_quote() and
-- create_market_order() to call internally (definer functions execute it as
-- their owner, so revoking client EXECUTE does not affect them).

revoke execute on function public.market_delivery_origin(uuid) from public, anon, authenticated;
revoke execute on function public.haversine_miles(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.delivery_allowed_for_node(uuid) from public, anon, authenticated;
revoke execute on function public.generate_seed_subscription_order(uuid, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
