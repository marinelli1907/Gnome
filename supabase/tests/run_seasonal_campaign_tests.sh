#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
pgbin="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
tmp="$(mktemp -d /tmp/gnome-seasonal-proof.XXXXXX)"
data="$tmp/data"
sock="$tmp/socket"
port=55449
mkdir -p "$sock"
cleanup() { "$pgbin/pg_ctl" -D "$data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT

LC_ALL=C "$pgbin/initdb" -D "$data" --no-locale --encoding=UTF8 --auth=trust >/dev/null
"$pgbin/pg_ctl" -D "$data" -l "$tmp/postgres.log" -o "-k $sock -p $port -c listen_addresses=''" start >/dev/null
export PGHOST="$sock" PGPORT="$port" PGUSER="$(id -un)"
createdb gnome_seasonal
echo "PG17 Seasonal Discovery clean room: $(psql -d gnome_seasonal -Atqc 'show server_version')"
psql -d gnome_seasonal -X -v ON_ERROR_STOP=1 -q -f "$here/supabase_shim.sql"
psql -d gnome_seasonal -X -v ON_ERROR_STOP=1 -q -c 'drop schema public cascade'
psql -d gnome_seasonal -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/baseline/public_schema.sql"
psql -d gnome_seasonal -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/migrations/0040_marketplace_taxonomy_seed.sql"
psql -d gnome_seasonal -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/migrations/20260903040036_seasonal_campaign_config.sql"
psql -d gnome_seasonal -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/migrations/20260903040040_seasonal_analytics_allowlist.sql"
psql -d gnome_seasonal -X -v ON_ERROR_STOP=1 -f "$here/seasonal_campaign_suite.sql"
echo "Seasonal Discovery clean-room suite: PASS"
