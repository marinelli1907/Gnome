#!/usr/bin/env bash
# Behavioural tests for 0119 (Market Following), against a THROWAWAY local database.
#
#   supabase/tests/run_market_following_tests.sh
#
# Same prose-gap backfill as the other runners (see run_import_drafts_tests.sh header).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"
HOST="${PGHOST:-/tmp}"

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}." >&2; exit 2; }

DB="gnome_market_following_$$"
cleanup() { dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

createdb -h "$HOST" "$DB"
psql -h "$HOST" -d "$DB" -q -f "$here/supabase_shim.sql" >/dev/null 2>&1

applied=0; failed=0
while IFS= read -r f; do
  n="$(basename "$f" | cut -c1-4)"
  case "$n" in ''|*[!0-9]*) continue ;; esac
  [ "$n" -le 0119 ] || continue
  if psql -h "$HOST" -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1; then
    applied=$((applied + 1))
  else
    failed=$((failed + 1))
  fi
done < <(ls "$MIG"/*.sql | grep -v '_down_' | sort)
echo "migrations: ${applied} applied, ${failed} failed (prose-gap cascade — see header)"

psql -h "$HOST" -d "$DB" -q <<'SQL'
alter table public.profiles add column if not exists suspended boolean not null default false;
alter table public.listings disable trigger listings_screen_content_trg;

create or replace function public.market_effective_plan(mid uuid)
returns table(plan public.market_plan)
language sql stable security definer set search_path = public
as $$ select m.plan from public.markets m where m.id = mid $$;
-- Prose-gap backfill: production carries table grants on these (RLS is the
-- actual boundary; see baseline/public_schema.sql), but the grant statements
-- live in migrations that fail in the throwaway cascade.
grant select, insert, delete on public.market_follows to authenticated;
grant select, insert, update, delete on public.device_tokens to authenticated;
SQL

for fn in my_market_follower_count; do
  psql -h "$HOST" -d "$DB" -tAc "select to_regproc('public.${fn}')" | grep -q . \
    || { echo "MISSING after build: ${fn}" >&2; exit 1; }
done

# ----------------------------------------------------------------------------
# RACE — the same buyer fires two simultaneous follows of the same market.
# unique (market_id, follower_id) must leave exactly ONE relationship.
# ----------------------------------------------------------------------------
psql -h "$HOST" -d "$DB" -q <<'SQL'
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000f1f1'),
  ('00000000-0000-0000-0000-00000000f2f2') on conflict do nothing;
delete from public.markets where owner_id = '00000000-0000-0000-0000-00000000f1f1';
insert into public.markets (id, owner_id, plan)
values ('ffffffff-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000f1f1', 'free');
SQL
FOLLOW_SQL="set request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-00000000f2f2\",\"role\":\"authenticated\"}';
set role authenticated;
insert into public.market_follows (market_id, follower_id)
values ('ffffffff-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000f2f2')
on conflict (market_id, follower_id) do nothing;"
psql -h "$HOST" -d "$DB" -tAc "$FOLLOW_SQL" >/dev/null 2>&1 &
psql -h "$HOST" -d "$DB" -tAc "$FOLLOW_SQL" >/dev/null 2>&1 &
wait || true
rows="$(psql -h "$HOST" -d "$DB" -tAc "select count(*) from public.market_follows where market_id = 'ffffffff-0000-0000-0000-000000000001'")"
if [ "$rows" = "1" ]; then
  echo "concurrency: PASS — simultaneous follows left exactly one relationship"
else
  echo "concurrency: FAIL — rows=${rows}" >&2; exit 1
fi

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -f "$here/market_following_suite.sql"
