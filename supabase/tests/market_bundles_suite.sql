-- Behavioural proof for 0121: Gift Baskets / Bundles V1.
--
-- The CTO's proof list, verbatim:
--   * bundle creation costs exactly one Sell publish
--   * component rows consume no additional publish allowance
--   * bundle renewal follows normal renewal rules
--   * bundle sale decrements bundle inventory only; components untouched
--   * sold-out/expired/held component makes bundle unavailable
--   * stale clients cannot order/claim an unavailable bundle
--   * restoring the component restores availability WITHOUT another publish
--   * no automatic component renewal/payment occurs
--   * bundle works inside a Market Drop
--   * AI proposal/Confirm creates exactly one bundle (race in the runner)
--   * foreign listing composition fails
--   * recursive bundles fail
--   * accounting records a bundle sale coherently
--
-- Run against a THROWAWAY database only (run_market_bundles_tests.sh).

\set ON_ERROR_STOP on
set client_min_messages = warning;

create temporary table _t (n int, name text, ok boolean, detail text);
create sequence if not exists _tn start 1;
create or replace function pg_temp.ck(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin insert into _t values (nextval('_tn')::int, p_name, coalesce(p_ok, false), p_detail); end $$;

create or replace function pg_temp.ck_raises(p_name text, p_sql text, p_fragment text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform pg_temp.ck(p_name, false, 'expected an exception, none raised');
  exception when others then
    perform pg_temp.ck(p_name, position(p_fragment in sqlerrm) > 0,
                       format('got: %s', left(sqlerrm, 90)));
  end;
end $$;

create or replace function pg_temp.impersonate(p_uid uuid)
returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
$$;

-- ============================================================================
-- Fixtures: seller S on the FREE plan (3 publishes — allowance arithmetic is
-- the point), with components; rival seller R with a foreign listing.
-- ============================================================================
do $$
declare
  s uuid := '00000000-0000-0000-0000-00000000bb01';
  r uuid := '00000000-0000-0000-0000-00000000bb09';
  ms uuid := 'cc210117-0000-0000-0000-000000000001';
  mr uuid := 'cc210117-0000-0000-0000-000000000002';
begin
  insert into auth.users (id) values (s), (r) on conflict do nothing;
  delete from public.markets where owner_id in (s, r);
  insert into public.markets (id, owner_id, plan) values (ms, s, 'free');
  insert into public.markets (id, owner_id, plan) values (mr, r, 'free');

  perform pg_temp.impersonate(s);
  -- Two Sell publishes consumed here (fixture inserts run the real allowance
  -- trigger on the free plan: 2 of 3 used).
  insert into public.listings (id, owner_id, market_id, title, category, price_cents, unit, inventory_count, listing_type, status, expires_at)
  values
   ('cc210117-1111-0000-0000-000000000001', s, ms, 'Fresh Eggs', 'eggs', 500, 'dozen', 12, 'sale', 'active', now() + interval '7 days'),
   ('cc210117-1111-0000-0000-000000000002', s, ms, 'Sourdough Loaf', 'bakery', 700, 'loaf', 5, 'sale', 'active', now() + interval '7 days');

  perform pg_temp.impersonate(r);
  insert into public.listings (id, owner_id, market_id, title, category, price_cents, unit, listing_type, status, expires_at)
  values
   ('cc210117-2222-0000-0000-000000000001', r, mr, 'Foreign Jam', 'pantry', 900, 'jar', 'sale', 'active', now() + interval '7 days');
end $$;

-- ============================================================================
-- 1. Creation: composition walls, then exactly ONE Sell publish
-- ============================================================================
do $$
declare
  s uuid := '00000000-0000-0000-0000-00000000bb01';
  before_publishes int; after_publishes int;
  res jsonb;
  bid uuid;
begin
  perform pg_temp.impersonate(s);

  perform pg_temp.ck_raises('a foreign component poisons the whole creation',
    $q$ select public.create_market_bundle('Theft Basket', 2500,
        array['cc210117-1111-0000-0000-000000000001','cc210117-2222-0000-0000-000000000001']::uuid[]) $q$,
    'COMPONENT_NOT_AVAILABLE');
  perform pg_temp.ck_raises('duplicate components refused',
    $q$ select public.create_market_bundle('Dup Basket', 2500,
        array['cc210117-1111-0000-0000-000000000001','cc210117-1111-0000-0000-000000000001']::uuid[]) $q$,
    'BUNDLE_DUPLICATE_COMPONENT');
  perform pg_temp.ck_raises('a basket needs at least two items',
    $q$ select public.create_market_bundle('Lonely Basket', 2500,
        array['cc210117-1111-0000-0000-000000000001']::uuid[]) $q$,
    'BUNDLE_NEEDS_ITEMS');

  select count(*) into before_publishes from public.listing_publish_events e
   where e.market_id = 'cc210117-0000-0000-0000-000000000001' and e.kind = 'publish';

  res := public.create_market_bundle(
    'Sunday Breakfast Basket', 2500,
    array['cc210117-1111-0000-0000-000000000001','cc210117-1111-0000-0000-000000000002']::uuid[],
    'Eggs and fresh sourdough, ready Sunday morning.', null, 3, null);
  bid := (res ->> 'id')::uuid;

  select count(*) into after_publishes from public.listing_publish_events e
   where e.market_id = 'cc210117-0000-0000-0000-000000000001' and e.kind = 'publish';

  perform pg_temp.ck('bundle created ok', (res ->> 'ok')::boolean, res::text);
  perform pg_temp.ck('bundle creation cost exactly ONE Sell publish',
    after_publishes = before_publishes + 1,
    format('%s -> %s', before_publishes, after_publishes));
  perform pg_temp.ck('bundle is a 7-day sale listing marked is_bundle',
    exists (select 1 from public.listings l where l.id = bid and l.is_bundle
             and l.listing_type = 'sale'
             and l.expires_at between now() + interval '6 days' and now() + interval '8 days'));
  perform pg_temp.ck('components recorded with traceability',
    (select count(*) from public.listing_components where listing_id = bid) = 2);
  perform pg_temp.ck('bundle publicly visible with component count',
    exists (select 1 from public.public_listings pl
             where pl.id = bid and pl.is_bundle and pl.component_count = 2));
  perform pg_temp.ck('creation audited',
    exists (select 1 from public.events e where e.event_type = 'bundle_created'
             and (e.metadata ->> 'listing_id')::uuid = bid));

  -- Recursion wall: a bundle can never be a component.
  perform pg_temp.ck_raises('recursive bundles refused',
    format($q$ select public.create_market_bundle('Basket of Baskets', 5000,
        array['%s','cc210117-1111-0000-0000-000000000001']::uuid[]) $q$, bid),
    'COMPONENT_NOT_AVAILABLE');
end $$;

-- ============================================================================
-- 2. The allowance boundary: 3rd publish ok, 4th refused (bundle included)
-- ============================================================================
do $$
declare
  s uuid := '00000000-0000-0000-0000-00000000bb01';
begin
  perform pg_temp.impersonate(s);
  -- The free plan's 3 publishes are now fully spent: two component listings
  -- plus the basket itself. The NEXT Sell publication — bundle or ordinary —
  -- hits the same wall. No allowance exception for baskets, per the ruling.
  perform pg_temp.ck_raises('a bundle past the allowance hits the same $0.99 wall',
    $q$ select public.create_market_bundle('Over Basket', 3000,
        array['cc210117-1111-0000-0000-000000000001','cc210117-1111-0000-0000-000000000002']::uuid[]) $q$,
    'PUBLISH_ALLOWANCE_EXHAUSTED');
  perform pg_temp.ck_raises('an ordinary listing hits the identical wall (parity)',
    $q$ insert into public.listings (owner_id, market_id, title, category, price_cents, unit, listing_type, status, expires_at)
        values ('00000000-0000-0000-0000-00000000bb01', 'cc210117-0000-0000-0000-000000000001',
                'Wildflower Honey', 'pantry', 1200, 'jar', 'sale', 'active', now() + interval '7 days') $q$,
    'PUBLISH_ALLOWANCE_EXHAUSTED');
end $$;

-- ============================================================================
-- 3. Derived availability + transaction guards + restore-without-publish
-- ============================================================================
do $$
declare
  s uuid := '00000000-0000-0000-0000-00000000bb01';
  b uuid := '00000000-0000-0000-0000-00000000bb77';
  bid uuid;
  publishes_before int; publishes_after int;
begin
  select l.id into bid from public.listings l where l.title = 'Sunday Breakfast Basket';
  insert into auth.users (id) values (b) on conflict do nothing;

  -- Component sells out (seller marks eggs sold): bundle leaves the surface.
  update public.listings set status = 'completed' where id = 'cc210117-1111-0000-0000-000000000001';
  perform pg_temp.ck('sold-out component removes the bundle from the public surface',
    not exists (select 1 from public.public_listings pl where pl.id = bid));
  perform pg_temp.ck('the bundle row itself was not touched (still active, derived-only)',
    (select status from public.listings where id = bid) = 'active');

  -- A stale client tries to claim it anyway: the server refuses.
  perform pg_temp.impersonate(b);
  perform pg_temp.ck_raises('stale claim on an unavailable bundle refused',
    format($q$ insert into public.claims (listing_id, claimer_id, claim_type, agreed_price_cents)
               values ('%s', '00000000-0000-0000-0000-00000000bb77', 'purchase_request', 2500) $q$, bid),
    'BUNDLE_UNAVAILABLE');

  -- Restore the component (restock path would be renewal-classed; for the
  -- restore-without-BUNDLE-publish proof we count PUBLISH events only).
  perform pg_temp.impersonate(s);
  select count(*) into publishes_before from public.listing_publish_events e
   where e.market_id = 'cc210117-0000-0000-0000-000000000001' and e.kind = 'publish';
  -- The restore is a real renewal-class activation; run it on an unlimited
  -- plan (as a paid seller would) — the point under test is that the BUNDLE
  -- needs no new publish, not the component's own renewal economics.
  update public.markets set plan = 'sponsor' where id = 'cc210117-0000-0000-0000-000000000001';
  update public.listings set status = 'active' where id = 'cc210117-1111-0000-0000-000000000001';
  update public.markets set plan = 'free' where id = 'cc210117-0000-0000-0000-000000000001';
  select count(*) into publishes_after from public.listing_publish_events e
   where e.market_id = 'cc210117-0000-0000-0000-000000000001' and e.kind = 'publish';

  perform pg_temp.ck('restoring the component restores bundle availability',
    exists (select 1 from public.public_listings pl where pl.id = bid));
  perform pg_temp.ck('restoration consumed no new PUBLISH for the bundle',
    publishes_after = publishes_before,
    format('%s -> %s', publishes_before, publishes_after));

  -- Expired component: same derived behavior.
  update public.listings set expires_at = now() - interval '1 hour'
   where id = 'cc210117-1111-0000-0000-000000000002';
  perform pg_temp.ck('expired component removes the bundle from the public surface',
    not exists (select 1 from public.public_listings pl where pl.id = bid));
  update public.listings set expires_at = now() + interval '7 days'
   where id = 'cc210117-1111-0000-0000-000000000002';
  perform pg_temp.ck('un-expiring the component restores availability',
    exists (select 1 from public.public_listings pl where pl.id = bid));

  -- No automatic component renewal happened anywhere in this section: renewal
  -- events for the components would show as kind='renewal'.
  perform pg_temp.ck('no automatic component renewal PAYMENT occurred',
    not exists (select 1 from public.listing_publish_events e
                 where e.listing_id in ('cc210117-1111-0000-0000-000000000001',
                                        'cc210117-1111-0000-0000-000000000002')
                   and e.kind = 'renewal' and e.funded = 'paid'));
end $$;

-- ============================================================================
-- 4. Bundle inside a Market Drop — canonical availability rules the count
-- ============================================================================
do $$
declare
  s uuid := '00000000-0000-0000-0000-00000000bb01';
  bid uuid;
  did uuid;
  res jsonb;
  n1 int; n2 int;
begin
  select l.id into bid from public.listings l where l.title = 'Sunday Breakfast Basket';
  perform pg_temp.impersonate(s);
  res := public.create_market_drop('Basket Drop', now() + interval '1 day',
    now() + interval '1 day 4 hours', array[bid]::uuid[], null, true, null);
  did := (res ->> 'id')::uuid;

  select available_items into n1 from public.public_market_drops where id = did;
  update public.listings set status = 'completed' where id = 'cc210117-1111-0000-0000-000000000001';
  select available_items into n2 from public.public_market_drops where id = did;

  perform pg_temp.ck('a bundle joins a Drop as a normal listing', n1 = 1, format('got %s', n1));
  perform pg_temp.ck('component unavailability flows through the Drop count',
    n2 = 0, format('got %s', n2));

  perform pg_temp.impersonate(s);
  update public.markets set plan = 'sponsor' where id = 'cc210117-0000-0000-0000-000000000001';
  update public.listings set status = 'active' where id = 'cc210117-1111-0000-0000-000000000001';
  update public.markets set plan = 'free' where id = 'cc210117-0000-0000-0000-000000000001';
end $$;

-- ============================================================================
-- 5. Accounting: bundle sale decrements the basket only
-- ============================================================================
do $$
declare
  s uuid := '00000000-0000-0000-0000-00000000bb01';
  bid uuid;
  tx uuid;
  basket_inv int; eggs_inv int; bread_inv int;
begin
  select l.id into bid from public.listings l where l.title = 'Sunday Breakfast Basket';
  perform pg_temp.impersonate(s);

  tx := public.record_sale(
    'cc210117-0000-0000-0000-000000000001', bid, null,
    1, 2500, 0, 0, 'cash', null, null);

  select inventory_count into basket_inv from public.listings where id = bid;
  select inventory_count into eggs_inv from public.listings where id = 'cc210117-1111-0000-0000-000000000001';
  select inventory_count into bread_inv from public.listings where id = 'cc210117-1111-0000-0000-000000000002';

  perform pg_temp.ck('a recorded basket sale decrements the basket inventory only',
    basket_inv = 2, format('basket=%s', basket_inv));
  perform pg_temp.ck('component inventories are untouched by a basket sale',
    eggs_inv = 12 and bread_inv = 5, format('eggs=%s bread=%s', eggs_inv, bread_inv));
  perform pg_temp.ck('the ledger row exists and nets correctly',
    exists (select 1 from public.seller_transactions t
             where t.id = tx and t.listing_id = bid and t.net_cents = 2500 and t.status = 'completed'));
end $$;

-- ============================================================================
-- 6. Client walls: nobody writes composition directly; buyers read only
--    what is public
-- ============================================================================
do $$
declare
  s uuid := '00000000-0000-0000-0000-00000000bb01';
  b uuid := '00000000-0000-0000-0000-00000000bb77';
  bid uuid;
  wrote boolean := false;
  buyer_sees int;
begin
  select l.id into bid from public.listings l where l.title = 'Sunday Breakfast Basket';

  perform pg_temp.impersonate(b);
  execute 'set local role authenticated';
  begin
    insert into public.listing_components (listing_id, component_listing_id)
    values (bid, 'cc210117-2222-0000-0000-000000000001');
    wrote := true;
  exception when others then null;
  end;
  select count(*) into buyer_sees from public.listing_components where listing_id = bid;
  execute 'reset role';

  perform pg_temp.ck('clients cannot write composition directly', not wrote);
  perform pg_temp.ck('a buyer can read what''s inside a public bundle', buyer_sees = 2,
    format('saw %s', buyer_sees));
end $$;

select * from _t order by n;
do $$
declare bad int;
begin
  select count(*) into bad from _t where not ok;
  if bad > 0 then raise exception '% test(s) FAILED', bad; end if;
end $$;
select format('market_bundles: %s/%s passed', count(*) filter (where ok), count(*)) from _t;
