-- Record normal email OTP sessions as private server-side mailbox proof.
-- Supabase can leave auth.identities.identity_data.email_verified=false after
-- a successful OTP exchange, so that provider metadata cannot be the only
-- readiness signal. Password-only sessions remain unable to mint this proof.

begin;

alter table public.account_email_verification_proofs
  drop constraint if exists account_email_verification_proofs_verification_method_check;

alter table public.account_email_verification_proofs
  add constraint account_email_verification_proofs_verification_method_check
  check (verification_method in ('CONCIERGE_MAGIC_LINK', 'AUTH_PROVIDER', 'EMAIL_OTP'));

-- Preserve already verified OAuth users without exposing auth.users through a
-- public view. Future OAuth sessions call record_my_verified_email_provider().
insert into public.account_email_verification_proofs as proof
  (user_id, verified_email, verification_method, concierge_invite_id, verified_at)
select u.id, lower(u.email), 'AUTH_PROVIDER', null, now()
from auth.users u
where u.email_confirmed_at is not null
  and u.email is not null
  and exists (
    select 1
    from auth.identities identity_row
    where identity_row.user_id = u.id
      and identity_row.provider in ('google', 'apple')
      and lower(coalesce(identity_row.identity_data ->> 'email', u.email)) = lower(u.email)
  )
on conflict (user_id) do update set
  verified_email = excluded.verified_email,
  verification_method = excluded.verification_method,
  concierge_invite_id = null,
  verified_at = greatest(proof.verified_at, excluded.verified_at);

create or replace function public.record_my_verified_email_otp()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_claim_email text := lower(nullif(auth.jwt() ->> 'email', ''));
  v_suspended boolean;
  v_amr jsonb := coalesce(auth.jwt() -> 'amr', '[]'::jsonb);
  v_otp_session boolean := false;
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  select lower(u.email), coalesce(p.suspended, false)
    into v_email, v_suspended
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id = v_user
    and u.email_confirmed_at is not null;

  if v_email is null or v_claim_email is distinct from v_email then
    raise exception 'VERIFIED_EMAIL_REQUIRED' using errcode = 'P0001';
  end if;
  if v_suspended then
    raise exception 'ACCOUNT_SUSPENDED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_amr) = 'array' then
    select exists (
      select 1
      from jsonb_array_elements(v_amr) entry
      where entry ->> 'method' in ('otp', 'magiclink')
    ) into v_otp_session;
  end if;

  if not v_otp_session then
    raise exception 'EMAIL_OTP_SESSION_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.account_email_verification_proofs as proof
    (user_id, verified_email, verification_method, concierge_invite_id, verified_at)
  values (v_user, v_email, 'EMAIL_OTP', null, now())
  on conflict (user_id) do update set
    verified_email = excluded.verified_email,
    verification_method = excluded.verification_method,
    concierge_invite_id = null,
    verified_at = now();

  return true;
end;
$$;

comment on function public.record_my_verified_email_otp() is
  'Records private mailbox proof only for the current confirmed email and an OTP-authenticated JWT.';

revoke all on function public.record_my_verified_email_otp() from public, anon;
grant execute on function public.record_my_verified_email_otp() to authenticated;

create or replace function public.record_my_verified_email_provider()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_suspended boolean;
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  select lower(u.email), coalesce(p.suspended, false)
    into v_email, v_suspended
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id = v_user
    and u.email_confirmed_at is not null;

  if v_email is null then
    raise exception 'VERIFIED_EMAIL_REQUIRED' using errcode = 'P0001';
  end if;
  if v_suspended then
    raise exception 'ACCOUNT_SUSPENDED' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
    from auth.identities identity_row
    where identity_row.user_id = v_user
      and identity_row.provider in ('google', 'apple')
      and lower(coalesce(identity_row.identity_data ->> 'email', v_email)) = v_email
  ) then
    raise exception 'VERIFIED_PROVIDER_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.account_email_verification_proofs as proof
    (user_id, verified_email, verification_method, concierge_invite_id, verified_at)
  values (v_user, v_email, 'AUTH_PROVIDER', null, now())
  on conflict (user_id) do update set
    verified_email = excluded.verified_email,
    verification_method = excluded.verification_method,
    concierge_invite_id = null,
    verified_at = now();

  return true;
end;
$$;

comment on function public.record_my_verified_email_provider() is
  'Records private mailbox proof only for the current confirmed Google or Apple identity.';

revoke all on function public.record_my_verified_email_provider() from public, anon;
grant execute on function public.record_my_verified_email_provider() to authenticated;

notify pgrst, 'reload schema';

commit;
