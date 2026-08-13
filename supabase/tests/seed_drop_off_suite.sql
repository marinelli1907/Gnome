-- Seed Drop OFF — the database half of the "no Seed Drop payment can be
-- created" regression suite. Run by run_seed_drop_off_tests.sh on a throwaway
-- local database; never against a hosted project.
--
-- The question this file answers is narrow and factual: given the billing rows
-- that actually exist, could a Seed Drop charge be created? A key is dangerous
-- when it is BOTH active (checkout will accept it) and price-configured
-- (Stripe has something to charge). Either alone is inert; together they arm a
-- purchase path, and the only thing standing between that and a charge is
-- application code that a future edit could change.
--
-- The rows come from :rows_file — a fresh read-only snapshot of production
-- billing_products when the runner was given GNOME_BILLING_SNAPSHOT_URL, and
-- otherwise the observed snapshot below. The runner prints which was used;
-- treat a fallback run as evidence about the snapshot date, not about today.

create table t (n serial, label text, pass boolean, detail text);

-- Schema mirrors production: 0068 created the table, 0083 split the price ids
-- into test/live columns and kept the legacy single column for back-compat.
create table public.billing_products (
  key text primary key,
  kind text not null check (kind in ('subscription','one_time','addon')),
  description text not null,
  unit_amount_cents int,
  currency text not null default 'usd',
  stripe_product_id text,
  stripe_price_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  stripe_product_id_test text,
  stripe_price_id_test text,
  stripe_product_id_live text,
  stripe_price_id_live text
);

create table public.billing_config (
  id boolean primary key default true,
  payments_live_enabled boolean not null default false
);

\i :rows_file

-- Observed production state, re-read 2026-08-13 AFTER the launch round set the
-- five seed keys inactive. Price ids are recorded as presence only — the suite
-- never needs the values, and they do not belong in the repo.
--
-- This snapshot is a convenience so the suite runs offline; it is NOT evidence
-- about production. Refresh it whenever billing_products changes:
--   select key, active, (stripe_price_id_test is not null) from billing_products order by key;
-- A green run means "the policy holds for this shape" — check the live rows
-- separately before believing anything about production.
-- Applies only when the runner had no live snapshot to load.
insert into public.billing_products (key, kind, description, unit_amount_cents, active,
                                     stripe_price_id_test, stripe_price_id_live)
select * from (values
  ('GNOME_GROWER_MONTHLY',        'subscription','Grower plan, monthly',            999,  true,  'price_test_present', null),
  ('GNOME_FARM_MONTHLY',          'subscription','Farm plan, monthly',              2999, true,  'price_test_present', null),
  ('GNOME_PICKUP_LOCATION_ADDON', 'addon',       'Extra pickup location',           500,  true,  'price_test_present', null),
  ('GNOME_LISTING_PROMOTION',     'one_time',    'Featured listing promotion',      399,  true,  'price_test_present', null),
  ('GNOME_PROMOTION_PACK_3',      'one_time',    'Promotion pack: 3 credits',       999,  false, null,                 null),
  ('GNOME_PROMOTION_PACK_10',     'one_time',    'Promotion pack: 10 credits',      2999, false, null,                 null),
  ('GNOME_SEED_DROP_SEASONAL',    'subscription','Seasonal Seed Drop, per season',  2499, false, 'price_test_present', null),
  ('GNOME_SEED_DROP_ONE_TIME',    'one_time',    'Seed Drop box, one-time',         null, false, null,                 null),
  ('GNOME_SEED_DROP_SUBSCRIPTION','subscription','Seed Drop subscription',          null, false, null,                 null),
  ('GNOME_GROWER_SEED_BUNDLE',    'subscription','Grower + Seed Drop bundle',       19900,false, 'price_test_present', null),
  ('GNOME_FARM_SEED_BUNDLE',      'subscription','Farm + Seed Drop bundle',         42900,false, 'price_test_present', null)
) as v
where not exists (select 1 from public.billing_products);

insert into public.billing_config (id, payments_live_enabled)
select true, false
where not exists (select 1 from public.billing_config);

-- A seed key is anything the checkout gate would refuse: the five named keys
-- plus the SEED substring rule, so a future GNOME_*_SEED_* key is in scope the
-- day it is created rather than the day someone remembers to list it here.
create function pg_temp.is_seed_key(k text) returns boolean language sql immutable as $$
  select upper(k) in ('GNOME_SEED_DROP_SEASONAL','GNOME_SEED_DROP_ONE_TIME',
                      'GNOME_SEED_DROP_SUBSCRIPTION','GNOME_GROWER_SEED_BUNDLE',
                      'GNOME_FARM_SEED_BUNDLE')
      or upper(k) like '%SEED%';
$$;

create function pg_temp.priced(p public.billing_products) returns boolean language sql immutable as $$
  select coalesce(p.stripe_price_id_test, p.stripe_price_id_live, p.stripe_price_id) is not null;
$$;

-- --------------------------------------------------------------------------
-- A. Nothing seed-shaped is armed
-- --------------------------------------------------------------------------
do $$
declare armed text; n int;
begin
  select string_agg(key, ', ' order by key) into armed
    from public.billing_products p
   where pg_temp.is_seed_key(p.key) and p.active and pg_temp.priced(p);
  insert into t(label,pass,detail) values ('T-OFF-01 no seed key is active AND price-configured',
    armed is null, coalesce('armed: '||armed, 'no seed key is both active and priced'));

  select string_agg(key, ', ' order by key) into armed
    from public.billing_products p
   where pg_temp.is_seed_key(p.key) and p.stripe_price_id_live is not null;
  insert into t(label,pass,detail) values ('T-OFF-02 no seed key has a LIVE price id',
    armed is null, coalesce('live price on: '||armed, 'no live price on any seed key'));

  select string_agg(key, ', ' order by key) into armed
    from public.billing_products p
   where pg_temp.is_seed_key(p.key) and p.active;
  insert into t(label,pass,detail) values ('T-OFF-03 every seed key row is inactive',
    armed is null, coalesce('still active: '||armed, 'all seed keys inactive'));

  select count(*) into n from public.billing_products p where pg_temp.is_seed_key(p.key);
  insert into t(label,pass,detail) values ('T-OFF-04 the snapshot actually contains seed keys',
    n >= 5, n||' seed key row(s) — a suite that sees none proves nothing');
end $$;

-- --------------------------------------------------------------------------
-- B. Live payments are still off
-- --------------------------------------------------------------------------
do $$
declare on_live boolean;
begin
  select payments_live_enabled into on_live from public.billing_config limit 1;
  insert into t(label,pass,detail) values ('T-OFF-05 live payments gate is off',
    on_live is not true, 'payments_live_enabled='||coalesce(on_live::text,'null'));
end $$;

-- --------------------------------------------------------------------------
-- C. The marketplace was not broken on the way past
-- --------------------------------------------------------------------------
do $$
declare missing text;
begin
  select string_agg(k, ', ' order by k) into missing from unnest(array[
    'GNOME_GROWER_MONTHLY','GNOME_FARM_MONTHLY',
    'GNOME_LISTING_PROMOTION','GNOME_PICKUP_LOCATION_ADDON']) as k
   where not exists (
     select 1 from public.billing_products p
      where p.key = k and p.active and pg_temp.priced(p));
  insert into t(label,pass,detail) values ('T-OFF-06 the four marketplace keys stay purchasable',
    missing is null, coalesce('not purchasable: '||missing, 'all four active and priced'));
end $$;

select n, label, case when pass then 'PASS' else 'FAIL' end as result, detail
  from t order by n;
select count(*) filter (where pass) || '/' || count(*) || ' database cases pass' as summary from t;
select 'SEED DROP OFF (database): ' ||
       case when bool_and(pass) then 'ALL TESTS PASSED' else 'FAILURES PRESENT' end as verdict
  from t;
