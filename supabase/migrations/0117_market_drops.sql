-- 0117: Market Drops V1 — seller-created, time-boxed collections of EXISTING listings.
--
-- "Saturday Harvest, Sat 8AM–1PM, containing Roma Tomatoes + Sourdough". A Drop is a
-- PRESENTATION layer over canonical listings and nothing more:
--   * membership consumes no publish/renewal allowance, never renews, never resets expiry,
--     never bypasses compliance — the listing stays the product truth;
--   * buyer-facing item reads join the existing public_listings view, so a listing that
--     expires, is suspended, or is removed simply drops out of the Drop's public inventory;
--   * stored status is only draft / scheduled / cancelled; LIVE and ENDED are derived from
--     the clock server-side (the listing_promotions precedent), never from a client timer.
--
-- NOT the Seed Drop. Nothing here touches seed_* tables, the seed billing gate, or Seed
-- Drop UI; the seller-facing name is "Market Drop" throughout.
--
-- The AI may CREATE drops only through the existing persisted proposal/confirm architecture
-- (0116): this migration widens ai_pending_actions to a 'create_drop' action whose executor
-- calls the same narrow create_market_drop() RPC the seller UI uses.

-- ---------------------------------------------------------------------------
-- 1. Tables (market_pickup_locations posture: public read, owner write via RLS)
-- ---------------------------------------------------------------------------
create table if not exists public.market_drops (
  id          uuid primary key default gen_random_uuid(),
  market_id   uuid not null references public.markets(id) on delete cascade,
  created_by  uuid not null default auth.uid(),
  title       text not null check (length(btrim(title)) between 1 and 80),
  description text check (description is null or length(description) <= 400),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  timezone    text not null default 'America/New_York',
  -- Stored lifecycle only. 'live' and 'ended' are DERIVED (see market_drop_phase) so a
  -- Drop goes live and ends by the clock without any cron flip or client timer.
  status      text not null default 'draft' check (status in ('draft', 'scheduled', 'cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint drop_window_coherent check (ends_at > starts_at)
);

create index if not exists market_drops_market_idx on public.market_drops (market_id, status, starts_at);

create table if not exists public.market_drop_items (
  drop_id    uuid not null references public.market_drops(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  position   int not null default 0,
  primary key (drop_id, listing_id)          -- duplicates structurally impossible
);

create index if not exists market_drop_items_listing_idx on public.market_drop_items (listing_id);

-- Hard item cap: 30 per Drop, enforced in the database so no client or RPC bug can
-- create an unbounded collection.
create or replace function public.market_drop_items_cap()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.market_drop_items where drop_id = new.drop_id) >= 30 then
    raise exception 'DROP_ITEM_LIMIT' using hint = 'a Market Drop holds at most 30 items';
  end if;
  return new;
end $$;
drop trigger if exists market_drop_items_cap_trg on public.market_drop_items;
create trigger market_drop_items_cap_trg
  before insert on public.market_drop_items
  for each row execute function public.market_drop_items_cap();

drop trigger if exists market_drops_set_updated_at on public.market_drops;
create trigger market_drops_set_updated_at
  before update on public.market_drops
  for each row execute function public.set_updated_at();

comment on table public.market_drops is
  'Seller-created, time-boxed collections of existing listings ("Saturday Harvest"). Presentation only: membership never affects listing lifecycle, allowance, or compliance. Not the Seed Drop.';
comment on table public.market_drop_items is
  'Membership of existing listings in a Market Drop. The listing remains the product truth; buyer reads join public_listings so canonical state always wins.';

-- ---------------------------------------------------------------------------
-- 2. RLS: drafts are the seller's private business; scheduled drops are public
-- ---------------------------------------------------------------------------
alter table public.market_drops enable row level security;
alter table public.market_drop_items enable row level security;

drop policy if exists market_drops_public_read on public.market_drops;
create policy market_drops_public_read on public.market_drops
  for select to anon, authenticated
  using (status = 'scheduled' or public.owns_market(market_id));

drop policy if exists market_drops_owner_write on public.market_drops;
create policy market_drops_owner_write on public.market_drops
  for all to authenticated
  using (public.owns_market(market_id))
  with check (public.owns_market(market_id));

drop policy if exists market_drop_items_read on public.market_drop_items;
create policy market_drop_items_read on public.market_drop_items
  for select to anon, authenticated
  using (exists (select 1 from public.market_drops d
                  where d.id = drop_id
                    and (d.status = 'scheduled' or public.owns_market(d.market_id))));

drop policy if exists market_drop_items_owner_write on public.market_drop_items;
create policy market_drop_items_owner_write on public.market_drop_items
  for all to authenticated
  using (exists (select 1 from public.market_drops d
                  where d.id = drop_id and public.owns_market(d.market_id)))
  with check (exists (select 1 from public.market_drops d
                       where d.id = drop_id and public.owns_market(d.market_id)));

grant select on public.market_drops, public.market_drop_items to anon, authenticated;
grant insert, update, delete on public.market_drops to authenticated;
grant insert, update, delete on public.market_drop_items to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Derived phase + the buyer-facing view
-- ---------------------------------------------------------------------------
-- upcoming | live | ended for a scheduled drop; the stored status otherwise.
create or replace function public.market_drop_phase(p_status text, p_starts timestamptz, p_ends timestamptz)
returns text language sql immutable as $$
  select case
    when p_status <> 'scheduled' then p_status
    when now() < p_starts then 'upcoming'
    when now() >= p_ends then 'ended'
    else 'live'
  end
$$;

-- Buyer surface: scheduled drops that are upcoming, live, or ended less than a day ago
-- (so "ended" can render briefly without cluttering the Market forever). Items are counted
-- against public_listings, so only genuinely purchasable listings count.
create or replace view public.public_market_drops as
select d.id,
       d.market_id,
       d.title,
       d.description,
       d.starts_at,
       d.ends_at,
       d.timezone,
       public.market_drop_phase(d.status, d.starts_at, d.ends_at) as phase,
       (select count(*) from public.market_drop_items i
         join public.public_listings pl on pl.id = i.listing_id
        where i.drop_id = d.id) as available_items
  from public.market_drops d
 where d.status = 'scheduled'
   and d.ends_at > now() - interval '24 hours';

grant select on public.public_market_drops to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The one canonical creator — seller UI and the AI executor both call this
-- ---------------------------------------------------------------------------
create or replace function public.create_market_drop(
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_listing_ids uuid[],
  p_description text default null,
  p_publish boolean default false,
  p_request text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  mkt uuid;
  n int;
  owned int;
  new_id uuid;
  i int;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select id into mkt from public.markets where owner_id = uid limit 1;
  if mkt is null then raise exception 'NO_MARKET'; end if;

  if p_title is null or length(btrim(p_title)) < 1 or length(btrim(p_title)) > 80 then
    raise exception 'INVALID_TITLE';
  end if;
  if position('seed' in lower(p_title)) > 0 then
    -- The Seed Drop is a different product; a seller Drop may not masquerade as it.
    raise exception 'RESERVED_TITLE';
  end if;
  if p_description is not null and length(p_description) > 400 then
    raise exception 'INVALID_DESCRIPTION';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'INVALID_WINDOW';
  end if;
  if p_ends_at < now() then raise exception 'WINDOW_IN_PAST'; end if;
  if p_ends_at - p_starts_at > interval '14 days' then raise exception 'WINDOW_TOO_LONG'; end if;

  n := coalesce(array_length(p_listing_ids, 1), 0);
  if n = 0 then raise exception 'NO_LISTINGS'; end if;
  if n > 30 then raise exception 'DROP_ITEM_LIMIT'; end if;
  select count(distinct l.id)::int into owned from public.listings l
   where l.id = any (p_listing_ids) and l.owner_id = uid and l.status <> 'removed';
  if owned <> (select count(distinct x) from unnest(p_listing_ids) x) then
    raise exception 'LISTING_NOT_FOUND';
  end if;

  insert into public.market_drops (market_id, created_by, title, description, starts_at, ends_at, status)
  values (mkt, uid, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
          p_starts_at, p_ends_at, case when p_publish then 'scheduled' else 'draft' end)
  returning id into new_id;

  i := 0;
  insert into public.market_drop_items (drop_id, listing_id, position)
  select new_id, x.listing_id, x.ord - 1
    from (select distinct on (u.listing_id) u.listing_id, u.ord
            from unnest(p_listing_ids) with ordinality as u(listing_id, ord)
           order by u.listing_id, u.ord) x;

  -- Audit: structured facts only, same posture as every ai_action event.
  begin
    insert into public.events (user_id, event_type, metadata)
    values (uid, case when p_publish then 'drop_scheduled' else 'drop_created' end,
            jsonb_strip_nulls(jsonb_build_object(
              'drop_id', new_id, 'market_id', mkt, 'items', n,
              'starts_at', p_starts_at, 'ends_at', p_ends_at, 'request_id', p_request)));
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'id', new_id, 'title', btrim(p_title),
    'status', case when p_publish then 'scheduled' else 'draft' end, 'items', n);
end $$;

revoke execute on function public.create_market_drop(text, timestamptz, timestamptz, uuid[], text, boolean, text) from public, anon;
grant execute on function public.create_market_drop(text, timestamptz, timestamptz, uuid[], text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. AI: widen the persisted proposal/confirm layer with 'create_drop'
-- ---------------------------------------------------------------------------
alter table public.ai_pending_actions drop constraint if exists ai_pending_actions_action_check;
alter table public.ai_pending_actions
  add constraint ai_pending_actions_action_check
  check (action in ('renew', 'restock', 'mark_sold_bulk', 'set_price_bulk', 'create_drop'));

create or replace function public.ai_propose_action(
  p_action text, p_listing_ids uuid[], p_payload jsonb default '{}',
  p_summary text default null, p_request text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n int;
  owned int;
  act_id uuid;
  k text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_action is null or p_action not in ('renew', 'restock', 'mark_sold_bulk', 'set_price_bulk', 'create_drop') then
    raise exception 'BAD_ACTION';
  end if;
  n := coalesce(array_length(p_listing_ids, 1), 0);
  if n = 0 then raise exception 'NO_LISTINGS'; end if;
  if n > 20 then raise exception 'BULK_LIMIT' using hint = format('%s > 20', n); end if;

  -- Payload stays a strict field bag: only keys the executors understand.
  if p_payload is not null then
    for k in select jsonb_object_keys(p_payload) loop
      if k not in ('price_cents', 'unit', 'title', 'description', 'starts_at', 'ends_at') then
        raise exception 'UNKNOWN_FIELD' using hint = k;
      end if;
    end loop;
  end if;
  if p_action = 'create_drop' then
    if p_payload ->> 'title' is null then raise exception 'MISSING_FIELD' using hint = 'title'; end if;
    if (p_payload ->> 'starts_at') is null or (p_payload ->> 'ends_at') is null then
      raise exception 'MISSING_FIELD' using hint = 'starts_at/ends_at';
    end if;
    -- Fail bad timestamps at proposal time, not at confirm time.
    perform (p_payload ->> 'starts_at')::timestamptz, (p_payload ->> 'ends_at')::timestamptz;
  end if;

  -- EVERY listing must be the caller's own; one foreign id fails the whole proposal.
  select count(*)::int into owned from public.listings l
   where l.id = any (p_listing_ids) and l.owner_id = uid and l.status <> 'removed';
  if owned <> n then raise exception 'LISTING_NOT_FOUND'; end if;

  insert into public.ai_pending_actions (owner_id, action, listing_ids, payload, summary, request_id)
  values (uid, p_action, p_listing_ids, coalesce(p_payload, '{}'),
          coalesce(nullif(btrim(p_summary), ''), p_action), p_request)
  returning id into act_id;

  return jsonb_build_object('ok', true, 'action_id', act_id, 'action', p_action,
    'count', n, 'expires_in_minutes', 15);
end $$;

create or replace function public.ai_confirm_action(p_action_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  a public.ai_pending_actions;
  lid uuid;
  results jsonb := '[]'::jsonb;
  r record;
  drop_result jsonb;
  ok_count int := 0;
  payment_needed int := 0;
  err text;
  v_price int;
  v_unit text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  select * into a from public.ai_pending_actions
   where id = p_action_id and owner_id = uid for update;
  if a.id is null then raise exception 'ACTION_NOT_FOUND'; end if;
  if a.status <> 'pending' then raise exception 'ACTION_ALREADY_%', a.status; end if;
  if a.expires_at <= now() then
    update public.ai_pending_actions set status = 'expired' where id = a.id;
    raise exception 'ACTION_EXPIRED';
  end if;

  -- create_drop is one atomic creation, not a per-listing loop. The canonical RPC
  -- rechecks ownership and every window/title rule itself.
  if a.action = 'create_drop' then
    drop_result := public.create_market_drop(
      a.payload ->> 'title',
      (a.payload ->> 'starts_at')::timestamptz,
      (a.payload ->> 'ends_at')::timestamptz,
      a.listing_ids,
      a.payload ->> 'description',
      true,               -- an AI-confirmed drop is scheduled; drafts stay a UI concern
      a.request_id);
    perform public._ai_audit(uid, 'create_drop', null, null,
      jsonb_build_object('drop_id', drop_result ->> 'id', 'items', drop_result -> 'items'),
      a.request_id, true);
    update public.ai_pending_actions
       set status = 'executed', executed_at = now(),
           result = jsonb_build_object('ok_count', 1, 'payment_needed', 0, 'drop', drop_result)
     where id = a.id;
    return jsonb_build_object('ok', true, 'action', a.action,
      'ok_count', 1, 'payment_needed', 0, 'drop', drop_result, 'results', '[]'::jsonb);
  end if;

  foreach lid in array a.listing_ids loop
    begin
      if a.action in ('renew', 'restock') then
        select * into r from public.renew_listing(lid);
        results := results || jsonb_build_object('id', lid, 'ok', true,
          'expires_at', r.expires_at, 'funded', r.funded);
        ok_count := ok_count + 1;
        perform public._ai_audit(uid, a.action, lid,
          null, jsonb_build_object('expires_at', r.expires_at, 'funded', r.funded),
          a.request_id, true);
      elsif a.action = 'mark_sold_bulk' then
        results := results || public.ai_mark_sold(lid, a.request_id);
        ok_count := ok_count + 1;
      elsif a.action = 'set_price_bulk' then
        v_price := (a.payload ->> 'price_cents')::int;
        v_unit  := a.payload ->> 'unit';
        results := results || public.ai_set_price(lid, v_price, v_unit, a.request_id);
        ok_count := ok_count + 1;
      end if;
    exception when others then
      err := sqlerrm;
      if position('PUBLISH_ALLOWANCE_EXHAUSTED' in err) > 0 then
        payment_needed := payment_needed + 1;
        results := results || jsonb_build_object('id', lid, 'ok', false,
          'error', 'PAYMENT_REQUIRED', 'price_cents', 99);
        perform public._ai_audit(uid, a.action, lid, null,
          jsonb_build_object('refused', 'PAYMENT_REQUIRED'), a.request_id, false);
      else
        results := results || jsonb_build_object('id', lid, 'ok', false, 'error', left(err, 60));
        perform public._ai_audit(uid, a.action, lid, null,
          jsonb_build_object('refused', left(err, 60)), a.request_id, false);
      end if;
    end;
  end loop;

  update public.ai_pending_actions
     set status = 'executed', executed_at = now(),
         result = jsonb_build_object('ok_count', ok_count, 'payment_needed', payment_needed)
   where id = a.id;

  return jsonb_build_object('ok', true, 'action', a.action,
    'ok_count', ok_count, 'payment_needed', payment_needed, 'results', results);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Anon analytics allowlist: buyer-side drop events from the web
-- ---------------------------------------------------------------------------
create or replace function public.events_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  -- Authenticated and service-role writes pass through untouched.
  if coalesce(auth.jwt() ->> 'role', '') <> 'anon' then
    return new;
  end if;

  if new.event_type not in (
    'web_zip_search',
    'web_browse_location_set',
    'web_reserve_started',
    'web_reserve_submitted',
    'web_listing_published',
    'web_gnome_opened',
    'web_gnome_quick_action',
    'web_gnome_message',
    'web_drop_viewed',
    'web_drop_shared'
  ) then
    raise exception 'EVENT_NOT_ALLOWED';
  end if;

  if new.metadata is not null and pg_column_size(new.metadata) > 512 then
    raise exception 'EVENT_METADATA_TOO_LARGE';
  end if;

  new.user_id := null;
  new.listing_id := null;

  select count(*) into recent
    from public.events
   where user_id is null
     and created_at > now() - interval '1 minute';
  if recent >= 300 then
    raise exception 'EVENT_RATE_LIMITED';
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Self-check: fail the apply loudly if exposure came out wrong
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.create_market_drop(text,timestamptz,timestamptz,uuid[],text,boolean,text)', 'execute') then
    raise exception '0117: anon can execute create_market_drop';
  end if;
  if not has_function_privilege('authenticated', 'public.create_market_drop(text,timestamptz,timestamptz,uuid[],text,boolean,text)', 'execute') then
    raise exception '0117: authenticated lost execute on create_market_drop';
  end if;
  if not has_table_privilege('anon', 'public.public_market_drops', 'select') then
    raise exception '0117: anon lost read on public_market_drops';
  end if;
end $$;

notify pgrst, 'reload schema';
