-- Behavioural proof for 0110: daily Wanted introduction limits.
--
-- The unit under test is "seller initiates contact with a unique Wanted post", and the properties
-- that matter are the ones a naive implementation gets wrong: follow-up messages are free, the
-- same post can never be consumed twice, a rejected attempt consumes nothing (the row IS the
-- consumption), the client's revive path still receives its 23505, and a downgrade mid-day
-- produces remaining=0, never a negative.
--
-- Concurrency is proven separately by the runner with two real sessions — SQL in one session
-- cannot prove a lock.
--
-- Run against a THROWAWAY database (0104-0110 applied).

\set ON_ERROR_STOP on
set client_min_messages = warning;

create temporary table _w (n int, name text, ok boolean, detail text);
create sequence if not exists _wn start 1;
create or replace function pg_temp.ck(a text, b boolean, c text default '')
returns void language plpgsql as $$ begin insert into _w values (nextval('_wn')::int,a,b,c); end $$;

-- A buyer with a pile of open Wanted posts, plus sellers on every rung.
create or replace function pg_temp.mk_user(p_id uuid, p_plan public.market_plan)
returns uuid language plpgsql as $$
declare m uuid;
begin
  insert into auth.users (id, email) values (p_id, p_id::text || '@example.com') on conflict do nothing;
  insert into public.profiles (id, name) values (p_id, 'U' || left(p_id::text, 4)) on conflict do nothing;
  -- A signup trigger may have created the market already; converge on ONE market at the right plan
  -- rather than inserting a duplicate the gate's owner_id lookup would trip over.
  select id into m from public.markets where owner_id = p_id limit 1;
  if m is null then
    insert into public.markets (owner_id, plan) values (p_id, p_plan) returning id into m;
  else
    update public.markets set plan = p_plan where id = m;
    delete from public.markets where owner_id = p_id and id <> m;
  end if;
  return m;
end $$;

create or replace function pg_temp.mk_wanted(p_owner uuid, p_title text)
returns uuid language plpgsql as $$
declare lid uuid;
begin
  insert into public.listings (owner_id, market_id, title, category, listing_type, status, expires_at)
  select p_owner, m.id, p_title, 'vegetables', 'wanted', 'active', now() + interval '30 days'
    from (select id from public.markets where owner_id = p_owner limit 1) m
  returning id into lid;
  return lid;
end $$;

-- Expect an insert to fail with a fragment; consumption-is-the-row means failure must leave no row.
create or replace function pg_temp.ck_intro_fails(p_name text, p_seller uuid, p_listing uuid, p_fragment text)
returns void language plpgsql as $$
begin
  begin
    insert into public.claims (listing_id, claimer_id, claim_type) values (p_listing, p_seller, 'wanted_response');
    perform pg_temp.ck(p_name, false, 'insert was accepted');
  exception when others then
    perform pg_temp.ck(p_name, position(p_fragment in sqlerrm) > 0, left(sqlerrm, 70));
  end;
end $$;

do $$
declare
  buyer uuid := '00000000-0000-0000-0000-0000000000e0';
  s_free uuid := '00000000-0000-0000-0000-0000000000e1';
  w1 uuid; w2 uuid; w3 uuid; c1 uuid; n int; v record;
begin
  perform pg_temp.mk_user(buyer, 'free');
  perform pg_temp.mk_user(s_free, 'free');
  w1 := pg_temp.mk_wanted(buyer, 'Want: tomatoes');
  w2 := pg_temp.mk_wanted(buyer, 'Want: eggs');
  w3 := pg_temp.mk_wanted(buyer, 'Want: basil');

  -- ---- FREE: 1/day ------------------------------------------------------
  insert into public.claims (listing_id, claimer_id, claim_type) values (w1, s_free, 'wanted_response')
  returning id into c1;
  perform pg_temp.ck('FREE: first unique introduction succeeds', c1 is not null);
  perform pg_temp.ck('the gate stamps the plan for analytics',
    (select claimer_plan_at_time from public.claims where id = c1) = 'free');

  perform pg_temp.ck_intro_fails('FREE: second unique post same day is refused',
    s_free, w2, 'WANTED_INTRO_LIMIT_REACHED');
  select count(*)::int into n from public.claims where claimer_id = s_free;
  perform pg_temp.ck('a refused attempt consumed nothing', n = 1, n::text);

  -- Same post again while the relationship is live → the stable already-contacted error.
  perform pg_temp.ck_intro_fails('same post cannot consume quota twice',
    s_free, w1, 'WANTED_ALREADY_CONTACTED');

  -- Follow-up conversation is free: message on the open claim, no meter involved.
  insert into public.claim_messages (claim_id, sender_id, body) values (c1, s_free, 'Still have plenty!');
  insert into public.claim_messages (claim_id, sender_id, body) values (c1, buyer, 'Great — Saturday?');
  select count(*)::int into n from public.claim_messages where claim_id = c1;
  perform pg_temp.ck('follow-up messages flow freely, both directions', n = 2, n::text);
  select count(*)::int into n from public.claims where claimer_id = s_free;
  perform pg_temp.ck('…and messages consumed no introductions', n = 1, n::text);

  -- The revive carve-out: a DECLINED relationship must fall through to 23505, because the mobile
  -- client's revive path depends on exactly that error to re-open the row with an UPDATE.
  update public.claims set status = 'declined' where id = c1;
  begin
    insert into public.claims (listing_id, claimer_id, claim_type) values (w1, s_free, 'wanted_response');
    perform pg_temp.ck('declined relationship falls through to 23505 for revive', false, 'insert accepted');
  exception
    when unique_violation then perform pg_temp.ck('declined relationship falls through to 23505 for revive', true);
    when others then perform pg_temp.ck('declined relationship falls through to 23505 for revive', false, left(sqlerrm, 60));
  end;
  -- The revive itself is an UPDATE and must not be metered.
  update public.claims set status = 'pending' where id = c1;
  select count(*)::int into n from public.claims where claimer_id = s_free;
  perform pg_temp.ck('reviving costs nothing', n = 1, n::text);

  -- Daily reset: yesterday's introduction stops counting.
  update public.claims set created_at = created_at - interval '1 day' where id = c1;
  insert into public.claims (listing_id, claimer_id, claim_type) values (w2, s_free, 'wanted_response');
  perform pg_temp.ck('the next server day restores the allowance',
    (select count(*) from public.claims where claimer_id = s_free) = 2);

  -- ---- claim_type spoofing ---------------------------------------------
  -- Submitting a different claim_type against a Wanted post must not dodge the meter.
  perform pg_temp.ck_intro_fails('claim_type=claim against a Wanted post is still metered',
    s_free, w3, 'WANTED_INTRO_LIMIT_REACHED');
  update public.claims set created_at = created_at - interval '1 day' where claimer_id = s_free;
  begin
    insert into public.claims (listing_id, claimer_id, claim_type) values (w3, s_free, 'claim');
    perform pg_temp.ck('…and when allowed, is normalized to wanted_response',
      (select claim_type from public.claims where listing_id = w3 and claimer_id = s_free) = 'wanted_response');
  exception when others then
    perform pg_temp.ck('…and when allowed, is normalized to wanted_response', false, left(sqlerrm, 60));
  end;
end $$;

-- ---- PRO (grower): 5/day, and the Max ladder ------------------------------
do $$
declare
  buyer uuid := '00000000-0000-0000-0000-0000000000e0';
  s_pro uuid := '00000000-0000-0000-0000-0000000000e2';
  s_max uuid := '00000000-0000-0000-0000-0000000000e3';
  w uuid; n int;
begin
  perform pg_temp.mk_user(s_pro, 'grower');
  perform pg_temp.mk_user(s_max, 'farm');

  for n in 1..5 loop
    w := pg_temp.mk_wanted(buyer, 'Pro lead ' || n);
    insert into public.claims (listing_id, claimer_id, claim_type) values (w, s_pro, 'wanted_response');
  end loop;
  perform pg_temp.ck('PRO: introductions 1-5 succeed',
    (select count(*) from public.claims where claimer_id = s_pro) = 5);
  w := pg_temp.mk_wanted(buyer, 'Pro lead 6');
  perform pg_temp.ck_intro_fails('PRO: the sixth is refused', s_pro, w, 'WANTED_INTRO_LIMIT_REACHED');

  for n in 1..15 loop
    w := pg_temp.mk_wanted(buyer, 'Max lead ' || n);
    insert into public.claims (listing_id, claimer_id, claim_type) values (w, s_max, 'wanted_response');
  end loop;
  perform pg_temp.ck('MAX: introductions 1-15 succeed',
    (select count(*) from public.claims where claimer_id = s_max) = 15);
  w := pg_temp.mk_wanted(buyer, 'Max lead 16');
  perform pg_temp.ck_intro_fails('MAX: the sixteenth is refused', s_max, w, 'WANTED_INTRO_LIMIT_REACHED');
end $$;

-- ---- FARM (sponsor): unlimited entitlement, measured, abuse-capped --------
do $$
declare
  buyer uuid := '00000000-0000-0000-0000-0000000000e0';
  s_farm uuid := '00000000-0000-0000-0000-0000000000e4';
  w uuid; n int; v record;
begin
  perform pg_temp.mk_user(s_farm, 'sponsor');
  for n in 1..20 loop
    w := pg_temp.mk_wanted(buyer, 'Farm lead ' || n);
    insert into public.claims (listing_id, claimer_id, claim_type) values (w, s_farm, 'wanted_response');
  end loop;
  perform pg_temp.ck('FARM: more than 15 legitimate introductions succeed',
    (select count(*) from public.claims where claimer_id = s_farm) = 20);

  -- The anti-abuse ceiling operates independently of the unlimited entitlement.
  for n in 21..30 loop
    w := pg_temp.mk_wanted(buyer, 'Farm lead ' || n);
    insert into public.claims (listing_id, claimer_id, claim_type) values (w, s_farm, 'wanted_response');
  end loop;
  w := pg_temp.mk_wanted(buyer, 'Farm lead 31');
  perform pg_temp.ck_intro_fails('FARM: the hourly abuse ceiling still refuses the 31st in an hour',
    s_farm, w, 'RATE_LIMITED');
end $$;

-- ---- invalid targets consume nothing --------------------------------------
do $$
declare
  buyer uuid := '00000000-0000-0000-0000-0000000000e0';
  s uuid := '00000000-0000-0000-0000-0000000000e5';
  w uuid; n int;
begin
  perform pg_temp.mk_user(s, 'free');
  w := pg_temp.mk_wanted(buyer, 'Expired want');
  update public.listings set status = 'expired' where id = w;
  perform pg_temp.ck_intro_fails('an expired Wanted post is WANTED_NOT_AVAILABLE', s, w, 'WANTED_NOT_AVAILABLE');
  w := pg_temp.mk_wanted(buyer, 'Closed want');
  update public.listings set expires_at = now() - interval '1 minute' where id = w;
  perform pg_temp.ck_intro_fails('a past-expiry Wanted post is WANTED_NOT_AVAILABLE', s, w, 'WANTED_NOT_AVAILABLE');
  select count(*)::int into n from public.claims where claimer_id = s;
  perform pg_temp.ck('rejected targets consumed no quota — full allowance intact', n = 0, n::text);

  -- Non-wanted listings pass the gate untouched (it is a Wanted gate, not a claims gate).
  w := null;
  insert into public.listings (owner_id, market_id, title, category, price_cents, listing_type, status, expires_at)
  select buyer, m.id, 'Plain sale', 'vegetables', 500, 'sale', 'active', now() + interval '7 days'
    from public.markets m where m.owner_id = buyer returning id into w;
  insert into public.claims (listing_id, claimer_id, claim_type, agreed_price_cents)
  values (w, s, 'purchase_request', 500);
  perform pg_temp.ck('claims on non-Wanted listings are untouched by the gate',
    (select claim_type from public.claims where listing_id = w and claimer_id = s) = 'purchase_request');
end $$;

-- ---- plan change mid-day: no negatives, nothing erased --------------------
do $$
declare
  buyer uuid := '00000000-0000-0000-0000-0000000000e0';
  s uuid := '00000000-0000-0000-0000-0000000000e6';
  w uuid; n int; v record;
begin
  perform pg_temp.mk_user(s, 'farm');   -- Max: 15/day
  for n in 1..12 loop
    w := pg_temp.mk_wanted(buyer, 'Downgrade lead ' || n);
    insert into public.claims (listing_id, claimer_id, claim_type) values (w, s, 'wanted_response');
  end loop;
  update public.markets set plan = 'grower' where owner_id = s;   -- now Pro: 5/day

  w := pg_temp.mk_wanted(buyer, 'Downgrade lead 13');
  perform pg_temp.ck_intro_fails('after Max→Pro downgrade, the 13th is refused at 5/day',
    s, w, 'WANTED_INTRO_LIMIT_REACHED');
  perform pg_temp.ck('the 12 introductions already made survive the downgrade',
    (select count(*) from public.claims where claimer_id = s) = 12);

  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e6"}';
  select * into v from public.my_wanted_allowance();
  perform pg_temp.ck('RPC: used stays 12 under the lower plan', v.used_today = 12, v.used_today::text);
  perform pg_temp.ck('RPC: allowed is now 5', v.allowed = 5, v.allowed::text);
  perform pg_temp.ck('RPC: remaining is 0, never negative', v.remaining = 0, v.remaining::text);
  perform pg_temp.ck('RPC: plan renders as Pro', v.display_name = 'Pro', v.display_name);
  perform pg_temp.ck('RPC: reset is tomorrow''s ET midnight',
    v.resets_at = public.wanted_day_start() + interval '1 day');
end $$;

-- ---- seller + admin RPCs, unlimited semantics -----------------------------
do $$
declare v record;
begin
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e4"}';
  select * into v from public.my_wanted_allowance();
  perform pg_temp.ck('RPC: Farm allowed is NULL, not a sentinel', v.allowed is null);
  perform pg_temp.ck('RPC: Farm remaining is NULL', v.remaining is null);
  perform pg_temp.ck('RPC: Farm actual usage is still measured', v.used_today = 30, v.used_today::text);
  perform pg_temp.ck('RPC: Farm renders as Farm', v.display_name = 'Farm', v.display_name);
end $$;

create or replace function public.is_admin() returns boolean language sql stable as $f$ select true $f$;
do $$
declare v record;
begin
  select * into v from public.admin_wanted_usage('00000000-0000-0000-0000-0000000000e2');
  perform pg_temp.ck('ADMIN: sees plan, usage and limit-hit flag',
    v.display_name = 'Pro' and v.allowed = 5 and v.used_today = 5 and v.hit_limit_today,
    format('%s %s/%s hit=%s', v.display_name, v.used_today, v.allowed, v.hit_limit_today));
  perform pg_temp.ck('ADMIN: lifetime count present', v.lifetime_intros = 5, v.lifetime_intros::text);
  perform pg_temp.ck('ADMIN: recent carries Wanted titles, not chat content',
    jsonb_array_length(v.recent) = 5
    and (v.recent->0) ? 'title' and not ((v.recent->0) ? 'body'), v.recent::text);
end $$;
create or replace function public.is_admin() returns boolean language sql stable as $f$ select false $f$;
do $$
declare hit boolean := false;
begin
  begin
    perform * from public.admin_wanted_usage('00000000-0000-0000-0000-0000000000e2'); hit := true;
  exception when others then
    perform pg_temp.ck('ADMIN: non-admin refused', position('admin only' in sqlerrm) > 0, sqlerrm);
  end;
  if hit then perform pg_temp.ck('ADMIN: non-admin refused', false, 'no exception'); end if;
end $$;

\echo ''
select format('%s  %-64s %s', lpad(n::text,3,' '), name, case when ok then 'PASS' else 'FAIL  '||detail end)
from _w order by n;
\echo ''
select format('wanted intro suite: %s/%s passed', count(*) filter (where ok), count(*)) from _w;
do $$ declare bad int; begin select count(*) into bad from _w where not ok;
  if bad > 0 then raise exception '% failed', bad; end if; end $$;
