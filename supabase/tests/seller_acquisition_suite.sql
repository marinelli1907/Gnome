\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_true(label text, value boolean)
returns void language plpgsql as $$ begin
  if value is not true then raise exception 'FAIL: %',label; end if;
  raise notice 'PASS: %',label;
end $$;
create or replace function pg_temp.expect_error(label text, statement text, needle text)
returns void language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if position(needle in sqlerrm)>0 then raise notice 'PASS: % -> %',label,needle; return; end if;
    raise exception 'FAIL: % expected %, got %',label,needle,sqlerrm;
  end;
  raise exception 'FAIL: % expected error %',label,needle;
end $$;

insert into auth.users(id,email,email_confirmed_at) values
  ('a1000000-0000-0000-0000-000000000001','owner@test.invalid',now()),
  ('a1000000-0000-0000-0000-000000000002','seller@test.invalid',now()),
  ('a1000000-0000-0000-0000-000000000003','wrong@test.invalid',now()),
  ('a1000000-0000-0000-0000-000000000004','operator@test.invalid',now()),
  ('a1000000-0000-0000-0000-000000000005','promo2@test.invalid',now()),
  ('a1000000-0000-0000-0000-000000000009','otp@test.invalid',now()),
  ('a1000000-0000-0000-0000-000000000010','oauth@test.invalid',now());
insert into auth.identities(provider_id,user_id,identity_data,provider)
select id::text,id,jsonb_build_object(
  'sub',id::text,'email',email,
  'email_verified',case when email in ('seller@test.invalid','otp@test.invalid') then false else true end
),'email'
from auth.users where email like '%@test.invalid';
insert into auth.identities(provider_id,user_id,identity_data,provider)
values(
  'google-oauth-fixture',
  'a1000000-0000-0000-0000-000000000010',
  '{"sub":"google-oauth-fixture","email":"oauth@test.invalid","email_verified":true}'::jsonb,
  'google'
);
insert into public.profiles(id,name) values
  ('a1000000-0000-0000-0000-000000000001','Owner Fixture'),
  ('a1000000-0000-0000-0000-000000000002','Seller Fixture'),
  ('a1000000-0000-0000-0000-000000000003','Wrong Seller'),
  ('a1000000-0000-0000-0000-000000000004','Operator Fixture'),
  ('a1000000-0000-0000-0000-000000000005','Second Promo User'),
  ('a1000000-0000-0000-0000-000000000009','OTP Fixture'),
  ('a1000000-0000-0000-0000-000000000010','OAuth Fixture')
on conflict(id) do nothing;
select pg_temp.assert_true('new account Market shells are private before readiness or claim',
  (select status='paused' from public.markets where owner_id='a1000000-0000-0000-0000-000000000002')
  and not exists(select 1 from public.public_markets where id=(select id from public.markets where owner_id='a1000000-0000-0000-0000-000000000002')));
insert into public.account_policy_acceptances(user_id,terms_version,privacy_version,marketplace_rules_version,age_policy_version,age_confirmed_18)
select u.id,v.terms_version,v.privacy_version,v.marketplace_rules_version,v.age_policy_version,true
from auth.users u cross join public.account_policy_versions v
where u.email like '%@test.invalid' and v.id;
insert into public.admin_users(user_id,status,role,extra_permissions) values
  ('a1000000-0000-0000-0000-000000000001','active','OWNER','{}'),
  ('a1000000-0000-0000-0000-000000000004','active','OPERATIONS_ADMIN',array['subscriptions.grant_complimentary'])
on conflict(user_id) do update set status=excluded.status,role=excluded.role,extra_permissions=excluded.extra_permissions;

select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000009","role":"authenticated","email":"otp@test.invalid","amr":[{"method":"password"}]}',false);
select pg_temp.expect_error('password session cannot mint mailbox proof',
  $$select public.record_my_verified_email_otp()$$,'EMAIL_OTP_SESSION_REQUIRED');
select pg_temp.assert_true('rejected password session leaves no mailbox proof',
  not exists(select 1 from public.account_email_verification_proofs where user_id='a1000000-0000-0000-0000-000000000009'));

select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000009","role":"authenticated","email":"otp@test.invalid","amr":[{"method":"otp"}]}',false);
select public.record_my_verified_email_otp();
select pg_temp.assert_true('email OTP session creates private mailbox proof and readiness',
  exists(select 1 from public.account_email_verification_proofs
    where user_id='a1000000-0000-0000-0000-000000000009'
      and verified_email='otp@test.invalid' and verification_method='EMAIL_OTP')
  and (select email_verified from public.account_readiness_for_user('a1000000-0000-0000-0000-000000000009')));

select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000010","role":"authenticated","email":"oauth@test.invalid","amr":[{"method":"oauth"}]}',false);
select public.record_my_verified_email_provider();
select pg_temp.assert_true('verified Google identity creates private provider proof',
  exists(select 1 from public.account_email_verification_proofs
    where user_id='a1000000-0000-0000-0000-000000000010'
      and verified_email='oauth@test.invalid' and verification_method='AUTH_PROVIDER'));

select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
select public.admin_create_concierge_case('Payton Test Pantry','seller@test.invalid','Payton','{"city":"Columbus","state":"OH"}') as case_id \gset
select pg_temp.assert_true('admin prepares private seller case',exists(
  select 1 from public.seller_concierge_cases where id=:'case_id' and status='PREPARED'));

select public.admin_save_concierge_extraction(
  :'case_id','b1000000-0000-0000-0000-000000000001','FACEBOOK_SCREENSHOT','QA Facebook screenshot',null,
  '{
    "source_type":"marketplace_listing","overall_confidence":"high","missing_information":["Price for Bell Peppers?"],
    "candidates":[
      {"product_name":"Tomatoes","variety":"Roma","category_terms":["tomato"],"proposed_listing_type":"sale","price_cents":500,"unit":"basket","quantity":"4","availability":"Saturday","pickup":"","location_text":"","description":"Roma tomatoes.","seller_notes":"","compliance_attention_required":false,"confidence":{"product":"high","price":"high","unit":"high","quantity":"high"},"evidence":"Roma tomatoes $5 basket"},
      {"product_name":"Bell Peppers","variety":"","category_terms":["pepper"],"proposed_listing_type":"sale","price_cents":null,"unit":"","quantity":"","availability":"","pickup":"","location_text":"","description":"Bell peppers.","seller_notes":"","compliance_attention_required":false,"confidence":{"product":"high","price":"missing","unit":"missing","quantity":"missing"},"evidence":"Bell peppers"},
      {"product_name":"Strawberry Jam","variety":"","category_terms":["jam"],"proposed_listing_type":"sale","price_cents":800,"unit":"jar","quantity":"6","availability":"","pickup":"","location_text":"","description":"Strawberry jam.","seller_notes":"","compliance_attention_required":true,"confidence":{"product":"high","price":"high","unit":"high","quantity":"high"},"evidence":"Jam $8 jar"}
    ]
  }'::jsonb);
select pg_temp.assert_true('extraction preserves ready/missing/compliance distinctions',
  (select count(*)=3 and count(*) filter(where status='READY')=1
    and count(*) filter(where status='NEEDS_INFO')=1
    and count(*) filter(where status='NEEDS_COMPLIANCE')=1
   from public.seller_concierge_drafts where case_id=:'case_id'));
select pg_temp.assert_true('missing price was not fabricated',
  (select candidate->'price_cents'='null'::jsonb from public.seller_concierge_drafts
    where case_id=:'case_id' and candidate->>'product_name'='Bell Peppers'));
select pg_temp.assert_true('prepared seller remains non-public',
  not exists(select 1 from public.listings where owner_id='a1000000-0000-0000-0000-000000000002'));
select pg_temp.assert_true('source attribution and fingerprint are retained',exists(
  select 1 from public.seller_concierge_sources where case_id=:'case_id'
    and source_type='FACEBOOK_SCREENSHOT' and length(content_fingerprint)=64));

select public.admin_prepare_concierge_entitlement(:'case_id','grower',90,'FOUNDING_SELLER',null,
  'QA founding seller before claim',null,'ADMIN') as prepared_access \gset
select pg_temp.assert_true('pre-claim Pro is inactive and bound to case plus email',
  (:'prepared_access'::jsonb->>'outcome')='PREPARED'
  and exists(select 1 from public.seller_concierge_prepared_entitlements
    where id=(:'prepared_access'::jsonb->>'prepared_entitlement_id')::uuid and case_id=:'case_id'
      and invited_email='seller@test.invalid' and invite_id is null and status='APPROVED')
  and not exists(select 1 from public.admin_plan_grants where reason_code='FOUNDING_SELLER'));

select public.admin_prepare_concierge_invite(:'case_id','seller@test.invalid',
  encode(extensions.digest('qa-token-that-is-long-enough-for-secure-claim-0001','sha256'),'hex'),now()+interval '7 days') as invite_id \gset
select pg_temp.assert_true('invite stores hash only and expiration',exists(
  select 1 from public.seller_concierge_invites where case_id=:'case_id'
    and token_hash<> 'qa-token-that-is-long-enough-for-secure-claim-0001' and expires_at>now()));
select pg_temp.assert_true('prepared access binds to the current invitation',exists(
  select 1 from public.seller_concierge_prepared_entitlements
   where id=(:'prepared_access'::jsonb->>'prepared_entitlement_id')::uuid and invite_id=:'invite_id' and status='APPROVED'));

create temp table claim_preview_result on commit drop as
select * from public.concierge_claim_preview('qa-token-that-is-long-enough-for-secure-claim-0001');
select pg_temp.assert_true('claim preview opens invitation and returns minimal draft totals',
  (select business_name='Payton Test Pantry' and status='INVITED' and total_drafts=3
      and ready=1 and needs_info=1 and needs_compliance=1
    from claim_preview_result)
  and (select status='OPENED' and opened_at is not null
    from public.seller_concierge_invites where id=:'invite_id'));

select pg_temp.assert_true('auto-confirmed email alone is not mailbox proof',
  not (select email_verified from public.account_readiness_for_user('a1000000-0000-0000-0000-000000000002')));
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated","amr":[{"method":"otp","timestamp":1787666400}]}',false);
select pg_temp.expect_error('wrong OTP-authenticated mailbox cannot verify invitation',
  $$select public.verify_concierge_email('qa-token-that-is-long-enough-for-secure-claim-0001')$$,'INVITE_EMAIL_MISMATCH');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated","amr":[{"method":"otp","timestamp":1787666400}]}',false);
select public.verify_concierge_email('qa-token-that-is-long-enough-for-secure-claim-0001');
select pg_temp.assert_true('OTP session plus one-time invite creates private server proof',
  exists(select 1 from public.account_email_verification_proofs
    where user_id='a1000000-0000-0000-0000-000000000002'
      and verified_email='seller@test.invalid' and verification_method='CONCIERGE_MAGIC_LINK'
      and concierge_invite_id=:'invite_id')
  and (select email_verified from public.account_readiness_for_user('a1000000-0000-0000-0000-000000000002')));

select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
select public.admin_create_concierge_case('Expired Invite Fixture','expired@test.invalid','Expired','{}') as expired_case_id \gset
select public.admin_prepare_concierge_entitlement(:'expired_case_id','grower',90,'FOUNDING_SELLER',null,
  'QA expired invitation',null,'ADMIN') as expired_prepared_access \gset
select public.admin_prepare_concierge_invite(:'expired_case_id','expired@test.invalid',
  encode(extensions.digest('qa-token-for-expired-invite-entitlement-0001','sha256'),'hex'),now()+interval '7 days');
update public.seller_concierge_cases set status='EXPIRED' where id=:'expired_case_id';
select pg_temp.assert_true('expired invite leaves prepared access inactive and cancellable',
  (select status='APPROVED' and activated_grant_id is null
     from public.seller_concierge_prepared_entitlements
    where id=(:'expired_prepared_access'::jsonb->>'prepared_entitlement_id')::uuid));
select public.admin_cancel_concierge_entitlement(
  (:'expired_prepared_access'::jsonb->>'prepared_entitlement_id')::uuid,'Expired QA invitation');
select pg_temp.assert_true('admin can cancel access after invite expiration',
  (select status='CANCELLED' and activated_grant_id is null
     from public.seller_concierge_prepared_entitlements
    where id=(:'expired_prepared_access'::jsonb->>'prepared_entitlement_id')::uuid));

select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated","amr":[{"method":"otp"}]}',false);
select pg_temp.expect_error('wrong verified account cannot claim',
  $$select public.claim_prepared_market('qa-token-that-is-long-enough-for-secure-claim-0001')$$,'INVITE_EMAIL_MISMATCH');
select pg_temp.assert_true('wrong account cannot activate prepared access',
  (select status='APPROVED' and activated_grant_id is null from public.seller_concierge_prepared_entitlements
    where id=(:'prepared_access'::jsonb->>'prepared_entitlement_id')::uuid));

update public.account_policy_acceptances set terms_version=terms_version||'-stale'
where user_id='a1000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated","amr":[{"method":"otp"}]}',false);
select pg_temp.expect_error('stale policy acceptance blocks claim',
  $$select public.claim_prepared_market('qa-token-that-is-long-enough-for-secure-claim-0001')$$,'ACCOUNT_NOT_READY');
select pg_temp.assert_true('failed readiness cannot activate prepared access',
  (select status='APPROVED' and activated_grant_id is null from public.seller_concierge_prepared_entitlements
    where id=(:'prepared_access'::jsonb->>'prepared_entitlement_id')::uuid));
update public.account_policy_acceptances a set terms_version=v.terms_version
from public.account_policy_versions v where a.user_id='a1000000-0000-0000-0000-000000000002' and v.id;
select public.claim_prepared_market('qa-token-that-is-long-enough-for-secure-claim-0001');
select pg_temp.assert_true('claim creates only private ordinary listing drafts',
  (select count(*)=3 from public.listing_drafts where owner_id='a1000000-0000-0000-0000-000000000002' and status='pending')
  and not exists(select 1 from public.listings where owner_id='a1000000-0000-0000-0000-000000000002')
  and (select status='paused' from public.markets where owner_id='a1000000-0000-0000-0000-000000000002'));
select pg_temp.assert_true('verified claim activates prepared Pro once with claim-started duration',
  (select status='ACTIVATED' and activated_user_id='a1000000-0000-0000-0000-000000000002'
      and activated_grant_id is not null and activated_at between now()-interval '1 minute' and now()
    from public.seller_concierge_prepared_entitlements where id=(:'prepared_access'::jsonb->>'prepared_entitlement_id')::uuid)
  and (select plan='grower' and grant_source='SELLER_CONCIERGE' and reason_code='FOUNDING_SELLER'
      and starts_at between now()-interval '1 minute' and now()
      and expires_at between now()+interval '89 days' and now()+interval '91 days'
    from public.admin_plan_grants where id=(select activated_grant_id from public.seller_concierge_prepared_entitlements
      where id=(:'prepared_access'::jsonb->>'prepared_entitlement_id')::uuid))
  and not exists(select 1 from public.market_subscriptions where market_id=(select claimed_market_id from public.seller_concierge_cases where id=:'case_id')));
select pg_temp.expect_error('claimed invite cannot be reused',
  $$select public.claim_prepared_market('qa-token-that-is-long-enough-for-secure-claim-0001')$$,'INVALID_OR_EXPIRED_INVITE');
select pg_temp.assert_true('re-claim rejection cannot duplicate prepared access',
  (select count(*)=1 from public.admin_plan_grants where grant_source='SELLER_CONCIERGE' and reason_code='FOUNDING_SELLER'));

select pg_temp.expect_error('public stand requires explicit seller consent',format(
  $$select public.confirm_concierge_market('%s','{"location_mode":"PUBLIC_STAND","public_stand_address":"123 QA Road"}',false)$$,:'case_id'),'PUBLIC_STAND_CONSENT_REQUIRED');
select public.confirm_concierge_market(:'case_id','{"name":"Payton Test Pantry","market_model":"BOTH","location_mode":"APPROXIMATE"}',false);
select pg_temp.assert_true('approximate mode does not expose address',
  not exists(select 1 from public.public_market_stand_location((select id from public.markets where owner_id='a1000000-0000-0000-0000-000000000002')))
  and (select status='active' from public.markets where owner_id='a1000000-0000-0000-0000-000000000002')
  and exists(select 1 from public.public_markets where id=(select id from public.markets where owner_id='a1000000-0000-0000-0000-000000000002')));
select public.confirm_concierge_market(:'case_id','{"market_model":"BOTH","location_mode":"PUBLIC_STAND","public_stand_address":"123 QA Road"}',true);
select pg_temp.assert_true('public stand appears only after seller consent',
  (select address='123 QA Road' from public.public_market_stand_location((select id from public.markets where owner_id='a1000000-0000-0000-0000-000000000002'))));

select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
select public.admin_set_suspended('a1000000-0000-0000-0000-000000000002',true);
select pg_temp.assert_true('suspension hides Market, profile, and public stand location',
  not exists(select 1 from public.public_markets where id=(select id from public.markets where owner_id='a1000000-0000-0000-0000-000000000002'))
  and not exists(select 1 from public.public_profiles where id='a1000000-0000-0000-0000-000000000002')
  and not exists(select 1 from public.public_market_stand_location((select id from public.markets where owner_id='a1000000-0000-0000-0000-000000000002'))));
select public.admin_set_suspended('a1000000-0000-0000-0000-000000000002',false);
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}',false);

select id as draft_id from public.listing_drafts where owner_id='a1000000-0000-0000-0000-000000000002' order by import_candidate_index limit 1 \gset
update public.listing_drafts set title='Seller edited tomatoes' where id=:'draft_id';
select public.discard_listing_draft(:'draft_id');
select pg_temp.assert_true('seller edit and rejection are attributed and audited',
  (select field_origins ? 'seller_edited_at' and status='discarded' from public.listing_drafts where id=:'draft_id')
  and exists(select 1 from public.seller_concierge_drafts where case_id=:'case_id' and status='REJECTED' and seller_rejected_at is not null));

select public.set_market_assistance('OFF','{}');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
select pg_temp.expect_error('Off blocks ordinary assisted management',format(
  $$select public.admin_prepare_market_assistance_action('%s','EDIT_MARKET_DESCRIPTION','{"description":"No"}','QA','boon')$$,
  (select id from public.markets where owner_id='a1000000-0000-0000-0000-000000000002')),'SELLER_ASSISTANCE_NOT_AUTHORIZED');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}',false);
select public.set_market_assistance('SUPPORT','{}');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
select public.admin_prepare_market_assistance_action(
  (select id from public.markets where owner_id='a1000000-0000-0000-0000-000000000002'),
  'EDIT_MARKET_DESCRIPTION','{"description":"Seller approved support"}','QA support','boon') as support_action \gset
select pg_temp.expect_error('Support proposal needs seller approval',format(
  $$select public.admin_execute_market_assistance_action('%s')$$,:'support_action'),'ACTION_NOT_APPROVED');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}',false);
select public.seller_review_market_assistance_action(:'support_action',true);
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
select public.admin_execute_market_assistance_action(:'support_action');
select pg_temp.assert_true('seller-approved Support action executes with audit',
  (select description='Seller approved support' from public.markets where owner_id='a1000000-0000-0000-0000-000000000002')
  and exists(select 1 from public.admin_audit_log where resource_id=:'support_action'));
select public.admin_prepare_market_assistance_action(
  (select id from public.markets where owner_id='a1000000-0000-0000-0000-000000000002'),
  'UPDATE_HOURS','{"weekday":9,"start_minute":900,"end_minute":800}','QA invalid execution','boon') as failed_action \gset
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}',false);
select public.seller_review_market_assistance_action(:'failed_action',true);
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
select public.admin_execute_market_assistance_action(:'failed_action');
select pg_temp.assert_true('failed approved action remains durably failed and audited',
  (select status='FAILED' and execution_result->>'executed'='false' from public.market_assistance_actions where id=:'failed_action')
  and exists(select 1 from public.admin_audit_log where action='MARKET_ASSISTANCE_FAILED' and resource_id=:'failed_action'));
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}',false);
select public.set_market_assistance('MANAGED',array['EDIT_MARKET_DESCRIPTION']);
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
select public.admin_prepare_market_assistance_action(
  (select id from public.markets where owner_id='a1000000-0000-0000-0000-000000000002'),
  'EDIT_MARKET_DESCRIPTION','{"description":"Must not execute"}','QA revoke','boon') as managed_action \gset
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}',false);
select public.set_market_assistance('OFF','{}');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
select pg_temp.expect_error('revocation stops a previously approved Managed action',format(
  $$select public.admin_execute_market_assistance_action('%s')$$,:'managed_action'),'ASSISTANCE_REVOKED');

select public.admin_revoke_grant_v2(
  (select activated_grant_id from public.seller_concierge_prepared_entitlements
    where id=(:'prepared_access'::jsonb->>'prepared_entitlement_id')::uuid),
  'QA reset after pre-claim activation proof');
select id as seller_market from public.markets where owner_id='a1000000-0000-0000-0000-000000000002' limit 1 \gset
select pg_temp.expect_error('complimentary reason is mandatory',format(
  $$select public.admin_grant_plan_v2('%s','grower',now()+interval '30 days','',null,null,null,'ADMIN','CANCEL_NEW')$$,:'seller_market'),'INVALID_REASON');
select public.admin_grant_plan_v2(:'seller_market','grower',now()+interval '30 days','FOUNDING_SELLER',null,'QA founding seller',null,'ADMIN','CANCEL_NEW') as pro_grant \gset
select pg_temp.assert_true('complimentary Pro is separate from paid billing',
  (:'pro_grant'::jsonb->>'outcome')='GRANTED'
  and not exists(select 1 from public.market_subscriptions where market_id=:'seller_market'));
select public.admin_grant_plan_v2(:'seller_market','grower',now()+interval '90 days','FOUNDING_SELLER',null,null,null,'ADMIN','CANCEL_NEW') as overlap \gset
select pg_temp.assert_true('overlap requires an explicit decision',(:'overlap'::jsonb->>'outcome')='OVERLAP');
select public.admin_revoke_grant_v2((:'pro_grant'::jsonb->>'grant_id')::uuid,'QA revoke');
update public.markets set plan='grower' where id=:'seller_market';
select public.admin_grant_plan_v2(:'seller_market','farm',now()+interval '90 days','PARTNER',null,'QA paid plus comp',null,'ADMIN','CANCEL_NEW') as farm_grant \gset
select pg_temp.assert_true('paid Pro plus complimentary Farm resolves to Farm',
  (select plan='farm' and source='complimentary' from public.market_effective_plan(:'seller_market')));
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000004","role":"authenticated"}',false);
select pg_temp.expect_error('non-owner cannot grant complimentary Farm',format(
  $$select public.admin_grant_plan_v2('%s','farm',now()+interval '30 days','INTERNAL_QA',null,null,null,'ADMIN','REPLACE_CURRENT')$$,:'seller_market'),'FARM_OWNER_ONLY');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
select public.admin_revoke_grant_v2((:'farm_grant'::jsonb->>'grant_id')::uuid,'QA fallback');
select pg_temp.assert_true('revocation preserves history and falls back to paid Pro',
  (select plan='grower' and source='stripe' from public.market_effective_plan(:'seller_market'))
  and exists(select 1 from public.admin_plan_grants where id=(:'farm_grant'::jsonb->>'grant_id')::uuid and status='REVOKED' and revoke_reason='QA fallback'));

select public.admin_create_concierge_case('Boon Prospect','promo2@test.invalid','Boon QA','{}') as boon_case \gset
select set_config('request.jwt.claims','{}',false);
select public.ai_file_action_request('boon','grant_comp_plan',jsonb_build_object(
  'case_id',:'boon_case','plan','grower','days',90,'reason_code','FOUNDING_SELLER'),
  'Give Boon Prospect 90 days of complimentary Pro','Founding seller QA') as boon_request \gset
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
select public.admin_review_ai_action(:'boon_request',true,'Approved QA proposal');
update public.ai_settings set writes_paused=false;
select public.admin_execute_ai_action(:'boon_request');
select pg_temp.assert_true('Boon approval prepares case-bound access without activating it',
  exists(select 1 from public.seller_concierge_prepared_entitlements
    where case_id=:'boon_case' and status='APPROVED' and source='BOON'
      and approval_reference=:'boon_request' and activated_grant_id is null)
  and not exists(select 1 from public.admin_plan_grants where approval_reference=:'boon_request'));

select public.admin_upsert_promo_campaign('{
  "code":"QACAP1","campaign_name":"QA cap","active":true,"applicable_plans":["grower"],
  "discount_type":"percent","discount_percent":100,"discount_amount_cents":null,
  "duration":"repeating","duration_in_months":3,"starts_at":null,"expires_at":null,
  "max_redemptions":1,"max_redemptions_per_user":1,"new_customers_only":false,"internal_notes":"QA"
}'::jsonb) as promo_id \gset
update public.promotion_campaigns set stripe_promotion_code_id='promo_test_qa' where id=:'promo_id';
select set_config('request.jwt.claims','{}',false);
select pg_temp.assert_true('valid promo is server-authoritative and plan-bound',
  (select ok and reason='OK' from public.promo_validate(' qacap1 ','grower','a1000000-0000-0000-0000-000000000002'))
  and (select not ok and reason='WRONG_PLAN' from public.promo_validate('QACAP1','farm','a1000000-0000-0000-0000-000000000002'))
  and (select not ok and reason='INVALID_CODE' from public.promo_validate('FORGED','grower','a1000000-0000-0000-0000-000000000002')));
select pg_temp.assert_true('promo and complimentary records stay separate',
  not exists(select 1 from public.admin_plan_grants where reason ilike '%QACAP1%'));
select pg_temp.assert_true('Boon is proposal-only under Zordy',exists(
  select 1 from public.ai_agents where id='boon' and reports_to='gnome_hq'
    and authority_level='PROPOSE' and 'create_owner_approval_request'=any(permissions)));

insert into auth.users(id,email,email_confirmed_at)
values('a1000000-0000-0000-0000-000000000006','qa-delete@test.invalid',now());
insert into auth.identities(provider_id,user_id,identity_data,provider)
values('a1000000-0000-0000-0000-000000000006','a1000000-0000-0000-0000-000000000006',
  '{"sub":"a1000000-0000-0000-0000-000000000006","email":"qa-delete@test.invalid","email_verified":true}','email');
insert into public.profiles(id,name)
values('a1000000-0000-0000-0000-000000000006','Disposable QA') on conflict(id) do nothing;
select id as qa_delete_market from public.markets
where owner_id='a1000000-0000-0000-0000-000000000006' \gset
insert into public.seller_concierge_cases(
  id,business_name,seller_name,invited_email,status,prepared_by,claimed_by,claimed_market_id,
  invited_at,invite_opened_at,claimed_at,account_ready_at
) values(
  'c1000000-0000-0000-0000-000000000006','Disposable QA Market','QA Seller','qa-delete@test.invalid',
  'CLAIMED','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000006',
  :'qa_delete_market',now(),now(),now(),now()
);
insert into public.seller_concierge_invites(
  id,case_id,email,token_hash,status,sent_by,opened_at,claimed_at,expires_at
) values(
  'd1000000-0000-0000-0000-000000000006','c1000000-0000-0000-0000-000000000006',
  'qa-delete@test.invalid',encode(extensions.digest('qa-claimed-token-that-remains-single-use-0000001','sha256'),'hex'),
  'CLAIMED','a1000000-0000-0000-0000-000000000001',now(),now(),now()+interval '7 days'
);
insert into public.seller_concierge_drafts(
  case_id,candidate_index,candidate,status,source_attribution,field_origins,missing_information,compliance_attention
) values(
  'c1000000-0000-0000-0000-000000000006',0,'{"product_name":"QA Tomatoes","price_cents":400}',
  'CLAIMED','Disposable QA fixture','{}','{}',false
);
insert into public.listing_drafts(
  owner_id,market_id,source,status,title,concierge_case_id,source_attribution,field_origins
) values(
  'a1000000-0000-0000-0000-000000000006',:'qa_delete_market','market_import','pending',
  'QA Tomatoes','c1000000-0000-0000-0000-000000000006','Disposable QA fixture','{}'
);

create temp table claimed_link_result on commit drop as
select * from public.concierge_claim_preview('qa-claimed-token-that-remains-single-use-0000001');
select pg_temp.assert_true('consumed invitation resolves to stable non-actionable claimed state',
  (select status='CLAIMED' and business_name='Disposable QA Market' and total_drafts=1 from claimed_link_result));
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000004","role":"authenticated"}',false);
select pg_temp.expect_error('QA tombstone is owner-only',
  $$select public.admin_tombstone_concierge_qa_case('c1000000-0000-0000-0000-000000000006','QA cleanup')$$,
  'OWNER_ONLY');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
select public.admin_tombstone_concierge_qa_case(
  'c1000000-0000-0000-0000-000000000006','Disposable Seller Concierge regression') as qa_tombstone \gset
select pg_temp.assert_true('QA tombstone preserves history while releasing live identity links',
  (:'qa_tombstone'::jsonb->>'outcome')='QA_TOMBSTONED'
  and (select is_qa and qa_tombstoned_at is not null and status='EXPIRED'
      and claimed_by is null and claimed_market_id is null
      and historical_claimed_user_id='a1000000-0000-0000-0000-000000000006'
      and historical_claimed_market_id=:'qa_delete_market'::uuid
      and nullif(historical_market_name,'') is not null
      and invited_email is null and seller_name is null
    from public.seller_concierge_cases where id='c1000000-0000-0000-0000-000000000006')
  and not exists(select 1 from public.listing_drafts where concierge_case_id='c1000000-0000-0000-0000-000000000006')
  and (select suspended from public.profiles where id='a1000000-0000-0000-0000-000000000006')
  and not exists(select 1 from public.public_markets where id=:'qa_delete_market'));
select pg_temp.assert_true('QA tombstone revokes old token and scrubs invitation PII',
  not exists(select 1 from public.concierge_claim_preview('qa-claimed-token-that-remains-single-use-0000001'))
  and exists(select 1 from public.seller_concierge_invites
    where case_id='c1000000-0000-0000-0000-000000000006'
      and email like 'qa-tombstone-%@invalid.example'
      and token_hash<>encode(extensions.digest('qa-claimed-token-that-remains-single-use-0000001','sha256'),'hex')));
select pg_temp.assert_true('QA case is excluded from funnel but remains explicitly visible to operations',
  ((public.admin_seller_concierge_funnel()->>'prepared')::int =
    (select count(*) from public.seller_concierge_cases where not is_qa))
  and exists(select 1 from public.admin_concierge_cases()
    where id='c1000000-0000-0000-0000-000000000006' and is_qa)
  and exists(select 1 from public.admin_audit_log
    where action='CONCIERGE_QA_TOMBSTONED' and resource_id='c1000000-0000-0000-0000-000000000006'));
delete from public.markets where id=:'qa_delete_market';
delete from public.profiles where id='a1000000-0000-0000-0000-000000000006';
delete from auth.users where id='a1000000-0000-0000-0000-000000000006';
select pg_temp.assert_true('disposable identity and Market delete without destroying QA audit',
  not exists(select 1 from public.profiles where id='a1000000-0000-0000-0000-000000000006')
  and not exists(select 1 from public.markets where id=:'qa_delete_market')
  and exists(select 1 from public.seller_concierge_cases
    where id='c1000000-0000-0000-0000-000000000006' and is_qa and historical_claimed_user_id is not null));
select pg_temp.assert_true('payments remain disabled',(select payments_live_enabled=false from public.billing_config where id));

commit;
