-- Proof for 0107: allowance, included usage, actual activity and paid overage stay distinct.
--
-- The two failures this suite exists to catch are the ones 0104 shipped with:
--   Farm reading as zero, because unlimited activity was never "included".
--   Paid overages vanishing, because actual activity had no field of its own.
--
-- Run against a THROWAWAY database.

\set ON_ERROR_STOP on
set client_min_messages = warning;

create temporary table _a (n int, name text, ok boolean, detail text);
create sequence if not exists _an start 1;
create or replace function pg_temp.ck(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin insert into _a values (nextval('_an')::int, p_name, p_ok, p_detail); end $$;

-- Buys and immediately spends one $0.99 authorization, so a paid overage can be created without
-- going near Stripe.
create or replace function pg_temp.paid_publish(p_u uuid, p_m uuid, p_title text, p_session text)
returns void language plpgsql as $$
begin
  insert into public.listing_publish_authorizations
    (market_id, intent, amount_cents, stripe_session_id, status, paid_at)
  values (p_m, 'publish', 99, p_session, 'paid', now());
  insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
  values (p_u, p_m, p_title, 'vegetables', 500, 'sale', 'active', now() + interval '7 days');
end $$;

-- ---- FARM: unlimited allowance, real activity ----------------------------
do $$
declare u uuid := '00000000-0000-0000-0000-0000000000d1'; m uuid; v record; n int; lid uuid;
begin
  insert into auth.users (id) values (u) on conflict do nothing;
  insert into public.markets (owner_id, plan) values (u,'sponsor') returning id into m;

  for n in 1..7 loop
    insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
    values (u, m, 'Farm '||n, 'vegetables', 500, 'sale', 'active', now() + interval '7 days');
  end loop;

  select * into v from public.market_allowance_usage(m);
  perform pg_temp.ck('Farm renders as its customer-facing name', v.display_name = 'Farm', v.display_name);
  perform pg_temp.ck('Farm allowance is unlimited (NULL, not a sentinel)', v.publishes_allowed is null);
  perform pg_temp.ck('Farm remaining stays unlimited', v.publishes_remaining is null);
  -- The 0104 bug: this was 0.
  perform pg_temp.ck('Farm ACTUAL publishes are counted', v.publishes_actual = 7, v.publishes_actual::text);
  perform pg_temp.ck('Farm included usage is 0 — nothing was entitlement',
                     v.publishes_used = 0, v.publishes_used::text);

  -- Renewals, also unlimited, also counted.
  select id into lid from public.listings where market_id = m and title = 'Farm 1';
  update public.listings set status = 'expired' where id = lid;
  update public.listings set status = 'active'  where id = lid;
  select * into v from public.market_allowance_usage(m);
  perform pg_temp.ck('Farm ACTUAL renewals are counted', v.renewals_actual = 1, v.renewals_actual::text);
  perform pg_temp.ck('Farm renewal allowance stays unlimited', v.renewals_allowed is null);
  perform pg_temp.ck('a renewal does not increment publish activity',
                     v.publishes_actual = 7, v.publishes_actual::text);
end $$;

-- ---- PRO: included + paid overage ----------------------------------------
do $$
declare u uuid := '00000000-0000-0000-0000-0000000000d2'; m uuid; v record; n int; lid uuid;
begin
  insert into auth.users (id) values (u) on conflict do nothing;
  insert into public.markets (owner_id, plan) values (u,'grower') returning id into m;
  insert into public.market_subscriptions (market_id, plan, kind, status, current_period_start, current_period_end)
  values (m,'grower','plan','active', now() - interval '2 days', now() + interval '28 days');

  for n in 1..20 loop
    insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
    values (u, m, 'Pro '||n, 'vegetables', 500, 'sale', 'active', now() + interval '7 days');
  end loop;
  for n in 1..3 loop
    perform pg_temp.paid_publish(u, m, 'Pro paid '||n, 'cs_pro_'||n);
  end loop;

  select * into v from public.market_allowance_usage(m);
  perform pg_temp.ck('Pro allowance is 20', v.publishes_allowed = 20, v.publishes_allowed::text);
  perform pg_temp.ck('Pro included usage stays pinned at 20', v.publishes_used = 20, v.publishes_used::text);
  perform pg_temp.ck('Pro ACTUAL publishes are 23', v.publishes_actual = 23, v.publishes_actual::text);
  perform pg_temp.ck('Pro paid publishes this period is 3',
                     v.paid_publishes_period = 3, v.paid_publishes_period::text);
  -- The nonsense the split exists to prevent.
  perform pg_temp.ck('remaining is 0, never negative', v.publishes_remaining = 0, v.publishes_remaining::text);
  perform pg_temp.ck('paid spend this period is 297c', v.paid_cents_period = 297, v.paid_cents_period::text);

  -- 3 included renewals then 2 paid.
  for n in 1..3 loop
    select id into lid from public.listings where market_id = m and title = 'Pro '||n;
    update public.listings set status = 'expired' where id = lid;
    update public.listings set status = 'active'  where id = lid;
  end loop;
  for n in 4..5 loop
    select id into lid from public.listings where market_id = m and title = 'Pro '||n;
    update public.listings set status = 'expired' where id = lid;
    insert into public.listing_publish_authorizations
      (market_id, listing_id, intent, amount_cents, stripe_session_id, status, paid_at)
    values (m, lid, 'renewal', 99, 'cs_pro_ren_'||n, 'paid', now());
    update public.listings set status = 'active' where id = lid;
  end loop;

  select * into v from public.market_allowance_usage(m);
  perform pg_temp.ck('Pro renewal allowance is 3', v.renewals_allowed = 3, v.renewals_allowed::text);
  perform pg_temp.ck('Pro included renewals used is 3', v.renewals_used = 3, v.renewals_used::text);
  perform pg_temp.ck('Pro ACTUAL renewals are 5', v.renewals_actual = 5, v.renewals_actual::text);
  perform pg_temp.ck('Pro paid renewals this period is 2',
                     v.paid_renewals_period = 2, v.paid_renewals_period::text);
  perform pg_temp.ck('renewals remaining is 0, never negative',
                     v.renewals_remaining = 0, v.renewals_remaining::text);
  perform pg_temp.ck('renewals did not inflate publish activity',
                     v.publishes_actual = 23, v.publishes_actual::text);

  -- Expiry is not a reversal: the publish still happened.
  update public.listings set status = 'expired' where market_id = m and title like 'Pro paid%';
  select * into v from public.market_allowance_usage(m);
  perform pg_temp.ck('expiry does not reduce actual usage', v.publishes_actual = 23, v.publishes_actual::text);
end $$;

-- ---- non-Sell types never appear -----------------------------------------
do $$
declare u uuid := '00000000-0000-0000-0000-0000000000d3'; m uuid; v record;
begin
  insert into auth.users (id) values (u) on conflict do nothing;
  insert into public.markets (owner_id, plan) values (u,'grower') returning id into m;

  insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
  values (u,m,'Giveaway','vegetables',null,'free','active', now() + interval '7 days');
  insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at, trade_for)
  values (u,m,'Swap','herbs',null,'trade','active', now() + interval '7 days','basil');
  insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
  values (u,m,'Want','fruit',null,'wanted','active', now() + interval '7 days');
  insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
  values (u,m,'Plot','other',500,'plot','active', now() + interval '7 days');

  select * into v from public.market_allowance_usage(m);
  perform pg_temp.ck('Share Free, Trade, Wanted and Plot contribute nothing to actual usage',
                     v.publishes_actual = 0, v.publishes_actual::text);
  perform pg_temp.ck('…and nothing to included usage', v.publishes_used = 0, v.publishes_used::text);
  perform pg_temp.ck('…so the full allowance remains', v.publishes_remaining = 20, v.publishes_remaining::text);
end $$;

-- ---- period boundaries ----------------------------------------------------
do $$
declare u uuid := '00000000-0000-0000-0000-0000000000d4'; m uuid; v record; n int;
begin
  insert into auth.users (id) values (u) on conflict do nothing;
  insert into public.markets (owner_id, plan) values (u,'free') returning id into m;
  for n in 1..3 loop
    insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
    values (u,m,'FreeP '||n,'vegetables',500,'sale','active', now() + interval '7 days');
  end loop;
  perform pg_temp.paid_publish(u, m, 'FreeP paid', 'cs_free_1');

  select * into v from public.market_allowance_usage(m);
  perform pg_temp.ck('Free actual publishes include the paid one', v.publishes_actual = 4, v.publishes_actual::text);
  perform pg_temp.ck('Free included usage is capped at 3', v.publishes_used = 3, v.publishes_used::text);
  perform pg_temp.ck('Free period is the calendar month', v.period_source = 'calendar_month', v.period_source);

  -- Roll every ledger row into the previous period. Period-scoped counts must reset; lifetime must not.
  update public.listing_publish_events
     set period_start = period_start - interval '1 month'
   where market_id = m;

  select * into v from public.market_allowance_usage(m);
  perform pg_temp.ck('a new period resets actual usage', v.publishes_actual = 0, v.publishes_actual::text);
  perform pg_temp.ck('a new period resets included usage', v.publishes_used = 0, v.publishes_used::text);
  perform pg_temp.ck('a new period resets paid-this-period', v.paid_publishes_period = 0, v.paid_publishes_period::text);
  perform pg_temp.ck('LIFETIME paid totals do NOT reset',
                     v.paid_publishes_lifetime = 1, v.paid_publishes_lifetime::text);
  perform pg_temp.ck('lifetime paid spend does NOT reset',
                     v.paid_cents_lifetime = 99, v.paid_cents_lifetime::text);
end $$;

-- ---- security -------------------------------------------------------------
do $$
declare v record;
begin
  perform pg_temp.ck('market_allowance_usage is NOT executable by authenticated',
                     not has_function_privilege('authenticated','public.market_allowance_usage(uuid)','execute'));
  perform pg_temp.ck('my_listing_allowance IS executable by authenticated',
                     has_function_privilege('authenticated','public.my_listing_allowance()','execute'));
  perform pg_temp.ck('market_allowance_usage is NOT executable by anon',
                     not has_function_privilege('anon','public.market_allowance_usage(uuid)','execute'));
  -- The strongest guarantee is structural: the seller RPC takes no arguments, so there is no
  -- parameter for a client to substitute in order to read another seller.
  perform pg_temp.ck('my_listing_allowance takes no arguments to spoof',
                     (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname='public' and p.proname='my_listing_allowance'
                         and p.pronargs = 0) = 1);
end $$;

\echo ''
select format('%s  %-60s %s', lpad(n::text,3,' '), name,
              case when ok then 'PASS' else 'FAIL  '||detail end)
from _a order by n;
\echo ''
select format('allowance usage suite: %s/%s passed', count(*) filter (where ok), count(*)) from _a;

do $$
declare bad int;
begin
  select count(*) into bad from _a where not ok;
  if bad > 0 then raise exception '% assertion(s) failed', bad; end if;
end $$;
