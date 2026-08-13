#!/usr/bin/env bash
# Build a throwaway local database (shim + a minimal contact fixture + 0090) and
# run the optional-phone validation suite against it. Also reproduces the 0086
# defect first, so the suite is proving a fix rather than describing one, and
# proves the paired down-migration puts the old behaviour back.
#
# Nothing here touches a hosted project: it refuses any non-local PGHOST and it
# creates/drops its own database.
#
#   supabase/tests/run_phone_validation_tests.sh
set -uo pipefail

DB="${GNOME_PHONE_TEST_DB:-gnome_phone_validation_test}"
HOST="${PGHOST:-/tmp}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$here/../migrations"

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}." >&2; exit 2; }

dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true
createdb -h "$HOST" "$DB"
trap 'dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true' EXIT

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$here/supabase_shim.sql" 2>&1 | grep -v NOTICE || true

# Minimal stand-in for what save_onboarding_contact depends on: the two tables
# it writes and the state RPC it returns. Shapes copied from 0086; everything
# 0090 does not touch is left out. TEST FIXTURE ONLY.
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q <<'FIXTURE'
create table if not exists public.profiles (
  id uuid primary key,
  name text,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.user_private_contact (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  first_name    text,
  last_name     text,
  phone_e164    text,
  contact_email text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.user_private_contact enable row level security;
drop policy if exists user_private_contact_own on public.user_private_contact;
create policy user_private_contact_own on public.user_private_contact
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.my_onboarding_state()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r   record;
  p   record;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into r from public.user_private_contact where user_id = uid;
  select onboarding_completed_at, name into p from public.profiles where id = uid;
  return jsonb_build_object(
    'completed',     p.onboarding_completed_at is not null,
    'display_name',  p.name,
    'first_name',    r.first_name,
    'last_name',     r.last_name,
    'phone',         r.phone_e164,
    'contact_email', r.contact_email,
    'missing', (
      select coalesce(jsonb_agg(k), '[]'::jsonb) from (
        select 'first_name' as k where r.first_name is null
        union all select 'last_name' where r.last_name is null
        union all select 'contact_email' where r.contact_email is null
      ) m
    )
  );
end;
$$;
FIXTURE

# Send "no thanks" through whichever version of the RPC is installed and report
# what the caller was left with.
probe() {
  local u="$1"
  psql -h "$HOST" -d "$DB" -Atq \
    -c "insert into auth.users (id) values ('$u') on conflict do nothing;
        insert into public.profiles (id, name) values ('$u', 'Probe P.') on conflict do nothing;" \
    -c "select set_config('request.jwt.claims', json_build_object('sub','$u')::text, false)" \
    -c "select 'STORED=' || coalesce(public.save_onboarding_contact(p_phone => 'no thanks') ->> 'phone', 'NULL')" 2>&1
}

echo "installing the pre-fix (0086) function via the paired down-migration…"
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q \
  -f "$MIG/0090_down_phone_validation_fix.sql" >/dev/null 2>&1 \
  || { echo "down-migration failed to apply" >&2; exit 1; }

pre="$(probe 00000000-0000-0000-0000-0000000000d1)"
case "$pre" in
  *STORED=NULL*) echo "   PASS 0086 defect reproduced: 'no thanks' accepted, nothing stored" ;;
  *) echo "   FAIL expected the 0086 defect, got: $pre"; exit 1 ;;
esac

echo
echo "applying 0090_phone_validation_fix.sql…"
out="$(psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$MIG/0090_phone_validation_fix.sql" 2>&1)" \
  || { echo "0090 failed to apply" >&2; echo "$out" >&2; exit 1; }
echo "$out" | grep -v '^NOTICE' || true

echo
suite="$(psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -P pager=off -f "$here/phone_validation_suite.sql" 2>&1)"
rc=$?
echo "$suite" | grep -vE '^(CREATE|GRANT|DO|SET|INSERT|UPDATE|REVOKE|NOTIFY)'
[ "$rc" -eq 0 ] || { echo "the suite itself errored out — the numbers above are incomplete" >&2; exit 1; }

echo
echo "re-applying 0090 (must be idempotent)…"
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q \
  -f "$MIG/0090_phone_validation_fix.sql" >/dev/null 2>&1 \
  && echo "   PASS 0090 re-applies cleanly" || { echo "   FAIL 0090 is not idempotent"; exit 1; }

post="$(probe 00000000-0000-0000-0000-0000000000d2)"
case "$post" in
  *INVALID_PHONE*) echo "   PASS after 0090 the same input raises INVALID_PHONE" ;;
  *) echo "   FAIL expected INVALID_PHONE, got: $post"; exit 1 ;;
esac

echo "applying the paired down-migration…"
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q \
  -f "$MIG/0090_down_phone_validation_fix.sql" >/dev/null 2>&1 \
  && echo "   PASS 0090 rolls back cleanly" || { echo "   FAIL rollback failed"; exit 1; }

back="$(probe 00000000-0000-0000-0000-0000000000d3)"
case "$back" in
  *STORED=NULL*) echo "   PASS rollback restored the 0086 behaviour exactly" ;;
  *) echo "   FAIL rollback left something else behind: $back"; exit 1 ;;
esac

grants="$(psql -h "$HOST" -d "$DB" -Atq -c "
  select case when has_function_privilege('authenticated', f, 'execute') then 'authenticated' else '-' end
      || case when has_function_privilege('anon', f, 'execute') then '+anon' else '' end
    from (select 'public.save_onboarding_contact(text,text,text,text,boolean)'::text as f) s")"
[ "$grants" = "authenticated" ] && echo "   PASS execute is still granted to authenticated, not anon" \
                               || { echo "   FAIL execute grants are '$grants'"; exit 1; }
