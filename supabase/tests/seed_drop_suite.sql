-- Gnome — Seed Drop engine + privacy test suite.
-- Same harness as rls_suite.sql: run WITHOUT a COMMIT; everything rolls back.
-- Last full run 2026-08-07: E1–E7 PASS (see notes inline).

begin;
create temp table t (n serial, name text, pass boolean, detail text);
grant all on t to public;
grant usage, select on sequence t_n_seq to public;

-- Fixture lots: good stock for container-friendly crops; traps everywhere else.
insert into seed_lots (seed_product_id, internal_lot_number, original_qty, current_qty, unit, germination_pct, received_date, status)
select id, 'T-'||crop, 20, 20, 'packets', 92, current_date - 200, 'active' from seed_products where crop in ('Lettuce','Spinach','Arugula','Cilantro','Swiss Chard');
insert into seed_lots (seed_product_id, internal_lot_number, original_qty, current_qty, unit, germination_pct, status)
select id, 'T-KALE-Q', 20, 20, 'packets', 95, 'quarantined' from seed_products where crop = 'Kale';
insert into seed_lots (seed_product_id, internal_lot_number, original_qty, current_qty, unit, germination_pct, status)
select id, 'T-RAD-FAIL', 20, 20, 'packets', 40, 'active' from seed_products where crop = 'Radish';
insert into seed_lots (seed_product_id, internal_lot_number, original_qty, current_qty, unit, germination_pct, status)
select id, 'T-BEET-EMPTY', 20, 0, 'packets', 90, 'active' from seed_products where crop = 'Beet';

-- Order: containers + partial sun + first-timer + salad prefs + kale excluded.
insert into seed_orders (id, user_id, status, packet_count, profile_snapshot)
values ('aaaaaaaa-0000-0000-0000-000000000001','d0000002-0000-0000-0000-000000000002','paid',6,
  '{"zone":6,"garden_size":"containers","sun":"partial","experience":"first_time","preferences":["salad"],"exclusions":["kale"]}');

do $$
declare n int; names text; cnt int; qty numeric; st text;
begin
  select public.generate_seed_drop('aaaaaaaa-0000-0000-0000-000000000001') into n;
  select string_agg(p.crop, ',' order by p.crop), count(*) into names, cnt
    from seed_order_items i join seed_products p on p.id = i.seed_product_id
    where i.order_id = 'aaaaaaaa-0000-0000-0000-000000000001' and i.status='reserved';
  select status into st from seed_orders where id='aaaaaaaa-0000-0000-0000-000000000001';
  insert into t (name, pass, detail) values
    ('E1 suitability: only container+partial-sun+beginner crops picked',
     names = 'Arugula,Cilantro,Lettuce,Spinach,Swiss Chard', coalesce(names,'(none)'));
  insert into t (name, pass, detail) values
    ('E2 traps skipped: excluded, failed-germ, quarantined, empty lots', n = 5, n || ' reserved');
  insert into t (name, pass, detail) values
    ('E3 short box -> needs_review (never padded with unsuitable seed)', st = 'needs_review', 'status=' || st);
  select current_qty into qty from seed_lots where internal_lot_number='T-Lettuce';
  insert into t (name, pass, detail) values
    ('E4 inventory decremented on reservation', qty = 19, 'lettuce lot qty=' || qty);
end $$;

-- Depletion guard: reduce lettuce to 1; two 2-packet orders in sequence.
update seed_lots set current_qty = 1 where internal_lot_number = 'T-Lettuce';
insert into seed_orders (id, user_id, status, packet_count, profile_snapshot)
values ('aaaaaaaa-0000-0000-0000-000000000002','d0000001-0000-0000-0000-000000000001','paid',2,
  '{"zone":6,"garden_size":"containers","sun":"partial","experience":"beginner","preferences":["lettuce"],"exclusions":[]}'),
       ('aaaaaaaa-0000-0000-0000-000000000003','3e64f6d5-9c3e-436a-b48d-be96edfba39a','paid',2,
  '{"zone":6,"garden_size":"containers","sun":"partial","experience":"beginner","preferences":["lettuce"],"exclusions":[]}');
do $$
declare a int; b int; qty numeric; neg int;
begin
  select public.generate_seed_drop('aaaaaaaa-0000-0000-0000-000000000002') into a;
  select public.generate_seed_drop('aaaaaaaa-0000-0000-0000-000000000003') into b;
  select current_qty into qty from seed_lots where internal_lot_number='T-Lettuce';
  select count(*) into neg from seed_lots where current_qty < 0;
  insert into t (name, pass, detail) values
    ('E5 last packet sells once; no negative inventory ever', qty = 0 and neg = 0,
     'lettuce qty=' || qty || ', negative lots=' || neg);
end $$;

do $$
declare qbefore numeric; qafter numeric;
begin
  select current_qty into qbefore from seed_lots where internal_lot_number='T-Spinach';
  perform public.release_seed_drop_items('aaaaaaaa-0000-0000-0000-000000000001', 'cancelled');
  select current_qty into qafter from seed_lots where internal_lot_number='T-Spinach';
  insert into t (name, pass, detail) values
    ('E6 cancellation releases reserved inventory', qafter = qbefore + 1, qbefore || ' -> ' || qafter);
end $$;

-- Privacy: Tom sees his order, not Maria's; lots (costs/suppliers) invisible;
-- engine not executable; public catalog readable.
select set_config('request.jwt.claims','{"sub":"d0000002-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare blocked boolean := false; lots int; own boolean; foreign_hidden boolean; cat boolean;
begin
  begin
    perform public.generate_seed_drop('aaaaaaaa-0000-0000-0000-000000000002');
  exception when others then blocked := true; end;
  select count(*) into lots from seed_lots;
  select exists(select 1 from seed_orders where id='aaaaaaaa-0000-0000-0000-000000000001') into own;
  select not exists(select 1 from seed_orders where id='aaaaaaaa-0000-0000-0000-000000000002') into foreign_hidden;
  select count(*) > 0 into cat from seed_products where active;
  insert into t (name, pass, detail) values
    ('E7 privacy: engine blocked, lots hidden, own order only, catalog public',
     blocked and lots = 0 and own and foreign_hidden and cat,
     'blocked='||blocked||' lots='||lots||' own='||own||' foreignHidden='||foreign_hidden||' catalog='||cat);
end $$;
reset role;

select name, pass, detail from t order by n;
-- NO COMMIT — everything above rolls back.
