\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_true(p_label text, p_value boolean)
returns void language plpgsql as $$
begin
  if p_value is not true then
    raise exception 'FAIL: %', p_label;
  end if;
  raise notice 'PASS: %', p_label;
end;
$$;

create or replace function pg_temp.expect_error(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_needle in sqlerrm) > 0 then
      raise notice 'PASS: % -> %', p_label, p_needle;
      return;
    end if;
    raise exception 'FAIL: % expected %, got %', p_label, p_needle, sqlerrm;
  end;
  raise exception 'FAIL: % expected error %', p_label, p_needle;
end;
$$;

-- Stable fixture identities. No real user data is used.
insert into auth.users (id,email,email_confirmed_at,phone,phone_confirmed_at)
select id, id::text || '@test.invalid', now(), '+15550000' || right(id::text, 4), now()
from (values
  ('00000000-0000-0000-0000-000000000101'::uuid),
  ('00000000-0000-0000-0000-000000000102'::uuid),
  ('00000000-0000-0000-0000-000000000103'::uuid),
  ('00000000-0000-0000-0000-000000000104'::uuid),
  ('00000000-0000-0000-0000-000000000105'::uuid),
  ('00000000-0000-0000-0000-000000000106'::uuid),
  ('00000000-0000-0000-0000-000000000107'::uuid),
  ('00000000-0000-0000-0000-000000000108'::uuid),
  ('00000000-0000-0000-0000-000000000109'::uuid),
  ('00000000-0000-0000-0000-000000000201'::uuid),
  ('00000000-0000-0000-0000-000000000202'::uuid),
  ('00000000-0000-0000-0000-000000000203'::uuid),
  ('00000000-0000-0000-0000-000000000204'::uuid)
) u(id);

insert into auth.identities (provider_id,user_id,identity_data,provider)
select id::text, id,
       jsonb_build_object(
         'sub', id::text,
         'email', email,
         'email_verified', id <> '00000000-0000-0000-0000-000000000102'::uuid
       ),
       'email'
from auth.users
where email like '%@test.invalid';

-- Profile creation auto-creates the initial Market before policy acceptance is
-- possible. The P0 gate permits only that nested bootstrap insert.
insert into public.profiles (id,name)
select id, 'P0 test ' || right(id::text, 4)
from auth.users where email like '%@test.invalid'
on conflict (id) do update set name = excluded.name;

-- Current acceptances for all matrix/action users, selectively made stale below.
insert into public.account_policy_acceptances
  (user_id,terms_version,privacy_version,marketplace_rules_version,age_policy_version,age_confirmed_18)
select u.id,v.terms_version,v.privacy_version,v.marketplace_rules_version,v.age_policy_version,true
from auth.users u cross join public.account_policy_versions v
where u.email like '%@test.invalid' and v.id;

update auth.users set email_confirmed_at=null
 where id='00000000-0000-0000-0000-000000000109';
update auth.users set phone_confirmed_at=null
 where id='00000000-0000-0000-0000-000000000103';
update public.account_policy_acceptances set age_confirmed_18=false
 where user_id='00000000-0000-0000-0000-000000000104';
update public.account_policy_acceptances set terms_version=terms_version || '-old'
 where user_id='00000000-0000-0000-0000-000000000105';
update public.account_policy_acceptances set privacy_version=privacy_version || '-old'
 where user_id='00000000-0000-0000-0000-000000000106';
update public.account_policy_acceptances set marketplace_rules_version=marketplace_rules_version || '-old'
 where user_id='00000000-0000-0000-0000-000000000107';

select pg_temp.assert_true('A verified email + age + current policies is ready',
  (select account_ready from public.account_readiness_for_user('00000000-0000-0000-0000-000000000101')));
select pg_temp.assert_true('B auto-confirm timestamp without identity proof is not ready',
  not (select account_ready from public.account_readiness_for_user('00000000-0000-0000-0000-000000000102'))
  and array_position((select missing from public.account_readiness_for_user('00000000-0000-0000-0000-000000000102')),'verified_email') is not null);
select pg_temp.assert_true('B2 identity proof without Auth confirmation timestamp is not ready',
  not (select account_ready from public.account_readiness_for_user('00000000-0000-0000-0000-000000000109'))
  and array_position((select missing from public.account_readiness_for_user('00000000-0000-0000-0000-000000000109')),'verified_email') is not null);
select pg_temp.assert_true('C unverified phone does not block launch readiness',
  (select account_ready from public.account_readiness_for_user('00000000-0000-0000-0000-000000000103'))
  and array_position((select missing from public.account_readiness_for_user('00000000-0000-0000-0000-000000000103')),'verified_phone') is null);
select pg_temp.assert_true('D age not confirmed is not ready',
  not (select account_ready from public.account_readiness_for_user('00000000-0000-0000-0000-000000000104'))
  and array_position((select missing from public.account_readiness_for_user('00000000-0000-0000-0000-000000000104')),'age_18') is not null);
select pg_temp.assert_true('E old Terms is not ready',
  not (select account_ready from public.account_readiness_for_user('00000000-0000-0000-0000-000000000105'))
  and array_position((select missing from public.account_readiness_for_user('00000000-0000-0000-0000-000000000105')),'terms') is not null);
select pg_temp.assert_true('F old Privacy is not ready',
  not (select account_ready from public.account_readiness_for_user('00000000-0000-0000-0000-000000000106'))
  and array_position((select missing from public.account_readiness_for_user('00000000-0000-0000-0000-000000000106')),'privacy') is not null);
select pg_temp.assert_true('G old Marketplace Rules is not ready',
  not (select account_ready from public.account_readiness_for_user('00000000-0000-0000-0000-000000000107'))
  and array_position((select missing from public.account_readiness_for_user('00000000-0000-0000-0000-000000000107')),'marketplace_rules') is not null);
select pg_temp.assert_true('H all current remains ready',
  (select account_ready from public.account_readiness_for_user('00000000-0000-0000-0000-000000000108')));

-- Acceptance RPC rejects partial consent and records only explicit all-current consent.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000108","role":"authenticated"}', false);
select pg_temp.expect_error('partial policy acceptance',
  $$select public.accept_current_account_policies(true,true,false,true)$$,'ACCEPTANCE_REQUIRED');
select public.accept_current_account_policies(true,true,true,true);
select pg_temp.assert_true('acceptance RPC refreshes current account state',
  (select account_ready from public.my_account_readiness()));

-- Action actors: 201 ready seller, 202 ready buyer, 203 non-ready, 204 compliance admin.
update public.account_policy_acceptances set terms_version=terms_version || '-old'
 where user_id='00000000-0000-0000-0000-000000000203';
insert into public.admin_users (user_id,status,role)
values ('00000000-0000-0000-0000-000000000204','active','COMPLIANCE_ADMIN');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000201","role":"authenticated"}', false);
insert into public.markets (id,owner_id,name,slug,city,state)
values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000201','Ready Market','p0-ready-market','Columbus','OH');
insert into public.listings
  (id,owner_id,market_id,title,category,listing_type,price_cents,inventory_count,status,expires_at,city,state)
values
  ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000201',
   '20000000-0000-0000-0000-000000000001','P0 Test Carrots','vegetables','sale',500,10,'active',now()+interval '7 days','Columbus','OH');
select pg_temp.assert_true('ready account can publish allowed listing',
  exists(select 1 from public.listings where id='30000000-0000-0000-0000-000000000001'));

-- Seed a market for the non-ready seller while ready, then invalidate again.
update public.account_policy_acceptances a
set terms_version=v.terms_version
from public.account_policy_versions v
where a.user_id='00000000-0000-0000-0000-000000000203' and v.id;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000203","role":"authenticated"}', false);
insert into public.markets (id,owner_id,name,slug,city,state)
values ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000203','Not Ready Market','p0-not-ready-market','Columbus','OH');
update public.account_policy_acceptances set terms_version=terms_version || '-old'
 where user_id='00000000-0000-0000-0000-000000000203';

select pg_temp.expect_error('non-ready direct listing publish',
  $$insert into public.listings (owner_id,market_id,title,category,listing_type,price_cents,status,expires_at)
    values ('00000000-0000-0000-0000-000000000203','20000000-0000-0000-0000-000000000002','Blocked Carrots','vegetables','sale',500,'active',now()+interval '7 days')$$,
  'ACCOUNT_NOT_READY:listing');
select pg_temp.expect_error('non-ready direct reservation',
  $$insert into public.claims (listing_id,claimer_id,claim_type,quantity_requested,agreed_price_cents)
    values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000203','purchase_request',1,500)$$,
  'ACCOUNT_NOT_READY:reservation');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000202","role":"authenticated"}', false);
insert into public.claims (id,listing_id,claimer_id,claim_type,quantity_requested,agreed_price_cents)
values ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000202','purchase_request',1,500);
select pg_temp.assert_true('ready account can reserve',
  exists(select 1 from public.claims where id='40000000-0000-0000-0000-000000000001'));

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000203","role":"authenticated"}', false);
select pg_temp.expect_error('non-ready direct message',
  $$insert into public.claim_messages (claim_id,sender_id,body)
    values ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000203','blocked')$$,
  'ACCOUNT_NOT_READY:message');
select pg_temp.expect_error('non-ready direct follow',
  $$insert into public.market_follows (market_id,follower_id)
    values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000203')$$,
  'ACCOUNT_NOT_READY:follow_market');
select pg_temp.expect_error('non-ready server Zordy reservation',
  $$select * from public.zordy_reserve_request('00000000-0000-0000-0000-000000000203')$$,
  'ACCOUNT_NOT_READY:zordy');
select pg_temp.expect_error('non-ready direct credential submission',
  $$insert into public.seller_credentials (seller_id,market_id,state,credential_type)
    values ('00000000-0000-0000-0000-000000000203','20000000-0000-0000-0000-000000000002','OH','test permit')$$,
  'ACCOUNT_NOT_READY:seller_credential');
select pg_temp.expect_error('non-ready external payment method configuration',
  $$insert into public.market_payment_methods (market_id,method,handle)
    values ('20000000-0000-0000-0000-000000000002','venmo','test-only')$$,
  'ACCOUNT_NOT_READY:market_payment_methods');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000202","role":"authenticated"}', false);
insert into public.claim_messages (claim_id,sender_id,body)
values ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000202','Ready message');
insert into public.market_follows (market_id,follower_id)
values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000202');
select pg_temp.assert_true('ready account can message and follow',
  exists(select 1 from public.claim_messages where body='Ready message')
  and exists(select 1 from public.market_follows where follower_id='00000000-0000-0000-0000-000000000202'));
select pg_temp.assert_true('ready account can use Zordy',
  (select allowed from public.zordy_reserve_request('00000000-0000-0000-0000-000000000202')));

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000201","role":"authenticated"}', false);
update public.markets set tagline='Ready update' where id='20000000-0000-0000-0000-000000000001';
insert into public.market_payment_methods (market_id,method,handle)
values ('20000000-0000-0000-0000-000000000001','venmo','ready-test');
insert into public.seller_credentials (id,seller_id,market_id,state,credential_type,document_path)
values ('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000201',
        '20000000-0000-0000-0000-000000000001','OH','test permit',
        '00000000-0000-0000-0000-000000000201/permit.pdf');
select pg_temp.assert_true('ready seller can manage Market, payment method, and credentials',
  (select tagline='Ready update' from public.markets where id='20000000-0000-0000-0000-000000000001')
  and exists(select 1 from public.market_payment_methods where market_id='20000000-0000-0000-0000-000000000001')
  and exists(select 1 from public.seller_credentials where id='60000000-0000-0000-0000-000000000001'));

-- Pickup privacy matrix.
insert into public.market_pickup_locations
  (id,market_id,nickname,address_line,city,state,postal_code,instructions,is_default)
values ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
        'Private porch','123 Test Street','Columbus','OH','43004','Ring test bell',true);
insert into public.market_orders
  (id,market_id,buyer_id,status,requested_start,requested_end,timezone,pickup_location_id,pickup_location_name)
values
  ('70000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000202','CONFIRMED',now()+interval '1 day',now()+interval '25 hours','America/New_York','50000000-0000-0000-0000-000000000001','Private porch'),
  ('70000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000202','REQUESTED',now()+interval '2 days',now()+interval '49 hours','America/New_York','50000000-0000-0000-0000-000000000001','Private porch');

select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.assert_true('anonymous cannot execute pickup-details RPC',
  not has_function_privilege('anon','public.order_pickup_details(uuid)','execute'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated"}', false);
select pg_temp.assert_true('unrelated ready user receives no private pickup details',
  not exists(select 1 from public.order_pickup_details('70000000-0000-0000-0000-000000000001')));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000202","role":"authenticated"}', false);
select pg_temp.assert_true('ready buyer without approved reservation receives no details',
  not exists(select 1 from public.order_pickup_details('70000000-0000-0000-0000-000000000002')));
select pg_temp.assert_true('approved ready buyer receives private pickup details',
  (select address='123 Test Street' and instructions='Ring test bell'
   from public.order_pickup_details('70000000-0000-0000-0000-000000000001')));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000201","role":"authenticated"}', false);
select pg_temp.assert_true('ready seller receives private pickup details',
  (select address='123 Test Street' from public.order_pickup_details('70000000-0000-0000-0000-000000000001')));

-- A non-ready approved buyer is denied, even though the order relationship exists.
update public.account_policy_acceptances a set terms_version=v.terms_version
from public.account_policy_versions v where a.user_id='00000000-0000-0000-0000-000000000203' and v.id;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000203","role":"authenticated"}', false);
insert into public.market_orders
  (id,market_id,buyer_id,status,requested_start,requested_end,timezone,pickup_location_id)
values ('70000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000203','CONFIRMED',now()+interval '3 days',now()+interval '73 hours','America/New_York','50000000-0000-0000-0000-000000000001');
update public.account_policy_acceptances set terms_version=terms_version || '-old'
 where user_id='00000000-0000-0000-0000-000000000203';
select pg_temp.expect_error('non-ready approved buyer private pickup access',
  $$select * from public.order_pickup_details('70000000-0000-0000-0000-000000000003')$$,
  'ACCOUNT_NOT_READY:pickup_details');

-- Credential approval snapshots and freezes scope.
insert into public.marketplace_taxonomy_nodes (id,name,slug,path,depth,display_order)
values
  ('90000000-0000-0000-0000-000000000001','Test Produce','test-produce','test-produce',0,1),
  ('90000000-0000-0000-0000-000000000002','Test Pantry','test-pantry','test-pantry',0,2);
insert into public.credential_taxonomy_scope (credential_id,taxonomy_node_id)
select '60000000-0000-0000-0000-000000000001',id
from public.marketplace_taxonomy_nodes order by path limit 1;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000204","role":"authenticated"}', false);
select public.admin_review_credential('60000000-0000-0000-0000-000000000001','APPROVE',null);
select pg_temp.assert_true('credential approval records deterministic scope snapshot',
  (select cardinality(approved_scope_node_ids)=1 and approved_scope_hash=md5(approved_scope_node_ids::text)
   from public.seller_credentials where id='60000000-0000-0000-0000-000000000001'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000201","role":"authenticated"}', false);
select pg_temp.expect_error('approved credential scope is seller-immutable',
  $$insert into public.credential_taxonomy_scope (credential_id,taxonomy_node_id)
    select '60000000-0000-0000-0000-000000000001',id from public.marketplace_taxonomy_nodes
    where id not in (select taxonomy_node_id from public.credential_taxonomy_scope where credential_id='60000000-0000-0000-0000-000000000001')
    order by path limit 1$$,
  'CREDENTIAL_SCOPE_LOCKED');

-- Credential table RLS and private Storage policies under actual client roles.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000201","role":"authenticated"}', false);
select pg_temp.assert_true('seller sees own credential',
  (select count(*)=1 from public.seller_credentials where id='60000000-0000-0000-0000-000000000001'));
insert into storage.objects (id,bucket_id,name,owner)
values ('80000000-0000-0000-0000-000000000001','compliance-docs','00000000-0000-0000-0000-000000000201/permit.pdf','00000000-0000-0000-0000-000000000201');
select pg_temp.assert_true('seller sees own private compliance object',
  (select count(*)=1 from storage.objects where id='80000000-0000-0000-0000-000000000001'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated"}', false);
select pg_temp.assert_true('unrelated user cannot see credential or object',
  (select count(*)=0 from public.seller_credentials where id='60000000-0000-0000-0000-000000000001')
  and (select count(*)=0 from storage.objects where id='80000000-0000-0000-0000-000000000001'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000204","role":"authenticated"}', false);
select pg_temp.assert_true('compliance admin can see credential and private object',
  (select count(*)=1 from public.seller_credentials where id='60000000-0000-0000-0000-000000000001')
  and (select count(*)=1 from storage.objects where id='80000000-0000-0000-0000-000000000001'));
reset role;

select pg_temp.assert_true('compliance-docs bucket is private',
  (select public is false from storage.buckets where id='compliance-docs'));
select pg_temp.assert_true('public listing views expose no credential document fields',
  not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name like '%listing%'
      and column_name ~* '(document|credential_number|permit)'
  ) and not exists (
    select 1 from pg_views where schemaname='public' and viewname like '%listing%'
      and definition ~* '(document_path|credential_number)'
  ));

-- Privilege checks catch public grants and client/service-role confusion.
select pg_temp.assert_true('anon cannot read private acceptances',
  not has_table_privilege('anon','public.account_policy_acceptances','select'));
select pg_temp.assert_true('anon cannot read my readiness',
  not has_function_privilege('anon','public.my_account_readiness()','execute'));
select pg_temp.assert_true('authenticated cannot call cross-user readiness helper',
  not has_function_privilege('authenticated','public.account_readiness_for_user(uuid)','execute'));
select pg_temp.assert_true('authenticated cannot reserve Zordy quota directly',
  not has_function_privilege('authenticated','public.zordy_reserve_request(uuid)','execute'));
select pg_temp.assert_true('service role can reserve Zordy after readiness gate',
  has_function_privilege('service_role','public.zordy_reserve_request(uuid)','execute'));
select pg_temp.assert_true('payments remain disabled',
  not exists(select 1 from public.billing_config where payments_live_enabled));

rollback;
