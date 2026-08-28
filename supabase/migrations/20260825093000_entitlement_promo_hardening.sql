-- Complimentary entitlement governance + promo reservation/preflight support.
-- Complimentary access remains independent from Stripe. Nothing here creates,
-- cancels, or changes a paid subscription, and the live-payment gate is asserted
-- false at the end of the migration.

-- ---------------------------------------------------------------------------
-- 1. Structured complimentary grant history
-- ---------------------------------------------------------------------------
alter table public.admin_plan_grants
  add column if not exists reason_code text,
  add column if not exists reason_explanation text,
  add column if not exists approval_reference text,
  add column if not exists grant_source text,
  add column if not exists old_effective_plan public.market_plan,
  add column if not exists old_effective_source text,
  add column if not exists execution_result jsonb,
  add column if not exists revoke_reason text;

update public.admin_plan_grants set
  reason_code=coalesce(reason_code,'OTHER'),
  reason_explanation=coalesce(reason_explanation,reason),
  grant_source=coalesce(grant_source,'LEGACY_ADMIN'),
  execution_result=coalesce(execution_result,jsonb_build_object('migrated',true))
where reason_code is null or grant_source is null or execution_result is null;

alter table public.admin_plan_grants alter column reason_code set not null;
alter table public.admin_plan_grants alter column grant_source set not null;
do $$ begin
  alter table public.admin_plan_grants add constraint plan_grants_reason_code_chk check (reason_code in (
    'FOUNDING_SELLER','SUPPORT_RESOLUTION','INTERNAL_QA','PARTNER','PROMOTION',
    'INFLUENCER_CREATOR','COMMUNITY_PARTNER','OTHER'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.admin_plan_grants add constraint plan_grants_reason_explanation_chk check (
    reason_code<>'OTHER' or nullif(btrim(reason_explanation),'') is not null);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.admin_plan_grants add constraint plan_grants_source_chk check (grant_source in (
    'ADMIN','BOON','ZORDY','SELLER_CONCIERGE','SUPPORT','LEGACY_ADMIN'));
exception when duplicate_object then null; end $$;

create or replace function public.admin_grant_plan_v2(
  p_market uuid,p_plan public.market_plan,p_expires timestamptz,p_reason_code text,
  p_reason_explanation text default null,p_note text default null,
  p_approval_reference text default null,p_source text default 'ADMIN',
  p_overlap_action text default 'CANCEL_NEW'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_owner uuid; old_ep record; new_ep record; existing public.admin_plan_grants;
  v_id uuid; v_reason text; v_old jsonb; v_new jsonb;
begin
  if not public.admin_has_perm('subscriptions.grant_complimentary') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_plan not in ('grower','farm') then raise exception 'INVALID_COMPLIMENTARY_PLAN'; end if;
  if p_plan='farm' and not public.admin_is_owner() then raise exception 'FARM_OWNER_ONLY'; end if;
  if p_reason_code not in ('FOUNDING_SELLER','SUPPORT_RESOLUTION','INTERNAL_QA','PARTNER','PROMOTION','INFLUENCER_CREATOR','COMMUNITY_PARTNER','OTHER') then raise exception 'INVALID_REASON'; end if;
  if p_reason_code='OTHER' and nullif(btrim(coalesce(p_reason_explanation,'')),'') is null then raise exception 'OTHER_EXPLANATION_REQUIRED'; end if;
  if p_source not in ('ADMIN','BOON','ZORDY','SELLER_CONCIERGE','SUPPORT') then raise exception 'INVALID_SOURCE'; end if;
  if p_overlap_action not in ('CANCEL_NEW','EXTEND_CURRENT','REPLACE_CURRENT') then raise exception 'INVALID_OVERLAP_ACTION'; end if;
  if p_expires is not null and p_expires<=now() then raise exception 'EXPIRATION_MUST_BE_FUTURE'; end if;
  select owner_id into v_owner from public.markets where id=p_market for update;
  if v_owner is null then raise exception 'MARKET_NOT_FOUND'; end if;
  select * into old_ep from public.market_effective_plan(p_market);
  select * into existing from public.admin_plan_grants where market_id=p_market and status='ACTIVE'
    and starts_at<=now() and (expires_at is null or expires_at>now()) order by public.plan_rank(plan) desc,created_at desc limit 1 for update;

  if existing.id is not null and p_overlap_action='CANCEL_NEW' then
    return jsonb_build_object('outcome','OVERLAP','existing_grant_id',existing.id,
      'existing_plan',existing.plan,'existing_expires_at',existing.expires_at,
      'choices',jsonb_build_array('EXTEND_CURRENT','REPLACE_CURRENT','CANCEL_NEW'));
  end if;

  v_reason:=replace(initcap(lower(p_reason_code)),'_',' ');
  if existing.id is not null and p_overlap_action='EXTEND_CURRENT' then
    if existing.plan<>p_plan then raise exception 'EXTEND_REQUIRES_SAME_PLAN'; end if;
    if existing.expires_at is null then raise exception 'NO_EXPIRATION_CANNOT_BE_EXTENDED'; end if;
    if p_expires is null or p_expires<=existing.expires_at then raise exception 'EXTENSION_MUST_MOVE_EXPIRATION_FORWARD'; end if;
    v_old:=to_jsonb(existing);
    update public.admin_plan_grants set expires_at=p_expires,reason_code=p_reason_code,
      reason=v_reason,reason_explanation=nullif(btrim(coalesce(p_reason_explanation,'')),''),
      internal_note=coalesce(nullif(btrim(coalesce(p_note,'')),''),internal_note),
      approval_reference=nullif(btrim(coalesce(p_approval_reference,'')),''),grant_source=p_source,
      modified_by=auth.uid(),modified_at=now(),execution_result=jsonb_build_object('outcome','EXTENDED')
    where id=existing.id returning id into v_id;
    perform public.admin_audit('COMP_EXTENDED','plan_grant',v_id::text,v_old,
      jsonb_build_object('plan',p_plan,'expires_at',p_expires,'reason_code',p_reason_code,'source',p_source),v_reason);
    return jsonb_build_object('outcome','EXTENDED','grant_id',v_id,'plan',p_plan,'expires_at',p_expires,'stripe_changed',false);
  end if;

  if existing.id is not null and p_overlap_action='REPLACE_CURRENT' then
    update public.admin_plan_grants set status='REVOKED',revoked_by=auth.uid(),revoked_at=now(),
      revoke_reason='Replaced by a new approved complimentary grant',modified_by=auth.uid(),modified_at=now()
    where market_id=p_market and status='ACTIVE' and starts_at<=now() and (expires_at is null or expires_at>now());
  end if;

  insert into public.admin_plan_grants(market_id,user_id,plan,expires_at,reason,reason_code,
    reason_explanation,internal_note,granted_by,approval_reference,grant_source,
    old_effective_plan,old_effective_source,execution_result)
  values(p_market,v_owner,p_plan,p_expires,v_reason,p_reason_code,
    nullif(btrim(coalesce(p_reason_explanation,'')),''),nullif(btrim(coalesce(p_note,'')),''),auth.uid(),
    nullif(btrim(coalesce(p_approval_reference,'')),''),p_source,old_ep.plan,old_ep.source,
    jsonb_build_object('outcome',case when existing.id is null then 'GRANTED' else 'REPLACED' end,'stripe_changed',false))
  returning id into v_id;
  select * into new_ep from public.market_effective_plan(p_market);
  perform public.reconcile_pickup_locations(p_market);
  perform public.admin_audit('COMP_GRANTED','market',p_market::text,
    jsonb_build_object('effective_plan',old_ep.plan,'source',old_ep.source,'paid_base_plan',(select plan from public.markets where id=p_market)),
    jsonb_build_object('effective_plan',new_ep.plan,'source',new_ep.source,'grant_id',v_id,'plan',p_plan,
      'expires_at',p_expires,'reason_code',p_reason_code,'approval_reference',p_approval_reference,'grant_source',p_source,'stripe_changed',false),
    v_reason);
  return jsonb_build_object('outcome',case when existing.id is null then 'GRANTED' else 'REPLACED' end,
    'grant_id',v_id,'old_effective_plan',old_ep.plan,'new_effective_plan',new_ep.plan,
    'paid_base_plan',(select plan from public.markets where id=p_market),'expires_at',p_expires,'stripe_changed',false);
end $$;

-- Compatibility entry point: now structured, Farm-owner guarded, and refuses
-- silent overlap. Existing callers continue to work without regaining the old
-- ambiguous behavior.
create or replace function public.admin_grant_plan(
  p_market uuid,p_plan public.market_plan,p_expires timestamptz,p_reason text,p_note text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare r jsonb;
begin
  r:=public.admin_grant_plan_v2(p_market,p_plan,p_expires,'OTHER',p_reason,p_note,null,'ADMIN','CANCEL_NEW');
  if r->>'outcome'='OVERLAP' then raise exception 'OVERLAP_REQUIRES_DECISION' using hint=r::text; end if;
  return (r->>'grant_id')::uuid;
end $$;

create or replace function public.admin_revoke_grant_v2(p_grant uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare g public.admin_plan_grants; old_ep record; new_ep record;
begin
  if not public.admin_has_perm('subscriptions.revoke_complimentary') then raise exception 'NOT_AUTHORIZED'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'REVOKE_REASON_REQUIRED'; end if;
  select * into g from public.admin_plan_grants where id=p_grant for update;
  if g is null then raise exception 'GRANT_NOT_FOUND'; end if;
  if g.plan='farm' and not public.admin_is_owner() then raise exception 'FARM_OWNER_ONLY'; end if;
  if g.status='REVOKED' then return jsonb_build_object('outcome','ALREADY_REVOKED','grant_id',g.id); end if;
  select * into old_ep from public.market_effective_plan(g.market_id);
  update public.admin_plan_grants set status='REVOKED',revoked_by=auth.uid(),revoked_at=now(),
    revoke_reason=btrim(p_reason),execution_result=coalesce(execution_result,'{}')||jsonb_build_object('revoke_outcome','REVOKED') where id=p_grant;
  select * into new_ep from public.market_effective_plan(g.market_id);
  perform public.reconcile_pickup_locations(g.market_id);
  perform public.admin_audit('COMP_REVOKED','market',g.market_id::text,
    jsonb_build_object('effective_plan',old_ep.plan,'source',old_ep.source,'grant_id',p_grant),
    jsonb_build_object('effective_plan',new_ep.plan,'source',new_ep.source,'stripe_changed',false),btrim(p_reason));
  return jsonb_build_object('outcome','REVOKED','grant_id',p_grant,'before_plan',old_ep.plan,
    'after_plan',new_ep.plan,'after_source',new_ep.source,'stripe_changed',false);
end $$;

create or replace function public.admin_revoke_grant(p_grant uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
begin perform public.admin_revoke_grant_v2(p_grant,p_reason); end $$;

create or replace function public.admin_market_entitlements_v2(p_market uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select case when not public.admin_has_perm('subscriptions.view') then null else
    (select jsonb_build_object(
      'effective',to_jsonb(ep),
      'paid',coalesce((select jsonb_build_object('plan',s.plan,'status',s.status,'provider',s.provider,
          'livemode',s.stripe_livemode,'current_period_end',s.current_period_end)
        from public.market_subscriptions s where s.market_id=m.id and s.kind='plan'
          and s.status in ('active','trialing','past_due') order by s.created_at desc limit 1),
        jsonb_build_object('plan',m.plan,'status',case when m.plan='free' then 'none' else 'unverified_base' end,'provider',null)),
      'complimentary',(select jsonb_build_object('grant_id',g.id,'plan',g.plan,'status',g.status,
          'reason_code',g.reason_code,'reason',g.reason,'reason_explanation',g.reason_explanation,
          'note',g.internal_note,'starts_at',g.starts_at,'expires_at',g.expires_at,
          'source',g.grant_source,'approval_reference',g.approval_reference,
          'granted_by',coalesce(p.name,au.invited_name,'Gnome admin'))
        from public.admin_plan_grants g left join public.profiles p on p.id=g.granted_by
        left join public.admin_users au on au.user_id=g.granted_by
        where g.market_id=m.id and g.status='ACTIVE' and g.starts_at<=now() and (g.expires_at is null or g.expires_at>now())
        order by public.plan_rank(g.plan) desc,g.created_at desc limit 1),
      'history',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'plan',g.plan,'status',g.status,
          'reason_code',g.reason_code,'reason',g.reason,'reason_explanation',g.reason_explanation,'note',g.internal_note,
          'starts_at',g.starts_at,'expires_at',g.expires_at,'created_at',g.created_at,'revoked_at',g.revoked_at,
          'revoke_reason',g.revoke_reason,'source',g.grant_source,'approval_reference',g.approval_reference,
          'old_effective_plan',g.old_effective_plan,'old_effective_source',g.old_effective_source,
          'granted_by',coalesce(p.name,au.invited_name,'Gnome admin')) order by g.created_at desc)
        from public.admin_plan_grants g left join public.profiles p on p.id=g.granted_by
        left join public.admin_users au on au.user_id=g.granted_by where g.market_id=m.id),'[]'::jsonb))
      from public.markets m cross join lateral public.market_effective_plan(m.id) ep where m.id=p_market)
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Pre-claim complimentary access
-- ---------------------------------------------------------------------------
-- This is an inactive promise bound to one private concierge case, its invited
-- email, and (once created) its latest live invitation. It is not an entitlement
-- until the verified invited account successfully claims that exact case.
create table if not exists public.seller_concierge_prepared_entitlements (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.seller_concierge_cases(id) on delete cascade,
  invite_id uuid references public.seller_concierge_invites(id) on delete set null,
  invited_email text not null check (invited_email=lower(btrim(invited_email))),
  plan public.market_plan not null check (plan in ('grower','farm')),
  duration_days int check (duration_days is null or duration_days between 1 and 3650),
  reason_code text not null check (reason_code in (
    'FOUNDING_SELLER','SUPPORT_RESOLUTION','INTERNAL_QA','PARTNER','PROMOTION',
    'INFLUENCER_CREATOR','COMMUNITY_PARTNER','OTHER')),
  reason_explanation text,
  internal_note text,
  approval_reference text,
  source text not null default 'ADMIN' check (source in ('ADMIN','BOON','ZORDY','SELLER_CONCIERGE')),
  status text not null default 'APPROVED' check (status in ('APPROVED','ACTIVATED','CANCELLED','EXPIRED','FAILED')),
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  activated_user_id uuid references public.profiles(id),
  activated_market_id uuid references public.markets(id),
  activated_grant_id uuid references public.admin_plan_grants(id),
  activated_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reason_code<>'OTHER' or nullif(btrim(reason_explanation),'') is not null)
);
create unique index if not exists concierge_one_prepared_entitlement_idx
  on public.seller_concierge_prepared_entitlements(case_id) where status='APPROVED';
create index if not exists concierge_prepared_entitlement_email_idx
  on public.seller_concierge_prepared_entitlements(invited_email,status);

alter table public.seller_concierge_prepared_entitlements enable row level security;
create policy concierge_prepared_entitlements_admin_read on public.seller_concierge_prepared_entitlements
  for select using (public.admin_has_perm('subscriptions.view'));
create policy concierge_prepared_entitlements_seller_read on public.seller_concierge_prepared_entitlements
  for select using (activated_user_id=auth.uid());
revoke all on public.seller_concierge_prepared_entitlements from anon,authenticated;
grant select on public.seller_concierge_prepared_entitlements to authenticated;

create or replace function public.admin_prepare_concierge_entitlement(
  p_case uuid,p_plan public.market_plan,p_duration_days int,p_reason_code text,
  p_reason_explanation text default null,p_note text default null,p_approval_reference text default null,
  p_source text default 'ADMIN'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.seller_concierge_cases; v_invite uuid; v_id uuid; previous_id uuid;
begin
  if not public.admin_has_perm('subscriptions.grant_complimentary') then raise exception 'NOT_AUTHORIZED'; end if;
  if p_plan not in ('grower','farm') then raise exception 'INVALID_COMPLIMENTARY_PLAN'; end if;
  if p_plan='farm' and not public.admin_is_owner() then raise exception 'FARM_OWNER_ONLY'; end if;
  if p_duration_days is not null and p_duration_days not between 1 and 3650 then raise exception 'INVALID_GRANT_DURATION'; end if;
  if p_reason_code not in ('FOUNDING_SELLER','SUPPORT_RESOLUTION','INTERNAL_QA','PARTNER','PROMOTION','INFLUENCER_CREATOR','COMMUNITY_PARTNER','OTHER') then raise exception 'INVALID_REASON'; end if;
  if p_reason_code='OTHER' and nullif(btrim(coalesce(p_reason_explanation,'')),'') is null then raise exception 'OTHER_EXPLANATION_REQUIRED'; end if;
  if p_source not in ('ADMIN','BOON','ZORDY','SELLER_CONCIERGE') then raise exception 'INVALID_SOURCE'; end if;
  select * into c from public.seller_concierge_cases where id=p_case for update;
  if c is null then raise exception 'CASE_NOT_FOUND'; end if;
  if c.claimed_at is not null or c.status not in ('PREPARED','INVITED','NEEDS_INFO','NEEDS_COMPLIANCE','READY') then raise exception 'CASE_NOT_PRECLAIM'; end if;
  if c.invited_email is null then raise exception 'INVITED_EMAIL_REQUIRED'; end if;
  select id into v_invite from public.seller_concierge_invites
   where case_id=c.id and email=c.invited_email and status in ('SENT','OPENED') and expires_at>now()
   order by sent_at desc limit 1;
  update public.seller_concierge_prepared_entitlements set status='CANCELLED',cancelled_by=auth.uid(),cancelled_at=now(),
    cancel_reason='Replaced by a newer approved pre-claim entitlement',updated_at=now()
   where case_id=c.id and status='APPROVED' returning id into previous_id;
  insert into public.seller_concierge_prepared_entitlements
    (case_id,invite_id,invited_email,plan,duration_days,reason_code,reason_explanation,internal_note,approval_reference,source,approved_by)
  values(c.id,v_invite,c.invited_email,p_plan,p_duration_days,p_reason_code,
    nullif(btrim(coalesce(p_reason_explanation,'')),''),nullif(btrim(coalesce(p_note,'')),''),
    nullif(btrim(coalesce(p_approval_reference,'')),''),p_source,auth.uid()) returning id into v_id;
  perform public.admin_audit('CONCIERGE_ENTITLEMENT_PREPARED','seller_concierge_prepared_entitlement',v_id::text,
    case when previous_id is null then null else jsonb_build_object('replaced_prepared_entitlement',previous_id) end,
    jsonb_build_object('case_id',c.id,'invited_email',c.invited_email,'invite_id',v_invite,'plan',p_plan,
      'duration_days',p_duration_days,'reason_code',p_reason_code,'source',p_source,'stripe_changed',false),
    'Approved complimentary access to activate only after secure claim');
  return jsonb_build_object('outcome','PREPARED','prepared_entitlement_id',v_id,'case_id',c.id,
    'invite_id',v_invite,'plan',p_plan,'duration_days',p_duration_days,'reason_code',p_reason_code,'source',p_source,
    'activates','ON_VERIFIED_CLAIM','stripe_changed',false);
end $$;

create or replace function public.admin_cancel_concierge_entitlement(p_prepared uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare e public.seller_concierge_prepared_entitlements;
begin
  if not public.admin_has_perm('subscriptions.revoke_complimentary') then raise exception 'NOT_AUTHORIZED'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'CANCEL_REASON_REQUIRED'; end if;
  select * into e from public.seller_concierge_prepared_entitlements where id=p_prepared for update;
  if e is null then raise exception 'PREPARED_ENTITLEMENT_NOT_FOUND'; end if;
  if e.status<>'APPROVED' then raise exception 'PREPARED_ENTITLEMENT_NOT_ACTIVE'; end if;
  if e.plan='farm' and not public.admin_is_owner() then raise exception 'FARM_OWNER_ONLY'; end if;
  update public.seller_concierge_prepared_entitlements set status='CANCELLED',cancelled_by=auth.uid(),
    cancelled_at=now(),cancel_reason=btrim(p_reason),updated_at=now() where id=e.id;
  perform public.admin_audit('CONCIERGE_ENTITLEMENT_CANCELLED','seller_concierge_prepared_entitlement',e.id::text,
    to_jsonb(e),jsonb_build_object('status','CANCELLED','stripe_changed',false),btrim(p_reason));
  return jsonb_build_object('outcome','CANCELLED','prepared_entitlement_id',e.id,'stripe_changed',false);
end $$;

-- A resend safely rebinds the inactive promise to the newest invitation for
-- the same case and email. A different email never inherits it.
create or replace function public.bind_concierge_entitlement_invite() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  update public.seller_concierge_prepared_entitlements set invite_id=new.id,updated_at=now()
   where case_id=new.case_id and invited_email=new.email and status='APPROVED';
  return new;
end $$;
drop trigger if exists bind_concierge_entitlement_invite_trg on public.seller_concierge_invites;
create trigger bind_concierge_entitlement_invite_trg after insert on public.seller_concierge_invites
for each row execute function public.bind_concierge_entitlement_invite();

-- Activation is atomic with claim. The claim function has already locked and
-- consumed the invite, verified auth.users.email_confirmed_at, matched the
-- invited email, and checked current account readiness before this fires.
create or replace function public.activate_concierge_entitlement_on_claim() returns trigger
language plpgsql security definer set search_path=public as $$
declare e public.seller_concierge_prepared_entitlements; claimed_invite uuid; account_email text;
  account_verified boolean; old_ep record; new_ep record; grant_id uuid; display_reason text;
begin
  if new.claimed_at is not null and old.claimed_at is null then
    select * into e from public.seller_concierge_prepared_entitlements
     where case_id=new.id and status='APPROVED' for update;
    if e is null then return new; end if;
    select i.id into claimed_invite from public.seller_concierge_invites i
     where i.case_id=new.id and i.email=e.invited_email and i.status='CLAIMED' and i.claimed_at is not null
     order by i.claimed_at desc limit 1;
    select lower(email),email_confirmed_at is not null into account_email,account_verified
      from auth.users where id=new.claimed_by;
    if claimed_invite is null or e.invite_id is distinct from claimed_invite
       or account_email is distinct from e.invited_email or not coalesce(account_verified,false) then
      update public.seller_concierge_prepared_entitlements set status='FAILED',
        failure_reason='INVITE_OR_VERIFIED_EMAIL_BINDING_FAILED',updated_at=now() where id=e.id;
      perform public.admin_audit('CONCIERGE_ENTITLEMENT_ACTIVATION_FAILED','seller_concierge_prepared_entitlement',e.id::text,
        to_jsonb(e),jsonb_build_object('status','FAILED','reason','INVITE_OR_VERIFIED_EMAIL_BINDING_FAILED','stripe_changed',false),
        'Prepared entitlement did not match the consumed invitation','SYSTEM');
      return new;
    end if;
    if exists(select 1 from public.admin_plan_grants where market_id=new.claimed_market_id and status='ACTIVE'
      and starts_at<=now() and (expires_at is null or expires_at>now())) then
      update public.seller_concierge_prepared_entitlements set status='FAILED',failure_reason='ACTIVE_COMPLIMENTARY_GRANT_EXISTS',updated_at=now() where id=e.id;
      perform public.admin_audit('CONCIERGE_ENTITLEMENT_ACTIVATION_FAILED','seller_concierge_prepared_entitlement',e.id::text,
        to_jsonb(e),jsonb_build_object('status','FAILED','reason','ACTIVE_COMPLIMENTARY_GRANT_EXISTS','stripe_changed',false),
        'Existing complimentary access was preserved; no overlapping grant created','SYSTEM');
      return new;
    end if;
    select * into old_ep from public.market_effective_plan(new.claimed_market_id);
    display_reason:=replace(initcap(lower(e.reason_code)),'_',' ');
    insert into public.admin_plan_grants(market_id,user_id,plan,starts_at,expires_at,reason,reason_code,
      reason_explanation,internal_note,granted_by,approval_reference,grant_source,
      old_effective_plan,old_effective_source,execution_result)
    values(new.claimed_market_id,new.claimed_by,e.plan,now(),
      case when e.duration_days is null then null else now()+make_interval(days=>e.duration_days) end,
      display_reason,e.reason_code,e.reason_explanation,e.internal_note,e.approved_by,
      coalesce(e.approval_reference,e.id::text),'SELLER_CONCIERGE',old_ep.plan,old_ep.source,
      jsonb_build_object('outcome','ACTIVATED_ON_CLAIM','case_id',new.id,'invite_id',claimed_invite,'stripe_changed',false))
    returning id into grant_id;
    update public.seller_concierge_prepared_entitlements set status='ACTIVATED',activated_user_id=new.claimed_by,
      activated_market_id=new.claimed_market_id,activated_grant_id=grant_id,activated_at=now(),updated_at=now() where id=e.id;
    select * into new_ep from public.market_effective_plan(new.claimed_market_id);
    perform public.reconcile_pickup_locations(new.claimed_market_id);
    perform public.admin_audit('CONCIERGE_ENTITLEMENT_ACTIVATED','seller_concierge_prepared_entitlement',e.id::text,
      jsonb_build_object('status','APPROVED','effective_plan',old_ep.plan,'effective_source',old_ep.source),
      jsonb_build_object('status','ACTIVATED','grant_id',grant_id,'effective_plan',new_ep.plan,
        'effective_source',new_ep.source,'duration_days',e.duration_days,'stripe_changed',false),
      'Activated after verified invited seller claim','SYSTEM');
  end if;
  -- Declined or expired invitations do not activate or consume the prepared
  -- entitlement. It stays inactive so an admin can explicitly cancel it.
  return new;
end $$;
drop trigger if exists activate_concierge_entitlement_on_claim_trg on public.seller_concierge_cases;
create trigger activate_concierge_entitlement_on_claim_trg after update of claimed_at,status on public.seller_concierge_cases
for each row execute function public.activate_concierge_entitlement_on_claim();

-- ---------------------------------------------------------------------------
-- 3. Promo checkout reservations close concurrent-cap races
-- ---------------------------------------------------------------------------
create table if not exists public.promotion_checkout_reservations(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.promotion_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  market_id uuid references public.markets(id) on delete cascade,
  plan public.market_plan not null,
  stripe_session_id text unique,
  status text not null default 'RESERVED' check(status in ('RESERVED','ATTACHED','REDEEMED','RELEASED','EXPIRED')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default(now()+interval '30 minutes'),
  redeemed_at timestamptz
);
create index if not exists promotion_reservations_cap_idx on public.promotion_checkout_reservations(campaign_id,status,expires_at);

create table if not exists public.promotion_preview_attempts(
  id bigint generated always as identity primary key,user_id uuid not null,
  attempted_at timestamptz not null default now()
);
create index if not exists promotion_preview_attempts_user_idx on public.promotion_preview_attempts(user_id,attempted_at desc);

alter table public.promotion_checkout_reservations enable row level security;
alter table public.promotion_preview_attempts enable row level security;
revoke all on public.promotion_checkout_reservations,public.promotion_preview_attempts from anon,authenticated;

create or replace function public.promo_preview_reserve(p_user uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if auth.uid() is not null then raise exception 'SERVICE_ONLY'; end if;
  delete from public.promotion_preview_attempts where attempted_at<now()-interval '2 hours';
  select count(*) into n from public.promotion_preview_attempts where user_id=p_user and attempted_at>now()-interval '1 hour';
  if n>=20 then return false; end if;
  insert into public.promotion_preview_attempts(user_id) values(p_user);
  return true;
end $$;

create or replace function public.promo_reserve_checkout(p_code text,p_plan public.market_plan,p_user uuid,p_market uuid)
returns table(ok boolean,reason text,reservation_id uuid,campaign_id uuid,campaign_name text,stripe_promotion_code_id text)
language plpgsql security definer set search_path=public as $$
declare v record; c public.promotion_campaigns; total_n int; user_n int; rid uuid;
begin
  if auth.uid() is not null then raise exception 'SERVICE_ONLY'; end if;
  select * into v from public.promo_validate(p_code,p_plan,p_user);
  if v is null or not coalesce(v.ok,false) then
    return query select false,coalesce(v.reason,'INVALID_CODE'),null::uuid,v.campaign_id,v.campaign_name,v.stripe_promotion_code_id; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v.campaign_id::text,0));
  select * into c from public.promotion_campaigns where id=v.campaign_id for update;
  update public.promotion_checkout_reservations pr set status='EXPIRED'
   where pr.campaign_id=c.id and pr.status in('RESERVED','ATTACHED') and pr.expires_at<=now();
  select count(*) into total_n from public.promotion_redemptions rd
   where rd.campaign_id=c.id and rd.status in('redeemed','converted');
  select total_n+count(*) into total_n from public.promotion_checkout_reservations pr
   where pr.campaign_id=c.id and pr.status in('RESERVED','ATTACHED') and pr.expires_at>now();
  select count(*) into user_n from public.promotion_redemptions rd
   where rd.campaign_id=c.id and rd.user_id=p_user and rd.status in('redeemed','converted');
  select user_n+count(*) into user_n from public.promotion_checkout_reservations pr
   where pr.campaign_id=c.id and pr.user_id=p_user and pr.status in('RESERVED','ATTACHED') and pr.expires_at>now();
  if c.max_redemptions is not null and total_n>=c.max_redemptions then return query select false,'FULLY_REDEEMED',null::uuid,c.id,c.campaign_name,null::text; return; end if;
  if user_n>=c.max_redemptions_per_user then return query select false,'ALREADY_REDEEMED',null::uuid,c.id,c.campaign_name,null::text; return; end if;
  insert into public.promotion_checkout_reservations(campaign_id,user_id,market_id,plan) values(c.id,p_user,p_market,p_plan) returning id into rid;
  return query select true,'OK',rid,c.id,c.campaign_name,v.stripe_promotion_code_id;
end $$;

create or replace function public.promo_attach_checkout(p_reservation uuid,p_session text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not null then raise exception 'SERVICE_ONLY'; end if;
  update public.promotion_checkout_reservations set stripe_session_id=p_session,status='ATTACHED'
   where id=p_reservation and status='RESERVED' and expires_at>now();
  return found;
end $$;
create or replace function public.promo_release_checkout(p_reservation uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not null then raise exception 'SERVICE_ONLY'; end if;
  update public.promotion_checkout_reservations set status='RELEASED' where id=p_reservation and status in('RESERVED','ATTACHED');
end $$;

create or replace function public.record_promo_redemption(
  p_campaign uuid,p_user uuid,p_market uuid,p_plan public.market_plan,
  p_session text,p_subscription text,p_customer text,p_discount_cents int
) returns boolean language plpgsql security definer set search_path=public as $$
declare r public.promotion_checkout_reservations;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_campaign::text,0));
  if exists(select 1 from public.promotion_redemptions where stripe_session_id=p_session) then return false; end if;
  select * into r from public.promotion_checkout_reservations where stripe_session_id=p_session for update;
  insert into public.promotion_redemptions(campaign_id,user_id,market_id,plan,stripe_session_id,
    stripe_subscription_id,stripe_customer_id,amount_discounted_cents)
  values(p_campaign,p_user,p_market,p_plan,p_session,p_subscription,p_customer,p_discount_cents)
  on conflict(stripe_session_id) do nothing;
  if not found then return false; end if;
  if r.id is not null then update public.promotion_checkout_reservations set status='REDEEMED',redeemed_at=now() where id=r.id; end if;
  return true;
end $$;

create or replace function public.admin_promo_campaigns_v2()
returns table(id uuid,code text,campaign_name text,active boolean,applicable_plans public.market_plan[],
  benefit text,starts_at timestamptz,expires_at timestamptz,max_redemptions int,used bigint,remaining bigint,
  eligibility text,created_by text,created_at timestamptz)
language sql stable security definer set search_path=public as $$
  select c.id,c.code,c.campaign_name,c.active,c.applicable_plans,
    case when c.discount_type='percent' then trim(to_char(c.discount_percent,'FM999.##'))||'% off'||
      case when c.duration='repeating' then ' for '||c.duration_in_months||' months' when c.duration='forever' then ' ongoing' else ' once' end
      else '$'||to_char(c.discount_amount_cents/100.0,'FM999990.00')||' off'||case when c.duration='once' then ' once' else '' end end,
    c.starts_at,c.expires_at,c.max_redemptions,
    count(r.*) filter(where r.status in('redeemed','converted')),
    case when c.max_redemptions is null then null else greatest(c.max_redemptions-count(r.*) filter(where r.status in('redeemed','converted')),0) end,
    case when c.new_customers_only then 'New customers only' else 'Eligible signed-in accounts' end,
    coalesce(p.name,au.invited_name,'Gnome admin'),c.created_at
  from public.promotion_campaigns c left join public.promotion_redemptions r on r.campaign_id=c.id
  left join public.profiles p on p.id=c.created_by left join public.admin_users au on au.user_id=c.created_by
  where public.admin_has_perm('subscriptions.view') group by c.id,p.name,au.invited_name order by c.created_at desc;
$$;

revoke all on function public.admin_grant_plan_v2(uuid,public.market_plan,timestamptz,text,text,text,text,text,text),
  public.admin_revoke_grant_v2(uuid,text),public.admin_market_entitlements_v2(uuid),
  public.admin_prepare_concierge_entitlement(uuid,public.market_plan,int,text,text,text,text,text),
  public.admin_cancel_concierge_entitlement(uuid,text),public.admin_promo_campaigns_v2() from public,anon;
grant execute on function public.admin_grant_plan_v2(uuid,public.market_plan,timestamptz,text,text,text,text,text,text),
  public.admin_revoke_grant_v2(uuid,text),public.admin_market_entitlements_v2(uuid),
  public.admin_prepare_concierge_entitlement(uuid,public.market_plan,int,text,text,text,text,text),
  public.admin_cancel_concierge_entitlement(uuid,text),public.admin_promo_campaigns_v2() to authenticated;
revoke execute on function public.bind_concierge_entitlement_invite(),
  public.activate_concierge_entitlement_on_claim() from public,anon,authenticated;
revoke all on function public.promo_preview_reserve(uuid),
  public.promo_reserve_checkout(text,public.market_plan,uuid,uuid),
  public.promo_attach_checkout(uuid,text),public.promo_release_checkout(uuid) from public,anon,authenticated;

do $$ begin
  if exists(select 1 from public.billing_config where payments_live_enabled) then
    raise exception 'SAFETY: payments_live_enabled must remain false';
  end if;
end $$;

notify pgrst,'reload schema';
