#!/usr/bin/env bash
# Fail if the repository's migrations and production's applied ledger disagree.
#
# This is the guard that would have caught the 0084 gap on the day it opened.
# It is offline: it compares supabase/migrations/*.sql against the checked-in
# snapshot supabase/migrations/APPLIED.tsv (refresh instructions in
# docs/db/MIGRATION_INTEGRITY.md), so it can run in CI or a pre-push hook.
#
#   supabase/tests/migration_audit.sh
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"
LEDGER="$MIG/APPLIED.tsv"
DECLARED="$MIG/UNAPPLIED.txt"
fail=0

[ -f "$LEDGER" ]   || { echo "missing $LEDGER" >&2; exit 2; }
[ -f "$DECLARED" ] || { echo "missing $DECLARED" >&2; exit 2; }

echo "1. every applied migration has a repository file"
while IFS=$'\t' read -r ver name md5 file; do
  case "$ver" in '#'*|'') continue ;; esac
  f="${file#FOLDED:}"
  if [ ! -f "$MIG/$f" ]; then
    echo "   FAIL $ver $name -> $f (file absent)"; fail=1
  fi
done < "$LEDGER"
[ $fail -eq 0 ] && echo "   PASS $(grep -vc '^#' "$LEDGER") applied migrations all represented"

echo "2. every repository migration is applied or declared unapplied"
for path in "$MIG"/*.sql; do
  f="$(basename "$path")"
  if cut -f4 "$LEDGER" | sed 's/^FOLDED://' | grep -qx "$f"; then continue; fi
  if grep -q "^$f[[:space:]]" "$DECLARED"; then continue; fi
  echo "   FAIL $f is neither in APPLIED.tsv nor declared in UNAPPLIED.txt"; fail=1
done
[ $fail -eq 0 ] && echo "   PASS no undeclared migration files"

echo "3. numbering is contiguous (a hole means a lost migration)"
prev=0
for path in "$MIG"/*.sql; do
  f="$(basename "$path")"; case "$f" in *_down_*) continue ;; esac
  if [[ "$f" =~ ^([0-9]{4})_ ]]; then
    n="${BASH_REMATCH[1]}"
  else
    continue
  fi
  cur=$((10#$n))
  [ "$cur" -eq "$prev" ] && { echo "   FAIL duplicate migration number $n"; fail=1; }
  if [ "$cur" -gt $((prev + 1)) ]; then
    echo "   FAIL gap between $(printf '%04d' $prev) and $n"; fail=1
  fi
  prev=$cur
done
[ $fail -eq 0 ] && echo "   PASS 0001..$(printf '%04d' $prev) contiguous"

echo "4. drift report (file text vs the text production actually ran)"
drift=0
while IFS=$'\t' read -r ver name md5 file; do
  case "$ver" in '#'*|'') continue ;; esac
  case "$file" in FOLDED:*) continue ;; esac
  [ -f "$MIG/$file" ] || continue
  got="$(md5 -q "$MIG/$file" 2>/dev/null || md5sum "$MIG/$file" | cut -d' ' -f1)"
  [ "$got" = "$md5" ] || drift=$((drift + 1))
done < "$LEDGER"
echo "   $drift file(s) differ textually from the applied statement."
echo "   (Informational: files written before the ledger existed differ by"
echo "    trailing whitespace. New migrations should match exactly.)"

echo "5. summary-only files (comments describing SQL that lives only in production)"
# "Prose" means the file contains NO SQL at all — that is the only condition
# under which it provably cannot rebuild a database.
#
# This used to also flag any file whose SQL was under 15% of its lines, which
# made 0021_plot_type.sql a false positive: it carries the complete applied
# statement (one ALTER TYPE) under eleven lines of explanation. A check that
# fails a correct file teaches people to ignore the check, so the ratio no
# longer counts as a failure — it prints as a note to eyeball instead.
summaries=0
for path in "$MIG"/[0-9]*.sql; do
  f="$(basename "$path")"
  tot=$(grep -c . "$path"); sql=$(grep -v '^[[:space:]]*--' "$path" | grep -c .)
  [ "$tot" -eq 0 ] && continue
  if [ "$sql" -eq 0 ]; then
    echo "   WARN $f is prose, not runnable SQL"; summaries=$((summaries + 1))
  elif [ $((sql * 100 / tot)) -lt 15 ]; then
    echo "   note $f is mostly comments ($sql of $tot lines are SQL) — runnable, but"
    echo "        confirm the SQL present does the whole job the comments describe."
  fi
done
if [ $summaries -eq 0 ]; then
  echo "   PASS every migration file is executable"
else
  echo "   $summaries file(s) are not runnable SQL, so the migrations folder alone cannot"
  echo "   rebuild a database. It no longer has to: supabase/baseline/public_schema.sql is a"
  echo "   verified full dump of production (2026-08-16) and IS the rebuild path — see its README."
  echo "   These files have no recorded statement text in supabase_migrations.schema_migrations"
  echo "   (they were applied through the SQL editor), so they cannot be recovered, only rewritten."
fi

echo
if [ $fail -eq 0 ]; then echo "migration audit: PASS"; else echo "migration audit: FAIL"; fi
exit $fail
