#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
pgbin="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
tmp="$(mktemp -d /tmp/gnome-subscriptions.XXXXXX)"
data="$tmp/data"; sock="$tmp/socket"; port=55443
mkdir -p "$sock"
cleanup() { "$pgbin/pg_ctl" -D "$data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT

LC_ALL=C "$pgbin/initdb" -D "$data" --no-locale --encoding=UTF8 --auth=trust >/dev/null
"$pgbin/pg_ctl" -D "$data" -l "$tmp/postgres.log" -o "-k $sock -p $port -c listen_addresses=''" start >/dev/null
export PGHOST="$sock" PGPORT="$port" PGUSER="$(id -un)"
createdb gnome_subscriptions
echo "PG17 unified subscriptions clean room: $(psql -d gnome_subscriptions -Atqc 'show server_version')"
psql -d gnome_subscriptions -X -v ON_ERROR_STOP=1 -q -f "$here/supabase_shim.sql"
psql -d gnome_subscriptions -X -v ON_ERROR_STOP=1 -q -c 'drop schema public cascade'
psql -d gnome_subscriptions -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/baseline/public_schema.sql"
psql -d gnome_subscriptions -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/migrations/0043_compliance_storage_and_gate.sql"
psql -d gnome_subscriptions -X -v ON_ERROR_STOP=1 -q <<'SQL'
insert into public.plan_limits(plan,max_active_listings,max_photos,analytics,featured,delivery_eligible,price_cents,
 included_boost_credits,max_pickup_locations,extra_location_fee_cents,ai_listing_assistant,advanced_delivery,
 display_name,monthly_publish_allowance,included_renewals_per_period,wanted_intros_per_day,qr_tools,
 listing_lifetime_days,max_sale_publishes_per_hour) values
 ('free',5,5,false,false,false,0,0,1,null,false,false,'Free',3,0,1,false,7,12),
 ('grower',25,10,true,true,false,999,3,2,500,true,true,'Pro',20,3,5,true,7,30),
 ('farm',null,10,true,true,true,2999,10,5,null,true,true,'Farm',40,10,15,true,7,60),
 ('sponsor',null,10,true,true,true,9900,10,10,null,true,true,'Legacy Farm',null,null,null,true,7,120)
on conflict(plan) do update set display_name=excluded.display_name,price_cents=excluded.price_cents;
insert into public.billing_products(key,kind,description,unit_amount_cents,currency,active)
 values('GNOME_SPONSOR_MONTHLY','subscription','Legacy Farm plan, retired',9900,'usd',false)
on conflict(key) do nothing;
insert into public.billing_config(id,payments_live_enabled,stripe_mode) values(true,false,'test')
on conflict(id) do update set payments_live_enabled=false,stripe_mode='test';
insert into public.promotion_campaigns(code,campaign_name,active,applicable_plans,discount_type,
 discount_percent,duration,duration_in_months,max_redemptions_per_user,new_customers_only,
 stripe_promotion_code_id,internal_notes)
values('FOUNDING3','Founding Seller - first 3 months free',true,array['grower']::public.market_plan[],
 'percent',100,'repeating',3,1,false,'promo_legacy_founding3','Clean-room fixture')
on conflict(code) do nothing;
SQL

migrations=(
  0126_three_tier_pricing.sql 0127_hide_wanted_from_public.sql
  20260824131202_claim_reservations.sql 20260824145211_zordy_daily_allowance.sql
  20260824192500_block_unverified_restricted_listing_drafts.sql 20260824200500_listing_harvest_date.sql
  20260824204821_p0_account_readiness_gates.sql 20260824210401_listing_performance_and_archive.sql
  20260825090000_seller_concierge.sql 20260825093000_entitlement_promo_hardening.sql
  20260825100000_boon_agent_actions.sql 20260825141308_seller_claim_verification_and_market_visibility.sql
  20260825145559_seller_concierge_claim_preview_ambiguity_fix.sql
  20260825151517_seller_concierge_qa_tombstone_and_claim_state.sql
  20260825160000_growth_referrals.sql 20260825163500_growth_public_view_grants.sql
  20260825204308_unified_native_subscriptions.sql
  20260827130544_fix_verified_subscription_readiness_gate.sql
  20260828035457_fix_email_readiness_after_otp.sql
  20260828045652_paid_market_storefront_visits.sql
)
for migration in "${migrations[@]}"; do
  printf 'apply %-64s' "$migration"
  psql -d gnome_subscriptions -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/migrations/$migration"
  echo PASS
done
psql -d gnome_subscriptions -X -v ON_ERROR_STOP=1 -f "$here/unified_subscriptions_suite.sql"
psql -d gnome_subscriptions -X -v ON_ERROR_STOP=1 -f "$here/market_storefront_visits_suite.sql"

# Fire the same provider event from two sessions. The first transaction owns
# the event key; the retry blocks, then returns DUPLICATE without a second row.
call="select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false); select public.record_verified_subscription('APPLE','b1000000-0000-4000-8000-000000000001','gnome.pro.monthly','apple-concurrent-original','apple-concurrent-transaction','active','SANDBOX',now(),now()+interval '1 month',false,now()+interval '1 month','apple-concurrent-event','DID_RENEW','hash-concurrent');"
psql -d gnome_subscriptions -X -v ON_ERROR_STOP=1 -Atqc "$call" >"$tmp/concurrent-1" & p1=$!
psql -d gnome_subscriptions -X -v ON_ERROR_STOP=1 -Atqc "$call" >"$tmp/concurrent-2" & p2=$!
wait "$p1" "$p2"
test "$(cat "$tmp/concurrent-1" "$tmp/concurrent-2" | grep -c '"outcome": "PROCESSED"')" -eq 1
test "$(cat "$tmp/concurrent-1" "$tmp/concurrent-2" | grep -c '"outcome": "DUPLICATE"')" -eq 1
test "$(psql -d gnome_subscriptions -Atqc "select count(*) from public.subscription_provider_events where provider='APPLE' and external_event_id='apple-concurrent-event'")" -eq 1
test "$(psql -d gnome_subscriptions -Atqc "select count(*) from public.market_subscriptions where billing_source='APPLE' and external_transaction_id='apple-concurrent-original'")" -eq 1
echo "Concurrent provider replay: PASS"
echo "Unified subscriptions clean-room suite: PASS"
