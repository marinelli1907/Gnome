-- Zordy Ops Live Feed (CTO, 2026-11-10).
-- Adds ONE read-only function. Creates no tables, changes no data, replaces nothing.
-- Gate: active admin with users.view (OWNER/SUPER_ADMIN via '*'), same helper as the other
-- admin_* RPCs. Payload carries no emails, phones or addresses: first name, Market name,
-- listing title, short status/reason text, and ids for actions.
-- Rollback: drop function if exists public.admin_live_feed(text[], timestamptz, timestamptz, integer, text);

create or replace function public.admin_live_feed(
  p_types  text[]      default null,   -- any of: signup, market, listing, report, plan (null = all)
  p_since  timestamptz default null,   -- inclusive lower bound
  p_before timestamptz default null,   -- exclusive upper bound (paging cursor)
  p_limit  integer     default 50,     -- clamped to 1..100
  p_before_id text     default null    -- tie-break cursor: the 'id' of the last row already shown
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_rows  jsonb;
  v_count integer;
begin
  if not public.admin_has_perm('users.view') then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if p_types is not null
     and not (p_types <@ array['signup','market','listing','report','plan']::text[]) then
    raise exception 'INVALID_FEED_TYPE';
  end if;

  with first_market as (
    select distinct on (m.owner_id) m.owner_id, m.id, m.name
      from public.markets m
     where m.status <> 'deleted'
     order by m.owner_id, m.created_at, m.id
  ),
  ev as (
    -- New sign-ups
    (select 'signup'::text as type, 'signup'::text as kind, p.created_at as at, p.id as source_id,
            coalesce(nullif(split_part(btrim(coalesce(p.name, '')), ' ', 1), ''), 'New member') as label,
            null::text as detail, p.id as user_id, fm.id as market_id, fm.name as market_name
       from public.profiles p
       left join first_market fm on fm.owner_id = p.id
      where (p_types is null or 'signup' = any(p_types))
        and (p_since is null or p.created_at >= p_since)
        and (p_before is null or p.created_at < p_before
             or (p.created_at = p_before and ('signup:' || p.id::text) collate "C" < coalesce(p_before_id, '')))
      order by p.created_at desc, ('signup:' || p.id::text) collate "C" desc limit v_limit + 1)
    union all
    -- New Markets
    (select 'market', 'market_created', m.created_at, m.id,
            left(coalesce(nullif(btrim(m.name), ''), 'Unnamed Market'), 80),
            m.status::text, m.owner_id, m.id, m.name
       from public.markets m
      where (p_types is null or 'market' = any(p_types))
        and (p_since is null or m.created_at >= p_since)
        and (p_before is null or m.created_at < p_before
             or (m.created_at = p_before and ('market_created:' || m.id::text) collate "C" < coalesce(p_before_id, '')))
      order by m.created_at desc, ('market_created:' || m.id::text) collate "C" desc limit v_limit + 1)
    union all
    -- New listings (demo listings excluded)
    (select 'listing', 'listing_created', l.created_at, l.id,
            left(coalesce(nullif(btrim(l.title), ''), 'Untitled listing'), 80),
            l.status::text, l.owner_id, coalesce(l.market_id, fm.id), coalesce(lm.name, fm.name)
       from public.listings l
       left join public.markets lm on lm.id = l.market_id
       left join first_market fm on fm.owner_id = l.owner_id
      where not coalesce(l.is_demo, false)
        and (p_types is null or 'listing' = any(p_types))
        and (p_since is null or l.created_at >= p_since)
        and (p_before is null or l.created_at < p_before
             or (l.created_at = p_before and ('listing_created:' || l.id::text) collate "C" < coalesce(p_before_id, '')))
      order by l.created_at desc, ('listing_created:' || l.id::text) collate "C" desc limit v_limit + 1)
    union all
    -- Reports (user_id/market_id point at the REPORTED party, never the reporter)
    (select 'report', 'report_' || r.target_type, r.created_at, r.id,
            'Report on a ' || r.target_type,
            left(coalesce(r.reason, ''), 80) || case when r.resolved_at is null then ' · open' else ' · resolved' end,
            case r.target_type
              when 'listing' then rl.owner_id
              when 'market'  then rm.owner_id
              when 'user'    then r.target_id
            end,
            case r.target_type
              when 'listing' then coalesce(rl.market_id, rfm.id)
              when 'market'  then rm.id
              when 'user'    then rfm.id
            end,
            case r.target_type
              when 'listing' then rl.title
              when 'market'  then rm.name
              else rfm.name
            end
       from public.reports r
       left join public.listings rl on r.target_type = 'listing' and rl.id = r.target_id
       left join public.markets  rm on r.target_type = 'market'  and rm.id = r.target_id
       left join first_market rfm on rfm.owner_id = case r.target_type
                                                      when 'listing' then rl.owner_id
                                                      when 'user'    then r.target_id
                                                    end
      where (p_types is null or 'report' = any(p_types))
        and (p_since is null or r.created_at >= p_since)
        and (p_before is null or r.created_at < p_before
             or (r.created_at = p_before and ('report_' || r.target_type || ':' || r.id::text) collate "C" < coalesce(p_before_id, '')))
      order by r.created_at desc, ('report_' || r.target_type || ':' || r.id::text) collate "C" desc limit v_limit + 1)
    union all
    -- Complimentary grants created
    (select 'plan', 'comp_granted', g.created_at, g.id,
            left(coalesce(gm.name, 'Market'), 80),
            g.plan::text || ' comp' ||
              case when g.expires_at is null then ' · no expiry'
                   else ' · until ' || to_char(g.expires_at at time zone 'America/New_York', 'Mon DD, YYYY') end,
            g.user_id, g.market_id, gm.name
       from public.admin_plan_grants g
       left join public.markets gm on gm.id = g.market_id
      where (p_types is null or 'plan' = any(p_types))
        and (p_since is null or g.created_at >= p_since)
        and (p_before is null or g.created_at < p_before
             or (g.created_at = p_before and ('comp_granted:' || g.id::text) collate "C" < coalesce(p_before_id, '')))
      order by g.created_at desc, ('comp_granted:' || g.id::text) collate "C" desc limit v_limit + 1)
    union all
    -- Complimentary grants revoked
    (select 'plan', 'comp_revoked', g.revoked_at, g.id,
            left(coalesce(gm.name, 'Market'), 80),
            g.plan::text || ' comp revoked',
            g.user_id, g.market_id, gm.name
       from public.admin_plan_grants g
       left join public.markets gm on gm.id = g.market_id
      where g.revoked_at is not null
        and (p_types is null or 'plan' = any(p_types))
        and (p_since is null or g.revoked_at >= p_since)
        and (p_before is null or g.revoked_at < p_before
             or (g.revoked_at = p_before and ('comp_revoked:' || g.id::text) collate "C" < coalesce(p_before_id, '')))
      order by g.revoked_at desc, ('comp_revoked:' || g.id::text) collate "C" desc limit v_limit + 1)
    union all
    -- Paid subscriptions started
    (select 'plan', 'subscription_started', s.created_at, s.id,
            left(coalesce(sm.name, 'Market'), 80),
            s.plan::text || ' subscription · ' || coalesce(s.status, 'unknown'),
            coalesce(s.user_id, sm.owner_id), s.market_id, sm.name
       from public.market_subscriptions s
       left join public.markets sm on sm.id = s.market_id
      where (p_types is null or 'plan' = any(p_types))
        and (p_since is null or s.created_at >= p_since)
        and (p_before is null or s.created_at < p_before
             or (s.created_at = p_before and ('subscription_started:' || s.id::text) collate "C" < coalesce(p_before_id, '')))
      order by s.created_at desc, ('subscription_started:' || s.id::text) collate "C" desc limit v_limit + 1)
    union all
    -- Paid subscriptions ended
    (select 'plan', 'subscription_ended', s.revoked_at, s.id,
            left(coalesce(sm.name, 'Market'), 80),
            s.plan::text || ' subscription ended',
            coalesce(s.user_id, sm.owner_id), s.market_id, sm.name
       from public.market_subscriptions s
       left join public.markets sm on sm.id = s.market_id
      where s.revoked_at is not null
        and (p_types is null or 'plan' = any(p_types))
        and (p_since is null or s.revoked_at >= p_since)
        and (p_before is null or s.revoked_at < p_before
             or (s.revoked_at = p_before and ('subscription_ended:' || s.id::text) collate "C" < coalesce(p_before_id, '')))
      order by s.revoked_at desc, ('subscription_ended:' || s.id::text) collate "C" desc limit v_limit + 1)
  ),
  keyed as (
    select ev.*, (ev.kind || ':' || ev.source_id::text) collate "C" as row_id,
           nullif(split_part(btrim(coalesce(up.name, '')), ' ', 1), '') as user_first
      from ev
      left join public.profiles up on up.id = ev.user_id
  ),
  page as (
    select * from keyed order by at desc, row_id desc limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', row_id,
           'type', type, 'kind', kind, 'at', at,
           'label', label, 'detail', detail,
           'user_id', user_id, 'user_first', user_first,
           'market_id', market_id, 'market_name', market_name
         ) order by at desc, row_id desc), '[]'::jsonb),
         count(*)
    into v_rows, v_count
    from page;

  if v_count > v_limit then
    v_rows := v_rows - v_limit;   -- drop the probe row
  end if;

  return jsonb_build_object(
    'items', v_rows,
    'has_more', v_count > v_limit,
    'next_before', case when v_count > v_limit then (v_rows -> (v_limit - 1)) ->> 'at' end,
    'next_before_id', case when v_count > v_limit then (v_rows -> (v_limit - 1)) ->> 'id' end,
    'generated_at', now()
  );
end
$function$;

comment on function public.admin_live_feed(text[], timestamptz, timestamptz, integer, text) is
  'Zordy Ops Live Feed: newest-first admin event stream (sign-ups, Markets, listings, reports, plan changes). Read-only; admin users.view only; no contact details.';

revoke all on function public.admin_live_feed(text[], timestamptz, timestamptz, integer, text) from public;
revoke all on function public.admin_live_feed(text[], timestamptz, timestamptz, integer, text) from anon;
grant execute on function public.admin_live_feed(text[], timestamptz, timestamptz, integer, text) to authenticated;
grant execute on function public.admin_live_feed(text[], timestamptz, timestamptz, integer, text) to service_role;
