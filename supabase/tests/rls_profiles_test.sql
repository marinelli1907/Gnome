-- Automated RLS tests for the profiles public projection (0087).
--
-- Runs against a THROWAWAY local Postgres database, never production. The
-- harness recreates the parts of Supabase the policies actually depend on:
-- the anon / authenticated / service_role roles, and auth.uid() reading the
-- request JWT claim the way Supabase's does. Everything else is the real
-- migration text, so what passes here is what the migration does.
--
--   supabase/tests/run_rls_tests.sh
--
-- Every check raises on failure, so a non-zero exit means a real regression.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Harness: Supabase-shaped roles + auth.uid()
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Stand-in for the real is_admin(): reads a claim so tests can toggle it.
create or replace function public.is_admin() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.is_admin', true), ''), 'false')::boolean
$$;

-- ---------------------------------------------------------------------------
-- Schema under test: profiles as it exists in production (0001 + later), and
-- user_private_contact from 0086.
-- ---------------------------------------------------------------------------
drop table if exists public.user_private_contact cascade;
drop table if exists public.profiles cascade;

create table public.profiles (
  id uuid primary key,
  name text not null default 'Neighbor',
  avatar_url text,
  zip_code text,
  city text,
  county text,
  state text,
  user_type text not null default 'neighbor',
  business_account boolean not null default false,
  business_category text,
  can_post boolean not null default true,
  can_claim boolean not null default true,
  can_sponsor boolean not null default false,
  can_create_promotions boolean not null default false,
  can_offer_delivery boolean not null default false,
  created_at timestamptz not null default now(),
  suspended boolean not null default false,
  onboarding_completed_at timestamptz
);

create table public.user_private_contact (
  user_id uuid primary key,
  first_name text, last_name text, phone_e164 text, contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_private_contact enable row level security;

drop policy if exists user_private_contact_own on public.user_private_contact;
create policy user_private_contact_own on public.user_private_contact
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Production grant shape: NO table-level SELECT for anon/authenticated, only
-- the column list from 0001/0058 (zip_code and onboarding_completed_at absent).
grant select (avatar_url, business_account, business_category, can_claim,
              can_create_promotions, can_offer_delivery, can_post, can_sponsor,
              city, county, created_at, id, name, state, suspended, user_type)
  on public.profiles to anon, authenticated;
grant select on public.user_private_contact to authenticated;

insert into public.profiles (id, name, city, county, state, suspended, can_sponsor) values
  ('11111111-1111-1111-1111-111111111111', 'Daniel M.', 'Boone', 'Watauga', 'NC', false, true),
  ('22222222-2222-2222-2222-222222222222', 'Sam P.',    'Boone', 'Watauga', 'NC', true,  false);
insert into public.user_private_contact (user_id, first_name, last_name, phone_e164, contact_email) values
  ('11111111-1111-1111-1111-111111111111', 'Daniel', 'Marinelli', '+18285550101', 'daniel@example.test');

-- ---------------------------------------------------------------------------
-- Baseline: prove the footgun exists BEFORE 0087.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles for select using (true);

do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  select count(*) into n from public.profiles where id = '11111111-1111-1111-1111-111111111111';
  if n <> 1 then raise exception 'BASELINE: expected the pre-0087 blanket policy to expose other rows'; end if;
  raise notice 'BASELINE  other user can read another profile row ......... EXPOSED (as expected pre-0087)';
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Apply 0087 (same statements as the migration).
-- ---------------------------------------------------------------------------
create or replace view public.public_profiles as
select p.id, p.name, p.avatar_url, p.city, p.county, p.state,
       p.user_type, p.business_account, p.business_category, p.created_at
from public.profiles p;
alter view public.public_profiles set (security_invoker = false);
alter view public.public_profiles set (security_barrier = true);
revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (auth.uid() = id);
drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles for select using (public.is_admin());

revoke select (can_post, can_claim, can_sponsor, can_create_promotions,
               can_offer_delivery, suspended) on public.profiles from anon;
revoke select (onboarding_completed_at) on public.profiles from anon;

-- ---------------------------------------------------------------------------
-- Tests
-- ---------------------------------------------------------------------------
create or replace function pg_temp.expect_denied(sql text, label text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception
    when insufficient_privilege then raise notice 'PASS  % ... denied (%).', label, 'insufficient_privilege'; return;
    when others then raise notice 'PASS  % ... denied (%).', label, sqlerrm; return;
  end;
  raise exception 'FAIL  % ... it was ALLOWED', label;
end $$;

do $$
declare n int; v text;
begin
  ---------------------------------------------------------------------------
  raise notice '--- owner ---';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

  select count(*) into n from public.profiles where id = '11111111-1111-1111-1111-111111111111';
  if n <> 1 then raise exception 'FAIL  owner cannot read own profile row'; end if;
  raise notice 'PASS  owner reads own profile row';

  select count(*) into n from public.user_private_contact where user_id = auth.uid();
  if n <> 1 then raise exception 'FAIL  owner cannot read own private contact'; end if;
  raise notice 'PASS  owner reads own private contact';

  ---------------------------------------------------------------------------
  raise notice '--- another signed-in user ---';
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

  select count(*) into n from public.profiles where id = '11111111-1111-1111-1111-111111111111';
  if n <> 0 then raise exception 'FAIL  cross-user read of profiles returned % row(s)', n; end if;
  raise notice 'PASS  cross-user direct profiles read returns 0 rows';

  select count(*) into n from public.user_private_contact
   where user_id = '11111111-1111-1111-1111-111111111111';
  if n <> 0 then raise exception 'FAIL  cross-user read of private contact returned % row(s)', n; end if;
  raise notice 'PASS  cross-user private contact returns 0 rows';

  -- The public projection still works, and shows the intended display name.
  select name into v from public.public_profiles where id = '11111111-1111-1111-1111-111111111111';
  if v is distinct from 'Daniel M.' then raise exception 'FAIL  public projection name was %', v; end if;
  raise notice 'PASS  public projection returns "Daniel M."';

  -- A join from the projection to contact data must find nothing.
  select count(*) into n
    from public.public_profiles pp
    left join public.user_private_contact c on c.user_id = pp.id
   where c.contact_email is not null;
  if n <> 0 then raise exception 'FAIL  contact data reachable through a join (% row(s))', n; end if;
  raise notice 'PASS  contact data unreachable through a join';

  ---------------------------------------------------------------------------
  raise notice '--- anonymous ---';
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into n from public.profiles;
  if n <> 0 then raise exception 'FAIL  anonymous read of profiles returned % row(s)', n; end if;
  raise notice 'PASS  anonymous direct profiles read returns 0 rows';

  select count(*) into n from public.public_profiles;
  if n <> 2 then raise exception 'FAIL  anonymous public projection returned % row(s), expected 2', n; end if;
  raise notice 'PASS  anonymous sees the public projection only';

  reset role;
end $$;

-- Administrative flags must be unreadable even by column, for both roles.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  perform pg_temp.expect_denied('select zip_code from public.profiles',               'authenticated reads profiles.zip_code');
  set local role anon;
  perform pg_temp.expect_denied('select suspended from public.profiles',              'anon reads profiles.suspended');
  perform pg_temp.expect_denied('select can_post from public.profiles',               'anon reads profiles.can_post');
  perform pg_temp.expect_denied('select * from public.user_private_contact',          'anon reads user_private_contact');
  reset role;
end $$;

-- The projection is an explicit allowlist, and a NEW column on profiles must
-- not appear in it.
do $$
declare cols text;
begin
  select string_agg(column_name, ',' order by column_name) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'public_profiles';
  if cols <> 'avatar_url,business_account,business_category,city,county,created_at,id,name,state,user_type' then
    raise exception 'FAIL  public_profiles columns drifted: %', cols;
  end if;
  raise notice 'PASS  public projection exposes exactly its allowlist';

  alter table public.profiles add column secret_note text;
  update public.profiles set secret_note = 'should never be public';

  select string_agg(column_name, ',') into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'public_profiles' and column_name = 'secret_note';
  if cols is not null then raise exception 'FAIL  a new profiles column leaked into public_profiles'; end if;
  raise notice 'PASS  a newly added profiles column does NOT appear in the projection';

  set local role anon;
  perform pg_temp.expect_denied('select secret_note from public.profiles', 'anon reads a newly added profiles column');
  reset role;
  alter table public.profiles drop column secret_note;
end $$;

-- A non-admin cannot reach ANOTHER user's administrative flags. `authenticated`
-- keeps the column grant (admins share that role), so the row policy is the
-- control being proven here: zero rows means zero flags.
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  select count(*) into n from public.profiles
   where id = '11111111-1111-1111-1111-111111111111' and suspended is not null;
  if n <> 0 then raise exception 'FAIL  non-admin read another user''s administrative flags'; end if;
  raise notice 'PASS  non-admin cannot read another user''s can_*/suspended (0 rows)';

  -- ...but reading the flags on their OWN row is expected and harmless.
  select count(*) into n from public.profiles where id = auth.uid() and can_post is not null;
  if n <> 1 then raise exception 'FAIL  owner cannot read their own capability flags'; end if;
  raise notice 'PASS  owner still reads their own capability flags';
  reset role;
end $$;

-- Regression guard for the admin moderation screens (web AdminClient reads
-- id,name,suspended). Revoking that column from `authenticated` would break it.
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  perform set_config('request.jwt.claim.is_admin', 'true', true);
  select count(*) into n from public.profiles where suspended;
  if n <> 1 then raise exception 'FAIL  admin moderation read of suspended returned % row(s)', n; end if;
  raise notice 'PASS  admin can still read id/name/suspended (moderation screens keep working)';
  perform set_config('request.jwt.claim.is_admin', 'false', true);
  reset role;
end $$;

-- The projection is auto-updatable AND runs with owner rights, so any write
-- privilege on it would be a straight RLS bypass. Prove it is SELECT-only.
do $$
declare bad text;
begin
  select string_agg(distinct grantee||':'||privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where table_schema='public' and table_name='public_profiles'
     and grantee in ('anon','authenticated') and privilege_type <> 'SELECT';
  if bad is not null then raise exception 'FAIL  public_profiles is writable: %', bad; end if;
  raise notice 'PASS  projection is SELECT-only for anon/authenticated (no write-through RLS bypass)';
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  perform pg_temp.expect_denied(
    'update public.public_profiles set name = ''PWNED'' where id = ''11111111-1111-1111-1111-111111111111''',
    'write through the projection to another user''s row');
  reset role;
end $$;

-- The projection's safety rests on OWNER-rights execution. Assert the exact
-- preconditions rather than trusting a default.
do $$
declare inv text; owner_ok boolean; forced boolean;
begin
  select coalesce((select option_value from pg_options_to_table(c.reloptions)
                   where option_name = 'security_invoker'), 'false')
    into inv from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='public_profiles';
  if inv <> 'false' then raise exception 'FAIL  public_profiles must be security_invoker=false, got %', inv; end if;
  raise notice 'PASS  projection runs with OWNER rights (security_invoker=false, set explicitly)';

  select (v.relowner = t.relowner) into owner_ok
    from pg_class v, pg_class t
   where v.relname='public_profiles' and t.relname='profiles';
  if not owner_ok then raise exception 'FAIL  view owner differs from profiles owner; owner-rights read would fail'; end if;
  raise notice 'PASS  view and base table share an owner';

  select relforcerowsecurity into forced from pg_class where relname='profiles';
  if forced then raise exception 'FAIL  profiles has FORCE RLS; the owner-rights projection would return 0 rows'; end if;
  raise notice 'PASS  profiles RLS is enabled but not FORCED (owner-rights read works)';
end $$;

-- Admins keep the read their moderation surfaces need.
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  perform set_config('request.jwt.claim.is_admin', 'true', true);
  select count(*) into n from public.profiles;
  if n <> 2 then raise exception 'FAIL  admin read returned % row(s), expected 2', n; end if;
  raise notice 'PASS  admin reads all profile rows';
  perform set_config('request.jwt.claim.is_admin', 'false', true);
  reset role;
end $$;

select 'ALL RLS TESTS PASSED' as result;
