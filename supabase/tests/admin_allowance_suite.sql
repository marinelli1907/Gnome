-- 0108: the admin-gated read. The underlying numbers are proven in allowance_usage_suite.sql;
-- what is tested here is the wrapper's own job — the admin gate, faithful passthrough, and that
-- the grant 0107 removed stays removed.
\set ON_ERROR_STOP on
set client_min_messages = warning;
create temporary table _x (n int, name text, ok boolean, detail text);
create sequence if not exists _xn start 1;
create or replace function pg_temp.ck(a text, b boolean, c text default '')
returns void language plpgsql as $$ begin insert into _x values (nextval('_xn')::int,a,b,c); end $$;

-- Passthrough and the gate are two different jobs, so they are tested separately: is_admin() is
-- forced true here, and restored to false before the gate assertions below.
create or replace function public.is_admin() returns boolean language sql stable as $f$ select true $f$;

do $$
declare u uuid := '00000000-0000-0000-0000-0000000000b1'; m uuid; v record; n int;
begin
  insert into auth.users (id, email) values (u,'farmer@example.com') on conflict do nothing;
  insert into public.markets (owner_id, plan, name) values (u,'sponsor','Big Farm') returning id into m;
  for n in 1..5 loop
    insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
    values (u,m,'F'||n,'vegetables',500,'sale','active', now() + interval '7 days');
  end loop;
  -- Non-Sell must not appear in the admin listing counts either.
  insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
  values (u,m,'Giveaway','vegetables',null,'free','active', now() + interval '7 days');

  select * into v from public.admin_market_allowance(m);
  perform pg_temp.ck('admin sees the Market name', v.market_name = 'Big Farm', v.market_name);
  perform pg_temp.ck('admin sees the owner email', v.owner_email = 'farmer@example.com', v.owner_email);
  perform pg_temp.ck('customer-facing name is Farm', v.display_name = 'Farm', v.display_name);
  perform pg_temp.ck('internal enum is exposed to admin as sponsor', v.plan::text = 'sponsor', v.plan::text);
  perform pg_temp.ck('unlimited allowance passes through as NULL', v.publishes_allowed is null);
  perform pg_temp.ck('unlimited remaining passes through as NULL', v.publishes_remaining is null);
  perform pg_temp.ck('Farm actual publishes are real, not zero', v.publishes_actual = 5, v.publishes_actual::text);
  perform pg_temp.ck('Farm included used is legitimately 0', v.publishes_used = 0, v.publishes_used::text);
  perform pg_temp.ck('active Sell listings counted, Share Free excluded',
                     v.active_listings = 5, v.active_listings::text);
  perform pg_temp.ck('lifetime fields are present', v.paid_publishes_lifetime = 0 and v.paid_cents_lifetime = 0);
end $$;

create or replace function public.is_admin() returns boolean language sql stable as $f$ select false $f$;

do $$
declare bad boolean := false;
begin
  -- is_admin() is false for this session, so the gate must refuse.
  begin
    perform * from public.admin_market_allowance('00000000-0000-0000-0000-000000000000');
    bad := true;
  exception when others then
    perform pg_temp.ck('a non-admin caller is refused', position('admin only' in sqlerrm) > 0, sqlerrm);
  end;
  if bad then perform pg_temp.ck('a non-admin caller is refused', false, 'no exception raised'); end if;

  perform pg_temp.ck('anon cannot execute the admin RPC',
    not has_function_privilege('anon','public.admin_market_allowance(uuid)','execute'));
  perform pg_temp.ck('authenticated CAN reach it (is_admin is the gate, not the grant)',
    has_function_privilege('authenticated','public.admin_market_allowance(uuid)','execute'));
  -- The regression that matters: the UI must not have caused 0107's revoke to be undone.
  perform pg_temp.ck('market_allowance_usage is STILL revoked from authenticated',
    not has_function_privilege('authenticated','public.market_allowance_usage(uuid)','execute'));
end $$;

\echo ''
select format('%s  %-58s %s', lpad(n::text,3,' '), name, case when ok then 'PASS' else 'FAIL  '||detail end)
from _x order by n;
\echo ''
select format('admin allowance suite: %s/%s passed', count(*) filter (where ok), count(*)) from _x;
do $$ declare bad int; begin select count(*) into bad from _x where not ok;
  if bad > 0 then raise exception '% failed', bad; end if; end $$;
