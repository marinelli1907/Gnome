#!/usr/bin/env bash
# Build a throwaway local database (shim + prerequisite fixture + 0089) and run
# the Seed Drop Phase 0 suite against it. Also proves the paired down-migration
# reverses cleanly.
#
# Nothing here touches a hosted project: it refuses any non-local PGHOST and it
# creates/drops its own database.
#
#   supabase/tests/run_seed_drop_phase0_tests.sh
set -uo pipefail

DB="${GNOME_SEED_TEST_DB:-gnome_seed_phase0_test}"
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

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$here/supabase_shim.sql" 2>&1 | grep -v NOTICE || true
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$here/seed_drop_phase0_fixture.sql"

echo "applying 0089_seed_drop_compliance_foundation.sql…"
if ! psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q \
      -f "$MIG/0089_seed_drop_compliance_foundation.sql" 2>&1 | grep -v '^NOTICE' ; then
  echo "0089 failed to apply" >&2; exit 1
fi

echo
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -P pager=off -f "$here/seed_drop_phase0_suite.sql" \
  | grep -vE '^(CREATE|GRANT|DO|SET|INSERT|UPDATE)'

echo
echo "re-applying 0089 (must be idempotent)…"
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q \
  -f "$MIG/0089_seed_drop_compliance_foundation.sql" >/dev/null 2>&1 \
  && echo "   PASS 0089 re-applies cleanly" || { echo "   FAIL 0089 is not idempotent"; exit 1; }

echo "applying the paired down-migration…"
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q \
  -f "$MIG/0089_down_seed_drop_compliance_foundation.sql" >/dev/null 2>&1 \
  && echo "   PASS 0089 rolls back cleanly" || { echo "   FAIL rollback failed"; exit 1; }

left=$(psql -h "$HOST" -d "$DB" -Atq -c "
  select count(*) from information_schema.tables
   where table_schema='public' and table_name in
     ('seed_supplier_credentials','seed_state_clearance','seed_capacity_controls',
      'seed_packet_reservations','seed_purchase_orders','seed_lot_documents')")
[ "$left" = "0" ] && echo "   PASS rollback removed all six new tables" \
                  || { echo "   FAIL $left new table(s) survived rollback"; exit 1; }

notnull=$(psql -h "$HOST" -d "$DB" -Atq -c "
  select is_nullable from information_schema.columns
   where table_schema='public' and table_name='seed_products' and column_name='packet_seed_count'")
[ "$notnull" = "NO" ] && echo "   PASS rollback restored packet_seed_count NOT NULL" \
                      || { echo "   FAIL packet_seed_count left nullable"; exit 1; }
