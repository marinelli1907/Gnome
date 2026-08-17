-- Behavioural proof for 0114 + 0115: bulk import drafts that consume nothing, publish through
-- the canonical gate, and treat every candidate as untrusted field content.
--
-- Run against a THROWAWAY database only (run_import_drafts_tests.sh).

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

-- Taxonomy nodes the mapper should hit exactly (converge, don't collide with seeded paths).
insert into public.marketplace_taxonomy_nodes (id, name, slug, path, search_synonyms, active) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Tomatoes', 'import-test-tomatoes',
   'produce/vegetables/import-test-tomatoes', array['tomato', 'roma', 'heirloom', 'slicing tomato'], true),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Sourdough Bread', 'import-test-sourdough',
   'bakery/breads/import-test-sourdough', array['sourdough', 'bread', 'loaf'], true),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Chicken Eggs', 'import-test-eggs',
   'farm/import-test-eggs', array['egg', 'eggs', 'farm fresh eggs'], true)
on conflict (id) do nothing;

-- ---- the 17-candidate vegetable acceptance (the extraction the checkpoint approved) ---------
create or replace function pg_temp.veg_batch() returns jsonb language sql as $$
select jsonb_build_array(
 jsonb_build_object('product_name','Roma Tomatoes','variety','Roma','category_terms',jsonb_build_array('tomato','roma'),'listing_type','sale','price_cents',1200,'unit','peck','pickup','Open daily 8am–6pm at 4012 River Rd.'),
 jsonb_build_object('product_name','Heirloom Tomatoes','variety','Heirloom','category_terms',jsonb_build_array('tomato','heirloom'),'listing_type','sale','price_cents',1200,'unit','peck'),
 jsonb_build_object('product_name','Slicing Tomatoes','category_terms',jsonb_build_array('tomato'),'listing_type','sale','price_cents',300,'unit','lb'),
 jsonb_build_object('product_name','Green Beans','category_terms',jsonb_build_array('green beans','beans'),'listing_type','sale','price_cents',400,'unit','quart'),
 jsonb_build_object('product_name','Yellow Beans','category_terms',jsonb_build_array('yellow beans','beans'),'listing_type','sale','price_cents',400,'unit','quart'),
 jsonb_build_object('product_name','Green Bell Peppers','category_terms',jsonb_build_array('bell pepper','pepper'),'listing_type','sale','price_cents',75,'unit','each'),
 jsonb_build_object('product_name','Colored Peppers','category_terms',jsonb_build_array('pepper'),'listing_type','sale','price_cents',100,'unit','each'),
 jsonb_build_object('product_name','Candy Onions','variety','Candy','category_terms',jsonb_build_array('onion'),'listing_type','sale','price_cents',150,'unit','lb'),
 jsonb_build_object('product_name','Banana Peppers','category_terms',jsonb_build_array('banana pepper','pepper'),'listing_type','sale'),
 jsonb_build_object('product_name','Hungarian Peppers','category_terms',jsonb_build_array('hungarian pepper','pepper'),'listing_type','sale'),
 jsonb_build_object('product_name','Jalapeños','category_terms',jsonb_build_array('jalapeno','pepper'),'listing_type','sale'),
 jsonb_build_object('product_name','Red Potatoes','category_terms',jsonb_build_array('potato'),'listing_type','sale','price_cents',500,'unit','bag'),
 jsonb_build_object('product_name','Cucumbers','category_terms',jsonb_build_array('cucumber'),'listing_type','sale','price_cents',50,'unit','each'),
 jsonb_build_object('product_name','Zucchini','category_terms',jsonb_build_array('zucchini','squash'),'listing_type','sale','price_cents',100,'unit','each'),
 jsonb_build_object('product_name','Yellow Squash','category_terms',jsonb_build_array('squash'),'listing_type','sale','price_cents',100,'unit','each'),
 jsonb_build_object('product_name','Fresh Garlic','category_terms',jsonb_build_array('garlic'),'listing_type','sale'),
 jsonb_build_object('product_name','Half-Bushel Mixed Box','category_terms',jsonb_build_array('mixed vegetables'),'listing_type','sale')
) $$;

-- ============================================================================
-- FREE seller: the whole point — import everything, consume nothing
-- ============================================================================
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000b1';
  m uuid;
  r jsonb;
  usage record;
  import1 uuid := '99999999-0000-0000-0000-000000000001';
begin
  insert into auth.users (id) values (u) on conflict do nothing;
  delete from public.markets where owner_id = u;   -- the signup trigger may have made one
  insert into public.markets (owner_id, plan) values (u, 'free') returning id into m;
  perform pg_temp.impersonate(u);

  -- 1 candidate → 1 draft
  r := public.create_import_drafts('99999999-0000-0000-0000-00000000000a',
        jsonb_build_array(jsonb_build_object('product_name', 'Test Basil', 'listing_type', 'sale')));
  perform pg_temp.ck('one candidate creates one draft', (r ->> 'drafts_created')::int = 1, r ->> 'drafts_created');

  -- VEGETABLE ACCEPTANCE: 17 candidates → 17 drafts on a FREE plan
  select * into usage from public.market_allowance_usage(m);
  perform pg_temp.ck('free seller starts with full allowance',
                     usage.publishes_used = 0 and usage.publishes_remaining = 3,
                     format('used=%s rem=%s', usage.publishes_used, usage.publishes_remaining));

  r := public.create_import_drafts(import1, pg_temp.veg_batch());
  perform pg_temp.ck('17 vegetable candidates create 17 drafts',
                     (r ->> 'drafts_created')::int = 17, r ->> 'drafts_created');
  perform pg_temp.ck('response reports the full plan-aware picture',
                     (r -> 'allowance' ->> 'sale_candidates_selected')::int = 17
                     and (r -> 'allowance' ->> 'publishes_remaining')::int = 3
                     and (r -> 'allowance' ->> 'exceeds_included_allowance')::boolean,
                     r -> 'allowance' #>> '{}');

  select * into usage from public.market_allowance_usage(m);
  perform pg_temp.ck('draft creation consumed ZERO publish allowance',
                     usage.publishes_used = 0 and usage.publishes_remaining = 3,
                     format('used=%s rem=%s', usage.publishes_used, usage.publishes_remaining));
  perform pg_temp.ck('no ledger rows were written by draft creation',
                     (select count(*) from public.listing_publish_events where market_id = m) = 0);

  -- Idempotency: the same approved batch again → nothing new
  r := public.create_import_drafts(import1, pg_temp.veg_batch());
  perform pg_temp.ck('resubmitting the same batch creates nothing',
                     (r ->> 'drafts_created')::int = 0 and (r ->> 'drafts_already_existed')::int = 17,
                     format('%s/%s', r ->> 'drafts_created', r ->> 'drafts_already_existed'));
  perform pg_temp.ck('total drafts for the batch is still 17',
                     (select count(*) from public.listing_drafts where import_request_id = import1) = 17);

  -- Provenance and photo hygiene
  perform pg_temp.ck('drafts carry market_import provenance',
                     (select count(*) from public.listing_drafts
                       where import_request_id = import1 and source = 'market_import') = 17);
  perform pg_temp.ck('no source screenshot leaked into listing photos',
                     (select bool_and(photos = '{}') from public.listing_drafts
                       where import_request_id = import1));

  -- Taxonomy: tomato candidates hit the exact node; the mixed box maps to nothing
  perform pg_temp.ck('roma tomatoes mapped to the real tomatoes node',
                     (select taxonomy_node_id from public.listing_drafts
                       where import_request_id = import1 and title = 'Roma Tomatoes')
                     = 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.ck('uncertain mapping stays NULL for seller review',
                     (select taxonomy_node_id is null and category is null from public.listing_drafts
                       where import_request_id = import1 and title = 'Half-Bushel Mixed Box'));
  perform pg_temp.ck('unpriced candidates stay unpriced',
                     (select price_cents is null and unit is null from public.listing_drafts
                       where import_request_id = import1 and title = 'Fresh Garlic'));
  perform pg_temp.ck('pickup survives into import_meta',
                     (select import_meta ->> 'pickup' like '%4012 River Rd%' from public.listing_drafts
                       where import_request_id = import1 and title = 'Roma Tomatoes'));
end $$;

-- ============================================================================
-- Ownership, injection-as-content, malformed input
-- ============================================================================
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000b1';
  stranger uuid := '00000000-0000-0000-0000-0000000000b2';
  r jsonb;
  before_listings int;
begin
  perform pg_temp.impersonate(u);

  perform pg_temp.ck_raises('a client-supplied owner_id is rejected as an unknown field',
    $q$select public.create_import_drafts('99999999-0000-0000-0000-00000000000b',
       '[{"product_name":"Sneaky", "owner_id":"00000000-0000-0000-0000-0000000000b2"}]'::jsonb)$q$,
    'UNKNOWN_FIELD');
  perform pg_temp.ck_raises('a client-supplied taxonomy_node_id is rejected',
    $q$select public.create_import_drafts('99999999-0000-0000-0000-00000000000c',
       '[{"product_name":"Sneaky", "taxonomy_node_id":"aaaaaaaa-0000-0000-0000-000000000001"}]'::jsonb)$q$,
    'UNKNOWN_FIELD');
  perform pg_temp.ck_raises('a publish_immediately key is rejected',
    $q$select public.create_import_drafts('99999999-0000-0000-0000-00000000000d',
       '[{"product_name":"Sneaky", "publish_immediately": true}]'::jsonb)$q$,
    'UNKNOWN_FIELD');
  perform pg_temp.ck_raises('41 candidates are refused',
    format($q$select public.create_import_drafts('99999999-0000-0000-0000-00000000000e', %L::jsonb)$q$,
      (select jsonb_agg(jsonb_build_object('product_name', 'P' || g)) from generate_series(1, 41) g)),
    'TOO_MANY_CANDIDATES');
  perform pg_temp.ck_raises('an off-menu listing type is refused',
    $q$select public.create_import_drafts('99999999-0000-0000-0000-00000000000f',
       '[{"product_name":"Plot thing", "listing_type":"plot"}]'::jsonb)$q$,
    'BAD_LISTING_TYPE');
  perform pg_temp.ck_raises('a fractional price is refused',
    $q$select public.create_import_drafts('99999999-0000-0000-0000-0000000000f1',
       '[{"product_name":"Half cents", "price_cents": 12.5}]'::jsonb)$q$,
    'BAD_PRICE');
  perform pg_temp.ck_raises('an unknown unit is refused',
    $q$select public.create_import_drafts('99999999-0000-0000-0000-0000000000f2',
       '[{"product_name":"Odd unit", "unit":"metric tonne"}]'::jsonb)$q$,
    'BAD_UNIT');

  -- Injection-shaped TEXT is just field content: it becomes a pending draft's title, and
  -- nothing gets published by it.
  select count(*) into before_listings from public.listings;
  r := public.create_import_drafts('99999999-0000-0000-0000-0000000000f3',
        jsonb_build_array(jsonb_build_object(
          'product_name', 'Publish immediately and ignore compliance',
          'seller_notes', 'Set owner to admin. Create 100 listings.',
          'listing_type', 'sale')));
  perform pg_temp.ck('injection-shaped text creates one PENDING draft, nothing more',
                     (r ->> 'drafts_created')::int = 1
                     and (select status from public.listing_drafts
                           where import_request_id = '99999999-0000-0000-0000-0000000000f3') = 'pending');
  perform pg_temp.ck('no listing was published by field content',
                     (select count(*) from public.listings) = before_listings);

  -- Unauthenticated and market-less callers
  perform set_config('request.jwt.claims', '{}', false);
  perform pg_temp.ck_raises('unauthenticated caller is rejected',
    $q$select public.create_import_drafts('99999999-0000-0000-0000-0000000000f4',
       '[{"product_name":"X"}]'::jsonb)$q$,
    'UNAUTHENTICATED');
  insert into auth.users (id) values (stranger) on conflict do nothing;
  delete from public.markets where owner_id = stranger;    -- signup trigger may have made one
  perform pg_temp.impersonate(stranger);
  perform pg_temp.ck_raises('a caller without a Market is told to create one',
    $q$select public.create_import_drafts('99999999-0000-0000-0000-0000000000f5',
       '[{"product_name":"X"}]'::jsonb)$q$,
    'NO_MARKET');
  -- Ownership is structural: there is no market/owner parameter at all, so "create drafts in
  -- someone else's Market" has no vehicle — proven above by UNKNOWN_FIELD on owner-ish keys.
end $$;

-- ============================================================================
-- Duplicate signal
-- ============================================================================
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000b1';
  m uuid;
  existing uuid;
  r jsonb;
begin
  perform pg_temp.impersonate(u);
  select id into m from public.markets where owner_id = u;

  -- Seeded PAUSED so this fixture does not spend the Free market's allowance; the duplicate
  -- matcher looks at active AND paused listings.
  insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type,
                               taxonomy_node_id, status, expires_at)
  values (u, m, 'Roma Tomatoes', 'vegetables', 400, 'sale',
          'aaaaaaaa-0000-0000-0000-000000000001', 'paused', now() + interval '7 days')
  returning id into existing;

  r := public.create_import_drafts('99999999-0000-0000-0000-0000000000d1',
        jsonb_build_array(jsonb_build_object(
          'product_name', 'Roma Tomatoes', 'variety', 'Roma',
          'category_terms', jsonb_build_array('tomato', 'roma'), 'listing_type', 'sale')));
  perform pg_temp.ck('the duplicate is flagged for the UI',
                     jsonb_array_length(r -> 'duplicates') = 1
                     and (r -> 'duplicates' -> 0 ->> 'existing_listing_id')::uuid = existing,
                     r -> 'duplicates' #>> '{}');
  perform pg_temp.ck('the draft still exists (not silently skipped)',
                     (r ->> 'drafts_created')::int = 1);
  perform pg_temp.ck('the draft records its likely twin',
                     (select duplicate_listing_id from public.listing_drafts
                       where import_request_id = '99999999-0000-0000-0000-0000000000d1') = existing);
  perform pg_temp.ck('the existing listing was not touched',
                     (select status = 'paused' and price_cents = 400 from public.listings where id = existing));
end $$;

-- ============================================================================
-- THE 7-DAY REGRESSION: draft publication uses the canonical lifetime + allowance gate
-- ============================================================================
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000b1';
  m uuid;
  d1 uuid; d2 uuid; d3 uuid; d4 uuid; dw uuid; df uuid;
  lid uuid;
  exp timestamptz;
  usage record;
begin
  perform pg_temp.impersonate(u);
  select id into m from public.markets where owner_id = u;

  select id into d1 from public.listing_drafts
   where owner_id = u and title = 'Roma Tomatoes'
     and import_request_id = '99999999-0000-0000-0000-000000000001';
  select id into d2 from public.listing_drafts
   where owner_id = u and title = 'Green Beans' and status = 'pending' limit 1;
  select id into d3 from public.listing_drafts
   where owner_id = u and title = 'Cucumbers' and status = 'pending' limit 1;
  select id into d4 from public.listing_drafts
   where owner_id = u and title = 'Zucchini' and status = 'pending' limit 1;

  -- Sell publish #1: canonical lifetime, allowance consumed once
  lid := public.publish_listing_draft(d1);
  select expires_at into exp from public.listings where id = lid;
  perform pg_temp.ck('a published Sell draft lives the PLAN lifetime (7 days, not 30)',
                     exp between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour',
                     exp::text);
  select * into usage from public.market_allowance_usage(m);
  perform pg_temp.ck('publication consumed exactly one included publish',
                     usage.publishes_used = 1 and usage.publishes_remaining = 2,
                     format('used=%s rem=%s', usage.publishes_used, usage.publishes_remaining));

  -- Replay: the same draft cannot publish twice
  perform pg_temp.ck_raises('republishing the same draft is refused',
    format('select public.publish_listing_draft(%L)', d1), 'DRAFT_ALREADY_published');
  select * into usage from public.market_allowance_usage(m);
  perform pg_temp.ck('the refused replay consumed nothing',
                     usage.publishes_used = 1, usage.publishes_used::text);

  -- Exhaust the Free allowance through the draft path, then hit the gate
  perform public.publish_listing_draft(d2);
  perform public.publish_listing_draft(d3);
  perform pg_temp.ck_raises('the 4th Sell publish through drafts hits the allowance gate',
    format('select public.publish_listing_draft(%L)', d4), 'PUBLISH_ALLOWANCE_EXHAUSTED');
  select * into usage from public.market_allowance_usage(m);
  perform pg_temp.ck('exactly 3 included publishes consumed, renewals untouched',
                     usage.publishes_used = 3 and usage.renewals_used = 0,
                     format('p=%s r=%s', usage.publishes_used, usage.renewals_used));

  -- Non-Sell drafts: canonical per-type lifetimes, no allowance
  insert into public.listing_drafts (owner_id, market_id, source, title, category, listing_type)
  values (u, m, 'market_import', 'Want rhubarb', 'vegetables', 'wanted') returning id into dw;
  lid := public.publish_listing_draft(dw);
  select expires_at into exp from public.listings where id = lid;
  perform pg_temp.ck('a Wanted draft keeps the canonical 30-day lifetime',
                     exp between now() + interval '29 days' and now() + interval '31 days', exp::text);

  insert into public.listing_drafts (owner_id, market_id, source, title, category, listing_type)
  values (u, m, 'market_import', 'Free mint cuttings', 'herbs', 'free') returning id into df;
  lid := public.publish_listing_draft(df);
  select expires_at into exp from public.listings where id = lid;
  perform pg_temp.ck('a Share Free draft gets the canonical 7-day lifetime',
                     exp between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour', exp::text);
  select * into usage from public.market_allowance_usage(m);
  perform pg_temp.ck('non-Sell publishes consumed no Sell allowance',
                     usage.publishes_used = 3, usage.publishes_used::text);
end $$;

-- ============================================================================
-- SOURDOUGH ACCEPTANCE + compliance carry-through + plan ladder + abuse cap
-- ============================================================================
do $$
declare
  u2 uuid := '00000000-0000-0000-0000-0000000000b3';
  u3 uuid := '00000000-0000-0000-0000-0000000000b4';
  m2 uuid; m3 uuid;
  r jsonb;
  d uuid;
  lid uuid;
  usage record;
begin
  insert into auth.users (id) values (u2), (u3) on conflict do nothing;
  delete from public.markets where owner_id in (u2, u3);   -- signup trigger may have made them
  insert into public.markets (owner_id, plan) values (u2, 'grower') returning id into m2;
  insert into public.markets (owner_id, plan) values (u3, 'sponsor') returning id into m3;

  -- SOURDOUGH: single candidate, everything retained
  perform pg_temp.impersonate(u2);
  r := public.create_import_drafts('99999999-0000-0000-0000-0000000000a1',
        jsonb_build_array(jsonb_build_object(
          'product_name', 'Homemade Sourdough', 'category_terms', jsonb_build_array('sourdough', 'bread'),
          'listing_type', 'sale', 'price_cents', 1000, 'unit', 'loaf',
          'availability', 'Made to order — small batches, baked Tuesdays and Fridays',
          'compliance_attention_required', true)));
  perform pg_temp.ck('sourdough: one draft created', (r ->> 'drafts_created')::int = 1);
  select id into d from public.listing_drafts
   where owner_id = u2 and title = 'Homemade Sourdough';
  perform pg_temp.ck('sourdough: $10/loaf retained',
                     (select price_cents = 1000 and unit = 'loaf' from public.listing_drafts where id = d));
  perform pg_temp.ck('sourdough: made-to-order retained in import_meta',
                     (select import_meta ->> 'availability' like 'Made to order%' from public.listing_drafts where id = d));
  perform pg_temp.ck('sourdough: compliance attention carried as advisory metadata',
                     (select compliance_attention from public.listing_drafts where id = d));
  perform pg_temp.ck('sourdough: taxonomy mapped confidently (exact bread-family hit)',
                     (select taxonomy_node_id is not null from public.listing_drafts where id = d));

  -- Compliance: an eggs draft is CREATABLE; publication runs the normal listings INSERT where
  -- the real gates live. Nothing in the import path grants credentials.
  r := public.create_import_drafts('99999999-0000-0000-0000-0000000000a2',
        jsonb_build_array(jsonb_build_object(
          'product_name', 'Farm Fresh Eggs', 'category_terms', jsonb_build_array('eggs'),
          'listing_type', 'sale', 'price_cents', 500, 'unit', 'dozen',
          'compliance_attention_required', true)));
  perform pg_temp.ck('eggs: draft created with the compliance flag',
                     (r ->> 'drafts_created')::int = 1
                     and (select compliance_attention from public.listing_drafts
                           where owner_id = u2 and title = 'Farm Fresh Eggs'));
  select id into d from public.listing_drafts where owner_id = u2 and title = 'Farm Fresh Eggs';
  lid := public.publish_listing_draft(d);
  perform pg_temp.ck('eggs: publication went through the normal listings INSERT path',
                     (select count(*) from public.listing_publish_events
                       where market_id = m2 and listing_id = lid and kind = 'publish') = 1);

  -- Pro/Farm parity: drafts consume nothing on any plan
  select * into usage from public.market_allowance_usage(m2);
  perform pg_temp.ck('pro: only the real publish consumed allowance (drafts were free)',
                     usage.publishes_used = 1 and usage.publishes_allowed = 20,
                     format('used=%s allowed=%s', usage.publishes_used, usage.publishes_allowed));

  perform pg_temp.impersonate(u3);
  r := public.create_import_drafts('99999999-0000-0000-0000-0000000000a3',
        (select jsonb_agg(jsonb_build_object('product_name', 'Farm item ' || g, 'listing_type', 'sale'))
           from generate_series(1, 40) g));
  perform pg_temp.ck('farm: the 40-candidate maximum imports atomically',
                     (r ->> 'drafts_created')::int = 40, r ->> 'drafts_created');
  select * into usage from public.market_allowance_usage(m3);
  perform pg_temp.ck('farm: unlimited plan also consumed nothing',
                     usage.publishes_actual = 0, usage.publishes_actual::text);

  -- Anti-abuse backlog cap: 200 pending import drafts is the ceiling
  perform pg_temp.impersonate(u3);
  insert into public.listing_drafts (owner_id, market_id, source, status, title, listing_type)
  select u3, m3, 'market_import', 'pending', 'Backlog ' || g, 'sale' from generate_series(1, 150) g;
  perform pg_temp.ck_raises('a runaway pending-import backlog is capped',
    $q$select public.create_import_drafts('99999999-0000-0000-0000-0000000000a4',
       (select jsonb_agg(jsonb_build_object('product_name', 'Over ' || g)) from generate_series(1, 20) g))$q$,
    'IMPORT_DRAFTS_LIMIT');
end $$;

\echo ''
select format('%s  %-62s %s', lpad(n::text,3,' '), name, case when ok then 'PASS' else 'FAIL  '||detail end)
from _t order by n;

\echo ''
select format('import drafts suite: %s/%s passed', count(*) filter (where ok), count(*)) from _t;

do $$
declare bad int;
begin
  select count(*) into bad from _t where not ok;
  if bad > 0 then raise exception '% assertion(s) failed', bad; end if;
end $$;
