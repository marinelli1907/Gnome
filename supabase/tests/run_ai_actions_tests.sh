#!/usr/bin/env bash
# Behavioural tests for 0116 (AI market-management action layer), against a THROWAWAY local
# database.
#
#   supabase/tests/run_ai_actions_tests.sh
#
# Same prose-gap backfill as the import runner (see run_import_drafts_tests.sh header):
# profiles.suspended and market_effective_plan(uuid) exist in production but their repo
# migrations are prose, so minimal production-equivalent shapes are recreated here, and the
# content screener's per-hour limiter is disabled.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"
HOST="${PGHOST:-/tmp}"

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}." >&2; exit 2; }

DB="gnome_ai_actions_$$"
cleanup() { dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

createdb -h "$HOST" "$DB"
psql -h "$HOST" -d "$DB" -q -f "$here/supabase_shim.sql" >/dev/null 2>&1

applied=0; failed=0
while IFS= read -r f; do
  n="$(basename "$f" | cut -c1-4)"
  case "$n" in ''|*[!0-9]*) continue ;; esac
  [ "$n" -le 0116 ] || continue
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

for fn in ai_find_my_listings ai_my_inventory ai_set_price ai_mark_sold ai_propose_action ai_confirm_action renew_listing; do
  psql -h "$HOST" -d "$DB" -tAc "select to_regproc('public.${fn}')" | grep -q . \
    || { echo "MISSING after build: ${fn}" >&2; exit 1; }
done

# ----------------------------------------------------------------------------
# RACE 1 — one pending action, two simultaneous confirms. The FOR UPDATE on the
# action row must let exactly one execute; the other sees ACTION_ALREADY_executed.
# ----------------------------------------------------------------------------
psql -h "$HOST" -d "$DB" -q <<'SQL'
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000e1e1') on conflict do nothing;
delete from public.markets where owner_id = '00000000-0000-0000-0000-00000000e1e1';
insert into public.markets (id, owner_id, plan)
values ('eeeeeeee-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e1e1', 'grower');
insert into public.listings (id, owner_id, market_id, title, category, price_cents, unit, listing_type, status, expires_at)
values ('eeeeeeee-1111-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e1e1',
        'eeeeeeee-0000-0000-0000-000000000001', 'Race Radishes', 'vegetables', 300, 'bunch',
        'sale', 'active', now() + interval '7 days');
update public.listings set status = 'expired', expires_at = now() - interval '1 day'
 where id = 'eeeeeeee-1111-0000-0000-000000000001';
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000e1e1","role":"authenticated"}';
insert into public.ai_pending_actions (id, owner_id, action, listing_ids, payload, summary)
values ('eeeeeeee-2222-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e1e1',
        'renew', array['eeeeeeee-1111-0000-0000-000000000001']::uuid[], '{}', 'race confirm');
SQL
CONFIRM_SQL="set request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-00000000e1e1\",\"role\":\"authenticated\"}';
select public.ai_confirm_action('eeeeeeee-2222-0000-0000-000000000001');"
psql -h "$HOST" -d "$DB" -tAc "$CONFIRM_SQL" >/dev/null 2>&1 &
psql -h "$HOST" -d "$DB" -tAc "$CONFIRM_SQL" >/dev/null 2>&1 &
wait || true
renewals="$(psql -h "$HOST" -d "$DB" -tAc "select count(*) from public.listing_publish_events where listing_id = 'eeeeeeee-1111-0000-0000-000000000001' and kind = 'renewal'")"
astate="$(psql -h "$HOST" -d "$DB" -tAc "select status from public.ai_pending_actions where id = 'eeeeeeee-2222-0000-0000-000000000001'")"
if [ "$renewals" = "1" ] && [ "$astate" = "executed" ]; then
  echo "concurrency 1: PASS — double-confirm executed exactly once (1 renewal event, action executed)"
else
  echo "concurrency 1: FAIL — renewals=${renewals} action=${astate}" >&2; exit 1
fi

# ----------------------------------------------------------------------------
# RACE 2 — two separate pending renew actions for the SAME listing, confirmed
# concurrently. renew_listing's row lock + idempotent-when-fresh guard (0112) must
# spend exactly one renewal; the loser returns the current expiry untouched.
# ----------------------------------------------------------------------------
psql -h "$HOST" -d "$DB" -q <<'SQL'
insert into public.listings (id, owner_id, market_id, title, category, price_cents, unit, listing_type, status, expires_at)
values ('eeeeeeee-1111-0000-0000-000000000002', '00000000-0000-0000-0000-00000000e1e1',
        'eeeeeeee-0000-0000-0000-000000000001', 'Race Rhubarb', 'vegetables', 300, 'bunch',
        'sale', 'active', now() + interval '7 days');
update public.listings set status = 'expired', expires_at = now() - interval '1 day'
 where id = 'eeeeeeee-1111-0000-0000-000000000002';
insert into public.ai_pending_actions (id, owner_id, action, listing_ids, payload, summary) values
 ('eeeeeeee-2222-0000-0000-000000000002', '00000000-0000-0000-0000-00000000e1e1',
  'renew', array['eeeeeeee-1111-0000-0000-000000000002']::uuid[], '{}', 'race renew A'),
 ('eeeeeeee-2222-0000-0000-000000000003', '00000000-0000-0000-0000-00000000e1e1',
  'renew', array['eeeeeeee-1111-0000-0000-000000000002']::uuid[], '{}', 'race renew B');
SQL
C1="set request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-00000000e1e1\",\"role\":\"authenticated\"}';
select public.ai_confirm_action('eeeeeeee-2222-0000-0000-000000000002');"
C2="set request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-00000000e1e1\",\"role\":\"authenticated\"}';
select public.ai_confirm_action('eeeeeeee-2222-0000-0000-000000000003');"
psql -h "$HOST" -d "$DB" -tAc "$C1" >/dev/null 2>&1 &
psql -h "$HOST" -d "$DB" -tAc "$C2" >/dev/null 2>&1 &
wait || true
renewals="$(psql -h "$HOST" -d "$DB" -tAc "select count(*) from public.listing_publish_events where listing_id = 'eeeeeeee-1111-0000-0000-000000000002' and kind = 'renewal'")"
lstate="$(psql -h "$HOST" -d "$DB" -tAc "select status from public.listings where id = 'eeeeeeee-1111-0000-0000-000000000002'")"
if [ "$renewals" = "1" ] && [ "$lstate" = "active" ]; then
  echo "concurrency 2: PASS — concurrent renewals of one listing spent exactly one renewal"
else
  echo "concurrency 2: FAIL — renewals=${renewals} listing=${lstate}" >&2; exit 1
fi

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -f "$here/ai_actions_suite.sql"
