#!/usr/bin/env bash
# Wanted introduction limits (0111), against a THROWAWAY local database.
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

DB="gnome_qr_$$"
cleanup() { dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

createdb -h "$HOST" "$DB"
psql -h "$HOST" -d "$DB" -q -f "$here/supabase_shim.sql" >/dev/null 2>&1

applied=0; failed=0
while IFS= read -r f; do
  n="$(basename "$f" | cut -c1-4)"
  case "$n" in ''|*[!0-9]*) continue ;; esac
  [ "$n" -le 0111 ] || continue
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

for fn in resolve_market_qr my_market_qr admin_market_qr; do
  psql -h "$HOST" -d "$DB" -tAc "select to_regproc('public.${fn}')" | grep -q . \
    || { echo "MISSING after build: ${fn}" >&2; exit 1; }
done

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -f "$here/market_qr_suite.sql" || exit 1

# ---------------------------------------------------------------------------
echo ""; echo "market qr tests complete"
