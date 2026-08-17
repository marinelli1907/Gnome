-- Behavioural proof for 0124: §13 payment hardening.
--
-- The claims under test (each mapped to a numbered section of the migration):
--   C1. §1 The RECOVERED resolver answers a plain market: exactly one row of
--       four columns, source='free' for a free market and 'stripe' for a paid
--       base plan.
--   C2. §1 A complimentary admin_plan_grants row of a HIGHER plan wins, and is
--       reported as source='complimentary' with the grant's id and expiry.
--       This is the behaviour the one-column stub in fourteen other runners
--       could never express — the reason 0124 recovers the real function.
--   C3. §1 An EXPIRED or non-ACTIVE grant does not win; the base plan stands.
--   C4. §2 stripe_livemode exists on listing_publish_authorizations, is NOT
--       NULL, defaults false, and no row is left NULL.
--   C5. §2 The mode guard refuses to CONSUME an authorization minted in the
--       other Stripe mode — in both directions — and lets the matching mode
--       through. Money already banked is untouched either way.
--   C6. §3 The stale sweep expires OLD pending rows, leaves RECENT pending rows
--       alone, and never rewrites paid/consumed/refunded financial truth.
--   C7. §4 The canonical SKUs are seeded with amounts and currency only, their
--       Stripe ids stay NULL (runtime config, never schema), and re-running the
--       seed produces zero duplicates.
--   C8. §5 anon and authenticated hold no write privilege on billing_products —
--       at table OR column level — but keep SELECT; and listing_overage_required
--       is no longer client-executable.
--   C9. §6 A listing naming a market the owner does not own is refused
--       (FOREIGN_MARKET); the same insert into their own market still works.
--
-- Run against a THROWAWAY database only (run_payment_hardening_tests.sh).

\set ON_ERROR_STOP on
set client_min_messages = warning;

create temporary table _t (n int, name text, ok boolean, detail text);
create sequence if not exists _tn start 1;
-- coalesce(p_ok, false): an UNKNOWN verdict is a FAILED verdict here. Several
-- claims below compare the status of a row that a regression could delete
-- outright, and `(select status ...) = 'expired'` is NULL, not false, once the
-- row is gone — which `count(*) where not ok` would then skip. In a suite whose
-- subject is financial audit truth, "the evidence vanished" must not read as a
-- pass. (Verified: mutating expire_stale_publish_authorizations into a DELETE
-- makes C6a/C6b NULL, and they are counted as failures because of this.)
create or replace function pg_temp.ck(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin insert into _t values (nextval('_tn')::int, p_name, coalesce(p_ok, false), p_detail); end $$;

-- ============================================================================
-- Fixtures
--   A: seller on a PAID base plan, owns market MA (the FOREIGN_MARKET attacker)
--   B: seller on the FREE plan, owns market MB (the foreign market A aims at)
--   C: seller on a PAID base plan, owns market MC — carries the admin grants
--      AND every payment authorization, so the money fixtures can never
--      perturb the publish that C9 has to see succeed on MA.
-- Sign-up auto-creates a market, so each owner's markets are cleared first and
-- replaced with exactly one of a known plan.
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000124aa';
  b uuid := '00000000-0000-0000-0000-0000000124bb';
  c uuid := '00000000-0000-0000-0000-0000000124cc';
begin
  insert into auth.users (id) values (a), (b), (c) on conflict do nothing;
  delete from public.markets where owner_id in (a, b, c);
  insert into public.markets (owner_id, plan) values (a, 'grower');
  insert into public.markets (owner_id, plan) values (b, 'free');
  insert into public.markets (owner_id, plan) values (c, 'grower');
end $$;

-- ============================================================================
-- C1 / C2 / C3 — the recovered plan resolver
-- ============================================================================
do $$
declare
  b uuid := '00000000-0000-0000-0000-0000000124bb';
  c uuid := '00000000-0000-0000-0000-0000000124cc';
  a uuid := '00000000-0000-0000-0000-0000000124aa';
  ma uuid; mb uuid; mc uuid;
  r record;
  n int;
  gid uuid;
  gexp timestamptz := now() + interval '30 days';
begin
  select id into ma from public.markets where owner_id = a;
  select id into mb from public.markets where owner_id = b;
  select id into mc from public.markets where owner_id = c;

  -- ------------------------------------------------------------------- C1a
  select count(*) into n from public.market_effective_plan(mb);
  select * into r from public.market_effective_plan(mb);
  perform pg_temp.ck('C1a: a free market resolves to exactly one row, plan=free source=free, no grant',
    n = 1 and r.plan = 'free' and r.source = 'free'
      and r.grant_id is null and r.grant_expires is null,
    format('rows=%s plan=%s source=%s grant=%s', n, r.plan, r.source, r.grant_id));

  -- ------------------------------------------------------------------- C1b
  select count(*) into n from public.market_effective_plan(ma);
  select * into r from public.market_effective_plan(ma);
  perform pg_temp.ck('C1b: a paid BASE plan resolves to itself and reports source=stripe',
    n = 1 and r.plan = 'grower' and r.source = 'stripe' and r.grant_id is null,
    format('rows=%s plan=%s source=%s', n, r.plan, r.source));

  -- ------------------------------------------------------------------- C1c
  -- The shape itself is load-bearing: the one-column stub the other runners
  -- install has no source/grant_id/grant_expires to report at all.
  perform pg_temp.ck('C1c: the resolver returns four columns (plan, source, grant_id, grant_expires)',
    pg_get_function_result('public.market_effective_plan(uuid)'::regprocedure)
      = 'TABLE(plan market_plan, source text, grant_id uuid, grant_expires timestamp with time zone)',
    pg_get_function_result('public.market_effective_plan(uuid)'::regprocedure));

  -- ------------------------------------------------------------------- C2
  -- ACTIVE, started, unexpired, HIGHER than the base plan: it must win.
  insert into public.admin_plan_grants (market_id, user_id, plan, expires_at, reason)
  values (mc, c, 'farm', gexp, '0124 suite: complimentary upgrade')
  returning id into gid;

  select count(*) into n from public.market_effective_plan(mc);
  select * into r from public.market_effective_plan(mc);
  perform pg_temp.ck('C2: an ACTIVE unexpired HIGHER grant beats the base plan and reports source=complimentary',
    n = 1 and r.plan = 'farm' and r.source = 'complimentary'
      and r.grant_id = gid and r.grant_expires = gexp,
    format('plan=%s source=%s grant_id=%s expires=%s', r.plan, r.source, r.grant_id, r.grant_expires));

  -- ------------------------------------------------------------------- C2b
  -- A grant BELOW the base plan must never demote a market someone paid for.
  update public.admin_plan_grants set plan = 'free' where id = gid;
  select * into r from public.market_effective_plan(mc);
  perform pg_temp.ck('C2b: a LOWER grant never demotes the paid base plan',
    r.plan = 'grower' and r.source = 'stripe' and r.grant_id is null,
    format('plan=%s source=%s', r.plan, r.source));

  -- ------------------------------------------------------------------- C3a
  update public.admin_plan_grants
     set plan = 'farm', expires_at = now() - interval '1 day' where id = gid;
  select * into r from public.market_effective_plan(mc);
  perform pg_temp.ck('C3a: an EXPIRED grant does not win (base plan returned, no grant reported)',
    r.plan = 'grower' and r.source = 'stripe'
      and r.grant_id is null and r.grant_expires is null,
    format('plan=%s source=%s grant=%s', r.plan, r.source, r.grant_id));

  -- ------------------------------------------------------------------- C3b
  update public.admin_plan_grants
     set expires_at = null, status = 'REVOKED', revoked_at = now() where id = gid;
  select * into r from public.market_effective_plan(mc);
  perform pg_temp.ck('C3b: a non-ACTIVE (revoked) grant does not win, even unexpired',
    r.plan = 'grower' and r.source = 'stripe' and r.grant_id is null,
    format('plan=%s source=%s', r.plan, r.source));
end $$;

-- ============================================================================
-- C4 / C5 — stripe_livemode truth and the authorization mode guard
--
-- The rows are set up directly as superuser: the subject is the trigger, not
-- the checkout flow that would normally mint them.
-- ============================================================================
create temporary table _bc as select payments_live_enabled from public.billing_config limit 1;

do $$
declare
  c uuid := '00000000-0000-0000-0000-0000000124cc';
  mc uuid;
  v_default text; v_nullable text;
  n int;
  livemode_of_defaulted_row boolean;
begin
  select id into mc from public.markets where owner_id = c;

  -- ------------------------------------------------------------------- C4a
  select column_default, is_nullable into v_default, v_nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'listing_publish_authorizations'
     and column_name = 'stripe_livemode';
  perform pg_temp.ck('C4a: stripe_livemode exists on listing_publish_authorizations, NOT NULL, default false',
    v_nullable = 'NO' and v_default = 'false',
    format('default=%s nullable=%s', coalesce(v_default, '<none>'), coalesce(v_nullable, '<absent>')));

  -- A row that never names the column must land false, not NULL.
  insert into public.listing_publish_authorizations
    (market_id, intent, amount_cents, status, stripe_session_id)
  values (mc, 'publish', 99, 'pending', 'sess_0124_default')
  returning stripe_livemode into livemode_of_defaulted_row;

  select count(*) into n from public.listing_publish_authorizations where stripe_livemode is null;
  perform pg_temp.ck('C4b: no authorization row is left NULL; an unstamped insert defaults to false',
    n = 0 and livemode_of_defaulted_row = false,
    format('null rows=%s defaulted=%s', n, livemode_of_defaulted_row));

  -- ---------------------------------------------------------------- C5 setup
  -- The platform gate is off (production's standing state, and 0124's own
  -- self-check asserts it).
  update public.billing_config set payments_live_enabled = false;

  insert into public.listing_publish_authorizations
    (market_id, intent, amount_cents, status, stripe_livemode, stripe_session_id, paid_at)
  values (mc, 'publish', 99, 'paid', false, 'sess_0124_test_match',  now()),
         (mc, 'publish', 99, 'paid', true,  'sess_0124_live_stray',  now()),
         (mc, 'publish', 99, 'paid', true,  'sess_0124_live_match',  now()),
         (mc, 'publish', 99, 'paid', false, 'sess_0124_test_stray',  now());

  -- ------------------------------------------------------------------- C5a
  update public.listing_publish_authorizations
     set status = 'consumed', consumed_at = now()
   where stripe_session_id = 'sess_0124_test_match';
  perform pg_temp.ck('C5a: gate OFF — a test-mode authorization CONSUMES normally',
    (select status from public.listing_publish_authorizations
      where stripe_session_id = 'sess_0124_test_match') = 'consumed');

  -- ------------------------------------------------------------------- C5b
  begin
    update public.listing_publish_authorizations
       set status = 'consumed', consumed_at = now()
     where stripe_session_id = 'sess_0124_live_stray';
    perform pg_temp.ck('C5b: gate OFF — consuming a LIVE-mode authorization raises AUTHORIZATION_MODE_MISMATCH',
      false, 'update unexpectedly succeeded');
  exception when others then
    perform pg_temp.ck('C5b: gate OFF — consuming a LIVE-mode authorization raises AUTHORIZATION_MODE_MISMATCH',
      position('AUTHORIZATION_MODE_MISMATCH' in sqlerrm) > 0, left(sqlerrm, 60));
  end;
  perform pg_temp.ck('C5b: the refused authorization is left exactly as it was (still paid)',
    (select status from public.listing_publish_authorizations
      where stripe_session_id = 'sess_0124_live_stray') = 'paid');

  -- ------------------------------------------------------------------- C5c
  -- The mirror image: with the gate ON, live matches and test is refused. The
  -- guard is symmetric, so a test payment can never fund a live action either.
  update public.billing_config set payments_live_enabled = true;

  update public.listing_publish_authorizations
     set status = 'consumed', consumed_at = now()
   where stripe_session_id = 'sess_0124_live_match';
  perform pg_temp.ck('C5c: gate ON — a live-mode authorization CONSUMES normally',
    (select status from public.listing_publish_authorizations
      where stripe_session_id = 'sess_0124_live_match') = 'consumed');

  begin
    update public.listing_publish_authorizations
       set status = 'consumed', consumed_at = now()
     where stripe_session_id = 'sess_0124_test_stray';
    perform pg_temp.ck('C5c: gate ON — consuming a TEST-mode authorization raises AUTHORIZATION_MODE_MISMATCH',
      false, 'update unexpectedly succeeded');
  exception when others then
    perform pg_temp.ck('C5c: gate ON — consuming a TEST-mode authorization raises AUTHORIZATION_MODE_MISMATCH',
      position('AUTHORIZATION_MODE_MISMATCH' in sqlerrm) > 0, left(sqlerrm, 60));
  end;

  -- ------------------------------------------------------------- C5 teardown
  update public.billing_config
     set payments_live_enabled = (select payments_live_enabled from _bc);
end $$;

do $$
declare cur boolean; orig boolean;
begin
  select payments_live_enabled into cur  from public.billing_config limit 1;
  select payments_live_enabled into orig from _bc;
  perform pg_temp.ck('C5d: billing_config.payments_live_enabled is restored to its pre-test value (false)',
    cur is not distinct from orig and cur = false,
    format('now=%s original=%s', cur, orig));
end $$;

-- ============================================================================
-- C6 — stale pending reconciliation, financial truth preserved
-- ============================================================================
do $$
declare
  c uuid := '00000000-0000-0000-0000-0000000124cc';
  mc uuid;
  expected int;
  swept int;
  events_before int;
  events_after int;
  survivors int;
begin
  select id into mc from public.markets where owner_id = c;

  insert into public.listing_publish_authorizations
    (market_id, intent, amount_cents, status, created_at, stripe_session_id, stripe_livemode)
  values
    (mc, 'publish', 99, 'pending',  now() - interval '48 hours', 'sess_0124_stale_pending',  false),
    (mc, 'publish', 99, 'pending',  now() - interval '1 hour',   'sess_0124_fresh_pending',  false),
    (mc, 'publish', 99, 'paid',     now() - interval '90 days',  'sess_0124_old_paid',       false),
    (mc, 'publish', 99, 'consumed', now() - interval '90 days',  'sess_0124_old_consumed',   false),
    (mc, 'renewal', 99, 'refunded', now() - interval '90 days',  'sess_0124_old_refunded',   false);

  -- Count what the sweep is entitled to touch, so the return value is asserted
  -- exactly rather than "at least one".
  select count(*) into expected
    from public.listing_publish_authorizations
   where status = 'pending' and created_at < now() - interval '24 hours';
  select count(*) into events_before
    from public.events where event_type = 'publish_authorizations_expired';

  select public.expire_stale_publish_authorizations() into swept;

  select count(*) into events_after
    from public.events where event_type = 'publish_authorizations_expired';

  perform pg_temp.ck('C6a: an OLD pending authorization is swept to expired',
    (select status from public.listing_publish_authorizations
      where stripe_session_id = 'sess_0124_stale_pending') = 'expired');

  perform pg_temp.ck('C6b: a RECENT pending authorization is left pending',
    (select status from public.listing_publish_authorizations
      where stripe_session_id = 'sess_0124_fresh_pending') = 'pending');

  -- Financial audit truth: never rewritten, never deleted. Asserted per status.
  perform pg_temp.ck('C6c: an old PAID row is untouched',
    (select status from public.listing_publish_authorizations
      where stripe_session_id = 'sess_0124_old_paid') = 'paid');
  perform pg_temp.ck('C6c: an old CONSUMED row is untouched',
    (select status from public.listing_publish_authorizations
      where stripe_session_id = 'sess_0124_old_consumed') = 'consumed');
  perform pg_temp.ck('C6c: an old REFUNDED row is untouched',
    (select status from public.listing_publish_authorizations
      where stripe_session_id = 'sess_0124_old_refunded') = 'refunded');
  select count(*) into survivors
    from public.listing_publish_authorizations
   where stripe_session_id in ('sess_0124_stale_pending','sess_0124_fresh_pending',
                               'sess_0124_old_paid','sess_0124_old_consumed',
                               'sess_0124_old_refunded');
  perform pg_temp.ck('C6c: nothing was DELETED — all five reconciliation fixtures survive the sweep',
    survivors = 5, format('%s of 5 rows', survivors));

  perform pg_temp.ck('C6d: the sweep returns exactly the number of stale rows it expired',
    swept = expected, format('returned=%s expected=%s', swept, expected));

  perform pg_temp.ck('C6e: the sweep records one bounded audit event',
    events_after = events_before + 1,
    format('events %s -> %s', events_before, events_after));
end $$;

-- ============================================================================
-- C7 — canonical product seeding, idempotent and id-free
-- ============================================================================
do $$
declare
  n_before int;
  n_after int;
  ok_amounts boolean;
  ok_ids boolean;
begin
  select count(*) into n_before from public.billing_products
   where key in ('GNOME_LISTING_PUBLISH','GNOME_LISTING_RENEWAL','GNOME_SPONSOR_MONTHLY');

  select bool_and(agrees) into ok_amounts from (
    select (p.unit_amount_cents = e.cents and p.currency = 'usd' and p.active) as agrees
      from (values ('GNOME_LISTING_PUBLISH', 99),
                   ('GNOME_LISTING_RENEWAL', 99),
                   ('GNOME_SPONSOR_MONTHLY', 9900)) as e(key, cents)
      join public.billing_products p on p.key = e.key
  ) s;
  perform pg_temp.ck('C7a: the three canonical keys exist at 99 / 99 / 9900 cents, currency usd, active',
    n_before = 3 and coalesce(ok_amounts, false),
    format('keys=%s amounts_ok=%s', n_before, ok_amounts));

  -- Stripe ids are per-environment RUNTIME config: a migration that shipped one
  -- would pin every rebuilt environment to another environment's Stripe account.
  select bool_and(stripe_product_id is null and stripe_price_id is null
                  and stripe_product_id_test is null and stripe_price_id_test is null
                  and stripe_product_id_live is null and stripe_price_id_live is null)
    into ok_ids
    from public.billing_products
   where key in ('GNOME_LISTING_PUBLISH','GNOME_LISTING_RENEWAL','GNOME_SPONSOR_MONTHLY');
  perform pg_temp.ck('C7b: every Stripe product/price id on the seeded rows is NULL (runtime config, never schema)',
    coalesce(ok_ids, false));

  -- Rerun the setup, prove 0 duplicates: 0124's seed INSERT verbatim.
  insert into public.billing_products (key, kind, description, unit_amount_cents, currency, active) values
    ('GNOME_LISTING_PUBLISH', 'one_time',
     'Publish one additional listing beyond the monthly allowance', 99, 'usd', true),
    ('GNOME_LISTING_RENEWAL', 'one_time',
     'Renew one expired listing for a further 7 days', 99, 'usd', true),
    ('GNOME_SPONSOR_MONTHLY', 'subscription',
     'Farm plan (internal enum sponsor), monthly', 9900, 'usd', true)
  on conflict (key) do nothing;

  select count(*) into n_after from public.billing_products
   where key in ('GNOME_LISTING_PUBLISH','GNOME_LISTING_RENEWAL','GNOME_SPONSOR_MONTHLY');
  perform pg_temp.ck('C7c: re-applying 0124''s seed INSERT produces 0 duplicates (rerun-safe)',
    n_after = n_before and n_after = 3,
    format('before=%s after=%s', n_before, n_after));
end $$;

-- ============================================================================
-- C8 — grant hardening
-- ============================================================================
do $$
declare
  col_writes int;
  col_selects int;
begin
  -- A table-level revoke of a privilege does not necessarily clear per-column
  -- entries, and production granted these per column. information_schema is the
  -- only place that difference is visible.
  select count(*) into col_writes
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'billing_products'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  perform pg_temp.ck('C8a: no INSERT/UPDATE/DELETE COLUMN-privilege on billing_products survives for anon/authenticated',
    col_writes = 0, format('%s column write grants remain', col_writes));

  select count(*) into col_selects
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'billing_products'
     and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT';
  perform pg_temp.ck('C8b: has_table_privilege agrees — no client write, and SELECT is retained',
    not has_table_privilege('anon', 'public.billing_products', 'insert')
    and not has_table_privilege('anon', 'public.billing_products', 'update')
    and not has_table_privilege('anon', 'public.billing_products', 'delete')
    and not has_table_privilege('authenticated', 'public.billing_products', 'insert')
    and not has_table_privilege('authenticated', 'public.billing_products', 'update')
    and not has_table_privilege('authenticated', 'public.billing_products', 'delete')
    and has_table_privilege('anon', 'public.billing_products', 'select')
    and has_table_privilege('authenticated', 'public.billing_products', 'select')
    and col_selects > 0,
    format('select column grants kept=%s', col_selects));

  -- The IDOR: any signed-in user could read any market's allowance posture.
  perform pg_temp.ck('C8c: authenticated cannot EXECUTE listing_overage_required(uuid, uuid)',
    not has_function_privilege('authenticated', 'public.listing_overage_required(uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.listing_overage_required(uuid, uuid)', 'execute'));
end $$;

-- ============================================================================
-- C9 — 0123 follow-up: a SUPPLIED market must belong to the owner
--
-- Runs as 'authenticated' with seller A's JWT, exactly like a PostgREST write.
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000124aa';
  b uuid := '00000000-0000-0000-0000-0000000124bb';
  ma uuid; mb uuid;
  lid uuid;
begin
  select id into ma from public.markets where owner_id = a;
  select id into mb from public.markets where owner_id = b;
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role', 'authenticated')::text, true);

  -- ------------------------------------------------------------------- C9a
  begin
    set local role authenticated;
    insert into public.listings (owner_id, market_id, title, category, listing_type, kind,
                                 price_cents, unit, status)
    values (a, mb, 'Crafted Squash', 'produce', 'sale', 'offer', 400, 'each', 'active');
    reset role;
    perform pg_temp.ck('C9a: a Sell insert naming a FOREIGN market is refused (FOREIGN_MARKET)',
      false, 'insert unexpectedly succeeded');
  exception when others then
    reset role;
    perform pg_temp.ck('C9a: a Sell insert naming a FOREIGN market is refused (FOREIGN_MARKET)',
      position('FOREIGN_MARKET' in sqlerrm) > 0, left(sqlerrm, 60));
  end;
  perform pg_temp.ck('C9a: nothing was billed to the foreign market (no ledger row appeared)',
    not exists (select 1 from public.listing_publish_events where market_id = mb));

  -- ------------------------------------------------------------------- C9b
  set local role authenticated;
  insert into public.listings (owner_id, market_id, title, category, listing_type, kind,
                               price_cents, unit, status)
  values (a, ma, 'Honest Squash', 'produce', 'sale', 'offer', 400, 'each', 'active')
  returning id into lid;
  reset role;
  perform pg_temp.ck('C9b: the same insert into the seller''s OWN market still succeeds',
    (select market_id from public.listings where id = lid) = ma);
  perform pg_temp.ck('C9b: the honest publish still spends the owner''s allowance (ledger row exists)',
    exists (select 1 from public.listing_publish_events e
             where e.listing_id = lid and e.kind = 'publish' and e.market_id = ma));
end $$;

-- ============================================================================
select * from _t order by n;
do $$
declare bad int;
begin
  select count(*) into bad from _t where not ok;
  if bad > 0 then raise exception '% test(s) FAILED', bad; end if;
end $$;
select format('payment_hardening: %s/%s passed', count(*) filter (where ok), count(*)) from _t;
