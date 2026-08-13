#!/usr/bin/env bash
# Build a throwaway local database (shim + prerequisite fixture + 0091) and run
# the Founding Member suite against it. Also runs the CONCURRENCY phase, which
# needs real parallel client sessions and therefore cannot live inside a single
# psql script, and proves the paired down-migration both refuses a loaded
# roster and reverses cleanly when forced.
#
# Nothing here touches a hosted project: it refuses any non-local PGHOST and it
# creates/drops its own database.
#
#   supabase/tests/run_founding_member_tests.sh
set -uo pipefail

DB="${GNOME_FOUNDING_TEST_DB:-gnome_founding_test}"
HOST="${PGHOST:-/tmp}"
RACERS="${GNOME_FOUNDING_RACERS:-24}"      # distinct concurrent awards
DUPES="${GNOME_FOUNDING_DUPES:-8}"         # concurrent awards for ONE subscription
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}." >&2; exit 2; }

dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true
createdb -h "$HOST" "$DB"
trap 'dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true' EXIT

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$here/supabase_shim.sql" 2>&1 | grep -v NOTICE || true

# ---------------------------------------------------------------------------
# Prerequisite fixture: the production objects 0091 builds on. TEST FIXTURE
# ONLY — never applied to a hosted project. Shapes mirror production for the
# columns 0091 reads (introspected 2026-08-13 from fgybyghwcjlstqxkclch).
#
# Deliberate divergence from production: GNOME_GROWER_MONTHLY is given a LIVE
# price id here so the price-matching branch can be exercised. In production
# every stripe_price_id_live is NULL — which GNOME_FARM_MONTHLY reproduces, so
# both branches are covered.
# ---------------------------------------------------------------------------
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q <<'FIXTURE'
do $$ begin create type market_plan   as enum ('free','grower','farm','sponsor'); exception when duplicate_object then null; end $$;
do $$ begin create type market_status as enum ('active','paused','suspended','closed'); exception when duplicate_object then null; end $$;
do $$ begin create type market_type   as enum ('neighbor','grower','farm','business','market','municipality'); exception when duplicate_object then null; end $$;
do $$ begin create type listing_status as enum ('active','claimed','completed','expired','removed'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key, name text not null default 'Neighbor',
  created_at timestamptz not null default now()
);

create table if not exists public.markets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'My Market',
  plan market_plan not null default 'free',
  status market_status not null default 'active',
  city text, state text,
  created_at timestamptz not null default now()
);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  market_id uuid references public.markets(id) on delete set null,
  title text not null, category text not null default 'produce',
  status listing_status not null default 'active',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create table if not exists public.billing_products (
  key text primary key,
  kind text not null check (kind in ('subscription','one_time','addon')),
  description text not null,
  unit_amount_cents int, currency text not null default 'usd',
  stripe_product_id_test text, stripe_price_id_test text,
  stripe_product_id_live text, stripe_price_id_live text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.billing_products (key, kind, description, unit_amount_cents,
                                     stripe_price_id_test, stripe_price_id_live, active) values
  ('GNOME_GROWER_MONTHLY','subscription','Grower plan, monthly',999,'price_test_grower','price_live_grower',true),
  ('GNOME_FARM_MONTHLY','subscription','Farm plan, monthly',2999,'price_test_farm',null,true),
  ('GNOME_SEED_DROP_SEASONAL','subscription','Seed Drop seasonal',2499,'price_test_seed',null,true),
  ('GNOME_PICKUP_LOCATION_ADDON','addon','Extra pickup location',500,'price_test_pickup',null,true),
  ('GNOME_GROWER_SEED_BUNDLE','subscription','Retired bundle',19900,'price_test_bundle',null,false)
on conflict (key) do nothing;

create table if not exists public.billing_config (
  id boolean primary key default true check (id),
  payments_live_enabled boolean not null default false,
  stripe_mode text not null default 'test' check (stripe_mode in ('test','live')),
  updated_by uuid, updated_at timestamptz not null default now()
);
insert into public.billing_config (id) values (true) on conflict (id) do nothing;

create or replace function public.billing_price_id(p_key text, p_mode text)
returns text language sql stable security definer set search_path = public as $$
  select case when p_mode = 'live' then stripe_price_id_live else stripe_price_id_test end
    from public.billing_products where key = p_key;
$$;

-- 0075's shape exactly: the audit assertions read these column names.
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_type text not null default 'ADMIN'
    check (actor_type in ('OWNER','ADMIN','AI_AGENT','SYSTEM')),
  action text not null, resource_type text, resource_id text,
  old_state jsonb, new_state jsonb, reason text, approval_request_id uuid,
  created_at timestamptz not null default now()
);

-- Admin identity stubs driven by GUCs so one session can play owner,
-- permissioned admin and plain user in turn.
create or replace function public.admin_is_owner() returns boolean
language sql stable as $$
  select coalesce(current_setting('test.is_owner', true), 'false')::boolean
$$;
create or replace function public.admin_has_perm(p_perm text) returns boolean
language sql stable as $$
  select public.admin_is_owner()
      or p_perm = any(string_to_array(coalesce(current_setting('test.perms', true), ''), ','))
$$;
create or replace function public.is_admin() returns boolean
language sql stable as $$ select public.admin_is_owner() $$;

create or replace function public.admin_audit(
  p_action text, p_resource_type text, p_resource_id text,
  p_old jsonb default null, p_new jsonb default null,
  p_reason text default null, p_actor_type text default 'ADMIN',
  p_approval uuid default null
) returns void language sql security definer set search_path = public as $$
  insert into public.admin_audit_log
    (actor_id, actor_type, action, resource_type, resource_id, old_state, new_state, reason, approval_request_id)
  values (auth.uid(),
          case when public.admin_is_owner() and p_actor_type = 'ADMIN' then 'OWNER' else p_actor_type end,
          p_action, p_resource_type, p_resource_id, p_old, p_new, p_reason, p_approval);
$$;

grant select on public.profiles, public.markets, public.listings to anon, authenticated;
grant select on public.billing_products to anon, authenticated;

-- The single most important line in this fixture. Supabase hands anon and
-- authenticated these privileges on EVERY new table in `public` automatically
-- — verified 2026-08-13 against production, where billing_config still carries
-- REFERENCES and TRIGGER for both roles because 0083 revoked only
-- insert/update/delete. A plain local Postgres has no such default, so without
-- this line the grant assertions in the suite would pass vacuously and a
-- migration that forgot to revoke would ship. Everything 0091 creates from
-- here on is born over-granted, exactly as it would be in production.
alter default privileges in schema public
  grant select, insert, update, delete, references, trigger on tables to anon, authenticated;
FIXTURE

echo "applying 0091_founding_members.sql…"
# psql's exit status is the verdict here, not grep's — a clean apply prints
# only "drop policy ... skipping" notices, and grep exits 1 on an empty filter.
apply_log=$(psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q \
              -f "$MIG/0091_founding_members.sql" 2>&1) \
  || { echo "$apply_log" >&2; echo "0091 failed to apply" >&2; exit 1; }
echo "$apply_log" | grep -v 'NOTICE' || true

# ---------------------------------------------------------------------------
# CONCURRENCY PHASE — real parallel sessions, which is the only honest way to
# test the allocation lock. Results land in founding_concurrency_results, which
# the suite folds into its own verdict.
# ---------------------------------------------------------------------------
echo "running the concurrency phase (${RACERS} distinct + ${DUPES} duplicate awards)…"
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -Atq -c "
  select set_config('test.is_owner','true',false);
  insert into public.profiles (id, name)
  select ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid, 'Racer '||n
    from generate_series(1, ${RACERS} + 1) n;
  select public.admin_founding_set_program('{\"program_enabled\":true}'::jsonb);
" >/dev/null

race_one() {  # $1 = racer index
  psql -h "$HOST" -d "$DB" -Atq -c "
    begin;
    select public.founding_award_member(
      ('10000000-0000-0000-0000-'||lpad('$1',12,'0'))::uuid,
      'GNOME_GROWER_MONTHLY','price_live_grower','sub_race_$1','active',true,999,'evt_race_$1');
    select pg_sleep(0.05);
    commit;" >/dev/null 2>&1
}
for i in $(seq 1 "$RACERS"); do race_one "$i" & done
wait

# Same user, same subscription, N sessions at once: the duplicate-event race.
dupe_one() {
  psql -h "$HOST" -d "$DB" -Atq -c "
    begin;
    select public.founding_award_member(
      ('10000000-0000-0000-0000-'||lpad('$((RACERS + 1))',12,'0'))::uuid,
      'GNOME_GROWER_MONTHLY','price_live_grower','sub_dupe','active',true,999,'evt_dupe_$1');
    select pg_sleep(0.05);
    commit;" >/dev/null 2>&1
}
for i in $(seq 1 "$DUPES"); do dupe_one "$i" & done
wait

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q <<CONCURRENCY
create table public.founding_concurrency_results (label text, pass boolean, detail text);

insert into public.founding_concurrency_results
select 'T-RACE-01 ${RACERS} concurrent awards produced ${RACERS} distinct numbers',
       count(*) = ${RACERS} and count(distinct founding_number) = ${RACERS},
       count(*)||' rows, '||count(distinct founding_number)||' distinct numbers'
  from public.founding_members where current_subscription_id like 'sub\\_race\\_%';

insert into public.founding_concurrency_results
select 'T-RACE-02 numbers are contiguous 1..${RACERS} — no duplicates, no skips',
       min(founding_number) = 1 and max(founding_number) = ${RACERS}
         and count(*) = ${RACERS},
       'min '||min(founding_number)||', max '||max(founding_number)||', n '||count(*)
  from public.founding_members where current_subscription_id like 'sub\\_race\\_%';

insert into public.founding_concurrency_results
select 'T-RACE-03 ${DUPES} concurrent awards for ONE subscription awarded exactly once',
       count(*) = 1, count(*)||' row(s) for sub_dupe'
  from public.founding_members where current_subscription_id = 'sub_dupe';

insert into public.founding_concurrency_results
select 'T-RACE-04 the losing duplicate racers consumed no numbers',
       last_founding_number = ${RACERS} + 1,
       'high-water mark '||last_founding_number||', expected '||(${RACERS} + 1)
  from public.founding_program_config where id;

insert into public.founding_concurrency_results
select 'T-RACE-05 the counter equals the roster — no orphaned allocations',
       (select last_founding_number from public.founding_program_config where id)
         = (select max(founding_number) from public.founding_members),
       'counter '||(select last_founding_number from public.founding_program_config where id)
         ||', max awarded '||(select max(founding_number) from public.founding_members);

-- Reset for the single-session suite. Only possible because this harness runs
-- as the database owner on a throwaway database; no client role can do any of
-- this, and the high-water mark is not resettable through any shipped RPC.
delete from public.founding_members;
delete from public.admin_audit_log;
update public.founding_program_config
   set last_founding_number = 0, program_enabled = false, updated_at = now();
CONCURRENCY

echo
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -P pager=off -f "$here/founding_member_suite.sql" \
  | grep -vE '^(CREATE|GRANT|DO|SET|INSERT|UPDATE|DELETE|BEGIN|COMMIT|RESET)'
suite_status=0
fails=$(psql -h "$HOST" -d "$DB" -Atq -c "select count(*) from t where not pass" 2>/dev/null)
[ "${fails:-1}" = "0" ] || suite_status=1

echo
echo "re-applying 0091 (must be idempotent)…"
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q \
  -f "$MIG/0091_founding_members.sql" >/dev/null 2>&1 \
  && echo "   PASS 0091 re-applies cleanly" || { echo "   FAIL 0091 is not idempotent"; exit 1; }

n=$(psql -h "$HOST" -d "$DB" -Atq -c "select count(*) from public.founding_members")
hw=$(psql -h "$HOST" -d "$DB" -Atq -c "select last_founding_number from public.founding_program_config")
[ "$n" -gt 0 ] && echo "   PASS re-apply preserved the roster ($n members, high-water $hw)" \
               || { echo "   FAIL re-apply emptied the roster"; exit 1; }

echo "the down-migration must REFUSE while founders exist…"
if psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q \
     -f "$MIG/0091_down_founding_members.sql" >/dev/null 2>&1; then
  echo "   FAIL rollback destroyed $n founders without being forced"; exit 1
else
  echo "   PASS rollback refused with $n founders on the roster"
fi

echo "applying the paired down-migration with the explicit override…"
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q \
  -c "set gnome.founding_force_rollback = 'true'" \
  -f "$MIG/0091_down_founding_members.sql" >/dev/null 2>&1 \
  && echo "   PASS 0091 rolls back cleanly when forced" || { echo "   FAIL forced rollback failed"; exit 1; }

left=$(psql -h "$HOST" -d "$DB" -Atq -c "
  select (select count(*) from information_schema.tables
           where table_schema='public' and table_name in ('founding_members','founding_program_config'))
       + (select count(*) from information_schema.views
           where table_schema='public' and table_name = 'founding_badges')
       + (select count(*) from pg_proc p join pg_namespace s on s.oid=p.pronamespace
           where s.nspname='public' and p.proname like 'founding%')")
[ "$left" = "0" ] && echo "   PASS rollback removed every founding object" \
                  || { echo "   FAIL $left founding object(s) survived rollback"; exit 1; }

exit "$suite_status"
