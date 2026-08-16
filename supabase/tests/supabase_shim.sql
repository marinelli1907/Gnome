-- Minimal local stand-in for the Supabase-managed parts of a project, so the
-- repository's migrations can be replayed on a THROWAWAY local Postgres.
--
-- This is a TEST FIXTURE ONLY. It is never applied to any hosted project; it
-- exists so `run_migration_tests.sh` can prove a migration builds a database
-- from scratch. It deliberately mirrors only what the migrations touch:
-- the three PostgREST roles, auth.users/uid()/jwt()/role(), the storage
-- objects/buckets tables, extensions.digest, and a no-op cron shim (pg_cron
-- is not installable on a plain local server).

do $$ begin create role anon nologin;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin;  exception when duplicate_object then null; end $$;
-- Supabase-managed roles that appear as GRANT targets in a production pg_dump. Without them a
-- baseline restore reports "role ... does not exist" for every such grant, which looks like a
-- defect in the dump rather than a gap in this shim.
do $$ begin create role postgres nologin superuser; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_admin nologin;     exception when duplicate_object then null; end $$;
do $$ begin create role authenticator nologin;      exception when duplicate_object then null; end $$;
do $$ begin create role supabase_auth_admin nologin;    exception when duplicate_object then null; end $$;
do $$ begin create role supabase_storage_admin nologin; exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to current_user;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create schema if not exists cron;
create extension if not exists pgcrypto with schema extensions;

grant usage on schema auth, storage, extensions, public to anon, authenticated, service_role;

-- auth.users: only the columns the migrations actually read.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  -- public_markets and 0015's trust layer both derive "verified email" from this.
  email_confirmed_at timestamptz
);

-- PostgREST sets request.jwt.claims per request; these read it exactly as
-- Supabase's own definitions do.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', 'anon')
$$;

create table if not exists storage.buckets (
  id text primary key, name text, public boolean default false,
  created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$ select string_to_array(name, '/') $$;

-- pg_cron is unavailable on a plain server: accept and record the schedule so
-- migrations that call cron.schedule() succeed without pretending to run jobs.
create table if not exists cron.job (
  jobid bigserial primary key, schedule text, command text, jobname text
);
create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint language sql as $$
  insert into cron.job (schedule, command, jobname) values (schedule, command, job_name)
  returning jobid
$$;
create or replace function cron.schedule(schedule text, command text)
returns bigint language sql as $$
  insert into cron.job (schedule, command) values (schedule, command) returning jobid
$$;
create or replace function cron.unschedule(job_name text) returns boolean
  language sql as $$ delete from cron.job where jobname = job_name returning true $$;
