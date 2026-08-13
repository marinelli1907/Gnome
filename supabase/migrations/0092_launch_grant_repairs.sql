-- 0092 — two launch-blocking grant repairs. Additive, reversible, no data touched.
--
-- Both are the same underlying mistake in two places: `listings` and the public
-- views rely on COLUMN- and ROLE-level grants, and Postgres/Supabase defaults do
-- not do what a reader assumes. Neither is a policy problem — the RLS policies
-- are correct. The privileges underneath them are not.

-- ---------------------------------------------------------------------------
-- 1. Browse is broken in the shipped mobile app (BLOCKER).
--
-- `listings` carries per-column SELECT grants so lat/lng stay private (0009,
-- and the same lesson again in 0059 for profiles.zip_code). A column added
-- later therefore starts with NO grant at all. 0085 added `request_options` and
-- `allow_custom_request` and never granted them; commit 41f263d then added both
-- to the app's LISTING_FIELDS. Since then every mobile browse/claim/promotion
-- query has failed:
--
--   select id, …, request_options, allow_custom_request from listings
--   ERROR: 42501: permission denied for table listings
--
-- Verified as `authenticated` against production on 2026-08-13 before this fix.
-- Grant exactly the two columns the client needs. lat/lng stay revoked — the
-- app reads approx_lat/approx_lng and must keep doing so.
grant select (request_options, allow_custom_request) on public.listings to anon, authenticated;

do $$
declare missing text;
begin
  select string_agg(c.column_name, ', ') into missing
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'listings'
     and c.column_name in ('request_options','allow_custom_request')
     and not has_column_privilege('authenticated', 'public.listings', c.column_name, 'SELECT');
  if missing is not null then
    raise exception 'listings columns still ungranted to authenticated: %', missing;
  end if;
  -- lat/lng must NOT have been widened by the grant above.
  if has_column_privilege('anon', 'public.listings', 'lat', 'SELECT')
     or has_column_privilege('anon', 'public.listings', 'lng', 'SELECT') then
    raise exception 'listings.lat/lng became readable — map privacy regression';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. A public view accepts writes from client roles (BLOCKER).
--
-- The 0087 finding, still live on three older views: Supabase's default
-- privileges grant anon/authenticated ALL on every new relation, and
-- `revoke ... from public` does NOT remove a grant held by a named role.
--
-- public_listings and public_markets survived it only by accident — they join
-- two tables, so Postgres refuses to update them regardless of privilege.
-- public_active_promotions is a single-table view, which makes it
-- auto-updatable, and it runs with OWNER rights — so a DELETE through it
-- executes as the table owner and bypasses RLS entirely. Confirmed by
-- executing a DELETE as `authenticated` against production on 2026-08-13:
-- it was accepted.
--
-- Revoke from the ROLES by name (the part that is easy to get wrong), then
-- re-grant only SELECT.
revoke all on public.public_active_promotions from public, anon, authenticated;
revoke all on public.public_listings            from public, anon, authenticated;
revoke all on public.public_markets             from public, anon, authenticated;

grant select on public.public_active_promotions to anon, authenticated;
grant select on public.public_listings          to anon, authenticated;
grant select on public.public_markets           to anon, authenticated;

-- Fail the migration rather than ship the hole again.
do $$
declare bad text;
begin
  select string_agg(distinct table_name || ':' || grantee || ':' || privilege_type, ', ')
    into bad
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('public_active_promotions','public_listings','public_markets','public_profiles')
     and grantee in ('anon','authenticated')
     and privilege_type <> 'SELECT';
  if bad is not null then
    raise exception 'public views must be SELECT-only for client roles: %', bad;
  end if;
end $$;

notify pgrst, 'reload schema';
