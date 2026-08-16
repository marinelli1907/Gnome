-- Adversarial proof for 0106: promo eligibility and the $0.99 overage gate.
--
-- These test the checks Stripe cannot make. Stripe silently drops applies_to on coupons, so
-- FOUNDING3 is an unrestricted 100%-off coupon at the Stripe layer — the ONLY thing standing
-- between a Max subscriber and $29.99/month free is promo_validate returning WRONG_PLAN. Test 3
-- and test 4 are therefore load-bearing revenue protection, not hygiene.
--
-- Run against a THROWAWAY database. Requires the 0104-0106 stack.

\set ON_ERROR_STOP on
set client_min_messages = warning;

create temporary table _p (n int, name text, ok boolean, detail text);
create sequence if not exists _pn start 1;

create or replace function pg_temp.ck(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin insert into _p values (nextval('_pn')::int, p_name, p_ok, p_detail); end $$;

do $$
declare
  u_pro   uuid := '00000000-0000-0000-0000-0000000000c1';
  u_other uuid := '00000000-0000-0000-0000-0000000000c2';
  m_pro   uuid; m_other uuid;
  camp    uuid;
  v       record;
  n       int;
begin
  insert into auth.users (id, email) values (u_pro,'pro@example.com'), (u_other,'other@example.com')
    on conflict do nothing;
  insert into public.markets (owner_id, plan) values (u_pro,'grower')  returning id into m_pro;
  insert into public.markets (owner_id, plan) values (u_other,'free')  returning id into m_other;

  select id into camp from public.promotion_campaigns where code = 'FOUNDING3';
  perform pg_temp.ck('FOUNDING3 is seeded by the migration', camp is not null);

  -- Eligible in Gnome but not yet wired to Stripe must refuse, not silently charge full price.
  select * into v from public.promo_validate('FOUNDING3','grower',u_pro);
  perform pg_temp.ck('unconfigured campaign refuses with NOT_CONFIGURED',
                     v.ok = false and v.reason = 'NOT_CONFIGURED', v.reason);

  update public.promotion_campaigns
     set stripe_promotion_code_id = 'promo_test_founding3' where id = camp;

  -- ---- the three plan cases -------------------------------------------
  select * into v from public.promo_validate('FOUNDING3','grower',u_pro);
  perform pg_temp.ck('FOUNDING3 + Pro (grower) is ACCEPTED', v.ok, v.reason);
  perform pg_temp.ck('accepted validation returns the Stripe promo id',
                     v.stripe_promotion_code_id = 'promo_test_founding3', v.stripe_promotion_code_id);

  select * into v from public.promo_validate('FOUNDING3','farm',u_pro);
  perform pg_temp.ck('FOUNDING3 + Max (farm) is REJECTED', v.ok = false and v.reason = 'WRONG_PLAN', v.reason);

  select * into v from public.promo_validate('FOUNDING3','sponsor',u_pro);
  perform pg_temp.ck('FOUNDING3 + Farm (sponsor) is REJECTED', v.ok = false and v.reason = 'WRONG_PLAN', v.reason);

  -- ---- arbitrary / hostile input ---------------------------------------
  select * into v from public.promo_validate('SOME_MADE_UP_CODE','grower',u_pro);
  perform pg_temp.ck('an arbitrary code is rejected', v.ok = false and v.reason = 'INVALID_CODE', v.reason);

  -- A client passing a raw Stripe coupon id must not be treated as a campaign.
  select * into v from public.promo_validate('promo_test_founding3','grower',u_pro);
  perform pg_temp.ck('a raw Stripe promo id is not a valid Gnome code',
                     v.ok = false and v.reason = 'INVALID_CODE', v.reason);

  select * into v from public.promo_validate(null,'grower',u_pro);
  perform pg_temp.ck('null code is rejected', v.ok = false and v.reason = 'NO_CODE', v.reason);
  select * into v from public.promo_validate('   ','grower',u_pro);
  perform pg_temp.ck('blank code is rejected', v.ok = false and v.reason = 'NO_CODE', v.reason);

  -- Case and padding must not defeat the lookup, or the same code redeems twice.
  select * into v from public.promo_validate('  founding3  ','grower',u_pro);
  perform pg_temp.ck('lowercase and padded code still resolves', v.ok, v.reason);

  -- A missing code and an inactive code must be indistinguishable, or the error message
  -- enumerates which campaigns exist.
  update public.promotion_campaigns set active = false where id = camp;
  select * into v from public.promo_validate('FOUNDING3','grower',u_pro);
  perform pg_temp.ck('an inactive code reports INVALID_CODE, not INACTIVE',
                     v.reason = 'INVALID_CODE', v.reason);
  update public.promotion_campaigns set active = true where id = camp;

  -- ---- date window ------------------------------------------------------
  update public.promotion_campaigns set starts_at = now() + interval '1 day' where id = camp;
  select * into v from public.promo_validate('FOUNDING3','grower',u_pro);
  perform pg_temp.ck('a future campaign is NOT_STARTED', v.reason = 'NOT_STARTED', v.reason);

  update public.promotion_campaigns set starts_at = now() - interval '10 days',
                                        expires_at = now() - interval '1 day' where id = camp;
  select * into v from public.promo_validate('FOUNDING3','grower',u_pro);
  perform pg_temp.ck('an elapsed campaign is EXPIRED', v.reason = 'EXPIRED', v.reason);
  update public.promotion_campaigns set starts_at = null, expires_at = null where id = camp;

  -- ---- duplicate redemption --------------------------------------------
  perform public.record_promo_redemption(camp, u_pro, m_pro, 'grower', 'cs_promo_1', 'sub_1', 'cus_1', 999);
  select * into v from public.promo_validate('FOUNDING3','grower',u_pro);
  perform pg_temp.ck('a second redemption by the same user is rejected',
                     v.ok = false and v.reason = 'ALREADY_REDEEMED', v.reason);

  select * into v from public.promo_validate('FOUNDING3','grower',u_other);
  perform pg_temp.ck('a different user is still eligible', v.ok, v.reason);

  -- Webhook replay: same session id must not create a second redemption row.
  perform public.record_promo_redemption(camp, u_pro, m_pro, 'grower', 'cs_promo_1', 'sub_1', 'cus_1', 999);
  select count(*)::int into n from public.promotion_redemptions where stripe_session_id = 'cs_promo_1';
  perform pg_temp.ck('replayed redemption webhook inserts only one row', n = 1, n::text);

  -- A cancelled redemption frees the per-user slot, because the count is computed not stored.
  update public.promotion_redemptions set status = 'cancelled' where stripe_session_id = 'cs_promo_1';
  select * into v from public.promo_validate('FOUNDING3','grower',u_pro);
  perform pg_temp.ck('a cancelled redemption frees the slot', v.ok, v.reason);
  update public.promotion_redemptions set status = 'redeemed' where stripe_session_id = 'cs_promo_1';

  -- ---- global cap -------------------------------------------------------
  update public.promotion_campaigns set max_redemptions = 1 where id = camp;
  select * into v from public.promo_validate('FOUNDING3','grower',u_other);
  perform pg_temp.ck('the global cap rejects a new user once reached',
                     v.ok = false and v.reason = 'FULLY_REDEEMED', v.reason);
  update public.promotion_campaigns set max_redemptions = null where id = camp;

  -- ---- new customers only ----------------------------------------------
  update public.promotion_campaigns set new_customers_only = true where id = camp;
  insert into public.market_subscriptions (market_id, plan, kind, status)
  values (m_other, 'grower', 'plan', 'active');
  select * into v from public.promo_validate('FOUNDING3','grower',u_other);
  perform pg_temp.ck('an existing subscriber fails new_customers_only',
                     v.ok = false and v.reason = 'NOT_NEW_CUSTOMER', v.reason);
  update public.promotion_campaigns set new_customers_only = false where id = camp;
end $$;

-- ---- the $0.99 overage gate ---------------------------------------------
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000c3';
  m uuid; v record; lid uuid; n int; a1 uuid; a2 uuid;
begin
  insert into auth.users (id) values (u) on conflict do nothing;
  insert into public.markets (owner_id, plan) values (u,'free') returning id into m;

  -- With allowance left, checkout must REFUSE to charge. This is consumer protection as much as
  -- security: a client calling checkout directly would otherwise be billed for a free action.
  select * into v from public.listing_overage_required(m, null);
  perform pg_temp.ck('no payment required while allowance remains',
                     v.required = false and v.reason = 'ALLOWANCE_REMAINING', v.reason);
  perform pg_temp.ck('intent defaults to publish for a new listing', v.intent = 'publish', v.intent);
  perform pg_temp.ck('publish maps to the publish price',
                     v.product_key = 'GNOME_LISTING_PUBLISH', v.product_key);

  for n in 1..3 loop
    insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
    values (u, m, 'Overage '||n, 'vegetables', 500, 'sale', 'active', now() + interval '7 days');
  end loop;

  select * into v from public.listing_overage_required(m, null);
  perform pg_temp.ck('payment required once allowance is spent',
                     v.required and v.reason = 'ALLOWANCE_EXHAUSTED', v.reason);

  -- Renewal is derived from the listing's own history, so a client cannot claim 'renewal' to reach
  -- a different allowance.
  select id into lid from public.listings where market_id = m and title = 'Overage 1';
  select * into v from public.listing_overage_required(m, lid);
  perform pg_temp.ck('a previously published listing is a RENEWAL', v.intent = 'renewal', v.intent);
  perform pg_temp.ck('renewal maps to the renewal price',
                     v.product_key = 'GNOME_LISTING_RENEWAL', v.product_key);

  -- ---- authorization lifecycle ------------------------------------------
  a1 := public.create_publish_authorization(m, 'publish', null, 'cs_over_1', 99);
  perform pg_temp.ck('an authorization starts pending',
                     (select status from public.listing_publish_authorizations where id = a1) = 'pending');

  -- A pending authorization must NOT satisfy the gate — only a paid one does. Otherwise abandoning
  -- checkout would grant a free publish.
  select * into v from public.listing_overage_required(m, null);
  perform pg_temp.ck('a pending authorization does not authorize publishing',
                     v.required, v.reason);

  -- Duplicate checkout for the same session cannot create a second usable authorization.
  a2 := public.create_publish_authorization(m, 'publish', null, 'cs_over_1', 99);
  select count(*)::int into n from public.listing_publish_authorizations where stripe_session_id = 'cs_over_1';
  perform pg_temp.ck('a duplicate checkout reuses one authorization row', n = 1 and a1 = a2, n::text);

  perform pg_temp.ck('marking paid succeeds once', public.mark_authorization_paid('cs_over_1','pi_1'));
  -- Webhook replay.
  perform pg_temp.ck('marking paid again is a no-op (webhook replay)',
                     public.mark_authorization_paid('cs_over_1','pi_1') = false);

  -- Paid and unspent: send them back to publishing, not to Stripe again.
  select * into v from public.listing_overage_required(m, null);
  perform pg_temp.ck('a paid authorization stops a second charge',
                     v.required = false and v.reason = 'ALREADY_AUTHORIZED', v.reason);

  -- Spend it.
  insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
  values (u, m, 'Paid overage', 'vegetables', 500, 'sale', 'active', now() + interval '7 days');
  perform pg_temp.ck('the authorization is consumed by the publish',
                     (select status from public.listing_publish_authorizations where id = a1) = 'consumed');

  -- Completed-checkout replay: the same payment must not publish twice.
  select * into v from public.listing_overage_required(m, null);
  perform pg_temp.ck('a consumed authorization does not fund another publish',
                     v.required and v.reason = 'ALLOWANCE_EXHAUSTED', v.reason);

  -- ---- allowance changes while a checkout is pending ---------------------
  -- Seller starts checkout at the cap, then upgrades before paying. The pending authorization must
  -- not be spent on an action the new plan now covers for free.
  perform public.create_publish_authorization(m, 'publish', null, 'cs_over_2', 99);
  update public.markets set plan = 'grower' where id = m;
  select * into v from public.listing_overage_required(m, null);
  perform pg_temp.ck('an upgrade mid-checkout means no payment is required',
                     v.required = false and v.reason = 'ALLOWANCE_REMAINING', v.reason);

  insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
  values (u, m, 'After upgrade', 'vegetables', 500, 'sale', 'active', now() + interval '7 days');
  perform pg_temp.ck('the post-upgrade publish uses included allowance, not the pending payment',
                     (select funded from public.listing_publish_events
                       where listing_id = (select id from public.listings
                                            where market_id = m and title = 'After upgrade')) = 'included');
  perform pg_temp.ck('the unpaid authorization is left untouched for reconciliation',
                     (select status from public.listing_publish_authorizations
                       where stripe_session_id = 'cs_over_2') = 'pending');
end $$;

\echo ''
select format('%s  %-62s %s', lpad(n::text,3,' '), name,
              case when ok then 'PASS' else 'FAIL  '||detail end)
from _p order by n;

\echo ''
select format('promotions suite: %s/%s passed', count(*) filter (where ok), count(*)) from _p;

do $$
declare bad int;
begin
  select count(*) into bad from _p where not ok;
  if bad > 0 then raise exception '% assertion(s) failed', bad; end if;
end $$;
