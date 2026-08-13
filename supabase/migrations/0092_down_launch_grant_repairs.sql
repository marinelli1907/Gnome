-- Rollback for 0092_launch_grant_repairs.sql.
--
-- This restores the BROKEN pre-launch state on purpose: mobile Browse fails
-- again with 42501, and public_active_promotions becomes writable by client
-- roles again. Only run it to prove reversibility, or if 0092 is somehow
-- implicated in an incident — never as routine cleanup.

revoke select (request_options, allow_custom_request) on public.listings from anon, authenticated;

-- Restore the Supabase default-privilege shape these views had before 0092.
grant all on public.public_active_promotions to anon, authenticated;
grant all on public.public_listings          to anon, authenticated;
grant all on public.public_markets           to anon, authenticated;

notify pgrst, 'reload schema';
