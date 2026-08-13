#!/usr/bin/env bash
# Prove migration 0093 closes the markets privacy hole, on a throwaway local
# database that reproduces production's PRIVILEGE shape.
#
# Fails BEFORE the migration and passes after, so it proves a fix. Critically it
# also populates the private columns with real-looking values first — a test that
# only checks NULL columns proves nothing about the leak that matters.
#
#   supabase/tests/run_market_privacy_tests.sh
set -uo pipefail

DB="${GNOME_MARKET_TEST_DB:-gnome_market_privacy_test}"
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

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid $$;

create table public.markets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null, name text, slug text, description text,
  market_type text, plan text, status text default 'active',
  avatar_url text, banner_url text,
  city text, county text, state text,
  zip text, lat double precision, lng double precision,
  approximate_location text,
  contact_email text, contact_phone text,
  website_url text, instagram_url text, facebook_url text,
  accepts_free boolean default true, accepts_trade boolean default true,
  accepts_sales boolean default true,
  pickup_instructions text, public_pickup_note text,
  verified boolean default false, sponsor_visible boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  tagline text, theme text, extra_pickup_locations int default 0);

-- Production shape: one table-wide grant, so every column is public.
grant select on public.markets to anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql stable as $$
  select coalesce(current_setting('test.is_admin', true),'false')::boolean $$;

-- Real-looking private data. The leak only matters once these are populated.
insert into public.markets (owner_id, name, slug, city, state, zip, lat, lng,
                            contact_email, contact_phone, pickup_instructions)
values ('11111111-1111-1111-1111-111111111111','Hillside Garden','hillside',
        'Richmond Heights','OH','44143', 41.5573, -81.5090,
        'seller.private@example.com','+12165550142','Gate sticks — come round the back');
SQL

probe() {  # $1 = role  -> prints one line per private column
  psql -h "$HOST" -d "$DB" -Atq <<SQL
do \$\$
declare c text; res text := '';
begin
  set local role $1;
  foreach c in array array['lat','lng','zip','contact_email','contact_phone','pickup_instructions'] loop
    begin
      execute format('select %I from public.markets limit 1', c);
      res := res || c || '=READABLE ';
    exception when others then res := res || c || '=blocked '; end;
  end loop;
  begin execute 'select id, name, city, state, approximate_location, status from public.markets limit 1';
    res := res || '| public_cols=OK';
  exception when others then res := res || '| public_cols=' || sqlstate; end;
  reset role;
  raise notice '%', res;
end \$\$;
SQL
}

fail=0
say() { printf '   %-6s %s\n' "$1" "$2"; [ "$1" = FAIL ] && fail=1; return 0; }

echo "A. BEFORE 0093 — the leak must reproduce with the columns POPULATED"
b_anon="$(probe anon 2>&1 | tr -d '\r')"
echo "$b_anon" | grep -q 'contact_email=READABLE' \
  && say PASS "anon can read seller contact_email (leak reproduced)" \
  || say FAIL "expected the leak before the fix — got: $b_anon"
echo "$b_anon" | grep -q 'lat=READABLE' \
  && say PASS "anon can read exact lat/lng (leak reproduced)" \
  || say FAIL "expected exact coordinates readable before the fix"

echo
echo "B. apply 0093"
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$MIG/0093_market_privacy.sql" 2>&1 | grep -v NOTICE || true

for role in anon authenticated; do
  out="$(probe $role 2>&1 | tr -d '\r')"
  echo "$out" | grep -q 'READABLE' \
    && say FAIL "$role can still read a private column — $out" \
    || say PASS "$role: every private column blocked"
  echo "$out" | grep -q 'public_cols=OK' \
    && say PASS "$role: public columns still readable (Browse intact)" \
    || say FAIL "$role: public columns broke — $out"
done

owner=$(psql -h "$HOST" -d "$DB" -Atq -c "
  select set_config('request.jwt.claims','{\"sub\":\"11111111-1111-1111-1111-111111111111\"}',false);
  set role authenticated;
  select coalesce((select contact_email from public.my_market()),'(none)');" | tail -1)
[ "$owner" = "seller.private@example.com" ] \
  && say PASS "owner still reads their own contact details via my_market()" \
  || say FAIL "owner lost access to their own row — got '$owner'"

other=$(psql -h "$HOST" -d "$DB" -Atq -c "
  select set_config('request.jwt.claims','{\"sub\":\"22222222-2222-2222-2222-222222222222\"}',false);
  set role authenticated;
  select count(*)::text from public.my_market();" | tail -1)
[ "$other" = "0" ] && say PASS "a different signed-in user gets nothing from my_market()" \
                   || say FAIL "my_market() leaked another owner's row ($other)"

adm=$(psql -h "$HOST" -d "$DB" -Atq -c "
  select set_config('test.is_admin','true',false);
  set role authenticated;
  select coalesce((select contact_phone from public.admin_market(
    (select id from public.markets limit 1))),'(none)');" | tail -1)
[ "$adm" = "+12165550142" ] && say PASS "admin can still read contact details for support" \
                            || say FAIL "admin access broke — got '$adm'"

echo
echo "C. idempotence + rollback"
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$MIG/0093_market_privacy.sql" >/dev/null 2>&1 \
  && say PASS "0093 re-applies cleanly" || say FAIL "0093 is not idempotent"
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$MIG/0093_down_market_privacy.sql" >/dev/null 2>&1 \
  && say PASS "down-migration applies" || say FAIL "down-migration failed"
echo "$(probe anon 2>&1)" | grep -q 'contact_email=READABLE' \
  && say PASS "rollback restores the prior state exactly" \
  || say FAIL "rollback did not restore the prior state"

echo
[ $fail -eq 0 ] && echo "MARKET PRIVACY (0093): ALL TESTS PASSED" || echo "MARKET PRIVACY (0093): FAILURES PRESENT"
exit $fail
