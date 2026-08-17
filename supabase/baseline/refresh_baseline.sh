#!/usr/bin/env bash
# Refresh supabase/baseline/public_schema.sql from production.
#
#   supabase/baseline/refresh_baseline.sh
#
# OWNER-RUN. This is the one step in the rebuild path that needs the production
# database password, which is why it is a local script and not something the
# assistant runs: the password is read straight into the pg_dump child process
# and is never echoed, never logged, never written to disk, and never placed in
# the shell history or the process argument list.
#
# Why this exists (§13): the committed baseline was captured 2026-08-16, before
# migrations 0104-0123 were applied on 2026-08-17. The baseline IS the declared
# rebuild path (see README.md), so today a fresh rebuild silently reproduces the
# schema as of 0103 — no allowance model, no Drops alerts, no Bundles, no
# lifecycle guard, no payment hardening.
#
# Rules this script enforces so the refresh cannot quietly go wrong:
#   * Postgres 17 client tools. pg_dump refuses to dump a server newer than
#     itself, and production runs 17.6.
#   * PRIVILEGES ARE INCLUDED. --no-privileges is never passed. A dump without
#     them looks complete and restores a subtly broken database — the exact
#     column-grant failure mode this repo has already been bitten by twice.
#   * The new dump is validated BEFORE it replaces the known-good file, and the
#     previous baseline is kept as .bak until the new one passes.
#   * Any failure exits non-zero and leaves the committed baseline untouched.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$here/public_schema.sql"
TMP="$(mktemp -t gnome_baseline)"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

PGDUMP="${PGDUMP:-/opt/homebrew/opt/postgresql@17/bin/pg_dump}"
HOST="aws-1-us-east-2.pooler.supabase.com"
PORT="5432"
USER="postgres.fgybyghwcjlstqxkclch"
DB="postgres"

# --- 1. Postgres 17 client tools -------------------------------------------
if [ ! -x "$PGDUMP" ]; then
  echo "error: Postgres 17 pg_dump not found at $PGDUMP" >&2
  echo "       brew install postgresql@17   (or set PGDUMP=/path/to/pg_dump)" >&2
  exit 2
fi
ver="$("$PGDUMP" --version | grep -oE '[0-9]+' | head -1)"
if [ "$ver" -lt 17 ]; then
  echo "error: $PGDUMP is version $ver; production is 17.6 and pg_dump cannot dump a newer server." >&2
  exit 2
fi

# --- 2. Password, read locally and never persisted --------------------------
# Accept an already-exported PGPASSWORD/SUPABASE_DB_PASSWORD for automation;
# otherwise prompt with echo off. Either way it only ever lives in this
# process's environment and is handed to pg_dump through PGPASSWORD, never on
# the command line (where `ps` would expose it).
PW="${PGPASSWORD:-${SUPABASE_DB_PASSWORD:-}}"
if [ -z "$PW" ]; then
  printf 'Supabase database password (input hidden): ' >&2
  read -r -s PW < /dev/tty
  printf '\n' >&2
fi
if [ -z "$PW" ]; then
  echo "error: no password supplied; nothing was dumped." >&2
  exit 2
fi

# --- 3. Dump: schema-only, public, WITH privileges --------------------------
echo "Dumping production public schema with Postgres $ver client tools…" >&2
if ! PGPASSWORD="$PW" "$PGDUMP" \
      -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" \
      --schema-only --schema=public --no-owner \
      -f "$TMP"; then
  echo "error: pg_dump failed; the committed baseline was NOT modified." >&2
  exit 1
fi
unset PW

# --- 4. Validate before replacing the known-good file -----------------------
fail() { echo "error: $1 — refusing to replace the committed baseline." >&2; exit 1; }

[ -s "$TMP" ] || fail "the dump is empty"

# Privileges must be present. This is the check that catches a --no-privileges
# style dump, which is the failure mode the README warns about.
grants="$(grep -c '^GRANT ' "$TMP" || true)"
[ "$grants" -ge 100 ] || fail "only $grants GRANT statements — privileges look missing"

# Per-COLUMN grants specifically: `GRANT SELECT(col)` is how listings is locked
# down, and losing them is the silent breakage this repo has hit before.
colgrants="$(grep -cE '^GRANT [A-Z]+\(' "$TMP" || true)"
[ "$colgrants" -ge 1 ] || fail "no column-level GRANTs — the per-column posture would be lost"

# The dump must contain the objects the current head introduced, or it is not
# actually current. One UNAMBIGUOUS marker per recent phase — deliberately not
# generic names: `stripe_livemode` for instance already exists on seed_orders,
# listing_promotions and market_subscriptions, so it would match a stale dump,
# and market_effective_plan dates from 2026-08-10 and is in the old baseline too.
for obj in \
  enforce_publish_allowance \
  drop_alert_dispatch \
  create_market_bundle \
  listing_lifecycle_guard \
  authorization_mode_guard \
  expire_stale_publish_authorizations
do
  grep -q "$obj" "$TMP" || fail "the dump has no '$obj' — it is not current"
done

# --- 5. Install ------------------------------------------------------------
if [ -f "$OUT" ]; then cp "$OUT" "$OUT.bak"; fi
mv "$TMP" "$OUT"
trap - EXIT

lines="$(wc -l < "$OUT" | tr -d ' ')"
echo >&2
echo "Baseline refreshed: $OUT" >&2
echo "  $lines lines, $grants GRANT statements ($colgrants column-level)" >&2
[ -f "$OUT.bak" ] && echo "  previous baseline kept at $OUT.bak" >&2
echo >&2
echo "Next: tell Claude it is done. It will run the PG17 clean-room restore and" >&2
echo "verify objects, grants and behaviour against production." >&2
