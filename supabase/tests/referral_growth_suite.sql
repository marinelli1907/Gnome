\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.assert_true(label text,value boolean)
returns void language plpgsql as $$ begin
  if value is not true then raise exception 'FAIL: %',label; end if;
  raise notice 'PASS: %',label;
end $$;

create or replace function pg_temp.expect_error(label text,statement text,needle text)
returns void language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if position(needle in sqlerrm)>0 then raise notice 'PASS: % -> %',label,needle; return; end if;
    raise exception 'FAIL: % expected %, got %',label,needle,sqlerrm;
  end;
  raise exception 'FAIL: % expected error %',label,needle;
end $$;

insert into auth.users(id,email,email_confirmed_at)
select ('b2000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
  format('referral-%s@test.invalid',i),now() from generate_series(1,11) i;
insert into auth.identities(provider_id,user_id,identity_data,provider)
select id::text,id,jsonb_build_object('sub',id::text,'email',email,'email_verified',true),'email'
from auth.users where email like 'referral-%@test.invalid';
insert into public.profiles(id,name)
select id,format('Referral Fixture %s',split_part(email,'-',2)) from auth.users where email like 'referral-%@test.invalid';
insert into public.account_policy_acceptances(user_id,terms_version,privacy_version,marketplace_rules_version,age_policy_version,age_confirmed_18)
select u.id,v.terms_version,v.privacy_version,v.marketplace_rules_version,v.age_policy_version,true
from auth.users u cross join public.account_policy_versions v where u.email like 'referral-%@test.invalid' and v.id;

do $$
declare referrer uuid:='b2000000-0000-0000-0000-000000000001'; referred uuid; ident public.referral_identities; i int;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',referrer,'role','authenticated')::text,true);
  ident:=public._ensure_referral_identity(referrer,'APP',null);
  for i in 2..11 loop
    referred:=('b2000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',referred,'role','authenticated')::text,true);
    perform public.capture_my_referral(ident.code,'APP_LINK',null);
    update public.markets set status='active' where owner_id=referred;
    insert into public.listings(owner_id,market_id,title,category,listing_type,price_cents,unit,status,expires_at)
    select referred,id,format('Referral tomatoes %s',i),'vegetables','sale',500,'basket','active',now()+interval '7 days'
    from public.markets where owner_id=referred;
  end loop;
end $$;

select pg_temp.assert_true('ten distinct referred sellers qualify exactly once',
  (select count(*)=10 from public.referral_attributions where referrer_user_id='b2000000-0000-0000-0000-000000000001' and status='QUALIFIED'));
select pg_temp.assert_true('each referred seller receives one Featured Listing credit',
  (select count(*)=10 and sum(quantity)=10 from public.referral_reward_ledger
    where referrer_user_id='b2000000-0000-0000-0000-000000000001'
      and idempotency_key like 'Q:%:REFERRED' and status='ISSUED'));
select pg_temp.assert_true('buyer referrer receives no useless seller reward before selling',
  not exists(select 1 from public.market_promotion_credits c join public.markets m on m.id=c.market_id
    where m.owner_id='b2000000-0000-0000-0000-000000000001' and c.source='REFERRAL_REWARD')
  and (select count(*)=16 from public.referral_reward_ledger where beneficiary_user_id='b2000000-0000-0000-0000-000000000001' and status='DEFERRED'));

select set_config('request.jwt.claims','{"sub":"b2000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
update public.markets set status='active' where owner_id='b2000000-0000-0000-0000-000000000001';
insert into public.listings(owner_id,market_id,title,category,listing_type,price_cents,unit,status,expires_at)
select owner_id,id,'Referrer first tomatoes','vegetables','sale',500,'basket','active',now()+interval '7 days'
from public.markets where owner_id='b2000000-0000-0000-0000-000000000001';

select pg_temp.assert_true('deferred buyer rewards activate after seller qualification',
  (select coalesce(sum(c.delta),0)=28 from public.market_promotion_credits c join public.markets m on m.id=c.market_id
    where m.owner_id='b2000000-0000-0000-0000-000000000001' and c.source='REFERRAL_REWARD')
  and (select count(*)=2 and sum(extract(day from expires_at-starts_at))=120 from public.admin_plan_grants
    where user_id='b2000000-0000-0000-0000-000000000001' and grant_source='REFERRAL')
  and (select coalesce(sum(c.delta),0)=1 from public.market_featured_boost_credits c join public.markets m on m.id=c.market_id
    where m.owner_id='b2000000-0000-0000-0000-000000000001'));
select pg_temp.assert_true('milestone grants never touch Stripe',
  not exists(select 1 from public.market_subscriptions where market_id=(select id from public.markets where owner_id='b2000000-0000-0000-0000-000000000001')));

select public.qualify_seller_referral((select id from public.listings where title='Referral tomatoes 2'));
select pg_temp.assert_true('qualification replay does not duplicate rewards',
  (select count(*)=26 from public.referral_reward_ledger where referrer_user_id='b2000000-0000-0000-0000-000000000001'));
select pg_temp.expect_error('self referral is blocked',
  $$select public.capture_my_referral((select code from public.referral_identities where user_id='b2000000-0000-0000-0000-000000000001'),'APP_LINK',null)$$,
  'SELF_REFERRAL_NOT_ALLOWED');
select pg_temp.assert_true('private referral tables have no client table grants',
  not has_table_privilege('authenticated','public.referral_identities','select')
  and not has_table_privilege('authenticated','public.referral_attributions','select')
  and not has_table_privilege('authenticated','public.referral_reward_ledger','select'));
select pg_temp.assert_true('public Market boost projection is SELECT-only',
  has_table_privilege('anon','public.public_active_market_boosts','select')
  and has_table_privilege('authenticated','public.public_active_market_boosts','select')
  and not has_table_privilege('anon','public.public_active_market_boosts','insert')
  and not has_table_privilege('anon','public.public_active_market_boosts','update')
  and not has_table_privilege('anon','public.public_active_market_boosts','delete')
  and not has_table_privilege('authenticated','public.public_active_market_boosts','insert')
  and not has_table_privilege('authenticated','public.public_active_market_boosts','update')
  and not has_table_privilege('authenticated','public.public_active_market_boosts','delete'));
select pg_temp.assert_true('25 and 50 are tracked without automatic plan rewards',
  position('OWNER_APPROVAL_REQUIRED' in pg_get_functiondef('public._issue_referral_milestones(uuid)'::regprocedure))>0
  and position('M25:TRACK' in pg_get_functiondef('public._issue_referral_milestones(uuid)'::regprocedure))>0
  and position('M50:TRACK' in pg_get_functiondef('public._issue_referral_milestones(uuid)'::regprocedure))>0);
select pg_temp.assert_true('FOUNDING3 is truthful and payment-gated',
  (select conversion_behavior='AUTO_RENEW' and payment_method_required and duration='repeating' and duration_in_months=3
    and discount_percent=100 and applicable_plans=array['grower']::public.market_plan[] from public.promotion_campaigns where code='FOUNDING3'));
select pg_temp.assert_true('payments remain disabled',(select payments_live_enabled=false from public.billing_config where id));

rollback;
