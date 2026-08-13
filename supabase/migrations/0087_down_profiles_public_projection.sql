-- ROLLBACK for 0087_profiles_public_projection.sql.
--
-- Restores the pre-0087 behaviour exactly: the blanket world-readable SELECT
-- policy, the administrative column grants, and removes the public projection.
-- Run this ONLY to undo 0087; it deliberately reinstates the permissive policy
-- that 0087 exists to remove.
--
-- Deploy note: if the app has already been updated to read `public_profiles`,
-- roll the app back too (or keep the view — step 3 is the only part that breaks
-- an updated client).

-- 1. Reinstate the original blanket read.
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;

drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select using (true);

-- 2. Re-grant the administrative columns exactly as 0001/0058 left them.
--    (0087 only revoked these from `anon`; `authenticated` was left intact so
--    admin moderation screens keep working.)
grant select (can_post, can_claim, can_sponsor, can_create_promotions,
              can_offer_delivery, suspended)
  on public.profiles to anon;

-- 3. Remove the public projection (drop LAST — an updated client reads it).
drop view if exists public.public_profiles;
