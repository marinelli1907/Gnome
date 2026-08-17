-- Behavioural proof for 0125: the active-but-expired renew window.
--
-- The window: expires_at is the truth, but status is swept to 'expired' by the
-- 0018 pg_cron job only every fifteen minutes. In between, a listing reads
-- status='active' AND expires_at < now(). Before 0125, renew_listing's UPDATE
-- in that state was active->active, which enforce_publish_allowance exempts, so
-- the listing gained another seven days having consumed no entitlement and
-- taken no payment — repeatable every seven days, forever, on a schedule the
-- seller can read off the row.
--
-- Every check below is run IN THAT WINDOW (status='active', expires_at in the
-- past) unless it says otherwise. The claims:
--   R1. free (included_renewals_per_period = 0) is REFUSED, not silently
--       extended — the total-bypass case.
--   R2. grower with allowance left consumes exactly one included renewal.
--   R3. grower with allowance spent is REFUSED, extends nothing, logs nothing.
--   R4. grower with allowance spent but holding a PAID authorization renews,
--       consumes that authorization, and records funded='paid' — payment is
--       required in the window, and honoured.
--   R5. sponsor (unlimited) renews and records funded='unlimited'.
--   R6. a complimentary admin_plan_grants row is resolved and metered against
--       the GRANTED plan, not the base plan. This is the case the one-column
--       stub in fourteen runners cannot express, which is why this suite (like
--       payment_hardening_suite) refuses to install it.
--   R7. a genuinely FRESH active listing is still idempotent — 0112's
--       behaviour is preserved, not traded away for the fix.
--   R8. after the sweep (status='expired') metering is unchanged — the fix
--       moved the window case ONTO this path, it did not invent a new one.
--   R9. a REFUSED renewal leaves the row exactly as it was: still active, same
--       expires_at. The demote must never strand a seller's live listing.
--
-- Run against a THROWAWAY database only (run_renew_window_tests.sh).

\set ON_ERROR_STOP on
set client_min_messages = warning;

create temporary table _t (n int, name text, ok boolean, detail text);
create sequence if not exists _tn start 1;
-- coalesce(p_ok, false): an UNKNOWN verdict is a FAILED verdict, same rule as
-- payment_hardening_suite. Several claims below read a column off a row a
-- regression could delete, and NULL must not read as a pass in a suite whose
-- subject is unpaid renewals.
create or replace function pg_temp.ck(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin insert into _t values (nextval('_tn')::int, p_name, coalesce(p_ok, false), p_detail); end $$;

-- ============================================================================
-- Fixture builder. One owner, one market of a known plan, one Sell listing
-- already published (the INSERT at status='active' writes the 'publish' ledger
-- row itself, so every renewal below is metered as a RENEWAL, not a publish).
-- p_comp builds the complimentary case: a FREE base plan carrying an ACTIVE
-- admin_plan_grants row for the higher plan.
-- ============================================================================
create or replace function pg_temp.mk(p_plan public.market_plan, p_tag text, p_comp boolean default false)
returns table(uid uuid, mkt uuid, lst uuid)
language plpgsql as $$
declare u uuid := gen_random_uuid(); m uuid; l uuid; base public.market_plan;
begin
  base := case when p_comp then 'free'::public.market_plan else p_plan end;
  insert into auth.users (id, email, email_confirmed_at) values (u, p_tag||'@renew.test', now());
  perform set_config('request.jwt.claims',
                     json_build_object('sub', u, 'role', 'authenticated')::text, false);
  insert into public.profiles (id, name) values (u, p_tag) on conflict (id) do nothing;
  -- Sign-up may auto-create a market; this suite wants exactly one, of a known plan.
  delete from public.markets where owner_id = u;
  insert into public.markets (id, owner_id, name, plan)
    values (gen_random_uuid(), u, p_tag||' market', base) returning id into m;
  if p_comp then
    insert into public.admin_plan_grants (market_id, user_id, plan, status, reason, starts_at, expires_at)
      values (m, u, p_plan, 'ACTIVE', '0125 suite: complimentary upgrade',
              now() - interval '1 day', now() + interval '30 days');
  end if;
  insert into public.listings (id, owner_id, market_id, title, category, listing_type,
                               status, expires_at, price_cents)
    values (gen_random_uuid(), u, m, p_tag||' tomatoes', 'produce', 'sale',
            'active', now() + interval '7 days', 500)
    returning id into l;
  -- The publish happened a week ago, which is why the listing is now due. Said
  -- explicitly because now() is TRANSACTION time: left at its default, this
  -- event would carry the same occurred_at as the renewal event written later
  -- in the same transaction, and renew_listing's "most recent event" lookup
  -- would report an arbitrary one of the two.
  update public.listing_publish_events set occurred_at = now() - interval '7 days'
   where listing_id = l;
  uid := u; mkt := m; lst := l; return next;
end $$;

-- Burn every included renewal for the market's current period.
-- occurred_at is backdated one hour per burn, for two reasons: it is what a
-- spent allowance actually looks like (renewals happen days apart, not at once),
-- and now() is TRANSACTION time — leaving the default would tie every planted
-- row with the real event the renewal under test writes, making renew_listing's
-- "most recent event" lookup pick an arbitrary one of them.
create or replace function pg_temp.exhaust(p_mkt uuid, p_lst uuid)
returns void language plpgsql as $$
declare inc int; i int; ep record;
begin
  select ep2.plan into ep from public.market_effective_plan(p_mkt) ep2;
  select coalesce(pl.included_renewals_per_period, 0) into inc
    from public.plan_limits pl where pl.plan = ep.plan;
  for i in 1..inc loop
    insert into public.listing_publish_events
      (market_id, listing_id, kind, funded, period_start, period_source, plan_at_time, occurred_at)
    select p_mkt, p_lst, 'renewal', 'included', per.period_start, per.source, ep.plan,
           now() - make_interval(hours => i)
      from public.market_allowance_period(p_mkt) per;
  end loop;
end $$;

-- Put the listing INTO the window: past its expiry, status not yet swept.
create or replace function pg_temp.age(p_lst uuid, p_status public.listing_status default 'active')
returns void language plpgsql as $$
begin
  update public.listings set status = p_status, expires_at = now() - interval '1 minute'
   where id = p_lst;
end $$;

-- Call renew_listing the way a seller does, and report what happened.
create or replace function pg_temp.renew(p_uid uuid, p_lst uuid)
returns table(outcome text, funded text, extended boolean, still_active boolean, expiry timestamptz)
language plpgsql as $$
declare res record;
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  begin
    select * into res from public.renew_listing(p_lst);
    outcome := 'ok'; funded := res.funded;
  exception when others then
    outcome := left(sqlerrm, 60); funded := null;
  end;
  select l.expires_at, l.status = 'active' into expiry, still_active
    from public.listings l where l.id = p_lst;
  extended := expiry > now() + interval '6 days';
  return next;
end $$;

-- Count the ledger rows a renewal is supposed to write.
create or replace function pg_temp.evs(p_mkt uuid, p_funded text default null)
returns int language sql stable as $$
  select count(*)::int from public.listing_publish_events
   where market_id = p_mkt and kind = 'renewal'
     and (p_funded is null or funded = p_funded)
$$;

-- ============================================================================
do $$
declare
  f record; r record; before int; auth_id uuid; xb timestamptz;
begin
  -- ------------------------------------------------------------------- R1
  -- free carries included_renewals_per_period = 0: there is no free renewal to
  -- give, so the window must refuse exactly as the post-sweep path does.
  select * into f from pg_temp.mk('free', 'R1-free');
  perform pg_temp.age(f.lst);
  before := pg_temp.evs(f.mkt);
  select * into r from pg_temp.renew(f.uid, f.lst);
  perform pg_temp.ck('R1a: free, in-window, is REFUSED (no unmetered renewal)',
    r.outcome like '%PUBLISH_ALLOWANCE_EXHAUSTED%', format('outcome=%s', r.outcome));
  perform pg_temp.ck('R1b: free, in-window, gained no time',
    not r.extended, format('expiry=%s', r.expiry));
  perform pg_temp.ck('R1c: free, in-window, wrote no renewal ledger row',
    pg_temp.evs(f.mkt) = before, format('before=%s after=%s', before, pg_temp.evs(f.mkt)));

  -- ------------------------------------------------------------------- R2
  select * into f from pg_temp.mk('grower', 'R2-grower');
  perform pg_temp.age(f.lst);
  before := pg_temp.evs(f.mkt, 'included');
  select * into r from pg_temp.renew(f.uid, f.lst);
  perform pg_temp.ck('R2a: grower with allowance left renews in-window',
    r.outcome = 'ok' and r.extended, format('outcome=%s extended=%s', r.outcome, r.extended));
  perform pg_temp.ck('R2b: grower spends exactly ONE included renewal',
    pg_temp.evs(f.mkt, 'included') = before + 1,
    format('before=%s after=%s', before, pg_temp.evs(f.mkt, 'included')));
  perform pg_temp.ck('R2c: and reports funded=included',
    r.funded = 'included', format('funded=%s', r.funded));

  -- ------------------------------------------------------------------- R3
  select * into f from pg_temp.mk('grower', 'R3-grower-spent');
  perform pg_temp.exhaust(f.mkt, f.lst);
  perform pg_temp.age(f.lst);
  before := pg_temp.evs(f.mkt);
  select * into r from pg_temp.renew(f.uid, f.lst);
  perform pg_temp.ck('R3a: grower with allowance SPENT is refused in-window',
    r.outcome like '%PUBLISH_ALLOWANCE_EXHAUSTED%', format('outcome=%s', r.outcome));
  perform pg_temp.ck('R3b: and gains no time',
    not r.extended, format('expiry=%s', r.expiry));
  perform pg_temp.ck('R3c: and writes no further ledger row',
    pg_temp.evs(f.mkt) = before, format('before=%s after=%s', before, pg_temp.evs(f.mkt)));

  -- ------------------------------------------------------------------- R4
  -- Payment is the way through the window, and it must actually be consumed.
  select * into f from pg_temp.mk('grower', 'R4-grower-paid');
  perform pg_temp.exhaust(f.mkt, f.lst);
  perform pg_temp.age(f.lst);
  insert into public.listing_publish_authorizations
    (market_id, listing_id, intent, amount_cents, status, stripe_session_id, stripe_livemode, paid_at)
  values (f.mkt, f.lst, 'renewal', 99, 'paid', 'sess_0125_renew_window', false, now())
  returning id into auth_id;
  select * into r from pg_temp.renew(f.uid, f.lst);
  perform pg_temp.ck('R4a: a PAID authorization renews in-window',
    r.outcome = 'ok' and r.extended, format('outcome=%s extended=%s', r.outcome, r.extended));
  perform pg_temp.ck('R4b: the authorization is CONSUMED, not left payable',
    (select status from public.listing_publish_authorizations where id = auth_id) = 'consumed',
    format('status=%s', (select status from public.listing_publish_authorizations where id = auth_id)));
  perform pg_temp.ck('R4c: and the ledger records funded=paid',
    pg_temp.evs(f.mkt, 'paid') = 1 and r.funded = 'paid',
    format('paid_events=%s funded=%s', pg_temp.evs(f.mkt, 'paid'), r.funded));

  -- ------------------------------------------------------------------- R5
  select * into f from pg_temp.mk('sponsor', 'R5-sponsor');
  perform pg_temp.age(f.lst);
  select * into r from pg_temp.renew(f.uid, f.lst);
  perform pg_temp.ck('R5a: sponsor (unlimited) renews in-window',
    r.outcome = 'ok' and r.extended, format('outcome=%s extended=%s', r.outcome, r.extended));
  perform pg_temp.ck('R5b: and is recorded as funded=unlimited',
    pg_temp.evs(f.mkt, 'unlimited') = 1 and r.funded = 'unlimited',
    format('unlimited_events=%s funded=%s', pg_temp.evs(f.mkt, 'unlimited'), r.funded));

  -- ------------------------------------------------------------------- R6
  -- Base free + ACTIVE farm grant: the renewal must be metered against FARM.
  -- Under the naive stub this market reads 'free' and R6 would refuse.
  select * into f from pg_temp.mk('farm', 'R6-complimentary', true);
  perform pg_temp.age(f.lst);
  select * into r from pg_temp.renew(f.uid, f.lst);
  perform pg_temp.ck('R6a: the complimentary grant resolves to the GRANTED plan',
    (select ep.plan::text || '/' || ep.source from public.market_effective_plan(f.mkt) ep)
      = 'farm/complimentary',
    (select ep.plan::text || '/' || ep.source from public.market_effective_plan(f.mkt) ep));
  perform pg_temp.ck('R6b: and the in-window renewal is metered against it',
    r.outcome = 'ok' and r.extended and pg_temp.evs(f.mkt, 'included') = 1,
    format('outcome=%s included=%s', r.outcome, pg_temp.evs(f.mkt, 'included')));

  -- ------------------------------------------------------------------- R7
  -- 0112's idempotent branch must survive the fix untouched.
  select * into f from pg_temp.mk('grower', 'R7-fresh');
  xb := (select l.expires_at from public.listings l where l.id = f.lst);
  before := pg_temp.evs(f.mkt);
  select * into r from pg_temp.renew(f.uid, f.lst);
  perform pg_temp.ck('R7a: a FRESH active listing still answers idempotently',
    r.outcome = 'ok', format('outcome=%s', r.outcome));
  perform pg_temp.ck('R7b: its expiry is not moved',
    (select l.expires_at from public.listings l where l.id = f.lst) = xb,
    format('before=%s after=%s', xb, (select l.expires_at from public.listings l where l.id = f.lst)));
  perform pg_temp.ck('R7c: and nothing is consumed',
    pg_temp.evs(f.mkt) = before, format('before=%s after=%s', before, pg_temp.evs(f.mkt)));

  -- ------------------------------------------------------------------- R8
  -- The post-sweep path is the behaviour the window case is now folded into.
  select * into f from pg_temp.mk('grower', 'R8-swept');
  perform pg_temp.age(f.lst, 'expired');
  before := pg_temp.evs(f.mkt, 'included');
  select * into r from pg_temp.renew(f.uid, f.lst);
  perform pg_temp.ck('R8a: after the sweep, metering is unchanged',
    r.outcome = 'ok' and r.extended and pg_temp.evs(f.mkt, 'included') = before + 1,
    format('outcome=%s included=%s', r.outcome, pg_temp.evs(f.mkt, 'included')));

  -- ------------------------------------------------------------------- R9
  -- The demote must not strand a live listing when the renewal is refused.
  select * into f from pg_temp.mk('free', 'R9-untouched');
  perform pg_temp.age(f.lst);
  xb := (select l.expires_at from public.listings l where l.id = f.lst);
  select * into r from pg_temp.renew(f.uid, f.lst);
  perform pg_temp.ck('R9a: a refused renewal leaves the listing ACTIVE',
    r.still_active, format('still_active=%s', r.still_active));
  perform pg_temp.ck('R9b: and leaves its expires_at untouched',
    r.expiry = xb, format('before=%s after=%s', xb, r.expiry));

  -- ------------------------------------------------------------------- R10
  -- The suite drives renew_listing under superuser (sound for METERING, since
  -- the function is SECURITY DEFINER and reads identity from the JWT claims) —
  -- which means R1-R9 would keep passing even if 0125's grant restatement
  -- regressed and sellers lost the ability to call it at all. So the exposure
  -- is asserted from the catalogs, the way payment_hardening C8 does.
  perform pg_temp.ck('R10a: authenticated holds EXECUTE on renew_listing',
    has_function_privilege('authenticated', 'public.renew_listing(uuid)', 'execute'));
  perform pg_temp.ck('R10b: anon does NOT',
    not has_function_privilege('anon', 'public.renew_listing(uuid)', 'execute'));
end $$;

-- ============================================================================
select * from _t order by n;
do $$
declare bad int;
begin
  select count(*) into bad from _t where not ok;
  if bad > 0 then raise exception '% test(s) FAILED', bad; end if;
end $$;
select format('renew_window: %s/%s passed', count(*) filter (where ok), count(*)) from _t;
