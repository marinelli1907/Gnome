-- Gnome launch referral and growth operations. This precedes the executive
-- organization migration because its growth pack consumes the service RPC.
--
-- Additive and unapplied. Referral attribution is private, qualification is
-- server-derived from a seller's first public Sell listing, and every reward
-- has a unique idempotency key. Nothing in this migration enables payments or
-- creates a Stripe subscription.

-- ---------------------------------------------------------------------------
-- 1. Truthful promo behavior metadata
-- ---------------------------------------------------------------------------
alter table public.promotion_campaigns
  add column if not exists conversion_behavior text not null default 'AUTO_RENEW'
    check (conversion_behavior in ('AUTO_RENEW','NO_AUTO_CONVERSION')),
  add column if not exists payment_method_required boolean not null default true;

update public.promotion_campaigns
set conversion_behavior = 'AUTO_RENEW', payment_method_required = true,
    internal_notes = concat_ws(E'\n', nullif(internal_notes,''),
      'Customer disclosure: $0 today; Pro free for 3 months; then the authoritative Pro monthly price unless canceled. Payment method required.')
where code = 'FOUNDING3';

-- ---------------------------------------------------------------------------
-- 2. Private identity, attribution, milestones and reward ledgers
-- ---------------------------------------------------------------------------
create table if not exists public.referral_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  code text not null unique check (code = upper(code) and code ~ '^GN[A-F0-9]{16}$'),
  issued_source text not null check (issued_source in ('APP','WEB','MARKET_QR','SELLER_CONCIERGE','ADMIN')),
  seller_concierge_case_id uuid references public.seller_concierge_cases(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.referral_attributions (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.referral_identities(id) on delete restrict,
  referrer_user_id uuid not null references public.profiles(id) on delete restrict,
  referred_user_id uuid not null unique references public.profiles(id) on delete cascade,
  source text not null check (source in ('APP_LINK','WEB_LINK','MARKET_QR','SELLER_CONCIERGE','ADMIN')),
  source_market_id uuid references public.markets(id) on delete set null,
  seller_concierge_case_id uuid references public.seller_concierge_cases(id) on delete set null,
  status text not null default 'ATTRIBUTED' check (status in ('ATTRIBUTED','QUALIFIED','REJECTED')),
  qualified_market_id uuid references public.markets(id) on delete set null,
  qualified_listing_id uuid references public.listings(id) on delete set null,
  qualified_at timestamptz,
  rejected_reason text,
  is_qa boolean not null default false,
  attributed_at timestamptz not null default now(),
  check (referrer_user_id <> referred_user_id),
  check ((status = 'QUALIFIED') = (qualified_at is not null))
);
create index if not exists referral_attributions_referrer_idx
  on public.referral_attributions(referrer_user_id,status,qualified_at);

create table if not exists public.referral_reward_ledger (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  attribution_id uuid references public.referral_attributions(id) on delete restrict,
  referrer_user_id uuid not null references public.profiles(id) on delete restrict,
  beneficiary_user_id uuid not null references public.profiles(id) on delete restrict,
  milestone integer not null check (milestone in (1,3,5,10,25,50)),
  reward_type text not null check (reward_type in ('FEATURED_LISTING_CREDIT','COMPLIMENTARY_PRO_DAYS','FEATURED_MARKET_BOOST','BUYER_REWARD_DEFERRED','OWNER_APPROVAL_REQUIRED')),
  quantity integer not null check (quantity > 0),
  status text not null check (status in ('ISSUED','DEFERRED','TRACKED')),
  related_record_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists referral_rewards_referrer_idx
  on public.referral_reward_ledger(referrer_user_id,created_at desc);

-- A Market Boost is intentionally separate from listing promotion credits.
-- One redemption features a Market for seven days; clients cannot mint rows.
create table if not exists public.market_featured_boost_credits (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  delta integer not null check (delta <> 0),
  reason text not null,
  source text not null check (source in ('REFERRAL_REWARD','ADMIN_COMP','CONSUMED','REVERSAL')),
  referral_reward_id uuid unique references public.referral_reward_ledger(id) on delete restrict,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists market_boost_credit_market_idx
  on public.market_featured_boost_credits(market_id,created_at);

create table if not exists public.market_featured_boosts (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ENDED')),
  source_credit_id uuid not null unique references public.market_featured_boost_credits(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create or replace view public.public_active_market_boosts as
select b.market_id,max(b.ends_at) as featured_until
from public.market_featured_boosts b
join public.markets m on m.id=b.market_id
join public.profiles p on p.id=m.owner_id
where b.status='ACTIVE' and b.starts_at<=now() and b.ends_at>now()
  and m.status='active' and not coalesce(p.suspended,false)
group by b.market_id;
grant select on public.public_active_market_boosts to anon,authenticated;

alter table public.market_promotion_credits
  add column if not exists referral_reward_id uuid unique references public.referral_reward_ledger(id) on delete restrict;
alter table public.market_promotion_credits drop constraint if exists market_promotion_credits_source_check;
alter table public.market_promotion_credits add constraint market_promotion_credits_source_check
  check (source in ('PURCHASED_SINGLE','PURCHASED_PACK_3','PURCHASED_PACK_10','ADMIN_COMP','REFERRAL_REWARD','REFUND','CONSUMED'));

alter table public.admin_plan_grants
  add column if not exists referral_reward_id uuid unique references public.referral_reward_ledger(id) on delete restrict;
alter table public.admin_plan_grants drop constraint if exists plan_grants_reason_code_chk;
alter table public.admin_plan_grants add constraint plan_grants_reason_code_chk check (reason_code in (
  'FOUNDING_SELLER','SUPPORT_RESOLUTION','INTERNAL_QA','PARTNER','PROMOTION','REFERRAL_REWARD',
  'INFLUENCER_CREATOR','COMMUNITY_PARTNER','OTHER'));
alter table public.admin_plan_grants drop constraint if exists plan_grants_source_chk;
alter table public.admin_plan_grants add constraint plan_grants_source_chk check (grant_source in (
  'ADMIN','BOON','ZORDY','SELLER_CONCIERGE','SUPPORT','REFERRAL','PROMO_CODE','LEGACY_ADMIN'));

alter table public.seller_concierge_cases
  add column if not exists acquisition_source text not null default 'SELLER_CONCIERGE',
  add column if not exists referral_code text;

-- Everything above contains private operational data. Read it through scoped
-- RPCs only, including in Gnome Admin and Boardroom.
alter table public.referral_identities enable row level security;
alter table public.referral_attributions enable row level security;
alter table public.referral_reward_ledger enable row level security;
alter table public.market_featured_boost_credits enable row level security;
alter table public.market_featured_boosts enable row level security;
revoke all on public.referral_identities,public.referral_attributions,
  public.referral_reward_ledger,public.market_featured_boost_credits,
  public.market_featured_boosts from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- 3. Private attribution helpers
-- ---------------------------------------------------------------------------
create or replace function public._ensure_referral_identity(
  p_user uuid,p_source text,p_case uuid default null
) returns public.referral_identities
language plpgsql security definer set search_path=public,extensions as $$
declare r public.referral_identities; v_code text;
begin
  select * into r from public.referral_identities where user_id=p_user;
  if r.id is not null then return r; end if;
  if not exists(select 1 from public.profiles where id=p_user) then raise exception 'USER_NOT_FOUND'; end if;
  loop
    v_code := 'GN'||upper(encode(extensions.gen_random_bytes(8),'hex'));
    begin
      insert into public.referral_identities(user_id,code,issued_source,seller_concierge_case_id)
      values(p_user,v_code,p_source,p_case) returning * into r;
      return r;
    exception when unique_violation then
      select * into r from public.referral_identities where user_id=p_user;
      if r.id is not null then return r; end if;
    end;
  end loop;
end $$;
revoke all on function public._ensure_referral_identity(uuid,text,uuid) from public,anon,authenticated;

create or replace function public._capture_referral(
  p_referred uuid,p_code text,p_source text,p_market uuid default null,p_case uuid default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare ident public.referral_identities; existing public.referral_attributions; v_id uuid;
  ref_email text; new_email text; ref_phone text; new_phone text; v_qa boolean:=false;
begin
  select * into ident from public.referral_identities where code=upper(btrim(p_code));
  if ident.id is null then raise exception 'REFERRAL_CODE_NOT_FOUND'; end if;
  if ident.user_id=p_referred then raise exception 'SELF_REFERRAL_NOT_ALLOWED'; end if;
  select lower(email),regexp_replace(coalesce(phone,''),'[^0-9]','','g') into ref_email,ref_phone from auth.users where id=ident.user_id;
  select lower(email),regexp_replace(coalesce(phone,''),'[^0-9]','','g') into new_email,new_phone from auth.users where id=p_referred;
  if ref_email is not null and ref_email=new_email then raise exception 'SELF_REFERRAL_NOT_ALLOWED'; end if;
  if length(ref_phone)>=7 and ref_phone=new_phone then raise exception 'DUPLICATE_PHONE_REFERRAL_NOT_ALLOWED'; end if;
  select * into existing from public.referral_attributions where referred_user_id=p_referred;
  if existing.id is not null then
    if existing.identity_id=ident.id then return existing.id; end if;
    raise exception 'REFERRAL_ALREADY_ATTRIBUTED';
  end if;
  if p_case is not null then
    select coalesce(is_qa,false) into v_qa from public.seller_concierge_cases where id=p_case;
  end if;
  insert into public.referral_attributions(identity_id,referrer_user_id,referred_user_id,source,
    source_market_id,seller_concierge_case_id,is_qa)
  values(ident.id,ident.user_id,p_referred,p_source,p_market,p_case,v_qa) returning id into v_id;
  insert into public.events(user_id,event_type,metadata)
  values(p_referred,'referral_attributed',jsonb_build_object('source',p_source,'attribution_id',v_id));
  return v_id;
end $$;
revoke all on function public._capture_referral(uuid,text,text,uuid,uuid) from public,anon,authenticated;

create or replace function public.capture_my_referral(
  p_code text,p_source text default 'APP_LINK',p_market uuid default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); v_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_source not in ('APP_LINK','WEB_LINK','MARKET_QR') then raise exception 'INVALID_SOURCE'; end if;
  v_id:=public._capture_referral(uid,p_code,p_source,p_market,null);
  return jsonb_build_object('attributed',true,'attribution_id',v_id);
end $$;
revoke all on function public.capture_my_referral(text,text,uuid) from public,anon;
grant execute on function public.capture_my_referral(text,text,uuid) to authenticated;

-- Public QR-to-referral lookup reveals only the intentionally shareable code,
-- and only for a currently public, non-suspended Market.
create or replace function public.resolve_market_qr_referral(p_code text)
returns table(referral_code text,market_id uuid)
language plpgsql security definer set search_path=public as $$
declare v_owner uuid; v_market uuid; ident public.referral_identities;
begin
  select m.owner_id,m.id into v_owner,v_market
  from public.market_qr q join public.markets m on m.id=q.market_id
  join public.profiles p on p.id=m.owner_id
  where q.code=lower(btrim(p_code)) and m.status='active' and not coalesce(p.suspended,false);
  if v_owner is null then return; end if;
  ident:=public._ensure_referral_identity(v_owner,'MARKET_QR',null);
  referral_code:=ident.code; market_id:=v_market; return next;
end $$;
revoke all on function public.resolve_market_qr_referral(text) from public;
grant execute on function public.resolve_market_qr_referral(text) to anon,authenticated;

-- ---------------------------------------------------------------------------
-- 4. Exactly-once qualification and launch rewards
-- ---------------------------------------------------------------------------
create or replace function public._referral_listing_credit(
  p_key text,p_attr uuid,p_referrer uuid,p_beneficiary uuid,p_milestone int,p_qty int
) returns void language plpgsql security definer set search_path=public as $$
declare v_market uuid; v_reward uuid;
begin
  select m.id into v_market from public.markets m where m.owner_id=p_beneficiary and m.status<>'deleted' order by m.created_at limit 1;
  if v_market is null or (p_beneficiary=p_referrer and not exists(
    select 1 from public.listings l where l.owner_id=p_beneficiary and l.listing_type='sale'
      and l.status in ('active','claimed','completed','expired') and not coalesce(l.is_demo,false)
  )) then
    insert into public.referral_reward_ledger(idempotency_key,attribution_id,referrer_user_id,beneficiary_user_id,milestone,reward_type,quantity,status)
    values(p_key,p_attr,p_referrer,p_beneficiary,p_milestone,'FEATURED_LISTING_CREDIT',p_qty,'DEFERRED') on conflict do nothing;
    return;
  end if;
  insert into public.referral_reward_ledger(idempotency_key,attribution_id,referrer_user_id,beneficiary_user_id,milestone,reward_type,quantity,status)
  values(p_key,p_attr,p_referrer,p_beneficiary,p_milestone,'FEATURED_LISTING_CREDIT',p_qty,'ISSUED')
  on conflict do nothing returning id into v_reward;
  if v_reward is not null then
    insert into public.market_promotion_credits(market_id,delta,reason,source,created_by,referral_reward_id)
    values(v_market,p_qty,'Referral reward','REFERRAL_REWARD',null,v_reward);
    update public.referral_reward_ledger set related_record_id=(select id from public.market_promotion_credits where referral_reward_id=v_reward) where id=v_reward;
  end if;
end $$;
revoke all on function public._referral_listing_credit(text,uuid,uuid,uuid,int,int) from public,anon,authenticated;

create or replace function public._release_deferred_buyer_rewards(p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r public.referral_reward_ledger; v_market uuid; v_record uuid; v_start timestamptz;
begin
  select id into v_market from public.markets where owner_id=p_user and status<>'deleted' order by created_at limit 1;
  if v_market is null or not exists(select 1 from public.listings where owner_id=p_user and listing_type='sale'
    and status in ('active','claimed','completed','expired') and not coalesce(is_demo,false)) then return; end if;
  for r in select * from public.referral_reward_ledger where beneficiary_user_id=p_user
    and status='DEFERRED' for update
  loop
    if r.reward_type='FEATURED_LISTING_CREDIT' then
      insert into public.market_promotion_credits(market_id,delta,reason,source,referral_reward_id)
      values(v_market,r.quantity,'Deferred referral reward activated after seller qualification','REFERRAL_REWARD',r.id)
      returning id into v_record;
    elsif r.reward_type='COMPLIMENTARY_PRO_DAYS' then
      select greatest(now(),coalesce(max(expires_at),now())) into v_start from public.admin_plan_grants
      where market_id=v_market and status='ACTIVE' and grant_source='REFERRAL' and expires_at>now();
      insert into public.admin_plan_grants(market_id,user_id,plan,starts_at,expires_at,status,reason,
        reason_code,reason_explanation,grant_source,execution_result,referral_reward_id)
      values(v_market,p_user,'grower',v_start,v_start+make_interval(days=>r.quantity),'ACTIVE','Referral reward',
        'REFERRAL_REWARD',format('%s qualified seller milestone',r.milestone),'REFERRAL',
        jsonb_build_object('milestone',r.milestone,'days',r.quantity,'stripe_untouched',true),r.id)
      returning id into v_record;
    elsif r.reward_type='FEATURED_MARKET_BOOST' then
      insert into public.market_featured_boost_credits(market_id,delta,reason,source,referral_reward_id)
      values(v_market,r.quantity,'Deferred referral reward activated after seller qualification','REFERRAL_REWARD',r.id)
      returning id into v_record;
    else
      continue;
    end if;
    update public.referral_reward_ledger set status='ISSUED',related_record_id=v_record where id=r.id;
  end loop;
end $$;
revoke all on function public._release_deferred_buyer_rewards(uuid) from public,anon,authenticated;

create or replace function public._referral_comp_pro(
  p_key text,p_referrer uuid,p_milestone int,p_days int
) returns void language plpgsql security definer set search_path=public as $$
declare v_market uuid; v_reward uuid; v_start timestamptz; v_grant uuid;
begin
  select id into v_market from public.markets where owner_id=p_referrer and status<>'deleted' order by created_at limit 1;
  if v_market is null then return; end if;
  if not exists(select 1 from public.listings where owner_id=p_referrer and listing_type='sale'
    and status in ('active','claimed','completed','expired') and not coalesce(is_demo,false)) then
    insert into public.referral_reward_ledger(idempotency_key,referrer_user_id,beneficiary_user_id,milestone,reward_type,quantity,status)
    values(p_key,p_referrer,p_referrer,p_milestone,'COMPLIMENTARY_PRO_DAYS',p_days,'DEFERRED') on conflict do nothing;
    return;
  end if;
  insert into public.referral_reward_ledger(idempotency_key,referrer_user_id,beneficiary_user_id,milestone,reward_type,quantity,status)
  values(p_key,p_referrer,p_referrer,p_milestone,'COMPLIMENTARY_PRO_DAYS',p_days,'ISSUED')
  on conflict do nothing returning id into v_reward;
  if v_reward is null then return; end if;
  select greatest(now(),coalesce(max(expires_at),now())) into v_start
  from public.admin_plan_grants where market_id=v_market and status='ACTIVE' and grant_source='REFERRAL' and expires_at>now();
  insert into public.admin_plan_grants(market_id,user_id,plan,starts_at,expires_at,status,reason,
    reason_code,reason_explanation,grant_source,execution_result,referral_reward_id)
  values(v_market,p_referrer,'grower',v_start,v_start+make_interval(days=>p_days),'ACTIVE','Referral reward',
    'REFERRAL_REWARD',format('%s qualified seller milestone',p_milestone),'REFERRAL',
    jsonb_build_object('milestone',p_milestone,'days',p_days,'stripe_untouched',true),v_reward)
  returning id into v_grant;
  update public.referral_reward_ledger set related_record_id=v_grant where id=v_reward;
end $$;
revoke all on function public._referral_comp_pro(text,uuid,int,int) from public,anon,authenticated;

create or replace function public._referral_market_boost(
  p_key text,p_referrer uuid,p_milestone int,p_qty int
) returns void language plpgsql security definer set search_path=public as $$
declare v_market uuid; v_reward uuid; v_credit uuid;
begin
  select id into v_market from public.markets where owner_id=p_referrer and status<>'deleted' order by created_at limit 1;
  if v_market is null then return; end if;
  if not exists(select 1 from public.listings where owner_id=p_referrer and listing_type='sale'
    and status in ('active','claimed','completed','expired') and not coalesce(is_demo,false)) then
    insert into public.referral_reward_ledger(idempotency_key,referrer_user_id,beneficiary_user_id,milestone,reward_type,quantity,status)
    values(p_key,p_referrer,p_referrer,p_milestone,'FEATURED_MARKET_BOOST',p_qty,'DEFERRED') on conflict do nothing;
    return;
  end if;
  insert into public.referral_reward_ledger(idempotency_key,referrer_user_id,beneficiary_user_id,milestone,reward_type,quantity,status)
  values(p_key,p_referrer,p_referrer,p_milestone,'FEATURED_MARKET_BOOST',p_qty,'ISSUED')
  on conflict do nothing returning id into v_reward;
  if v_reward is not null then
    insert into public.market_featured_boost_credits(market_id,delta,reason,source,referral_reward_id)
    values(v_market,p_qty,'Referral reward','REFERRAL_REWARD',v_reward) returning id into v_credit;
    update public.referral_reward_ledger set related_record_id=v_credit where id=v_reward;
  end if;
end $$;
revoke all on function public._referral_market_boost(text,uuid,int,int) from public,anon,authenticated;

create or replace function public._issue_referral_milestones(p_referrer uuid)
returns void language plpgsql security definer set search_path=public as $$
declare n int;
begin
  select count(*)::int into n from public.referral_attributions
  where referrer_user_id=p_referrer and status='QUALIFIED' and not is_qa;
  if n>=3 then perform public._referral_listing_credit('M3:'||p_referrer,null,p_referrer,p_referrer,3,3); end if;
  if n>=5 then
    perform public._referral_listing_credit('M5:CREDIT:'||p_referrer,null,p_referrer,p_referrer,5,5);
    perform public._referral_comp_pro('M5:PRO:'||p_referrer,p_referrer,5,30);
  end if;
  if n>=10 then
    perform public._referral_listing_credit('M10:CREDIT:'||p_referrer,null,p_referrer,p_referrer,10,10);
    perform public._referral_comp_pro('M10:PRO:'||p_referrer,p_referrer,10,90);
    perform public._referral_market_boost('M10:MARKET:'||p_referrer,p_referrer,10,1);
  end if;
  if n>=25 then
    insert into public.referral_reward_ledger(idempotency_key,referrer_user_id,beneficiary_user_id,milestone,reward_type,quantity,status)
    values('M25:TRACK:'||p_referrer,p_referrer,p_referrer,25,'OWNER_APPROVAL_REQUIRED',1,'TRACKED') on conflict do nothing;
  end if;
  if n>=50 then
    insert into public.referral_reward_ledger(idempotency_key,referrer_user_id,beneficiary_user_id,milestone,reward_type,quantity,status)
    values('M50:TRACK:'||p_referrer,p_referrer,p_referrer,50,'OWNER_APPROVAL_REQUIRED',1,'TRACKED') on conflict do nothing;
  end if;
end $$;
revoke all on function public._issue_referral_milestones(uuid) from public,anon,authenticated;

create or replace function public.qualify_seller_referral(p_listing uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare a public.referral_attributions; l public.listings; v_market public.markets;
begin
  select * into l from public.listings where id=p_listing;
  if l.id is null or l.status<>'active' or l.expires_at<=now() or l.listing_type<>'sale' or l.market_id is null
    or coalesce(l.is_demo,false) or coalesce(l.screening_status,'CLEAR')<>'CLEAR' then return false; end if;
  select * into v_market from public.markets where id=l.market_id;
  if v_market.id is null or v_market.status<>'active' or v_market.owner_id<>l.owner_id then return false; end if;
  if exists(select 1 from public.profiles where id=l.owner_id and suspended) then return false; end if;
  if not public.account_is_ready(l.owner_id) then return false; end if;
  perform public._release_deferred_buyer_rewards(l.owner_id);
  select * into a from public.referral_attributions where referred_user_id=l.owner_id for update;
  if a.id is null or a.status<>'ATTRIBUTED' or a.is_qa then return false; end if;
  update public.referral_attributions set status='QUALIFIED',qualified_market_id=l.market_id,
    qualified_listing_id=l.id,qualified_at=now() where id=a.id;
  perform public._referral_listing_credit('Q:'||a.id||':REFERRED',a.id,a.referrer_user_id,a.referred_user_id,1,1);
  perform public._referral_listing_credit('Q:'||a.id||':REFERRER',a.id,a.referrer_user_id,a.referrer_user_id,1,1);
  perform public._issue_referral_milestones(a.referrer_user_id);
  insert into public.events(user_id,event_type,listing_id,metadata)
  values(a.referred_user_id,'referral_seller_qualified',l.id,jsonb_build_object('attribution_id',a.id,'market_id',l.market_id));
  return true;
end $$;
revoke all on function public.qualify_seller_referral(uuid) from public,anon,authenticated;

create or replace function public.referral_listing_qualification_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.qualify_seller_referral(new.id); return new; end $$;
drop trigger if exists referral_listing_qualification_trg on public.listings;
create trigger referral_listing_qualification_trg
after insert or update of status,screening_status on public.listings
for each row when (new.status='active') execute function public.referral_listing_qualification_trigger();

-- Seller Concierge integration stays trigger-only: the closed claim flow is
-- not redesigned. Claim creates the seller's identity and captures a prepared
-- referral, when one exists.
create or replace function public.concierge_referral_claim_hook()
returns trigger language plpgsql security definer set search_path=public as $$
declare ident public.referral_identities;
begin
  if new.claimed_by is null or old.claimed_by is not null then return new; end if;
  ident:=public._ensure_referral_identity(new.claimed_by,'SELLER_CONCIERGE',new.id);
  if nullif(btrim(coalesce(new.referral_code,'')),'') is not null then
    perform public._capture_referral(new.claimed_by,new.referral_code,'SELLER_CONCIERGE',null,new.id);
  end if;
  return new;
end $$;
drop trigger if exists concierge_referral_claim_trg on public.seller_concierge_cases;
create trigger concierge_referral_claim_trg after update of claimed_by on public.seller_concierge_cases
for each row execute function public.concierge_referral_claim_hook();

create or replace function public.admin_set_concierge_acquisition(
  p_case uuid,p_source text,p_referral_code text default null
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not (public.admin_has_perm('markets.edit') or public.admin_is_owner()) then raise exception 'NOT_AUTHORIZED'; end if;
  if not exists(select 1 from public.seller_concierge_cases where id=p_case and claimed_by is null) then raise exception 'CASE_NOT_EDITABLE'; end if;
  if p_referral_code is not null and not exists(select 1 from public.referral_identities where code=upper(btrim(p_referral_code))) then raise exception 'REFERRAL_CODE_NOT_FOUND'; end if;
  update public.seller_concierge_cases set acquisition_source=upper(btrim(p_source)),
    referral_code=nullif(upper(btrim(coalesce(p_referral_code,''))),''),updated_at=now() where id=p_case;
  perform public.admin_audit('CONCIERGE_ACQUISITION_SET','seller_concierge_case',p_case::text,null,
    jsonb_build_object('source',upper(btrim(p_source)),'referral_set',p_referral_code is not null),'Growth attribution updated');
end $$;
revoke all on function public.admin_set_concierge_acquisition(uuid,text,text) from public,anon;
grant execute on function public.admin_set_concierge_acquisition(uuid,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Seller and Admin read models + Market Boost redemption
-- ---------------------------------------------------------------------------
create or replace function public.my_referral_program()
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); ident public.referral_identities; v_market uuid; q int; p int; lc int; mb int;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  ident:=public._ensure_referral_identity(uid,'APP',null);
  select id into v_market from public.markets where owner_id=uid and status<>'deleted' order by created_at limit 1;
  select count(*)::int into q from public.referral_attributions where referrer_user_id=uid and status='QUALIFIED' and not is_qa;
  select count(*)::int into p from public.referral_attributions where referrer_user_id=uid and status='ATTRIBUTED' and not is_qa;
  select coalesce(sum(delta),0)::int into lc from public.market_promotion_credits where market_id=v_market;
  select coalesce(sum(delta),0)::int into mb from public.market_featured_boost_credits where market_id=v_market;
  return jsonb_build_object('code',ident.code,'share_url','https://gnomefarmersmarket.com/referrals?code='||ident.code,
    'qualified_sellers',q,'pending_referrals',p,'featured_listing_credits',coalesce(lc,0),
    'featured_market_boosts',coalesce(mb,0),'next_milestone',case when q<3 then 3 when q<5 then 5 when q<10 then 10 when q<25 then 25 when q<50 then 50 else null end,
    'active_market_boost_until',(select max(ends_at) from public.market_featured_boosts where market_id=v_market and status='ACTIVE' and ends_at>now()),
    'buyer_reward_policy','DEFERRED_UNTIL_SELLER','rewards',coalesce((select jsonb_agg(jsonb_build_object(
      'milestone',milestone,'type',reward_type,'quantity',quantity,'status',status,'created_at',created_at) order by created_at desc)
      from public.referral_reward_ledger where beneficiary_user_id=uid),'[]'::jsonb));
end $$;
revoke all on function public.my_referral_program() from public,anon;
grant execute on function public.my_referral_program() to authenticated;

create or replace function public.redeem_market_featured_boost()
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); v_market uuid; v_credit uuid; v_boost uuid; v_start timestamptz;
begin
  select id into v_market from public.markets where owner_id=uid and status='active' for update;
  if v_market is null then raise exception 'ACTIVE_MARKET_REQUIRED'; end if;
  perform 1 from public.market_featured_boost_credits where market_id=v_market for update;
  if coalesce((select sum(delta) from public.market_featured_boost_credits where market_id=v_market),0)<=0 then raise exception 'NO_MARKET_BOOST_CREDITS'; end if;
  v_start:=greatest(now(),coalesce((select max(ends_at) from public.market_featured_boosts where market_id=v_market and status='ACTIVE'),now()));
  insert into public.market_featured_boost_credits(market_id,delta,reason,source,created_by)
  values(v_market,-1,'Featured Market Boost activated','CONSUMED',uid) returning id into v_credit;
  insert into public.market_featured_boosts(market_id,starts_at,ends_at,source_credit_id)
  values(v_market,v_start,v_start+interval '7 days',v_credit) returning id into v_boost;
  return jsonb_build_object('boost_id',v_boost,'starts_at',v_start,'ends_at',v_start+interval '7 days');
end $$;
revoke all on function public.redeem_market_featured_boost() from public,anon;
grant execute on function public.redeem_market_featured_boost() to authenticated;

create or replace function public.admin_referral_growth_summary()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not (public.admin_has_perm('marketing.view') or public.admin_is_owner()) then raise exception 'NOT_AUTHORIZED'; end if;
  return jsonb_build_object(
    'attributed',(select count(*) from public.referral_attributions where not is_qa),
    'qualified',(select count(*) from public.referral_attributions where status='QUALIFIED' and not is_qa),
    'pending',(select count(*) from public.referral_attributions where status='ATTRIBUTED' and not is_qa),
    'rejected',(select count(*) from public.referral_attributions where status='REJECTED' and not is_qa),
    'qualification_rate',coalesce((select round(100.0*count(*) filter(where status='QUALIFIED')/nullif(count(*),0),1) from public.referral_attributions where not is_qa),0),
    'listing_credits_issued',coalesce((select sum(quantity) from public.referral_reward_ledger where reward_type='FEATURED_LISTING_CREDIT' and status='ISSUED'),0),
    'pro_days_issued',coalesce((select sum(quantity) from public.referral_reward_ledger where reward_type='COMPLIMENTARY_PRO_DAYS' and status='ISSUED'),0),
    'market_boosts_issued',coalesce((select sum(quantity) from public.referral_reward_ledger where reward_type='FEATURED_MARKET_BOOST' and status='ISSUED'),0),
    'buyer_rewards_deferred',(select count(*) from public.referral_reward_ledger where status='DEFERRED'),
    'milestone_25',(select count(*) from public.referral_reward_ledger where milestone=25 and status='TRACKED'),
    'milestone_50',(select count(*) from public.referral_reward_ledger where milestone=50 and status='TRACKED'),
    'payments_live_enabled',(select payments_live_enabled from public.billing_config limit 1),
    'generated_at',now());
end $$;
revoke all on function public.admin_referral_growth_summary() from public,anon;
grant execute on function public.admin_referral_growth_summary() to authenticated;

create or replace function public.admin_referral_growth_rows()
returns table(referrer_id uuid,referrer_name text,qualified_sellers bigint,pending_referrals bigint,rewards_issued bigint,deferred_rewards bigint)
language sql stable security definer set search_path=public as $$
  select a.referrer_user_id,p.name,
    count(*) filter(where a.status='QUALIFIED'),count(*) filter(where a.status='ATTRIBUTED'),
    (select count(*) from public.referral_reward_ledger r where r.referrer_user_id=a.referrer_user_id and r.status='ISSUED'),
    (select count(*) from public.referral_reward_ledger r where r.referrer_user_id=a.referrer_user_id and r.status='DEFERRED')
  from public.referral_attributions a join public.profiles p on p.id=a.referrer_user_id
  where not a.is_qa and (public.admin_has_perm('marketing.view') or public.admin_is_owner())
  group by a.referrer_user_id,p.name order by 3 desc,4 desc;
$$;
revoke all on function public.admin_referral_growth_rows() from public,anon;
grant execute on function public.admin_referral_growth_rows() to authenticated;

create or replace function public.referral_growth_summary_service()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'attributed',(select count(*) from public.referral_attributions where not is_qa),
    'qualified',(select count(*) from public.referral_attributions where status='QUALIFIED' and not is_qa),
    'pending',(select count(*) from public.referral_attributions where status='ATTRIBUTED' and not is_qa),
    'rejected',(select count(*) from public.referral_attributions where status='REJECTED' and not is_qa),
    'qualification_rate',coalesce((select round(100.0*count(*) filter(where status='QUALIFIED')/nullif(count(*),0),1) from public.referral_attributions where not is_qa),0),
    'listing_credits_issued',coalesce((select sum(quantity) from public.referral_reward_ledger where reward_type='FEATURED_LISTING_CREDIT' and status='ISSUED'),0),
    'pro_days_issued',coalesce((select sum(quantity) from public.referral_reward_ledger where reward_type='COMPLIMENTARY_PRO_DAYS' and status='ISSUED'),0),
    'market_boosts_issued',coalesce((select sum(quantity) from public.referral_reward_ledger where reward_type='FEATURED_MARKET_BOOST' and status='ISSUED'),0),
    'buyer_rewards_deferred',(select count(*) from public.referral_reward_ledger where status='DEFERRED'),
    'milestone_25',(select count(*) from public.referral_reward_ledger where milestone=25 and status='TRACKED'),
    'milestone_50',(select count(*) from public.referral_reward_ledger where milestone=50 and status='TRACKED'),
    'payments_live_enabled',(select payments_live_enabled from public.billing_config limit 1),
    'generated_at',now());
$$;
revoke all on function public.referral_growth_summary_service() from public,anon,authenticated;
grant execute on function public.referral_growth_summary_service() to service_role;

-- ---------------------------------------------------------------------------
-- 6. Gemma growth operations, Marty analytics, and Zordy reporting
-- ---------------------------------------------------------------------------
insert into public.ai_agents(id,name,status,provider,model,automation_level,permissions,daily_budget_cents,
  title,department,reports_to,authority_level,charter)
select 'gemma','Gemma','read_only','gemini','gemini-2.5-flash-lite',1,
  array['get_referral_growth_summary','get_promo_effectiveness'],0,
  'Growth Operations','MARKETING','gnome_hq','RECOMMEND',
  'Runs referral and promotion operations from real aggregate data. Reports attribution, qualification, exact-once rewards, deferred buyer rewards and fraud signals without inventing metrics.'
where not exists(select 1 from public.ai_agents where id='gemma');

insert into public.ai_agents(id,name,status,provider,model,automation_level,permissions,daily_budget_cents,
  title,department,reports_to,authority_level,charter)
select 'marty','Marty','read_only','gemini','gemini-2.5-flash-lite',1,
  array['get_referral_growth_summary','get_promo_effectiveness'],0,
  'Growth Analytics','MARKETING','gnome_hq','RECOMMEND',
  'Measures referral and promotion effectiveness from aggregate conversion data, distinguishes zero from unknown, excludes QA, and never fabricates attribution or GMV.'
where not exists(select 1 from public.ai_agents where id='marty');

-- Backstop invariants.
do $$ begin
  if coalesce((select payments_live_enabled from public.billing_config limit 1),false) then
    raise exception 'REFERRALS_REFUSE_WHILE_PAYMENTS_LIVE';
  end if;
  if exists(select 1 from public.promotion_campaigns where conversion_behavior='NO_AUTO_CONVERSION' and payment_method_required) then
    raise exception 'NO_AUTO_PROMO_CANNOT_REQUIRE_PAYMENT_METHOD';
  end if;
end $$;

notify pgrst,'reload schema';
