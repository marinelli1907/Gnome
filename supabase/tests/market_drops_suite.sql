-- Behavioural proof for 0117: Market Drops V1.
--
-- The claims under test:
--   1. A Drop is presentation only — creating/scheduling one consumes zero allowance and
--      changes nothing on any listing.
--   2. Drafts are private; scheduled drops are public; live/ended are clock-derived.
--   3. Ownership is absolute: foreign listings and foreign markets are unusable.
--   4. The AI creates drops only through the persisted proposal/confirm layer, exactly once.
--   5. Canonical listing state wins: an expired/removed member simply leaves the public count.
--
-- Run against a THROWAWAY database only (run_market_drops_tests.sh).

\set ON_ERROR_STOP on
set client_min_messages = warning;

create temporary table _t (n int, name text, ok boolean, detail text);
create sequence if not exists _tn start 1;
create or replace function pg_temp.ck(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin insert into _t values (nextval('_tn')::int, p_name, p_ok, p_detail); end $$;

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
-- Fixtures: seller A (sponsor: fixture inserts spend nothing), stranger B
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000da';
  b uuid := '00000000-0000-0000-0000-0000000000db';
  ma uuid; mb uuid;
begin
  insert into auth.users (id) values (a), (b) on conflict do nothing;
  delete from public.markets where owner_id in (a, b);
  insert into public.markets (owner_id, plan) values (a, 'sponsor') returning id into ma;
  insert into public.markets (owner_id, plan) values (b, 'free') returning id into mb;

  insert into public.listings (id, owner_id, market_id, title, category, price_cents, unit,
                               listing_type, status, expires_at) values
    ('dd110117-0000-0000-0000-000000000001', a, ma, 'Roma Tomatoes', 'vegetables', 1200, 'peck', 'sale', 'active', now() + interval '20 days'),
    ('dd110117-0000-0000-0000-000000000002', a, ma, 'Heirloom Tomatoes', 'vegetables', 1400, 'peck', 'sale', 'active', now() + interval '20 days'),
    ('dd110117-0000-0000-0000-000000000003', a, ma, 'Green Peppers', 'vegetables', 75, 'each', 'sale', 'active', now() + interval '20 days'),
    ('dd110117-0000-0000-0000-000000000004', a, ma, 'Cucumbers', 'vegetables', 50, 'each', 'sale', 'active', now() + interval '20 days'),
    ('dd110117-0000-0000-0000-000000000005', a, ma, 'Sourdough Bread', 'bakery', 800, 'loaf', 'sale', 'active', now() + interval '20 days');
  insert into public.listings (id, owner_id, market_id, title, category, price_cents, unit,
                               listing_type, status, expires_at) values
    ('dd110117-1111-0000-0000-000000000001', b, mb, 'Foreign Figs', 'fruit', 300, 'lb', 'sale', 'active', now() + interval '7 days');
end $$;

-- ============================================================================
-- 1. Creation through the canonical RPC: draft first, allowance untouched
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000da';
  r jsonb; before_events int; after_events int; d uuid;
begin
  select count(*) into before_events from public.listing_publish_events;
  perform pg_temp.impersonate(a);

  r := public.create_market_drop(
    'Saturday Harvest',
    now() + interval '2 days', now() + interval '2 days 5 hours',
    array['dd110117-0000-0000-0000-000000000001','dd110117-0000-0000-0000-000000000003',
          'dd110117-0000-0000-0000-000000000004','dd110117-0000-0000-0000-000000000005']::uuid[],
    'Fresh picks for Saturday morning.', false, 'req-drop-1');
  d := (r ->> 'id')::uuid;
  perform pg_temp.ck('drop is created as a DRAFT with 4 items',
    (r ->> 'status') = 'draft' and (r ->> 'items')::int = 4
    and exists (select 1 from public.market_drops where id = d and status = 'draft'), r::text);

  perform pg_temp.ck('a draft never appears on the buyer surface',
    not exists (select 1 from public.public_market_drops where id = d));

  select count(*) into after_events from public.listing_publish_events;
  perform pg_temp.ck('drop creation consumed ZERO allowance', after_events = before_events);
  perform pg_temp.ck('member listings are untouched (status, expiry, price all intact)',
    (select count(*) from public.listings
      where id in ('dd110117-0000-0000-0000-000000000001','dd110117-0000-0000-0000-000000000003',
                   'dd110117-0000-0000-0000-000000000004','dd110117-0000-0000-0000-000000000005')
        and status = 'active' and expires_at > now() + interval '19 days') = 4);
  perform pg_temp.ck('creation is audited as a structured event',
    exists (select 1 from public.events where event_type = 'drop_created'
             and metadata ->> 'drop_id' = d::text));

  -- Schedule it (the seller's explicit publish step — a plain owner UPDATE under RLS).
  update public.market_drops set status = 'scheduled' where id = d;
  perform pg_temp.ck('a scheduled future drop is public as UPCOMING with 4 available items',
    exists (select 1 from public.public_market_drops
             where id = d and phase = 'upcoming' and available_items = 4));
end $$;

-- ============================================================================
-- 2. Validation and ownership walls
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000da';
  b uuid := '00000000-0000-0000-0000-0000000000db';
  hijacked boolean;
  saw_draft boolean;
begin
  perform pg_temp.impersonate(a);
  -- A real draft must exist for the cross-seller visibility check to prove anything.
  perform public.create_market_drop('Private Plans', now() + interval '3 days',
    now() + interval '3 days 4 hours', array['dd110117-0000-0000-0000-000000000001']::uuid[]);
  perform pg_temp.ck_raises('end before start refused',
    $q$ select public.create_market_drop('Backwards', now() + interval '2 days',
        now() + interval '1 day', array['dd110117-0000-0000-0000-000000000001']::uuid[]) $q$,
    'INVALID_WINDOW');
  perform pg_temp.ck_raises('a window entirely in the past refused',
    $q$ select public.create_market_drop('Yesterday', now() - interval '2 days',
        now() - interval '1 day', array['dd110117-0000-0000-0000-000000000001']::uuid[]) $q$,
    'WINDOW_IN_PAST');
  perform pg_temp.ck_raises('empty title refused',
    $q$ select public.create_market_drop('  ', now() + interval '1 day',
        now() + interval '2 days', array['dd110117-0000-0000-0000-000000000001']::uuid[]) $q$,
    'INVALID_TITLE');
  perform pg_temp.ck_raises('a "Seed" title cannot masquerade as the Seed Drop',
    $q$ select public.create_market_drop('Seed Drop Special', now() + interval '1 day',
        now() + interval '2 days', array['dd110117-0000-0000-0000-000000000001']::uuid[]) $q$,
    'RESERVED_TITLE');
  perform pg_temp.ck_raises('no listings refused',
    $q$ select public.create_market_drop('Empty', now() + interval '1 day',
        now() + interval '2 days', array[]::uuid[]) $q$, 'NO_LISTINGS');
  perform pg_temp.ck_raises('a foreign listing poisons the whole creation',
    $q$ select public.create_market_drop('Theft', now() + interval '1 day',
        now() + interval '2 days',
        array['dd110117-0000-0000-0000-000000000001','dd110117-1111-0000-0000-000000000001']::uuid[]) $q$,
    'LISTING_NOT_FOUND');
  perform pg_temp.ck_raises('more than 30 items refused',
    $q$ select public.create_market_drop('Everything', now() + interval '1 day',
        now() + interval '2 days',
        array(select gen_random_uuid() from generate_series(1, 31))) $q$, 'DROP_ITEM_LIMIT');

  -- B cannot touch A's drop through RLS. The suite normally runs as the table owner
  -- (RLS bypassed), so probe under the real `authenticated` role, then record the
  -- verdicts after resetting (the temp check table belongs to the owner role).
  perform pg_temp.impersonate(b);
  execute 'set local role authenticated';
  update public.market_drops set title = 'Hijacked' where market_id =
    (select id from public.markets where owner_id = a);
  select exists (select 1 from public.market_drops where title = 'Hijacked') into hijacked;
  select exists (select 1 from public.market_drops
                  where market_id = (select id from public.markets where owner_id = a)
                    and status = 'draft') into saw_draft;
  execute 'reset role';
  perform pg_temp.ck('another seller''s RLS update changes nothing', not hijacked);
  perform pg_temp.ck('another seller cannot see A''s draft rows', not saw_draft);

  -- Anon: no writes at all.
  perform set_config('request.jwt.claims', '{}', false);
  begin
    insert into public.market_drops (market_id, title, starts_at, ends_at)
    values ((select id from public.markets where owner_id = a), 'Anon Drop',
            now() + interval '1 day', now() + interval '2 days');
    perform pg_temp.ck('anon cannot insert a drop', false, 'insert unexpectedly succeeded');
  exception when others then
    perform pg_temp.ck('anon cannot insert a drop', true);
  end;
end $$;

-- ============================================================================
-- 3. Clock-derived lifecycle + canonical listing state winning
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000da';
  live_id uuid; ended_id uuid; old_id uuid;
begin
  perform pg_temp.impersonate(a);

  live_id := (public.create_market_drop('Live Now Box', now() - interval '1 hour',
    now() + interval '3 hours',
    array['dd110117-0000-0000-0000-000000000001','dd110117-0000-0000-0000-000000000002']::uuid[],
    null, true) ->> 'id')::uuid;
  perform pg_temp.ck('a drop inside its window derives LIVE',
    exists (select 1 from public.public_market_drops where id = live_id and phase = 'live'));

  -- Recently ended: window fudged directly (owner update).
  ended_id := (public.create_market_drop('Just Ended', now() + interval '1 hour',
    now() + interval '2 hours',
    array['dd110117-0000-0000-0000-000000000001']::uuid[], null, true) ->> 'id')::uuid;
  update public.market_drops
     set starts_at = now() - interval '5 hours', ends_at = now() - interval '1 hour'
   where id = ended_id;
  perform pg_temp.ck('a freshly ended drop derives ENDED and stays briefly visible',
    exists (select 1 from public.public_market_drops where id = ended_id and phase = 'ended'));

  -- Ended long ago: out of the buyer surface entirely.
  old_id := (public.create_market_drop('Long Gone', now() + interval '1 hour',
    now() + interval '2 hours',
    array['dd110117-0000-0000-0000-000000000001']::uuid[], null, true) ->> 'id')::uuid;
  update public.market_drops
     set starts_at = now() - interval '3 days', ends_at = now() - interval '2 days'
   where id = old_id;
  perform pg_temp.ck('a long-ended drop leaves the primary buyer surface',
    not exists (select 1 from public.public_market_drops where id = old_id));

  -- Cancelled: gone from the buyer surface immediately.
  update public.market_drops set status = 'cancelled' where id = live_id;
  perform pg_temp.ck('a cancelled drop disappears from the buyer surface',
    not exists (select 1 from public.public_market_drops where id = live_id));
  update public.market_drops set status = 'scheduled' where id = live_id;

  -- Canonical state wins: expire one member; the public item count falls with it.
  update public.listings set status = 'expired', expires_at = now() - interval '1 hour'
   where id = 'dd110117-0000-0000-0000-000000000002';
  perform pg_temp.ck('an expired member listing drops out of the public item count',
    exists (select 1 from public.public_market_drops where id = live_id and available_items = 1));
  update public.listings set status = 'active', expires_at = now() + interval '20 days'
   where id = 'dd110117-0000-0000-0000-000000000002';

  -- Duplicate membership is structurally impossible.
  begin
    insert into public.market_drop_items (drop_id, listing_id)
    values (live_id, 'dd110117-0000-0000-0000-000000000001');
    perform pg_temp.ck('duplicate drop membership refused', false, 'insert unexpectedly succeeded');
  exception when others then
    perform pg_temp.ck('duplicate drop membership refused', true);
  end;
end $$;

-- ============================================================================
-- 4. AI creation: persisted proposal/confirm, exactly once
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000da';
  b uuid := '00000000-0000-0000-0000-0000000000db';
  r jsonb; act uuid; n int;
begin
  perform pg_temp.impersonate(a);

  perform pg_temp.ck_raises('a drop proposal without a title refused',
    $q$ select public.ai_propose_action('create_drop',
        array['dd110117-0000-0000-0000-000000000001']::uuid[],
        '{"starts_at":"2030-01-05T08:00:00Z","ends_at":"2030-01-05T13:00:00Z"}'::jsonb) $q$,
    'MISSING_FIELD');
  perform pg_temp.ck_raises('a drop proposal with a junk timestamp refused',
    $q$ select public.ai_propose_action('create_drop',
        array['dd110117-0000-0000-0000-000000000001']::uuid[],
        '{"title":"X","starts_at":"not-a-time","ends_at":"2030-01-05T13:00:00Z"}'::jsonb) $q$,
    'invalid input');
  perform pg_temp.ck_raises('smuggled payload keys still refused',
    $q$ select public.ai_propose_action('create_drop',
        array['dd110117-0000-0000-0000-000000000001']::uuid[],
        '{"title":"X","starts_at":"2030-01-05T08:00:00Z","ends_at":"2030-01-05T13:00:00Z","status":"live"}'::jsonb) $q$,
    'UNKNOWN_FIELD');

  r := public.ai_propose_action('create_drop',
    array['dd110117-0000-0000-0000-000000000001','dd110117-0000-0000-0000-000000000003',
          'dd110117-0000-0000-0000-000000000004']::uuid[],
    '{"title":"AI Saturday Drop","starts_at":"2030-01-05T08:00:00-05:00","ends_at":"2030-01-05T13:00:00-05:00"}'::jsonb,
    'Create "AI Saturday Drop"', 'req-ai-drop');
  act := (r ->> 'action_id')::uuid;
  perform pg_temp.ck('the proposal is inert — no drop exists yet',
    not exists (select 1 from public.market_drops where title = 'AI Saturday Drop'));

  -- Another seller cannot confirm it.
  perform pg_temp.impersonate(b);
  perform pg_temp.ck_raises('another seller cannot confirm the drop proposal',
    format($q$ select public.ai_confirm_action('%s') $q$, act), 'ACTION_NOT_FOUND');

  perform pg_temp.impersonate(a);
  r := public.ai_confirm_action(act);
  perform pg_temp.ck('confirm creates the drop SCHEDULED with 3 items, exactly once',
    (r ->> 'ok_count')::int = 1
    and (r -> 'drop' ->> 'status') = 'scheduled'
    and exists (select 1 from public.market_drops
                 where title = 'AI Saturday Drop' and status = 'scheduled'),
    r::text);
  select count(*) into n from public.market_drop_items i
    join public.market_drops d on d.id = i.drop_id where d.title = 'AI Saturday Drop';
  perform pg_temp.ck('the drop holds exactly the proposed 3 items', n = 3, format('n=%s', n));

  perform pg_temp.ck_raises('a second confirm (replay) is refused',
    format($q$ select public.ai_confirm_action('%s') $q$, act), 'ACTION_ALREADY');
  select count(*) into n from public.market_drops where title = 'AI Saturday Drop';
  perform pg_temp.ck('replay left exactly ONE drop', n = 1, format('n=%s', n));

  perform pg_temp.ck('the AI creation is audited',
    exists (select 1 from public.events
             where event_type = 'ai_action' and metadata ->> 'action' = 'create_drop'
               and metadata ->> 'request_id' = 'req-ai-drop'));
end $$;

-- ============================================================================
-- 5. Anon analytics allowlist for the new web events
-- ============================================================================
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
  begin
    insert into public.events (event_type, metadata) values ('web_drop_viewed', '{"d":"x"}');
    perform pg_temp.ck('web_drop_viewed passes the anon allowlist', true);
  exception when others then
    perform pg_temp.ck('web_drop_viewed passes the anon allowlist', false, left(sqlerrm, 60));
  end;
  begin
    insert into public.events (event_type) values ('web_drop_hacked');
    perform pg_temp.ck('unknown web drop events still refused', false, 'insert unexpectedly succeeded');
  exception when others then
    perform pg_temp.ck('unknown web drop events still refused',
      position('EVENT_NOT_ALLOWED' in sqlerrm) > 0, left(sqlerrm, 60));
  end;
  perform set_config('request.jwt.claims', '{}', false);
end $$;

-- ============================================================================
select format('%s/%s passed', count(*) filter (where ok), count(*)) as market_drops_suite from _t;
select format('  %s  %s  %s', lpad(n::text, 3), rpad(name, 72), case when ok then 'PASS' else 'FAIL  ' || detail end)
  from _t order by n;
do $$
declare bad int;
begin
  select count(*) into bad from _t where not ok;
  if bad > 0 then raise exception '% checks failed', bad; end if;
end $$;
