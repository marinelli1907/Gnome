#!/usr/bin/env bash
# Behavioural tests for 0120 (Drop Alerts), against a THROWAWAY local database.
#
#   supabase/tests/run_drop_alerts_tests.sh
#
# pg_net does not exist locally, so this runner installs a CAPTURE SHIM with
# pg_net's signature: net.http_post records every would-be Expo request into
# net._sent and returns a request id; the suite then plants synthetic Expo
# responses in net._http_response and drives the reconciler against them.
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

DB="gnome_drop_alerts_$$"
cleanup() { dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

createdb -h "$HOST" "$DB"
psql -h "$HOST" -d "$DB" -q -f "$here/supabase_shim.sql" >/dev/null 2>&1

applied=0; failed=0
while IFS= read -r f; do
  n="$(basename "$f" | cut -c1-4)"
  case "$n" in ''|*[!0-9]*) continue ;; esac
  [ "$n" -le 0123 ] || continue
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

-- Prose-gap backfill: production grants exist for these; RLS is the boundary.
grant select, insert, update, delete on public.market_follows to authenticated;
grant select, insert, update, delete on public.device_tokens to authenticated;

-- -----------------------------------------------------------------------
-- pg_net CAPTURE SHIM (same callable signature as the real extension)
-- -----------------------------------------------------------------------
create schema if not exists net;
create sequence if not exists net._req_seq;
create table if not exists net._sent (
  id bigint primary key,
  url text,
  body jsonb,
  headers jsonb,
  created timestamptz default now()
);
create table if not exists net._http_response (
  id bigint primary key,
  status_code int,
  content text,
  error_msg text,
  created timestamptz default now()
);
create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds int default 5000)
returns bigint language plpgsql as $$
declare rid bigint := nextval('net._req_seq');
begin
  insert into net._sent (id, url, body, headers) values (rid, url, body, headers);
  return rid;
end $$;
SQL

# 0120 must have applied AFTER the shim exists for full-path testing; re-apply
# it now that net.http_post resolves (create or replace is idempotent).
psql -h "$HOST" -d "$DB" -q -v ON_ERROR_STOP=1 -f "$MIG/0120_drop_alerts.sql" >/dev/null
# ...and 0122 patches dispatch (availability gate) ON TOP of 0120 — keep last.
psql -h "$HOST" -d "$DB" -q -v ON_ERROR_STOP=1 -f "$MIG/0122_drop_polish.sql" >/dev/null

for fn in drop_alert_dispatch drop_alert_reconcile drop_alert_run; do
  psql -h "$HOST" -d "$DB" -tAc "select to_regproc('public.${fn}')" | grep -q . \
    || { echo "MISSING after build: ${fn}" >&2; exit 1; }
done

# ----------------------------------------------------------------------------
# RACE — two overlapping dispatchers claim the same live drop. The unique
# (drop_id, user_id) boundary must leave exactly ONE delivery per recipient.
# ----------------------------------------------------------------------------
psql -h "$HOST" -d "$DB" -q <<'SQL'
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000da0a'),
  ('00000000-0000-0000-0000-00000000da0b') on conflict do nothing;
delete from public.markets where owner_id = '00000000-0000-0000-0000-00000000da0a';
insert into public.markets (id, owner_id, plan)
values ('da200117-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000da0a', 'free');
insert into public.market_drops (id, market_id, created_by, title, starts_at, ends_at, status)
values ('da200117-1111-0000-0000-000000000001', 'da200117-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-00000000da0a', 'Race Alert Drop',
        now() - interval '5 minutes', now() + interval '55 minutes', 'scheduled');
insert into public.market_follows (market_id, follower_id, drop_alerts_enabled)
values ('da200117-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000da0b', true)
on conflict (market_id, follower_id) do update set drop_alerts_enabled = true;
insert into public.device_tokens (token, user_id, platform)
values ('ExponentPushToken[race-b]', '00000000-0000-0000-0000-00000000da0b', 'ios')
on conflict do nothing;
-- 0122: dispatch only announces drops with something available.
insert into public.listings (id, owner_id, market_id, title, category, price_cents, unit, listing_type, status, expires_at)
values ('da200117-2222-0000-0000-000000000001', '00000000-0000-0000-0000-00000000da0a', 'da200117-0000-0000-0000-000000000001',
        'Race Radishes', 'vegetables', 200, 'bunch', 'sale', 'active', now() + interval '7 days')
on conflict (id) do update set status = 'active', expires_at = now() + interval '7 days';
insert into public.market_drop_items (drop_id, listing_id)
values ('da200117-1111-0000-0000-000000000001', 'da200117-2222-0000-0000-000000000001')
on conflict do nothing;
SQL
psql -h "$HOST" -d "$DB" -tAc "select public.drop_alert_dispatch()" >/dev/null 2>&1 &
psql -h "$HOST" -d "$DB" -tAc "select public.drop_alert_dispatch()" >/dev/null 2>&1 &
wait || true
rows="$(psql -h "$HOST" -d "$DB" -tAc "select count(*) from public.drop_alert_deliveries where drop_id = 'da200117-1111-0000-0000-000000000001'")"
msgs="$(psql -h "$HOST" -d "$DB" -tAc "select count(*) from public.drop_alert_messages m join public.drop_alert_deliveries d on d.id = m.delivery_id where d.drop_id = 'da200117-1111-0000-0000-000000000001'")"
if [ "$rows" = "1" ] && [ "$msgs" = "1" ]; then
  echo "concurrency: PASS — overlapping dispatchers claimed the recipient exactly once"
else
  echo "concurrency: FAIL — deliveries=${rows} messages=${msgs}" >&2; exit 1
fi

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -f "$here/drop_alerts_suite.sql"
