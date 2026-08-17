#!/usr/bin/env bash
# Behavioural tests for 0114 (draft-publish lifetime) and 0115 (bulk import drafts), against a
# THROWAWAY local database.
#
#   supabase/tests/run_import_drafts_tests.sh
#
# Same prose-gap backfill as the allowance runner (see run_allowance_usage_tests.sh header):
# profiles.suspended and market_effective_plan(uuid) exist in production but their repo
# migrations are prose, so their minimal production-equivalent shapes are recreated here. The
# content screener's per-hour limiter is disabled for the same reason as in that suite.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"
HOST="${PGHOST:-/tmp}"

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}." >&2; exit 2; }

DB="gnome_imports_$$"
cleanup() { dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

createdb -h "$HOST" "$DB"
psql -h "$HOST" -d "$DB" -q -f "$here/supabase_shim.sql" >/dev/null 2>&1

applied=0; failed=0
while IFS= read -r f; do
  n="$(basename "$f" | cut -c1-4)"
  case "$n" in ''|*[!0-9]*) continue ;; esac
  [ "$n" -le 0115 ] || continue   # through 0114 (lifetime fix) and 0115 (create_import_drafts)
  if psql -h "$HOST" -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1; then
    applied=$((applied + 1))
  else
    failed=$((failed + 1))
  fi
done < <(ls "$MIG"/*.sql | grep -v '_down_' | sort)
echo "migrations: ${applied} applied, ${failed} failed (prose-gap cascade — see header)"

psql -h "$HOST" -d "$DB" -q <<'SQL'
alter table public.profiles add column if not exists suspended boolean not null default false;

create or replace function public.market_effective_plan(mid uuid)
returns table(plan public.market_plan)
language sql stable security definer set search_path = public
as $$ select m.plan from public.markets m where m.id = mid $$;

alter table public.listings disable trigger listings_screen_content_trg;
SQL

for fn in create_import_drafts publish_listing_draft market_allowance_usage; do
  psql -h "$HOST" -d "$DB" -tAc "select to_regproc('public.${fn}')" | grep -q . \
    || { echo "MISSING after build: ${fn}" >&2; exit 1; }
done

# The idempotency RACE: two backends submit the SAME approved batch concurrently. The unique
# index must let exactly one of each row land; both calls report a complete batch afterwards.
psql -h "$HOST" -d "$DB" -q <<'SQL'
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000e0e0') on conflict do nothing;
insert into public.markets (owner_id, plan) values ('00000000-0000-0000-0000-00000000e0e0', 'free');
SQL
RACE_SQL="set request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-00000000e0e0\",\"role\":\"authenticated\"}';
select (public.create_import_drafts('11111111-2222-3333-4444-555555555555',
 '[{\"product_name\":\"Race Carrots\",\"listing_type\":\"sale\",\"price_cents\":300,\"unit\":\"bunch\"},
   {\"product_name\":\"Race Kale\",\"listing_type\":\"sale\"}]'::jsonb)) ->> 'drafts_created';"
r1="$(psql -h "$HOST" -d "$DB" -tAc "$RACE_SQL" & psql -h "$HOST" -d "$DB" -tAc "$RACE_SQL" & wait)" || true
total="$(psql -h "$HOST" -d "$DB" -tAc "select count(*) from public.listing_drafts where import_request_id = '11111111-2222-3333-4444-555555555555'")"
if [ "$total" = "2" ]; then
  echo "concurrency: PASS — concurrent duplicate submission created exactly 2 drafts (not 4)"
else
  echo "concurrency: FAIL — expected 2 drafts after concurrent double-submit, found ${total}" >&2
  exit 1
fi

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -f "$here/import_drafts_suite.sql"
