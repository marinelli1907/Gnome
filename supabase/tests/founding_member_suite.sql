-- Founding Member test suite — the database-layer proof that the program in
-- 0091 does what docs/founding/FOUNDING_MEMBER_PROGRAM.md says it does.
-- Runs on a throwaway local database built by run_founding_member_tests.sh
-- (shim + fixture + 0091). The concurrency cases need real parallel sessions,
-- so the runner produces them first and this file folds them into the verdict.
--
-- Every assertion asks the question the way production asks it — through the
-- shipped RPC, predicate or view, never by reading a column and hoping.

create table t (n serial, label text, pass boolean, detail text);
grant all on t to public;
grant usage, select on sequence t_n_seq to public;

create table ids (k text primary key, v uuid);
grant all on ids to public;

-- --------------------------------------------------------------------------
-- Fixtures. a1 is the owner-admin; b1..e1 become founders; f1 never does.
-- --------------------------------------------------------------------------
do $$
declare mkt_b uuid; mkt_f uuid;
begin
  insert into public.profiles (id, name) values
    ('00000000-0000-0000-0000-0000000000a1','Owner O.'),
    ('00000000-0000-0000-0000-0000000000b1','Bea B.'),
    ('00000000-0000-0000-0000-0000000000c1','Cal C.'),
    ('00000000-0000-0000-0000-0000000000d1','Dee D.'),
    ('00000000-0000-0000-0000-0000000000e1','Eli E.'),
    ('00000000-0000-0000-0000-0000000000f1','Fay F.');

  insert into public.markets (owner_id, name, city, state)
    values ('00000000-0000-0000-0000-0000000000b1','Bea''s Garden','Boone','NC')
    returning id into mkt_b;
  insert into public.markets (owner_id, name, city, state)
    values ('00000000-0000-0000-0000-0000000000f1','Fay''s Plot','Boone','NC')
    returning id into mkt_f;

  -- A demo row only. Nothing real is published yet, which is the point of
  -- T-MKT-01: a seeded demo listing must not buy a Founding Market.
  insert into public.listings (owner_id, market_id, title, is_demo)
    values ('00000000-0000-0000-0000-0000000000b1', mkt_b, 'Demo tomatoes', true);

  insert into ids values ('mkt_b', mkt_b), ('mkt_f', mkt_f);

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a1')::text, false);
  perform set_config('test.is_owner','true', false);
end $$;

-- Fold in the concurrency phase the runner already executed.
do $$
begin
  if to_regclass('public.founding_concurrency_results') is not null then
    insert into t(label, pass, detail)
    select label, pass, detail from public.founding_concurrency_results;
  else
    insert into t(label, pass, detail) values
      ('T-RACE-00 concurrency phase present', false,
       'run through run_founding_member_tests.sh — concurrency was not exercised');
  end if;
end $$;

-- --------------------------------------------------------------------------
-- A. The program ships OFF, and every non-qualifying path is refused
--    WITHOUT consuming a number.
-- --------------------------------------------------------------------------
do $$
declare r jsonb;
begin
  insert into t(label,pass,detail) values ('T-GATE-01 program ships disabled',
    (public.founding_program_status()->>'enabled')::boolean is false,
    public.founding_program_status()::text);

  r := public.founding_award_member('00000000-0000-0000-0000-0000000000b1',
        'GNOME_GROWER_MONTHLY','price_live_grower','sub_b1','active',true,999,'evt_off');
  insert into t(label,pass,detail) values ('T-GATE-02 award refused while the flag is off',
    r->>'reason' = 'PROGRAM_DISABLED' and not (r->>'awarded')::boolean, r::text);

  perform public.admin_founding_set_program('{"program_enabled":true}'::jsonb);

  -- TEST-mode money never qualifies. This is the rule that keeps the program
  -- inert in production today, where no live price id exists at all.
  r := public.founding_award_member('00000000-0000-0000-0000-0000000000b1',
        'GNOME_GROWER_MONTHLY','price_test_grower','sub_test','active',false,999,'evt_test');
  insert into t(label,pass,detail) values ('T-GATE-03 TEST-mode payment refused outright',
    r->>'reason' = 'TEST_MODE_NOT_ELIGIBLE', r::text);

  r := public.founding_award_member('00000000-0000-0000-0000-0000000000b1',
        'GNOME_GROWER_MONTHLY','price_live_grower','sub_inc','incomplete',true,999,'evt_inc');
  insert into t(label,pass,detail) values ('T-GATE-04 incomplete subscription refused',
    r->>'reason' = 'SUBSCRIPTION_NOT_ACTIVE', r::text);

  r := public.founding_award_member('00000000-0000-0000-0000-0000000000b1',
        'GNOME_GROWER_MONTHLY','price_live_grower','sub_tri','trialing',true,999,'evt_tri');
  insert into t(label,pass,detail) values ('T-GATE-05 trialing is not paid, so it is refused',
    r->>'reason' = 'SUBSCRIPTION_NOT_ACTIVE', r::text);

  -- A failed payment reaches the webhook as a subscription with nothing
  -- captured. No money, no number.
  r := public.founding_award_member('00000000-0000-0000-0000-0000000000b1',
        'GNOME_GROWER_MONTHLY','price_live_grower','sub_fail','active',true,0,'evt_fail');
  insert into t(label,pass,detail) values ('T-GATE-06 failed payment (nothing captured) refused',
    r->>'reason' = 'NO_PAYMENT_CAPTURED', r::text);

  -- Seed Drop interest NEVER qualifies anyone, even paid and live.
  r := public.founding_award_member('00000000-0000-0000-0000-0000000000b1',
        'GNOME_SEED_DROP_SEASONAL','price_live_seed','sub_seed','active',true,2499,'evt_seed');
  insert into t(label,pass,detail) values ('T-GATE-07 a paid Seed Drop subscription qualifies nobody',
    r->>'reason' = 'PRODUCT_NOT_QUALIFYING', r::text);

  r := public.founding_award_member('00000000-0000-0000-0000-0000000000b1',
        'GNOME_GROWER_SEED_BUNDLE','price_live_bundle','sub_bundle','active',true,19900,'evt_bundle');
  insert into t(label,pass,detail) values ('T-GATE-08 a retired product qualifies nobody',
    r->>'reason' = 'PRODUCT_NOT_QUALIFYING', r::text);

  r := public.founding_award_member('00000000-0000-0000-0000-0000000000b1',
        'GNOME_GROWER_MONTHLY','price_live_someone_else','sub_wrong','active',true,999,'evt_wrong');
  insert into t(label,pass,detail) values ('T-GATE-09 a price that is not the configured live price is refused',
    r->>'reason' = 'PRICE_NOT_QUALIFYING', r::text);

  r := public.founding_award_member('00000000-0000-0000-0000-00000000dead',
        'GNOME_GROWER_MONTHLY','price_live_grower','sub_ghost','active',true,999,'evt_ghost');
  insert into t(label,pass,detail) values ('T-GATE-10 an unknown user is refused',
    r->>'reason' = 'UNKNOWN_USER', r::text);

  insert into t(label,pass,detail) values ('T-GATE-11 ten refusals consumed zero numbers',
    (select last_founding_number = 0 from public.founding_program_config where id)
      and (select count(*) = 0 from public.founding_members),
    'high-water '||(select last_founding_number from public.founding_program_config where id));

  insert into t(label,pass,detail) values ('T-GATE-12 capacity is 500 and all of it is free',
    public.founding_capacity_remaining() = 500, public.founding_capacity_remaining()||' remaining');
end $$;

-- --------------------------------------------------------------------------
-- B. The award itself, and its idempotency
-- --------------------------------------------------------------------------
do $$
declare r jsonb; m public.founding_members;
begin
  r := public.founding_award_member('00000000-0000-0000-0000-0000000000b1',
        'GNOME_GROWER_MONTHLY','price_live_grower','sub_b1','active',true,999,'evt_b1');
  insert into t(label,pass,detail) values ('T-AWARD-01 first live paid subscription becomes #1',
    (r->>'awarded')::boolean and (r->>'founding_number')::int = 1
      and r->>'display' = 'Founding Member #0001', r::text);

  select * into m from public.founding_members
   where user_id = '00000000-0000-0000-0000-0000000000b1';
  insert into t(label,pass,detail) values ('T-AWARD-02 the row records the qualifying evidence',
    m.stripe_livemode and m.status = 'ACTIVE'
      and m.qualifying_product_key = 'GNOME_GROWER_MONTHLY'
      and m.qualifying_stripe_price_id = 'price_live_grower'
      and m.qualifying_subscription_id = 'sub_b1'
      and m.current_subscription_id = 'sub_b1'
      and m.market_id is null and m.market_activated_at is null,
    m.qualifying_product_key||' / '||m.qualifying_stripe_price_id);

  -- The same Stripe event replayed.
  r := public.founding_award_member('00000000-0000-0000-0000-0000000000b1',
        'GNOME_GROWER_MONTHLY','price_live_grower','sub_b1','active',true,999,'evt_b1');
  insert into t(label,pass,detail) values ('T-AWARD-03 a replayed event awards nothing new',
    not (r->>'awarded')::boolean and (r->>'founding_number')::int = 1
      and (select last_founding_number = 1 from public.founding_program_config where id), r::text);

  -- Same person, a second subscription.
  r := public.founding_award_member('00000000-0000-0000-0000-0000000000b1',
        'GNOME_FARM_MONTHLY','price_anything','sub_b1_second','active',true,2999,'evt_b1b');
  insert into t(label,pass,detail) values ('T-AWARD-04 a second subscription does not buy a second number',
    r->>'reason' = 'ALREADY_AWARDED' and (r->>'founding_number')::int = 1, r::text);

  -- Someone else's event carrying a subscription that already qualified.
  r := public.founding_award_member('00000000-0000-0000-0000-0000000000c1',
        'GNOME_GROWER_MONTHLY','price_live_grower','sub_b1','active',true,999,'evt_dup');
  insert into t(label,pass,detail) values ('T-AWARD-05 one subscription cannot seat two founders',
    r->>'reason' = 'SUBSCRIPTION_ALREADY_AWARDED'
      and (select count(*) = 1 from public.founding_members), r::text);

  -- GNOME_FARM_MONTHLY has NO live price configured — the production shape
  -- today. The award must fall back to the product key alone.
  r := public.founding_award_member('00000000-0000-0000-0000-0000000000c1',
        'GNOME_FARM_MONTHLY','price_live_farm_future','sub_c1','active',true,2999,'evt_c1');
  insert into t(label,pass,detail) values ('T-AWARD-06 a product with no live price yet still qualifies on key',
    (r->>'awarded')::boolean and (r->>'founding_number')::int = 2, r::text);

  r := public.founding_award_member('00000000-0000-0000-0000-0000000000d1',
        'GNOME_GROWER_MONTHLY','price_live_grower','sub_d1','active',true,999,'evt_d1');
  insert into t(label,pass,detail) values ('T-AWARD-07 numbers are handed out in order',
    (r->>'founding_number')::int = 3, r::text);

  r := public.founding_award_member('00000000-0000-0000-0000-0000000000e1',
        'GNOME_GROWER_MONTHLY','price_live_grower','sub_e1','active',true,999,'evt_e1');
  insert into t(label,pass,detail) values ('T-AWARD-08 fourth founder is #4',
    (r->>'founding_number')::int = 4, r::text);

  insert into t(label,pass,detail) values ('T-AWARD-09 every award is audited',
    (select count(*) = 4 from public.admin_audit_log
      where action = 'FOUNDING_MEMBER_AWARDED'),
    (select count(*)||' award audit rows' from public.admin_audit_log
      where action = 'FOUNDING_MEMBER_AWARDED'));
end $$;

-- --------------------------------------------------------------------------
-- C. Capacity remaining is a high-water calculation, not a headcount
-- --------------------------------------------------------------------------
do $$
begin
  insert into t(label,pass,detail) values ('T-CAP-01 four awarded leaves 496 remaining',
    public.founding_capacity_remaining() = 496, public.founding_capacity_remaining()||' remaining');

  insert into t(label,pass,detail) values ('T-CAP-02 the public program status agrees',
    (public.founding_program_status()->>'awarded')::int = 4
      and (public.founding_program_status()->>'remaining')::int = 496
      and (public.founding_program_status()->>'accepting')::boolean,
    public.founding_program_status()::text);
end $$;

-- --------------------------------------------------------------------------
-- D. Lifecycle: grace, lapse, recovery, cancellation, refund, plan changes
-- --------------------------------------------------------------------------
do $$
declare ok boolean; n int; m public.founding_members;
begin
  ok := public.founding_mark_payment_failed('sub_c1');
  select * into m from public.founding_members where current_subscription_id = 'sub_c1';
  insert into t(label,pass,detail) values ('T-LIFE-01 a failed payment starts the grace clock, status unchanged',
    ok and m.status = 'ACTIVE' and m.payment_failed_at is not null, m.status);

  n := public.founding_sweep_lapses();
  insert into t(label,pass,detail) values ('T-LIFE-02 the sweep does not lapse anyone inside the grace window',
    n = 0 and (select status = 'ACTIVE' from public.founding_members where current_subscription_id='sub_c1'),
    n||' lapsed');

  update public.founding_members set payment_failed_at = now() - interval '31 days'
   where current_subscription_id = 'sub_c1';
  n := public.founding_sweep_lapses();
  select * into m from public.founding_members where current_subscription_id = 'sub_c1';
  insert into t(label,pass,detail) values ('T-LIFE-03 grace expiry lapses the member but keeps the number',
    n = 1 and m.status = 'LAPSED' and m.lapsed_at is not null and m.founding_number = 2,
    m.status||' #'||m.founding_number);

  insert into t(label,pass,detail) values ('T-LIFE-04 a lapsed founder stops displaying the badge',
    not exists (select 1 from public.founding_badges where founding_number = 2),
    'founding_badges hides LAPSED');

  insert into t(label,pass,detail) values ('T-LIFE-05 lapsing frees no capacity',
    public.founding_capacity_remaining() = 496, public.founding_capacity_remaining()||' remaining');

  ok := public.founding_mark_payment_recovered('sub_c1');
  select * into m from public.founding_members where current_subscription_id = 'sub_c1';
  insert into t(label,pass,detail) values ('T-LIFE-06 recovery restores ACTIVE on the SAME number',
    ok and m.status = 'ACTIVE' and m.founding_number = 2 and m.payment_failed_at is null
      and m.lapsed_at is null, m.status||' #'||m.founding_number);

  ok := public.founding_lapse_member('sub_d1','CANCELLED_BY_MEMBER');
  select * into m from public.founding_members where current_subscription_id = 'sub_d1';
  insert into t(label,pass,detail) values ('T-LIFE-07 cancellation lapses immediately, number retained',
    ok and m.status = 'LAPSED' and m.founding_number = 3, m.status||' #'||m.founding_number);

  ok := public.founding_mark_payment_recovered('sub_d1');
  insert into t(label,pass,detail) values ('T-LIFE-08 resubscribing returns the same founder to ACTIVE',
    ok and (select status = 'ACTIVE' and founding_number = 3
              from public.founding_members where current_subscription_id='sub_d1'), 'restored');

  -- Upgrade: Stripe issues a new subscription id, the founder keeps everything.
  ok := public.founding_relink_subscription('sub_d1','sub_d1_farm','GNOME_FARM_MONTHLY');
  select * into m from public.founding_members where current_subscription_id = 'sub_d1_farm';
  insert into t(label,pass,detail) values ('T-LIFE-09 upgrading keeps the number and the original evidence',
    ok and m.founding_number = 3 and m.status = 'ACTIVE'
      and m.qualifying_subscription_id = 'sub_d1'
      and m.qualifying_product_key = 'GNOME_GROWER_MONTHLY',
    'qualifying stays '||m.qualifying_product_key);

  -- Downgrading off the marketplace plans is leaving, not upgrading.
  ok := public.founding_relink_subscription('sub_d1_farm','sub_d1_seed','GNOME_SEED_DROP_SEASONAL');
  insert into t(label,pass,detail) values ('T-LIFE-10 moving to a non-qualifying plan lapses the membership',
    ok and (select status = 'LAPSED' from public.founding_members where founding_number = 3),
    'LAPSED on plan exit');
  perform public.founding_mark_payment_recovered('sub_d1_farm');
end $$;

-- --------------------------------------------------------------------------
-- E. Founding Market activation and the bounded launch boost
-- --------------------------------------------------------------------------
do $$
declare r jsonb; mkt_b uuid := (select v from ids where k='mkt_b');
        mkt_f uuid := (select v from ids where k='mkt_f'); m public.founding_members;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000b1')::text, false);

  r := public.founding_activate_my_market(mkt_b);
  insert into t(label,pass,detail) values ('T-MKT-01 a demo listing does not make a Founding Market',
    r->>'reason' = 'NEEDS_ACTIVE_LISTING', r::text);

  r := public.founding_activate_my_market(mkt_f);
  insert into t(label,pass,detail) values ('T-MKT-02 you cannot activate a Market you do not own',
    r->>'reason' = 'NOT_YOUR_MARKET', r::text);

  insert into public.listings (owner_id, market_id, title)
    values ('00000000-0000-0000-0000-0000000000b1', mkt_b, 'Cherokee Purple tomatoes, 2 lb');

  r := public.founding_activate_my_market(mkt_b);
  select * into m from public.founding_members where user_id = '00000000-0000-0000-0000-0000000000b1';
  insert into t(label,pass,detail) values ('T-MKT-03 a real published listing activates the Founding Market',
    (r->>'activated')::boolean and r->>'label' = 'Founding Market'
      and m.market_id = mkt_b and m.market_activated_at is not null, r::text);

  insert into t(label,pass,detail) values ('T-MKT-04 the launch boost is bounded, not permanent',
    m.boost_until is not null
      and m.boost_until > now() + interval '59 days'
      and m.boost_until < now() + interval '91 days',
    'boost_until '||m.boost_until);

  insert into t(label,pass,detail) values ('T-MKT-05 the boost reads as active for that Market only',
    public.founding_market_boost_active(mkt_b)
      and not public.founding_market_boost_active(mkt_f), 'mkt_b boosted, mkt_f not');

  r := public.founding_activate_my_market(mkt_f);
  insert into t(label,pass,detail) values ('T-MKT-06 activation happens once — no boost farming',
    r->>'reason' = 'MARKET_ALREADY_ACTIVATED', r::text);

  insert into t(label,pass,detail) values ('T-MKT-07 the badge advertises the Founding Market',
    (select is_founding_market and launch_boost_active
       from public.founding_badges where founding_number = 1), 'badge shows the market');

  -- A lapsed founder's Market loses the boost even though boost_until is in
  -- the future: the predicate requires ACTIVE.
  perform public.founding_lapse_member('sub_b1','TEST_LAPSE');
  insert into t(label,pass,detail) values ('T-MKT-08 lapsing switches the boost off immediately',
    not public.founding_market_boost_active(mkt_b), 'boost follows ACTIVE status');
  perform public.founding_mark_payment_recovered('sub_b1');

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000f1')::text, false);
  r := public.founding_activate_my_market(mkt_f);
  insert into t(label,pass,detail) values ('T-MKT-09 a non-founder cannot activate a Founding Market',
    r->>'reason' = 'NOT_A_FOUNDING_MEMBER', r::text);

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a1')::text, false);
end $$;

-- Refund revokes, clears the boost, and burns the number rather than reissuing.
do $$
declare ok boolean; m public.founding_members;
begin
  ok := public.founding_revoke_for_refund('sub_e1','REFUND');
  select * into m from public.founding_members where founding_number = 4;
  insert into t(label,pass,detail) values ('T-LIFE-11 a refund revokes the membership',
    ok and m.status = 'REVOKED' and m.revoked_at is not null and m.boost_until is null,
    m.status||' / '||coalesce(m.revoked_reason,''));

  insert into t(label,pass,detail) values ('T-LIFE-12 a revoked founder is off the public badge list',
    not exists (select 1 from public.founding_badges where founding_number = 4), 'hidden');

  insert into t(label,pass,detail) values ('T-LIFE-13 revocation frees no capacity — the number is retired',
    public.founding_capacity_remaining() = 496, public.founding_capacity_remaining()||' remaining');
end $$;

-- --------------------------------------------------------------------------
-- F. Filling the program, and the 501st
-- --------------------------------------------------------------------------
do $$
declare cfg public.founding_program_config; i int; uid uuid; r jsonb;
begin
  select * into cfg from public.founding_program_config where id;
  for i in (cfg.last_founding_number + 1) .. 500 loop
    uid := ('20000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid;
    insert into public.profiles (id, name) values (uid, 'Founder '||i);
    r := public.founding_award_member(uid,'GNOME_GROWER_MONTHLY','price_live_grower',
           'sub_fill_'||i,'active',true,999,'evt_fill_'||i);
    if not (r->>'awarded')::boolean then
      raise exception 'fill failed at %: %', i, r;
    end if;
  end loop;
end $$;

do $$
declare r jsonb;
begin
  insert into t(label,pass,detail) values ('T-FULL-01 the 500th award lands exactly on 500',
    (select last_founding_number = 500 from public.founding_program_config where id)
      and (select max(founding_number) = 500 from public.founding_members),
    'high-water '||(select last_founding_number from public.founding_program_config where id));

  insert into t(label,pass,detail) values ('T-FULL-02 capacity remaining is zero',
    public.founding_capacity_remaining() = 0
      and not (public.founding_program_status()->>'accepting')::boolean,
    public.founding_program_status()::text);

  insert into public.profiles (id, name)
    values ('30000000-0000-0000-0000-000000000501','Too Late');
  r := public.founding_award_member('30000000-0000-0000-0000-000000000501',
        'GNOME_GROWER_MONTHLY','price_live_grower','sub_501','active',true,999,'evt_501');
  insert into t(label,pass,detail) values ('T-FULL-03 the 501st paying subscriber is refused',
    r->>'reason' = 'CAPACITY_EXHAUSTED' and not (r->>'awarded')::boolean, r::text);

  insert into t(label,pass,detail) values ('T-FULL-04 the refusal did not move the counter',
    (select last_founding_number = 500 from public.founding_program_config where id)
      and (select count(*) <= 500 from public.founding_members),
    (select count(*)||' rows' from public.founding_members));

  begin
    perform public.admin_founding_set_program('{"founding_capacity":501}'::jsonb);
    insert into t(label,pass,detail) values ('T-FULL-05 capacity cannot be raised above 500', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-FULL-05 capacity cannot be raised above 500',
      sqlstate = '23514', sqlstate||' '||sqlerrm);
  end;

  begin
    perform public.admin_founding_set_program('{"founding_capacity":400}'::jsonb);
    insert into t(label,pass,detail) values ('T-FULL-06 capacity cannot be cut below what is awarded', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-FULL-06 capacity cannot be cut below what is awarded',
      sqlstate = '23514', sqlstate||' '||sqlerrm);
  end;

  begin
    perform public.admin_founding_set_program('{"market_boost_days":365}'::jsonb);
    insert into t(label,pass,detail) values ('T-FULL-07 the launch boost cannot be stretched past 90 days', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-FULL-07 the launch boost cannot be stretched past 90 days',
      sqlstate = '23514', sqlstate||' '||sqlerrm);
  end;
end $$;

-- --------------------------------------------------------------------------
-- G. Renumbering is possible, awkward, and audited
-- --------------------------------------------------------------------------
-- Account deletion is the only thing that vacates a number. Founder #250
-- deletes their account, leaving the single gap this section works with.
delete from public.profiles where id = '20000000-0000-0000-0000-000000000250';

do $$
declare r jsonb; msg text;
begin
  insert into t(label,pass,detail) values ('T-NUM-01 deleting an account vacates its number without moving the counter',
    not exists (select 1 from public.founding_members where founding_number = 250)
      and (select last_founding_number = 500 from public.founding_program_config where id),
    'gap at 250, high-water still 500');

  begin
    perform public.admin_founding_renumber('00000000-0000-0000-0000-0000000000b1', 250,
      'Support ticket 118: awarded to the wrong account during the launch window.', 'yes do it');
    insert into t(label,pass,detail) values ('T-NUM-02 renumber refused without the typed confirmation', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-NUM-02 renumber refused without the typed confirmation',
      sqlerrm like '%CONFIRMATION_REQUIRED%', sqlerrm);
  end;

  begin
    perform public.admin_founding_renumber('00000000-0000-0000-0000-0000000000b1', 250,
      'fix', 'RENUMBER Founding Member #0001');
    insert into t(label,pass,detail) values ('T-NUM-03 renumber refused with a throwaway reason', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-NUM-03 renumber refused with a throwaway reason',
      sqlerrm like '%REASON_REQUIRED%', sqlerrm);
  end;

  begin
    perform public.admin_founding_renumber('00000000-0000-0000-0000-0000000000b1', 2,
      'Support ticket 118: awarded to the wrong account during the launch window.',
      'RENUMBER Founding Member #0001');
    insert into t(label,pass,detail) values ('T-NUM-04 renumber refused onto a number someone holds', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-NUM-04 renumber refused onto a number someone holds',
      sqlerrm like '%NUMBER_TAKEN%', sqlerrm);
  end;

  begin
    perform public.admin_founding_renumber('00000000-0000-0000-0000-0000000000b1', 501,
      'Support ticket 118: awarded to the wrong account during the launch window.',
      'RENUMBER Founding Member #0001');
    insert into t(label,pass,detail) values ('T-NUM-05 renumber cannot invent capacity', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-NUM-05 renumber cannot invent capacity',
      sqlerrm like '%NUMBER_OUT_OF_RANGE%', sqlerrm);
  end;

  r := public.admin_founding_renumber('00000000-0000-0000-0000-0000000000b1', 250,
        'Support ticket 118: awarded to the wrong account during the launch window.',
        'RENUMBER Founding Member #0001');
  insert into t(label,pass,detail) values ('T-NUM-06 a reasoned, confirmed renumber succeeds',
    (r->>'renumbered')::boolean and (r->>'to')::int = 250
      and r->>'display' = 'Founding Member #0250', r::text);

  insert into t(label,pass,detail) values ('T-NUM-07 the renumber is audited with both numbers',
    (select count(*) = 1 from public.admin_audit_log
      where action = 'FOUNDING_MEMBER_RENUMBERED'
        and (old_state->>'founding_number')::int = 1
        and (new_state->>'founding_number')::int = 250),
    (select coalesce(max(new_state::text),'no audit row') from public.admin_audit_log
      where action = 'FOUNDING_MEMBER_RENUMBERED'));

  insert into t(label,pass,detail) values ('T-NUM-08 the vacated number is retired, not reissued',
    not exists (select 1 from public.founding_members where founding_number = 1)
      and (select last_founding_number = 500 from public.founding_program_config where id),
    '#1 left empty, high-water still 500');

  begin
    update public.founding_members set founding_number = 499
     where user_id = '00000000-0000-0000-0000-0000000000c1';
    insert into t(label,pass,detail) values ('T-NUM-09 a direct UPDATE of the number is blocked', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-NUM-09 a direct UPDATE of the number is blocked',
      sqlerrm like '%FOUNDING_NUMBER_IMMUTABLE%', sqlerrm);
  end;

  begin
    update public.founding_members set qualifying_stripe_price_id = 'price_live_pretend'
     where user_id = '00000000-0000-0000-0000-0000000000c1';
    insert into t(label,pass,detail) values ('T-NUM-10 qualification evidence cannot be rewritten', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-NUM-10 qualification evidence cannot be rewritten',
      sqlerrm like '%FOUNDING_QUALIFICATION_IMMUTABLE%', sqlerrm);
  end;

  begin
    insert into public.founding_members (user_id, founding_number, qualifying_stripe_price_id,
      qualifying_product_key, qualifying_subscription_id, current_subscription_id, stripe_livemode)
    values ('00000000-0000-0000-0000-0000000000f1', 1, 'price_test_grower',
      'GNOME_GROWER_MONTHLY','sub_sneaky','sub_sneaky', false);
    insert into t(label,pass,detail) values ('T-NUM-11 a test-mode founder cannot exist at all', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-NUM-11 a test-mode founder cannot exist at all',
      sqlstate = '23514', sqlstate||' '||sqlerrm);
  end;
end $$;

-- --------------------------------------------------------------------------
-- H. Authorization: who may call what
-- --------------------------------------------------------------------------
do $$
declare bad text; n int;
begin
  select string_agg(distinct table_name||':'||grantee||':'||privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where table_schema='public'
     and table_name in ('founding_members','founding_program_config','founding_badges')
     and grantee in ('anon','authenticated') and privilege_type <> 'SELECT';
  insert into t(label,pass,detail) values ('T-SEC-01 no client write grant on any founding object',
    bad is null, coalesce(bad,'select-only'));

  select count(*) into n from information_schema.role_table_grants
   where table_schema='public' and table_name in ('founding_members','founding_program_config')
     and grantee = 'anon';
  insert into t(label,pass,detail) values ('T-SEC-02 anon cannot touch the base tables at all',
    n = 0, n||' anon grants');

  select count(*) into n from pg_class c join pg_namespace s on s.oid=c.relnamespace
   where s.nspname='public' and c.relrowsecurity
     and c.relname in ('founding_members','founding_program_config');
  insert into t(label,pass,detail) values ('T-SEC-03 RLS is enabled on both founding tables',
    n = 2, n||'/2');

  insert into t(label,pass,detail) values ('T-SEC-04 no client role can execute the award RPC',
    not has_function_privilege('authenticated',
      'public.founding_award_member(uuid,text,text,text,text,boolean,int,text,uuid)','execute')
    and not has_function_privilege('anon',
      'public.founding_award_member(uuid,text,text,text,text,boolean,int,text,uuid)','execute'),
    'award is service-role only');

  insert into t(label,pass,detail) values ('T-SEC-05 no client role can drive the lifecycle RPCs',
    not has_function_privilege('authenticated','public.founding_lapse_member(text,text)','execute')
    and not has_function_privilege('authenticated','public.founding_revoke_for_refund(text,text)','execute')
    and not has_function_privilege('authenticated','public.founding_mark_payment_recovered(text)','execute')
    and not has_function_privilege('authenticated','public.founding_sweep_lapses()','execute')
    and not has_function_privilege('authenticated','public.founding_relink_subscription(text,text,text)','execute'),
    'lifecycle is service-role only');

  insert into t(label,pass,detail) values ('T-SEC-06 the badge and the counters stay publicly readable',
    has_function_privilege('anon','public.founding_program_status()','execute')
    and has_function_privilege('anon','public.founding_capacity_remaining()','execute')
    and has_table_privilege('anon','public.founding_badges','select'),
    'public surface intact');
end $$;

-- Owner-only RPCs, exercised as a plain signed-in user.
do $$
begin
  perform set_config('test.is_owner','false', false);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000f1')::text, false);

  begin
    perform public.admin_founding_set_program('{"program_enabled":false}'::jsonb);
    insert into t(label,pass,detail) values ('T-SEC-07 a non-owner cannot change the program', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-SEC-07 a non-owner cannot change the program',
      sqlerrm like '%NOT_AUTHORIZED%', sqlerrm);
  end;

  begin
    perform public.admin_founding_revoke('00000000-0000-0000-0000-0000000000c1','because I said so');
    insert into t(label,pass,detail) values ('T-SEC-08 a non-owner cannot revoke a founder', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-SEC-08 a non-owner cannot revoke a founder',
      sqlerrm like '%NOT_AUTHORIZED%', sqlerrm);
  end;

  begin
    perform public.admin_founding_renumber('00000000-0000-0000-0000-0000000000c1', 1,
      'I would simply like the number one for myself, thank you.',
      'RENUMBER Founding Member #0002');
    insert into t(label,pass,detail) values ('T-SEC-09 a non-owner cannot renumber a founder', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-SEC-09 a non-owner cannot renumber a founder',
      sqlerrm like '%NOT_AUTHORIZED%', sqlerrm);
  end;

  perform set_config('test.is_owner','true', false);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a1')::text, false);
end $$;

-- --------------------------------------------------------------------------
-- I. RLS proven by actually becoming the roles, not by reading the catalog
-- --------------------------------------------------------------------------
begin;
do $$ begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000c1')::text, false);
  perform set_config('test.is_owner','false', false);
end $$;
set local role authenticated;
do $$
declare n int; own int;
begin
  select count(*) into n from public.founding_members;
  select count(*) into own from public.founding_members where user_id = auth.uid();
  insert into t(label,pass,detail) values ('T-RLS-01 a member sees exactly one row: their own',
    n = 1 and own = 1, n||' visible row(s)');

  select count(*) into n from public.founding_program_config;
  insert into t(label,pass,detail) values ('T-RLS-02 a member cannot read the program config',
    n = 0, n||' config row(s)');

  select count(*) into n from public.founding_badges;
  insert into t(label,pass,detail) values ('T-RLS-03 the public badge list is readable and non-empty',
    n > 0, n||' badges');

  select count(*) into n from public.founding_badges where founding_number = 4;
  insert into t(label,pass,detail) values ('T-RLS-04 the badge list still excludes the revoked founder',
    n = 0, 'revoked #4 absent');

  insert into t(label,pass,detail) values ('T-RLS-05 my_founding_membership() returns the caller''s own number',
    (public.my_founding_membership()->>'founding_number')::int = 2,
    public.my_founding_membership()::text);

  begin
    perform public.founding_award_member('00000000-0000-0000-0000-0000000000f1',
      'GNOME_GROWER_MONTHLY','price_live_grower','sub_selfclaim','active',true,999,'evt_selfclaim');
    insert into t(label,pass,detail) values ('T-RLS-06 a signed-in user cannot award themselves a number', false, 'ACCEPTED');
  exception when insufficient_privilege then
    insert into t(label,pass,detail) values ('T-RLS-06 a signed-in user cannot award themselves a number',
      true, 'permission denied for founding_award_member');
  end;

  begin
    update public.founding_members set status = 'ACTIVE' where user_id = auth.uid();
    insert into t(label,pass,detail) values ('T-RLS-07 a member cannot write their own row', false, 'ACCEPTED');
  exception when insufficient_privilege then
    insert into t(label,pass,detail) values ('T-RLS-07 a member cannot write their own row',
      true, 'permission denied for founding_members');
  end;
end $$;
reset role;
commit;

begin;
do $$ begin perform set_config('request.jwt.claims', '{}', false); end $$;
set local role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from public.founding_members;
    insert into t(label,pass,detail) values ('T-RLS-08 anon cannot read the roster at all', false, n||' rows');
  exception when insufficient_privilege then
    insert into t(label,pass,detail) values ('T-RLS-08 anon cannot read the roster at all',
      true, 'permission denied for founding_members');
  end;

  select count(*) into n from public.founding_badges;
  insert into t(label,pass,detail) values ('T-RLS-09 anon can read the public badges',
    n > 0, n||' badges');

  insert into t(label,pass,detail) values ('T-RLS-10 anon sees the remaining-slots counter',
    public.founding_capacity_remaining() = 0, public.founding_capacity_remaining()||' remaining');
end $$;
reset role;
commit;

-- --------------------------------------------------------------------------
-- J. The flag really does hide the whole program
-- --------------------------------------------------------------------------
do $$
declare n int;
begin
  perform set_config('test.is_owner','true', false);
  perform public.admin_founding_set_program('{"program_enabled":false}'::jsonb);

  select count(*) into n from public.founding_badges;
  insert into t(label,pass,detail) values ('T-OFF-01 turning the flag off empties the public badge list',
    n = 0, n||' badges visible');

  insert into t(label,pass,detail) values ('T-OFF-02 the program reports only "disabled" when off',
    public.founding_program_status() = '{"enabled": false}'::jsonb,
    public.founding_program_status()::text);

  insert into t(label,pass,detail) values ('T-OFF-03 no boost is served while the program is off',
    not public.founding_market_boost_active((select v from ids where k='mkt_b')),
    'boost predicate follows the flag');

  insert into t(label,pass,detail) values ('T-OFF-04 the roster itself survives the flag',
    (select count(*) > 490 from public.founding_members),
    (select count(*)||' rows retained' from public.founding_members));

  perform public.admin_founding_set_program('{"program_enabled":true}'::jsonb);

  select count(*) into n from public.admin_audit_log
   where action in ('FOUNDING_MEMBER_AWARDED','FOUNDING_MEMBER_LAPSED','FOUNDING_MEMBER_REVOKED',
                    'FOUNDING_MEMBER_RENUMBERED','FOUNDING_MARKET_ACTIVATED',
                    'FOUNDING_PAYMENT_FAILED','FOUNDING_PAYMENT_RECOVERED',
                    'FOUNDING_SUBSCRIPTION_RELINKED','FOUNDING_PROGRAM_UPDATED');
  insert into t(label,pass,detail) values ('T-AUD-01 award, lapse, revoke, renumber and flag changes are all audited',
    (select count(distinct action) >= 8 from public.admin_audit_log where action like 'FOUNDING%')
      and n > 500, n||' founding audit rows');
end $$;

select n, label, case when pass then 'PASS' else 'FAIL' end as result, detail
  from t order by n;
select count(*) filter (where pass) || '/' || count(*) || ' Founding Member cases pass' as summary from t;
select 'FOUNDING MEMBER PROGRAM: ' ||
       case when bool_and(pass) then 'ALL TESTS PASSED' else 'FAILURES PRESENT' end as verdict
  from t;
