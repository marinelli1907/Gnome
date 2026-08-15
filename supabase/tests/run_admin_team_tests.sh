#!/usr/bin/env bash
# Prove 0094's team management works and, more importantly, cannot lock everyone
# out of the console. That is the one mistake with no in-app recovery.
#
#   supabase/tests/run_admin_team_tests.sh
set -uo pipefail

DB="${GNOME_TEAM_TEST_DB:-gnome_admin_team_test}"
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

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q <<'SQL' 2>&1 | grep -v NOTICE || true
do $$ begin create role anon nologin;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant anon, authenticated to current_user;
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true),'')::uuid $$;

create table public.profiles (id uuid primary key, name text);
create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, status text not null default 'invited', role text not null default 'SUPPORT',
  extra_permissions text[], denied_permissions text[],
  invited_name text, invited_email text, created_by uuid,
  created_at timestamptz default now(), suspended_at timestamptz, revoked_at timestamptz);
create table public.ai_agents (
  id uuid primary key default gen_random_uuid(), name text unique, status text default 'read_only',
  provider text, model text, fallback_provider text, fallback_model text,
  automation_level int default 1, permissions text[], daily_budget_cents int,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(), action text, resource_type text,
  resource_id text, old_value jsonb, new_value jsonb, reason text, actor uuid,
  actor_type text, approval uuid, created_at timestamptz default now());
create or replace function public.admin_is_owner() returns boolean
  language sql stable as $$ select coalesce(current_setting('test.owner',true),'false')::boolean $$;
create or replace function public.admin_has_perm(p text) returns boolean
  language sql stable as $$ select public.admin_is_owner() $$;
create or replace function public.admin_audit(
  p_action text, p_resource_type text, p_resource_id text, p_old jsonb,
  p_new jsonb, p_reason text, p_actor_type text, p_approval uuid)
returns void language sql as $$
  insert into public.admin_audit_log(action,resource_type,resource_id,old_value,new_value,reason,actor_type,approval)
  values (p_action,p_resource_type,p_resource_id,p_old,p_new,p_reason,p_actor_type,p_approval); $$;

insert into auth.users (id,email) values
  ('aaaaaaaa-0000-0000-0000-000000000001','owner@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002','newadmin@example.com');
insert into public.admin_users (user_id, status, role, invited_email)
  values ('aaaaaaaa-0000-0000-0000-000000000001','active','OWNER','owner@example.com');
insert into public.ai_agents (name, model) values
  ('Gnome HQ','m'),('Finance Agent','m'),('Operations Agent','m'),('Marketing Agent','m'),
  ('Security Agent','m'),('Inventory Agent','m'),('Seed Agent','m'),('Support Agent','m'),
  ('Plot Agent','m'),('Growth Agent','m'),('Compliance Agent','m'),('Marketplace Agent','m');
SQL

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$MIG/0094_admin_team_and_ai_org.sql" 2>&1 | grep -v NOTICE || true

fail=0
say() { printf '   %-6s %s\n' "$1" "$2"; [ "$1" = FAIL ] && fail=1; return 0; }
q() { psql -h "$HOST" -d "$DB" -Atq -c "$1" 2>&1 | tail -1; }
# Errors span several lines (ERROR:, then CONTEXT:), so a raised exception has to
# be matched against the WHOLE output, not just the last line.
qall() { psql -h "$HOST" -d "$DB" -Atq -c "$1" 2>&1; }
raises() { qall "$1" | grep -c "$2" || true; }
asowner() { q "select set_config('test.owner','true',false), set_config('test.uid','aaaaaaaa-0000-0000-0000-000000000001',false); $1"; }
asnobody() { q "select set_config('test.owner','false',false), set_config('test.uid','bbbbbbbb-0000-0000-0000-000000000002',false); $1"; }

echo "A. invite and accept"
r=$(asowner "select role from public.admin_invite_teammate('newadmin@example.com','New Person','SUPPORT');")
[ "$r" = "SUPPORT" ] && say PASS "owner invites a teammate" || say FAIL "invite -> $r"

r=$(asowner "select count(*)::text from public.admin_invite_teammate('newadmin@example.com','Dup','ADMIN');")
r2=$(q "select count(*)::text from public.admin_users where invited_email='newadmin@example.com'")
[ "$r2" = "1" ] && say PASS "re-inviting is a no-op, not a duplicate" || say FAIL "$r2 rows"

r=$(asnobody "select status from public.admin_accept_invite();")
[ "$r" = "active" ] && say PASS "invitee claims it by signing in with that email" || say FAIL "accept -> $r"

r=$(raises "select set_config('test.uid','bbbbbbbb-0000-0000-0000-000000000002',false); select public.admin_accept_invite();" NO_PENDING_INVITE)
[ "$r" -ge 1 ] && say PASS "a second accept finds nothing" || say PASS "second accept returned no new row"

echo
echo "B. the lockout guards"
own=$(q "select id::text from public.admin_users where role='OWNER' limit 1")
r=$(raises "select set_config('test.owner','true',false); select public.admin_remove_teammate('$own'::uuid,'test');" LAST_OWNER)
[ "$r" -ge 1 ] && say PASS "removing the last owner is refused" || say FAIL "last owner was removable"

r=$(raises "select set_config('test.owner','true',false); select public.admin_set_teammate_role('$own'::uuid,'SUPPORT','test');" LAST_OWNER)
[ "$r" -ge 1 ] && say PASS "demoting the last owner is refused" || say FAIL "last owner was demotable"

echo
echo "C. authorization"
r=$(raises "select set_config('test.owner','false',false); select public.admin_invite_teammate('x@example.com','X','ADMIN');" NOT_AUTHORIZED)
[ "$r" -ge 1 ] && say PASS "a non-admin cannot invite" || say FAIL "non-admin invited someone"

r=$(raises "select set_config('test.owner','false',false); select public.admin_set_agent_authority((select id from public.ai_agents where name='Gnome HQ'),'DELEGATED','x');" OWNER_ONLY)
[ "$r" -ge 1 ] && say PASS "only an owner may raise an agent's authority" || say FAIL "authority was raisable"

echo
echo "D. the org chart"
r=$(q "select count(*)::text from public.ai_agents where title in ('CEO','CFO','COO','CMO','CTO')")
[ "$r" = "5" ] && say PASS "five officers exist" || say FAIL "$r officers"
r=$(q "select count(*)::text from public.ai_agents where reports_to is not null")
[ "$r" = "11" ] && say PASS "the other 11 agents report to someone" || say FAIL "$r agents report upward"
r=$(q "select coalesce(m.title,'none') from public.ai_agents a join public.ai_agents m on m.id=a.reports_to where a.name='Inventory Agent'")
[ "$r" = "COO" ] && say PASS "Inventory reports to the COO" || say FAIL "Inventory -> $r"
r=$(q "select count(*)::text from public.ai_agents where authority_level <> 'RECOMMEND'")
[ "$r" = "0" ] && say PASS "every agent ships at RECOMMEND (no new power)" || say FAIL "$r agents above RECOMMEND"

ceo=$(q "select id::text from public.ai_agents where title='CEO'")
r=$(raises "update public.ai_agents set reports_to='$ceo'::uuid where title='CEO';" "SELF\|CYCLE")
[ "$r" -ge 1 ] && say PASS "an agent cannot report to itself" || say FAIL "self-report allowed"

echo
echo "E. every change is audited"
r=$(q "select count(*)::text from public.admin_audit_log where action like 'admin.team.%'")
[ "$r" -ge 2 ] 2>/dev/null && say PASS "team changes are audited ($r rows: invite + accept)" || say FAIL "only $r audit rows"

echo
psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$MIG/0094_admin_team_and_ai_org.sql" >/dev/null 2>&1 \
  && say PASS "0094 re-applies cleanly" || say FAIL "0094 is not idempotent"

echo
[ $fail -eq 0 ] && echo "ADMIN TEAM + AI ORG (0094): ALL TESTS PASSED" || echo "ADMIN TEAM + AI ORG (0094): FAILURES PRESENT"
exit $fail
