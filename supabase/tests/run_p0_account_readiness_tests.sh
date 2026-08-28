#!/usr/bin/env bash
# PG17 clean-room proof for the proposed P0 account-readiness migration.
# Uses the repository's canonical public-schema baseline, restores the managed
# Storage policy layer omitted by that public-only dump, applies every later
# migration through P0, runs adversarial SQL tests, and deletes the test cluster.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
pgbin="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"

if [ ! -x "$pgbin/postgres" ]; then
  echo "Postgres 17 not found at $pgbin" >&2
  exit 2
fi
major="$($pgbin/postgres --version | grep -oE '[0-9]+' | head -1)"
if [ "$major" -ne 17 ]; then
  echo "P0 clean room requires Postgres 17; found $major" >&2
  exit 2
fi

tmp="$(mktemp -d /tmp/gnome-p0-proof.XXXXXX)"
data="$tmp/data"
sock="$tmp/socket"
port=55433
mkdir -p "$sock"

cleanup() {
  "$pgbin/pg_ctl" -D "$data" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

LC_ALL=C "$pgbin/initdb" -D "$data" --no-locale --encoding=UTF8 --auth=trust >/dev/null
"$pgbin/pg_ctl" -D "$data" -l "$tmp/postgres.log" \
  -o "-k $sock -p $port -c listen_addresses=''" start >/dev/null
export PGHOST="$sock" PGPORT="$port" PGUSER="$(id -un)"

createdb gnome_p0
echo "PG17 clean room: $(psql -d gnome_p0 -Atqc 'show server_version')"

psql -d gnome_p0 -X -v ON_ERROR_STOP=1 -q -f "$here/supabase_shim.sql"
# The production dump owns creation of public; remove only the empty default
# schema from this throwaway database before restoring it.
psql -d gnome_p0 -X -v ON_ERROR_STOP=1 -q -c 'drop schema public cascade'
psql -d gnome_p0 -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/baseline/public_schema.sql"

# public_schema.sql intentionally excludes Storage schema policies. Restore the
# compliance-docs layer from its canonical migration for the privacy tests.
psql -d gnome_p0 -X -v ON_ERROR_STOP=1 -q \
  -f "$root/supabase/migrations/0043_compliance_storage_and_gate.sql"

# A schema-only baseline has no reference rows. Seed the exact pre-0126 plan
# posture required by 0126's self-check, plus the payment kill switch in TEST.
psql -d gnome_p0 -X -v ON_ERROR_STOP=1 -q <<'SQL'
insert into public.plan_limits
  (plan,max_active_listings,max_photos,analytics,featured,delivery_eligible,price_cents,
   included_boost_credits,max_pickup_locations,extra_location_fee_cents,
   ai_listing_assistant,advanced_delivery,display_name,monthly_publish_allowance,
   included_renewals_per_period,wanted_intros_per_day,qr_tools,listing_lifetime_days,
   max_sale_publishes_per_hour)
values
  ('free',5,5,false,false,false,0,0,1,null,false,false,'Free',3,0,1,false,7,12),
  ('grower',25,10,true,true,false,999,3,2,500,true,true,'Pro',20,3,5,true,7,30),
  ('farm',null,10,true,true,true,2999,10,5,null,true,true,'Max',40,10,15,true,7,60),
  ('sponsor',null,10,true,true,true,9900,10,10,null,true,true,'Farm',null,null,null,true,7,120);
insert into public.billing_products
  (key,kind,description,unit_amount_cents,currency,active)
values ('GNOME_SPONSOR_MONTHLY','subscription','Farm plan (internal enum sponsor), monthly',9900,'usd',true);
insert into public.billing_config (id,payments_live_enabled,stripe_mode)
values (true,false,'test');
SQL

for migration in \
  0126_three_tier_pricing.sql \
  0127_hide_wanted_from_public.sql \
  20260824131202_claim_reservations.sql \
  20260824145211_zordy_daily_allowance.sql \
  20260824192500_block_unverified_restricted_listing_drafts.sql \
  20260824200500_listing_harvest_date.sql
do
  printf 'apply %-62s' "$migration"
  psql -d gnome_p0 -X -v ON_ERROR_STOP=1 -q \
    -f "$root/supabase/migrations/$migration"
  echo PASS
done

# A listing that already exists before readiness gates are installed must stay
# public and byte-for-byte intact after the migration. This models the hosted
# transition without copying production data into the clean room.
psql -d gnome_p0 -X -v ON_ERROR_STOP=1 -q <<'SQL'
insert into auth.users (id,email,email_confirmed_at)
values ('00000000-0000-0000-0000-000000000901','transition@test.invalid',now());
insert into public.profiles (id,name)
values ('00000000-0000-0000-0000-000000000901','Transition fixture');
insert into public.listings
  (id,owner_id,market_id,title,category,listing_type,price_cents,status,expires_at,inventory_count,city,state)
select
  '30000000-0000-0000-0000-000000000901',
  '00000000-0000-0000-0000-000000000901',
  m.id,
  'Existing transition listing',
  'vegetables',
  'sale',
  500,
  'active',
  now() + interval '30 days',
  17,
  'Columbus',
  'OH'
from public.markets m
where m.owner_id='00000000-0000-0000-0000-000000000901'
limit 1;
SQL

printf 'apply %-62s' '20260824204821_p0_account_readiness_gates.sql'
psql -d gnome_p0 -X -v ON_ERROR_STOP=1 -q \
  -f "$root/supabase/migrations/20260824204821_p0_account_readiness_gates.sql"
echo PASS

# Reapplying the canonical harvest repair proves its IF-NOT-EXISTS and view
# replacement behavior are safe after the later readiness migration too.
printf 'reapply %-60s' '20260824200500_listing_harvest_date.sql'
psql -d gnome_p0 -X -v ON_ERROR_STOP=1 -q \
  -f "$root/supabase/migrations/20260824200500_listing_harvest_date.sql"
echo PASS

psql -d gnome_p0 -X -v ON_ERROR_STOP=1 -q -f "$here/harvest_date_suite.sql"
psql -d gnome_p0 -X -v ON_ERROR_STOP=1 -q -f "$here/p0_account_readiness_suite.sql"
psql -d gnome_p0 -X -v ON_ERROR_STOP=1 -q -f "$here/claim_reservations_suite.sql"

payments="$(psql -d gnome_p0 -X -Atqc "select payments_live_enabled from public.billing_config where id")"
[ "$payments" = "f" ] || { echo "payments_live_enabled changed" >&2; exit 1; }
echo "P0 account-readiness clean-room suite: PASS"
