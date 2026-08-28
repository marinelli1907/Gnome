#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
pgbin="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
tmp="$(mktemp -d /tmp/gnome-claim-reservation-dependency.XXXXXX)"
data="$tmp/data"; sock="$tmp/socket"; port=55443
mkdir -p "$sock"
cleanup() { "$pgbin/pg_ctl" -D "$data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT

LC_ALL=C "$pgbin/initdb" -D "$data" --no-locale --encoding=UTF8 --auth=trust >/dev/null
"$pgbin/pg_ctl" -D "$data" -l "$tmp/postgres.log" -o "-k $sock -p $port -c listen_addresses=''" start >/dev/null
export PGHOST="$sock" PGPORT="$port" PGUSER="$(id -un)"
createdb gnome_claim_reservation_dependency
echo "PG17 Claim Reservation Dependency clean room: $(psql -d gnome_claim_reservation_dependency -Atqc 'show server_version')"

psql -d gnome_claim_reservation_dependency -X -v ON_ERROR_STOP=1 -q -f "$here/supabase_shim.sql"
psql -d gnome_claim_reservation_dependency -X -v ON_ERROR_STOP=1 -q -c 'drop schema public cascade'
psql -d gnome_claim_reservation_dependency -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/baseline/public_schema.sql"

psql -d gnome_claim_reservation_dependency -X -v ON_ERROR_STOP=1 -q <<'SQL'
insert into public.plan_limits(plan,max_active_listings,max_photos,analytics,featured,delivery_eligible,price_cents,
 included_boost_credits,max_pickup_locations,extra_location_fee_cents,ai_listing_assistant,advanced_delivery,
 display_name,monthly_publish_allowance,included_renewals_per_period,wanted_intros_per_day,qr_tools,
 listing_lifetime_days,max_sale_publishes_per_hour) values
 ('free',5,5,false,false,false,0,0,1,null,false,false,'Free',3,0,1,false,7,12),
 ('grower',25,10,true,true,false,999,3,2,500,true,true,'Pro',20,3,5,true,7,30),
 ('farm',null,10,true,true,true,2999,10,5,null,true,true,'Farm',40,10,15,true,7,60),
 ('sponsor',null,10,true,true,true,9900,10,10,null,true,true,'Legacy Farm',null,null,null,true,7,120)
on conflict(plan) do update set display_name = excluded.display_name;
insert into public.billing_products(key,kind,description,unit_amount_cents,currency,active)
values('GNOME_SPONSOR_MONTHLY','subscription','Legacy Farm plan, retired',9900,'usd',false)
on conflict(key) do nothing;
insert into public.billing_config(id,payments_live_enabled,stripe_mode) values(true,false,'test')
on conflict(id) do update set payments_live_enabled=false, stripe_mode='test';
SQL

for migration in 0126_three_tier_pricing.sql 0127_hide_wanted_from_public.sql; do
  printf 'apply %-62s' "$migration"
  psql -d gnome_claim_reservation_dependency -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/migrations/$migration"
  echo PASS
done

psql -d gnome_claim_reservation_dependency -X -v ON_ERROR_STOP=1 -q <<'SQL'
insert into auth.users (id,email,email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000911','historical-seller@test.invalid',now()),
  ('00000000-0000-0000-0000-000000000912','historical-buyer@test.invalid',now());
insert into public.profiles (id,name)
values
  ('00000000-0000-0000-0000-000000000911','Historical seller'),
  ('00000000-0000-0000-0000-000000000912','Historical buyer');
insert into public.listings
  (id,owner_id,market_id,title,category,listing_type,price_cents,status,expires_at,inventory_count,city,state)
select
  '30000000-0000-0000-0000-000000000911',
  '00000000-0000-0000-0000-000000000911',
  m.id,
  'Historical reservation listing',
  'vegetables',
  'sale',
  500,
  'active',
  now() + interval '30 days',
  9,
  'Columbus',
  'OH'
from public.markets m
where m.owner_id='00000000-0000-0000-0000-000000000911'
limit 1;
insert into public.claims
  (id,listing_id,claimer_id,status,claim_type,quantity_requested,agreed_price_cents,payment_status)
values
  ('40000000-0000-0000-0000-000000000911',
   '30000000-0000-0000-0000-000000000911',
   '00000000-0000-0000-0000-000000000912',
   'pending',
   'purchase_request',
   2,
   1000,
   'external');
SQL

printf 'apply %-62s' '20260824131202_claim_reservations.sql'
psql -d gnome_claim_reservation_dependency -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/migrations/20260824131202_claim_reservations.sql"
echo PASS

psql -d gnome_claim_reservation_dependency -X -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
begin
  if not exists (
    select 1
      from public.claims c
      join public.listings l on l.id = c.listing_id
     where c.id = '40000000-0000-0000-0000-000000000911'
       and c.status = 'pending'
       and c.pickup_start is null
       and c.pickup_end is null
       and c.payment_method is null
       and l.inventory_count = 9
       and not exists (
         select 1 from public.seller_transactions t
          where t.claim_id = c.id
       )
  ) then
    raise exception 'historical claim changed during reservation migration';
  end if;
  raise notice 'PASS: historical claim remains valid with unknown pickup/payment data';
end
$$;
SQL

for migration in \
  20260824145211_zordy_daily_allowance.sql \
  20260824192500_block_unverified_restricted_listing_drafts.sql \
  20260824200500_listing_harvest_date.sql \
  20260824204821_p0_account_readiness_gates.sql
do
  printf 'apply %-62s' "$migration"
  psql -d gnome_claim_reservation_dependency -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/migrations/$migration"
  echo PASS
done

psql -d gnome_claim_reservation_dependency -X -v ON_ERROR_STOP=1 -f "$here/claim_reservations_suite.sql"
echo "Claim reservation dependency clean-room suite: PASS"
