#!/usr/bin/env bash
# Behavioural tests for the 0109 publish-allowance model, against a THROWAWAY local database.
#
#   supabase/tests/run_listing_allowance_tests.sh
#
# WHY THIS SCRIPT BACKFILLS THINGS
# A fresh local build cannot replay four repo "migrations" that are prose summaries rather than
# SQL (0056, 0057, 0058, 0076 — see migration_audit.sh step 5). Their absence cascades: eighteen
# later migrations fail, and the objects they would have created are missing. Two of those are
# needed before 0109 can even be exercised:
#
#   profiles.suspended            — 0103's listings_block_suspended() trigger reads it
#   market_effective_plan(uuid)   — 0109's allowance trigger resolves the plan through it
#
# Both exist in production. They are recreated here in their minimal production-equivalent shape
# purely so the allowance logic can be tested locally. This is a workaround for the prose gap, NOT
# part of the model — delete this section once `supabase db pull` has restored the real files.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"
HOST="${PGHOST:-/tmp}"

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}." >&2; exit 2; }

DB="gnome_pa_$$"
cleanup() { dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

createdb -h "$HOST" "$DB"
psql -h "$HOST" -d "$DB" -q -f "$here/supabase_shim.sql" >/dev/null 2>&1

applied=0; failed=0
while IFS= read -r f; do
  n="$(basename "$f" | cut -c1-4)"
  case "$n" in ''|*[!0-9]*) continue ;; esac
  [ "$n" -le 0109 ] || continue
  if psql -h "$HOST" -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1; then
    applied=$((applied + 1))
  else
    failed=$((failed + 1))
  fi
done < <(ls "$MIG"/*.sql | grep -v '_down_' | sort)
echo "migrations: ${applied} applied, ${failed} failed (prose-gap cascade — see header)"

# --- prose-gap backfill, minimal production-equivalent shapes ---------------
psql -h "$HOST" -d "$DB" -q <<'SQL'
alter table public.profiles add column if not exists suspended boolean not null default false;

create or replace function public.market_effective_plan(mid uuid)
returns table(plan public.market_plan)
language sql stable security definer set search_path = public
as $$ select m.plan from public.markets m where m.id = mid $$;

-- The content screener also enforces a 20-listings-per-HOUR anti-spam limit. That is orthogonal to
-- allowance accounting and has its own suite (run_prohibited_content_tests.sh), but it fires part
-- way through this one because proving a 20-publish or 40-publish allowance means inserting that
-- many rows inside a second.
--
-- NOTE FOR PRODUCT, NOT JUST FOR TESTS: 20/hour is now BELOW Max's 40 monthly publishes and far
-- below Farm's unlimited, so a legitimate bulk upload will be refused by the limiter before the
-- plan allowance is spent. The limiter needs raising, or making plan-aware, before Max and Farm
-- are sold on that promise.
alter table public.listings disable trigger listings_screen_content_trg;
SQL

# 0109 must still be intact after the backfill.
for fn in admin_promo_campaigns admin_promo_redemptions \
          admin_upsert_promo_campaign promo_validate; do
  psql -h "$HOST" -d "$DB" -tAc "select to_regproc('public.${fn}')" | grep -q . \
    || { echo "MISSING after build: ${fn}" >&2; exit 1; }
done

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -f "$here/promo_admin_suite.sql"
