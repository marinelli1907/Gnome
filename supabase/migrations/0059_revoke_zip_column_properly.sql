-- 0059: actually withhold profiles.zip_code.
--
-- 0058's column-level revoke was a no-op: profiles carries a TABLE-level
-- SELECT grant, which covers every column, so removing the per-column grant
-- changed nothing (verified live — a cross-user ZIP read still returned 200).
-- The fix is the same shape as listings.lat/lng: drop the table-wide grant,
-- then re-grant every column EXCEPT the private one.
revoke select on public.profiles from anon, authenticated;
grant select (id, name, avatar_url, city, county, state, user_type,
              business_account, business_category, can_post, can_claim,
              can_sponsor, can_create_promotions, can_offer_delivery,
              created_at, suspended)
  on public.profiles to anon, authenticated;
-- zip_code stays readable to its owner through my_profile() (SECURITY
-- DEFINER, pinned to auth.uid()); UPDATE is untouched so the profile editor
-- can still save one.