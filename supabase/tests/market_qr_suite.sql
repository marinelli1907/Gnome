-- Behavioural proof for 0111: the durable Market QR.
--
-- The two mandated durability tests are here verbatim — rename and downgrade — because "the
-- printed QR keeps working" is the entire product promise. Run against a THROWAWAY database.

\set ON_ERROR_STOP on
set client_min_messages = warning;

create temporary table _q (n int, name text, ok boolean, detail text);
create sequence if not exists _qn start 1;
create or replace function pg_temp.ck(a text, b boolean, c text default '')
returns void language plpgsql as $$ begin insert into _q values (nextval('_qn')::int,a,b,c); end $$;

create or replace function pg_temp.mk_user(p_id uuid, p_plan public.market_plan, p_name text)
returns uuid language plpgsql as $$
declare m uuid;
begin
  insert into auth.users (id) values (p_id) on conflict do nothing;
  insert into public.profiles (id, name) values (p_id, p_name) on conflict do nothing;
  select id into m from public.markets where owner_id = p_id limit 1;
  if m is null then
    insert into public.markets (owner_id, plan, name, slug)
    values (p_id, p_plan, p_name, lower(replace(p_name,' ','-'))) returning id into m;
  else
    update public.markets set plan = p_plan, name = p_name,
      slug = coalesce(slug, lower(replace(p_name,' ','-'))) where id = m;
    delete from public.markets where owner_id = p_id and id <> m;
  end if;
  return m;
end $$;

-- my_market_qr() as a given user (shim auth.uid reads request.jwt.claims). Typed OUT columns,
-- because an untyped record's fields cannot be referenced by callers.
create or replace function pg_temp.qr_as(p_user uuid)
returns table (code text, entitled boolean, slug text, market_name text)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  return query select * from public.my_market_qr();
  perform set_config('request.jwt.claims', '', true);
end $$;

do $$
declare
  u_free uuid := '00000000-0000-0000-0000-0000000000f1';
  u_pro  uuid := '00000000-0000-0000-0000-0000000000f2';
  u_max  uuid := '00000000-0000-0000-0000-0000000000f3';
  u_farm uuid := '00000000-0000-0000-0000-0000000000f4';
  m_pro uuid; v record; v2 record; r record; code1 text; slug0 text; n int;
begin
  perform pg_temp.mk_user(u_free, 'free', 'Free Stand');
  m_pro := pg_temp.mk_user(u_pro, 'grower', 'Pro Stand');
  perform pg_temp.mk_user(u_max, 'farm', 'Max Stand');
  perform pg_temp.mk_user(u_farm, 'sponsor', 'Farm Stand');

  -- ---- entitlement ladder ----------------------------------------------
  select * into v from pg_temp.qr_as(u_free);
  perform pg_temp.ck('FREE: qr tools locked', v.entitled = false);
  perform pg_temp.ck('FREE: no identity is issued', v.code is null);
  perform pg_temp.ck('FREE: no row was silently created',
    not exists (select 1 from public.market_qr mq join public.markets m on m.id = mq.market_id
                 where m.owner_id = u_free));
  perform pg_temp.ck('FREE: market link still available for sharing', v.slug is not null, v.slug);

  select * into v from pg_temp.qr_as(u_pro);
  perform pg_temp.ck('PRO: entitled', v.entitled);
  perform pg_temp.ck('PRO: a durable identity is issued', v.code ~ '^[0-9a-f]{16}$', v.code);
  code1 := v.code;
  select * into v2 from pg_temp.qr_as(u_pro);
  perform pg_temp.ck('PRO: second access returns the SAME code — one identity, ever',
    v2.code = code1, v2.code);

  perform pg_temp.ck('MAX: entitled', (select q.entitled from pg_temp.qr_as(u_max) q));
  perform pg_temp.ck('FARM: entitled', (select q.entitled from pg_temp.qr_as(u_farm) q));

  -- ---- public resolution + scan ledger ----------------------------------
  -- The signup trigger mints the slug, so assert against what the market ACTUALLY carries rather
  -- than a fixture guess — which is truer to the durability promise anyway.
  select mk.slug into slug0 from public.markets mk where mk.id = m_pro;
  select * into r from public.resolve_market_qr(code1);
  perform pg_temp.ck('resolution returns the current public slug', r.slug = slug0, r.slug);
  select count(*)::int into n from public.market_qr_scans where code = code1;
  perform pg_temp.ck('a successful scan is logged', n = 1, n::text);
  perform pg_temp.ck('the scan ledger carries no PII columns',
    (select count(*) from information_schema.columns
      where table_name = 'market_qr_scans'
        and column_name in ('ip','user_agent','lat','lng','scanner_id','email')) = 0);

  select * into r from public.resolve_market_qr('deadbeefdeadbeef');
  perform pg_temp.ck('an unknown code resolves to nothing', r.slug is null);
  select * into r from public.resolve_market_qr('  ' || upper(code1) || '  ');
  perform pg_temp.ck('case and padding do not break a printed code', r.slug = slug0, r.slug);

  -- ---- MANDATORY: rename test ------------------------------------------
  update public.markets set name = 'Totally Renamed Farmstand' where id = m_pro;
  select * into r from public.resolve_market_qr(code1);
  perform pg_temp.ck('RENAME: the old printed QR still opens the same Market',
    r.slug = slug0 and r.name = 'Totally Renamed Farmstand',
    format('%s / %s', r.slug, r.name));

  -- ---- MANDATORY: downgrade test ---------------------------------------
  update public.markets set plan = 'free' where id = m_pro;
  select * into r from public.resolve_market_qr(code1);
  perform pg_temp.ck('DOWNGRADE: the old printed QR still opens the Market', r.slug = slug0, r.slug);
  select * into v from pg_temp.qr_as(u_pro);
  perform pg_temp.ck('DOWNGRADE: seller still sees their issued code', v.code = code1);
  perform pg_temp.ck('DOWNGRADE: premium tools are locked', v.entitled = false);
  perform pg_temp.ck('DOWNGRADE: the market link stays shareable', v.slug = slug0, v.slug);

  -- ---- moderation wins over durability ---------------------------------
  update public.markets set status = 'suspended' where id = m_pro;
  select * into r from public.resolve_market_qr(code1);
  perform pg_temp.ck('a suspended Market does not resolve', r.slug is null);
  select count(*)::int into n from public.market_qr_scans where code = code1;
  perform pg_temp.ck('a refused resolution logs no scan', n = 4, n::text);  -- 4 successes above
  update public.markets set status = 'active' where id = m_pro;

  -- ---- admin ------------------------------------------------------------
  create or replace function public.is_admin() returns boolean language sql stable as $f$ select true $f$;
  select * into r from public.admin_market_qr(m_pro);
  perform pg_temp.ck('ADMIN: sees code, slug, entitlement and scan counts',
    r.code = code1 and r.market_slug = slug0 and r.entitled = false and r.scans_total = 4,
    format('%s %s %s %s', r.code, r.market_slug, r.entitled, r.scans_total));
  create or replace function public.is_admin() returns boolean language sql stable as $f$ select false $f$;
  begin
    perform * from public.admin_market_qr(m_pro);
    perform pg_temp.ck('ADMIN: non-admin refused', false, 'no exception');
  exception when others then
    perform pg_temp.ck('ADMIN: non-admin refused', position('admin only' in sqlerrm) > 0, sqlerrm);
  end;

  -- ---- security ---------------------------------------------------------
  perform pg_temp.ck('anon can execute the public resolver',
    has_function_privilege('anon','public.resolve_market_qr(text)','execute'));
  perform pg_temp.ck('anon cannot reach seller or admin QR RPCs',
    not has_function_privilege('anon','public.my_market_qr()','execute')
    and not has_function_privilege('anon','public.admin_market_qr(uuid)','execute'));
  perform pg_temp.ck('clients cannot read the QR tables directly',
    not has_table_privilege('authenticated','public.market_qr','select')
    and not has_table_privilege('authenticated','public.market_qr_scans','select'));
  -- The structural guarantee: my_market_qr takes no argument, so there is nothing to pass to
  -- request another seller's asset.
  perform pg_temp.ck('my_market_qr has no market parameter to spoof',
    (select p.pronargs from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname='public' and p.proname='my_market_qr') = 0);
end $$;

\echo ''
select format('%s  %-64s %s', lpad(n::text,3,' '), name, case when ok then 'PASS' else 'FAIL  '||detail end)
from _q order by n;
\echo ''
select format('market qr suite: %s/%s passed', count(*) filter (where ok), count(*)) from _q;
do $$ declare bad int; begin select count(*) into bad from _q where not ok;
  if bad > 0 then raise exception '% failed', bad; end if; end $$;
