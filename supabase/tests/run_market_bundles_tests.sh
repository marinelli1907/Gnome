#!/usr/bin/env bash
# Behavioural tests for 0121 (Gift Baskets / Bundles V1), THROWAWAY local DB.
#
#   supabase/tests/run_market_bundles_tests.sh
#
# Same prose-gap backfill as the other runners.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"
HOST="${PGHOST:-/tmp}"

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}." >&2; exit 2; }

DB="gnome_market_bundles_$$"
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
alter table public.listings disable trigger listings_screen_content_trg;

create or replace function public.market_effective_plan(mid uuid)
returns table(plan public.market_plan)
language sql stable security definer set search_path = public
as $$ select m.plan from public.markets m where m.id = mid $$;

grant select, insert, update, delete on public.market_follows to authenticated;
grant select, insert, update, delete on public.device_tokens to authenticated;
SQL

# 0121 may have partially applied before helper backfills existed; re-apply.
psql -h "$HOST" -d "$DB" -q -v ON_ERROR_STOP=1 -f "$MIG/0121_market_bundles.sql" >/dev/null

for fn in create_market_bundle bundle_components_available ai_confirm_action; do
  psql -h "$HOST" -d "$DB" -tAc "select to_regproc('public.${fn}')" | grep -q . \
    || { echo "MISSING after build: ${fn}" >&2; exit 1; }
done

# ----------------------------------------------------------------------------
# RACE — one create_bundle pending action, two simultaneous confirms.
# Row lock must admit exactly one; exactly ONE bundle may exist afterwards.
# ----------------------------------------------------------------------------
psql -h "$HOST" -d "$DB" -q <<'SQL'
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000b1b1') on conflict do nothing;
delete from public.markets where owner_id = '00000000-0000-0000-0000-00000000b1b1';
insert into public.markets (id, owner_id, plan)
values ('bb210117-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b1b1', 'sponsor');
insert into public.listings (id, owner_id, market_id, title, category, price_cents, unit, listing_type, status, expires_at)
values
 ('bb210117-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b1b1',
  'bb210117-0000-0000-0000-000000000001', 'Race Eggs', 'eggs', 500, 'dozen', 'sale', 'active', now() + interval '7 days'),
 ('bb210117-1111-0000-0000-000000000002', '00000000-0000-0000-0000-00000000b1b1',
  'bb210117-0000-0000-0000-000000000001', 'Race Bread', 'bakery', 700, 'loaf', 'sale', 'active', now() + interval '7 days');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b1b1","role":"authenticated"}';
insert into public.ai_pending_actions (id, owner_id, action, listing_ids, payload, summary)
values ('bb210117-2222-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b1b1',
        'create_bundle',
        array['bb210117-1111-0000-0000-000000000001','bb210117-1111-0000-0000-000000000002']::uuid[],
        '{"title":"Race Basket","price_cents":2500}'::jsonb,
        'race bundle');
SQL
CONFIRM_SQL="set request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-00000000b1b1\",\"role\":\"authenticated\"}';
select public.ai_confirm_action('bb210117-2222-0000-0000-000000000001');"
psql -h "$HOST" -d "$DB" -tAc "$CONFIRM_SQL" >/dev/null 2>&1 &
psql -h "$HOST" -d "$DB" -tAc "$CONFIRM_SQL" >/dev/null 2>&1 &
wait || true
bundles="$(psql -h "$HOST" -d "$DB" -tAc "select count(*) from public.listings where title = 'Race Basket' and is_bundle")"
astate="$(psql -h "$HOST" -d "$DB" -tAc "select status from public.ai_pending_actions where id = 'bb210117-2222-0000-0000-000000000001'")"
if [ "$bundles" = "1" ] && [ "$astate" = "executed" ]; then
  echo "concurrency: PASS — double-confirm created exactly one bundle"
else
  echo "concurrency: FAIL — bundles=${bundles} action=${astate}" >&2; exit 1
fi

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -f "$here/market_bundles_suite.sql"
