-- 0121: Gift Baskets / Bundles V1 — a bundle IS a listing (CTO-ruled).
--
-- Rulings implemented here, verbatim from the CTO gate:
--   1. A bundle is an ordinary 'sale' listing (is_bundle = true) plus a
--      components table. Publishing it consumes exactly ONE Sell publish via
--      the untouched 0104 machinery; components consume nothing again;
--      renewal follows normal rules. listing_type_spends_allowance() is NOT
--      modified.
--   2. NO component inventory depletion: basket inventory is seller-assembled
--      ("how many complete baskets do you have ready"). Selling a basket
--      decrements only the basket row — the existing order/notebook RPCs
--      already do exactly that for any listing.
--   3. DERIVED availability, no stored flips, no auto-renewal: a bundle is
--      publicly available only while EVERY component is canonically publicly
--      available (active, unexpired, market active). Enforced in the
--      canonical view for every public surface AND at the transaction entry
--      points (claims, market orders), so a stale client can render whatever
--      it likes — the server refuses to sell an unavailable basket.
--   * Bundle ≠ Drop: no drop changes at all; a bundle joins a Drop as a
--     normal listing and the drop's available_items already counts against
--     the canonical view.
--   * No recursion: a bundle can never be a component; enforced by trigger.
--   * No foreign composition: every component must be the same owner+market;
--     enforced in the canonical creator.
--   * No compliance laundering: the bundle's own text is screened by the
--     existing trigger (fires on this insert like any other), and a screened/
--     held/expired component removes the bundle from public availability via
--     the derived gate.

-- ---------------------------------------------------------------------------
-- 1. The marker column. listings uses per-COLUMN grants (0104 header trap):
--    the grant MUST land in the same migration or every select list breaks.
-- ---------------------------------------------------------------------------
alter table public.listings
  add column if not exists is_bundle boolean not null default false;
grant select (is_bundle) on public.listings to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Components — modeled on market_drop_items (0117)
-- ---------------------------------------------------------------------------
create table if not exists public.listing_components (
  listing_id           uuid not null references public.listings (id) on delete cascade,
  component_listing_id uuid not null references public.listings (id) on delete cascade,
  position             int  not null default 0,
  primary key (listing_id, component_listing_id)
);
create index if not exists listing_components_component_idx
  on public.listing_components (component_listing_id);

-- Guard rails at the row level (defense in depth under the RPC):
--   * parent must be a bundle; component must NOT be one (no recursion);
--   * no self-composition; bounded basket size.
create or replace function public.listing_components_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent_bundle boolean;
  comp_bundle boolean;
  n int;
begin
  if new.listing_id = new.component_listing_id then
    raise exception 'BUNDLE_SELF_REFERENCE';
  end if;
  select is_bundle into parent_bundle from public.listings where id = new.listing_id;
  select is_bundle into comp_bundle   from public.listings where id = new.component_listing_id;
  if not coalesce(parent_bundle, false) then
    raise exception 'NOT_A_BUNDLE';
  end if;
  if coalesce(comp_bundle, false) then
    raise exception 'BUNDLE_RECURSION';
  end if;
  select count(*) into n from public.listing_components where listing_id = new.listing_id;
  if n >= 12 then
    raise exception 'BUNDLE_ITEM_LIMIT';
  end if;
  return new;
end $$;

drop trigger if exists listing_components_guard_trg on public.listing_components;
create trigger listing_components_guard_trg
  before insert on public.listing_components
  for each row execute function public.listing_components_guard();

alter table public.listing_components enable row level security;
-- Buyers may see what's inside a PUBLICLY visible bundle; owners always see
-- their own composition. All writes go through the canonical creator RPC.
drop policy if exists listing_components_select on public.listing_components;
create policy listing_components_select on public.listing_components
  for select using (
    exists (select 1 from public.listings l
             where l.id = listing_id and l.owner_id = auth.uid())
    or exists (select 1 from public.public_listings pl where pl.id = listing_id)
  );
grant select on public.listing_components to anon, authenticated;
revoke insert, update, delete on public.listing_components from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Derived availability, shared by the view and the transaction guards.
--    "Available" for a component means the same canonical conditions the
--    public view applies: active, unexpired, market active.
-- ---------------------------------------------------------------------------
create or replace function public.bundle_components_available(p_listing uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1
      from public.listing_components c
      left join public.listings cl on cl.id = c.component_listing_id
      left join public.markets  cm on cm.id = cl.market_id
     where c.listing_id = p_listing
       and (cl.id is null
            or cl.status <> 'active'
            or cl.expires_at <= now()
            or cm.status <> 'active')
  )
  and exists (select 1 from public.listing_components c where c.listing_id = p_listing);
$$;
grant execute on function public.bundle_components_available(uuid) to anon, authenticated;

-- Canonical public view: identical to 0088 plus (a) the bundle availability
-- predicate in WHERE and (b) two APPENDED columns (is_bundle,
-- component_count) — create-or-replace only permits appending.
create or replace view public.public_listings as
 SELECT l.id, l.slug, l.title, l.description, l.category, l.listing_type, l.status,
    l.price_cents, l.currency, l.trade_for, l.quantity, l.unit, l.photos, l.city,
    l.county, l.state, l.fulfillment_type, l.market_id,
    m.name AS market_name, m.slug AS market_slug, m.avatar_url AS market_avatar_url,
    m.market_type, m.verified AS market_verified, l.created_at, l.expires_at,
    l.is_featured, l.featured_until,
    (EXISTS ( SELECT 1 FROM listing_promotions p
              WHERE p.listing_id = l.id AND p.status = 'active'::promotion_status AND p.ends_at > now())) AS has_active_promotion,
    l.approx_lat, l.approx_lng, l.is_demo, l.market_position, l.market_featured,
    l.taxonomy_node_id, l.inventory_count,
    l.request_options, l.allow_custom_request,
    l.is_bundle,
    (SELECT count(*)::int FROM listing_components c WHERE c.listing_id = l.id) AS component_count
   FROM listings l
     JOIN markets m ON m.id = l.market_id
  WHERE l.status = 'active'::listing_status AND l.expires_at > now() AND m.status = 'active'::market_status
    AND (NOT l.is_bundle OR public.bundle_components_available(l.id));

grant select on public.public_listings to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Transaction guards: the server refuses to sell an unavailable basket
--    even to a stale client. Claims get a trigger; market orders get the
--    same check inside their line-validation loop.
-- ---------------------------------------------------------------------------
create or replace function public.claims_bundle_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare bundled boolean;
begin
  select is_bundle into bundled from public.listings where id = new.listing_id;
  if coalesce(bundled, false) and not public.bundle_components_available(new.listing_id) then
    raise exception 'BUNDLE_UNAVAILABLE';
  end if;
  return new;
end $$;

drop trigger if exists claims_bundle_guard_trg on public.claims;
create trigger claims_bundle_guard_trg
  before insert on public.claims
  for each row execute function public.claims_bundle_guard();

-- create_market_order: the CURRENT definition (0071 — pickup locations +
-- delivery) with exactly two additions: is_bundle in the per-line select and
-- the bundle-availability guard after the active check. Everything else is
-- byte-identical to 0071.
create or replace function public.create_market_order(
  p_market uuid,
  p_items jsonb,
  p_start timestamptz,
  p_end timestamptz,
  p_note text default null,
  p_location uuid default null,
  p_fulfillment text default 'pickup',
  p_address uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_buyer uuid := auth.uid();
  loc public.market_pickup_locations;
  addr public.buyer_delivery_addresses;
  q record; ds public.market_delivery_settings;
  v_order uuid; item jsonb; l record;
  v_qty numeric; v_subtotal int := 0; v_line int; v_ok boolean := false;
  v_ids uuid[];
  v_tz text;
begin
  if v_buyer is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  if p_fulfillment not in ('pickup','delivery') then
    raise exception 'BAD_FULFILLMENT' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.markets m where m.id = p_market and m.owner_id = v_buyer) then
    raise exception 'OWN_MARKET: you cannot order from your own Market' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = 'P0001';
  end if;

  select array_agg((value->>'listing_id')::uuid) into v_ids
    from jsonb_array_elements(p_items);

  if p_fulfillment = 'pickup' then
    if p_location is null then
      select id into p_location from public.market_pickup_locations
       where market_id = p_market and is_default and active and not plan_restricted;
    end if;
    if p_location is null then raise exception 'PICKUP_NOT_CONFIGURED' using errcode = 'P0001'; end if;

    if not exists (select 1 from public.cart_pickup_locations(p_market, v_ids) c
                    where c.location_id = p_location) then
      raise exception 'NO_COMMON_PICKUP_LOCATION: these items aren''t available for pickup at the same location'
        using errcode = 'P0001';
    end if;

    select * into loc from public.market_pickup_locations where id = p_location;

    select true into v_ok from public.location_available_slots(p_location, 21) a
     where a.slot_start = p_start and a.slot_end = p_end limit 1;
    if not coalesce(v_ok, false) then
      raise exception 'SLOT_UNAVAILABLE: pick one of the offered pickup times' using errcode = 'P0001';
    end if;

    insert into public.market_orders
      (market_id, buyer_id, requested_start, requested_end, timezone, buyer_note,
       pickup_location_id, pickup_location_name, pickup_location_type, fulfillment_type)
    values (p_market, v_buyer, p_start, p_end, loc.timezone,
            nullif(btrim(coalesce(p_note,'')), ''),
            loc.id, loc.nickname, loc.location_type, 'pickup')
    returning id into v_order;

  else -- delivery
    if p_address is null then raise exception 'ADDRESS_REQUIRED' using errcode = 'P0001'; end if;
    select * into addr from public.buyer_delivery_addresses
     where id = p_address and buyer_id = v_buyer;
    if addr is null then raise exception 'ADDRESS_NOT_FOUND' using errcode = 'P0001'; end if;

    -- Authoritative quote (never the client's math).
    select * into q from public.delivery_quote(p_market, p_address);
    if not q.eligible then
      raise exception 'DELIVERY_INELIGIBLE: %', coalesce(q.reason, 'not available') using errcode = 'P0001';
    end if;

    select * into ds from public.market_delivery_settings where market_id = p_market;
    v_tz := coalesce(ds.tz, 'America/New_York');

    -- Requested-window validation against the seller's timing rules.
    -- No timing mode enabled → any future window; exact day is arranged in
    -- the existing propose/confirm negotiation, like pickup.
    if p_start is null or p_end is null or p_end <= p_start then
      raise exception 'BAD_WINDOW' using errcode = 'P0001';
    end if;
    if (p_start at time zone v_tz)::date = (now() at time zone v_tz)::date then
      -- same-day request
      if not ds.same_day then
        raise exception 'SAME_DAY_UNAVAILABLE: this Market does not offer same-day delivery' using errcode = 'P0001';
      end if;
      if ds.same_day_cutoff is not null and (now() at time zone v_tz)::time > ds.same_day_cutoff then
        raise exception 'CUTOFF_PASSED: same-day orders close at %', to_char(ds.same_day_cutoff, 'HH12:MI AM') using errcode = 'P0001';
      end if;
    elsif (p_start at time zone v_tz)::date = (now() at time zone v_tz)::date + 1 then
      -- next-day request (also satisfied by a weekly schedule that covers it —
      -- but the schedule's order-by deadline applies either way)
      if ds.scheduled and extract(dow from p_start at time zone v_tz)::int = any(ds.delivery_dows) then
        if ds.order_by_dow is not null
           and (now() at time zone v_tz)::date >
               ((p_start at time zone v_tz)::date
                 - ((7 + extract(dow from p_start at time zone v_tz)::int - ds.order_by_dow) % 7))
           and not ds.next_day then
          raise exception 'ORDER_BY_PASSED: order by % for that delivery day',
            trim(to_char(((p_start at time zone v_tz)::date - ((7 + extract(dow from p_start at time zone v_tz)::int - ds.order_by_dow) % 7)), 'Day')) using errcode = 'P0001';
        end if;
      elsif not ds.next_day then
        raise exception 'NEXT_DAY_UNAVAILABLE: this Market does not offer next-day delivery' using errcode = 'P0001';
      end if;
      if ds.next_day and ds.next_day_cutoff is not null
         and not (ds.scheduled and extract(dow from p_start at time zone v_tz)::int = any(ds.delivery_dows))
         and (now() at time zone v_tz)::time > ds.next_day_cutoff then
        raise exception 'CUTOFF_PASSED: next-day orders close at %', to_char(ds.next_day_cutoff, 'HH12:MI AM') using errcode = 'P0001';
      end if;
    elsif ds.scheduled then
      if not (extract(dow from p_start at time zone v_tz)::int = any(ds.delivery_dows)) then
        raise exception 'NOT_A_DELIVERY_DAY: this Market delivers on scheduled days only' using errcode = 'P0001';
      end if;
      if ds.order_by_dow is not null then
        -- order-by day must not already be past in the current week window
        if (now() at time zone v_tz)::date >
           ((p_start at time zone v_tz)::date
             - ((7 + extract(dow from p_start at time zone v_tz)::int - ds.order_by_dow) % 7)) then
          raise exception 'ORDER_BY_PASSED: order by % for that delivery day',
            trim(to_char(((p_start at time zone v_tz)::date - ((7 + extract(dow from p_start at time zone v_tz)::int - ds.order_by_dow) % 7)), 'Day')) using errcode = 'P0001';
        end if;
      end if;
    elsif ds.same_day or ds.next_day then
      -- same/next-day-only Market: a window 2+ days out has no valid mode
      raise exception 'NOT_A_DELIVERY_DAY: this Market offers same-day or next-day delivery only' using errcode = 'P0001';
    end if;
    if p_start < now() then
      raise exception 'BAD_WINDOW: that time is in the past' using errcode = 'P0001';
    end if;

    -- Item-level compliance: active pickup-only rules refuse delivery.
    if exists (
      select 1 from jsonb_array_elements(p_items) x
      join public.listings li on li.id = (x->>'listing_id')::uuid
      where li.taxonomy_node_id is not null
        and not public.delivery_allowed_for_node(li.taxonomy_node_id)
    ) then
      raise exception 'DELIVERY_RESTRICTED: an item in this order is pickup-only' using errcode = 'P0001';
    end if;

    insert into public.market_orders
      (market_id, buyer_id, requested_start, requested_end, timezone, buyer_note,
       fulfillment_type, delivery_address_id,
       delivery_address, delivery_city, delivery_state, delivery_postal_code, delivery_notes,
       delivery_distance_miles, delivery_base_fee_cents, delivery_surcharge_cents,
       delivery_fee_cents, delivery_rule)
    values (p_market, v_buyer, p_start, p_end, v_tz,
            nullif(btrim(coalesce(p_note,'')), ''),
            'delivery', addr.id,
            addr.address_line, addr.city, addr.state, addr.postal_code, addr.delivery_notes,
            q.distance_miles, q.base_fee_cents, q.surcharge_cents, q.total_fee_cents, q.rule)
    returning id into v_order;
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((item->>'quantity')::numeric, 1);
    if v_qty <= 0 then raise exception 'BAD_QUANTITY' using errcode = 'P0001'; end if;
    select id, title, unit, price_cents, market_id, status, taxonomy_node_id, is_bundle
      into l from public.listings where id = (item->>'listing_id')::uuid;
    if l is null or l.market_id is distinct from p_market then
      raise exception 'ITEM_NOT_IN_MARKET' using errcode = 'P0001';
    end if;
    if l.status <> 'active' then
      raise exception 'ITEM_UNAVAILABLE: %', l.title using errcode = 'P0001';
    end if;
    -- 0121: an unavailable basket cannot be ordered no matter what a stale
    -- client rendered — canonical component availability decides.
    if l.is_bundle and not public.bundle_components_available(l.id) then
      raise exception 'BUNDLE_UNAVAILABLE: %', l.title using errcode = 'P0001';
    end if;
    v_line := coalesce(l.price_cents, 0) * v_qty;
    v_subtotal := v_subtotal + v_line;
    insert into public.market_order_items
      (order_id, listing_id, title, unit, quantity, unit_price_cents, item_total_cents, taxonomy_node_id)
    values (v_order, l.id, l.title, l.unit, v_qty, coalesce(l.price_cents, 0), v_line, l.taxonomy_node_id);
  end loop;

  update public.market_orders set subtotal_cents = v_subtotal, updated_at = now()
   where id = v_order;
  return v_order;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The canonical creator — seller UI and the AI executor both call this
-- ---------------------------------------------------------------------------
create or replace function public.create_market_bundle(
  p_title text,
  p_price_cents int,
  p_component_ids uuid[],
  p_description text default null,
  p_unit text default null,
  p_inventory int default null,
  p_request text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  mkt uuid;
  n int;
  owned int;
  new_id uuid;
  lifetime int;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select id into mkt from public.markets where owner_id = uid limit 1;
  if mkt is null then raise exception 'NO_MARKET'; end if;

  if p_title is null or length(btrim(p_title)) < 1 or length(btrim(p_title)) > 80 then
    raise exception 'INVALID_TITLE';
  end if;
  if p_description is not null and length(p_description) > 600 then
    raise exception 'INVALID_DESCRIPTION';
  end if;
  if p_price_cents is null or p_price_cents < 1 or p_price_cents > 100000 then
    raise exception 'INVALID_PRICE';
  end if;
  if p_inventory is not null and (p_inventory < 1 or p_inventory > 999) then
    raise exception 'INVALID_INVENTORY';
  end if;

  n := coalesce(array_length(p_component_ids, 1), 0);
  if n < 2 then raise exception 'BUNDLE_NEEDS_ITEMS'; end if;
  if n > 12 then raise exception 'BUNDLE_ITEM_LIMIT'; end if;
  if n <> (select count(distinct x) from unnest(p_component_ids) x) then
    raise exception 'BUNDLE_DUPLICATE_COMPONENT';
  end if;

  -- Same owner, same market, currently active, and never another bundle.
  select count(*)::int into owned
    from public.listings l
   where l.id = any (p_component_ids)
     and l.owner_id = uid
     and l.market_id = mkt
     and l.status = 'active'
     and l.expires_at > now()
     and not l.is_bundle;
  if owned <> n then raise exception 'COMPONENT_NOT_AVAILABLE'; end if;

  -- The plan's Sell lifetime (7 days), same as every publish path.
  select coalesce(pl.listing_lifetime_days, 7) into lifetime
    from public.market_effective_plan(mkt) ep
    join public.plan_limits pl on pl.plan = ep.plan;

  -- This insert IS a Sell publication: enforce_publish_allowance and the
  -- content screening trigger both fire exactly as they do for any listing.
  -- PUBLISH_ALLOWANCE_EXHAUSTED propagates to the caller, where the existing
  -- $0.99 / upgrade paths take over. The AI gets no exception (CTO ruling).
  insert into public.listings
    (owner_id, market_id, title, description, category, listing_type, kind,
     price_cents, unit, inventory_count, quantity, status, expires_at, is_bundle)
  values
    (uid, mkt, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
     'basket', 'sale', 'offer', p_price_cents, nullif(btrim(coalesce(p_unit, '')), ''),
     p_inventory, case when p_inventory is not null
                       then p_inventory || ' basket' || case when p_inventory = 1 then '' else 's' end
                       else null end,
     'active', now() + make_interval(days => lifetime), true)
  returning id into new_id;

  insert into public.listing_components (listing_id, component_listing_id, position)
  select new_id, x.listing_id, x.ord - 1
    from (select distinct on (u.listing_id) u.listing_id, u.ord
            from unnest(p_component_ids) with ordinality as u(listing_id, ord)
           order by u.listing_id, u.ord) x;

  begin
    insert into public.events (user_id, event_type, metadata)
    values (uid, 'bundle_created',
            jsonb_strip_nulls(jsonb_build_object(
              'listing_id', new_id, 'market_id', mkt, 'items', n,
              'price_cents', p_price_cents, 'request_id', p_request)));
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'id', new_id, 'title', btrim(p_title),
                            'items', n, 'price_cents', p_price_cents);
end $$;

revoke execute on function public.create_market_bundle(text, int, uuid[], text, text, int, text) from public, anon;
grant execute on function public.create_market_bundle(text, int, uuid[], text, text, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. AI: widen the persisted proposal/confirm layer with 'create_bundle'
-- ---------------------------------------------------------------------------
alter table public.ai_pending_actions drop constraint if exists ai_pending_actions_action_check;
alter table public.ai_pending_actions
  add constraint ai_pending_actions_action_check
  check (action in ('renew', 'restock', 'mark_sold_bulk', 'set_price_bulk', 'create_drop', 'create_bundle'));

-- ai_propose_action: accept the new action. The payload whitelist already
-- covers title/description/price_cents/unit; create_bundle requires
-- title + price_cents at proposal time.
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
  if p_action is null or p_action not in ('renew', 'restock', 'mark_sold_bulk', 'set_price_bulk', 'create_drop', 'create_bundle') then
    raise exception 'BAD_ACTION';
  end if;
  n := coalesce(array_length(p_listing_ids, 1), 0);
  if n = 0 then raise exception 'NO_LISTINGS'; end if;
  if n > 20 then raise exception 'BULK_LIMIT' using hint = format('%s > 20', n); end if;

  select count(distinct l.id)::int into owned from public.listings l
   where l.id = any (p_listing_ids) and l.owner_id = uid and l.status <> 'removed';
  if owned <> (select count(distinct x) from unnest(p_listing_ids) x) then
    raise exception 'LISTING_NOT_FOUND';
  end if;

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
    perform (p_payload ->> 'starts_at')::timestamptz, (p_payload ->> 'ends_at')::timestamptz;
  end if;
  if p_action = 'create_bundle' then
    if p_payload ->> 'title' is null then raise exception 'MISSING_FIELD' using hint = 'title'; end if;
    if (p_payload ->> 'price_cents') is null then raise exception 'MISSING_FIELD' using hint = 'price_cents'; end if;
    perform (p_payload ->> 'price_cents')::int;
  end if;

  insert into public.ai_pending_actions (owner_id, action, listing_ids, payload, summary, request_id)
  values (uid, p_action, p_listing_ids, coalesce(p_payload, '{}'::jsonb),
          left(coalesce(p_summary, p_action), 300), p_request)
  returning id into act_id;

  return jsonb_build_object('action_id', act_id, 'expires_in_minutes', 15);
end $$;

-- ai_confirm_action: the CURRENT definition (0117) plus ONE atomic
-- create_bundle branch mirroring create_drop. The per-listing loop, audit
-- signature, and result shapes are byte-identical to 0117.
create or replace function public.ai_confirm_action(p_action_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  a public.ai_pending_actions;
  lid uuid;
  results jsonb := '[]'::jsonb;
  r record;
  drop_result jsonb;
  bundle_result jsonb;
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

  -- create_bundle mirrors create_drop: one atomic creation through the
  -- canonical RPC, which rechecks ownership, composition, and pricing itself.
  -- PUBLISH_ALLOWANCE_EXHAUSTED propagates: the AI gets no allowance exception.
  if a.action = 'create_bundle' then
    begin
      bundle_result := public.create_market_bundle(
        a.payload ->> 'title',
        (a.payload ->> 'price_cents')::int,
        a.listing_ids,
        a.payload ->> 'description',
        a.payload ->> 'unit',
        null,
        a.request_id);
    exception when others then
      err := sqlerrm;
      if position('PUBLISH_ALLOWANCE_EXHAUSTED' in err) > 0 then
        perform public._ai_audit(uid, 'create_bundle', null, null,
          jsonb_build_object('refused', 'PAYMENT_REQUIRED'), a.request_id, false);
        update public.ai_pending_actions
           set status = 'executed', executed_at = now(),
               result = jsonb_build_object('ok_count', 0, 'payment_needed', 1)
         where id = a.id;
        return jsonb_build_object('ok', true, 'action', a.action,
          'ok_count', 0, 'payment_needed', 1, 'results', '[]'::jsonb);
      end if;
      raise;
    end;
    perform public._ai_audit(uid, 'create_bundle', null, null,
      jsonb_build_object('listing_id', bundle_result ->> 'id', 'items', bundle_result -> 'items'),
      a.request_id, true);
    update public.ai_pending_actions
       set status = 'executed', executed_at = now(),
           result = jsonb_build_object('ok_count', 1, 'payment_needed', 0, 'bundle', bundle_result)
     where id = a.id;
    return jsonb_build_object('ok', true, 'action', a.action,
      'ok_count', 1, 'payment_needed', 0, 'bundle', bundle_result, 'results', '[]'::jsonb);
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
-- 7. Self-checks
-- ---------------------------------------------------------------------------
do $$
declare ok boolean;
begin
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'listings'
                    and column_name = 'is_bundle') into ok;
  if not ok then raise exception '0121 self-check: is_bundle column missing'; end if;

  if not has_column_privilege('anon', 'public.listings', 'is_bundle', 'select') then
    raise exception '0121 self-check: is_bundle not granted (0104 trap)';
  end if;

  select exists (select 1 from information_schema.views
                  where table_schema = 'public' and table_name = 'public_listings') into ok;
  if not ok then raise exception '0121 self-check: public_listings view missing'; end if;

  if has_table_privilege('authenticated', 'public.listing_components', 'insert') then
    raise exception '0121 self-check: listing_components writable by clients';
  end if;
end $$;

notify pgrst, 'reload schema';
