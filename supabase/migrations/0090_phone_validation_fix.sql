-- 0090 — save_onboarding_contact: an optional phone that is never silently lost.
--
-- 0086 normalised the phone before it validated it:
--   ph := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
--   if ph is not null and length(...) not between 7 and 15 then ... end if;
-- Anything carrying no digits at all — "no thanks", "---", or an email address
-- pasted into the phone box — stripped down to the empty string, became NULL,
-- and so skipped the only phone check there was. The caller got "Details saved"
-- back while nothing was stored. A number the neighbor believes we hold is
-- worse than no number: it is the fallback contact for a delivery.
--
-- This replaces the function only. The signature is unchanged, so existing
-- grants survive; the revoke/grant at the bottom is restated for replay safety.
--
-- The line is now drawn on the RAW argument instead of the stripped one:
--
--   p_phone omitted / NULL   the field was not supplied on this call; whatever
--                            is already stored is left alone. The onboarding
--                            edge function sends p_phone: null on EVERY chat
--                            turn once a phone is collected, so treating NULL
--                            as "erase it" would wipe saved numbers.
--   p_phone '' / whitespace  an explicit clear; the stored phone becomes NULL.
--                            This is the channel a client uses to remove a
--                            phone, and it is deliberately distinct from NULL.
--   anything else            a phone was attempted, so it is validated and
--                            normalised or INVALID_PHONE is raised. It is never
--                            quietly discarded.
--
-- Accepted shapes (the policy, stated so the app can explain it):
--   * leading '+'  international; 7–15 digits (E.164 caps at 15). Stored as
--                  '+' || digits.
--   * no '+'       must be NANP — 10 digits, or 11 beginning with 1. Stored as
--                  '+1' || the ten national digits. With no country code typed
--                  there is nothing to infer one from, and guessing would store
--                  a number nobody can dial; this is a US hyperlocal app, so
--                  NANP is the only shape worth assuming.
--   * spaces, parentheses, '.', and '-' are accepted as formatting anywhere.
--     Letters, '@', and a '+' anywhere but the front are rejected — those are a
--     typo or the wrong field, and both deserve an error rather than a shrug.
--
-- Forward-only: rows written under 0086 keep whatever it stored (bare digits,
-- no '+'). Nothing is rewritten here, because rewriting contact details in a
-- migration is not something to do without an owner looking at it.

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
  uid      uuid := auth.uid();
  fn       text;
  ln       text;
  ph       text;
  em       text;
  raw_ph   text;
  digits   text;
  clear_ph boolean := false;
  display  text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  fn := nullif(btrim(coalesce(p_first_name, '')), '');
  ln := nullif(btrim(coalesce(p_last_name, '')), '');
  em := lower(nullif(btrim(coalesce(p_email, '')), ''));

  if fn is not null and length(fn) > 60 then raise exception 'FIRST_NAME_TOO_LONG'; end if;
  if ln is not null and length(ln) > 60 then raise exception 'LAST_NAME_TOO_LONG'; end if;
  if em is not null and em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  -- Decide on the raw text, before any stripping, so a value that reduces to no
  -- digits is an error rather than an accidental "no phone given".
  raw_ph := btrim(coalesce(p_phone, ''));
  if p_phone is null then
    ph := null;
  elsif raw_ph = '' then
    ph := null;
    clear_ph := true;
  else
    if raw_ph !~ '^\+?[0-9 ()./-]+$' then raise exception 'INVALID_PHONE'; end if;
    digits := regexp_replace(raw_ph, '[^0-9]', '', 'g');
    if left(raw_ph, 1) = '+' then
      if length(digits) not between 7 and 15 then raise exception 'INVALID_PHONE'; end if;
      ph := '+' || digits;
    else
      if length(digits) = 11 and left(digits, 1) = '1' then digits := substr(digits, 2); end if;
      if length(digits) <> 10 then raise exception 'INVALID_PHONE'; end if;
      ph := '+1' || digits;
    end if;
  end if;

  insert into public.user_private_contact as c (user_id, first_name, last_name, phone_e164, contact_email)
  values (uid, fn, ln, ph, em)
  on conflict (user_id) do update set
    first_name    = coalesce(excluded.first_name,    c.first_name),
    last_name     = coalesce(excluded.last_name,     c.last_name),
    phone_e164    = case when clear_ph then null
                         else coalesce(excluded.phone_e164, c.phone_e164) end,
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
