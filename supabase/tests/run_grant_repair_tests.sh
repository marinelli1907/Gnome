#!/usr/bin/env bash
# Prove migration 0092 fixes the two launch blockers, on a throwaway local
# database that reproduces production's PRIVILEGE shape (not its data).
#
# The point of this harness is that it fails BEFORE the migration and passes
# after — so it proves a fix rather than describing one.
#
#   supabase/tests/run_grant_repair_tests.sh
set -uo pipefail

DB="${GNOME_GRANT_TEST_DB:-gnome_grant_repair_test}"
HOST="${PGHOST:-/tmp}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}." >&2; exit 2; }

dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true
createdb -h "$HOST" "$DB"
trap 'dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true' EXIT

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q <<'SQL' 2>&1 | grep -v NOTICE || true
do $$ begin create role anon nologin;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant anon, authenticated to current_user;

create table public.markets (
  id uuid primary key default gen_random_uuid(), name text, status text default 'active');
-- listings mirrors production's shape: per-COLUMN grants, so a column added
-- later starts ungranted. That is the whole bug.
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  market_id uuid references public.markets(id),
  title text, status text default 'active', expires_at timestamptz default now() + interval '30 days',
  lat double precision, lng double precision,
  approx_lat double precision, approx_lng double precision,
  slug text,
  request_options jsonb, allow_custom_request boolean default false);
grant select (id, market_id, title, status, expires_at, approx_lat, approx_lng)
  on public.listings to anon, authenticated;

create table public.listing_promotions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id), status text default 'active',
  ends_at timestamptz default now() + interval '7 days');

-- Single-table view => auto-updatable. Join views are not.
create view public.public_active_promotions as
  select id, listing_id, status, ends_at from public.listing_promotions where status = 'active';
create view public.public_listings as
  select l.id, l.title, l.slug, l.request_options, l.allow_custom_request
    from public.listings l join public.markets m on m.id = l.market_id;
create view public.public_markets as
  select m.id, m.name from public.markets m join public.listings l on l.market_id = m.id;

-- Reproduce Supabase's default privileges: ALL on every new relation.
grant all on public.public_active_promotions, public.public_listings, public.public_markets
  to anon, authenticated;

insert into public.markets (name) values ('Test Market');
insert into public.listings (market_id, title) select id, 'Test Listing' from public.markets limit 1;
insert into public.listing_promotions (listing_id) select id from public.listings limit 1;
SQL

probe() {   # $1 = phase label
  psql -h "$HOST" -d "$DB" -Atq <<SQL
do \$\$
declare browse text; del text;
begin
  set local role authenticated;
  begin
    perform id, request_options, allow_custom_request from public.listings limit 1;
    browse := 'OK';
  exception when others then browse := sqlstate; end;
  begin
    execute 'delete from public.public_active_promotions where false';
    del := 'ACCEPTED';
  exception when others then del := 'blocked:' || sqlstate; end;
  reset role;
  raise notice '%|browse=%|view_delete=%', '$1', browse, del;
end \$\$;
SQL
}

fail=0
say() { printf '   %-6s %s\n' "$1" "$2"; [ "$1" = FAIL ] && fail=1; return 0; }

echo "A. BEFORE 0092 — the blockers must reproduce"
before="$(probe before 2>&1 | tr -d '\r')"
echo "$before" | grep -q 'browse=42501' \
  && say PASS "mobile browse query fails with 42501 (blocker reproduced)" \
  || say FAIL "expected browse to fail before the fix — got: $before"
echo "$before" | grep -q 'view_delete=ACCEPTED' \
  && say PASS "public_active_promotions accepts DELETE (blocker reproduced)" \
  || say FAIL "expected the view write to be accepted before the fix — got: $before"

echo
echo "B. apply 0092"
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$MIG/0092_launch_grant_repairs.sql" 2>&1 \
  | grep -v NOTICE || true
after="$(probe after 2>&1 | tr -d '\r')"
echo "$after" | grep -q 'browse=OK' \
  && say PASS "mobile browse query succeeds" \
  || say FAIL "browse still broken after the fix — got: $after"
echo "$after" | grep -q 'view_delete=blocked' \
  && say PASS "view write is refused" \
  || say FAIL "view write still accepted after the fix — got: $after"

priv=$(psql -h "$HOST" -d "$DB" -Atq -c \
  "select has_column_privilege('anon','public.listings','lat','SELECT')::text")
[ "$priv" = "false" ] && say PASS "lat/lng still private (no privacy regression)" \
                      || say FAIL "lat became readable"

echo
echo "C. idempotence + rollback"
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$MIG/0092_launch_grant_repairs.sql" >/dev/null 2>&1 \
  && say PASS "0092 re-applies cleanly" || say FAIL "0092 is not idempotent"

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$MIG/0092_down_launch_grant_repairs.sql" >/dev/null 2>&1 \
  && say PASS "down-migration applies" || say FAIL "down-migration failed"
rolled="$(probe rolled 2>&1 | tr -d '\r')"
echo "$rolled" | grep -q 'browse=42501' \
  && say PASS "rollback restores the prior (broken) state exactly" \
  || say FAIL "rollback did not restore the prior state — got: $rolled"

echo
[ $fail -eq 0 ] && echo "GRANT REPAIR (0092): ALL TESTS PASSED" || echo "GRANT REPAIR (0092): FAILURES PRESENT"
exit $fail
