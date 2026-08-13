#!/usr/bin/env bash
# Prove a recovered/added migration is safe on every shape of database.
#
# Four scenarios, all against THROWAWAY local databases:
#   A. fresh build      0001…TARGET on an empty database
#   B. staged apply     0001…(TARGET-1), then TARGET on its own
#   C. production shape TARGET applied a second time (must be a no-op)
#   D. schema diff      function definitions after B vs after C
#
# Requires a local Postgres (brew services start postgresql@16). Refuses to run
# against anything that is not a local socket/loopback — it DROPs databases.
#
#   supabase/tests/run_migration_tests.sh 0084
set -euo pipefail

TARGET="${1:?usage: run_migration_tests.sh <migration-number, e.g. 0084>}"
HOST="${PGHOST:-/tmp}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}." >&2; exit 2; }

target_file="$(ls "$MIG"/${TARGET}_*.sql | head -1)"
[ -f "$target_file" ] || { echo "No migration file for $TARGET" >&2; exit 2; }
echo "target: $(basename "$target_file")"

# Every forward migration up to and including TARGET, in filename order.
# 0087_down_* is a rollback script, not a forward step.
# (bash 3.2 on macOS has no `mapfile`, so build the array with a read loop.)
FORWARD=()
while IFS= read -r f; do
  n="$(basename "$f" | cut -c1-4)"
  case "$n" in ''|*[!0-9]*) continue ;; esac
  [ "$n" -le "$TARGET" ] && FORWARD+=("$f")
done < <(ls "$MIG"/*.sql | grep -v '_down_' | sort)

fresh_db() {  # $1 = dbname
  dropdb -h "$HOST" --if-exists "$1" >/dev/null 2>&1 || true
  createdb -h "$HOST" "$1"
  psql -h "$HOST" -d "$1" -v ON_ERROR_STOP=1 -q -f "$here/supabase_shim.sql"
}

apply() {     # $1 = dbname, rest = files
  local db="$1"; shift
  local failed=0
  for f in "$@"; do
    if ! psql -h "$HOST" -d "$db" -v ON_ERROR_STOP=1 -q -f "$f" >/tmp/mig.$$.log 2>&1; then
      echo "  FAIL $(basename "$f")"; sed -n '1,4p' /tmp/mig.$$.log | sed 's/^/       /'
      failed=$((failed+1))
    fi
  done
  rm -f /tmp/mig.$$.log
  return $failed
}

dump_defs() { # $1 = dbname -> stdout: every public function definition, sorted
  psql -h "$HOST" -d "$1" -Atq -c "
    select p.oid::regprocedure::text || E'\n' || pg_get_functiondef(p.oid)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' order by 1"
}

DB_A="gnome_mig_a"; DB_B="gnome_mig_b"
trap 'dropdb -h "$HOST" --if-exists "$DB_A" >/dev/null 2>&1 || true;
      dropdb -h "$HOST" --if-exists "$DB_B" >/dev/null 2>&1 || true' EXIT

echo
echo "A. fresh build 0001…$TARGET"
fresh_db "$DB_A"
if apply "$DB_A" "${FORWARD[@]}"; then a_fail=0; else a_fail=$?; fi
echo "   ${a_fail} migration(s) failed"

echo
echo "B. staged: 0001…pre-$TARGET, then $TARGET alone"
fresh_db "$DB_B"
PRE=(); i=0; last=$(( ${#FORWARD[@]} - 1 ))
while [ $i -lt $last ]; do PRE+=("${FORWARD[$i]}"); i=$((i+1)); done
if apply "$DB_B" "${PRE[@]}"; then b_pre_fail=0; else b_pre_fail=$?; fi
echo "   ${b_pre_fail} pre-$TARGET migration(s) failed"
if apply "$DB_B" "$target_file"; then
  echo "   PASS $TARGET applies to a database that is one step behind"
else
  echo "   FAIL $TARGET did not apply to the staged database"; exit 1
fi
defs_after_first="$(dump_defs "$DB_B")"

echo
echo "C. production shape: apply $TARGET again (objects already exist)"
if apply "$DB_B" "$target_file"; then
  echo "   PASS re-applying $TARGET is a no-op (idempotent)"
else
  echo "   FAIL $TARGET is not idempotent"; exit 1
fi
defs_after_second="$(dump_defs "$DB_B")"

echo
echo "D. schema diff (definitions after first apply vs second)"
if [ "$defs_after_first" = "$defs_after_second" ]; then
  echo "   PASS no drift"
else
  echo "   FAIL definitions changed on re-apply:"
  diff <(echo "$defs_after_first") <(echo "$defs_after_second") | head -40
  exit 1
fi

echo
echo "E. objects introduced by $TARGET are present in the fresh build"
grep -oiE 'create (or replace )?function public\.[a-z0-9_]+' "$target_file" \
  | sed -E 's/.*public\.//' | sort -u | while read -r fn; do
  n=$(psql -h "$HOST" -d "$DB_A" -Atq -c \
      "select count(*) from pg_proc p join pg_namespace s on s.oid=p.pronamespace
        where s.nspname='public' and p.proname='$fn'")
  if [ "$n" -ge 1 ]; then echo "   PASS $fn present in fresh build"
  else echo "   FAIL $fn missing from fresh build"; fi
done

echo
echo "migration tests complete for $TARGET"
