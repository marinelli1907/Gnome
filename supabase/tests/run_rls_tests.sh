#!/usr/bin/env bash
# Run the profiles RLS tests against a THROWAWAY local database.
#
# Never points at production: it creates (and drops) its own database on the
# local Postgres server. Requires a local PG (brew install postgresql@16).
#
#   supabase/tests/run_rls_tests.sh
set -euo pipefail

DB="${GNOME_RLS_TEST_DB:-gnome_rls_test}"
HOST="${PGHOST:-/tmp}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! pg_isready -h "$HOST" >/dev/null 2>&1; then
  echo "No local Postgres on ${HOST}. Start one (brew services start postgresql@16) and retry." >&2
  exit 2
fi

# Refuse to run anywhere that looks remote — these tests DROP tables.
case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac

dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true
createdb -h "$HOST" "$DB"
trap 'dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true' EXIT

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$here/rls_profiles_test.sql"
