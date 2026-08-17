-- Behavioural proof for 0104's publish-allowance model.
--
-- These are the assertions that distinguish the NEW model from the one it replaced. The old cap
-- counted active rows, so expiry handed capacity back; the whole point of this suite is that it
-- no longer does. Test 5 is therefore the single most important one here — if it ever goes green
-- by accident the model has silently reverted to the old semantics.
--
-- Run against a THROWAWAY database only:
--   psql -d <throwaway> -f supabase/tests/listing_allowance_suite.sql
--
-- Requires public.market_effective_plan(uuid). On a fresh local build that function comes from a
-- migration the prose-file gap prevents replaying, so the runner stubs it; in production it is real.

\set ON_ERROR_STOP on
set client_min_messages = warning;

create temporary table _t (n int, name text, ok boolean, detail text);
create sequence if not exists _tn start 1;

create or replace function pg_temp.ck(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  insert into _t values (nextval('_tn')::int, p_name, coalesce(p_ok, false), p_detail);
end $$;

-- Assert that a statement fails with a specific SQLERRM fragment.
create or replace function pg_temp.ck_raises(p_name text, p_sql text, p_fragment text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform pg_temp.ck(p_name, false, 'expected an exception, none raised');
  exception when others then
    perform pg_temp.ck(p_name, position(p_fragment in sqlerrm) > 0,
                       format('got: %s', left(sqlerrm, 90)));
  end;
end $$;

do $$
declare
  u_free  uuid := '00000000-0000-0000-0000-0000000000f1';
  m_free  uuid;
  per     record;
  usage   record;
  lid     uuid;
  auth_id uuid;
  n       int;
begin
  insert into auth.users (id) values (u_free) on conflict do nothing;
  insert into public.markets (owner_id, plan) values (u_free, 'free') returning id into m_free;

  -- ---- period ----------------------------------------------------------
  select * into per from public.market_allowance_period(m_free);
  perform pg_temp.ck('free plan uses a calendar-month period',
                     per.source = 'calendar_month', per.source);
  perform pg_temp.ck('calendar period is exactly one month',
                     per.period_end = per.period_start + interval '1 month');

  -- ---- 1..3 included ---------------------------------------------------
  for n in 1..3 loop
    insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
    values (u_free, m_free, 'Tomatoes '||n, 'vegetables', 500, 'sale', 'active', now() + interval '7 days');
  end loop;

  select * into usage from public.market_allowance_usage(m_free);
  perform pg_temp.ck('free allowance is 3 publishes', usage.publishes_allowed = 3,
                     coalesce(usage.publishes_allowed::text,'null'));
  perform pg_temp.ck('3 publishes consumed', usage.publishes_used = 3, usage.publishes_used::text);
  perform pg_temp.ck('0 publishes remaining', usage.publishes_remaining = 0,
                     usage.publishes_remaining::text);
  perform pg_temp.ck('plan renders as its customer-facing name',
                     usage.display_name = 'Free', usage.display_name);

  -- ---- 4th sale refused ------------------------------------------------
  perform pg_temp.ck_raises(
    '4th Sell listing is refused',
    format($q$insert into public.listings
             (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
             values ('%s','%s','Tomatoes 4','vegetables',500,'sale','active', now() + interval '7 days')$q$,
           u_free, m_free),
    'PUBLISH_ALLOWANCE_EXHAUSTED');

  -- ---- non-Sell types are free and uncapped ----------------------------
  -- The owner's explicit rule: nobody is ever charged to give something away.
  insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
  values (u_free, m_free, 'Free zucchini', 'vegetables', null, 'free', 'active', now() + interval '7 days');
  -- trade listings carry listings_trade_for_chk: a trade must say what it wants in return.
  insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at, trade_for)
  values (u_free, m_free, 'Trade basil', 'herbs', null, 'trade', 'active', now() + interval '7 days', 'tomatoes');
  insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
  values (u_free, m_free, 'Want apples', 'fruit', null, 'wanted', 'active', now() + interval '7 days');
  -- Offer a Plot is deliberately NOT exercised here: enforce_plot_plan() already restricts plots
  -- to paid tiers, so a Free market cannot create one at all. It is covered in the Pro block below,
  -- where it is a legal post type.

  select * into usage from public.market_allowance_usage(m_free);
  perform pg_temp.ck('Share Free / Trade / Wanted spend no allowance',
                     usage.publishes_used = 3, usage.publishes_used::text);

  select count(*)::int into n from public.listing_publish_events where market_id = m_free;
  perform pg_temp.ck('only Sell listings write ledger rows', n = 3, n::text);

  -- ---- expiry does NOT refund -----------------------------------------
  -- This is the semantic inversion versus the old active-count cap.
  update public.listings set status = 'expired'
   where market_id = m_free and listing_type = 'sale';

  select * into usage from public.market_allowance_usage(m_free);
  perform pg_temp.ck('expiry does not restore allowance',
                     usage.publishes_used = 3 and usage.publishes_remaining = 0,
                     format('used=%s remaining=%s', usage.publishes_used, usage.publishes_remaining));

  perform pg_temp.ck_raises(
    'still refused after everything expired',
    format($q$insert into public.listings
             (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
             values ('%s','%s','Tomatoes 5','vegetables',500,'sale','active', now() + interval '7 days')$q$,
           u_free, m_free),
    'PUBLISH_ALLOWANCE_EXHAUSTED');

  -- ---- a paid authorization unlocks exactly one publish -----------------
  insert into public.listing_publish_authorizations
    (market_id, intent, amount_cents, stripe_session_id, status, paid_at)
  values (m_free, 'publish', 99, 'cs_test_alpha', 'paid', now())
  returning id into auth_id;

  insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
  values (u_free, m_free, 'Paid tomatoes', 'vegetables', 500, 'sale', 'active', now() + interval '7 days')
  returning id into lid;

  perform pg_temp.ck('paid authorization permits the publish',
                     exists (select 1 from public.listing_publish_events
                              where listing_id = lid and funded = 'paid'));
  perform pg_temp.ck('authorization is marked consumed',
                     (select status from public.listing_publish_authorizations where id = auth_id) = 'consumed',
                     (select status from public.listing_publish_authorizations where id = auth_id));
  perform pg_temp.ck('authorization is bound to the listing it paid for',
                     (select listing_id from public.listing_publish_authorizations where id = auth_id) = lid);

  select * into usage from public.market_allowance_usage(m_free);
  perform pg_temp.ck('a paid publish does not consume included allowance',
                     usage.publishes_used = 3, usage.publishes_used::text);
  perform pg_temp.ck('paid publishes are counted separately',
                     usage.paid_publishes = 1, usage.paid_publishes::text);
  perform pg_temp.ck('paid spend is totalled', usage.paid_cents = 99, usage.paid_cents::text);

  -- ---- the same payment cannot be spent twice --------------------------
  perform pg_temp.ck_raises(
    'a consumed authorization cannot fund a second publish',
    format($q$insert into public.listings
             (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
             values ('%s','%s','Second freebie','vegetables',500,'sale','active', now() + interval '7 days')$q$,
           u_free, m_free),
    'PUBLISH_ALLOWANCE_EXHAUSTED');

  -- ---- webhook replay is idempotent ------------------------------------
  perform pg_temp.ck_raises(
    'duplicate stripe_session_id is rejected',
    format($q$insert into public.listing_publish_authorizations
             (market_id, intent, amount_cents, stripe_session_id, status)
             values ('%s','publish',99,'cs_test_alpha','paid')$q$, m_free),
    'duplicate key');

  -- ---- renewals are a distinct allowance -------------------------------
  -- Free includes 0 renewals, so reactivating an already-published listing must be refused
  -- rather than quietly spending a publish.
  update public.listings set status = 'expired' where id = lid;
  perform pg_temp.ck_raises(
    'renewal on Free requires payment',
    format('update public.listings set status = ''active'' where id = ''%s''', lid),
    'PUBLISH_ALLOWANCE_EXHAUSTED');

  select count(*)::int into n from public.listing_publish_events
   where listing_id = lid and kind = 'renewal';
  perform pg_temp.ck('a refused renewal writes no ledger row', n = 0, n::text);
end $$;

-- ---- a paid plan uses its subscription period ---------------------------
do $$
declare
  u_pro uuid := '00000000-0000-0000-0000-0000000000f2';
  m_pro uuid;
  per   record;
  usage record;
  n     int;
begin
  insert into auth.users (id) values (u_pro) on conflict do nothing;
  insert into public.markets (owner_id, plan) values (u_pro, 'grower') returning id into m_pro;
  insert into public.market_subscriptions
    (market_id, plan, kind, status, current_period_start, current_period_end)
  values (m_pro, 'grower', 'plan', 'active', now() - interval '3 days', now() + interval '27 days');

  select * into per from public.market_allowance_period(m_pro);
  perform pg_temp.ck('paid plan uses the subscription period',
                     per.source = 'subscription', per.source);

  select * into usage from public.market_allowance_usage(m_pro);
  perform pg_temp.ck('Pro allows 20 publishes', usage.publishes_allowed = 20,
                     coalesce(usage.publishes_allowed::text,'null'));
  perform pg_temp.ck('Pro includes 3 renewals', usage.renewals_allowed = 3,
                     coalesce(usage.renewals_allowed::text,'null'));
  perform pg_temp.ck('grower renders as Pro', usage.display_name = 'Pro', usage.display_name);

  for n in 1..20 loop
    insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
    values (u_pro, m_pro, 'Pro item '||n, 'vegetables', 500, 'sale', 'active', now() + interval '7 days');
  end loop;

  select * into usage from public.market_allowance_usage(m_pro);
  perform pg_temp.ck('20 publishes consumed', usage.publishes_used = 20, usage.publishes_used::text);

  perform pg_temp.ck_raises(
    '21st Pro publish is refused',
    format($q$insert into public.listings
             (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
             values ('%s','%s','Pro item 21','vegetables',500,'sale','active', now() + interval '7 days')$q$,
           u_pro, m_pro),
    'PUBLISH_ALLOWANCE_EXHAUSTED');

  -- Offer a Plot is a legal type here and must still not spend a publish, even though the publish
  -- allowance is now fully exhausted.
  insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
  values (u_pro, m_pro, 'Plot offer', 'other', 500, 'plot', 'active', now() + interval '7 days');

  select * into usage from public.market_allowance_usage(m_pro);
  perform pg_temp.ck('Offer a Plot publishes while Sell allowance is exhausted',
                     usage.publishes_used = 20, usage.publishes_used::text);

  -- A renewal draws on the renewal allowance, NOT on the exhausted publish allowance.
  update public.listings set status = 'expired'
   where market_id = m_pro and title = 'Pro item 1';
  update public.listings set status = 'active'
   where market_id = m_pro and title = 'Pro item 1';

  select * into usage from public.market_allowance_usage(m_pro);
  perform pg_temp.ck('renewal works while publishes are exhausted',
                     usage.renewals_used = 1, usage.renewals_used::text);
  perform pg_temp.ck('renewal did not consume a publish',
                     usage.publishes_used = 20, usage.publishes_used::text);
  perform pg_temp.ck('2 renewals remain', usage.renewals_remaining = 2,
                     coalesce(usage.renewals_remaining::text,'null'));
end $$;

-- ---- the unlimited tier -------------------------------------------------
do $$
declare
  u_farm uuid := '00000000-0000-0000-0000-0000000000f3';
  m_farm uuid;
  usage  record;
  n      int;
begin
  insert into auth.users (id) values (u_farm) on conflict do nothing;
  insert into public.markets (owner_id, plan) values (u_farm, 'sponsor') returning id into m_farm;

  for n in 1..45 loop
    insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
    values (u_farm, m_farm, 'Farm item '||n, 'vegetables', 500, 'sale', 'active', now() + interval '7 days');
  end loop;

  select * into usage from public.market_allowance_usage(m_farm);
  perform pg_temp.ck('sponsor renders as Farm', usage.display_name = 'Farm', usage.display_name);
  perform pg_temp.ck('Farm publishes are unlimited', usage.publishes_allowed is null);
  perform pg_temp.ck('Farm remaining is unlimited, not a number',
                     usage.publishes_remaining is null);
  perform pg_temp.ck('45 publishes beyond any tier cap all succeeded',
                     (select count(*) from public.listings
                       where market_id = m_farm and listing_type = 'sale') = 45);
  perform pg_temp.ck('unlimited usage is still recorded for analytics',
                     (select count(*) from public.listing_publish_events
                       where market_id = m_farm and funded = 'unlimited') = 45);
end $$;

-- ---- plan switching cannot farm a fresh allowance -----------------------
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000f4';
  m uuid;
  usage record;
  n int;
begin
  insert into auth.users (id) values (u) on conflict do nothing;
  insert into public.markets (owner_id, plan) values (u, 'free') returning id into m;

  for n in 1..3 loop
    insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
    values (u, m, 'Switch '||n, 'vegetables', 500, 'sale', 'active', now() + interval '7 days');
  end loop;

  -- Upgrade then immediately downgrade. Because ledger rows are stamped with the period they were
  -- spent in, the already-spent publishes must still be visible on return to Free.
  update public.markets set plan = 'grower' where id = m;
  update public.markets set plan = 'free'   where id = m;

  select * into usage from public.market_allowance_usage(m);
  perform pg_temp.ck('a plan round-trip does not refund spent publishes',
                     usage.publishes_used = 3, usage.publishes_used::text);
  perform pg_temp.ck('a plan round-trip leaves 0 remaining on Free',
                     usage.publishes_remaining = 0, usage.publishes_remaining::text);
end $$;

\echo ''
select format('%s  %-58s %s', lpad(n::text,3,' '), name, case when ok then 'PASS' else 'FAIL  '||detail end)
from _t order by n;

\echo ''
select format('listing allowance suite: %s/%s passed', count(*) filter (where ok), count(*)) from _t;

do $$
declare bad int;
begin
  select count(*) into bad from _t where not ok;
  if bad > 0 then raise exception '% assertion(s) failed', bad; end if;
end $$;
