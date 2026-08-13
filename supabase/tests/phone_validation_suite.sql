-- Optional-phone validation suite for public.save_onboarding_contact (0090).
--
-- Runs on a throwaway local database built by run_phone_validation_tests.sh
-- (shim + minimal contact fixture + 0090). Every assertion goes through the
-- shipped RPC and then reads what actually landed in user_private_contact —
-- never a re-implementation of the rules being tested.
--
-- The defect this suite exists for: under 0086 a phone argument carrying no
-- digits ("no thanks", "---", an email address) stripped to the empty string,
-- became NULL, skipped validation, and the caller was told the details were
-- saved while nothing was stored.

create table t (n serial, label text, pass boolean, detail text);

-- One phone value through the RPC, against its own fresh user so cases cannot
-- contaminate each other. a_seed pre-loads a stored phone to exercise the merge
-- and clear paths. The expectation is either the value the column ends up
-- holding ('<null>' when empty) or the SQLERRM the RPC raised.
create or replace function tphone(a_label text, a_phone text, a_expect text, a_seed text default null)
returns void language plpgsql as $$
declare u uuid := gen_random_uuid(); got text;
begin
  insert into auth.users (id) values (u);
  insert into public.profiles (id, name) values (u, 'Neighbor N.');
  if a_seed is not null then
    insert into public.user_private_contact (user_id, phone_e164) values (u, a_seed);
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
  begin
    perform public.save_onboarding_contact(p_phone => a_phone);
    select coalesce(phone_e164, '<null>') into got
      from public.user_private_contact where user_id = u;
    got := coalesce(got, '<no row>');
  exception when others then
    got := sqlerrm;
  end;
  insert into t(label, pass, detail)
  values (a_label, got is not distinct from a_expect,
          format('expected %s, got %s', a_expect, coalesce(got, '<null>')));
end $$;

-- Same shape for the email argument, so "a phone typed into the email box" is
-- decided by the shipped rules too.
create or replace function temail(a_label text, a_email text, a_expect text)
returns void language plpgsql as $$
declare u uuid := gen_random_uuid(); got text;
begin
  insert into auth.users (id) values (u);
  insert into public.profiles (id, name) values (u, 'Neighbor N.');
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
  begin
    perform public.save_onboarding_contact(p_email => a_email);
    select coalesce(contact_email, '<null>') into got
      from public.user_private_contact where user_id = u;
    got := coalesce(got, '<no row>');
  exception when others then
    got := sqlerrm;
  end;
  insert into t(label, pass, detail)
  values (a_label, got is not distinct from a_expect,
          format('expected %s, got %s', a_expect, coalesce(got, '<null>')));
end $$;

-- --------------------------------------------------------------------------
-- A. "No phone" is a legitimate answer and must never error
-- --------------------------------------------------------------------------
do $$
declare u uuid := gen_random_uuid(); got text;
begin
  -- Omitted argument: the onboarding chat saves one field at a time, so a call
  -- that never mentions the phone must leave a stored one alone.
  insert into auth.users (id) values (u);
  insert into public.profiles (id, name) values (u, 'Neighbor N.');
  insert into public.user_private_contact (user_id, phone_e164) values (u, '+12165550142');
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
  begin
    perform public.save_onboarding_contact(p_first_name => 'Ada');
    select coalesce(phone_e164, '<null>') into got
      from public.user_private_contact where user_id = u;
  exception when others then got := sqlerrm;
  end;
  insert into t(label, pass, detail) values ('T-PH-01 omitted phone keeps the stored number',
    got = '+12165550142', 'got '||coalesce(got, '<null>'));
end $$;

do $$
begin
  -- NULL means "not supplied on this call". The gnome-onboarding edge function
  -- sends p_phone: null on every turn once a phone is collected, so NULL
  -- erasing the column would wipe saved numbers mid-conversation.
  perform tphone('T-PH-02 explicit NULL keeps the stored number', null, '+12165550142', '+12165550142');
  perform tphone('T-PH-03 empty string clears the stored number', '', '<null>', '+12165550142');
  perform tphone('T-PH-04 whitespace-only clears the stored number', '   ', '<null>', '+12165550142');
  perform tphone('T-PH-05 NULL on a first save stores no phone', null, '<null>');
  perform tphone('T-PH-06 empty string on a first save stores no phone', '', '<null>');
end $$;

-- --------------------------------------------------------------------------
-- B. A phone that was actually attempted is validated, never dropped
-- --------------------------------------------------------------------------
do $$
begin
  perform tphone('T-PH-07 "no thanks" is rejected, not silently nulled', 'no thanks', 'INVALID_PHONE');
  perform tphone('T-PH-08 punctuation only is rejected', '---', 'INVALID_PHONE');
  perform tphone('T-PH-09 letters only are rejected', 'phone', 'INVALID_PHONE');
  perform tphone('T-PH-10 too few digits (6) rejected', '555012', 'INVALID_PHONE');
  perform tphone('T-PH-11 too many digits (16, no +) rejected', '2165550142123456', 'INVALID_PHONE');
  perform tphone('T-PH-12 too many digits (16, with +) rejected', '+1234567890123456', 'INVALID_PHONE');
  perform tphone('T-PH-13 seven-digit local without area code rejected', '555-0142', 'INVALID_PHONE');
  perform tphone('T-PH-14 extension suffix rejected', '216-555-0142 x12', 'INVALID_PHONE');
  perform tphone('T-PH-15 "+" anywhere but the front rejected', '216+5550142', 'INVALID_PHONE');
  perform tphone('T-PH-16 email in the phone position rejected', 'daniel@example.com', 'INVALID_PHONE');
  perform tphone('T-PH-17 rejection reported even when a phone is already stored',
                 'no thanks', 'INVALID_PHONE', '+12165550142');
end $$;

do $$
declare u uuid := gen_random_uuid(); got text;
begin
  insert into auth.users (id) values (u);
  insert into public.profiles (id, name) values (u, 'Neighbor N.');
  insert into public.user_private_contact (user_id, phone_e164) values (u, '+12165550142');
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
  begin
    perform public.save_onboarding_contact(p_phone => 'no thanks');
  exception when others then null;
  end;
  select coalesce(phone_e164, '<null>') into got
    from public.user_private_contact where user_id = u;
  insert into t(label, pass, detail) values ('T-PH-18 rejection did not overwrite the saved phone',
    got = '+12165550142', 'got '||coalesce(got, '<null>'));
end $$;

-- --------------------------------------------------------------------------
-- C. Valid numbers, normalised the same way every time
-- --------------------------------------------------------------------------
do $$
begin
  perform tphone('T-PH-19 US 10-digit', '2165550142', '+12165550142');
  perform tphone('T-PH-20 formatted US number', '(216) 555-0142', '+12165550142');
  perform tphone('T-PH-21 dotted US number', '216.555.0142', '+12165550142');
  perform tphone('T-PH-22 leading country digit without +', '1-216-555-0142', '+12165550142');
  perform tphone('T-PH-23 US number with + normalises identically', '+1 (216) 555-0142', '+12165550142');
  perform tphone('T-PH-24 international keeps its country code', '+44 20 7946 0958', '+442079460958');
  perform tphone('T-PH-25 a new valid number replaces the stored one',
                 '+44 20 7946 0958', '+442079460958', '+12165550142');
end $$;

-- --------------------------------------------------------------------------
-- D. The email argument, and the behaviour 0090 must not have changed
-- --------------------------------------------------------------------------
do $$
begin
  perform temail('T-EM-01 phone in the email position rejected', '2165550142', 'INVALID_EMAIL');
  perform temail('T-EM-02 valid email stored lowercased', 'Neighbor@Example.COM', 'neighbor@example.com');
  perform temail('T-EM-03 blank email is not an error', '   ', '<null>');
end $$;

do $$
declare u uuid := gen_random_uuid(); nm text; done timestamptz; st jsonb;
begin
  insert into auth.users (id) values (u);
  insert into public.profiles (id, name) values (u, 'placeholder');
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
  st := public.save_onboarding_contact(
          p_first_name => 'Ada', p_last_name => 'Lovelace',
          p_email => 'ada@example.com', p_phone => '(216) 555-0142', p_complete => true);
  select name, onboarding_completed_at into nm, done from public.profiles where id = u;

  insert into t(label, pass, detail) values ('T-REG-01 display name is still derived "First L."',
    nm = 'Ada L.', 'profiles.name = '||coalesce(nm, '<null>'));
  insert into t(label, pass, detail) values ('T-REG-02 p_complete still stamps onboarding',
    done is not null, 'onboarding_completed_at '||coalesce(done::text, '<null>'));
  insert into t(label, pass, detail) values ('T-REG-03 returned state carries the normalised phone',
    st ->> 'phone' = '+12165550142', 'state.phone = '||coalesce(st ->> 'phone', '<null>'));
end $$;

do $$
declare u uuid := gen_random_uuid(); n int; nm text;
begin
  insert into auth.users (id) values (u);
  insert into public.profiles (id, name) values (u, 'placeholder');
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
  begin
    perform public.save_onboarding_contact(p_first_name => 'Grace', p_phone => 'no thanks');
  exception when others then null;
  end;
  select count(*) into n from public.user_private_contact where user_id = u;
  select name into nm from public.profiles where id = u;
  insert into t(label, pass, detail) values ('T-REG-04 a rejected phone writes nothing at all',
    n = 0 and nm = 'placeholder', n||' contact row(s), profiles.name = '||coalesce(nm, '<null>'));
end $$;

do $$
declare got text;
begin
  perform set_config('request.jwt.claims', '{}', false);
  begin
    perform public.save_onboarding_contact(p_phone => '2165550142');
    got := 'ACCEPTED';
  exception when others then got := sqlerrm;
  end;
  insert into t(label, pass, detail) values ('T-REG-05 anonymous callers are still rejected',
    got = 'UNAUTHENTICATED', got);
end $$;

select n, label, case when pass then 'PASS' else 'FAIL' end as result, detail
  from t order by n;
select count(*) filter (where pass) || '/' || count(*) || ' phone validation cases pass' as summary from t;
select 'PHONE VALIDATION: ' ||
       case when bool_and(pass) then 'ALL TESTS PASSED' else 'FAILURES PRESENT' end as verdict
  from t;
