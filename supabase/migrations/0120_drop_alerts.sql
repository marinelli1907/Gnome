-- 0120: Drop Alerts — explicit consent + exactly-once delivery (CTO-approved
-- OPTION A: SQL-native scheduled worker; no secrets, no public endpoint).
--
--   pg_cron → locked SECURITY DEFINER dispatcher → recipient-level delivery
--   ledger → pg_net → Expo Push Service → persisted request/ticket mapping →
--   separate receipt reconciler → permanent-token retirement where proven.
--
-- Consent ruling: FOLLOWING DOES NOT IMPLY DROP-ALERT CONSENT. The alert is an
-- explicit per-Market opt-in, default OFF, stored ON the follow relationship —
-- unfollowing destroys the preference; no hidden subscription survives.
--
-- "Exactly once" means exactly once at Gnome's PROVIDER-SUBMISSION boundary:
-- the ledger row per (drop_id, user_id) is claimed before anything can be
-- submitted, submission is stamped atomically with the pg_net enqueue (both
-- commit or neither does), and receipts are reconciled separately. We record
-- queued/submitted/ticket truth — never a claim of physical device receipt.
--
-- Multi-device ruling: one alert DECISION per user per drop (the delivery
-- row); that decision fans out to each registered device as its own message
-- row, so ticket/receipt truth stays per-device without re-alerting a user
-- because they own two phones.

-- ---------------------------------------------------------------------------
-- 0. pg_net — available on hosted Supabase; guarded so throwaway local test
--    databases without the extension still build (worker calls then no-op).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_net';
  else
    raise notice '0120: pg_net unavailable in this environment; dispatch becomes a no-op here';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Consent on the follow relationship, plus the missing self-UPDATE policy
-- ---------------------------------------------------------------------------
alter table public.market_follows
  add column if not exists drop_alerts_enabled boolean not null default false;

drop policy if exists market_follows_update_own on public.market_follows;
create policy market_follows_update_own on public.market_follows
  for update using (auth.uid() = follower_id) with check (auth.uid() = follower_id);

grant update (drop_alerts_enabled) on public.market_follows to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Delivery ledger (per recipient) + message mapping (per device)
-- ---------------------------------------------------------------------------
create table if not exists public.drop_alert_deliveries (
  id          uuid primary key default gen_random_uuid(),
  drop_id     uuid not null references public.market_drops (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  -- claimed → submitted → sent | failed | invalid_token
  status      text not null default 'claimed'
              check (status in ('claimed', 'submitted', 'sent', 'failed', 'invalid_token')),
  claimed_at  timestamptz not null default now(),
  resolved_at timestamptz,
  unique (drop_id, user_id)              -- THE exactly-once claim boundary
);
create index if not exists drop_alert_deliveries_open_idx
  on public.drop_alert_deliveries (status) where status in ('claimed', 'submitted');

-- One row per (delivery × device token) = one Expo push message. Carries the
-- request/ticket mapping so a batch HTTP 200 never blankets the whole cohort:
-- each message resolves from ITS position in ITS request's ticket array.
create table if not exists public.drop_alert_messages (
  id             uuid primary key default gen_random_uuid(),
  delivery_id    uuid not null references public.drop_alert_deliveries (id) on delete cascade,
  token          text not null,
  -- pending → (request_id stamped = submitted) → ticketed | invalid | failed
  status         text not null default 'pending'
                 check (status in ('pending', 'ticketed', 'invalid', 'failed')),
  request_id     bigint,                 -- net._http_response id of the batch POST
  batch_position int,                    -- index of this message inside that POST body
  ticket_id      text,                   -- Expo ticket, when granted
  receipt_status text,                   -- ok | error:<code>, from the receipt phase
  attempts       int not null default 0, -- transient-failure redispatches
  detail         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists drop_alert_messages_open_idx
  on public.drop_alert_messages (status, request_id);
create index if not exists drop_alert_messages_delivery_idx
  on public.drop_alert_messages (delivery_id);

alter table public.drop_alert_deliveries enable row level security;
alter table public.drop_alert_messages   enable row level security;
-- No policies on purpose: delivery truth (and every push token in it) is
-- service-side only. Sellers never see recipients; clients never see tokens.
revoke all on public.drop_alert_deliveries from public, anon, authenticated;
revoke all on public.drop_alert_messages   from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. PHASE 1 — DISPATCH (claim + submit). No arguments beyond a row bound:
--    recipients, tokens, and copy are derived entirely server-side, so no
--    caller could ever say "send this token this message".
-- ---------------------------------------------------------------------------
create or replace function public.drop_alert_dispatch(p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  claimed_count int := 0;
  submitted_msgs int := 0;
  batch record;
  req_id bigint;
  -- Detect the callable, not the extension row: production gets it from
  -- pg_net; the local test harness provides a capture shim with the same
  -- signature so dispatch/reconcile logic is fully testable offline.
  has_net boolean := to_regproc('net.http_post') is not null;
begin
  -- 3a. CLAIM: eligible = live drop × opted-in current follower × has tokens.
  with live_drops as (
    select d.id, m.id as mkt_id
      from public.market_drops d
      join public.markets m on m.id = d.market_id
      join public.profiles p on p.id = m.owner_id
     where d.status = 'scheduled'
       and now() >= d.starts_at and now() < d.ends_at
       and m.status = 'active'
       and coalesce(p.suspended, false) = false
  ),
  eligible as (
    select ld.id as drop_id, f.follower_id as user_id
      from live_drops ld
      join public.market_follows f
        on f.market_id = ld.mkt_id and f.drop_alerts_enabled
     where exists (select 1 from public.device_tokens t where t.user_id = f.follower_id)
     limit greatest(p_limit, 1)
  ),
  claimed as (
    insert into public.drop_alert_deliveries (drop_id, user_id)
    select e.drop_id, e.user_id from eligible e
    on conflict (drop_id, user_id) do nothing
    returning id, user_id
  ),
  msgs as (
    insert into public.drop_alert_messages (delivery_id, token)
    select c.id, t.token
      from claimed c
      join public.device_tokens t on t.user_id = c.user_id
    returning 1
  )
  select count(*) into claimed_count from claimed;

  -- 3b. SUBMIT: batch pending messages (≤100 per Expo request). The pg_net
  -- enqueue and the request_id stamp commit in the SAME transaction — a crash
  -- before commit sends nothing and stamps nothing; a commit does both.
  if has_net then
    for batch in
      select array_agg(x.id order by x.rn) as msg_ids,
             jsonb_agg(jsonb_build_object(
               'to', x.token, 'sound', 'default',
               'title', x.title || ' is LIVE',
               'body', x.mkt_name || '''s Drop is live now. See what''s available.',
               'data', jsonb_build_object('event', 'drop_live',
                                          'marketId', x.mkt_id, 'dropId', x.drop_id)
             ) order by x.rn) as body
        from (
          select msg.id, msg.token, d.title, m.name as mkt_name, m.id as mkt_id,
                 dd.drop_id, row_number() over (order by msg.created_at, msg.id) as rn
            from public.drop_alert_messages msg
            join public.drop_alert_deliveries dd on dd.id = msg.delivery_id
            join public.market_drops d on d.id = dd.drop_id
            join public.markets m on m.id = d.market_id
           where msg.status = 'pending' and msg.request_id is null
           order by msg.created_at, msg.id
           limit greatest(p_limit, 1)
        ) x
       group by (x.rn - 1) / 100
    loop
      select net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        body := batch.body,
        headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
        timeout_milliseconds := 10000
      ) into req_id;

      update public.drop_alert_messages msg
         set request_id = req_id,
             batch_position = pos.ordinality - 1,
             attempts = attempts + 1,
             updated_at = now()
        from unnest(batch.msg_ids) with ordinality as pos(mid, ordinality)
       where msg.id = pos.mid;

      update public.drop_alert_deliveries dd
         set status = 'submitted'
       where dd.status = 'claimed'
         and dd.id in (select delivery_id from public.drop_alert_messages
                        where id = any (batch.msg_ids));

      submitted_msgs := submitted_msgs + coalesce(array_length(batch.msg_ids, 1), 0);
    end loop;
  end if;

  return jsonb_build_object('claimed', claimed_count, 'submitted', submitted_msgs);
end $$;

revoke execute on function public.drop_alert_dispatch(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. PHASE 2 — RECONCILE (tickets + token hygiene). Reads pg_net responses,
--    resolves each message from ITS position in ITS request, retires tokens
--    only on Expo's PERMANENT signal, requeues transient failures bounded.
-- ---------------------------------------------------------------------------
create or replace function public.drop_alert_reconcile(p_limit int default 500)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ticketed int := 0; invalid int := 0; requeued int := 0; failed int := 0;
  r record;
  tick jsonb;
  err text;
  -- Detect the callable, not the extension row: production gets it from
  -- pg_net; the local test harness provides a capture shim with the same
  -- signature so dispatch/reconcile logic is fully testable offline.
  has_net boolean := to_regproc('net.http_post') is not null;
begin
  if not has_net then
    return jsonb_build_object('ticketed', 0, 'invalid', 0, 'requeued', 0, 'failed', 0);
  end if;

  for r in
    select msg.id, msg.delivery_id, msg.token, msg.batch_position, msg.attempts,
           resp.status_code, resp.content, resp.error_msg
      from public.drop_alert_messages msg
      join net._http_response resp on resp.id = msg.request_id
     where msg.status = 'pending' and msg.request_id is not null
     limit greatest(p_limit, 1)
  loop
    if r.status_code = 200 then
      -- Ticket for THIS device: the response's data[] is ordered like the
      -- request body; batch_position picks out exactly our message.
      tick := (r.content::jsonb) -> 'data' -> r.batch_position;
      if tick is null then
        update public.drop_alert_messages
           set status = 'failed', detail = 'no ticket at position', updated_at = now()
         where id = r.id;
        failed := failed + 1;
      elsif tick ->> 'status' = 'ok' then
        update public.drop_alert_messages
           set status = 'ticketed', ticket_id = tick ->> 'id', updated_at = now()
         where id = r.id;
        ticketed := ticketed + 1;
      else
        err := coalesce(tick -> 'details' ->> 'error', 'unknown');
        if err = 'DeviceNotRegistered' then
          -- Expo's PERMANENT signal: retire the token (existing storage
          -- semantics = the row is deleted, same as sign-out/unregister).
          update public.drop_alert_messages
             set status = 'invalid', detail = err, updated_at = now()
           where id = r.id;
          delete from public.device_tokens where token = r.token;
          invalid := invalid + 1;
        else
          -- Ticket-level error that is not a permanent token verdict:
          -- record; do not retire the token.
          update public.drop_alert_messages
             set status = 'failed', detail = left(err, 120), updated_at = now()
           where id = r.id;
          failed := failed + 1;
        end if;
      end if;
    else
      -- Transport-level trouble (timeout, 5xx): TRANSIENT. Requeue the whole
      -- message for a fresh dispatch, bounded to 3 attempts, never touching
      -- the token. Only the affected request's messages requeue — a partial
      -- fan-out never resets recipients whose submission already succeeded.
      if r.attempts < 3 then
        update public.drop_alert_messages
           set request_id = null, batch_position = null, updated_at = now(),
               detail = left(coalesce(r.error_msg, 'http ' || coalesce(r.status_code::text, '?')), 120)
         where id = r.id;
        requeued := requeued + 1;
      else
        update public.drop_alert_messages
           set status = 'failed', updated_at = now(),
               detail = left('gave up: ' || coalesce(r.error_msg, 'http ' || coalesce(r.status_code::text, '?')), 120)
         where id = r.id;
        failed := failed + 1;
      end if;
    end if;
  end loop;

  -- Roll terminal message truth up to the recipient decision.
  update public.drop_alert_deliveries dd
     set status = case
           when exists (select 1 from public.drop_alert_messages m
                         where m.delivery_id = dd.id and m.status = 'ticketed') then 'sent'
           when exists (select 1 from public.drop_alert_messages m
                         where m.delivery_id = dd.id and m.status = 'invalid') then 'invalid_token'
           else 'failed'
         end,
         resolved_at = now()
   where dd.status = 'submitted'
     and not exists (select 1 from public.drop_alert_messages m
                      where m.delivery_id = dd.id and m.status = 'pending');

  return jsonb_build_object('ticketed', ticketed, 'invalid', invalid,
                            'requeued', requeued, 'failed', failed);
end $$;

revoke execute on function public.drop_alert_reconcile(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The cron entrypoint: reconcile what's in flight, then dispatch what's
--    due. Emits one factual analytics event per run that did any work.
-- ---------------------------------------------------------------------------
create or replace function public.drop_alert_run()
returns void language plpgsql security definer set search_path = public as $$
declare
  rec jsonb; dis jsonb;
begin
  rec := public.drop_alert_reconcile();
  dis := public.drop_alert_dispatch();
  if (dis ->> 'claimed')::int > 0 or (dis ->> 'submitted')::int > 0
     or (rec ->> 'ticketed')::int > 0 or (rec ->> 'invalid')::int > 0
     or (rec ->> 'requeued')::int > 0 or (rec ->> 'failed')::int > 0 then
    begin
      insert into public.events (event_type, metadata)
      values ('drop_alert_run', jsonb_build_object('dispatch', dis, 'reconcile', rec));
    exception when others then null;
    end;
  end if;
end $$;

revoke execute on function public.drop_alert_run() from public, anon, authenticated;

-- Recurring poller (§17: a few minutes is the right cadence; never per-Drop
-- jobs). Guarded for environments without pg_cron.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'gnome-drop-alerts') then
      perform cron.schedule('gnome-drop-alerts', '*/2 * * * *',
                            $job$select public.drop_alert_run();$job$);
    end if;
  else
    raise notice '0120: pg_cron unavailable here; no schedule registered';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Self-checks: consent default, ledger boundary, and the grant lockdown
-- ---------------------------------------------------------------------------
do $$
declare ok boolean;
begin
  select column_default = 'false' into ok
    from information_schema.columns
   where table_schema = 'public' and table_name = 'market_follows'
     and column_name = 'drop_alerts_enabled';
  if not coalesce(ok, false) then
    raise exception '0120 self-check: drop_alerts_enabled must default false';
  end if;

  select exists (select 1 from pg_constraint
                  where conrelid = 'public.drop_alert_deliveries'::regclass
                    and contype = 'u') into ok;
  if not ok then
    raise exception '0120 self-check: delivery ledger unique boundary missing';
  end if;

  -- The worker surface must be invisible to client roles.
  if has_table_privilege('authenticated', 'public.drop_alert_deliveries', 'select')
     or has_table_privilege('anon', 'public.drop_alert_deliveries', 'select')
     or has_table_privilege('authenticated', 'public.drop_alert_messages', 'select')
     or has_table_privilege('anon', 'public.drop_alert_messages', 'select')
     or has_function_privilege('authenticated', 'public.drop_alert_dispatch(int)', 'execute')
     or has_function_privilege('anon', 'public.drop_alert_dispatch(int)', 'execute')
     or has_function_privilege('authenticated', 'public.drop_alert_reconcile(int)', 'execute')
     or has_function_privilege('anon', 'public.drop_alert_reconcile(int)', 'execute')
     or has_function_privilege('authenticated', 'public.drop_alert_run()', 'execute')
     or has_function_privilege('anon', 'public.drop_alert_run()', 'execute') then
    raise exception '0120 self-check: worker surface leaked to client roles';
  end if;
end $$;

notify pgrst, 'reload schema';
