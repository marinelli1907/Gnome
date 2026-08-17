#!/usr/bin/env bash
# Behavioural tests for 0125 (the active-but-expired renew window), THROWAWAY local DB.
#
#   supabase/tests/run_renew_window_tests.sh
#
# Shares run_payment_hardening_tests.sh's shape, and its most important
# property: IT DOES NOT STUB market_effective_plan. R6 asserts that a
# complimentary admin_plan_grants row is metered against the GRANTED plan, which
# the one-column stub fourteen other runners install cannot express — under that
# stub R6 would read 'free' and the suite would prove the opposite of what it
# claims. 0124 §1 recovered the real four-column resolver; this suite uses it.
#
# The loop stops at 0123 and applies 0124 then 0125 explicitly, so the suite
# still runs when a prose-gap migration fails mid-chain (0083 dies on
# market_promotion_credits, taking billing_config with it — rebuilt below,
# because 0124's authorization mode guard reads it and R4 consumes a paid
# authorization through that guard).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"
HOST="${PGHOST:-/tmp}"
PORT="${PGPORT:-5432}"

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" -p "$PORT" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}:${PORT}." >&2; exit 2; }

DB="gnome_renew_window_$$"
cleanup() { dropdb -h "$HOST" -p "$PORT" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql() { command psql -h "$HOST" -p "$PORT" "$@"; }

createdb -h "$HOST" -p "$PORT" "$DB"
psql -d "$DB" -q -f "$here/supabase_shim.sql" >/dev/null 2>&1

applied=0; failed=0
while IFS= read -r f; do
  n="$(basename "$f" | cut -c1-4)"
  case "$n" in ''|*[!0-9]*) continue ;; esac
  [ "$n" -le 0123 ] || continue
  if psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1; then
    applied=$((applied + 1))
  else
    failed=$((failed + 1))
  fi
done < <(ls "$MIG"/*.sql | grep -v '_down_' | sort)
echo "migrations: ${applied} applied, ${failed} failed (prose-gap cascade — see header)"

# --- prose-gap backfill, minimal production-equivalent shapes ---------------
# NOTE: market_effective_plan is deliberately absent from this block. See header.
psql -d "$DB" -q -v ON_ERROR_STOP=1 <<'SQL'
alter table public.profiles add column if not exists suspended boolean not null default false;
alter table public.listings disable trigger listings_screen_content_trg;

-- 0083's live-payments gate: 0124's authorization mode guard reads it, and R4
-- consumes a paid authorization through that guard.
create table if not exists public.billing_config (
  id boolean primary key default true check (id),
  payments_live_enabled boolean not null default false,
  stripe_mode text not null default 'test' check (stripe_mode in ('test','live')),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.billing_config (id) values (true) on conflict (id) do nothing;
alter table public.billing_config enable row level security;
revoke insert, update, delete on public.billing_config from anon, authenticated;
grant select on public.billing_config to authenticated;

alter table public.billing_products
  add column if not exists stripe_product_id_test text,
  add column if not exists stripe_price_id_test   text,
  add column if not exists stripe_product_id_live text,
  add column if not exists stripe_price_id_live   text;

grant select, insert, update on public.listings to authenticated;
grant select on public.markets to authenticated;
grant usage on schema public to authenticated;
SQL

psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$MIG/0124_payment_hardening.sql" >/dev/null
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$MIG/0125_renew_expired_window.sql" >/dev/null
echo "head applied: 0124 + 0125"

# The suite is meaningless if the resolver it depends on is the stub or absent.
res="$(psql -d "$DB" -tAc "select pg_get_function_result('public.market_effective_plan(uuid)'::regprocedure)")"
[ "$res" = "TABLE(plan market_plan, source text, grant_id uuid, grant_expires timestamp with time zone)" ] \
  || { echo "pre-flight: market_effective_plan is not the real four-column resolver ($res)" >&2; exit 1; }

# ...and meaningless if the allowance trigger that does the metering is missing:
# every check would pass by accident on a database that meters nothing.
psql -d "$DB" -tAc "
  select count(*) from pg_trigger
   where tgrelid='public.listings'::regclass and tgname='trg_enforce_publish_allowance'
     and not tgisinternal" | grep -qx 1 \
  || { echo "pre-flight: trg_enforce_publish_allowance not attached; metering checks would be vacuous." >&2; exit 1; }
echo "pre-flight: real resolver + allowance trigger in place"

psql -d "$DB" -v ON_ERROR_STOP=1 -f "$here/renew_window_suite.sql"
