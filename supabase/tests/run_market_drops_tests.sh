#!/usr/bin/env bash
# Behavioural tests for 0117/0118 (Market Drops V1 + narrowed reserved title), against a THROWAWAY local database.
#
#   supabase/tests/run_market_drops_tests.sh
#
# Same prose-gap backfill as the other runners (see run_import_drafts_tests.sh header).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"
HOST="${PGHOST:-/tmp}"

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}." >&2; exit 2; }

DB="gnome_market_drops_$$"
cleanup() { dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

createdb -h "$HOST" "$DB"
psql -h "$HOST" -d "$DB" -q -f "$here/supabase_shim.sql" >/dev/null 2>&1

applied=0; failed=0
while IFS= read -r f; do
  n="$(basename "$f" | cut -c1-4)"
  case "$n" in ''|*[!0-9]*) continue ;; esac
  [ "$n" -le 0121 ] || continue
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

for fn in create_market_drop market_drop_phase ai_propose_action ai_confirm_action; do
  psql -h "$HOST" -d "$DB" -tAc "select to_regproc('public.${fn}')" | grep -q . \
    || { echo "MISSING after build: ${fn}" >&2; exit 1; }
done

# ----------------------------------------------------------------------------
# RACE — one create_drop pending action, two simultaneous confirms. The row lock
# must let exactly one execute; exactly ONE drop may exist afterwards.
# ----------------------------------------------------------------------------
psql -h "$HOST" -d "$DB" -q <<'SQL'
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000d1d1') on conflict do nothing;
delete from public.markets where owner_id = '00000000-0000-0000-0000-00000000d1d1';
insert into public.markets (id, owner_id, plan)
values ('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d1d1', 'sponsor');
insert into public.listings (id, owner_id, market_id, title, category, price_cents, unit, listing_type, status, expires_at)
values ('dddddddd-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d1d1',
        'dddddddd-0000-0000-0000-000000000001', 'Race Radishes', 'vegetables', 300, 'bunch',
        'sale', 'active', now() + interval '7 days');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d1d1","role":"authenticated"}';
insert into public.ai_pending_actions (id, owner_id, action, listing_ids, payload, summary)
values ('dddddddd-2222-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d1d1',
        'create_drop', array['dddddddd-1111-0000-0000-000000000001']::uuid[],
        '{"title":"Race Drop","starts_at":"2030-01-05T08:00:00Z","ends_at":"2030-01-05T13:00:00Z"}'::jsonb,
        'race create');
SQL
CONFIRM_SQL="set request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-00000000d1d1\",\"role\":\"authenticated\"}';
select public.ai_confirm_action('dddddddd-2222-0000-0000-000000000001');"
psql -h "$HOST" -d "$DB" -tAc "$CONFIRM_SQL" >/dev/null 2>&1 &
psql -h "$HOST" -d "$DB" -tAc "$CONFIRM_SQL" >/dev/null 2>&1 &
wait || true
drops="$(psql -h "$HOST" -d "$DB" -tAc "select count(*) from public.market_drops where title = 'Race Drop'")"
astate="$(psql -h "$HOST" -d "$DB" -tAc "select status from public.ai_pending_actions where id = 'dddddddd-2222-0000-0000-000000000001'")"
if [ "$drops" = "1" ] && [ "$astate" = "executed" ]; then
  echo "concurrency: PASS — double-confirm created exactly one drop"
else
  echo "concurrency: FAIL — drops=${drops} action=${astate}" >&2; exit 1
fi

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -f "$here/market_drops_suite.sql"
