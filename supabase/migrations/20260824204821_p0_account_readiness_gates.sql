-- P0 launch closure: authoritative account readiness + server-side gates.
--
-- This migration is local/proposed until Daniel approves production rollout.
-- It does not enable payments, alter pricing, or remove existing listings.

begin;

create table if not exists public.account_policy_versions (
  id boolean primary key default true check (id),
  terms_version text not null,
  privacy_version text not null,
  marketplace_rules_version text not null,
  age_policy_version text not null,
  marketplace_notice text not null,
  updated_at timestamptz not null default now()
);

insert into public.account_policy_versions
  (id, terms_version, privacy_version, marketplace_rules_version, age_policy_version, marketplace_notice)
values (
  true,
  '2026-08-24',
  '2026-08-24',
  '2026-08-24',
  '2026-08-24',
  'Gnome connects independent local buyers and sellers. Products are offered by independent sellers, not by Gnome. Unless specifically stated otherwise, Gnome does not manufacture, inspect, certify, guarantee, or insure seller products. Buyers should review listing details, seller information, ingredients, allergens, handling instructions, product condition, and pickup arrangements before purchasing or using an item. Payments made directly between users are at their own discretion and risk, subject to rights that cannot legally be waived. Gnome does not process or hold off-platform payments.'
)
on conflict (id) do update set
  terms_version = excluded.terms_version,
  privacy_version = excluded.privacy_version,
  marketplace_rules_version = excluded.marketplace_rules_version,
  age_policy_version = excluded.age_policy_version,
  marketplace_notice = excluded.marketplace_notice,
  updated_at = now();

create table if not exists public.account_policy_acceptances (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  marketplace_rules_version text not null,
  age_policy_version text not null,
  age_confirmed_18 boolean not null default false,
  accepted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.account_policy_acceptances is
  'Versioned launch policy acceptance for full Gnome account readiness. Email verification lives in Supabase Auth. Phone status is optional and is not a launch-readiness requirement.';

alter table public.account_policy_versions enable row level security;
alter table public.account_policy_acceptances enable row level security;

drop policy if exists account_policy_versions_read on public.account_policy_versions;
create policy account_policy_versions_read on public.account_policy_versions
  for select to anon, authenticated using (true);

drop policy if exists account_policy_acceptances_select_own on public.account_policy_acceptances;
create policy account_policy_acceptances_select_own on public.account_policy_acceptances
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.account_policy_versions from public, anon, authenticated;
grant select on public.account_policy_versions to anon, authenticated;

revoke all on public.account_policy_acceptances from public, anon, authenticated;
grant select on public.account_policy_acceptances to authenticated;

create or replace function public.current_account_policy_versions()
returns table (
  terms_version text,
  privacy_version text,
  marketplace_rules_version text,
  age_policy_version text,
  marketplace_notice text
)
language sql
stable
security definer
set search_path = public
as $$
  select terms_version, privacy_version, marketplace_rules_version, age_policy_version, marketplace_notice
  from public.account_policy_versions
  where id is true;
$$;

create or replace function public.accept_current_account_policies(
  p_confirm_18 boolean,
  p_accept_terms boolean,
  p_accept_privacy boolean,
  p_accept_marketplace_rules boolean
) returns public.account_policy_acceptances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v public.account_policy_versions;
  v_row public.account_policy_acceptances;
begin
  if v_user is null then
    raise exception 'NOT_SIGNED_IN' using errcode = 'P0001';
  end if;
  if not coalesce(p_confirm_18, false) then
    raise exception 'AGE_CONFIRMATION_REQUIRED' using errcode = 'P0001';
  end if;
  if not coalesce(p_accept_terms, false)
     or not coalesce(p_accept_privacy, false)
     or not coalesce(p_accept_marketplace_rules, false) then
    raise exception 'POLICY_ACCEPTANCE_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v from public.account_policy_versions where id is true;
  if v is null then
    raise exception 'POLICY_VERSIONS_NOT_CONFIGURED' using errcode = 'P0001';
  end if;

  insert into public.account_policy_acceptances as a
    (user_id, terms_version, privacy_version, marketplace_rules_version,
     age_policy_version, age_confirmed_18, accepted_at, updated_at)
  values
    (v_user, v.terms_version, v.privacy_version, v.marketplace_rules_version,
     v.age_policy_version, true, now(), now())
  on conflict (user_id) do update set
    terms_version = excluded.terms_version,
    privacy_version = excluded.privacy_version,
    marketplace_rules_version = excluded.marketplace_rules_version,
    age_policy_version = excluded.age_policy_version,
    age_confirmed_18 = true,
    accepted_at = now(),
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

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
    select id, email, phone, email_confirmed_at, phone_confirmed_at
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
        and exists (
          select 1
          from auth.identities i
          where i.user_id = p_user
            and lower(coalesce(i.identity_data ->> 'email_verified', 'false')) = 'true'
        )
      ) as email_verified,
      exists (select 1 from u where nullif(phone, '') is not null and phone_confirmed_at is not null) as phone_verified,
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

create or replace function public.my_account_readiness()
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
  select * from public.account_readiness_for_user(auth.uid());
$$;

create or replace function public.account_is_ready(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select account_ready from public.account_readiness_for_user(p_user)), false);
$$;

create or replace function public.require_account_ready(p_user uuid, p_action text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
begin
  if p_user is null then
    raise exception 'ACCOUNT_NOT_READY:%:%', coalesce(p_action, 'account_action'), 'signed_in'
      using errcode = 'P0001';
  end if;

  select * into r from public.account_readiness_for_user(p_user);
  if r.account_ready is true then
    return;
  end if;

  raise exception 'ACCOUNT_NOT_READY:%:%', coalesce(p_action, 'account_action'), array_to_string(coalesce(r.missing, array['account_ready']::text[]), ',')
    using errcode = 'P0001';
end;
$$;

-- Future P1/P2 trust option only: if phone verification is enabled later,
-- keep the verified value private and mirror it into the owner-only contact
-- table. This helper is not part of launch readiness and has no active client.
create or replace function public.sync_verified_auth_phone_to_private_contact()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_phone text;
begin
  if v_user is null then
    raise exception 'NOT_SIGNED_IN' using errcode = 'P0001';
  end if;
  select phone into v_phone
  from auth.users
  where id = v_user and nullif(phone, '') is not null and phone_confirmed_at is not null;
  if v_phone is null then
    raise exception 'PHONE_NOT_VERIFIED' using errcode = 'P0001';
  end if;

  insert into public.user_private_contact as c (user_id, phone_e164)
  values (v_user, v_phone)
  on conflict (user_id) do update set
    phone_e164 = excluded.phone_e164,
    updated_at = now();
end;
$$;

create or replace function public.p0_gate_listing_account_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then return new; end if;
  perform public.require_account_ready(new.owner_id, 'listing');
  return new;
end;
$$;

drop trigger if exists p0_gate_listing_account_ready on public.listings;
create trigger p0_gate_listing_account_ready
  before insert or update on public.listings
  for each row execute function public.p0_gate_listing_account_ready();

create or replace function public.p0_gate_market_account_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then return new; end if;
  -- handle_new_profile() creates the user's initial Market from the profile
  -- trigger. Policy acceptances cannot exist before that profile because they
  -- reference profiles(id), so allow only this nested bootstrap insert. Direct
  -- Market inserts and every later update still require full readiness.
  if tg_op = 'INSERT' and pg_trigger_depth() > 1
     and exists (select 1 from public.profiles p where p.id = new.owner_id) then
    return new;
  end if;
  perform public.require_account_ready(new.owner_id, 'market');
  return new;
end;
$$;

drop trigger if exists p0_gate_market_account_ready on public.markets;
create trigger p0_gate_market_account_ready
  before insert or update on public.markets
  for each row execute function public.p0_gate_market_account_ready();

create or replace function public.p0_gate_claim_account_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_account_ready(new.claimer_id, 'reservation');
  return new;
end;
$$;

drop trigger if exists p0_gate_claim_account_ready on public.claims;
create trigger p0_gate_claim_account_ready
  before insert on public.claims
  for each row execute function public.p0_gate_claim_account_ready();

create or replace function public.p0_gate_claim_message_account_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_account_ready(new.sender_id, 'message');
  return new;
end;
$$;

drop trigger if exists p0_gate_claim_message_account_ready on public.claim_messages;
create trigger p0_gate_claim_message_account_ready
  before insert on public.claim_messages
  for each row execute function public.p0_gate_claim_message_account_ready();

create or replace function public.p0_gate_follow_account_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_account_ready(new.follower_id, 'follow_market');
  return new;
end;
$$;

drop trigger if exists p0_gate_follow_account_ready on public.market_follows;
create trigger p0_gate_follow_account_ready
  before insert or update on public.market_follows
  for each row execute function public.p0_gate_follow_account_ready();

create or replace function public.p0_gate_seller_credential_account_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then return new; end if;
  perform public.require_account_ready(new.seller_id, 'seller_credential');
  return new;
end;
$$;

drop trigger if exists p0_gate_seller_credential_account_ready on public.seller_credentials;
create trigger p0_gate_seller_credential_account_ready
  before insert or update on public.seller_credentials
  for each row execute function public.p0_gate_seller_credential_account_ready();

create or replace function public.p0_gate_market_owner_by_market_account_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_market uuid;
begin
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    v_market := new.market_id;
  else
    v_market := coalesce(new.market_id, old.market_id);
  end if;
  select owner_id into v_owner from public.markets where id = v_market;
  perform public.require_account_ready(v_owner, tg_table_name);
  return new;
end;
$$;

drop trigger if exists p0_gate_market_payment_methods_account_ready on public.market_payment_methods;
create trigger p0_gate_market_payment_methods_account_ready
  before insert or update on public.market_payment_methods
  for each row execute function public.p0_gate_market_owner_by_market_account_ready();

drop trigger if exists p0_gate_market_pickup_private_account_ready on public.market_pickup_private;
create trigger p0_gate_market_pickup_private_account_ready
  before insert or update on public.market_pickup_private
  for each row execute function public.p0_gate_market_owner_by_market_account_ready();

drop trigger if exists p0_gate_market_pickup_settings_account_ready on public.market_pickup_settings;
create trigger p0_gate_market_pickup_settings_account_ready
  before insert or update on public.market_pickup_settings
  for each row execute function public.p0_gate_market_owner_by_market_account_ready();

drop trigger if exists p0_gate_market_pickup_hours_account_ready on public.market_pickup_hours;
create trigger p0_gate_market_pickup_hours_account_ready
  before insert or update on public.market_pickup_hours
  for each row execute function public.p0_gate_market_owner_by_market_account_ready();

drop trigger if exists p0_gate_market_pickup_exceptions_account_ready on public.market_pickup_exceptions;
create trigger p0_gate_market_pickup_exceptions_account_ready
  before insert or update on public.market_pickup_exceptions
  for each row execute function public.p0_gate_market_owner_by_market_account_ready();

create or replace function public.p0_gate_market_order_account_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_account_ready(new.buyer_id, 'market_order');
  return new;
end;
$$;

drop trigger if exists p0_gate_market_order_account_ready on public.market_orders;
create trigger p0_gate_market_order_account_ready
  before insert on public.market_orders
  for each row execute function public.p0_gate_market_order_account_ready();

-- Zordy reservations are server-only, but service_role is not a readiness
-- bypass. Authenticate first in the Edge Function, then enforce the account
-- state here before consuming the user's daily allowance.
create or replace function public.zordy_reserve_request(p_user uuid)
returns table (
  allowed boolean,
  plan public.market_plan,
  plan_display text,
  daily_limit int,
  used int,
  remaining int,
  resets_on date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.market_plan;
  lim int;
  reserved boolean;
  used_now int;
begin
  perform public.require_account_ready(p_user, 'zordy');

  p := public.zordy_effective_plan_for_user(p_user);
  lim := public.zordy_daily_limit(p);

  select coalesce(public.ai_reserve_slot(p_user, 'zordy', lim), false) into reserved;

  select coalesce((
    select c.count
    from public.ai_daily_counter c
    where c.user_id = p_user
      and c.feature = 'zordy'
      and c.day = (now() at time zone 'utc')::date
  ), 0) into used_now;

  return query select
    reserved,
    p,
    case p
      when 'grower'::public.market_plan then 'Pro'
      when 'farm'::public.market_plan then 'Farm'
      when 'sponsor'::public.market_plan then 'Legacy Farm'
      else 'Free'
    end,
    lim,
    used_now,
    greatest(lim - used_now, 0),
    ((now() at time zone 'utc')::date + 1);
end;
$$;

-- Private pickup details remain limited to order parties, and the requesting
-- account must now be ready before exact pickup information is returned.
create or replace function public.order_pickup_details(p_order uuid)
returns table(address text, instructions text, location_type text, nickname text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o public.market_orders;
  v_is_owner boolean;
begin
  select * into o from public.market_orders where id = p_order;
  if o is null then return; end if;

  v_is_owner := exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid());
  if v_is_owner then
    perform public.require_account_ready(auth.uid(), 'pickup_details');
  elsif o.buyer_id = auth.uid() and o.status in ('CONFIRMED','READY','COMPLETED') then
    perform public.require_account_ready(auth.uid(), 'pickup_details');
  else
    return;
  end if;

  return query
    select l.address_line, l.instructions, l.location_type,
           coalesce(o.pickup_location_name, l.nickname)
      from public.market_pickup_locations l
     where l.id = o.pickup_location_id;
end;
$$;

-- Medium finding: credential approval can race against mutable scope. Freeze
-- seller-managed scope once the credential is approved, and make approval
-- lock the current scope rows while recording a deterministic scope snapshot.
alter table public.seller_credentials
  add column if not exists approved_scope_node_ids uuid[],
  add column if not exists approved_scope_hash text;

create or replace function public.prevent_approved_credential_scope_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.credential_status;
begin
  select status into v_status
  from public.seller_credentials
  where id = coalesce(new.credential_id, old.credential_id);

  if v_status = 'APPROVED'::public.credential_status and not public.is_admin() then
    raise exception 'CREDENTIAL_SCOPE_LOCKED' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists prevent_approved_credential_scope_change on public.credential_taxonomy_scope;
create trigger prevent_approved_credential_scope_change
  before insert or update or delete on public.credential_taxonomy_scope
  for each row execute function public.prevent_approved_credential_scope_change();

create or replace function public.admin_review_credential(
  p_credential uuid,
  p_action text,
  p_reason text default null
) returns public.seller_credentials
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.seller_credentials;
  v_scope uuid[];
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select * into c from public.seller_credentials where id = p_credential for update;
  if c is null then
    raise exception 'CREDENTIAL_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform 1
  from public.credential_taxonomy_scope s
  where s.credential_id = p_credential
  for update;

  select coalesce(array_agg(s.taxonomy_node_id order by s.taxonomy_node_id), '{}')
    into v_scope
  from public.credential_taxonomy_scope s
  where s.credential_id = p_credential;

  if p_action = 'APPROVE' then
    if cardinality(v_scope) = 0 then
      raise exception 'CANNOT_APPROVE_UNSCOPED: credential has no category scope'
        using errcode = 'P0001';
    end if;
    if c.expiration_date is not null and c.expiration_date < current_date then
      raise exception 'CANNOT_APPROVE_EXPIRED: expiration date is in the past'
        using errcode = 'P0001';
    end if;
    update public.seller_credentials
       set status = 'APPROVED',
           reviewed_at = now(),
           reviewed_by = auth.uid(),
           denial_reason = null,
           approved_scope_node_ids = v_scope,
           approved_scope_hash = md5(v_scope::text),
           updated_at = now()
     where id = p_credential;
    perform public.compliance_reactivate_for_seller(c.seller_id);
  elsif p_action = 'DENY' then
    update public.seller_credentials
       set status = 'DENIED', reviewed_at = now(), reviewed_by = auth.uid(),
           denial_reason = nullif(btrim(coalesce(p_reason,'')), ''),
           approved_scope_node_ids = null,
           approved_scope_hash = null,
           updated_at = now()
     where id = p_credential;
  elsif p_action = 'REVOKE' then
    update public.seller_credentials
       set status = 'REVOKED', reviewed_at = now(), reviewed_by = auth.uid(),
           denial_reason = nullif(btrim(coalesce(p_reason,'')), 'Revoked by admin'),
           approved_scope_node_ids = null,
           approved_scope_hash = null,
           updated_at = now()
     where id = p_credential;
    perform public.compliance_run_expiry();
  elsif p_action = 'MARK_EXPIRED' then
    update public.seller_credentials
       set status = 'EXPIRED', reviewed_at = now(), reviewed_by = auth.uid(),
           denial_reason = null,
           approved_scope_node_ids = null,
           approved_scope_hash = null,
           updated_at = now()
     where id = p_credential;
    perform public.compliance_run_expiry();
  else
    raise exception 'UNKNOWN_ACTION' using errcode = 'P0001';
  end if;

  select * into c from public.seller_credentials where id = p_credential;
  return c;
end;
$$;

-- Grants: RPC reads/acceptance are authenticated only; helpers are callable
-- where RLS/triggers need them, but sensitive tables remain RLS-scoped.
revoke execute on function public.current_account_policy_versions() from public;
grant execute on function public.current_account_policy_versions() to anon, authenticated;
revoke execute on function public.accept_current_account_policies(boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.accept_current_account_policies(boolean, boolean, boolean, boolean) to authenticated;
revoke execute on function public.my_account_readiness() from public, anon;
grant execute on function public.my_account_readiness() to authenticated;
revoke execute on function public.account_readiness_for_user(uuid) from public, anon, authenticated;
grant execute on function public.account_readiness_for_user(uuid) to service_role;
revoke execute on function public.account_is_ready(uuid) from public, anon, authenticated;
grant execute on function public.account_is_ready(uuid) to service_role;
revoke execute on function public.require_account_ready(uuid, text) from public, anon, authenticated;
grant execute on function public.require_account_ready(uuid, text) to service_role;
revoke execute on function public.sync_verified_auth_phone_to_private_contact() from public, anon;
grant execute on function public.sync_verified_auth_phone_to_private_contact() to authenticated;
revoke execute on function public.order_pickup_details(uuid) from public, anon;
grant execute on function public.order_pickup_details(uuid) to authenticated;

do $$
begin
  if to_regclass('public.billing_config') is not null and exists (
    select 1 from public.billing_config where payments_live_enabled is true
  ) then
    raise exception 'P0 self-check: payments_live_enabled must stay false';
  end if;

  if has_table_privilege('anon', 'public.account_policy_acceptances', 'select') then
    raise exception 'P0 self-check: anon can select account_policy_acceptances';
  end if;

  if has_function_privilege('anon', 'public.my_account_readiness()', 'execute') then
    raise exception 'P0 self-check: anon can execute my_account_readiness';
  end if;

  if pg_get_functiondef('public.account_readiness_for_user(uuid)'::regprocedure)
       like '%''verified_phone''%' then
    raise exception 'P0 self-check: phone must not appear in launch readiness missing steps';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
