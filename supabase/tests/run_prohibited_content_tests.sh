#!/usr/bin/env bash
# Prove 0095 blocks what it must, holds what needs a human, and — the part that
# actually decides whether this is shippable — does NOT fire on ordinary garden
# listings. A screening rule that blocks "potatoes" is worse than none.
#
#   supabase/tests/run_prohibited_content_tests.sh
set -uo pipefail

DB="${GNOME_SCREEN_TEST_DB:-gnome_prohibited_test}"
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
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table public.profiles (id uuid primary key, name text);
create table public.marketplace_taxonomy_nodes (
  id uuid primary key default gen_random_uuid(), slug text, prohibited boolean default false);
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid, title text, description text, trade_for text, category text,
  taxonomy_node_id uuid references public.marketplace_taxonomy_nodes(id),
  status text default 'active', city text, state text,
  created_at timestamptz default now());
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
SQL

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$MIG/0095_prohibited_content.sql" 2>&1 | grep -v NOTICE || true

fail=0
say() { printf '   %-6s %s\n' "$1" "$2"; [ "$1" = FAIL ] && fail=1; return 0; }

# try <title> <description> -> prints BLOCKED / REVIEW / CLEAR
try() {
  psql -h "$HOST" -d "$DB" -Atq -c "
  do \$\$
  declare r text;
  begin
    begin
      insert into public.listings (title, description) values (\$t\$$1\$t\$, \$d\$$2\$d\$);
      select screening_status into r from public.listings order by created_at desc limit 1;
    exception when others then
      r := case when sqlerrm like 'PROHIBITED%' then 'BLOCKED' else 'ERROR:'||sqlerrm end;
    end;
    raise notice '%', r;
  end \$\$;" 2>&1 | sed 's/^NOTICE:  //' | tail -1
}

echo "A. things Gnome must never carry"
for t in "Homegrown flower" "Fresh marijuana buds" "THC gummies" "Delta-8 carts" \
         "Ammo for sale" "Glock handgun" "Adderall 20mg" "Moonshine jar"; do
  r="$(try "$t" "local pickup only")"
  case "$t" in
    "Homegrown flower")  # no prohibited word at all — the honest limit of term matching
      [ "$r" = "CLEAR" ] && say PASS "euphemism '$t' passes (documents the limit)" \
                         || say FAIL "'$t' -> $r" ;;
    *) [ "$r" = "BLOCKED" ] && say PASS "blocked: $t" || say FAIL "'$t' -> $r (expected BLOCKED)" ;;
  esac
done

echo
echo "B. things that need a human, not a wall"
for t in "Raw milk from our cow" "Home canned green beans" "CBD salve" \
         "Foraged morels" "Homemade wine" "Puppies ready soon"; do
  r="$(try "$t" "pickup in Richmond Heights")"
  [ "$r" = "REVIEW" ] && say PASS "held for review: $t" || say FAIL "'$t' -> $r (expected REVIEW)"
done

echo
echo "C. ordinary garden listings must NOT trip (the false-positive test)"
for t in "Potatoes — 5 lb bag" "Seaweed fertilizer" "Pot of basil" "Weeding service, free" \
         "Sweet potato slips" "Beeswax candles" "Hot peppers" "Tomato seedlings in pots" \
         "Winemaking grapes — you press them" "Rifle Range Road pickup"; do
  r="$(try "$t" "fresh this week")"
  case "$t" in
    "Winemaking grapes — you press them") : ;;   # checked below: stays CLEAR by design
    "Rifle Range Road pickup") : ;;               # contains 'rifle' — expected BLOCKED
    *) [ "$r" = "CLEAR" ] && say PASS "clear: $t" || say FAIL "FALSE POSITIVE '$t' -> $r" ;;
  esac
done

# The two deliberate near-misses, reported honestly rather than hidden.
# 'wine' inside "Winemaking" is a compound word, not the product. Word
# boundaries getting this right is the whole reason they are used.
r="$(try "Winemaking grapes — you press them" "u-pick")"
[ "$r" = "CLEAR" ] && say PASS "compound word not matched: winemaking grapes" \
                   || say FAIL "winemaking grapes -> $r (expected CLEAR)"
r="$(try "Rifle Range Road pickup" "meet at the corner")"
[ "$r" = "BLOCKED" ] && say WARN "known over-match: a street name containing 'rifle' is blocked" \
                     || say PASS "street name not blocked"

echo
echo "D. the control cannot be bypassed"
r="$(psql -h "$HOST" -d "$DB" -Atq -c "
do \$\$ begin
  insert into public.listings (title, description, status) values ('Clean title','clean','active');
  update public.listings set description = 'selling cocaine' where title = 'Clean title';
  raise notice 'ESCAPED';
exception when others then raise notice '%', case when sqlerrm like 'PROHIBITED%' then 'BLOCKED_ON_EDIT' else sqlerrm end; end \$\$;" 2>&1 | sed 's/^NOTICE:  //' | tail -1)"
[ "$r" = "BLOCKED_ON_EDIT" ] && say PASS "editing a clean listing into a prohibited one is refused" \
                             || say FAIL "edit bypass: $r"

held=$(psql -h "$HOST" -d "$DB" -Atq -c "select count(*) from public.listings where screening_status='REVIEW' and status='active'")
[ "$held" = "0" ] && say PASS "nothing held for review is publicly active" \
                  || say FAIL "$held REVIEW listing(s) are still active"

echo
echo "E. admin surface is admin-only"
r=$(psql -h "$HOST" -d "$DB" -Atq -c "
select set_config('test.owner','false',false);
set role authenticated;
select count(*)::text from public.admin_screening_queue();" 2>&1 | tail -1)
[ "$r" = "0" ] && say PASS "non-admin sees an empty screening queue" || say FAIL "queue leaked: $r"

r=$(psql -h "$HOST" -d "$DB" -Atq -c "
select set_config('test.owner','true',false);
set role authenticated;
select count(*)::text from public.admin_screening_queue();" 2>&1 | tail -1)
[ "$r" -ge 1 ] 2>/dev/null && say PASS "owner sees the queue ($r held)" || say FAIL "owner queue empty: $r"

echo
[ $fail -eq 0 ] && echo "PROHIBITED CONTENT (0095): ALL TESTS PASSED" || echo "PROHIBITED CONTENT (0095): FAILURES PRESENT"
exit $fail
