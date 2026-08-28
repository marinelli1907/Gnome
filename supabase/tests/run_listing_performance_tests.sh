#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG17_BIN="${PG17_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
PORT="${GNOME_LISTING_TEST_PORT:-55437}"

if [ ! -x "$PG17_BIN/initdb" ]; then
  echo "PostgreSQL 17 not found at $PG17_BIN" >&2
  exit 2
fi

TMP_DIR="$(mktemp -d /tmp/gnome-listing-performance.XXXXXX)"
export LC_ALL=C

cleanup() {
  "$PG17_BIN/pg_ctl" -D "$TMP_DIR/data" stop -m fast >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$PG17_BIN/initdb" -D "$TMP_DIR/data" -A trust -U gnome_test >/dev/null
"$PG17_BIN/pg_ctl" -D "$TMP_DIR/data" \
  -o "-k $TMP_DIR -p $PORT" -l "$TMP_DIR/postgres.log" start >/dev/null
"$PG17_BIN/createdb" -h "$TMP_DIR" -p "$PORT" -U gnome_test gnome_listing_performance

PSQL=("$PG17_BIN/psql" -h "$TMP_DIR" -p "$PORT" -U gnome_test \
  -d gnome_listing_performance -v ON_ERROR_STOP=1)

"${PSQL[@]}" -q -f "$ROOT/supabase/tests/supabase_shim.sql"
"${PSQL[@]}" -q -f "$ROOT/supabase/tests/listing_performance_fixture.sql"
"${PSQL[@]}" -q -f "$ROOT/supabase/migrations/20260824210401_listing_performance_and_archive.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/listing_performance_suite.sql"
