#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
PORT="${GNOME_MARKET_DROP_GRANT_TEST_PORT:-55446}"
MIGRATION="$ROOT/supabase/migrations/20260830013208_lock_public_market_drops_projection.sql"

if [ ! -x "$PGBIN/initdb" ]; then
  echo "PostgreSQL 17 not found at $PGBIN" >&2
  exit 2
fi

TMP="$(mktemp -d /tmp/gnome-market-drop-grants.XXXXXX)"
cleanup() {
  "$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

LC_ALL=C "$PGBIN/initdb" -D "$TMP/data" --no-locale --encoding=UTF8 --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$TMP/data" -l "$TMP/postgres.log" \
  -o "-k $TMP -p $PORT -c listen_addresses=''" start >/dev/null
export PGHOST="$TMP" PGPORT="$PORT" PGUSER="$(id -un)"
"$PGBIN/createdb" gnome_market_drop_grants
PSQL=("$PGBIN/psql" -d gnome_market_drop_grants -X -v ON_ERROR_STOP=1)

"${PSQL[@]}" -q <<'SQL'
create role anon nologin;
create role authenticated nologin;
grant anon, authenticated to current_user;

create table public.billing_config (
  id boolean primary key default true,
  payments_live_enabled boolean not null default false
);
insert into public.billing_config default values;

create table public.market_drops_fixture (
  id uuid,
  market_id uuid,
  title text,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  phase text,
  available_items bigint
);

create view public.public_market_drops as
select id, market_id, title, description, starts_at, ends_at, timezone, phase, available_items
from public.market_drops_fixture;

grant all on public.public_market_drops to public, anon, authenticated;
SQL

before="$(${PSQL[@]} -Atq -c "
  select count(*)
  from information_schema.role_table_grants
  where table_schema='public' and table_name='public_market_drops'
    and grantee in ('anon','authenticated') and privilege_type <> 'SELECT';")"
test "$before" -gt 0
echo "Market Drops broad-grant fixture: PASS"

"${PSQL[@]}" -q -f "$MIGRATION"

after="$(${PSQL[@]} -Atq -c "
  select count(*)
  from information_schema.role_table_grants
  where table_schema='public' and table_name='public_market_drops'
    and ((grantee in ('anon','authenticated') and privilege_type <> 'SELECT') or grantee='PUBLIC');")"
test "$after" -eq 0
test "$(${PSQL[@]} -Atq -c "select has_table_privilege('anon','public.public_market_drops','SELECT')")" = "t"
test "$(${PSQL[@]} -Atq -c "select has_table_privilege('authenticated','public.public_market_drops','SELECT')")" = "t"
test "$(${PSQL[@]} -Atq -c "select payments_live_enabled from public.billing_config")" = "f"
echo "Market Drops client grants are SELECT-only: PASS"
echo "payments_live_enabled remains false: PASS"

"${PSQL[@]}" -q -f "$MIGRATION"
echo "Market Drops grant repair is idempotent: PASS"
