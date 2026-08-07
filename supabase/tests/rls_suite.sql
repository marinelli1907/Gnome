-- Gnome — authorization & policy test suite.
--
-- Runs entirely inside one transaction that is NEVER committed: every
-- fixture write rolls back, so it is safe against the live database.
-- Roles are simulated exactly the way PostgREST does it (SET LOCAL ROLE +
-- request.jwt.claims), so what passes here is what the real API enforces.
--
-- Run: paste into the SQL editor (or supabase db execute / MCP execute_sql)
-- WITHOUT adding a COMMIT. Results come back as the final SELECT.
-- Expected: every row pass = true.

begin;

create temp table t_results (n serial, name text, pass boolean, detail text);
grant all on t_results to public;
grant usage, select on sequence t_results_n_seq to public;

-- Well-known fixtures (demo accounts + owner)
-- maria d0000001-… grower plan · tom d0000002-… free · daniel 3e64f6d5-… admin
-- maria's plot listing: 48aa3322-deda-48b2-a892-3e8e9a77b1e5

-- ---------------------------------------------------------------- T1 ownership
select set_config('request.jwt.claims',
  '{"sub":"d0000002-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  update public.listings set title = 'hijacked'
    where id = '48aa3322-deda-48b2-a892-3e8e9a77b1e5';
  get diagnostics n = row_count;
  insert into t_results (name, pass, detail)
    values ('T1 user cannot update another user''s listing', n = 0, n || ' rows affected');
end $$;
reset role;

-- ------------------------------------------------------------ T2 claims privacy
select set_config('request.jwt.claims',
  '{"sub":"d0000002-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.claims c
    where c.claimer_id <> auth.uid()
      and c.listing_id not in (select id from public.listings where owner_id = auth.uid());
  insert into t_results (name, pass, detail)
    values ('T2 user sees no third-party claims', n = 0, n || ' foreign claims visible');
end $$;
reset role;

-- ------------------------------------------------------- T3 plan limit enforced
select set_config('request.jwt.claims',
  '{"sub":"d0000002-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare i int; hit boolean := false; mid uuid;
begin
  select id into mid from public.markets where owner_id = auth.uid() limit 1;
  begin
    for i in 1..15 loop
      insert into public.listings (owner_id, market_id, listing_type, kind, title, category, photos, city, state, status)
      values (auth.uid(), mid, 'free', 'offer', 'limit test ' || i, 'vegetables', '{}', 'X', 'OH', 'active');
    end loop;
  exception when others then
    hit := sqlerrm like '%PLAN_LIMIT_REACHED%';
  end;
  insert into t_results (name, pass, detail)
    values ('T3 free-plan active-listing cap enforced server-side', hit,
            case when hit then 'PLAN_LIMIT_REACHED raised' else 'no limit raised after 15 inserts' end);
end $$;
reset role;

-- --------------------------------------------------------- T4 plot plan gate
select set_config('request.jwt.claims',
  '{"sub":"d0000002-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare hit boolean := false; mid uuid;
begin
  select id into mid from public.markets where owner_id = auth.uid() limit 1;
  begin
    insert into public.listings (owner_id, market_id, listing_type, kind, title, category, photos, price_cents, city, state, status)
    values (auth.uid(), mid, 'plot', 'offer', 'gate test', 'vegetables', '{}', 1000, 'X', 'OH', 'active');
  exception when others then
    hit := sqlerrm like '%PLOTS_REQUIRE_PLAN%';
  end;
  insert into t_results (name, pass, detail)
    values ('T4 plot listings gated to paid plans', hit,
            case when hit then 'PLOTS_REQUIRE_PLAN raised' else 'free plan created a plot' end);
end $$;
reset role;

-- ------------------------------------------------- T5 exact-location privacy
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare blocked boolean := false; v numeric;
begin
  begin
    execute 'select lat from public.listings limit 1' into v;
  exception when insufficient_privilege then
    blocked := true;
  end;
  insert into t_results (name, pass, detail)
    values ('T5 anon cannot read exact coordinates', blocked,
            case when blocked then 'permission denied as designed' else 'lat readable!' end);
end $$;
reset role;

-- ------------------------------------------------- T6 messaging privacy floor
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare n int := 0; blocked boolean := false;
begin
  begin
    select count(*) into n from public.claim_messages;
  exception when insufficient_privilege then
    blocked := true; n := 0;
  end;
  insert into t_results (name, pass, detail)
    values ('T6 anon sees zero pickup-chat messages', blocked or n = 0, n || ' visible');
end $$;
reset role;

-- ------------------------------------------------------- T7 admin authorization
select set_config('request.jwt.claims',
  '{"sub":"d0000002-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int; m int;
begin
  select count(*) into n from public.reports;
  update public.profiles set suspended = true
    where id = 'd0000001-0000-0000-0000-000000000001';
  get diagnostics m = row_count;
  insert into t_results (name, pass, detail)
    values ('T7a non-admin: no reports visible, cannot suspend anyone',
            n = 0 and m = 0, n || ' reports, ' || m || ' suspensions');
end $$;
reset role;

select set_config('request.jwt.claims',
  '{"sub":"3e64f6d5-9c3e-436a-b48d-be96edfba39a","role":"authenticated"}', true);
set local role authenticated;
do $$
declare m int; ok boolean;
begin
  perform 1 from public.reports limit 1;  -- must not error for an admin
  update public.listings set status = 'removed'
    where id = '48aa3322-deda-48b2-a892-3e8e9a77b1e5';
  get diagnostics m = row_count;
  select public.is_admin() into ok;
  insert into t_results (name, pass, detail)
    values ('T7b admin: is_admin() true, can moderate a foreign listing',
            ok and m = 1, 'is_admin=' || ok || ', rows=' || m);
end $$;
reset role;

-- ------------------------------------------------------------ T8 suspension
update public.profiles set suspended = true
  where id = 'd0000002-0000-0000-0000-000000000002';
select set_config('request.jwt.claims',
  '{"sub":"d0000002-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare blocked boolean := false; mid uuid;
begin
  select id into mid from public.markets where owner_id = auth.uid() limit 1;
  begin
    insert into public.listings (owner_id, market_id, listing_type, kind, title, category, photos, city, state, status)
    values (auth.uid(), mid, 'free', 'offer', 'suspended test', 'vegetables', '{}', 'X', 'OH', 'active');
  exception when insufficient_privilege then
    blocked := true;
  end;
  insert into t_results (name, pass, detail)
    values ('T8 suspended user cannot create listings', blocked,
            case when blocked then 'RLS rejected insert' else 'suspended user posted!' end);
end $$;
reset role;

-- --------------------------------------------------------- T9 events guard
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare bad boolean := false; big boolean := false; ident boolean := false; okd boolean := false;
begin
  begin
    insert into public.events (event_type, metadata) values ('web_evil', '{}');
  exception when others then bad := sqlerrm like '%EVENT_NOT_ALLOWED%'; end;
  begin
    insert into public.events (event_type, metadata)
      values ('web_zip_search', jsonb_build_object('pad', repeat('x', 600)));
  exception when others then big := sqlerrm like '%EVENT_METADATA_TOO_LARGE%'; end;
  -- claiming someone's identity: the guard STRIPS user_id before RLS runs,
  -- so the row lands anonymized (verified from the postgres side in T9b).
  insert into public.events (event_type, metadata, user_id)
    values ('web_zip_search', '{"marker":"ident-strip-test"}', 'd0000001-0000-0000-0000-000000000001');
  ident := true;
  -- a well-formed anonymous event still works. NOTE: no RETURNING — anon rows
  -- are write-only (events_select_self hides them), which is itself by design.
  insert into public.events (event_type, metadata) values ('web_zip_search', '{"q":"44143"}');
  okd := true;
  insert into t_results (name, pass, detail)
    values ('T9a anon analytics: allowlist + size cap + valid insert ok',
            bad and big and ident and okd,
            'allowlist=' || bad || ' sizecap=' || big);
end $$;
reset role;

-- T9b (as postgres, RLS bypassed): the identity-claiming insert above must
-- have landed with user_id NULL — the guard stripped it.
do $$
declare stripped boolean;
begin
  select (user_id is null) into stripped from public.events
    where metadata ->> 'marker' = 'ident-strip-test'
    order by created_at desc limit 1;
  insert into t_results (name, pass, detail)
    values ('T9b anon-claimed identity is stripped to null', coalesce(stripped, false),
            case when stripped then 'user_id null as designed' else 'identity retained!' end);
end $$;
reset role;

select name, pass, detail from t_results order by n;
-- Intentionally NO COMMIT — the whole suite rolls back.
