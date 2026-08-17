#!/usr/bin/env bash
# Wanted introduction limits (0110), against a THROWAWAY local database.
#
#   supabase/tests/run_wanted_tests.sh
#
# Two phases:
#   1. the SQL suite (sequential behaviour, RPCs, admin, plan changes)
#   2. a REAL two-session concurrency proof — the advisory lock in the gate cannot be proven from
#      one session, and the directive mandates simultaneous requests at the entitlement boundary.
#
# Backfills the same prose-gap objects as the other runners (see run_listing_allowance_tests.sh).
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"
HOST="${PGHOST:-/tmp}"

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}." >&2; exit 2; }

DB="gnome_wanted_$$"
cleanup() { dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

createdb -h "$HOST" "$DB"
psql -h "$HOST" -d "$DB" -q -f "$here/supabase_shim.sql" >/dev/null 2>&1

applied=0; failed=0
while IFS= read -r f; do
  n="$(basename "$f" | cut -c1-4)"
  case "$n" in ''|*[!0-9]*) continue ;; esac
  [ "$n" -le 0110 ] || continue
  if psql -h "$HOST" -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1; then
    applied=$((applied + 1)); else failed=$((failed + 1)); fi
done < <(ls "$MIG"/*.sql | grep -v '_down_' | sort)
echo "migrations: ${applied} applied, ${failed} failed (prose-gap cascade — see run_listing_allowance_tests.sh)"

psql -h "$HOST" -d "$DB" -q <<'SQL'
alter table public.profiles add column if not exists suspended boolean not null default false;
create or replace function public.market_effective_plan(mid uuid)
returns table(plan public.market_plan)
language sql stable security definer set search_path = public
as $$ select m.plan from public.markets m where m.id = mid $$;
alter table public.listings disable trigger listings_screen_content_trg;
SQL

for fn in enforce_wanted_introduction my_wanted_allowance admin_wanted_usage wanted_day_start; do
  psql -h "$HOST" -d "$DB" -tAc "select to_regproc('public.${fn}')" | grep -q . \
    || { echo "MISSING after build: ${fn}" >&2; exit 1; }
done

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -f "$here/wanted_intro_suite.sql" || exit 1

# ---------------------------------------------------------------------------
# Phase 2 — concurrency at the boundary, with two real sessions
# ---------------------------------------------------------------------------
echo ""
echo "concurrency: two sessions racing the last slot"

psql -h "$HOST" -d "$DB" -q -v ON_ERROR_STOP=1 <<'SQL'
-- Fresh fixtures for the race: a buyer with open Wanted posts, a Free seller (1/day) with the
-- full allowance, and a Pro seller (5/day) already at 4.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c0'),
  ('00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000c2') on conflict do nothing;
insert into public.profiles (id, name) values
  ('00000000-0000-0000-0000-0000000000c0','RaceBuyer'),
  ('00000000-0000-0000-0000-0000000000c1','RaceFree'),
  ('00000000-0000-0000-0000-0000000000c2','RacePro') on conflict do nothing;
-- Signup triggers may already have made markets for these users; converge, don't duplicate.
insert into public.markets (owner_id, plan)
select v.o, v.p from (values
  ('00000000-0000-0000-0000-0000000000c0'::uuid,'free'::public.market_plan),
  ('00000000-0000-0000-0000-0000000000c1','free'),
  ('00000000-0000-0000-0000-0000000000c2','grower')) v(o,p)
where not exists (select 1 from public.markets m where m.owner_id = v.o);
update public.markets set plan='grower' where owner_id='00000000-0000-0000-0000-0000000000c2';
insert into public.listings (id, owner_id, market_id, title, category, listing_type, status, expires_at)
select ('00000000-0000-0000-0000-00000000d10' || i)::uuid,
       '00000000-0000-0000-0000-0000000000c0', m.id, 'Race want ' || i, 'vegetables', 'wanted', 'active',
       now() + interval '30 days'
  from generate_series(1, 8) i,
       (select id from public.markets where owner_id = '00000000-0000-0000-0000-0000000000c0' limit 1) m;
-- Pro seller pre-seeded to 4 of 5.
insert into public.claims (listing_id, claimer_id, claim_type)
select ('00000000-0000-0000-0000-00000000d10' || i)::uuid, '00000000-0000-0000-0000-0000000000c2', 'wanted_response'
  from generate_series(3, 6) i;
SQL

race() {  # race <label> <seller> <postA> <postB> <expected_rows>
  local label="$1" seller="$2" pa="$3" pb="$4" want="$5"
  # Session A inserts and then HOLDS its transaction (and therefore the advisory xact lock) open
  # for 2s before committing. Session B starts mid-hold: it must block on the lock, recount after
  # A commits, and be refused — not slip through a stale count.
  psql -h "$HOST" -d "$DB" -q -v ON_ERROR_STOP=1 <<EOF >/tmp/race_a.$$ 2>&1 &
begin;
insert into public.claims (listing_id, claimer_id, claim_type) values ('${pa}', '${seller}', 'wanted_response');
select pg_sleep(2);
commit;
EOF
  local a_pid=$!
  sleep 0.6
  psql -h "$HOST" -d "$DB" -q -v ON_ERROR_STOP=1 \
    -c "insert into public.claims (listing_id, claimer_id, claim_type) values ('${pb}', '${seller}', 'wanted_response');" \
    >/tmp/race_b.$$ 2>&1
  local b_status=$?
  wait "$a_pid"; local a_status=$?

  local rows
  rows=$(psql -h "$HOST" -d "$DB" -tAc \
    "select count(*) from public.claims where claimer_id='${seller}' and listing_id in ('${pa}','${pb}')")
  if [ "$a_status" -eq 0 ] && [ "$b_status" -ne 0 ] && [ "$rows" = "1" ] \
     && grep -q "WANTED_INTRO_LIMIT_REACHED" /tmp/race_b.$$; then
    echo "  PASS  ${label}: exactly one of two simultaneous requests took the last slot"
  else
    echo "  FAIL  ${label}: a=${a_status} b=${b_status} rows=${rows}"
    echo "  --- session B said:"; sed 's/^/      /' /tmp/race_b.$$
    rm -f /tmp/race_a.$$ /tmp/race_b.$$
    exit 1
  fi
  rm -f /tmp/race_a.$$ /tmp/race_b.$$
}

race "FREE 0/1" '00000000-0000-0000-0000-0000000000c1' \
  '00000000-0000-0000-0000-00000000d101' '00000000-0000-0000-0000-00000000d102' 1
race "PRO 4/5"  '00000000-0000-0000-0000-0000000000c2' \
  '00000000-0000-0000-0000-00000000d107' '00000000-0000-0000-0000-00000000d108' 1

echo ""
echo "wanted tests complete"
