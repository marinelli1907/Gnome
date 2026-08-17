#!/usr/bin/env bash
# Behavioural tests for 0124 (§13 payment hardening), THROWAWAY local DB.
#
#   supabase/tests/run_payment_hardening_tests.sh
#
# Same prose-gap backfill as the other runners, with three deliberate
# differences — each of which is the point of this suite:
#
#  1. IT DOES NOT STUB market_effective_plan. Fourteen runners fabricate a
#     one-column `select m.plan from markets` stand-in. That stub IS the defect
#     0124 §1 repairs: it cannot express a complimentary admin_plan_grants row,
#     so every allowance suite built on it has been metering against a resolver
#     production does not use. 0124 recovers the real four-column resolver, and
#     `create or replace` cannot change a function's result type — so a stub
#     here would not merely weaken the suite, it would break the apply outright.
#
#  2. IT REPLAYS THE PRODUCTION OVER-GRANTS BEFORE 0124 RUNS. Supabase hands
#     anon/authenticated privileges on new objects that a plain local Postgres
#     never grants, and production granted billing_products writes at COLUMN
#     level (0124 §5). Without replaying that, the grant assertions would pass
#     vacuously against a database that was never over-granted in the first
#     place. The pre-flight below FAILS THE RUN if the over-grant did not take.
#
#  3. THE LOOP STOPS AT 0123 AND 0124 IS APPLIED EXPLICITLY AFTERWARDS (the
#     shape run_lifecycle_guard_tests.sh uses for 0123), so the suite still runs
#     when a prose-gap migration fails mid-chain. billing_config is one such
#     casualty — 0083 dies on market_promotion_credits — so the live-payments
#     gate is rebuilt below in 0083's exact shape before the mode guard can be
#     exercised at all.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"
HOST="${PGHOST:-/tmp}"

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}." >&2; exit 2; }

DB="gnome_payment_hardening_$$"
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

# --- prose-gap backfill, minimal production-equivalent shapes ---------------
# NOTE: market_effective_plan is deliberately absent from this block. See (1).
psql -h "$HOST" -d "$DB" -q -v ON_ERROR_STOP=1 <<'SQL'
alter table public.profiles add column if not exists suspended boolean not null default false;
alter table public.listings disable trigger listings_screen_content_trg;

-- 0083's live-payments gate. 0083 cannot apply in a clean rebuild (it dies on
-- market_promotion_credits), so the table it defines is recovered here in the
-- same shape. 0124's mode guard reads payments_live_enabled from it, and 0124's
-- own self-check skips the gate assertion when the table is missing — meaning
-- without this line the guard would be tested against an absent config and the
-- migration would silently under-assert itself.
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
-- (0083's billing_config_read policy is omitted: it depends on admin_has_perm,
--  another prose-gap casualty. Nothing in this suite reads it as a client.)

-- 0083's test/live price mapping. 0124 seeds keys and amounts ONLY, and the
-- suite asserts every stripe id column comes out NULL — which requires those
-- columns to exist, or the assertion is only checking the two legacy ones.
alter table public.billing_products
  add column if not exists stripe_product_id_test text,
  add column if not exists stripe_price_id_test   text,
  add column if not exists stripe_product_id_live text,
  add column if not exists stripe_price_id_live   text;

-- Prose-gap backfill: production grants exist for these; RLS is the boundary.
grant select, insert, update on public.listings to authenticated;
grant select on public.markets to authenticated;
grant usage on schema public to authenticated;

-- --- the pre-0124 production posture the migration exists to remove --------
-- Production granted billing_products writes at COLUMN level (0124 §5 names the
-- exact columns), plus the table-level grant Supabase applies by default. A
-- plain local Postgres grants neither, so replay both: the suite's job is to
-- prove REVOKE ALL clears the per-column entries too, and it cannot prove that
-- against a table that never had them.
grant insert (key, active, unit_amount_cents, stripe_price_id_test, stripe_price_id_live),
      update (key, active, unit_amount_cents, stripe_price_id_test, stripe_price_id_live)
  on public.billing_products to anon, authenticated;
grant insert, update on public.billing_products to anon, authenticated;

-- The IDOR 0124 closes: signed-in users could read any market's overage posture
-- by id. 0106 revoked it from public/anon only; production's Supabase default
-- left authenticated holding a direct EXECUTE.
grant execute on function public.listing_overage_required(uuid, uuid) to authenticated;
SQL

# The grant assertions must not be able to pass vacuously: fail loudly if the
# over-granted starting state did not actually take.
pre_cols="$(psql -h "$HOST" -d "$DB" -tAc "
  select count(*) from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'billing_products'
     and grantee in ('anon','authenticated')
     and privilege_type in ('INSERT','UPDATE','DELETE')")"
pre_exec="$(psql -h "$HOST" -d "$DB" -tAc "
  select has_function_privilege('authenticated','public.listing_overage_required(uuid, uuid)','execute')")"
[ "$pre_cols" -gt 0 ] || { echo "pre-flight: billing_products was never over-granted; grant checks would be vacuous." >&2; exit 1; }
[ "$pre_exec" = "t" ] || { echo "pre-flight: listing_overage_required was never client-executable; IDOR check would be vacuous." >&2; exit 1; }
echo "pre-flight: over-granted starting state in place (${pre_cols} client write column-privileges, IDOR open)"

# The hardening must be the head definition even if a prose-gap failure ate it.
psql -h "$HOST" -d "$DB" -q -v ON_ERROR_STOP=1 -f "$MIG/0124_payment_hardening.sql" >/dev/null

# 0124 must be intact after the apply.
for obj in plan_rank market_effective_plan authorization_mode_guard \
           expire_stale_publish_authorizations listing_lifecycle_guard; do
  psql -h "$HOST" -d "$DB" -tAc "select to_regproc('public.${obj}')" | grep -q . \
    || { echo "MISSING after build: ${obj}" >&2; exit 1; }
done
psql -h "$HOST" -d "$DB" -tAc "select to_regclass('public.admin_plan_grants')" | grep -q . \
  || { echo "MISSING after build: admin_plan_grants" >&2; exit 1; }

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -f "$here/payment_hardening_suite.sql"
