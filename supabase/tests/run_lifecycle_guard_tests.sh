#!/usr/bin/env bash
# Behavioural tests for 0123 (listing lifecycle guard), THROWAWAY local DB.
#
#   supabase/tests/run_lifecycle_guard_tests.sh
#
# Same prose-gap backfill as the other runners.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"
HOST="${PGHOST:-/tmp}"

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}." >&2; exit 2; }

DB="gnome_lifecycle_guard_$$"
cleanup() { dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

createdb -h "$HOST" "$DB"
psql -h "$HOST" -d "$DB" -q -f "$here/supabase_shim.sql" >/dev/null 2>&1

applied=0; failed=0
while IFS= read -r f; do
  n="$(basename "$f" | cut -c1-4)"
  case "$n" in ''|*[!0-9]*) continue ;; esac
  [ "$n" -le 0124 ] || continue
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

-- Prose-gap backfill: production grants exist for these; RLS is the boundary.
grant select, insert, update on public.listings to authenticated;
grant select on public.markets to authenticated;
grant usage on schema public to authenticated;
SQL

# The guard must be the head definition even if a prose-gap failure ate it.
psql -h "$HOST" -d "$DB" -q -v ON_ERROR_STOP=1 -f "$MIG/0123_listing_lifecycle_guard.sql" >/dev/null

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -f "$here/lifecycle_guard_suite.sql"
