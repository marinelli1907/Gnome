-- Rollback for 0093_market_privacy.sql.
--
-- Restores the pre-0093 state, which republishes markets.lat/lng/zip/
-- contact_email/contact_phone/pickup_instructions to anon. Only run this if 0093
-- is implicated in an incident — and note that the clients updated alongside it
-- read an explicit column list, so they keep working either way.

drop function if exists public.admin_market(uuid);
drop function if exists public.my_market();

grant select on public.markets to anon, authenticated;

notify pgrst, 'reload schema';
