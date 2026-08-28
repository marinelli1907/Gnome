-- Listing performance, privacy, and archive integrity. Run on a throwaway DB
-- after 20260824210401_listing_performance_and_archive.sql.

\set ON_ERROR_STOP on
set client_min_messages = warning;

begin;

create temporary table _listing_performance_results (
  n int generated always as identity,
  name text,
  ok boolean,
  detail text
);

create or replace function pg_temp.ck(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into _listing_performance_results (name, ok, detail)
  values (p_name, coalesce(p_ok, false), p_detail);
end $$;

create or replace function pg_temp.ck_raises(p_name text, p_sql text, p_fragment text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform pg_temp.ck(p_name, false, 'expected exception, none raised');
  exception when others then
    perform pg_temp.ck(p_name, position(p_fragment in sqlerrm) > 0, left(sqlerrm, 160));
  end;
end $$;

do $$
declare
  seller uuid := '02104010-0000-0000-0000-000000000001';
  viewers uuid[] := array[
    '02104010-0000-0000-0000-000000000011'::uuid,
    '02104010-0000-0000-0000-000000000012'::uuid,
    '02104010-0000-0000-0000-000000000013'::uuid,
    '02104010-0000-0000-0000-000000000014'::uuid,
    '02104010-0000-0000-0000-000000000015'::uuid
  ];
  v_market_id uuid := '02104010-1000-0000-0000-000000000001';
  v_listing_id uuid := '02104010-2000-0000-0000-000000000001';
  v_historical_id uuid := '02104010-2000-0000-0000-000000000002';
  v_claim_id uuid := '02104010-3000-0000-0000-000000000001';
  viewer uuid;
	  result jsonb;
	  historical jsonb;
	  n integer;
	  historical_active public.listings;
	begin
	  select * into historical_active
	    from public.listings
	   where id = '02104010-2000-0000-0000-000000000099';
	  perform pg_temp.ck('existing active account-not-ready listing survives migration unchanged',
	    historical_active.status = 'active'
	      and historical_active.inventory_count = 7
	      and historical_active.analytics_started_at is null,
	    coalesce(row_to_json(historical_active)::text, 'missing'));

	  insert into auth.users (id, email, phone, email_confirmed_at, phone_confirmed_at)
  values (seller, 'seller-performance@test.invalid', '+15550001001', now(), now())
  on conflict (id) do update set
    email_confirmed_at = excluded.email_confirmed_at,
    phone = excluded.phone,
    phone_confirmed_at = excluded.phone_confirmed_at;

  foreach viewer in array viewers loop
    insert into auth.users (id, email, phone, email_confirmed_at, phone_confirmed_at)
    values (
      viewer,
      replace(viewer::text, '-', '') || '@viewer.test.invalid',
      '+1555' || right(replace(viewer::text, '-', ''), 7),
      now(),
      now()
    )
    on conflict (id) do nothing;
  end loop;

  insert into public.profiles (id, name)
  values (seller, 'Performance Seller')
  on conflict (id) do nothing;
  foreach viewer in array viewers loop
    insert into public.profiles (id, name)
    values (viewer, 'Aggregate Viewer')
    on conflict (id) do nothing;
  end loop;

  if to_regclass('public.account_policy_acceptances') is not null then
    execute $ready$
      insert into public.account_policy_acceptances
        (user_id, terms_version, privacy_version, marketplace_rules_version,
         age_policy_version, age_confirmed_18)
      select p.id, v.terms_version, v.privacy_version, v.marketplace_rules_version,
             v.age_policy_version, true
        from public.profiles p
        cross join public.account_policy_versions v
       where p.id = $1 or p.id = any($2)
      on conflict (user_id) do update set
        terms_version = excluded.terms_version,
        privacy_version = excluded.privacy_version,
        marketplace_rules_version = excluded.marketplace_rules_version,
        age_policy_version = excluded.age_policy_version,
        age_confirmed_18 = true
    $ready$ using seller, viewers;
  end if;

  insert into public.markets (id, owner_id, name, plan, status)
  values (v_market_id, seller, 'Performance Market', 'farm', 'active');

  insert into public.listings
    (id, owner_id, market_id, title, category, listing_type, status,
     price_cents, unit, inventory_count, expires_at)
  values
    (v_listing_id, seller, v_market_id, 'Performance Tomatoes', 'vegetables', 'sale',
     'active', 250, 'lb', 10, now() + interval '7 days'),
    (v_historical_id, seller, v_market_id, 'Historical Tomatoes', 'vegetables', 'sale',
     'expired', 250, 'lb', 4, now() - interval '7 days');

  update public.listings set analytics_started_at = null where id = v_historical_id;

  -- Five legitimate viewers. Viewer 1 refreshes immediately; the second event
  -- is suppressed by the 30-minute dedupe window.
  foreach viewer in array viewers loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
    insert into public.events (event_type, user_id, listing_id, metadata)
    values ('listing_viewed', viewer, v_listing_id, '{"source":"detail"}');
  end loop;
  viewer := viewers[1];
  perform set_config('request.jwt.claims',
    json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  insert into public.events (event_type, user_id, listing_id, metadata)
  values ('listing_viewed', viewer, v_listing_id, '{"source":"detail"}');

  select count(*) into n from public.events e
   where e.event_type = 'listing_viewed' and e.listing_id = v_listing_id;
  perform pg_temp.ck('repeated viewer refresh is deduplicated', n = 5, n::text);

  -- Owner opens never count.
  perform set_config('request.jwt.claims',
    json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  insert into public.events (event_type, user_id, listing_id, metadata)
  values ('listing_viewed', seller, v_listing_id, '{"source":"detail"}');
  select count(*) into n from public.events e
   where e.event_type = 'listing_viewed' and e.listing_id = v_listing_id;
  perform pg_temp.ck('owner view is excluded', n = 5, n::text);

  -- One completed reservation creates one request-linked ledger row.
  viewer := viewers[1];
  perform set_config('request.jwt.claims',
    json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  insert into public.claims
    (id, listing_id, claimer_id, status, claim_type, quantity_requested,
     agreed_price_cents, payment_status, payment_method)
  values
    (v_claim_id, v_listing_id, viewer, 'pending', 'purchase_request', 2, 500, 'external', 'venmo');
  update public.claims set status = 'approved' where id = v_claim_id;
  update public.claims set status = 'completed' where id = v_claim_id;

  if not exists (select 1 from public.seller_transactions where claim_id = v_claim_id) then
    insert into public.seller_transactions
      (market_id, listing_id, claim_id, source, quantity, gross_cents,
       discount_cents, fee_cents, payment_method, status)
    values (v_market_id, v_listing_id, v_claim_id, 'request', 2, 500, 0, 0, 'venmo', 'completed');
  end if;

  -- A separate walk-up sale is completed revenue too, but is not a reservation.
  insert into public.seller_transactions
    (market_id, listing_id, source, quantity, gross_cents, discount_cents,
     fee_cents, payment_method, status)
  values (v_market_id, v_listing_id, 'manual', 1, 300, 0, 0, 'cash', 'completed');

  -- Included promotion value is not cash spend. This paid row carries an exact
  -- recorded price, so the listing's known spend is $3.00.
  insert into public.listing_promotions
    (listing_id, market_id, source, status, starts_at, ends_at, price_cents, created_by)
  values
    (v_listing_id, v_market_id, 'plan_credit', 'expired', now() - interval '1 day', now(), null, seller),
    (v_listing_id, v_market_id, 'paid', 'expired', now() - interval '1 day', now(), 300, seller);

  perform set_config('request.jwt.claims',
    json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  result := public.my_listing_performance(v_listing_id);

  perform pg_temp.ck('owner sees five aggregate views and five unique viewers',
    result->>'views' = '5' and result->>'unique_viewers' = '5', result::text);
  perform pg_temp.ck('requests and reservations use claims',
    result->>'requests' = '1' and result->>'reservations' = '1'
      and result->>'completed_requests' = '1', result::text);
  perform pg_temp.ck('completed ledger rows drive sales, quantity, and revenue',
    result->>'completed_sales' = '2'
      and (result->>'quantity_sold')::numeric = 3
      and result->>'recorded_revenue_cents' = '800', result::text);
  perform pg_temp.ck('manual and request revenue reconcile without double counting',
    result->>'manual_revenue_cents' = '300'
      and result->>'request_revenue_cents' = '500', result::text);
  perform pg_temp.ck('included credit is not promotion cash spend',
    result->>'included_promotions' = '1'
      and result->>'promotion_spend_cents' = '300'
      and result->>'net_after_promotion_cents' = '500', result::text);
  perform pg_temp.ck('conversion uses completed requests per unique signed-in viewer',
    (result->>'conversion_rate')::numeric = 20.0, result::text);
  perform pg_temp.ck('seller aggregate contains no viewer identity',
    position(viewers[1]::text in result::text) = 0, result::text);

  -- Paid legacy credit with no per-listing allocation stays unknown, not $0.
  insert into public.listing_promotions
    (listing_id, market_id, source, status, starts_at, ends_at, price_cents, created_by)
  values
    (v_historical_id, v_market_id, 'paid', 'expired', now() - interval '10 days', now() - interval '8 days', null, seller);
  historical := public.my_listing_performance(v_historical_id);
  perform pg_temp.ck('historical untracked views are null, not zero',
    historical->>'views_tracked' = 'false'
      and jsonb_typeof(historical->'views') = 'null'
      and jsonb_typeof(historical->'unique_viewers') = 'null', historical::text);
  perform pg_temp.ck('unattributed paid promotion spend is unknown',
    historical->>'promotion_spend_known' = 'false'
      and jsonb_typeof(historical->'promotion_spend_cents') = 'null'
      and jsonb_typeof(historical->'net_after_promotion_cents') = 'null', historical::text);

  -- Non-owner cannot cross the definer boundary.
  viewer := viewers[2];
  perform set_config('request.jwt.claims',
    json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  perform pg_temp.ck_raises(
    'non-owner cannot read seller analytics',
    format('select public.my_listing_performance(%L)', v_listing_id),
    'NOT_YOUR_LISTING');

  -- Archive as the owner and prove every business record remains.
  perform set_config('request.jwt.claims',
    json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  perform public.archive_listing(v_listing_id);
  perform pg_temp.ck('archive removes listing from public lifecycle',
    (select status = 'removed' and archived_at is not null from public.listings where id = v_listing_id),
    (select status::text from public.listings where id = v_listing_id));
  perform pg_temp.ck('archive preserves claims and ledger rows',
    (select count(*) = 1 from public.claims where public.claims.listing_id = v_listing_id)
      and (select count(*) = 2 from public.seller_transactions where seller_transactions.listing_id = v_listing_id),
    'related row count changed');
  viewer := viewers[2];
  perform set_config('request.jwt.claims',
    json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.listings where id = v_listing_id;
  execute 'reset role';
  perform pg_temp.ck('archived listing is not public to another user', n = 0, n::text);
  perform pg_temp.ck('authenticated role cannot hard-delete listings',
    not has_table_privilege('authenticated', 'public.listings', 'delete'), 'DELETE privilege remains');
end $$;

select case when ok then 'PASS' else 'FAIL' end as result, n, name, detail
from _listing_performance_results
order by n;

do $$
declare failures integer;
begin
  select count(*) into failures from _listing_performance_results where not ok;
  if failures > 0 then
    raise exception '% listing performance checks failed', failures;
  end if;
end $$;

rollback;
