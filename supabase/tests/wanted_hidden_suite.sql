-- wanted_hidden_suite.sql — regression cover for migration 0127.
--
-- Gnome does not launch with Wanted listings. 0127 removes them from the two
-- public read surfaces and NOTHING else. This suite asserts both directions,
-- because they are symmetric and only one of them is obvious:
--
--   leaking   — a Wanted row reaching public_listings or an inventory count
--   breaking  — someone "finishing the job" by deleting rows, altering the
--               enum, or changing historical records, which is exactly what
--               0127 was written to avoid
--
-- Run inside a transaction and roll back; it seeds and asserts, never commits.

begin;

do $$
declare
  v_owner  uuid := '9f000000-0000-4000-8000-00000000cafe';
  v_market uuid := '9f000000-0000-4000-8000-00000000beef';
  v_public int;
  v_wanted int;
  v_rows   int;
  v_count  int;
  v_defn   text;
begin
  -- ---------------------------------------------------------------- fixtures
  insert into auth.users (id, email) values (v_owner, 'wanted-suite@gnometest.dev')
    on conflict (id) do nothing;
  insert into public.profiles (id) values (v_owner) on conflict (id) do nothing;
  insert into public.markets (id, owner_id, name, slug, status)
    values (v_market, v_owner, 'Wanted Suite Market', 'wanted-suite-market', 'active')
    on conflict (id) do nothing;

  insert into public.listings
    (id, owner_id, market_id, title, category, listing_type, price_cents, trade_for, status, expires_at)
  values
    ('9f000000-0000-4000-8000-000000000001', v_owner, v_market, 'S', 'produce', 'sale',  500,  null,   'active', now() + interval '7 days'),
    ('9f000000-0000-4000-8000-000000000002', v_owner, v_market, 'F', 'produce', 'free',  null, null,   'active', now() + interval '7 days'),
    ('9f000000-0000-4000-8000-000000000003', v_owner, v_market, 'T', 'produce', 'trade', null, 'eggs', 'active', now() + interval '7 days'),
    ('9f000000-0000-4000-8000-000000000004', v_owner, v_market, 'W', 'produce', 'wanted',null, null,   'active', now() + interval '30 days');

  -- ------------------------------------------------- 1-3. launch types visible
  select count(*) into v_public from public.public_listings
   where market_id = v_market and listing_type = 'sale';
  if v_public <> 1 then raise exception 'FAIL: Sell not visible in public_listings (got %)', v_public; end if;

  select count(*) into v_public from public.public_listings
   where market_id = v_market and listing_type = 'free';
  if v_public <> 1 then raise exception 'FAIL: Free not visible in public_listings (got %)', v_public; end if;

  select count(*) into v_public from public.public_listings
   where market_id = v_market and listing_type = 'trade';
  if v_public <> 1 then raise exception 'FAIL: Trade not visible in public_listings (got %)', v_public; end if;

  -- ------------------------------------------------ 4. Wanted NOT public
  select count(*) into v_wanted from public.public_listings
   where market_id = v_market and listing_type = 'wanted';
  if v_wanted <> 0 then raise exception 'FAIL: Wanted leaked into public_listings (got %)', v_wanted; end if;

  -- ------------------------------------- 5. Wanted rows preserved underneath
  select count(*) into v_rows from public.listings
   where market_id = v_market and listing_type = 'wanted';
  if v_rows <> 1 then
    raise exception 'FAIL: Wanted row missing from listings — 0127 must hide, never delete (got %)', v_rows;
  end if;

  -- --------------------------- 9. counts exclude Wanted as available inventory
  select active_listing_count into v_count from public.public_markets where id = v_market;
  if v_count <> 3 then
    raise exception 'FAIL: active_listing_count should be 3 (sale+free+trade), got % — Wanted must not read as inventory', v_count;
  end if;

  -- ------------------------------------ 10. RLS untouched: policies still there
  select count(*) into v_count from pg_policies
   where schemaname = 'public' and tablename = 'listings';
  if v_count = 0 then
    raise exception 'FAIL: listings has no RLS policies — 0127 must not weaken RLS';
  end if;

  -- ------------------------- the enum still carries wanted (nothing was dropped)
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'listing_type' and e.enumlabel = 'wanted'
  ) then
    raise exception 'FAIL: listing_type enum lost its wanted label — 0127 must not alter the enum';
  end if;

  -- ------------- the exclusion lives in the view, not in some client's WHERE
  select pg_get_viewdef('public.public_listings'::regclass) into v_defn;
  if v_defn not like '%wanted%' then
    raise exception 'FAIL: public_listings no longer filters Wanted — 0127 was reverted or overwritten';
  end if;

  raise notice 'wanted_hidden_suite: ALL PASSED';
end $$;

rollback;
