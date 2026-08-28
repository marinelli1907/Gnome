\set ON_ERROR_STOP on

insert into auth.users(id,email,email_confirmed_at,confirmed_at) values
 ('b1000000-0000-4000-8000-000000000001','apple@example.test',now(),now()),
 ('b1000000-0000-4000-8000-000000000002','other@example.test',now(),now()),
 ('b1000000-0000-4000-8000-000000000003','unready@example.test',now(),now());
insert into auth.identities(provider_id,user_id,identity_data,provider) values
 ('apple@example.test','b1000000-0000-4000-8000-000000000001','{"email":"apple@example.test","email_verified":true}','email'),
 ('other@example.test','b1000000-0000-4000-8000-000000000002','{"email":"other@example.test","email_verified":true}','email'),
 ('unready@example.test','b1000000-0000-4000-8000-000000000003','{"email":"unready@example.test","email_verified":true}','email');
insert into public.profiles(id,name) values
 ('b1000000-0000-4000-8000-000000000001','Apple QA'),
 ('b1000000-0000-4000-8000-000000000002','Other QA'),
 ('b1000000-0000-4000-8000-000000000003','Unready Apple QA');
insert into public.account_policy_acceptances(user_id,terms_version,privacy_version,marketplace_rules_version,age_policy_version,age_confirmed_18)
select u.id,v.terms_version,v.privacy_version,v.marketplace_rules_version,v.age_policy_version,true
from auth.users u cross join public.account_policy_versions v
where u.id in ('b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claims','{"role":"service_role"}',false);

do $$ declare r jsonb; ep record;
begin
  r:=public.record_verified_subscription('APPLE','b1000000-0000-4000-8000-000000000001',
    'gnome.pro.monthly','apple-original-1','apple-transaction-1','active','SANDBOX',
    now(),now()+interval '1 month',false,now()+interval '1 month','apple-event-1','CLIENT_SYNC','hash-1');
  if r is null or r->>'outcome'<>'PROCESSED' then raise exception 'initial Apple event not processed: %',r; end if;
  select * into ep from public.market_effective_plan((select id from public.markets where owner_id='b1000000-0000-4000-8000-000000000001' order by created_at limit 1));
  if ep.plan<>'grower' or ep.source<>'APPLE' then raise exception 'Apple Pro not effective: %',to_jsonb(ep); end if;

  r:=public.record_verified_subscription('APPLE','b1000000-0000-4000-8000-000000000001',
    'gnome.pro.monthly','apple-original-1','apple-transaction-1','active','SANDBOX',
    now(),now()+interval '1 month',false,now()+interval '1 month','apple-event-1','CLIENT_SYNC','hash-1');
  if r->>'outcome'<>'DUPLICATE' then raise exception 'event replay was not idempotent: %',r; end if;
  if (select count(*) from public.market_subscriptions where billing_source='APPLE')<>1 then raise exception 'replay duplicated subscription'; end if;
end $$;

-- Regression: provider verification is independent of the customer's policy
-- acceptance state, while user-authored Market updates remain readiness-gated.
do $$ declare r jsonb; v_market uuid; v_plan public.market_plan;
begin
  select id into v_market
    from public.markets
   where owner_id = 'b1000000-0000-4000-8000-000000000003'
   order by created_at
   limit 1;

  if public.account_is_ready('b1000000-0000-4000-8000-000000000003') then
    raise exception 'unready subscription fixture unexpectedly ready';
  end if;

  r := public.record_verified_subscription(
    'APPLE','b1000000-0000-4000-8000-000000000003',
    'gnome.farm.monthly','apple-unready-original','apple-unready-transaction',
    'active','SANDBOX',now(),now()+interval '1 month',false,
    now()+interval '1 month','apple-unready-event','CLIENT_SYNC','hash-unready');

  select plan into v_plan from public.markets where id = v_market;
  if r->>'outcome' <> 'PROCESSED' or v_plan <> 'farm' then
    raise exception 'verified subscription did not reconcile for unready account: %, %', r, v_plan;
  end if;
end $$;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b1000000-0000-4000-8000-000000000003"}',false);
do $$ begin
  begin
    update public.markets
       set plan = 'free'
     where owner_id = 'b1000000-0000-4000-8000-000000000003';
    raise exception 'unready user Market update unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%ACCOUNT_NOT_READY:market:%' then raise; end if;
  end;

  if (select plan from public.markets where owner_id = 'b1000000-0000-4000-8000-000000000003') <> 'farm' then
    raise exception 'failed user update changed reconciled plan';
  end if;
end $$;
select set_config('request.jwt.claims','{"role":"service_role"}',false);

select public.record_verified_subscription('GOOGLE_PLAY','b1000000-0000-4000-8000-000000000002',
 'gnome.pro.monthly','google-pending-token','google-pending-order','pending','SANDBOX',now(),null,false,
 null,'google-pending-event','CLIENT_SYNC','hash-google-pending','raw-google-pending-token','google-pending-token');
do $$ declare ep record; begin
  select * into ep from public.market_effective_plan((select id from public.markets where owner_id='b1000000-0000-4000-8000-000000000002' order by created_at limit 1));
  if ep.plan<>'free' or ep.source<>'free' then raise exception 'pending purchase granted access: %',to_jsonb(ep); end if;
end $$;

do $$ begin
  begin
    perform public.record_verified_subscription('APPLE','b1000000-0000-4000-8000-000000000002',
      'gnome.pro.monthly','apple-original-1','attacker-transaction','active','SANDBOX',now(),now()+interval '1 month',false,
      now()+interval '1 month','apple-attacker-event','CLIENT_SYNC','hash-attacker');
    raise exception 'cross-user claim unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%PURCHASE_ALREADY_CLAIMED%' then raise; end if;
  end;
end $$;

insert into public.admin_plan_grants(market_id,user_id,plan,starts_at,expires_at,status,reason,reason_code,grant_source)
values((select id from public.markets where owner_id='b1000000-0000-4000-8000-000000000001' order by created_at limit 1),'b1000000-0000-4000-8000-000000000001','farm',now()-interval '1 minute',now()+interval '1 day','ACTIVE','QA comp','INTERNAL_QA','ADMIN');
do $$ declare ep record; begin
  select * into ep from public.market_effective_plan((select id from public.markets where owner_id='b1000000-0000-4000-8000-000000000001' order by created_at limit 1));
  if ep.plan<>'farm' or ep.source<>'complimentary' then raise exception 'complimentary Farm did not win: %',to_jsonb(ep); end if;
  update public.admin_plan_grants set expires_at=now()-interval '1 second' where market_id=(select id from public.markets where owner_id='b1000000-0000-4000-8000-000000000001' order by created_at limit 1);
  select * into ep from public.market_effective_plan((select id from public.markets where owner_id='b1000000-0000-4000-8000-000000000001' order by created_at limit 1));
  if ep.plan<>'grower' or ep.source<>'APPLE' then raise exception 'paid Pro did not return after comp expiry: %',to_jsonb(ep); end if;
end $$;

select public.record_verified_subscription('GOOGLE_PLAY','b1000000-0000-4000-8000-000000000001',
 'gnome.farm.monthly','google-token-hash','google-order-1','active','SANDBOX',now(),now()+interval '1 month',false,
 now()+interval '1 month','google-event-1','CLIENT_SYNC','hash-google','raw-google-token','google-token-hash');

do $$ declare ep record; begin
  select * into ep from public.market_effective_plan((select id from public.markets where owner_id='b1000000-0000-4000-8000-000000000001' order by created_at limit 1));
  if ep.plan<>'farm' or ep.source<>'GOOGLE_PLAY' then raise exception 'highest paid provider did not win: %',to_jsonb(ep); end if;
end $$;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b1000000-0000-4000-8000-000000000001"}',false);
do $$ declare summary jsonb; begin
  summary:=public.my_subscription_summary();
  if (summary->>'duplicate_paid_sources')::boolean is not true then raise exception 'duplicate provider warning missing: %',summary; end if;
end $$;

do $$ begin
  begin
    perform public.record_verified_subscription('APPLE','b1000000-0000-4000-8000-000000000001',
      'gnome.pro.monthly','forged','forged','active','SANDBOX',now(),now()+interval '1 month',false,
      now()+interval '1 month','forged','CLIENT_SYNC','forged');
    raise exception 'authenticated client called service mutation';
  exception when others then
    if sqlerrm not like '%SERVICE_ROLE_REQUIRED%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claims','{"role":"service_role"}',false);
select public.record_verified_subscription('GOOGLE_PLAY','b1000000-0000-4000-8000-000000000001',
 'gnome.farm.monthly','google-token-hash','google-order-2','expired','SANDBOX',now()-interval '1 month',now()-interval '1 second',true,
 now()-interval '1 second','google-event-2','RTDN:EXPIRED','hash-google-2','raw-google-token','google-token-hash');

select public.record_verified_subscription('APPLE','b1000000-0000-4000-8000-000000000001',
 'gnome.pro.monthly','apple-original-1','apple-transaction-2','canceled','SANDBOX',now(),now()+interval '1 month',true,
 now()+interval '1 month','apple-event-2','DID_CHANGE_RENEWAL_STATUS','hash-2');
do $$ declare ep record; begin
  select * into ep from public.market_effective_plan((select id from public.markets where owner_id='b1000000-0000-4000-8000-000000000001' order by created_at limit 1));
  if ep.plan<>'grower' then raise exception 'canceled-through-period subscription lost access early'; end if;
end $$;

select public.record_verified_subscription('APPLE','b1000000-0000-4000-8000-000000000001',
 'gnome.pro.monthly','apple-original-1','apple-transaction-3','expired','SANDBOX',now()-interval '1 month',now()-interval '1 second',true,
 now()-interval '1 second','apple-event-3','EXPIRED','hash-3');
do $$ declare ep record; begin
  select * into ep from public.market_effective_plan((select id from public.markets where owner_id='b1000000-0000-4000-8000-000000000001' order by created_at limit 1));
  if ep.plan<>'free' or ep.source<>'free' then raise exception 'expired provider history did not fall to Free: %',to_jsonb(ep); end if;
end $$;

do $$ begin
  begin
    perform public.record_verified_subscription('APPLE','b1000000-0000-4000-8000-000000000001',
      'gnome.pro.monthly','apple-live','apple-live-tx','active','PRODUCTION',now(),now()+interval '1 month',false,
      now()+interval '1 month','apple-live-event','CLIENT_SYNC','hash-live');
    raise exception 'production transaction bypassed live gate';
  exception when others then
    if sqlerrm not like '%LIVE_PAYMENTS_DISABLED%' then raise; end if;
  end;
end $$;

do $$ begin
  if has_table_privilege('authenticated','public.subscription_provider_secrets','select') then raise exception 'provider secrets readable'; end if;
  if has_table_privilege('authenticated','public.subscription_provider_events','select') then raise exception 'provider events readable'; end if;
  if not (select relrowsecurity from pg_class where oid='public.subscription_provider_secrets'::regclass) then raise exception 'provider secret RLS disabled'; end if;
  if (select payments_live_enabled from public.billing_config where id) then raise exception 'payments live changed'; end if;
end $$;

\echo 'Unified subscription contract suite: PASS'
