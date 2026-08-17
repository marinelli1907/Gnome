-- Behavioural proof for 0119: Market Following as a cross-platform buyer feature.
--
-- The claims under test:
--   1. A follow row is self-created and self-deleted ONLY — a forged follower_id,
--      an anonymous writer, or another user's delete all bounce off RLS.
--   2. Follows are idempotent: the unique key forbids duplicates, and an
--      on-conflict-do-nothing insert (the clients' write shape) is harmless.
--   3. The seller sees exactly ONE aggregate — their own follower count via
--      my_market_follower_count() — and can never read follower identities,
--      other markets' counts, or anyone's device tokens.
--   4. Following curates, never reveals: listing/Drop visibility is still
--      decided by the canonical public views.
--
-- Run against a THROWAWAY database only (run_market_following_tests.sh).

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
-- Fixtures: seller S with a market; buyers B1, B2, B3; rival seller R
-- ============================================================================
do $$
declare
  s  uuid := '00000000-0000-0000-0000-0000000000f0';
  r  uuid := '00000000-0000-0000-0000-0000000000f9';
  b1 uuid := '00000000-0000-0000-0000-0000000000f1';
  b2 uuid := '00000000-0000-0000-0000-0000000000f2';
  b3 uuid := '00000000-0000-0000-0000-0000000000f3';
  ms uuid; mr uuid;
begin
  insert into auth.users (id) values (s), (r), (b1), (b2), (b3) on conflict do nothing;
  delete from public.markets where owner_id in (s, r);
  insert into public.markets (id, owner_id, plan)
  values ('ff190117-0000-0000-0000-000000000001', s, 'sponsor') returning id into ms;
  insert into public.markets (id, owner_id, plan)
  values ('ff190117-0000-0000-0000-000000000002', r, 'free') returning id into mr;

  insert into public.listings (id, owner_id, market_id, title, category, price_cents, unit,
                               listing_type, status, expires_at) values
    ('ff190117-1111-0000-0000-000000000001', s, ms, 'Follow Figs', 'fruit', 400, 'lb', 'sale', 'active', now() + interval '7 days'),
    ('ff190117-1111-0000-0000-000000000002', s, ms, 'Hidden Kale', 'vegetables', 300, 'bunch', 'sale', 'paused', now() + interval '7 days');

  -- One device token per buyer, to prove the seller can't read any of them.
  insert into public.device_tokens (token, user_id, platform) values
    ('ExponentPushToken[test-b1]', b1, 'ios'),
    ('ExponentPushToken[test-b2]', b2, 'ios') on conflict do nothing;
end $$;

-- ============================================================================
-- 1. Self-only writes (probed under the real `authenticated` role)
-- ============================================================================
do $$
declare
  s  uuid := '00000000-0000-0000-0000-0000000000f0';
  b1 uuid := '00000000-0000-0000-0000-0000000000f1';
  b2 uuid := '00000000-0000-0000-0000-0000000000f2';
  b3 uuid := '00000000-0000-0000-0000-0000000000f3';
  ms uuid := 'ff190117-0000-0000-0000-000000000001';
  n int;
  forged boolean := false;
  anon_blocked boolean := false;
  cross_visible boolean;
  cross_deleted int;
  own_after_dupe int;
begin
  -- B1 follows S's market (the clients' exact write shape).
  perform pg_temp.impersonate(b1);
  execute 'set local role authenticated';
  insert into public.market_follows (market_id, follower_id) values (ms, b1)
  on conflict (market_id, follower_id) do nothing;
  select count(*) into n from public.market_follows where market_id = ms and follower_id = b1;

  -- Duplicate follow is a no-op, not a second row and not an error.
  insert into public.market_follows (market_id, follower_id) values (ms, b1)
  on conflict (market_id, follower_id) do nothing;
  select count(*) into own_after_dupe from public.market_follows where market_id = ms and follower_id = b1;

  -- B1 tries to forge a follow ON BEHALF OF B2: RLS with-check must refuse.
  begin
    insert into public.market_follows (market_id, follower_id) values (ms, b2);
    forged := false; -- insert succeeded: RLS failed
  exception when others then
    forged := true;
  end;

  -- B2 follows too, then tries to see and delete B1's relationship.
  perform pg_temp.impersonate(b2);
  insert into public.market_follows (market_id, follower_id) values (ms, b2)
  on conflict (market_id, follower_id) do nothing;
  select exists (select 1 from public.market_follows where follower_id = b1) into cross_visible;
  delete from public.market_follows where follower_id = b1;
  get diagnostics cross_deleted = row_count;

  -- Anonymous writer.
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  execute 'set local role anon';
  begin
    insert into public.market_follows (market_id, follower_id) values (ms, b3);
    anon_blocked := false;
  exception when others then
    anon_blocked := true;
  end;
  execute 'reset role';

  perform pg_temp.ck('a buyer''s follow lands exactly once', n = 1);
  perform pg_temp.ck('duplicate follow is a harmless no-op', own_after_dupe = 1);
  perform pg_temp.ck('forging a follow for another user is refused', forged);
  perform pg_temp.ck('one buyer cannot see another''s follow rows', not cross_visible);
  perform pg_temp.ck('one buyer cannot delete another''s follow', cross_deleted = 0);
  perform pg_temp.ck('anon cannot create follows', anon_blocked);
end $$;

-- ============================================================================
-- 2. Unfollow: own-row delete works, repeating it is harmless
-- ============================================================================
do $$
declare
  b2 uuid := '00000000-0000-0000-0000-0000000000f2';
  ms uuid := 'ff190117-0000-0000-0000-000000000001';
  removed int; again int; left_over int;
begin
  perform pg_temp.impersonate(b2);
  execute 'set local role authenticated';
  delete from public.market_follows where market_id = ms and follower_id = b2;
  get diagnostics removed = row_count;
  delete from public.market_follows where market_id = ms and follower_id = b2;
  get diagnostics again = row_count;
  select count(*) into left_over from public.market_follows where follower_id = b2;
  execute 'reset role';

  perform pg_temp.ck('unfollow removes the relationship', removed = 1);
  perform pg_temp.ck('unfollowing again is harmless', again = 0);
  perform pg_temp.ck('nothing lingers after unfollow', left_over = 0);

  -- Re-follow so the count tests below see B2 again.
  perform pg_temp.impersonate(b2);
  execute 'set local role authenticated';
  insert into public.market_follows (market_id, follower_id) values (ms, b2)
  on conflict (market_id, follower_id) do nothing;
  execute 'reset role';
end $$;

-- ============================================================================
-- 3. The owner aggregate: count yes, identities never
-- ============================================================================
do $$
declare
  s  uuid := '00000000-0000-0000-0000-0000000000f0';
  r  uuid := '00000000-0000-0000-0000-0000000000f9';
  b3 uuid := '00000000-0000-0000-0000-0000000000f3';
  ms uuid := 'ff190117-0000-0000-0000-000000000001';
  s_count int; r_count int; b3_count int;
  s_sees_rows boolean; s_sees_tokens boolean;
begin
  -- Third follower.
  perform pg_temp.impersonate(b3);
  execute 'set local role authenticated';
  insert into public.market_follows (market_id, follower_id) values (ms, b3)
  on conflict (market_id, follower_id) do nothing;
  execute 'reset role';

  -- The seller: count 3, zero visible rows, zero visible tokens.
  perform pg_temp.impersonate(s);
  execute 'set local role authenticated';
  select public.my_market_follower_count() into s_count;
  select exists (select 1 from public.market_follows where market_id = ms) into s_sees_rows;
  select exists (select 1 from public.device_tokens
                  where user_id <> s) into s_sees_tokens;
  execute 'reset role';

  -- The rival seller gets their OWN (empty) count, never S's.
  perform pg_temp.impersonate(r);
  execute 'set local role authenticated';
  select public.my_market_follower_count() into r_count;
  execute 'reset role';

  -- A buyer with no market gets 0, not someone else's number.
  perform pg_temp.impersonate(b3);
  execute 'set local role authenticated';
  select public.my_market_follower_count() into b3_count;
  execute 'reset role';

  perform pg_temp.ck('the owner''s follower count is exact', s_count = 3, format('got %s', s_count));
  perform pg_temp.ck('the owner cannot enumerate follower identities', not s_sees_rows);
  perform pg_temp.ck('the owner cannot read anyone''s device tokens', not s_sees_tokens);
  perform pg_temp.ck('another seller sees only their own count', r_count = 0, format('got %s', r_count));
  perform pg_temp.ck('a market-less user gets zero, not a leak', b3_count = 0, format('got %s', b3_count));
end $$;

-- anon has no execute grant on the aggregate at all.
do $$
declare blocked boolean := false;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  execute 'set local role anon';
  begin
    perform public.my_market_follower_count();
    blocked := false;
  exception when others then
    blocked := true;
  end;
  execute 'reset role';
  perform pg_temp.ck('anon cannot call the follower-count aggregate', blocked);
end $$;

-- ============================================================================
-- 4. Following curates, never reveals: canonical visibility still wins
-- ============================================================================
do $$
declare
  b1 uuid := '00000000-0000-0000-0000-0000000000f1';
  ms uuid := 'ff190117-0000-0000-0000-000000000001';
  active_visible boolean; paused_visible boolean;
begin
  perform pg_temp.impersonate(b1);
  execute 'set local role authenticated';
  -- B1 follows the market; what they can read is still only the public view.
  select exists (select 1 from public.public_listings
                  where market_id = ms and title = 'Follow Figs') into active_visible;
  select exists (select 1 from public.public_listings
                  where market_id = ms and title = 'Hidden Kale') into paused_visible;
  execute 'reset role';

  perform pg_temp.ck('a follower sees the market''s active listing', active_visible);
  perform pg_temp.ck('following does not surface a paused/held listing', not paused_visible);
end $$;

select * from _t order by n;
do $$
declare bad int;
begin
  select count(*) into bad from _t where not ok;
  if bad > 0 then raise exception '% test(s) FAILED', bad; end if;
end $$;
select format('market_following: %s/%s passed', count(*) filter (where ok), count(*)) from _t;
