-- Behavioural proof for 0120: Drop Alerts — explicit consent + exactly-once.
--
-- The claims under test:
--   1. Consent is explicit and default OFF; following alone never alerts.
--   2. Eligibility = live drop × current follower × opted in × has a token;
--      cancelled/draft/ended drops, suspended markets, unfollowed or
--      toggled-off buyers, and token-less buyers are never claimed.
--   3. Exactly-once at the submission boundary: repeated/overlapping runs
--      never re-claim, and a partially-failed cohort retries ONLY its
--      unfinished remainder.
--   4. Ticket truth is per-device via (request_id, batch_position); an HTTP
--      200 never blankets a batch; DeviceNotRegistered retires the token,
--      transient transport failure requeues without touching the token.
--   5. The whole worker surface is invisible to client roles.
--
-- Run against a THROWAWAY database only (run_drop_alerts_tests.sh).

\set ON_ERROR_STOP on
set client_min_messages = warning;

create temporary table _t (n int, name text, ok boolean, detail text);
create sequence if not exists _tn start 1;
create or replace function pg_temp.ck(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin insert into _t values (nextval('_tn')::int, p_name, p_ok, p_detail); end $$;

create or replace function pg_temp.impersonate(p_uid uuid)
returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
$$;

-- ============================================================================
-- Fixtures
--   Seller S / market M (active) with drop LIVE now.
--   Buyer A: opted in, TWO device tokens (multi-device ruling).
--   Buyer B: follows, alerts OFF, has token.
--   Buyer C: opted in, NO token.
--   Buyer E: opted in + token, will UNFOLLOW before the worker runs.
--   Buyer F: opted in + token, will TOGGLE OFF before the worker runs.
--   Drops D2 cancelled / D3 draft / D4 ended on M.
--   Seller S2 / market M2 SUSPENDED with a live drop and an opted-in follower.
-- ============================================================================
do $$
declare
  s  uuid := '00000000-0000-0000-0000-00000000aa00';
  s2 uuid := '00000000-0000-0000-0000-00000000aa02';
  a  uuid := '00000000-0000-0000-0000-00000000aaa1';
  b  uuid := '00000000-0000-0000-0000-00000000aab2';
  c  uuid := '00000000-0000-0000-0000-00000000aac3';
  e  uuid := '00000000-0000-0000-0000-00000000aae5';
  f  uuid := '00000000-0000-0000-0000-00000000aaf6';
  m  uuid := 'aa200117-0000-0000-0000-000000000001';
  m2 uuid := 'aa200117-0000-0000-0000-000000000002';
begin
  -- The runner's race test already exercised the worker once; start the
  -- behavioural suite from a clean worker slate.
  delete from public.drop_alert_messages;
  delete from public.drop_alert_deliveries;
  delete from net._sent;
  delete from net._http_response;
  delete from public.market_drops where market_id = 'da200117-0000-0000-0000-000000000001';
  delete from public.market_follows where market_id = 'da200117-0000-0000-0000-000000000001';

  insert into auth.users (id) values (s), (s2), (a), (b), (c), (e), (f) on conflict do nothing;
  delete from public.markets where owner_id in (s, s2);
  insert into public.markets (id, owner_id, plan) values (m, s, 'free');
  insert into public.markets (id, owner_id, plan, status) values (m2, s2, 'free', 'suspended');

  insert into public.market_drops (id, market_id, created_by, title, starts_at, ends_at, status) values
    ('aa200117-1111-0000-0000-000000000001', m, s, 'Saturday Harvest', now() - interval '10 minutes', now() + interval '50 minutes', 'scheduled'),
    ('aa200117-1111-0000-0000-000000000002', m, s, 'Cancelled Drop',   now() - interval '10 minutes', now() + interval '50 minutes', 'cancelled'),
    ('aa200117-1111-0000-0000-000000000003', m, s, 'Draft Drop',       now() - interval '10 minutes', now() + interval '50 minutes', 'draft'),
    ('aa200117-1111-0000-0000-000000000004', m, s, 'Ended Drop',       now() - interval '3 hours',    now() - interval '1 hour',     'scheduled'),
    ('aa200117-1111-0000-0000-000000000005', m2, s2, 'Suspended Market Drop', now() - interval '10 minutes', now() + interval '50 minutes', 'scheduled');

  insert into public.market_follows (market_id, follower_id, drop_alerts_enabled) values
    (m, a, true), (m, b, false), (m, c, true), (m, e, true), (m, f, true), (m2, a, true);

  insert into public.device_tokens (token, user_id, platform) values
    ('ExponentPushToken[a-phone]',  a, 'ios'),
    ('ExponentPushToken[a-tablet]', a, 'ios'),
    ('ExponentPushToken[b-phone]',  b, 'ios'),
    ('ExponentPushToken[e-phone]',  e, 'ios'),
    ('ExponentPushToken[f-phone]',  f, 'ios') on conflict do nothing;

  -- E unfollows; F toggles alerts off — both BEFORE any worker run.
  delete from public.market_follows where market_id = m and follower_id = e;
  update public.market_follows set drop_alerts_enabled = false where market_id = m and follower_id = f;
end $$;

-- ============================================================================
-- 1. Consent shape
-- ============================================================================
do $$
declare
  b uuid := '00000000-0000-0000-0000-00000000aab2';
  a uuid := '00000000-0000-0000-0000-00000000aaa1';
  m uuid := 'aa200117-0000-0000-0000-000000000001';
  def boolean; hijack int;
begin
  -- A fresh follow lands with alerts OFF.
  perform pg_temp.impersonate(b);
  execute 'set local role authenticated';
  delete from public.market_follows where market_id = m and follower_id = b;
  insert into public.market_follows (market_id, follower_id) values (m, b);
  select drop_alerts_enabled into def from public.market_follows
   where market_id = m and follower_id = b;

  -- B turns their own alerts on, then off again (durable toggle).
  update public.market_follows set drop_alerts_enabled = true
   where market_id = m and follower_id = b;
  update public.market_follows set drop_alerts_enabled = false
   where market_id = m and follower_id = b;

  -- B cannot flip A's preference.
  update public.market_follows set drop_alerts_enabled = false
   where market_id = m and follower_id = a;
  get diagnostics hijack = row_count;
  execute 'reset role';

  perform pg_temp.ck('a new follow defaults to alerts OFF', def = false);
  perform pg_temp.ck('a buyer cannot flip another buyer''s alert preference', hijack = 0);
  perform pg_temp.ck('A''s opt-in survived the attempted tamper',
    (select drop_alerts_enabled from public.market_follows
      where market_id = m and follower_id = a));
end $$;

-- ============================================================================
-- 2. Dispatch: eligibility, multi-device fan-out, batch shape
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000aaa1';
  live_drop uuid := 'aa200117-1111-0000-0000-000000000001';
  res jsonb;
  n_del int; n_msg int; n_sent_req int;
  body jsonb;
begin
  res := public.drop_alert_dispatch();

  select count(*) into n_del from public.drop_alert_deliveries;
  select count(*) into n_msg from public.drop_alert_messages;
  select count(*) into n_sent_req from net._sent;

  perform pg_temp.ck('exactly ONE recipient claimed (A; not B/C/E/F/suspended)',
    n_del = 1 and (select user_id from public.drop_alert_deliveries limit 1) = a,
    format('deliveries=%s', n_del));
  perform pg_temp.ck('the claim is for the LIVE drop only',
    (select drop_id from public.drop_alert_deliveries limit 1) = live_drop);
  perform pg_temp.ck('multi-device: one decision, one message per device',
    n_msg = 2, format('messages=%s', n_msg));
  perform pg_temp.ck('one Expo batch request captured', n_sent_req = 1);

  select s.body into body from net._sent s limit 1;
  perform pg_temp.ck('batch bodies carry title/body/data with safe ids only',
    jsonb_array_length(body) = 2
    and body -> 0 ->> 'title' = 'Saturday Harvest is LIVE'
    and (body -> 0 -> 'data' ->> 'event') = 'drop_live'
    and (body -> 0 -> 'data' ->> 'dropId') = live_drop::text,
    left(body::text, 120));
  perform pg_temp.ck('deliveries advanced to submitted',
    (select status from public.drop_alert_deliveries limit 1) = 'submitted');
  perform pg_temp.ck('messages carry request/position mapping',
    (select count(*) from public.drop_alert_messages
      where request_id is not null and batch_position in (0, 1)) = 2);

  -- Exactly-once: an immediate second run claims and submits nothing new.
  res := public.drop_alert_dispatch();
  perform pg_temp.ck('a second run claims nothing and submits nothing',
    (res ->> 'claimed')::int = 0 and (res ->> 'submitted')::int = 0,
    res::text);
end $$;

-- ============================================================================
-- 3. Reconcile: per-position tickets, permanent vs transient, rollup
-- ============================================================================
do $$
declare
  req bigint;
  res jsonb;
  a_phone_status text; a_tablet_status text;
  del_status text;
begin
  select id into req from net._sent limit 1;
  -- Synthetic Expo response: position 0 (a-phone) gets a ticket, position 1
  -- (a-tablet) is permanently DeviceNotRegistered. HTTP is 200 for BOTH —
  -- proving a 200 never blankets the batch.
  insert into net._http_response (id, status_code, content) values
    (req, 200, '{"data":[{"status":"ok","id":"TICKET-A-PHONE"},{"status":"error","message":"gone","details":{"error":"DeviceNotRegistered"}}]}');

  res := public.drop_alert_reconcile();

  select status into a_phone_status from public.drop_alert_messages where token = 'ExponentPushToken[a-phone]';
  select status into a_tablet_status from public.drop_alert_messages where token = 'ExponentPushToken[a-tablet]';
  select status into del_status from public.drop_alert_deliveries limit 1;

  perform pg_temp.ck('position 0 resolved to its own ticket',
    a_phone_status = 'ticketed'
    and (select ticket_id from public.drop_alert_messages where token = 'ExponentPushToken[a-phone]') = 'TICKET-A-PHONE');
  perform pg_temp.ck('position 1 resolved independently as permanently invalid',
    a_tablet_status = 'invalid');
  perform pg_temp.ck('the dead device token was retired',
    not exists (select 1 from public.device_tokens where token = 'ExponentPushToken[a-tablet]'));
  perform pg_temp.ck('the healthy device token survived',
    exists (select 1 from public.device_tokens where token = 'ExponentPushToken[a-phone]'));
  perform pg_temp.ck('recipient rollup is SENT (one device reached)',
    del_status = 'sent', coalesce(del_status, 'null'));
end $$;

-- ============================================================================
-- 4. Transient transport failure: bounded requeue, partial recovery
-- ============================================================================
do $$
declare
  s uuid := '00000000-0000-0000-0000-00000000aa00';
  g uuid := '00000000-0000-0000-0000-00000000aa77';
  m uuid := 'aa200117-0000-0000-0000-000000000001';
  req bigint;
  res jsonb;
  msg_status text; msg_attempts int; msg_req bigint;
begin
  -- New opted-in follower G appears after the first cohort: partial recovery
  -- means the next run claims ONLY G, never re-touching A's finished rows.
  insert into auth.users (id) values (g) on conflict do nothing;
  insert into public.market_follows (market_id, follower_id, drop_alerts_enabled)
  values (m, g, true);
  insert into public.device_tokens (token, user_id, platform)
  values ('ExponentPushToken[g-phone]', g, 'ios') on conflict do nothing;

  res := public.drop_alert_dispatch();
  perform pg_temp.ck('late joiner claimed without disturbing the finished cohort',
    (res ->> 'claimed')::int = 1
    and (select count(*) from public.drop_alert_deliveries) = 2
    and (select count(*) from public.drop_alert_deliveries where status = 'sent') = 1,
    res::text);

  -- Its request fails at the TRANSPORT level (timeout): transient → requeue,
  -- token untouched, attempts counted.
  select max(id) into req from net._sent;
  insert into net._http_response (id, status_code, content, error_msg)
  values (req, null, null, 'timeout');
  res := public.drop_alert_reconcile();

  select status, attempts, request_id into msg_status, msg_attempts, msg_req
    from public.drop_alert_messages where token = 'ExponentPushToken[g-phone]';
  perform pg_temp.ck('transient failure requeued the message unbounded by the batch',
    msg_status = 'pending' and msg_req is null and msg_attempts = 1,
    format('status=%s attempts=%s', msg_status, msg_attempts));
  perform pg_temp.ck('transient failure never retires the token',
    exists (select 1 from public.device_tokens where token = 'ExponentPushToken[g-phone]'));

  -- Redispatch succeeds this time.
  res := public.drop_alert_dispatch();
  select max(id) into req from net._sent;
  insert into net._http_response (id, status_code, content)
  values (req, 200, '{"data":[{"status":"ok","id":"TICKET-G"}]}');
  res := public.drop_alert_reconcile();
  perform pg_temp.ck('requeued message delivered on retry and rolled up',
    (select d.status from public.drop_alert_deliveries d
      join public.drop_alert_messages mm on mm.delivery_id = d.id
     where mm.token = 'ExponentPushToken[g-phone]') = 'sent');
end $$;

-- ============================================================================
-- 5. The worker surface is invisible to client roles
-- ============================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000aaa1';
  ledger_blocked boolean := false; fn_blocked boolean := false;
begin
  perform pg_temp.impersonate(a);
  execute 'set local role authenticated';
  begin
    perform count(*) from public.drop_alert_deliveries;
  exception when insufficient_privilege then ledger_blocked := true;
  end;
  begin
    perform public.drop_alert_dispatch();
  exception when insufficient_privilege then fn_blocked := true;
  end;
  execute 'reset role';
  perform pg_temp.ck('authenticated cannot read the delivery ledger', ledger_blocked);
  perform pg_temp.ck('authenticated cannot invoke the dispatcher', fn_blocked);
end $$;

select * from _t order by n;
do $$
declare bad int;
begin
  select count(*) into bad from _t where not ok;
  if bad > 0 then raise exception '% test(s) FAILED', bad; end if;
end $$;
select format('drop_alerts: %s/%s passed', count(*) filter (where ok), count(*)) from _t;
