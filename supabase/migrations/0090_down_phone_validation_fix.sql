-- Down-migration for 0090. Restores the 0086 body of save_onboarding_contact
-- verbatim, including the defect it shipped with: a phone argument that strips
-- to no digits ("no thanks", "---", an email in the phone box) becomes NULL,
-- skips the length check, and is silently discarded while the caller is told
-- the details were saved.
--
-- Running this reopens that hole. It exists so 0090 can be reversed on a
-- project that has already applied it, and so the test harness can prove the
-- pair is symmetric.

create or replace function public.save_onboarding_contact(
  p_first_name text default null,
  p_last_name  text default null,
  p_phone      text default null,
  p_email      text default null,
  p_complete   boolean default false
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  fn     text;
  ln     text;
  ph     text;
  em     text;
  display text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  fn := nullif(btrim(coalesce(p_first_name, '')), '');
  ln := nullif(btrim(coalesce(p_last_name, '')), '');
  em := lower(nullif(btrim(coalesce(p_email, '')), ''));
  -- Keep digits (and a leading +) only; store E.164-ish or reject.
  ph := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');

  if fn is not null and length(fn) > 60 then raise exception 'FIRST_NAME_TOO_LONG'; end if;
  if ln is not null and length(ln) > 60 then raise exception 'LAST_NAME_TOO_LONG'; end if;
  if em is not null and em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_EMAIL';
  end if;
  if ph is not null and length(regexp_replace(ph, '[^0-9]', '', 'g')) not between 7 and 15 then
    raise exception 'INVALID_PHONE';
  end if;

  insert into public.user_private_contact as c (user_id, first_name, last_name, phone_e164, contact_email)
  values (uid, fn, ln, ph, em)
  on conflict (user_id) do update set
    first_name    = coalesce(excluded.first_name,    c.first_name),
    last_name     = coalesce(excluded.last_name,     c.last_name),
    phone_e164    = coalesce(excluded.phone_e164,    c.phone_e164),
    contact_email = coalesce(excluded.contact_email, c.contact_email),
    updated_at    = now();

  -- Public display name = "First L." — never the full last name.
  select c.first_name, c.last_name into fn, ln
    from public.user_private_contact c where c.user_id = uid;
  if fn is not null then
    display := fn || case when ln is not null and ln <> '' then ' ' || upper(left(ln, 1)) || '.' else '' end;
    update public.profiles set name = display where id = uid;
  end if;

  if p_complete then
    update public.profiles set onboarding_completed_at = now()
    where id = uid and onboarding_completed_at is null;
  end if;

  return public.my_onboarding_state();
end;
$$;

revoke all on function public.save_onboarding_contact(text, text, text, text, boolean) from public, anon;
grant execute on function public.save_onboarding_contact(text, text, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
