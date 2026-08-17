#!/usr/bin/env bash
# §13 test-harness integrity: prove the load-bearing assertions FAIL when the
# protection they claim to prove is removed. A suite that has never been seen
# to fail is not evidence — it might be passing vacuously against a database
# where the protection never engaged (this repo has been bitten exactly that
# way: fourteen runners stubbing market_effective_plan proved metering against
# a resolver production does not use).
#
#   supabase/tests/run_mutation_integrity_tests.sh
#
# Builds one 0125-head template database, then for each MUTANT removes exactly
# one protection and re-runs the suite that claims to prove it:
#   M1  authorization_mode_guard_trg dropped      -> C5 must fail
#   M2  billing_products client writes re-granted -> C8a must fail
#   M3  listing_overage_required re-granted       -> C8c must fail
#   M4  listing_lifecycle_guard body emptied      -> C9a must fail
#   M5  expire_stale sweep neutered to a no-op    -> C6 must fail
#   M6  renew_listing reverted to its 0112 body   -> renew_window R1-R9 must fail
# The run FAILS if the baseline is not fully green, if a mutation does not
# apply, or if any mutant survives (its suite stays green).
#
# THROWAWAY local DBs only; honors PGHOST/PGPORT like the other runners.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"
HOST="${PGHOST:-/tmp}"

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}." >&2; exit 2; }

TPL="gnome_mut_template_$$"
declare -a CLONES=()
cleanup() {
  for d in "${CLONES[@]:-}"; do dropdb -h "$HOST" --if-exists "$d" >/dev/null 2>&1 || true; done
  dropdb -h "$HOST" --if-exists "$TPL" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ---- template: migrations to 0123, prose-gap backfill, 0124 + 0125 ---------
createdb -h "$HOST" "$TPL"
psql -h "$HOST" -d "$TPL" -q -f "$here/supabase_shim.sql" >/dev/null 2>&1
while IFS= read -r f; do
  n="$(basename "$f" | cut -c1-4)"
  case "$n" in ''|*[!0-9]*) continue ;; esac
  [ "$n" -le 0123 ] || continue
  psql -h "$HOST" -d "$TPL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1
done < <(ls "$MIG"/*.sql | grep -v '_down_' | sort)

# Prose-gap backfill (same shapes as run_payment_hardening_tests.sh, including
# the deliberate over-grants the grant suites must be able to see removed).
psql -h "$HOST" -d "$TPL" -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
alter table public.profiles add column if not exists suspended boolean not null default false;
alter table public.listings disable trigger listings_screen_content_trg;
create table if not exists public.billing_config (
  id boolean primary key default true check (id),
  payments_live_enabled boolean not null default false,
  stripe_mode text not null default 'test' check (stripe_mode in ('test','live')),
  updated_by uuid, updated_at timestamptz not null default now());
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
grant insert (key, active, unit_amount_cents, stripe_price_id_test, stripe_price_id_live),
      update (key, active, unit_amount_cents, stripe_price_id_test, stripe_price_id_live)
  on public.billing_products to anon, authenticated;
grant insert, update on public.billing_products to anon, authenticated;
grant execute on function public.listing_overage_required(uuid, uuid) to authenticated;
SQL
psql -h "$HOST" -d "$TPL" -q -v ON_ERROR_STOP=1 -f "$MIG/0124_payment_hardening.sql" >/dev/null 2>&1
psql -h "$HOST" -d "$TPL" -q -v ON_ERROR_STOP=1 -f "$MIG/0125_renew_expired_window.sql" >/dev/null
echo "template built"

overall=0

# run <label> <suite-file> <expect:green|fail> [mutation-sql]
run() {
  local label="$1" suite="$2" expect="$3" mut="${4:-}"
  local db="gnome_mut_${$}_${RANDOM}"
  CLONES+=("$db")
  createdb -h "$HOST" -T "$TPL" "$db" >/dev/null 2>&1 \
    || { echo "FAIL  $label — could not clone template" >&2; overall=1; return; }
  if [ -n "$mut" ]; then
    psql -h "$HOST" -d "$db" -q -v ON_ERROR_STOP=1 -c "$mut" >/dev/null 2>&1 \
      || { echo "FAIL  $label — mutation did not apply" >&2; overall=1; return; }
  fi
  local out; out="$(psql -h "$HOST" -d "$db" -f "$here/$suite" 2>&1)"
  local nfail; nfail="$(printf '%s' "$out" | grep -cE '\| f  \|')"
  if [ "$expect" = green ]; then
    if [ "$nfail" -eq 0 ] && printf '%s' "$out" | grep -q "passed"; then
      echo "PASS  $label (fully green)"
    else
      echo "FAIL  $label — baseline must be green, $nfail check(s) failed" >&2; overall=1
    fi
  else
    if [ "$nfail" -gt 0 ]; then
      echo "PASS  $label — suite detected the mutant ($nfail check(s) failed):"
      printf '%s' "$out" | grep -E '\| f  \|' | sed 's/^ *[0-9]* | /        - /; s/ *| f .*//'
    else
      echo "FAIL  $label — MUTANT SURVIVED: the suite stayed green with the protection removed" >&2
      overall=1
    fi
  fi
  dropdb -h "$HOST" --if-exists "$db" >/dev/null 2>&1 || true
}

echo "== baseline: both suites fully green on the unmutated head =="
run "baseline payment_hardening" payment_hardening_suite.sql green
run "baseline renew_window"      renew_window_suite.sql      green

echo "== mutants: one protection removed each; its assertions must fail =="
run "M1 mode-mismatch guard dropped" payment_hardening_suite.sql fail \
  "drop trigger authorization_mode_guard_trg on public.listing_publish_authorizations"
run "M2 billing_products writes re-granted" payment_hardening_suite.sql fail \
  "grant insert (key, active, unit_amount_cents), update (key, active, unit_amount_cents) on public.billing_products to anon, authenticated"
run "M3 listing_overage_required re-granted" payment_hardening_suite.sql fail \
  "grant execute on function public.listing_overage_required(uuid, uuid) to authenticated"
run "M4 lifecycle guard emptied (FOREIGN_MARKET gone)" payment_hardening_suite.sql fail \
  "create or replace function public.listing_lifecycle_guard() returns trigger language plpgsql as \$\$ begin return new; end \$\$"
run "M5 stale-authorization sweep neutered" payment_hardening_suite.sql fail \
  "create or replace function public.expire_stale_publish_authorizations(p_older_than interval default '24:00:00') returns integer language sql as \$\$ select 0 \$\$"
run "M6 renew_listing reverted to 0112 (the window reopened)" renew_window_suite.sql fail \
  "create or replace function public.renew_listing(p_listing uuid) returns table (ok boolean, expires_at timestamptz, funded text) language plpgsql security definer set search_path = public as \$fn\$
declare l public.listings; days int; ev record;
begin
  select * into l from public.listings where id = p_listing for update;
  if not found then raise exception 'LISTING_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.markets m where m.id = l.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_YOUR_LISTING' using errcode = 'P0001'; end if;
  if l.status = 'active' and (l.expires_at is null or l.expires_at > now()) then
    select e.funded into ev from public.listing_publish_events e where e.listing_id = p_listing order by e.occurred_at desc limit 1;
    ok := true; expires_at := l.expires_at; funded := coalesce(ev.funded, 'included'); return next; return; end if;
  select coalesce(pl.listing_lifetime_days, 7) into days from public.market_effective_plan(l.market_id) ep join public.plan_limits pl on pl.plan = ep.plan;
  update public.listings set status = 'active', expires_at = now() + make_interval(days => coalesce(days, 7)) where id = p_listing;
  select e.funded into ev from public.listing_publish_events e where e.listing_id = p_listing order by e.occurred_at desc limit 1;
  ok := true; expires_at := now() + make_interval(days => coalesce(days, 7)); funded := coalesce(ev.funded, 'included'); return next;
end \$fn\$"

[ "$overall" -eq 0 ] && echo "mutation integrity: all mutants detected" || echo "mutation integrity: FAILURES ABOVE" >&2
exit "$overall"
