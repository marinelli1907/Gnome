#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
pgbin="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
tmp="$(mktemp -d /tmp/gnome-seller-proof.XXXXXX)"
data="$tmp/data"; sock="$tmp/socket"; port=55441
mkdir -p "$sock"
cleanup() { "$pgbin/pg_ctl" -D "$data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT

LC_ALL=C "$pgbin/initdb" -D "$data" --no-locale --encoding=UTF8 --auth=trust >/dev/null
"$pgbin/pg_ctl" -D "$data" -l "$tmp/postgres.log" -o "-k $sock -p $port -c listen_addresses=''" start >/dev/null
export PGHOST="$sock" PGPORT="$port" PGUSER="$(id -un)"
createdb gnome_seller
echo "PG17 Seller Concierge clean room: $(psql -d gnome_seller -Atqc 'show server_version')"
psql -d gnome_seller -X -v ON_ERROR_STOP=1 -q -f "$here/supabase_shim.sql"
psql -d gnome_seller -X -v ON_ERROR_STOP=1 -q -c 'drop schema public cascade'
psql -d gnome_seller -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/baseline/public_schema.sql"
psql -d gnome_seller -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/migrations/0043_compliance_storage_and_gate.sql"
psql -d gnome_seller -X -v ON_ERROR_STOP=1 -q <<'SQL'
insert into public.plan_limits(plan,max_active_listings,max_photos,analytics,featured,delivery_eligible,price_cents,
 included_boost_credits,max_pickup_locations,extra_location_fee_cents,ai_listing_assistant,advanced_delivery,
 display_name,monthly_publish_allowance,included_renewals_per_period,wanted_intros_per_day,qr_tools,
 listing_lifetime_days,max_sale_publishes_per_hour) values
 ('free',5,5,false,false,false,0,0,1,null,false,false,'Free',3,0,1,false,7,12),
 ('grower',25,10,true,true,false,999,3,2,500,true,true,'Pro',20,3,5,true,7,30),
 ('farm',null,10,true,true,true,2999,10,5,null,true,true,'Max',40,10,15,true,7,60),
 ('sponsor',null,10,true,true,true,9900,10,10,null,true,true,'Farm',null,null,null,true,7,120);
insert into public.billing_products(key,kind,description,unit_amount_cents,currency,active)
 values('GNOME_SPONSOR_MONTHLY','subscription','Farm plan (internal enum sponsor), monthly',9900,'usd',true);
insert into public.billing_config(id,payments_live_enabled,stripe_mode) values(true,false,'test');
insert into public.promotion_campaigns(code,campaign_name,active,applicable_plans,discount_type,
 discount_percent,duration,duration_in_months,max_redemptions_per_user,new_customers_only,
 stripe_promotion_code_id,internal_notes)
values('FOUNDING3','Founding Seller — first 3 months free',true,array['grower']::public.market_plan[],
 'percent',100,'repeating',3,1,false,'promo_legacy_founding3','Clean-room fixture')
on conflict(code) do nothing;
SQL

for migration in \
  0126_three_tier_pricing.sql 0127_hide_wanted_from_public.sql \
  20260824131202_claim_reservations.sql 20260824145211_zordy_daily_allowance.sql \
  20260824192500_block_unverified_restricted_listing_drafts.sql 20260824200500_listing_harvest_date.sql \
  20260824204821_p0_account_readiness_gates.sql 20260824210401_listing_performance_and_archive.sql \
  20260825090000_seller_concierge.sql \
  20260825093000_entitlement_promo_hardening.sql 20260825100000_boon_agent_actions.sql \
  20260825141308_seller_claim_verification_and_market_visibility.sql \
  20260825145559_seller_concierge_claim_preview_ambiguity_fix.sql \
  20260825151517_seller_concierge_qa_tombstone_and_claim_state.sql \
  20260825160000_growth_referrals.sql \
  20260825161151_gnome_executive_organization.sql \
  20260825163500_growth_public_view_grants.sql \
  20260828035457_fix_email_readiness_after_otp.sql
do
  printf 'apply %-64s' "$migration"
  psql -d gnome_seller -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/migrations/$migration"
  echo PASS
done

psql -d gnome_seller -X -v ON_ERROR_STOP=1 -f "$here/seller_acquisition_suite.sql"
psql -d gnome_seller -X -v ON_ERROR_STOP=1 -f "$here/referral_growth_suite.sql"

# Two independent database sessions contend for the final campaign slot. The
# advisory lock plus reservation rows must produce exactly one winner.
out1="$tmp/promo-1"; out2="$tmp/promo-2"
psql -d gnome_seller -X -Atqc "select ok from public.promo_reserve_checkout('QACAP1','grower','a1000000-0000-0000-0000-000000000002',(select id from public.markets where owner_id='a1000000-0000-0000-0000-000000000002'))" >"$out1" & p1=$!
psql -d gnome_seller -X -Atqc "select ok from public.promo_reserve_checkout('QACAP1','grower','a1000000-0000-0000-0000-000000000005',(select id from public.markets where owner_id='a1000000-0000-0000-0000-000000000005'))" >"$out2" & p2=$!
wait "$p1"; wait "$p2"
winners="$(cat "$out1" "$out2" | grep -c '^t$' || true)"
[ "$winners" = 1 ] || { echo "FAIL: concurrent promo cap winners=$winners" >&2; exit 1; }
echo "PASS: concurrent promo reservation cap has one winner"
[ "$(psql -d gnome_seller -Atqc 'select payments_live_enabled from public.billing_config where id')" = f ]
echo "Seller acquisition clean-room suite: PASS"
