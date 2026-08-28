-- Seller Concierge: private seller preparation, secure claim, explicit location
-- consent, seller-controlled assistance, and a small non-invasive funnel.
--
-- This migration does not publish a Market or listing. Prepared products become
-- ordinary listing_drafts only after an email-verified, account-ready seller
-- claims the invitation. Publication remains exclusively behind
-- publish_listing_draft and all of its existing compliance/allowance triggers.

-- ---------------------------------------------------------------------------
-- 1. Private preparation records
-- ---------------------------------------------------------------------------
create table if not exists public.seller_concierge_cases (
  id uuid primary key default gen_random_uuid(),
  business_name text not null check (length(btrim(business_name)) between 2 and 120),
  seller_name text,
  invited_email text,
  status text not null default 'PREPARED' check (status in (
    'PREPARED','INVITED','CLAIMED','NEEDS_INFO','NEEDS_COMPLIANCE',
    'READY','ACTIVE','DECLINED','EXPIRED')),
  market_profile jsonb not null default '{}',
  market_model text not null default 'RESERVATION' check (market_model in ('RESERVATION','SELF_SERVE','BOTH')),
  location_mode text not null default 'APPROXIMATE' check (location_mode in ('PRIVATE_PICKUP','APPROXIMATE','PUBLIC_STAND')),
  prepared_by uuid not null references public.profiles(id),
  primary_agent text not null default 'boon',
  claimed_by uuid references public.profiles(id),
  claimed_market_id uuid references public.markets(id),
  invited_at timestamptz,
  invite_opened_at timestamptz,
  claimed_at timestamptz,
  account_ready_at timestamptz,
  market_reviewed_at timestamptz,
  first_listing_published_at timestamptz,
  active_seller_at timestamptz,
  declined_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (invited_email is null or invited_email = lower(btrim(invited_email)))
);
create index if not exists seller_concierge_status_idx
  on public.seller_concierge_cases(status, updated_at desc);
create unique index if not exists seller_concierge_one_open_email_idx
  on public.seller_concierge_cases(lower(invited_email))
  where invited_email is not null and status not in ('DECLINED','EXPIRED','ACTIVE');

create table if not exists public.seller_concierge_sources (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.seller_concierge_cases(id) on delete cascade,
  source_type text not null check (source_type in (
    'SELLER_PROVIDED','ADMIN_ENTERED','FACEBOOK_SCREENSHOT','PUBLIC_WEBSITE',
    'PUBLIC_SOCIAL_POST','AI_EXTRACTED','AI_INFERRED','OTHER')),
  label text not null,
  source_url text,
  content_fingerprint text,
  extraction_request_id uuid,
  extracted_fields jsonb not null default '{}',
  inferred_fields jsonb not null default '{}',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (source_url is null or length(source_url) <= 1000),
  check (length(label) between 1 and 160)
);

create table if not exists public.seller_concierge_drafts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.seller_concierge_cases(id) on delete cascade,
  source_id uuid references public.seller_concierge_sources(id) on delete set null,
  candidate_index int not null check (candidate_index between 0 and 39),
  candidate jsonb not null,
  status text not null check (status in ('READY','NEEDS_INFO','NEEDS_COMPLIANCE','REJECTED','CLAIMED')),
  source_attribution text not null,
  field_origins jsonb not null default '{}',
  missing_information text[] not null default '{}',
  compliance_attention boolean not null default false,
  seller_confirmed_at timestamptz,
  seller_rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(case_id, candidate_index)
);
create index if not exists seller_concierge_drafts_case_idx
  on public.seller_concierge_drafts(case_id, status);

create table if not exists public.seller_concierge_invites (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.seller_concierge_cases(id) on delete cascade,
  email text not null,
  token_hash text not null unique check (length(token_hash) = 64),
  status text not null default 'SENT' check (status in ('SENT','OPENED','CLAIMED','REVOKED','EXPIRED')),
  sent_by uuid not null references public.profiles(id),
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  claimed_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  unique(case_id, id),
  check (email = lower(btrim(email)))
);
create index if not exists seller_concierge_invites_case_idx
  on public.seller_concierge_invites(case_id, sent_at desc);

-- Link the resulting ordinary drafts back to their preparation provenance.
alter table public.listing_drafts
  add column if not exists concierge_case_id uuid references public.seller_concierge_cases(id) on delete set null,
  add column if not exists source_attribution text,
  add column if not exists field_origins jsonb,
  add column if not exists seller_confirmed_at timestamptz;

-- Public-stand details stay private at the base-table layer. The explicit RPC
-- below is the only anonymous projection and returns a value only after seller
-- consent. New columns are private by default because 0093 uses column grants.
alter table public.markets
  add column if not exists concierge_market_model text not null default 'RESERVATION',
  add column if not exists location_privacy_mode text not null default 'APPROXIMATE',
  add column if not exists public_stand_address text,
  add column if not exists public_stand_consent_at timestamptz,
  add column if not exists public_stand_consent_version text;

do $$ begin
  alter table public.markets add constraint markets_concierge_model_chk
    check (concierge_market_model in ('RESERVATION','SELF_SERVE','BOTH'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.markets add constraint markets_location_privacy_chk
    check (location_privacy_mode in ('PRIVATE_PICKUP','APPROXIMATE','PUBLIC_STAND'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.markets add constraint markets_public_stand_consent_chk check (
    (location_privacy_mode = 'PUBLIC_STAND' and public_stand_address is not null and public_stand_consent_at is not null)
    or (location_privacy_mode <> 'PUBLIC_STAND' and public_stand_address is null and public_stand_consent_at is null)
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Seller-controlled assistance and proposals
-- ---------------------------------------------------------------------------
create table if not exists public.market_assistance_authorizations (
  market_id uuid primary key references public.markets(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  level text not null default 'OFF' check (level in ('OFF','SUPPORT','MANAGED')),
  allowed_actions text[] not null default '{}',
  consent_version text not null default '2026-08-25',
  consented_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  check (level = 'MANAGED' or cardinality(allowed_actions) = 0)
);

create table if not exists public.market_assistance_actions (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  proposed_by uuid not null references public.profiles(id),
  agent_id text,
  action text not null check (action in (
    'CREATE_LISTING_DRAFT','EDIT_MARKET_DESCRIPTION','UPDATE_LISTING_QUANTITY',
    'PAUSE_LISTING','MARK_SOLD_OUT','UPDATE_HOURS','PREPARE_PROMOTION')),
  payload jsonb not null default '{}',
  status text not null default 'PROPOSED' check (status in ('PROPOSED','APPROVED','REJECTED','EXECUTED','FAILED','CANCELLED')),
  seller_reviewed_at timestamptz,
  executed_by uuid references public.profiles(id),
  executed_at timestamptz,
  execution_result jsonb,
  reason text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. RLS: no direct client writes, minimum reads only
-- ---------------------------------------------------------------------------
alter table public.seller_concierge_cases enable row level security;
alter table public.seller_concierge_sources enable row level security;
alter table public.seller_concierge_drafts enable row level security;
alter table public.seller_concierge_invites enable row level security;
alter table public.market_assistance_authorizations enable row level security;
alter table public.market_assistance_actions enable row level security;

create policy concierge_cases_admin_read on public.seller_concierge_cases
  for select using (public.admin_has_perm('markets.view'));
create policy concierge_cases_seller_read on public.seller_concierge_cases
  for select using (claimed_by = auth.uid());
create policy concierge_sources_admin_read on public.seller_concierge_sources
  for select using (public.admin_has_perm('markets.view'));
create policy concierge_sources_seller_read on public.seller_concierge_sources
  for select using (exists (select 1 from public.seller_concierge_cases c where c.id = case_id and c.claimed_by = auth.uid()));
create policy concierge_drafts_admin_read on public.seller_concierge_drafts
  for select using (public.admin_has_perm('markets.view'));
create policy concierge_drafts_seller_read on public.seller_concierge_drafts
  for select using (exists (select 1 from public.seller_concierge_cases c where c.id = case_id and c.claimed_by = auth.uid()));
create policy concierge_invites_admin_read on public.seller_concierge_invites
  for select using (public.admin_has_perm('markets.view'));
create policy assistance_authorization_seller_read on public.market_assistance_authorizations
  for select using (seller_id = auth.uid());
create policy assistance_authorization_admin_read on public.market_assistance_authorizations
  for select using (public.admin_has_perm('markets.view'));
create policy assistance_actions_seller_read on public.market_assistance_actions
  for select using (seller_id = auth.uid());
create policy assistance_actions_admin_read on public.market_assistance_actions
  for select using (public.admin_has_perm('markets.view'));

revoke all on public.seller_concierge_cases, public.seller_concierge_sources,
  public.seller_concierge_drafts, public.seller_concierge_invites,
  public.market_assistance_authorizations, public.market_assistance_actions
  from anon, authenticated;
grant select on public.seller_concierge_cases, public.seller_concierge_sources,
  public.seller_concierge_drafts, public.seller_concierge_invites,
  public.market_assistance_authorizations, public.market_assistance_actions
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Admin preparation API
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_concierge_case(
  p_business_name text, p_email text default null, p_seller_name text default null,
  p_market_profile jsonb default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_email text;
begin
  if not (public.admin_has_perm('markets.edit') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  v_email := nullif(lower(btrim(coalesce(p_email,''))), '');
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_market_profile,'{}')) <> 'object' then
    raise exception 'INVALID_MARKET_PROFILE' using errcode = 'P0001';
  end if;
  insert into public.seller_concierge_cases
    (business_name, invited_email, seller_name, market_profile, prepared_by)
  values (btrim(p_business_name), v_email, nullif(btrim(coalesce(p_seller_name,'')),''),
          coalesce(p_market_profile,'{}'), auth.uid()) returning id into v_id;
  perform public.admin_audit('CONCIERGE_PREPARED','seller_concierge_case',v_id::text,null,
    jsonb_build_object('business_name',btrim(p_business_name),'email_set',v_email is not null),
    'Seller preparation created');
  return v_id;
end $$;

create or replace function public.admin_save_concierge_extraction(
  p_case uuid, p_request uuid, p_source_type text, p_source_label text,
  p_source_url text, p_extraction jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.seller_concierge_cases; s_id uuid; n int; i int; cand jsonb;
  draft_status text; ready_n int := 0; info_n int := 0; compliance_n int := 0;
  allowed_source constant text[] := array['SELLER_PROVIDED','ADMIN_ENTERED','FACEBOOK_SCREENSHOT','PUBLIC_WEBSITE','PUBLIC_SOCIAL_POST','AI_EXTRACTED','AI_INFERRED','OTHER'];
begin
  if not (public.admin_has_perm('markets.edit') or public.admin_is_owner()) then raise exception 'NOT_AUTHORIZED'; end if;
  select * into c from public.seller_concierge_cases where id = p_case for update;
  if c is null then raise exception 'CASE_NOT_FOUND'; end if;
  if c.claimed_at is not null then raise exception 'CASE_ALREADY_CLAIMED'; end if;
  if not (p_source_type = any(allowed_source)) then raise exception 'INVALID_SOURCE_TYPE'; end if;
  if jsonb_typeof(p_extraction) <> 'object' or jsonb_typeof(p_extraction->'candidates') <> 'array' then
    raise exception 'INVALID_EXTRACTION';
  end if;
  n := jsonb_array_length(p_extraction->'candidates');
  if n < 1 or n > 40 then raise exception 'INVALID_CANDIDATE_COUNT'; end if;

  insert into public.seller_concierge_sources
    (case_id,source_type,label,source_url,content_fingerprint,extraction_request_id,extracted_fields,created_by)
  values (p_case,p_source_type,left(btrim(p_source_label),160),nullif(btrim(coalesce(p_source_url,'')),''),
    encode(extensions.digest(p_extraction::text,'sha256'),'hex'),p_request,
    jsonb_build_object('source_type',p_extraction->'source_type','overall_confidence',p_extraction->'overall_confidence'),auth.uid())
  returning id into s_id;

  for i in 0..n-1 loop
    cand := p_extraction->'candidates'->i;
    if jsonb_typeof(cand) <> 'object' or nullif(btrim(cand->>'product_name'),'') is null then
      raise exception 'INVALID_CANDIDATE' using hint = i::text;
    end if;
    draft_status := case
      when coalesce((cand->>'compliance_attention_required')::boolean,false) then 'NEEDS_COMPLIANCE'
      when coalesce(cand->>'proposed_listing_type','sale') = 'sale'
       and (cand->'price_cents' is null or jsonb_typeof(cand->'price_cents')='null' or nullif(btrim(cand->>'unit'),'') is null)
        then 'NEEDS_INFO'
      else 'READY' end;
    insert into public.seller_concierge_drafts
      (case_id,source_id,candidate_index,candidate,status,source_attribution,field_origins,missing_information,compliance_attention)
    values (p_case,s_id,i,cand,draft_status,'AI_EXTRACTED',
      jsonb_build_object('default','AI_EXTRACTED','source_id',s_id),
      coalesce(array(select jsonb_array_elements_text(coalesce(p_extraction->'missing_information','[]'))),'{}'),
      coalesce((cand->>'compliance_attention_required')::boolean,false))
    on conflict (case_id,candidate_index) do update set
      source_id=excluded.source_id,candidate=excluded.candidate,status=excluded.status,
      source_attribution=excluded.source_attribution,field_origins=excluded.field_origins,
      missing_information=excluded.missing_information,compliance_attention=excluded.compliance_attention,updated_at=now();
    if draft_status='READY' then ready_n:=ready_n+1;
    elsif draft_status='NEEDS_INFO' then info_n:=info_n+1;
    else compliance_n:=compliance_n+1; end if;
  end loop;
  update public.seller_concierge_cases set status=case when compliance_n>0 then 'NEEDS_COMPLIANCE' when info_n>0 then 'NEEDS_INFO' else 'READY' end,updated_at=now() where id=p_case;
  perform public.admin_audit('CONCIERGE_EXTRACTION_SAVED','seller_concierge_case',p_case::text,null,
    jsonb_build_object('source_id',s_id,'candidates',n,'ready',ready_n,'needs_info',info_n,'needs_compliance',compliance_n),
    'Boon extraction saved','AI_AGENT');
  return jsonb_build_object('source_id',s_id,'total',n,'ready',ready_n,'needs_info',info_n,'needs_compliance',compliance_n);
end $$;

create or replace function public.admin_concierge_cases()
returns table(id uuid,business_name text,seller_name text,invited_email text,status text,
  market_model text,location_mode text,total_drafts bigint,ready bigint,needs_info bigint,
  needs_compliance bigint,invited_at timestamptz,claimed_at timestamptz,claimed_market_id uuid,updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id,c.business_name,c.seller_name,c.invited_email,c.status,c.market_model,c.location_mode,
    count(d.*),count(*) filter(where d.status='READY'),count(*) filter(where d.status='NEEDS_INFO'),
    count(*) filter(where d.status='NEEDS_COMPLIANCE'),c.invited_at,c.claimed_at,c.claimed_market_id,c.updated_at
  from public.seller_concierge_cases c left join public.seller_concierge_drafts d on d.case_id=c.id
  where public.admin_has_perm('markets.view')
  group by c.id order by c.updated_at desc;
$$;

-- Called by the invite edge function through the signed-in admin client. Only
-- a SHA-256 hash enters Postgres; the raw token exists only in the email URL.
create or replace function public.admin_prepare_concierge_invite(
  p_case uuid,p_email text,p_token_hash text,p_expires timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare c public.seller_concierge_cases; v_id uuid; v_email text; sent_today int;
begin
  if not (public.admin_has_perm('markets.edit') or public.admin_is_owner()) then raise exception 'NOT_AUTHORIZED'; end if;
  v_email:=lower(btrim(coalesce(p_email,'')));
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'INVALID_EMAIL'; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_TOKEN_HASH'; end if;
  if p_expires <= now() or p_expires > now()+interval '14 days' then raise exception 'INVALID_EXPIRATION'; end if;
  select * into c from public.seller_concierge_cases where id=p_case for update;
  if c is null then raise exception 'CASE_NOT_FOUND'; end if;
  if c.claimed_at is not null then raise exception 'CASE_ALREADY_CLAIMED'; end if;
  select count(*) into sent_today from public.seller_concierge_invites where case_id=p_case and sent_at>now()-interval '24 hours';
  if sent_today>=5 then raise exception 'INVITE_RATE_LIMITED'; end if;
  update public.seller_concierge_invites set status='REVOKED',revoked_at=now()
   where case_id=p_case and status in ('SENT','OPENED');
  insert into public.seller_concierge_invites(case_id,email,token_hash,sent_by,expires_at)
  values(p_case,v_email,p_token_hash,auth.uid(),p_expires) returning id into v_id;
  update public.seller_concierge_cases set invited_email=v_email,status='INVITED',invited_at=now(),expires_at=p_expires,updated_at=now() where id=p_case;
  perform public.admin_audit('CONCIERGE_INVITE_PREPARED','seller_concierge_case',p_case::text,null,
    jsonb_build_object('invite_id',v_id,'expires_at',p_expires),'Secure invitation prepared');
  return v_id;
end $$;

-- Token-possession preview: minimal data only, no email, source material or
-- internal notes. It also records an opened funnel event once.
create or replace function public.concierge_claim_preview(p_token text)
returns table(case_id uuid,business_name text,status text,total_drafts bigint,ready bigint,needs_info bigint,needs_compliance bigint,expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare h text;
begin
  if p_token is null or length(p_token)<32 or length(p_token)>256 then return; end if;
  h:=encode(extensions.digest(p_token,'sha256'),'hex');
  update public.seller_concierge_invites set status='OPENED',opened_at=coalesce(opened_at,now())
   where token_hash=h and status='SENT' and expires_at>now();
  update public.seller_concierge_cases c set invite_opened_at=coalesce(c.invite_opened_at,now()),updated_at=now()
   where exists(select 1 from public.seller_concierge_invites i where i.case_id=c.id and i.token_hash=h and i.status in ('OPENED','CLAIMED') and i.expires_at>now());
  return query select c.id,c.business_name,c.status,count(d.*),count(*) filter(where d.status='READY'),
    count(*) filter(where d.status='NEEDS_INFO'),count(*) filter(where d.status='NEEDS_COMPLIANCE'),i.expires_at
  from public.seller_concierge_invites i join public.seller_concierge_cases c on c.id=i.case_id
  left join public.seller_concierge_drafts d on d.case_id=c.id
  where i.token_hash=h and i.status in ('SENT','OPENED') and i.expires_at>now()
  group by c.id,i.expires_at;
end $$;

create or replace function public.claim_prepared_market(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid:=auth.uid(); h text; inv public.seller_concierge_invites; c public.seller_concierge_cases;
  auth_email text; email_ok boolean; mkt uuid; payload jsonb; created jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_token is null or length(p_token)<32 or length(p_token)>256 then raise exception 'INVALID_INVITE'; end if;
  h:=encode(extensions.digest(p_token,'sha256'),'hex');
  select * into inv from public.seller_concierge_invites where token_hash=h for update;
  if inv is null or inv.status not in ('SENT','OPENED') or inv.expires_at<=now() then raise exception 'INVALID_OR_EXPIRED_INVITE'; end if;
  select * into c from public.seller_concierge_cases where id=inv.case_id for update;
  if c.claimed_by is not null then raise exception 'MARKET_ALREADY_CLAIMED'; end if;
  select lower(email),email_confirmed_at is not null into auth_email,email_ok from auth.users where id=uid;
  if not coalesce(email_ok,false) then raise exception 'VERIFIED_EMAIL_REQUIRED'; end if;
  if auth_email is distinct from inv.email then raise exception 'INVITE_EMAIL_MISMATCH'; end if;
  if not public.account_is_ready(uid) then raise exception 'ACCOUNT_NOT_READY'; end if;
  select id into mkt from public.markets where owner_id=uid order by created_at limit 1;
  if mkt is null then raise exception 'NO_MARKET'; end if;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'product_name',d.candidate->>'product_name','variety',coalesce(d.candidate->>'variety',''),
    'category_terms',coalesce(d.candidate->'category_terms','[]'::jsonb),
    'listing_type',coalesce(d.candidate->>'proposed_listing_type','sale'),
    'price_cents',d.candidate->'price_cents','unit',coalesce(d.candidate->>'unit',''),
    'quantity',coalesce(d.candidate->>'quantity',''),'availability',coalesce(d.candidate->>'availability',''),
    'pickup',coalesce(d.candidate->>'pickup',''),'location_text',coalesce(d.candidate->>'location_text',''),
    'description',coalesce(d.candidate->>'description',''),'seller_notes',coalesce(d.candidate->>'seller_notes',''),
    'compliance_attention_required',d.compliance_attention)) order by d.candidate_index),'[]'::jsonb)
    into payload from public.seller_concierge_drafts d where d.case_id=c.id and d.status<>'REJECTED';
  if jsonb_array_length(payload)>0 then
    created:=public.create_import_drafts(c.id,payload);
    update public.listing_drafts ld set concierge_case_id=c.id,source_attribution=sd.source_attribution,
      field_origins=sd.field_origins
    from public.seller_concierge_drafts sd
    where ld.owner_id=uid and ld.import_request_id=c.id and sd.case_id=c.id and sd.candidate_index=ld.import_candidate_index;
  else created:=jsonb_build_object('drafts_created',0); end if;

  update public.seller_concierge_invites set status='CLAIMED',claimed_at=now() where id=inv.id;
  update public.seller_concierge_cases set claimed_by=uid,claimed_market_id=mkt,status='CLAIMED',claimed_at=now(),account_ready_at=now(),updated_at=now() where id=c.id;
  update public.seller_concierge_drafts set status='CLAIMED',seller_confirmed_at=null where case_id=c.id and status<>'REJECTED';
  insert into public.events(user_id,event_type,metadata) values(uid,'concierge_claimed',jsonb_build_object('case_id',c.id,'market_id',mkt));
  return jsonb_build_object('case_id',c.id,'market_id',mkt,'business_name',c.business_name,'drafts',created);
end $$;

-- Seller remains authoritative: this is the explicit review/confirmation step.
create or replace function public.confirm_concierge_market(
  p_case uuid,p_profile jsonb,p_public_stand_consent boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid:=auth.uid(); c public.seller_concierge_cases; k text; v_mode text; v_model text; v_address text;
  allowed constant text[]:=array['name','description','city','state','market_type','website_url','instagram_url','facebook_url','public_pickup_note','market_model','location_mode','public_stand_address'];
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if jsonb_typeof(p_profile)<>'object' then raise exception 'INVALID_PROFILE'; end if;
  for k in select jsonb_object_keys(p_profile) loop if not(k=any(allowed)) then raise exception 'UNKNOWN_FIELD' using hint=k; end if; end loop;
  select * into c from public.seller_concierge_cases where id=p_case and claimed_by=uid for update;
  if c is null then raise exception 'CLAIM_NOT_FOUND'; end if;
  v_mode:=coalesce(p_profile->>'location_mode',c.location_mode);
  v_model:=coalesce(p_profile->>'market_model',c.market_model);
  if v_mode not in ('PRIVATE_PICKUP','APPROXIMATE','PUBLIC_STAND') then raise exception 'INVALID_LOCATION_MODE'; end if;
  if v_model not in ('RESERVATION','SELF_SERVE','BOTH') then raise exception 'INVALID_MARKET_MODEL'; end if;
  v_address:=nullif(btrim(coalesce(p_profile->>'public_stand_address','')),'');
  if v_mode='PUBLIC_STAND' and (not coalesce(p_public_stand_consent,false) or v_address is null) then raise exception 'PUBLIC_STAND_CONSENT_REQUIRED'; end if;
  update public.markets set
    name=coalesce(nullif(btrim(p_profile->>'name'),''),name),description=coalesce(p_profile->>'description',description),
    city=coalesce(nullif(btrim(p_profile->>'city'),''),city),state=coalesce(nullif(upper(btrim(p_profile->>'state')),''),state),
    market_type=coalesce(nullif(p_profile->>'market_type','')::public.market_type,market_type),
    website_url=coalesce(p_profile->>'website_url',website_url),instagram_url=coalesce(p_profile->>'instagram_url',instagram_url),
    facebook_url=coalesce(p_profile->>'facebook_url',facebook_url),public_pickup_note=coalesce(p_profile->>'public_pickup_note',public_pickup_note),
    concierge_market_model=v_model,location_privacy_mode=v_mode,
    public_stand_address=case when v_mode='PUBLIC_STAND' then v_address else null end,
    public_stand_consent_at=case when v_mode='PUBLIC_STAND' then now() else null end,
    public_stand_consent_version=case when v_mode='PUBLIC_STAND' then '2026-08-25' else null end
  where id=c.claimed_market_id and owner_id=uid;
  update public.seller_concierge_cases set market_reviewed_at=now(),status=case when exists(select 1 from public.seller_concierge_drafts where case_id=p_case and compliance_attention) then 'NEEDS_COMPLIANCE' else 'READY' end,updated_at=now() where id=p_case;
  insert into public.events(user_id,event_type,metadata) values(uid,'concierge_market_reviewed',jsonb_build_object('case_id',p_case,'location_mode',v_mode,'public_stand_consent',v_mode='PUBLIC_STAND'));
  return jsonb_build_object('ok',true,'market_id',c.claimed_market_id,'location_mode',v_mode,'market_model',v_model);
end $$;

-- Ordinary draft Edit/Discard/Publish controls are the seller-review UI. Keep
-- their concierge provenance in sync without changing the canonical publisher
-- or granting an admin a seller-confirmation path.
create or replace function public.capture_concierge_draft_review() returns trigger
language plpgsql security definer set search_path=public as $$
declare changed_fields text[]:='{}';
begin
  if new.concierge_case_id is null or auth.uid() is distinct from new.owner_id then return new; end if;
  if new.title is distinct from old.title then changed_fields:=array_append(changed_fields,'title'); end if;
  if new.description is distinct from old.description then changed_fields:=array_append(changed_fields,'description'); end if;
  if new.price_cents is distinct from old.price_cents then changed_fields:=array_append(changed_fields,'price_cents'); end if;
  if new.unit is distinct from old.unit then changed_fields:=array_append(changed_fields,'unit'); end if;
  if new.quantity is distinct from old.quantity then changed_fields:=array_append(changed_fields,'quantity'); end if;
  if new.listing_type is distinct from old.listing_type then changed_fields:=array_append(changed_fields,'listing_type'); end if;
  if cardinality(changed_fields)>0 then
    new.field_origins:=coalesce(new.field_origins,'{}')||jsonb_build_object('seller_edited_fields',changed_fields,'seller_edited_at',now());
    insert into public.events(user_id,event_type,metadata) values(new.owner_id,'concierge_draft_edited',
      jsonb_build_object('case_id',new.concierge_case_id,'draft_id',new.id,'fields',changed_fields));
  end if;
  if new.status is distinct from old.status and new.status='published' then
    new.seller_confirmed_at:=now();
    update public.seller_concierge_drafts set seller_confirmed_at=now(),updated_at=now()
      where case_id=new.concierge_case_id and candidate_index=new.import_candidate_index;
    insert into public.events(user_id,event_type,metadata) values(new.owner_id,'concierge_draft_confirmed',
      jsonb_build_object('case_id',new.concierge_case_id,'draft_id',new.id,'listing_id',new.published_listing_id));
  elsif new.status is distinct from old.status and new.status='discarded' then
    update public.seller_concierge_drafts set status='REJECTED',seller_rejected_at=now(),updated_at=now()
      where case_id=new.concierge_case_id and candidate_index=new.import_candidate_index;
    insert into public.events(user_id,event_type,metadata) values(new.owner_id,'concierge_draft_rejected',
      jsonb_build_object('case_id',new.concierge_case_id,'draft_id',new.id));
  end if;
  return new;
end $$;
drop trigger if exists capture_concierge_draft_review_trg on public.listing_drafts;
create trigger capture_concierge_draft_review_trg before update on public.listing_drafts
for each row execute function public.capture_concierge_draft_review();

create or replace function public.public_market_stand_location(p_market uuid)
returns table(address text,directions text) language sql stable security definer set search_path=public as $$
  select m.public_stand_address,m.public_pickup_note from public.markets m
  where m.id=p_market and m.status='active' and m.location_privacy_mode='PUBLIC_STAND'
    and m.public_stand_consent_at is not null and m.public_stand_address is not null;
$$;

-- ---------------------------------------------------------------------------
-- 5. Assistance consent and bounded actions
-- ---------------------------------------------------------------------------
create or replace function public.set_market_assistance(p_level text,p_allowed_actions text[] default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); mkt uuid; allowed constant text[]:=array['CREATE_LISTING_DRAFT','EDIT_MARKET_DESCRIPTION','UPDATE_LISTING_QUANTITY','PAUSE_LISTING','MARK_SOLD_OUT','UPDATE_HOURS','PREPARE_PROMOTION']; a text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_level not in ('OFF','SUPPORT','MANAGED') then raise exception 'INVALID_LEVEL'; end if;
  if p_level<>'MANAGED' and cardinality(coalesce(p_allowed_actions,'{}'))>0 then raise exception 'ACTIONS_REQUIRE_MANAGED'; end if;
  foreach a in array coalesce(p_allowed_actions,'{}') loop if not(a=any(allowed)) then raise exception 'INVALID_ACTION' using hint=a; end if; end loop;
  select id into mkt from public.markets where owner_id=uid order by created_at limit 1;
  if mkt is null then raise exception 'NO_MARKET'; end if;
  insert into public.market_assistance_authorizations(market_id,seller_id,level,allowed_actions,consented_at,revoked_at)
  values(mkt,uid,p_level,case when p_level='MANAGED' then coalesce(p_allowed_actions,'{}') else '{}' end,
    case when p_level='OFF' then null else now() end,case when p_level='OFF' then now() else null end)
  on conflict(market_id) do update set level=excluded.level,allowed_actions=excluded.allowed_actions,
    consented_at=excluded.consented_at,revoked_at=excluded.revoked_at,updated_at=now();
  insert into public.events(user_id,event_type,metadata) values(uid,'market_assistance_changed',jsonb_build_object('market_id',mkt,'level',p_level,'allowed_actions',coalesce(p_allowed_actions,'{}')));
  return jsonb_build_object('market_id',mkt,'level',p_level,'allowed_actions',case when p_level='MANAGED' then coalesce(p_allowed_actions,'{}') else '{}' end);
end $$;

create or replace function public.admin_prepare_market_assistance_action(p_market uuid,p_action text,p_payload jsonb,p_reason text default null,p_agent text default 'boon')
returns uuid language plpgsql security definer set search_path=public as $$
declare authz public.market_assistance_authorizations; owner uuid; v_id uuid;
begin
  if not (public.admin_has_perm('markets.edit') or public.admin_is_owner()) then raise exception 'NOT_AUTHORIZED'; end if;
  select owner_id into owner from public.markets where id=p_market;
  if owner is null then raise exception 'MARKET_NOT_FOUND'; end if;
  select * into authz from public.market_assistance_authorizations where market_id=p_market;
  if authz is null or authz.level='OFF' then raise exception 'SELLER_ASSISTANCE_NOT_AUTHORIZED'; end if;
  if p_action not in ('CREATE_LISTING_DRAFT','EDIT_MARKET_DESCRIPTION','UPDATE_LISTING_QUANTITY','PAUSE_LISTING','MARK_SOLD_OUT','UPDATE_HOURS','PREPARE_PROMOTION') then raise exception 'ACTION_NOT_ALLOWED'; end if;
  insert into public.market_assistance_actions(market_id,seller_id,proposed_by,agent_id,action,payload,status,reason)
  values(p_market,owner,auth.uid(),p_agent,p_action,coalesce(p_payload,'{}'),
    case when authz.level='MANAGED' and p_action=any(authz.allowed_actions) then 'APPROVED' else 'PROPOSED' end,p_reason)
  returning id into v_id;
  perform public.admin_audit('MARKET_ASSISTANCE_PROPOSED','market_assistance_action',v_id::text,null,
    jsonb_build_object('market_id',p_market,'action',p_action,'level',authz.level),p_reason,case when p_agent is null then 'ADMIN' else 'AI_AGENT' end);
  return v_id;
end $$;

create or replace function public.seller_review_market_assistance_action(p_action uuid,p_approve boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.market_assistance_actions set status=case when p_approve then 'APPROVED' else 'REJECTED' end,seller_reviewed_at=now()
   where id=p_action and seller_id=auth.uid() and status='PROPOSED';
  if not found then raise exception 'ACTION_NOT_REVIEWABLE'; end if;
end $$;

create or replace function public.admin_execute_market_assistance_action(p_action uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.market_assistance_actions; authz public.market_assistance_authorizations; result jsonb:='{}'; lid uuid; k text;
begin
  if not (public.admin_has_perm('markets.edit') or public.admin_is_owner()) then raise exception 'NOT_AUTHORIZED'; end if;
  select * into a from public.market_assistance_actions where id=p_action for update;
  if a is null or a.status<>'APPROVED' then raise exception 'ACTION_NOT_APPROVED'; end if;
  select * into authz from public.market_assistance_authorizations where market_id=a.market_id;
  if authz is null or authz.level='OFF' then raise exception 'ASSISTANCE_REVOKED'; end if;
  if a.seller_reviewed_at is null and (authz.level<>'MANAGED' or not(a.action=any(authz.allowed_actions))) then raise exception 'SELLER_APPROVAL_REQUIRED'; end if;
  begin
   case a.action
    when 'EDIT_MARKET_DESCRIPTION' then
      update public.markets set description=left(a.payload->>'description',1200) where id=a.market_id;
      result:=jsonb_build_object('updated',found);
    when 'UPDATE_LISTING_QUANTITY' then
      update public.listings set quantity=left(a.payload->>'quantity',160) where id=(a.payload->>'listing_id')::uuid and market_id=a.market_id;
      result:=jsonb_build_object('updated',found);
    when 'PAUSE_LISTING' then
      update public.listings set status='paused' where id=(a.payload->>'listing_id')::uuid and market_id=a.market_id and status='active';
      result:=jsonb_build_object('paused',found);
    when 'MARK_SOLD_OUT' then
      update public.listings set status='completed' where id=(a.payload->>'listing_id')::uuid and market_id=a.market_id and status in ('active','paused');
      result:=jsonb_build_object('sold_out',found);
    when 'UPDATE_HOURS' then
      if (a.payload->>'weekday')::int not between 0 and 6 or (a.payload->>'start_minute')::int not between 0 and 1439 or (a.payload->>'end_minute')::int not between 1 and 1440 or (a.payload->>'start_minute')::int >= (a.payload->>'end_minute')::int then raise exception 'INVALID_HOURS'; end if;
      delete from public.market_pickup_hours where market_id=a.market_id and weekday=(a.payload->>'weekday')::int and location_id is null;
      insert into public.market_pickup_hours(market_id,weekday,start_minute,end_minute) values(a.market_id,(a.payload->>'weekday')::int,(a.payload->>'start_minute')::int,(a.payload->>'end_minute')::int);
      result:=jsonb_build_object('hours_updated',true);
    when 'CREATE_LISTING_DRAFT' then
      for k in select jsonb_object_keys(a.payload) loop if k not in ('title','description','listing_type','price_cents','unit','quantity') then raise exception 'UNKNOWN_DRAFT_FIELD' using hint=k; end if; end loop;
      if nullif(btrim(a.payload->>'title'),'') is null then raise exception 'TITLE_REQUIRED'; end if;
      insert into public.listing_drafts(owner_id,market_id,source,status,title,description,listing_type,price_cents,unit,quantity,compliance_attention)
      values(a.seller_id,a.market_id,'admin_assisted','pending',left(btrim(a.payload->>'title'),80),left(a.payload->>'description',600),coalesce(a.payload->>'listing_type','sale')::listing_type,
        nullif(a.payload->>'price_cents','')::int,left(a.payload->>'unit',40),left(a.payload->>'quantity',160),true) returning id into lid;
      result:=jsonb_build_object('draft_id',lid,'published',false,'compliance_review_required',true);
    when 'PREPARE_PROMOTION' then
      result:=jsonb_build_object('prepared',true,'executed',false,'note','Seller must approve and complete any paid promotion separately.');
    else raise exception 'UNSUPPORTED_ACTION';
   end case;
   update public.market_assistance_actions set status='EXECUTED',executed_by=auth.uid(),executed_at=now(),execution_result=result where id=a.id;
   perform public.admin_audit('MARKET_ASSISTANCE_EXECUTED','market_assistance_action',a.id::text,to_jsonb(a),result,a.reason);
   return result;
  exception when others then
   result:=jsonb_build_object('executed',false,'error_code',sqlstate);
   update public.market_assistance_actions set status='FAILED',executed_by=auth.uid(),executed_at=now(),execution_result=result where id=a.id and status='APPROVED';
   perform public.admin_audit('MARKET_ASSISTANCE_FAILED','market_assistance_action',a.id::text,to_jsonb(a),result,a.reason);
   return result;
  end;
end $$;

-- Funnel facts come from timestamps already needed for operations; no invasive
-- cross-device tracking or source screenshot retention is added.
create or replace function public.admin_seller_concierge_funnel()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when not public.admin_has_perm('markets.view') then null else jsonb_build_object(
    'prepared',count(*),'invited',count(*) filter(where invited_at is not null),
    'invite_opened',count(*) filter(where invite_opened_at is not null),
    'claimed',count(*) filter(where claimed_at is not null),
    'account_ready',count(*) filter(where account_ready_at is not null),
    'market_reviewed',count(*) filter(where market_reviewed_at is not null),
    'first_listing_published',count(*) filter(where first_listing_published_at is not null),
    'active_seller',count(*) filter(where active_seller_at is not null),
    'median_hours_to_claim',percentile_cont(.5) within group(order by extract(epoch from(claimed_at-created_at))/3600) filter(where claimed_at is not null),
    'median_hours_to_first_listing',percentile_cont(.5) within group(order by extract(epoch from(first_listing_published_at-created_at))/3600) filter(where first_listing_published_at is not null)
  ) end from public.seller_concierge_cases;
$$;

-- First publish updates the concierge funnel only; it never changes listing
-- behavior. Trigger errors are intentionally swallowed so analytics cannot
-- block a seller.
create or replace function public.capture_concierge_first_publish() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status='active' and (tg_op='INSERT' or old.status is distinct from new.status) then
    update public.seller_concierge_cases set first_listing_published_at=coalesce(first_listing_published_at,now()),
      active_seller_at=coalesce(active_seller_at,now()),status='ACTIVE',updated_at=now()
    where claimed_market_id=new.market_id and claimed_by=new.owner_id;
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists capture_concierge_first_publish_trg on public.listings;
create trigger capture_concierge_first_publish_trg after insert or update of status on public.listings
for each row execute function public.capture_concierge_first_publish();

-- Boon is a bounded, proposal-only marketplace officer under Zordy. The first
-- insert only fills a schema-only clean room; it never replaces an existing
-- Zordy provider configuration. Boon itself is pinned to the free Gemini path.
alter table public.ai_rooms add column if not exists context jsonb not null default '{}';
do $$ begin
  alter table public.ai_rooms add constraint ai_rooms_context_object_chk check (jsonb_typeof(context)='object');
exception when duplicate_object then null; end $$;
grant update(context) on public.ai_rooms to authenticated;

insert into public.ai_agents(id,name,status,provider,model,permissions,title,department,authority_level,charter)
values('gnome_hq','Zordy','read_only','gemini','gemini-3.6-flash',array['get_daily_summary'],
  'President of Gnome','EXEC','PROPOSE','Coordinates Gnome operations and supervised specialist agents.')
on conflict(id) do update set name='Zordy',title='President of Gnome',department='EXEC';

insert into public.ai_agents(id,name,status,provider,model,fallback_provider,fallback_model,permissions,title,department,reports_to,authority_level,charter)
select 'boon','Boon','read_only','gemini','gemini-3.5-flash-lite',null,null,
  array['get_daily_summary','list_complimentary_entitlements','create_owner_approval_request'],
  'Chief Marketplace Officer','OPERATIONS',(select id from public.ai_agents where id='gnome_hq'),'PROPOSE',
  'Seller acquisition, private Market preparation, claim readiness, and seller pipeline. Never impersonates a seller or bypasses compliance.'
on conflict(id) do update set name=excluded.name,status=excluded.status,
  permissions=(select array_agg(distinct p) from unnest(public.ai_agents.permissions||excluded.permissions) p),
  provider='gemini',model='gemini-3.5-flash-lite',fallback_provider=null,fallback_model=null,
  title=excluded.title,department=excluded.department,reports_to=excluded.reports_to,
  authority_level=excluded.authority_level,charter=excluded.charter;

revoke all on function public.admin_create_concierge_case(text,text,text,jsonb),
  public.admin_save_concierge_extraction(uuid,uuid,text,text,text,jsonb),public.admin_concierge_cases(),
  public.admin_prepare_concierge_invite(uuid,text,text,timestamptz),public.claim_prepared_market(text),
  public.confirm_concierge_market(uuid,jsonb,boolean),public.set_market_assistance(text,text[]),
  public.admin_prepare_market_assistance_action(uuid,text,jsonb,text,text),
  public.seller_review_market_assistance_action(uuid,boolean),public.admin_execute_market_assistance_action(uuid),
  public.admin_seller_concierge_funnel() from public,anon;
grant execute on function public.admin_create_concierge_case(text,text,text,jsonb),
  public.admin_save_concierge_extraction(uuid,uuid,text,text,text,jsonb),public.admin_concierge_cases(),
  public.admin_prepare_concierge_invite(uuid,text,text,timestamptz),public.claim_prepared_market(text),
  public.confirm_concierge_market(uuid,jsonb,boolean),public.set_market_assistance(text,text[]),
  public.admin_prepare_market_assistance_action(uuid,text,jsonb,text,text),
  public.seller_review_market_assistance_action(uuid,boolean),public.admin_execute_market_assistance_action(uuid),
  public.admin_seller_concierge_funnel() to authenticated;
grant execute on function public.concierge_claim_preview(text),public.public_market_stand_location(uuid) to anon,authenticated;

notify pgrst,'reload schema';
