-- 0116: the server-authoritative action layer behind Gnome AI market management.
--
-- The model REQUESTS; these functions DECIDE. Every write here terminates in a narrow,
-- owner-scoped operation that rechecks auth.uid() ownership and rides the canonical lifecycle:
--
--   * price / quantity / mark-sold are the same edits the seller's own UI makes (RLS column
--     updates; 'completed' IS Gnome's sold-out state) — no allowance touched;
--   * restock and renew are the SAME server operation (renew_listing), because reactivating a
--     completed/expired Sell listing is canonically a re-publish through the 0104 gate — the
--     allowance trigger, not this file, decides included vs $0.99 vs refuse;
--   * "pause" does not exist as a seller state ('paused' belongs to the compliance flow), so the
--     AI maps "hide it" to the canonical Mark sold, and says so.
--
-- Confirmation is SERVER-BOUND (the CTO gate's third non-negotiable): renewal-class and bulk
-- actions are never executed from model output. The edge function may only CREATE a pending
-- action row; execution requires ai_confirm_action() — a separate authenticated call the client
-- makes when the seller taps Confirm. Model prose cannot forge that call, and a pending action
-- expires in 15 minutes.
--
-- Every mutation writes an audit row to public.events (event_type 'ai_action') carrying actor,
-- tool, previous value, new value and the conversation/request id — never the conversation
-- itself.

-- ---------------------------------------------------------------------------
-- 1. Server-bound pending actions
-- ---------------------------------------------------------------------------
create table if not exists public.ai_pending_actions (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  action      text not null check (action in ('renew', 'restock', 'mark_sold_bulk', 'set_price_bulk')),
  listing_ids uuid[] not null,
  payload     jsonb not null default '{}',
  summary     text not null,               -- the exact sentence the seller confirmed
  status      text not null default 'pending'
                check (status in ('pending', 'executed', 'cancelled', 'expired')),
  request_id  text,                        -- AI conversation/request id for audit stitching
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes',
  executed_at timestamptz,
  result      jsonb
);

alter table public.ai_pending_actions enable row level security;
drop policy if exists ai_pending_owner_read on public.ai_pending_actions;
create policy ai_pending_owner_read on public.ai_pending_actions
  for select using (auth.uid() = owner_id);
-- No INSERT/UPDATE policies: rows are written only by the definer RPCs below.
revoke insert, update, delete, truncate on public.ai_pending_actions from anon, authenticated;
grant select on public.ai_pending_actions to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Failure-family observability on the existing usage log (kept lightweight)
-- ---------------------------------------------------------------------------
-- ai_usage_log is a baseline table (no numbered migration creates it — the 0080 prose gap), so
-- guard for throwaway test databases; production always has it.
do $$
begin
  if to_regclass('public.ai_usage_log') is not null then
    alter table public.ai_usage_log
      add column if not exists failure_family text
        check (failure_family is null or failure_family in ('rate_limited', 'provider_error', 'invalid_output', 'timeout'));
    comment on column public.ai_usage_log.failure_family is
      'Coarse cause on success=false rows: rate_limited (provider quota/429 family, fallback chain exhausted), provider_error, invalid_output, timeout. Never shown to sellers.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Shared audit helper (definer-internal; not granted)
-- ---------------------------------------------------------------------------
create or replace function public._ai_audit(
  p_user uuid, p_action text, p_listing uuid, p_prev jsonb, p_new jsonb,
  p_request text, p_success boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Best-effort by design (0115 precedent): a missing profile row must never turn a seller's
  -- successful edit into an error. The mutation itself is still in the caller's transaction.
  begin
    insert into public.events (user_id, event_type, listing_id, metadata)
    values (p_user, 'ai_action', p_listing, jsonb_strip_nulls(jsonb_build_object(
      'action', p_action, 'tool', 'gnome_ai',
      'prev', p_prev, 'new', p_new,
      'request_id', p_request, 'success', p_success)));
  exception when others then null;
  end;
end $$;
revoke all on function public._ai_audit(uuid, text, uuid, jsonb, jsonb, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reads
-- ---------------------------------------------------------------------------
-- Fuzzy, owner-scoped listing search for natural-language resolution. Never sees another
-- seller's rows; ranking is deliberately simple: exact title 3, title substring 2,
-- taxonomy name/synonym overlap 1.
create or replace function public.ai_find_my_listings(p_query text)
returns table (
  id uuid, title text, status text, listing_type text,
  price_cents int, unit text, quantity text, expires_at timestamptz, score int)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  q   text := lower(btrim(coalesce(p_query, '')));
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if q = '' or length(q) > 80 then raise exception 'BAD_QUERY'; end if;

  return query
  select l.id, l.title, l.status::text, l.listing_type::text,
         l.price_cents, l.unit, l.quantity, l.expires_at,
         (case when lower(btrim(l.title)) = q then 3
               when lower(l.title) like '%' || q || '%' or q like '%' || lower(btrim(l.title)) || '%' then 2
               when tn.id is not null and (
                    lower(tn.name) = q or lower(tn.name) like '%' || q || '%'
                    or exists (select 1 from unnest(coalesce(tn.search_synonyms, '{}')) s
                                where lower(s) = q or lower(s) like '%' || q || '%' or q like '%' || lower(s) || '%'))
                 then 1
               else 0 end)::int as score
    from public.listings l
    left join public.marketplace_taxonomy_nodes tn on tn.id = l.taxonomy_node_id
   where l.owner_id = uid
     and l.status in ('active', 'completed', 'expired', 'paused')
     and (lower(l.title) like '%' || q || '%'
          or q like '%' || lower(btrim(l.title)) || '%'
          or (tn.id is not null and (
               lower(tn.name) like '%' || q || '%'
               or exists (select 1 from unnest(coalesce(tn.search_synonyms, '{}')) s
                           where lower(s) like '%' || q || '%' or q like '%' || lower(s) || '%'))))
   order by 9 desc, l.created_at desc
   limit 10;
end $$;

-- Grouped inventory: everything the seller currently holds, one row per listing.
create or replace function public.ai_my_inventory()
returns table (id uuid, title text, status text, listing_type text,
               price_cents int, unit text, quantity text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  return query
  select l.id, l.title, l.status::text, l.listing_type::text,
         l.price_cents, l.unit, l.quantity, l.expires_at
    from public.listings l
   where l.owner_id = uid and l.status in ('active', 'completed', 'expired', 'paused')
   order by case l.status when 'active' then 0 when 'expired' then 1 when 'completed' then 2 else 3 end,
            l.expires_at nulls last
   limit 100;
end $$;

create or replace function public.ai_my_expiring(p_within_days int default 2)
returns table (id uuid, title text, expires_at timestamptz, listing_type text)
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_within_days is null or p_within_days < 0 or p_within_days > 30 then
    raise exception 'BAD_WINDOW';
  end if;
  return query
  select l.id, l.title, l.expires_at, l.listing_type::text
    from public.listings l
   where l.owner_id = uid and l.status = 'active'
     and l.expires_at <= now() + make_interval(days => p_within_days)
   order by l.expires_at
   limit 50;
end $$;

-- Seller-owned pending drafts (the Build My Market continuity read).
create or replace function public.ai_my_drafts(p_missing_price boolean default false)
returns table (id uuid, title text, price_cents int, unit text, source text, listing_type text)
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  return query
  select d.id, d.title, d.price_cents, d.unit, d.source, d.listing_type::text
    from public.listing_drafts d
   where d.owner_id = uid and d.status = 'pending'
     and (not coalesce(p_missing_price, false)
          or (d.listing_type = 'sale' and d.price_cents is null))
   order by d.created_at desc
   limit 100;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Low-risk single-listing writes (direct execution; explicit + unambiguous)
-- ---------------------------------------------------------------------------
create or replace function public.ai_set_price(
  p_listing uuid, p_price_cents int, p_unit text default null, p_request text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  l public.listings;
  allowed_units constant text[] := array[
    'lb','oz','each','bunch','dozen','half-dozen','jar','basket','pint','quart',
    'bag','loaf','head','ear','peck','half-peck','bushel','half-bushel','flat','stem'];
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into l from public.listings where id = p_listing and owner_id = uid for update;
  if l.id is null then raise exception 'LISTING_NOT_FOUND'; end if;
  if l.status = 'removed' then raise exception 'LISTING_UNAVAILABLE'; end if;
  if l.listing_type <> 'sale' then raise exception 'NOT_A_SALE_LISTING'; end if;
  if p_price_cents is null or p_price_cents < 1 or p_price_cents > 100000 then
    raise exception 'INVALID_PRICE';
  end if;
  if p_unit is not null and not (lower(btrim(p_unit)) = any (allowed_units)) then
    raise exception 'INVALID_UNIT';
  end if;

  update public.listings
     set price_cents = p_price_cents,
         unit = coalesce(lower(btrim(p_unit)), unit)
   where id = l.id;

  perform public._ai_audit(uid, 'set_price', l.id,
    jsonb_build_object('price_cents', l.price_cents, 'unit', l.unit),
    jsonb_build_object('price_cents', p_price_cents, 'unit', coalesce(lower(btrim(p_unit)), l.unit)),
    p_request, true);

  return jsonb_build_object('ok', true, 'id', l.id, 'title', l.title,
    'price_cents', p_price_cents, 'unit', coalesce(lower(btrim(p_unit)), l.unit));
end $$;

create or replace function public.ai_set_quantity(
  p_listing uuid, p_quantity text, p_request text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  l public.listings;
  q text := nullif(btrim(coalesce(p_quantity, '')), '');
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into l from public.listings where id = p_listing and owner_id = uid for update;
  if l.id is null then raise exception 'LISTING_NOT_FOUND'; end if;
  if l.status = 'removed' then raise exception 'LISTING_UNAVAILABLE'; end if;
  if q is null or length(q) > 60 then raise exception 'INVALID_QUANTITY'; end if;

  update public.listings set quantity = q where id = l.id;

  perform public._ai_audit(uid, 'set_quantity', l.id,
    jsonb_build_object('quantity', l.quantity), jsonb_build_object('quantity', q),
    p_request, true);

  return jsonb_build_object('ok', true, 'id', l.id, 'title', l.title, 'quantity', q);
end $$;

-- Sold out / "hide it": Gnome's canonical state is 'completed' — the same transition the
-- seller's own Mark sold button makes. History preserved, nothing deleted, no allowance.
create or replace function public.ai_mark_sold(p_listing uuid, p_request text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  l public.listings;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into l from public.listings where id = p_listing and owner_id = uid for update;
  if l.id is null then raise exception 'LISTING_NOT_FOUND'; end if;
  if l.status = 'completed' then
    return jsonb_build_object('ok', true, 'id', l.id, 'title', l.title, 'already', true);
  end if;
  if l.status <> 'active' then raise exception 'LISTING_NOT_ACTIVE'; end if;

  update public.listings set status = 'completed' where id = l.id;

  perform public._ai_audit(uid, 'mark_sold', l.id,
    jsonb_build_object('status', l.status::text), jsonb_build_object('status', 'completed'),
    p_request, true);

  return jsonb_build_object('ok', true, 'id', l.id, 'title', l.title, 'status', 'completed');
end $$;

-- Simple field edits on the seller's own PENDING drafts (never publishes).
create or replace function public.ai_update_draft(
  p_draft uuid, p_price_cents int default null, p_unit text default null,
  p_quantity text default null, p_request text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  d public.listing_drafts;
  allowed_units constant text[] := array[
    'lb','oz','each','bunch','dozen','half-dozen','jar','basket','pint','quart',
    'bag','loaf','head','ear','peck','half-peck','bushel','half-bushel','flat','stem'];
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into d from public.listing_drafts where id = p_draft and owner_id = uid for update;
  if d.id is null then raise exception 'DRAFT_NOT_FOUND'; end if;
  if d.status <> 'pending' then raise exception 'DRAFT_NOT_PENDING'; end if;
  if p_price_cents is not null and (p_price_cents < 1 or p_price_cents > 100000) then
    raise exception 'INVALID_PRICE';
  end if;
  if p_unit is not null and not (lower(btrim(p_unit)) = any (allowed_units)) then
    raise exception 'INVALID_UNIT';
  end if;
  if p_quantity is not null and length(btrim(p_quantity)) > 60 then
    raise exception 'INVALID_QUANTITY';
  end if;

  update public.listing_drafts
     set price_cents = coalesce(p_price_cents, price_cents),
         unit = coalesce(lower(btrim(p_unit)), unit),
         quantity = coalesce(nullif(btrim(p_quantity), ''), quantity),
         updated_at = now()
   where id = d.id;

  perform public._ai_audit(uid, 'update_draft', null,
    jsonb_build_object('draft_id', d.id, 'price_cents', d.price_cents, 'unit', d.unit, 'quantity', d.quantity),
    jsonb_strip_nulls(jsonb_build_object('draft_id', d.id, 'price_cents', p_price_cents,
      'unit', lower(btrim(p_unit)), 'quantity', nullif(btrim(p_quantity), ''))),
    p_request, true);

  return jsonb_build_object('ok', true, 'id', d.id, 'title', d.title,
    'price_cents', coalesce(p_price_cents, d.price_cents),
    'unit', coalesce(lower(btrim(p_unit)), d.unit));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Server-bound proposal + confirmation for renewal-class and bulk actions
-- ---------------------------------------------------------------------------
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
  if p_action is null or p_action not in ('renew', 'restock', 'mark_sold_bulk', 'set_price_bulk') then
    raise exception 'BAD_ACTION';
  end if;
  n := coalesce(array_length(p_listing_ids, 1), 0);
  if n = 0 then raise exception 'NO_LISTINGS'; end if;
  if n > 20 then raise exception 'BULK_LIMIT' using hint = format('%s > 20', n); end if;

  -- Payload is a strict field bag: only the keys the executor understands.
  if p_payload is not null then
    for k in select jsonb_object_keys(p_payload) loop
      if k not in ('price_cents', 'unit') then
        raise exception 'UNKNOWN_FIELD' using hint = k;
      end if;
    end loop;
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

-- Execution happens ONLY here, on a separate authenticated call the seller's tap makes.
create or replace function public.ai_confirm_action(p_action_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  a public.ai_pending_actions;
  lid uuid;
  results jsonb := '[]'::jsonb;
  r record;
  ok_count int := 0;
  payment_needed int := 0;
  err text;
  v_price int;
  v_unit text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  -- Row-lock the action: two simultaneous confirms serialize here, and the second sees
  -- status <> 'pending'.
  select * into a from public.ai_pending_actions
   where id = p_action_id and owner_id = uid for update;
  if a.id is null then raise exception 'ACTION_NOT_FOUND'; end if;
  if a.status <> 'pending' then raise exception 'ACTION_ALREADY_%', a.status; end if;
  if a.expires_at <= now() then
    update public.ai_pending_actions set status = 'expired' where id = a.id;
    raise exception 'ACTION_EXPIRED';
  end if;

  foreach lid in array a.listing_ids loop
    begin
      if a.action in ('renew', 'restock') then
        -- The canonical path. renew_listing rechecks ownership itself, restarts the plan
        -- lifetime, and the 0104 trigger decides included / paid / refuse. Nothing here can
        -- manufacture a free renewal.
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

create or replace function public.ai_cancel_action(p_action_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  update public.ai_pending_actions
     set status = 'cancelled'
   where id = p_action_id and owner_id = uid and status = 'pending';
  if not found then raise exception 'ACTION_NOT_FOUND'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Grants: sellers only; anon gets nothing; PUBLIC default stripped (the 0106 lesson)
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.ai_find_my_listings(text)',
    'public.ai_my_inventory()',
    'public.ai_my_expiring(int)',
    'public.ai_my_drafts(boolean)',
    'public.ai_set_price(uuid,int,text,text)',
    'public.ai_set_quantity(uuid,text,text)',
    'public.ai_mark_sold(uuid,text)',
    'public.ai_update_draft(uuid,int,text,text,text)',
    'public.ai_propose_action(text,uuid[],jsonb,text,text)',
    'public.ai_confirm_action(uuid)',
    'public.ai_cancel_action(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- Self-check in the 0107/0113 style: fail the apply loudly if exposure came out wrong.
do $$
begin
  if has_function_privilege('anon', 'public.ai_set_price(uuid,int,text,text)', 'execute')
     or has_function_privilege('anon', 'public.ai_confirm_action(uuid)', 'execute') then
    raise exception '0116: anon can execute AI action functions';
  end if;
  if not has_function_privilege('authenticated', 'public.ai_find_my_listings(text)', 'execute') then
    raise exception '0116: authenticated lost execute on the AI action layer';
  end if;
end $$;

notify pgrst, 'reload schema';
