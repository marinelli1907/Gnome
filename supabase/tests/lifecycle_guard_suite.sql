-- Behavioural proof for 0123: the listing lifecycle guard.
--
-- The claims under test (each mapped to a §12-confirmed defect):
--   D1a. A client INSERT cannot buy a lifetime: caller-supplied expires_at is
--        discarded and the canonical stamper decides (sale=7d).
--   D1b. A client UPDATE cannot change expires_at on an active listing.
--   D1c. A relist (expired -> active by direct status write) is restamped
--        server-side; the client-clock value is ignored.
--   D2.  listing_type cannot flip on UPDATE (free -> sale dodge).
--   D3.  A Sell INSERT with market_id NULL is bound to the owner's market so
--        the allowance gate always fires; with no market it is refused.
--   D4.  renew_listing (definer path) still extends lifetimes normally.
--
-- Run against a THROWAWAY database only (run_lifecycle_guard_tests.sh).

\set ON_ERROR_STOP on
set client_min_messages = warning;

create temporary table _t (n int, name text, ok boolean, detail text);
create sequence if not exists _tn start 1;
create or replace function pg_temp.ck(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin insert into _t values (nextval('_tn')::int, p_name, p_ok, p_detail); end $$;

-- ============================================================================
-- Fixtures: seller G on grower (allowance exists but is not the subject here)
-- ============================================================================
do $$
declare
  g uuid := '00000000-0000-0000-0000-00000000123a';
  mg uuid;
begin
  insert into auth.users (id) values (g) on conflict do nothing;
  delete from public.markets where owner_id = g;
  insert into public.markets (owner_id, plan) values (g, 'grower') returning id into mg;
end $$;

-- The guard only constrains client roles; every check below runs as
-- 'authenticated' with the seller's JWT, exactly like a PostgREST write.
grant usage on schema public to authenticated;

do $$
declare
  g uuid := '00000000-0000-0000-0000-00000000123a';
  mg uuid;
  lid uuid;
  exp0 timestamptz; exp1 timestamptz;
  r record;
begin
  select id into mg from public.markets where owner_id = g;
  perform set_config('request.jwt.claims',
    json_build_object('sub', g, 'role', 'authenticated')::text, true);

  -- ------------------------------------------------------------------ D1a
  set local role authenticated;
  insert into public.listings (owner_id, market_id, title, category, listing_type, kind,
                               price_cents, unit, status, expires_at)
  values (g, mg, 'Guard Tomatoes', 'produce', 'sale', 'offer', 500, 'quart', 'active',
          now() + interval '10 years')
  returning id, expires_at into lid, exp0;
  reset role;
  perform pg_temp.ck('D1a: caller-supplied 10-year expiry is discarded (stamped ~7d)',
    exp0 between now() + interval '6 days' and now() + interval '8 days',
    'stamped ' || exp0::text);

  -- ------------------------------------------------------------------ D1b
  set local role authenticated;
  update public.listings set expires_at = now() + interval '10 years' where id = lid;
  reset role;
  select expires_at into exp1 from public.listings where id = lid;
  perform pg_temp.ck('D1b: PATCHing expires_at on an active listing changes nothing',
    exp1 = exp0, 'now ' || exp1::text);

  -- ------------------------------------------------------------------ D2
  set local role authenticated;
  update public.listings set listing_type = 'free' where id = lid;
  reset role;
  perform pg_temp.ck('D2: listing_type cannot flip on UPDATE',
    (select listing_type from public.listings where id = lid) = 'sale');
  -- the fuller tamper (type flip + price wipe) dies on the sale-price check,
  -- because the guard has already pinned the type back to 'sale'
  begin
    set local role authenticated;
    update public.listings set listing_type = 'free', price_cents = null where id = lid;
    reset role;
    perform pg_temp.ck('D2: flip-plus-price-wipe is refused outright', false, 'update unexpectedly succeeded');
  exception when others then
    reset role;
    perform pg_temp.ck('D2: flip-plus-price-wipe is refused outright',
      position('listings_sale_price_chk' in sqlerrm) > 0, left(sqlerrm, 70));
  end;

  -- ------------------------------------------------------------------ D1c
  update public.listings set status = 'expired', expires_at = now() - interval '1 day'
   where id = lid;  -- superuser: simulate natural expiry
  set local role authenticated;
  update public.listings
     set status = 'active', expires_at = now() + interval '9 years'
   where id = lid;  -- the web Relist shape: status + client-clock expiry
  reset role;
  select expires_at into exp1 from public.listings where id = lid;
  perform pg_temp.ck('D1c: relist restamps server-side (~7d), client value ignored',
    exp1 between now() + interval '6 days' and now() + interval '8 days',
    'stamped ' || exp1::text);

  -- ------------------------------------------------------------------ D3
  set local role authenticated;
  insert into public.listings (owner_id, market_id, title, category, listing_type, kind,
                               price_cents, unit, status)
  values (g, null, 'Guard Basil', 'produce', 'sale', 'offer', 300, 'bunch', 'active')
  returning id into lid;
  reset role;
  perform pg_temp.ck('D3: a Sell insert with NULL market is bound to the owner''s market',
    (select market_id from public.listings where id = lid) = mg);
  perform pg_temp.ck('D3: the bound insert consumed the allowance gate (ledger row exists)',
    exists (select 1 from public.listing_publish_events e
             where e.listing_id = lid and e.kind = 'publish'));

  -- ------------------------------------------------------------------ D4
  -- (an active, unexpired listing is answered idempotently by 0112's
  -- already-fresh guard, so age it into a real renewal case first)
  update public.listings set status = 'expired', expires_at = now() - interval '1 hour'
   where id = lid;  -- superuser: simulate expiry
  select * into r from public.renew_listing(lid);
  perform pg_temp.ck('D4: renew_listing (definer path) still extends normally',
    r.expires_at > now() + interval '6 days'
      and (select status from public.listings where id = lid) = 'active',
    'renewed to ' || r.expires_at::text);
end $$;

-- A seller with NO market cannot publish a Sell listing at all (D3 refusal).
do $$
declare
  h uuid := '00000000-0000-0000-0000-00000000123b';
begin
  insert into auth.users (id) values (h) on conflict do nothing;
  delete from public.markets where owner_id = h;
  perform set_config('request.jwt.claims',
    json_build_object('sub', h, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.listings (owner_id, market_id, title, category, listing_type, kind,
                                 price_cents, unit, status)
    values (h, null, 'Orphan Jam', 'pantry', 'sale', 'offer', 700, 'jar', 'active');
    reset role;
    perform pg_temp.ck('D3: marketless Sell insert refused', false, 'insert unexpectedly succeeded');
  exception when others then
    reset role;
    perform pg_temp.ck('D3: marketless Sell insert refused',
      position('NO_MARKET' in sqlerrm) > 0, left(sqlerrm, 60));
  end;
end $$;

-- ============================================================================
select * from _t order by n;
do $$
declare bad int;
begin
  select count(*) into bad from _t where not ok;
  if bad > 0 then raise exception '% test(s) FAILED', bad; end if;
end $$;
select format('lifecycle_guard: %s/%s passed', count(*) filter (where ok), count(*)) from _t;
