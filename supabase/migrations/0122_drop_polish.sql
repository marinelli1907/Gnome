-- 0122: Market Drops polish — server-side fixes from the §11 audit.
--
-- 1. market_drop_phase was declared IMMUTABLE while calling now(). now() is
--    STABLE; the mislabel licenses the planner to constant-fold the phase.
--    Safe in the current inlined view, but one index or constant-arg call
--    away from freezing a Drop's phase forever. Re-declared STABLE.
-- 2. The 30-item cap trigger was BEFORE INSERT .. FOR EACH ROW with a plain
--    count — rows inserted earlier in the SAME statement are invisible to it,
--    so one bulk PostgREST insert could blow past the cap. A statement-level
--    AFTER trigger with a transition table now re-checks the real total.
-- 3. drop_alert_dispatch announced "see what's available" for ANY live drop,
--    including one whose items had all sold. The live_drops CTE now requires
--    available_items > 0 from the canonical public view (which, since 0121,
--    also excludes baskets with unavailable components). Body is the 0120
--    definition with exactly that one WHERE addition.

-- 1. phase derivation: stable, not immutable ---------------------------------
create or replace function public.market_drop_phase(p_status text, p_starts timestamptz, p_ends timestamptz)
returns text language sql stable as $$
  select case
    when p_status <> 'scheduled' then p_status
    when now() < p_starts then 'upcoming'
    when now() >= p_ends then 'ended'
    else 'live'
  end
$$;

-- 2. bulk-insert-proof item cap ----------------------------------------------
create or replace function public.market_drop_items_cap_stmt()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1
      from (select distinct drop_id from new_table) nd
     where (select count(*) from public.market_drop_items i where i.drop_id = nd.drop_id) > 30
  ) then
    raise exception 'DROP_ITEM_LIMIT' using hint = 'a Market Drop holds at most 30 items';
  end if;
  return null;
end $$;

drop trigger if exists market_drop_items_cap_stmt_trg on public.market_drop_items;
create trigger market_drop_items_cap_stmt_trg
  after insert on public.market_drop_items
  referencing new table as new_table
  for each statement execute function public.market_drop_items_cap_stmt();

-- 3. dispatch: only announce drops with something available ------------------
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
       -- 0122: never announce a Drop with nothing left in it. available_items
       -- comes from the canonical view (which also hides unavailable baskets),
       -- so "see what's available" is only pushed when something actually is.
       and exists (select 1 from public.public_market_drops v
                    where v.id = d.id and v.available_items > 0)
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


-- ---------------------------------------------------------------------------
-- Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if (select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'market_drop_phase') <> 's' then
    raise exception '0122 self-check: market_drop_phase not STABLE';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'market_drop_items_cap_stmt_trg') then
    raise exception '0122 self-check: statement-level cap trigger missing';
  end if;
  if position('available_items' in
      (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'drop_alert_dispatch')) = 0 then
    raise exception '0122 self-check: dispatch availability gate missing';
  end if;
end $$;
