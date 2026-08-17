-- Behavioural proof for 0116: the AI market-management action layer.
--
-- The claims under test, in the order the CTO gate stated them:
--   1. No AI-only mutation path — every write is an owner-scoped RPC that rides the canonical
--      lifecycle: edits are plain column updates, sold-out IS 'completed', reactivation runs
--      renew_listing and therefore the 0104 allowance gate.
--   2. Ownership is rechecked server-side on every call; another seller's listing id behaves
--      exactly like a nonexistent one.
--   3. Confirmation is server-bound: renewal-class and bulk actions execute only through
--      ai_confirm_action on a pending row the model cannot create-and-confirm in one breath.
--   4. The AI cannot manufacture a free renewal: exhausted allowance surfaces as
--      PAYMENT_REQUIRED and the listing stays down.
--
-- Run against a THROWAWAY database only (run_ai_actions_tests.sh).

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

-- Taxonomy for synonym search (distinct slugs so seeded data can't collide).
insert into public.marketplace_taxonomy_nodes (id, name, slug, path, search_synonyms, active) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Tomatoes', 'ai-act-tomatoes',
   'produce/vegetables/ai-act-tomatoes', array['tomato', 'roma', 'love apple'], true)
on conflict (id) do nothing;

-- ============================================================================
-- Fixtures: four sellers, four plans
--   A sponsor (unlimited) — general semantics without cap noise
--   B free              — the attacker; owns nothing here
--   C free              — paid-renewal proof (Free has 0 included renewals)
--   D grower            — free-renewal proof (Pro has 3 included renewals)
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  b uuid := '00000000-0000-0000-0000-0000000000b2';
  c uuid := '00000000-0000-0000-0000-0000000000c3';
  d uuid := '00000000-0000-0000-0000-0000000000d4';
  ma uuid; mc uuid; md uuid;
begin
  insert into auth.users (id) values (a), (b), (c), (d) on conflict do nothing;
  delete from public.markets where owner_id in (a, b, c, d);
  insert into public.markets (owner_id, plan) values (a, 'sponsor') returning id into ma;
  insert into public.markets (owner_id, plan) values (b, 'free');
  insert into public.markets (owner_id, plan) values (c, 'free') returning id into mc;
  insert into public.markets (owner_id, plan) values (d, 'grower') returning id into md;

  -- A's shelf. Inserting status='active' fires the canonical allowance trigger (sponsor:
  -- recorded as funded='unlimited', spends nothing).
  insert into public.listings (id, owner_id, market_id, title, category, price_cents, unit,
                               listing_type, taxonomy_node_id, status, expires_at) values
    ('11111111-0000-0000-0000-000000000001', a, ma, 'Roma Tomatoes', 'vegetables', 1200, 'peck',
     'sale', 'bbbbbbbb-0000-0000-0000-000000000001', 'active', now() + interval '20 days'),
    ('11111111-0000-0000-0000-000000000002', a, ma, 'Cherry Tomatoes', 'vegetables', 600, 'pint',
     'sale', 'bbbbbbbb-0000-0000-0000-000000000001', 'active', now() + interval '20 days'),
    ('11111111-0000-0000-0000-000000000003', a, ma, 'Cucumbers', 'vegetables', 50, 'each',
     'sale', null, 'active', now() + interval '1 day'),
    ('11111111-0000-0000-0000-000000000005', a, ma, 'Sourdough Bread', 'bakery', 800, 'loaf',
     'sale', null, 'active', now() + interval '7 days'),
    ('11111111-0000-0000-0000-000000000006', a, ma, 'Green Beans', 'vegetables', 400, 'quart',
     'sale', null, 'active', now() + interval '7 days'),
    ('11111111-0000-0000-0000-000000000007', a, ma, 'Zucchini', 'vegetables', 100, 'each',
     'sale', null, 'active', now() + interval '7 days');
  insert into public.listings (id, owner_id, market_id, title, category, listing_type, status, expires_at)
  values ('11111111-0000-0000-0000-000000000004', a, ma, 'Free Mulch', 'garden', 'free',
          'active', now() + interval '20 days');

  -- Age two of A's listings into the reactivation states (superuser update; the gate only
  -- fires on transitions INTO 'active').
  update public.listings set status = 'completed'
   where id = '11111111-0000-0000-0000-000000000005';
  update public.listings set status = 'expired', expires_at = now() - interval '1 day'
   where id = '11111111-0000-0000-0000-000000000006';

  -- C: one published Sell listing (1 of Free's 3 publishes), then expired.
  insert into public.listings (id, owner_id, market_id, title, category, price_cents, unit,
                               listing_type, status, expires_at)
  values ('33333333-0000-0000-0000-000000000001', c, mc, 'Cider Donuts', 'bakery', 600, 'dozen',
          'sale', 'active', now() + interval '7 days');
  update public.listings set status = 'expired', expires_at = now() - interval '1 day'
   where id = '33333333-0000-0000-0000-000000000001';

  -- D: one published Sell listing, then expired.
  insert into public.listings (id, owner_id, market_id, title, category, price_cents, unit,
                               listing_type, status, expires_at)
  values ('44444444-0000-0000-0000-000000000001', d, md, 'Peaches', 'fruit', 900, 'peck',
          'sale', 'active', now() + interval '7 days');
  update public.listings set status = 'expired', expires_at = now() - interval '1 day'
   where id = '44444444-0000-0000-0000-000000000001';

  -- A's drafts for the Build My Market continuity reads.
  insert into public.listing_drafts (id, owner_id, market_id, source, status, title, listing_type,
                                     price_cents, unit) values
    ('aaaa1111-0000-0000-0000-000000000001', a, ma, 'market_import', 'pending',
     'Banana Peppers', 'sale', null, null),
    ('aaaa1111-0000-0000-0000-000000000002', a, ma, 'market_import', 'pending',
     'Red Potatoes', 'sale', 500, 'bag'),
    ('aaaa1111-0000-0000-0000-000000000003', a, ma, 'market_import', 'pending',
     'Free Seedlings', 'free', null, null),
    ('aaaa1111-0000-0000-0000-000000000004', a, ma, 'ai_photo', 'published',
     'Published Jam', 'sale', 700, 'jar');
end $$;

-- ============================================================================
-- 1. Exposure: anon executes nothing; sellers execute everything
-- ============================================================================
do $$
begin
  perform pg_temp.ck('anon cannot execute any AI action function',
    not has_function_privilege('anon', 'public.ai_find_my_listings(text)', 'execute')
    and not has_function_privilege('anon', 'public.ai_set_price(uuid,int,text,text)', 'execute')
    and not has_function_privilege('anon', 'public.ai_mark_sold(uuid,text)', 'execute')
    and not has_function_privilege('anon', 'public.ai_propose_action(text,uuid[],jsonb,text,text)', 'execute')
    and not has_function_privilege('anon', 'public.ai_confirm_action(uuid)', 'execute'));
  perform pg_temp.ck('authenticated can execute the layer',
    has_function_privilege('authenticated', 'public.ai_find_my_listings(text)', 'execute')
    and has_function_privilege('authenticated', 'public.ai_confirm_action(uuid)', 'execute'));
  perform pg_temp.ck('pending actions are not client-writable',
    not has_table_privilege('authenticated', 'public.ai_pending_actions', 'insert')
    and not has_table_privilege('authenticated', 'public.ai_pending_actions', 'update'));

  perform set_config('request.jwt.claims', '{}', false);
  perform pg_temp.ck_raises('no JWT means no reads',
    $q$ select * from public.ai_my_inventory() $q$, 'UNAUTHENTICATED');
  perform pg_temp.ck_raises('no JWT means no writes',
    $q$ select public.ai_set_price('11111111-0000-0000-0000-000000000001', 100) $q$, 'UNAUTHENTICATED');
end $$;

-- ============================================================================
-- 2. Resolution reads: fuzzy, ranked, owner-scoped
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  b uuid := '00000000-0000-0000-0000-0000000000b2';
  n int; top uuid;
begin
  perform pg_temp.impersonate(a);

  select count(*) into n from public.ai_find_my_listings('roma tomatoes');
  select id into top from public.ai_find_my_listings('roma tomatoes') order by score desc limit 1;
  perform pg_temp.ck('exact title ranks first',
    top = '11111111-0000-0000-0000-000000000001', format('top=%s n=%s', top, n));

  select count(*) into n from public.ai_find_my_listings('tomatoes');
  perform pg_temp.ck('a generic query surfaces BOTH tomato listings (ambiguity is visible)',
    n >= 2, format('n=%s', n));

  select count(*) into n from public.ai_find_my_listings('love apple');
  perform pg_temp.ck('taxonomy synonyms resolve (love apple -> tomatoes)', n >= 2, format('n=%s', n));

  select count(*) into n from public.ai_find_my_listings('sourdough');
  perform pg_temp.ck('completed listings are findable (restock needs them)', n = 1, format('n=%s', n));

  select count(*) into n from public.ai_my_inventory();
  perform pg_temp.ck('inventory covers active + completed + expired', n = 7, format('n=%s', n));

  select count(*) into n from public.ai_my_expiring(2);
  perform pg_temp.ck('expiring window catches tomorrow, not day 20', n = 1, format('n=%s', n));

  -- The attacker sees an empty shop.
  perform pg_temp.impersonate(b);
  select count(*) into n from public.ai_find_my_listings('tomatoes');
  perform pg_temp.ck('another seller''s search never leaks A''s rows', n = 0, format('n=%s', n));
  select count(*) into n from public.ai_my_inventory();
  perform pg_temp.ck('another seller''s inventory is their own (empty)', n = 0, format('n=%s', n));
end $$;

-- ============================================================================
-- 3. Price and quantity edits: canonical column updates, zero allowance
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  b uuid := '00000000-0000-0000-0000-0000000000b2';
  roma uuid := '11111111-0000-0000-0000-000000000001';
  r jsonb; ev record; before_events int; after_events int;
begin
  select count(*) into before_events from public.listing_publish_events;
  perform pg_temp.impersonate(a);

  r := public.ai_set_price(roma, 500, 'quart', 'req-price-1');
  perform pg_temp.ck('price change lands ($5/quart on Roma)',
    (r ->> 'ok')::boolean
    and exists (select 1 from public.listings
                 where id = roma and price_cents = 500 and unit = 'quart' and status = 'active'),
    r::text);

  select * into ev from public.events
   where event_type = 'ai_action' and listing_id = roma
     and metadata ->> 'action' = 'set_price'
   order by created_at desc limit 1;
  perform pg_temp.ck('price change is audited with prev and new',
    ev.user_id = a
    and (ev.metadata -> 'prev' ->> 'price_cents')::int = 1200
    and (ev.metadata -> 'new'  ->> 'price_cents')::int = 500
    and ev.metadata ->> 'request_id' = 'req-price-1',
    coalesce(ev.metadata::text, 'no event row'));

  r := public.ai_set_quantity(roma, '8 baskets left', 'req-qty-1');
  perform pg_temp.ck('quantity edit lands',
    exists (select 1 from public.listings where id = roma and quantity = '8 baskets left'), r::text);

  -- Validation refuses instead of guessing.
  perform pg_temp.ck_raises('price 0 refused',
    format($q$ select public.ai_set_price('%s', 0) $q$, roma), 'INVALID_PRICE');
  perform pg_temp.ck_raises('price above $1000 refused',
    format($q$ select public.ai_set_price('%s', 100001) $q$, roma), 'INVALID_PRICE');
  perform pg_temp.ck_raises('unknown unit refused',
    format($q$ select public.ai_set_price('%s', 500, 'firkin') $q$, roma), 'INVALID_UNIT');
  perform pg_temp.ck_raises('price on a Free listing refused',
    $q$ select public.ai_set_price('11111111-0000-0000-0000-000000000004', 500) $q$,
    'NOT_A_SALE_LISTING');
  perform pg_temp.ck_raises('60+ char quantity refused',
    format($q$ select public.ai_set_quantity('%s', '%s') $q$, roma, repeat('x', 61)),
    'INVALID_QUANTITY');

  -- Ownership: B attacking A's listing learns nothing, changes nothing.
  perform pg_temp.impersonate(b);
  perform pg_temp.ck_raises('another seller''s price attack reads as NOT FOUND',
    format($q$ select public.ai_set_price('%s', 1) $q$, roma), 'LISTING_NOT_FOUND');
  perform pg_temp.ck('the attack changed nothing',
    exists (select 1 from public.listings where id = roma and price_cents = 500));

  select count(*) into after_events from public.listing_publish_events;
  perform pg_temp.ck('edits consumed zero allowance', after_events = before_events,
    format('%s -> %s', before_events, after_events));
end $$;

-- ============================================================================
-- 4. Sold out: the canonical 'completed' transition, still zero allowance
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  cukes uuid := '11111111-0000-0000-0000-000000000003';
  beans uuid := '11111111-0000-0000-0000-000000000006';
  r jsonb; before_events int; after_events int;
begin
  select count(*) into before_events from public.listing_publish_events;
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000a1');

  r := public.ai_mark_sold(cukes, 'req-sold-1');
  perform pg_temp.ck('sold out = status completed (Gnome''s own Mark sold)',
    (r ->> 'ok')::boolean
    and exists (select 1 from public.listings where id = cukes and status = 'completed'), r::text);

  r := public.ai_mark_sold(cukes, 'req-sold-2');
  perform pg_temp.ck('marking sold twice is idempotent, not an error',
    (r ->> 'ok')::boolean and (r ->> 'already')::boolean, r::text);

  perform pg_temp.ck_raises('an expired listing cannot be marked sold',
    format($q$ select public.ai_mark_sold('%s') $q$, beans), 'LISTING_NOT_ACTIVE');

  select count(*) into after_events from public.listing_publish_events;
  perform pg_temp.ck('sold-out consumed zero allowance', after_events = before_events);
  perform pg_temp.ck('sold-out is audited',
    exists (select 1 from public.events
             where event_type = 'ai_action' and listing_id = cukes
               and metadata ->> 'action' = 'mark_sold'));
end $$;

-- ============================================================================
-- 5. Server-bound confirmation: propose is inert, confirm executes, gates hold
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  b uuid := '00000000-0000-0000-0000-0000000000b2';
  bread uuid := '11111111-0000-0000-0000-000000000005';
  roma uuid := '11111111-0000-0000-0000-000000000001';
  r jsonb; act uuid;
begin
  perform pg_temp.impersonate(a);

  -- Guard rails on proposal creation itself.
  perform pg_temp.ck_raises('unknown action name refused',
    format($q$ select public.ai_propose_action('drop_table', array['%s']::uuid[]) $q$, bread),
    'BAD_ACTION');
  perform pg_temp.ck_raises('bulk beyond 20 refused',
    format($q$ select public.ai_propose_action('mark_sold_bulk',
      array(select gen_random_uuid() from generate_series(1, 21))) $q$), 'BULK_LIMIT');
  perform pg_temp.ck_raises('unknown payload field refused',
    format($q$ select public.ai_propose_action('set_price_bulk', array['%s']::uuid[],
      '{"price_cents": 100, "status": "active"}'::jsonb) $q$, roma), 'UNKNOWN_FIELD');
  perform pg_temp.ck_raises('one foreign listing poisons the whole proposal',
    format($q$ select public.ai_propose_action('mark_sold_bulk',
      array['%s', '33333333-0000-0000-0000-000000000001']::uuid[]) $q$, roma),
    'LISTING_NOT_FOUND');

  -- Restock through the canonical gate.
  r := public.ai_propose_action('restock', array[bread], '{}',
        'Restock Sourdough Bread (runs your plan''s renewal rules)', 'req-restock-1');
  act := (r ->> 'action_id')::uuid;
  perform pg_temp.ck('restock proposal is a pending row, listing untouched',
    exists (select 1 from public.ai_pending_actions where id = act and status = 'pending')
    and exists (select 1 from public.listings where id = bread and status = 'completed'), r::text);

  -- The seller's confirmation is another seller's nothing.
  perform pg_temp.impersonate(b);
  perform pg_temp.ck_raises('another seller cannot confirm the action',
    format($q$ select public.ai_confirm_action('%s') $q$, act), 'ACTION_NOT_FOUND');

  perform pg_temp.impersonate(a);
  r := public.ai_confirm_action(act);
  perform pg_temp.ck('confirmed restock reactivates through renew_listing',
    (r ->> 'ok_count')::int = 1
    and exists (select 1 from public.listings
                 where id = bread and status = 'active' and expires_at > now() + interval '1 day'),
    r::text);
  perform pg_temp.ck('the reactivation went through the 0104 gate as a RENEWAL',
    exists (select 1 from public.listing_publish_events
             where listing_id = bread and kind = 'renewal'));

  perform pg_temp.ck_raises('double confirm refused',
    format($q$ select public.ai_confirm_action('%s') $q$, act), 'ACTION_ALREADY');

  -- Expiry and cancellation.
  r := public.ai_propose_action('mark_sold_bulk', array[roma], '{}', 'x', null);
  act := (r ->> 'action_id')::uuid;
  update public.ai_pending_actions set expires_at = now() - interval '1 minute' where id = act;
  perform pg_temp.ck_raises('a stale proposal cannot execute',
    format($q$ select public.ai_confirm_action('%s') $q$, act), 'ACTION_EXPIRED');

  r := public.ai_propose_action('mark_sold_bulk', array[roma], '{}', 'x', null);
  act := (r ->> 'action_id')::uuid;
  perform public.ai_cancel_action(act);
  perform pg_temp.ck('cancelled proposal cannot execute, listing untouched',
    exists (select 1 from public.ai_pending_actions where id = act and status = 'cancelled')
    and exists (select 1 from public.listings where id = roma and status = 'active'));
end $$;

-- ============================================================================
-- 6. Monetization: included renewal works; exhausted renewal is PAYMENT, not magic
-- ============================================================================
do $$
declare
  c uuid := '00000000-0000-0000-0000-0000000000c3';
  d uuid := '00000000-0000-0000-0000-0000000000d4';
  donuts uuid := '33333333-0000-0000-0000-000000000001';
  peaches uuid := '44444444-0000-0000-0000-000000000001';
  r jsonb; act uuid;
begin
  -- Pro seller, included renewal.
  perform pg_temp.impersonate(d);
  r := public.ai_propose_action('renew', array[peaches], '{}', 'Renew Peaches', 'req-renew-d');
  act := (r ->> 'action_id')::uuid;
  r := public.ai_confirm_action(act);
  perform pg_temp.ck('Pro renewal executes as an INCLUDED renewal',
    (r ->> 'ok_count')::int = 1 and (r ->> 'payment_needed')::int = 0
    and exists (select 1 from public.listings where id = peaches and status = 'active')
    and exists (select 1 from public.listing_publish_events
                 where listing_id = peaches and kind = 'renewal' and funded = 'included'),
    r::text);

  -- Free seller, zero included renewals: the gate refuses; we translate, we do not override.
  perform pg_temp.impersonate(c);
  r := public.ai_propose_action('renew', array[donuts], '{}', 'Renew Cider Donuts', 'req-renew-c');
  act := (r ->> 'action_id')::uuid;
  r := public.ai_confirm_action(act);
  perform pg_temp.ck('exhausted allowance surfaces as PAYMENT_REQUIRED at $0.99',
    (r ->> 'ok_count')::int = 0 and (r ->> 'payment_needed')::int = 1
    and r -> 'results' -> 0 ->> 'error' = 'PAYMENT_REQUIRED'
    and (r -> 'results' -> 0 ->> 'price_cents')::int = 99,
    r::text);
  perform pg_temp.ck('the refused listing stayed down — no free renewal was manufactured',
    exists (select 1 from public.listings where id = donuts and status = 'expired'));
  perform pg_temp.ck('the refusal is audited',
    exists (select 1 from public.events
             where event_type = 'ai_action' and listing_id = donuts
               and metadata -> 'new' ->> 'refused' = 'PAYMENT_REQUIRED'));
end $$;

-- ============================================================================
-- 7. Bulk execution: capped, confirmed, each item through the same canonical path
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  roma uuid := '11111111-0000-0000-0000-000000000001';
  zuke uuid := '11111111-0000-0000-0000-000000000007';
  r jsonb; act uuid;
begin
  perform pg_temp.impersonate(a);
  r := public.ai_propose_action('set_price_bulk', array[roma, zuke],
        '{"price_cents": 250, "unit": "lb"}', 'Everything to $2.50/lb', 'req-bulk-1');
  act := (r ->> 'action_id')::uuid;
  perform pg_temp.ck('bulk price proposal pends without touching rows',
    exists (select 1 from public.listings where id = roma and price_cents = 500));

  r := public.ai_confirm_action(act);
  perform pg_temp.ck('confirmed bulk price applies to every listed item',
    (r ->> 'ok_count')::int = 2
    and (select count(*) from public.listings
          where id in (roma, zuke) and price_cents = 250 and unit = 'lb') = 2,
    r::text);
end $$;

-- ============================================================================
-- 8. Draft reads and edits
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';
  n int; r jsonb;
begin
  perform pg_temp.impersonate(a);

  select count(*) into n from public.ai_my_drafts(false);
  perform pg_temp.ck('all pending drafts listed (published ones excluded)', n = 3, format('n=%s', n));

  select count(*) into n from public.ai_my_drafts(true);
  perform pg_temp.ck('missing-price filter = Sell drafts without a price, only',
    n = 1 and exists (select 1 from public.ai_my_drafts(true) where title = 'Banana Peppers'),
    format('n=%s', n));

  r := public.ai_update_draft('aaaa1111-0000-0000-0000-000000000001', 350, 'each', null, 'req-draft-1');
  perform pg_temp.ck('draft price fill lands',
    exists (select 1 from public.listing_drafts
             where id = 'aaaa1111-0000-0000-0000-000000000001'
               and price_cents = 350 and unit = 'each' and status = 'pending'), r::text);
  select count(*) into n from public.ai_my_drafts(true);
  perform pg_temp.ck('the filled draft leaves the missing-price list', n = 0, format('n=%s', n));

  perform pg_temp.ck_raises('published drafts are not editable',
    $q$ select public.ai_update_draft('aaaa1111-0000-0000-0000-000000000004', 100) $q$,
    'DRAFT_NOT_PENDING');
  perform pg_temp.ck_raises('draft price validation holds',
    $q$ select public.ai_update_draft('aaaa1111-0000-0000-0000-000000000002', 0) $q$,
    'INVALID_PRICE');
end $$;

-- ============================================================================
-- 9. Payment identity: a $0.99 authorization funds EXACTLY what it bought
--    (the CTO gate's Section-4 proof: existing architecture, demonstrated)
-- ============================================================================
do $$
declare
  f uuid := '00000000-0000-0000-0000-0000000000f5';
  g uuid := '00000000-0000-0000-0000-0000000000f6';
  mf uuid; mg uuid;
  f1 uuid := 'ffff1111-0000-0000-0000-000000000001';
  f2 uuid := 'ffff1111-0000-0000-0000-000000000002';
  g1 uuid := 'ffff2222-0000-0000-0000-000000000001';
  auth_id uuid; act uuid; r jsonb; n int;
begin
  insert into auth.users (id) values (f), (g) on conflict do nothing;
  delete from public.markets where owner_id in (f, g);
  insert into public.markets (owner_id, plan) values (f, 'free') returning id into mf;
  insert into public.markets (owner_id, plan) values (g, 'free') returning id into mg;

  -- Two published-then-expired Sell listings for F (2 of Free's 3 publishes), one for G.
  insert into public.listings (id, owner_id, market_id, title, category, price_cents, unit, listing_type, status, expires_at) values
    (f1, f, mf, 'Paid Peaches', 'fruit', 500, 'lb', 'sale', 'active', now() + interval '7 days'),
    (f2, f, mf, 'Paid Plums', 'fruit', 400, 'lb', 'sale', 'active', now() + interval '7 days'),
    (g1, g, mg, 'Foreign Figs', 'fruit', 300, 'lb', 'sale', 'active', now() + interval '7 days');
  update public.listings set status = 'expired', expires_at = now() - interval '1 day'
   where id in (f1, f2, g1);

  -- A PAID authorization bound to listing F1, intent renewal (what checkout+webhook produce).
  insert into public.listing_publish_authorizations
    (market_id, listing_id, intent, amount_cents, stripe_session_id, status, paid_at)
  values (mf, f1, 'renewal', 99, 'cs_test_ai_actions_f1', 'paid', now())
  returning id into auth_id;

  perform pg_temp.impersonate(f);

  -- (a) The auth bound to F1 cannot renew F2.
  r := public.ai_propose_action('renew', array[f2], '{}', 'renew F2', null);
  r := public.ai_confirm_action((r ->> 'action_id')::uuid);
  perform pg_temp.ck('a listing-bound payment cannot renew a DIFFERENT listing',
    (r ->> 'payment_needed')::int = 1
    and exists (select 1 from public.listings where id = f2 and status = 'expired')
    and exists (select 1 from public.listing_publish_authorizations where id = auth_id and status = 'paid'),
    r::text);

  -- (b) An EXPIRED pending action cannot spend it either; the payment survives untouched.
  r := public.ai_propose_action('renew', array[f1], '{}', 'renew F1', null);
  act := (r ->> 'action_id')::uuid;
  update public.ai_pending_actions set expires_at = now() - interval '1 minute' where id = act;
  perform pg_temp.ck_raises('an expired proposal cannot spend the payment',
    format($q$ select public.ai_confirm_action('%s') $q$, act), 'ACTION_EXPIRED');
  perform pg_temp.ck('the payment survives an expired proposal',
    exists (select 1 from public.listing_publish_authorizations where id = auth_id and status = 'paid'));

  -- (c) Resume-later: a FRESH proposal + confirm consumes the payment for exactly F1.
  r := public.ai_propose_action('renew', array[f1], '{}', 'renew F1 again', null);
  r := public.ai_confirm_action((r ->> 'action_id')::uuid);
  perform pg_temp.ck('a fresh confirm consumes the payment and renews exactly the paid listing',
    (r ->> 'ok_count')::int = 1
    and exists (select 1 from public.listings where id = f1 and status = 'active')
    and exists (select 1 from public.listing_publish_authorizations
                 where id = auth_id and status = 'consumed' and listing_id = f1),
    r::text);
  select count(*) into n from public.listing_publish_events
   where authorization_id = auth_id;
  perform pg_temp.ck('the payment funded exactly ONE ledger event', n = 1, format('n=%s', n));

  -- (d) The consumed payment funds nothing further.
  r := public.ai_propose_action('renew', array[f2], '{}', 'renew F2 retry', null);
  r := public.ai_confirm_action((r ->> 'action_id')::uuid);
  perform pg_temp.ck('a consumed payment funds nothing else',
    (r ->> 'payment_needed')::int = 1
    and exists (select 1 from public.listings where id = f2 and status = 'expired'), r::text);

  -- (e) Foreign market: F's money never renews G's listing.
  perform pg_temp.impersonate(g);
  insert into public.listing_publish_authorizations
    (market_id, listing_id, intent, amount_cents, stripe_session_id, status, paid_at)
  values (mf, null, 'renewal', 99, 'cs_test_ai_actions_floating', 'paid', now());
  r := public.ai_propose_action('renew', array[g1], '{}', 'renew G1', null);
  r := public.ai_confirm_action((r ->> 'action_id')::uuid);
  perform pg_temp.ck('another market''s payment never funds this seller''s renewal',
    (r ->> 'payment_needed')::int = 1
    and exists (select 1 from public.listings where id = g1 and status = 'expired'), r::text);

  -- (f) Intent binding: a renewal-intent payment cannot fund a PUBLISH.
  perform pg_temp.impersonate(f);
  insert into public.listings (owner_id, market_id, title, category, price_cents, unit, listing_type, status, expires_at)
  values (f, mf, 'Third Publish', 'fruit', 200, 'lb', 'sale', 'active', now() + interval '7 days');
  -- Free's 3 publishes now spent (F1, F2, Third). The floating renewal-intent payment above
  -- belongs to F's market — a 4th PUBLISH must still refuse.
  begin
    insert into public.listings (owner_id, market_id, title, category, price_cents, unit, listing_type, status, expires_at)
    values (f, mf, 'Fourth Publish', 'fruit', 200, 'lb', 'sale', 'active', now() + interval '7 days');
    perform pg_temp.ck('a renewal payment cannot fund a publish', false, 'insert unexpectedly succeeded');
  exception when others then
    perform pg_temp.ck('a renewal payment cannot fund a publish',
      position('PUBLISH_ALLOWANCE_EXHAUSTED' in sqlerrm) > 0, left(sqlerrm, 80));
  end;

  -- (g) Webhook replay: mark_authorization_paid flips a session exactly once.
  perform set_config('request.jwt.claims', '{}', false);
  perform public.create_publish_authorization(mf, 'renewal', f2, 'cs_test_ai_actions_replay', 99);
  perform pg_temp.ck('webhook marks a pending authorization paid once',
    public.mark_authorization_paid('cs_test_ai_actions_replay', 'pi_test_1') = true);
  perform pg_temp.ck('a webhook replay is a no-op',
    public.mark_authorization_paid('cs_test_ai_actions_replay', 'pi_test_1') = false);
end $$;

-- ============================================================================
-- 10. Audit hygiene: actions leave a trail; the trail holds no conversation
-- ============================================================================
do $$
declare n int; bad int;
begin
  select count(*) into n from public.events where event_type = 'ai_action';
  perform pg_temp.ck('every mutation family left ai_action events', n >= 8, format('n=%s', n));

  select count(*) into bad from public.events
   where event_type = 'ai_action'
     and (metadata ? 'message' or metadata ? 'messages' or metadata ? 'conversation'
          or metadata ? 'prompt' or metadata ? 'reply');
  perform pg_temp.ck('audit rows carry structured facts, never conversation text', bad = 0);
end $$;

-- ============================================================================
select format('%s/%s passed', count(*) filter (where ok), count(*)) as ai_actions_suite from _t;
select format('  %s  %s  %s', lpad(n::text, 3), rpad(name, 72), case when ok then 'PASS' else 'FAIL  ' || detail end)
  from _t order by n;
do $$
declare bad int;
begin
  select count(*) into bad from _t where not ok;
  if bad > 0 then raise exception '% checks failed', bad; end if;
end $$;
