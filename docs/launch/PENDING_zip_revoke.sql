-- PENDING — run IMMEDIATELY AFTER the next web deploy, not before.
--
-- Why it exists: profiles.zip_code is meant to be private, but the column
-- SELECT grant still allows any authenticated account to read it via the raw
-- API. All values were null when this was written; the profile editor's
-- "Use current location" now populates real ZIPs, so this revoke is the
-- remaining step that makes the privacy promise structural.
--
-- Why it is NOT yet applied: the currently-DEPLOYED web LoginClient still
-- selects zip_code directly; revoking first would 42501 the live account
-- page. The fix (my_profile() RPC) is already merged on main — deploy web,
-- then apply this via the migration API as e.g. 'revoke_zip_column':

revoke select (zip_code) on public.profiles from anon, authenticated;

-- Owner reads keep working through the my_profile() SECURITY DEFINER RPC
-- (mobile useMyProfile + web LoginClient both use it already).
-- Verify after applying:
--   1) signed-in user: GET /rest/v1/profiles?select=zip_code  -> 42501
--   2) same user: POST /rest/v1/rpc/my_profile                -> row incl. zip_code
--   3) web /login account view still loads and shows ZIP
--   4) profile save (which UPDATEs zip_code) still works — UPDATE grant is untouched
