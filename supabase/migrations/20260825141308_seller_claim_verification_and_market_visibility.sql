-- Close the Seller Concierge email-claim redirect and public-Market exposure
-- defects found during the 2026-08-25 disposable production QA.
--
-- Preconditions: P0 account readiness and Seller Concierge are applied first.
-- This migration does not rewrite existing Market statuses or listing data.

begin;

-- A Concierge invitation is delivered only to the invited mailbox. Once an
-- authenticated OTP/OAuth session presents that one-time token, retain a
-- private server-side proof for the exact current auth email. This is not a
-- client profile flag and becomes stale automatically if the auth email changes.
create table if not exists public.account_email_verification_proofs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  verified_email text not null check (verified_email = lower(btrim(verified_email))),
  verification_method text not null check (
    verification_method in ('CONCIERGE_MAGIC_LINK', 'AUTH_PROVIDER')
  ),
  concierge_invite_id uuid unique references public.seller_concierge_invites(id) on delete set null,
  verified_at timestamptz not null default now()
);

comment on table public.account_email_verification_proofs is
  'Private server-issued mailbox proof. Never writable by a client and never a substitute for Auth verification without OTP/provider evidence.';

alter table public.account_email_verification_proofs enable row level security;
revoke all on public.account_email_verification_proofs from public, anon, authenticated;

create or replace function public.verify_concierge_email(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_hash text;
  v_invite public.seller_concierge_invites;
  v_email text;
  v_suspended boolean;
  v_amr jsonb := coalesce(auth.jwt() -> 'amr', '[]'::jsonb);
  v_otp_session boolean := false;
  v_provider_verified boolean := false;
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_token is null or length(p_token) < 32 or length(p_token) > 256 then
    raise exception 'INVALID_INVITE' using errcode = 'P0001';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select * into v_invite
  from public.seller_concierge_invites
  where token_hash = v_hash
  for update;

  if v_invite is null
     or v_invite.status not in ('SENT', 'OPENED')
     or v_invite.expires_at <= now() then
    raise exception 'INVALID_OR_EXPIRED_INVITE' using errcode = 'P0001';
  end if;

  select lower(u.email), coalesce(p.suspended, false)
    into v_email, v_suspended
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id = v_user and u.email_confirmed_at is not null;

  if v_email is null then
    raise exception 'VERIFIED_EMAIL_REQUIRED' using errcode = 'P0001';
  end if;
  if v_suspended then
    raise exception 'ACCOUNT_SUSPENDED' using errcode = 'P0001';
  end if;
  if v_email is distinct from v_invite.email then
    raise exception 'INVITE_EMAIL_MISMATCH' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_amr) = 'array' then
    select exists (
      select 1
      from jsonb_array_elements(v_amr) entry
      where entry ->> 'method' in ('otp', 'magiclink')
    ) into v_otp_session;
  end if;

  select exists (
    select 1
    from auth.identities i
    where i.user_id = v_user
      and lower(coalesce(i.identity_data ->> 'email', v_email)) = v_email
      and lower(coalesce(i.identity_data ->> 'email_verified', 'false')) = 'true'
  ) into v_provider_verified;

  if not v_otp_session and not v_provider_verified then
    raise exception 'EMAIL_OTP_SESSION_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.account_email_verification_proofs as proof
    (user_id, verified_email, verification_method, concierge_invite_id, verified_at)
  values (
    v_user,
    v_email,
    case when v_otp_session then 'CONCIERGE_MAGIC_LINK' else 'AUTH_PROVIDER' end,
    v_invite.id,
    now()
  )
  on conflict (user_id) do update set
    verified_email = excluded.verified_email,
    verification_method = excluded.verification_method,
    concierge_invite_id = excluded.concierge_invite_id,
    verified_at = now();

  update public.seller_concierge_invites
  set status = 'OPENED', opened_at = coalesce(opened_at, now())
  where id = v_invite.id and status = 'SENT';

  return jsonb_build_object('verified', true, 'email', v_email, 'invite_id', v_invite.id);
end;
$$;

revoke all on function public.verify_concierge_email(text) from public, anon;
grant execute on function public.verify_concierge_email(text) to authenticated;

-- Launch readiness remains email + 18+ + current Terms, Privacy, and
-- Marketplace Rules. Phone is reported for future trust work but is not gated.
create or replace function public.account_readiness_for_user(p_user uuid)
returns table (
  user_id uuid,
  email_verified boolean,
  phone_verified boolean,
  age_confirmed boolean,
  terms_accepted boolean,
  privacy_accepted boolean,
  marketplace_rules_accepted boolean,
  account_ready boolean,
  missing text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with u as (
    select id, lower(email) as email, phone, email_confirmed_at, phone_confirmed_at
    from auth.users
    where id = p_user
  ),
  v as (
    select * from public.account_policy_versions where id is true
  ),
  a as (
    select * from public.account_policy_acceptances where user_id = p_user
  ),
  checks as (
    select
      p_user as user_id,
      (
        exists (select 1 from u where email_confirmed_at is not null)
        and (
          exists (
            select 1
            from auth.identities i
            where i.user_id = p_user
              and lower(coalesce(i.identity_data ->> 'email_verified', 'false')) = 'true'
          )
          or exists (
            select 1
            from public.account_email_verification_proofs proof
            join u on u.email = proof.verified_email
            where proof.user_id = p_user
          )
        )
      ) as email_verified,
      exists (
        select 1 from u
        where nullif(phone, '') is not null and phone_confirmed_at is not null
      ) as phone_verified,
      exists (select 1 from a, v where a.age_confirmed_18 and a.age_policy_version = v.age_policy_version) as age_confirmed,
      exists (select 1 from a, v where a.terms_version = v.terms_version) as terms_accepted,
      exists (select 1 from a, v where a.privacy_version = v.privacy_version) as privacy_accepted,
      exists (select 1 from a, v where a.marketplace_rules_version = v.marketplace_rules_version) as marketplace_rules_accepted
  )
  select
    c.user_id,
    c.email_verified,
    c.phone_verified,
    c.age_confirmed,
    c.terms_accepted,
    c.privacy_accepted,
    c.marketplace_rules_accepted,
    (c.email_verified and c.age_confirmed
      and c.terms_accepted and c.privacy_accepted and c.marketplace_rules_accepted) as account_ready,
    array_remove(array[
      case when not c.email_verified then 'verified_email' end,
      case when not c.age_confirmed then 'age_18' end,
      case when not c.terms_accepted then 'terms' end,
      case when not c.privacy_accepted then 'privacy' end,
      case when not c.marketplace_rules_accepted then 'marketplace_rules' end
    ], null) as missing
  from checks c;
$$;

-- Keep the final claim transaction strict even if a profile is suspended after
-- it proves its mailbox or completes policy acceptance.
create or replace function public.claim_prepared_market(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid:=auth.uid(); h text; inv public.seller_concierge_invites; c public.seller_concierge_cases;
  auth_email text; email_ok boolean; mkt uuid; payload jsonb; created jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if exists(select 1 from public.profiles where id=uid and suspended) then raise exception 'ACCOUNT_SUSPENDED'; end if;
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

-- Future profiles receive a private Market shell. Existing Market statuses are
-- deliberately untouched.
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mid uuid := gen_random_uuid();
  nm text := coalesce(nullif(trim(new.name), ''), 'Neighbor') || '''s Market';
begin
  insert into public.markets (id, owner_id, name, slug, status)
  values (mid, new.id, nm, public.gnome_slugify(nm) || '-' || substr(mid::text, 1, 8), 'paused');

  insert into public.market_members (market_id, user_id, role)
  values (mid, new.id, 'owner')
  on conflict (market_id, user_id) do nothing;

  insert into public.events (event_type, user_id, metadata)
  values ('market_created', new.id, jsonb_build_object('market_id', mid, 'initial_status', 'paused'));

  return new;
end;
$$;

create or replace function public.activate_ready_market_on_first_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' and new.market_id is not null
     and public.account_is_ready(new.owner_id)
     and exists(select 1 from public.profiles p where p.id=new.owner_id and not coalesce(p.suspended,false)) then
    update public.markets
    set status='active'
    where id=new.market_id and owner_id=new.owner_id and status='paused';
  end if;
  return new;
end;
$$;

drop trigger if exists activate_ready_market_on_first_publish_trg on public.listings;
create trigger activate_ready_market_on_first_publish_trg
after insert or update of status, market_id on public.listings
for each row execute function public.activate_ready_market_on_first_publish();

create or replace function public.activate_reviewed_concierge_market()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.market_reviewed_at is not null
     and (old.market_reviewed_at is null or new.market_reviewed_at is distinct from old.market_reviewed_at)
     and new.claimed_market_id is not null
     and new.claimed_by is not null
     and public.account_is_ready(new.claimed_by)
     and exists(select 1 from public.profiles p where p.id=new.claimed_by and not coalesce(p.suspended,false)) then
    update public.markets
    set status='active'
    where id=new.claimed_market_id and owner_id=new.claimed_by and status='paused';
  end if;
  return new;
end;
$$;

drop trigger if exists activate_reviewed_concierge_market_trg on public.seller_concierge_cases;
create trigger activate_reviewed_concierge_market_trg
after update of market_reviewed_at on public.seller_concierge_cases
for each row execute function public.activate_reviewed_concierge_market();

-- Suspended owners disappear from every authoritative anonymous projection.
create or replace view public.public_profiles as
select p.id,p.name,p.avatar_url,p.city,p.county,p.state,p.user_type,
  p.business_account,p.business_category,p.created_at
from public.profiles p
where not coalesce(p.suspended,false);

create or replace view public.public_listings as
select
  l.id,l.slug,l.title,l.description,l.category,l.listing_type,l.status,
  l.price_cents,l.currency,l.trade_for,l.quantity,l.unit,l.photos,
  l.city,l.county,l.state,l.fulfillment_type,l.market_id,
  m.name as market_name,m.slug as market_slug,m.avatar_url as market_avatar_url,
  m.market_type,m.verified as market_verified,l.created_at,l.expires_at,
  l.is_featured,l.featured_until,
  exists(select 1 from public.listing_promotions promo
    where promo.listing_id=l.id and promo.status='active' and promo.ends_at>now()) as has_active_promotion,
  l.approx_lat,l.approx_lng,l.is_demo,l.market_position,l.market_featured,
  l.taxonomy_node_id,l.inventory_count,l.request_options,l.allow_custom_request,
  l.is_bundle,
  (select count(*)::integer from public.listing_components component where component.listing_id=l.id) as component_count,
  l.harvest_date
from public.listings l
join public.markets m on m.id=l.market_id
join public.profiles owner_profile on owner_profile.id=m.owner_id
where l.status='active' and l.expires_at>now() and m.status='active'
  and not coalesce(owner_profile.suspended,false)
  and l.listing_type<>'wanted'
  and (not l.is_bundle or public.bundle_components_available(l.id));

create or replace view public.public_markets as
select
  m.id,m.slug,m.name,m.description,m.market_type,m.status,m.avatar_url,m.banner_url,
  m.city,m.county,m.state,m.verified,m.sponsor_visible,m.website_url,
  m.instagram_url,m.facebook_url,m.created_at,m.created_at as member_since,
  (select count(*) from public.listings l where l.market_id=m.id and l.status='active'
    and l.expires_at>now() and l.listing_type<>'wanted') as active_listing_count,
  (select count(*) from public.listings l where l.market_id=m.id and l.status='completed'
    and l.listing_type='free') as listings_shared,
  (select count(*) from public.claims claim join public.listings l on l.id=claim.listing_id
    where l.market_id=m.id and claim.claim_type='purchase_request' and claim.status='completed') as listings_sold,
  (select count(*) from public.claims claim join public.listings l on l.id=claim.listing_id
    where l.market_id=m.id and claim.claim_type='trade_offer' and claim.status='completed') as trades_completed,
  response.response_rate,
  exists(select 1 from auth.users u where u.id=m.owner_id and u.email_confirmed_at is not null) as verified_email,
  m.tagline,m.theme
from public.markets m
join public.profiles owner_profile on owner_profile.id=m.owner_id
left join lateral (
  select case when count(*)>=5 then round(100.0*count(*) filter(
    where claim.responded_at is not null and claim.responded_at<=claim.created_at+interval '48 hours')::numeric/count(*)::numeric)
    else null::numeric end as response_rate
  from public.claims claim
  join public.listings l on l.id=claim.listing_id
  where l.market_id=m.id and claim.status<>'cancelled'
) response on true
where m.status='active' and not coalesce(owner_profile.suspended,false);

create or replace view public.public_market_drops as
select d.id,d.market_id,d.title,d.description,d.starts_at,d.ends_at,d.timezone,
  public.market_drop_phase(d.status,d.starts_at,d.ends_at) as phase,
  (select count(*) from public.market_drop_items item
    join public.public_listings listing on listing.id=item.listing_id
    where item.drop_id=d.id) as available_items
from public.market_drops d
join public.markets m on m.id=d.market_id
join public.profiles owner_profile on owner_profile.id=m.owner_id
where d.status='scheduled' and d.ends_at>now()-interval '24 hours'
  and m.status='active' and not coalesce(owner_profile.suspended,false);

create or replace view public.public_active_promotions as
select promo.id,promo.listing_id,promo.market_id,promo.starts_at,promo.ends_at
from public.listing_promotions promo
join public.markets m on m.id=promo.market_id
join public.profiles owner_profile on owner_profile.id=m.owner_id
where promo.status='active' and promo.ends_at>now()
  and m.status='active' and not coalesce(owner_profile.suspended,false);

create or replace function public.public_market_stand_location(p_market uuid)
returns table(address text,directions text)
language sql stable security definer set search_path=public as $$
  select m.public_stand_address,m.public_pickup_note
  from public.markets m
  join public.profiles p on p.id=m.owner_id
  where m.id=p_market and m.status='active' and not coalesce(p.suspended,false)
    and m.location_privacy_mode='PUBLIC_STAND'
    and m.public_stand_consent_at is not null and m.public_stand_address is not null;
$$;

create or replace function public.resolve_market_qr(p_code text)
returns table (slug text, name text)
language plpgsql volatile security definer set search_path = public
as $$
declare q record;
begin
  select mq.code,mq.market_id,m.slug,m.name,m.status,coalesce(p.suspended,false) as suspended
    into q
  from public.market_qr mq
  join public.markets m on m.id=mq.market_id
  join public.profiles p on p.id=m.owner_id
  where mq.code=lower(btrim(p_code));
  if q.code is null or q.status<>'active' or q.suspended then return; end if;

  insert into public.market_qr_scans(code,market_id) values(q.code,q.market_id);
  slug:=q.slug; name:=q.name;
  return next;
end;
$$;

grant select on public.public_profiles,public.public_listings,public.public_markets,
  public.public_market_drops,public.public_active_promotions to anon,authenticated;

do $$
begin
  if exists(select 1 from public.billing_config where payments_live_enabled is true) then
    raise exception 'seller claim repair self-check: payments_live_enabled must stay false';
  end if;
  if has_table_privilege('anon','public.account_email_verification_proofs','select')
     or has_table_privilege('authenticated','public.account_email_verification_proofs','select')
     or has_table_privilege('authenticated','public.account_email_verification_proofs','insert')
     or has_table_privilege('authenticated','public.account_email_verification_proofs','update') then
    raise exception 'seller claim repair self-check: email proof table is client-accessible';
  end if;
  if has_function_privilege('anon','public.verify_concierge_email(text)','execute')
     or not has_function_privilege('authenticated','public.verify_concierge_email(text)','execute') then
    raise exception 'seller claim repair self-check: verification RPC grants are wrong';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
