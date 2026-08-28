-- 0048: Market operating tools — payment handles, pickup availability, and
-- multi-item pickup orders. All additive; the existing claim/request/chat flow
-- is untouched (quick single-item requests keep using claims; Market pickup
-- orders are a parallel, richer path).
--
-- Design decisions (documented per the round directive):
--  * Cart is client-side: no DRAFT status; an order is born REQUESTED.
--  * Inventory: nothing is reserved at REQUESTED (slot capacity is the soft
--    guard); CONFIRM takes the authoritative, row-locked, never-negative
--    reservation; DECLINE/CANCEL restores exactly what was reserved
--    (per-item `reserved` flag); COMPLETE changes no inventory (already
--    reserved) and writes the ledger row with p_listing NULL so the existing
--    record_sale decrement can never double-count.
--  * Defaults: 30-minute slots, 120-minute lead time, unlimited per-slot
--    capacity unless the seller sets one.
--  * One time-proposal at a time (proposed_start/proposed_end on the order).
--  * All writes go through SECURITY DEFINER RPCs; the tables carry no
--    INSERT/UPDATE/DELETE grants for authenticated at all.

-- ---------------------------------------------------------------------------
-- A. Seller payment handles (seller-to-buyer routing; Gnome never touches money)
create table if not exists public.market_payment_methods (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  method text not null check (method in ('venmo','paypal','cashapp','zelle','cash','other')),
  enabled boolean not null default true,
  handle text,        -- venmo username / paypal.me name / $cashtag / zelle display id
  label text,         -- display label for 'other'
  instructions text,  -- free text ('other', or e.g. "Zelle to the number I text you")
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market_id, method)
);
create index if not exists mpm_market_idx on public.market_payment_methods(market_id);

alter table public.market_payment_methods enable row level security;
-- A handle the seller ENABLED is storefront signage (that's the point of it);
-- disabled rows are private drafts and stay invisible to everyone else.
create policy mpm_select_enabled_or_own on public.market_payment_methods
  for select to anon, authenticated
  using (enabled
         or exists (select 1 from public.markets m
                     where m.id = market_id and m.owner_id = auth.uid()));
create policy mpm_owner_write on public.market_payment_methods
  for all to authenticated
  using (exists (select 1 from public.markets m
                  where m.id = market_id and m.owner_id = auth.uid()))
  with check (exists (select 1 from public.markets m
                       where m.id = market_id and m.owner_id = auth.uid()));
grant select on public.market_payment_methods to anon, authenticated;
grant insert, update, delete on public.market_payment_methods to authenticated;

-- ---------------------------------------------------------------------------
-- B. Pickup availability. Public shape (hours, settings) is world-readable so
-- slot pickers work; the PRIVATE address/instructions live in their own
-- owner-only table and are released per-order through an RPC after CONFIRM.
create table if not exists public.market_pickup_settings (
  market_id uuid primary key references public.markets(id) on delete cascade,
  timezone text not null default 'America/New_York',
  slot_minutes int not null default 30 check (slot_minutes in (15, 30, 60)),
  lead_time_minutes int not null default 120 check (lead_time_minutes between 0 and 10080),
  max_orders_per_slot int check (max_orders_per_slot is null or max_orders_per_slot > 0),
  location_type text not null default 'PRIVATE_RESIDENCE'
    check (location_type in ('PRIVATE_RESIDENCE','PUBLIC_BUSINESS','CUSTOM_PICKUP_POINT')),
  -- Shown to the world ONLY when the seller opted into a public storefront.
  public_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.market_pickup_settings enable row level security;
create policy mps_select_all on public.market_pickup_settings
  for select to anon, authenticated using (true);
create policy mps_owner_write on public.market_pickup_settings
  for all to authenticated
  using (exists (select 1 from public.markets m where m.id = market_id and m.owner_id = auth.uid()))
  with check (exists (select 1 from public.markets m where m.id = market_id and m.owner_id = auth.uid()));
grant select on public.market_pickup_settings to anon, authenticated;
grant insert, update, delete on public.market_pickup_settings to authenticated;

-- Private-residence reality: the exact pickup address/instructions are OWNER
-- data until an order is confirmed, then released only to that buyer via RPC.
create table if not exists public.market_pickup_private (
  market_id uuid primary key references public.markets(id) on delete cascade,
  pickup_address text,
  pickup_instructions text,
  instructions_public boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.market_pickup_private enable row level security;
create policy mpp_owner_all on public.market_pickup_private
  for all to authenticated
  using (exists (select 1 from public.markets m where m.id = market_id and m.owner_id = auth.uid()))
  with check (exists (select 1 from public.markets m where m.id = market_id and m.owner_id = auth.uid()));
grant select, insert, update, delete on public.market_pickup_private to authenticated;

-- Recurring weekly windows; multiple windows per day are just multiple rows.
create table if not exists public.market_pickup_hours (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_minute int not null check (start_minute between 0 and 1439),
  end_minute int not null check (end_minute between 1 and 1440),
  check (start_minute < end_minute)
);
create index if not exists mph_market_idx on public.market_pickup_hours(market_id);
alter table public.market_pickup_hours enable row level security;
create policy mph_select_all on public.market_pickup_hours
  for select to anon, authenticated using (true);
create policy mph_owner_write on public.market_pickup_hours
  for all to authenticated
  using (exists (select 1 from public.markets m where m.id = market_id and m.owner_id = auth.uid()))
  with check (exists (select 1 from public.markets m where m.id = market_id and m.owner_id = auth.uid()));
grant select on public.market_pickup_hours to anon, authenticated;
grant insert, update, delete on public.market_pickup_hours to authenticated;

-- Date-specific overrides. closed=true = whole day off; closed=false rows are
-- custom windows and REPLACE the recurring hours for that date.
create table if not exists public.market_pickup_exceptions (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  date date not null,
  closed boolean not null default true,
  start_minute int check (start_minute between 0 and 1439),
  end_minute int check (end_minute between 1 and 1440),
  note text,
  check (closed or (start_minute is not null and end_minute is not null and start_minute < end_minute))
);
create index if not exists mpe_market_date_idx on public.market_pickup_exceptions(market_id, date);
alter table public.market_pickup_exceptions enable row level security;
create policy mpe_select_all on public.market_pickup_exceptions
  for select to anon, authenticated using (true);
create policy mpe_owner_write on public.market_pickup_exceptions
  for all to authenticated
  using (exists (select 1 from public.markets m where m.id = market_id and m.owner_id = auth.uid()))
  with check (exists (select 1 from public.markets m where m.id = market_id and m.owner_id = auth.uid()));
grant select on public.market_pickup_exceptions to anon, authenticated;
grant insert, update, delete on public.market_pickup_exceptions to authenticated;

-- ---------------------------------------------------------------------------
-- C/D. Orders
create type public.market_order_status as enum
  ('REQUESTED','CONFIRMED','TIME_PROPOSED','DECLINED','READY','COMPLETED','CANCELLED');

create table if not exists public.market_orders (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  status public.market_order_status not null default 'REQUESTED',
  requested_start timestamptz not null,
  requested_end timestamptz not null,
  confirmed_start timestamptz,
  confirmed_end timestamptz,
  proposed_start timestamptz,
  proposed_end timestamptz,
  timezone text not null,
  subtotal_cents int not null default 0,
  buyer_note text,
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mo_market_idx on public.market_orders(market_id, status);
create index if not exists mo_buyer_idx on public.market_orders(buyer_id, status);
create index if not exists mo_window_idx on public.market_orders(market_id, requested_start);

create table if not exists public.market_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.market_orders(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete set null,
  -- Snapshots: an order must stay legible even if the listing later changes.
  title text not null,
  unit text,
  quantity numeric not null check (quantity > 0),
  unit_price_cents int not null default 0,
  item_total_cents int not null default 0,
  taxonomy_node_id uuid references public.marketplace_taxonomy_nodes(id) on delete set null,
  -- True when CONFIRM decremented listing inventory for this line (so a later
  -- cancel restores exactly what was taken, never more).
  reserved boolean not null default false
);
create index if not exists moi_order_idx on public.market_order_items(order_id);

create table if not exists public.market_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.market_orders(id) on delete cascade,
  actor_id uuid,
  actor_role text not null,           -- buyer | seller | system | admin
  old_status public.market_order_status,
  new_status public.market_order_status not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists moe_order_idx on public.market_order_events(order_id);

alter table public.market_orders enable row level security;
alter table public.market_order_items enable row level security;
alter table public.market_order_events enable row level security;

-- Reads: the two parties + admins. Writes: RPC-only (no table grants at all).
create policy mo_select_parties on public.market_orders
  for select to authenticated
  using (buyer_id = auth.uid()
         or exists (select 1 from public.markets m where m.id = market_id and m.owner_id = auth.uid())
         or public.is_admin());
create policy moi_select_parties on public.market_order_items
  for select to authenticated
  using (exists (select 1 from public.market_orders o
                  where o.id = order_id
                    and (o.buyer_id = auth.uid()
                         or exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid())
                         or public.is_admin())));
create policy moe_select_parties on public.market_order_events
  for select to authenticated
  using (exists (select 1 from public.market_orders o
                  where o.id = order_id
                    and (o.buyer_id = auth.uid()
                         or exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid())
                         or public.is_admin())));
grant select on public.market_orders, public.market_order_items, public.market_order_events to authenticated;

-- Status history is trigger-written; clients cannot fabricate or rewrite it.
create or replace function public.market_orders_event_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
begin
  if v_actor is null then v_role := 'system';
  elsif new.buyer_id = v_actor then v_role := 'buyer';
  elsif exists (select 1 from public.markets m where m.id = new.market_id and m.owner_id = v_actor) then v_role := 'seller';
  elsif public.is_admin() then v_role := 'admin';
  else v_role := 'system';
  end if;
  if tg_op = 'INSERT' then
    insert into public.market_order_events (order_id, actor_id, actor_role, old_status, new_status)
    values (new.id, v_actor, v_role, null, new.status);
  elsif old.status is distinct from new.status then
    insert into public.market_order_events (order_id, actor_id, actor_role, old_status, new_status, reason)
    values (new.id, v_actor, v_role, old.status, new.status, new.decline_reason);
  end if;
  return new;
end $$;
drop trigger if exists market_orders_event_trg on public.market_orders;
create trigger market_orders_event_trg
  after insert or update on public.market_orders
  for each row execute function public.market_orders_event_log();

-- ---------------------------------------------------------------------------
-- Slot generation: THE source of truth for both clients and validation.
create or replace function public.market_available_slots(p_market uuid, p_days int default 10)
returns table(slot_start timestamptz, slot_end timestamptz, remaining int)
language plpgsql stable security definer set search_path = public as $$
declare
  s public.market_pickup_settings;
  d int; w record; local_date date; slot_min int;
  v_start timestamptz; v_end timestamptz; taken int;
  has_exceptions boolean;
begin
  select * into s from public.market_pickup_settings where market_id = p_market;
  if s is null then return; end if;
  p_days := least(greatest(p_days, 1), 21);

  for d in 0..(p_days - 1) loop
    local_date := (now() at time zone s.timezone)::date + d;
    -- whole-day closure wins outright
    if exists (select 1 from public.market_pickup_exceptions e
                where e.market_id = p_market and e.date = local_date and e.closed) then
      continue;
    end if;
    select exists (select 1 from public.market_pickup_exceptions e
                    where e.market_id = p_market and e.date = local_date and not e.closed)
      into has_exceptions;

    for w in
      select * from (
        select e.start_minute, e.end_minute
          from public.market_pickup_exceptions e
         where e.market_id = p_market and e.date = local_date and not e.closed and has_exceptions
        union all
        select h.start_minute, h.end_minute
          from public.market_pickup_hours h
         where h.market_id = p_market
           and h.weekday = extract(dow from local_date)::int
           and not has_exceptions
      ) windows order by start_minute
    loop
      slot_min := w.start_minute;
      while slot_min + s.slot_minutes <= w.end_minute loop
        v_start := (local_date::timestamp + make_interval(mins => slot_min)) at time zone s.timezone;
        v_end   := v_start + make_interval(mins => s.slot_minutes);
        if v_start >= now() + make_interval(mins => s.lead_time_minutes) then
          select count(*) into taken
            from public.market_orders o
           where o.market_id = p_market
             and o.status in ('REQUESTED','CONFIRMED','READY','TIME_PROPOSED')
             and coalesce(o.confirmed_start, o.requested_start) = v_start;
          if s.max_orders_per_slot is null or taken < s.max_orders_per_slot then
            slot_start := v_start; slot_end := v_end;
            remaining := case when s.max_orders_per_slot is null then null
                              else s.max_orders_per_slot - taken end;
            return next;
          end if;
        end if;
        slot_min := slot_min + s.slot_minutes;
      end loop;
    end loop;
  end loop;
end $$;
revoke all on function public.market_available_slots(uuid, int) from public;
grant execute on function public.market_available_slots(uuid, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Order lifecycle RPCs
create or replace function public.create_market_order(
  p_market uuid, p_items jsonb, p_start timestamptz, p_end timestamptz, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_buyer uuid := auth.uid();
  s public.market_pickup_settings;
  v_order uuid; item jsonb; l record;
  v_qty numeric; v_subtotal int := 0; v_line int; v_ok boolean := false;
begin
  if v_buyer is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  if exists (select 1 from public.markets m where m.id = p_market and m.owner_id = v_buyer) then
    raise exception 'OWN_MARKET: you cannot order from your own Market' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = 'P0001';
  end if;
  select * into s from public.market_pickup_settings where market_id = p_market;
  if s is null then raise exception 'PICKUP_NOT_CONFIGURED' using errcode = 'P0001'; end if;

  -- The requested window must be one of the generated slots, capacity included.
  select true into v_ok from public.market_available_slots(p_market, 21) a
   where a.slot_start = p_start and a.slot_end = p_end limit 1;
  if not coalesce(v_ok, false) then
    raise exception 'SLOT_UNAVAILABLE: pick one of the offered pickup times' using errcode = 'P0001';
  end if;

  insert into public.market_orders
    (market_id, buyer_id, requested_start, requested_end, timezone, buyer_note)
  values (p_market, v_buyer, p_start, p_end, s.timezone, nullif(btrim(coalesce(p_note,'')), ''))
  returning id into v_order;

  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((item->>'quantity')::numeric, 1);
    if v_qty <= 0 then raise exception 'BAD_QUANTITY' using errcode = 'P0001'; end if;
    select id, title, unit, price_cents, market_id, status, taxonomy_node_id
      into l from public.listings where id = (item->>'listing_id')::uuid;
    if l is null or l.market_id is distinct from p_market then
      raise exception 'ITEM_NOT_IN_MARKET' using errcode = 'P0001';
    end if;
    if l.status <> 'active' then
      raise exception 'ITEM_UNAVAILABLE: %', l.title using errcode = 'P0001';
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

-- CONFIRM: seller-only; the authoritative inventory reservation. Row-locks
-- each listing, refuses to go negative, and marks each line it reserved.
create or replace function public.confirm_market_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o public.market_orders; it record;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if o.status not in ('REQUESTED','TIME_PROPOSED') then
    raise exception 'BAD_STATE: % order cannot be confirmed', o.status using errcode = 'P0001';
  end if;

  for it in select i.id as item_id, i.quantity, i.title, i.listing_id, l.inventory_count
              from public.market_order_items i
              join public.listings l on l.id = i.listing_id
             where i.order_id = p_order
             for update of l
  loop
    if it.inventory_count is not null then
      if it.inventory_count < it.quantity then
        raise exception 'INSUFFICIENT_INVENTORY: %', it.title using errcode = 'P0001';
      end if;
      update public.listings set inventory_count = inventory_count - it.quantity::int
       where id = it.listing_id;
      update public.market_order_items set reserved = true where id = it.item_id;
    end if;
  end loop;

  update public.market_orders
     set status = 'CONFIRMED',
         confirmed_start = coalesce(proposed_start, requested_start),
         confirmed_end   = coalesce(proposed_end, requested_end),
         proposed_start = null, proposed_end = null,
         updated_at = now()
   where id = p_order;
end $$;

create or replace function public.propose_order_time(p_order uuid, p_start timestamptz, p_end timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare o public.market_orders;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if o.status not in ('REQUESTED','CONFIRMED') then
    raise exception 'BAD_STATE: cannot propose a time on a % order', o.status using errcode = 'P0001';
  end if;
  update public.market_orders
     set status = 'TIME_PROPOSED', proposed_start = p_start, proposed_end = p_end, updated_at = now()
   where id = p_order;
end $$;

-- Buyer answers a proposal: accept -> CONFIRMED (with inventory, via the same
-- guarded path), decline -> back to REQUESTED (optionally with a new ask).
create or replace function public.respond_order_proposal(
  p_order uuid, p_accept boolean, p_new_start timestamptz default null, p_new_end timestamptz default null
) returns void language plpgsql security definer set search_path = public as $$
declare o public.market_orders; it record;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if o.buyer_id is distinct from auth.uid() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if o.status <> 'TIME_PROPOSED' then
    raise exception 'BAD_STATE: no pending time proposal' using errcode = 'P0001';
  end if;

  if p_accept then
    -- Same authoritative reservation as seller confirm.
    for it in select i.id as item_id, i.quantity, i.title, i.listing_id, l.inventory_count
                from public.market_order_items i
                join public.listings l on l.id = i.listing_id
               where i.order_id = p_order and not i.reserved
               for update of l
    loop
      if it.inventory_count is not null then
        if it.inventory_count < it.quantity then
          raise exception 'INSUFFICIENT_INVENTORY: %', it.title using errcode = 'P0001';
        end if;
        update public.listings set inventory_count = inventory_count - it.quantity::int
         where id = it.listing_id;
        update public.market_order_items set reserved = true where id = it.item_id;
      end if;
    end loop;
    update public.market_orders
       set status = 'CONFIRMED',
           confirmed_start = proposed_start, confirmed_end = proposed_end,
           proposed_start = null, proposed_end = null, updated_at = now()
     where id = p_order;
  else
    update public.market_orders
       set status = 'REQUESTED',
           requested_start = coalesce(p_new_start, requested_start),
           requested_end   = coalesce(p_new_end, requested_end),
           proposed_start = null, proposed_end = null, updated_at = now()
     where id = p_order;
  end if;
end $$;

-- Shared release helper for decline/cancel.
create or replace function public._release_order_inventory(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare it record;
begin
  for it in select i.* from public.market_order_items i
             where i.order_id = p_order and i.reserved and i.listing_id is not null
            loop
    update public.listings
       set inventory_count = coalesce(inventory_count, 0) + it.quantity::int
     where id = it.listing_id and inventory_count is not null;
    update public.market_order_items set reserved = false where id = it.id;
  end loop;
end $$;
revoke all on function public._release_order_inventory(uuid) from public, anon, authenticated;

create or replace function public.decline_market_order(p_order uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.market_orders;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if o.status in ('COMPLETED','CANCELLED','DECLINED') then
    raise exception 'BAD_STATE: order already %', o.status using errcode = 'P0001';
  end if;
  perform public._release_order_inventory(p_order);
  update public.market_orders
     set status = 'DECLINED', decline_reason = nullif(btrim(coalesce(p_reason,'')), ''), updated_at = now()
   where id = p_order;
end $$;

create or replace function public.cancel_market_order(p_order uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o public.market_orders; v_is_seller boolean;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  v_is_seller := exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid());
  if o.buyer_id is distinct from auth.uid() and not v_is_seller then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if o.status in ('COMPLETED','CANCELLED','DECLINED') then
    raise exception 'BAD_STATE: order already %', o.status using errcode = 'P0001';
  end if;
  perform public._release_order_inventory(p_order);
  update public.market_orders
     set status = 'CANCELLED', decline_reason = nullif(btrim(coalesce(p_reason,'')), ''), updated_at = now()
   where id = p_order;
end $$;

create or replace function public.mark_order_ready(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.market_orders;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if o.status <> 'CONFIRMED' then
    raise exception 'BAD_STATE: only a confirmed order can be marked ready' using errcode = 'P0001';
  end if;
  update public.market_orders set status = 'READY', updated_at = now() where id = p_order;
end $$;

-- COMPLETE (idempotent): repeated calls return the same ledger txn instead of
-- erroring or double-recording. The ledger insert carries order_id under a
-- partial unique index, so a duplicate row is structurally impossible.
alter table public.seller_transactions
  add column if not exists order_id uuid references public.market_orders(id) on delete set null;
create unique index if not exists seller_transactions_order_completed_uniq
  on public.seller_transactions(order_id)
  where order_id is not null and status = 'completed';

create or replace function public.complete_market_order(
  p_order uuid, p_record_payment boolean default false,
  p_method text default 'cash', p_amount_cents int default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o public.market_orders; v_txn uuid; v_items int; v_qty numeric;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select id into v_txn from public.seller_transactions
   where order_id = p_order and status = 'completed' limit 1;
  if o.status = 'COMPLETED' then
    if not p_record_payment or v_txn is not null then return v_txn; end if;
  elsif o.status not in ('CONFIRMED','READY') then
    raise exception 'BAD_STATE: % order cannot be completed', o.status using errcode = 'P0001';
  end if;

  update public.market_orders set status = 'COMPLETED', updated_at = now()
   where id = p_order and status <> 'COMPLETED';

  if p_record_payment and v_txn is null then
    if p_method not in ('cash','venmo','zelle','cashapp','check','external_card','other','paypal') then
      raise exception 'BAD_METHOD' using errcode = 'P0001';
    end if;
    select count(*), coalesce(sum(quantity), 0) into v_items, v_qty
      from public.market_order_items where order_id = p_order;
    insert into public.seller_transactions
      (market_id, listing_id, claim_id, order_id, source, quantity,
       gross_cents, discount_cents, fee_cents, payment_method, buyer_label, notes, status)
    values
      (o.market_id, null, null, p_order, 'request', v_qty,
       coalesce(p_amount_cents, o.subtotal_cents), 0, 0,
       case when p_method = 'paypal' then 'other' else p_method end,
       null, 'Market pickup order (' || v_items || ' items)', 'completed')
    returning id into v_txn;
  end if;
  return v_txn;
end $$;

-- Address/instructions release: buyer of a CONFIRMED/READY/COMPLETED order, or
-- the owner. Never anyone else, never earlier.
create or replace function public.order_pickup_details(p_order uuid)
returns table(address text, instructions text, location_type text)
language plpgsql stable security definer set search_path = public as $$
declare o public.market_orders; v_is_owner boolean;
begin
  select * into o from public.market_orders where id = p_order;
  if o is null then return; end if;
  v_is_owner := exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid());
  if not v_is_owner and (o.buyer_id is distinct from auth.uid()
                         or o.status not in ('CONFIRMED','READY','COMPLETED')) then
    return;
  end if;
  return query
    select p.pickup_address, p.pickup_instructions, s.location_type
      from public.market_pickup_settings s
      left join public.market_pickup_private p on p.market_id = s.market_id
     where s.market_id = o.market_id;
end $$;

revoke all on function public.create_market_order(uuid, jsonb, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.confirm_market_order(uuid) from public, anon;
revoke all on function public.propose_order_time(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.respond_order_proposal(uuid, boolean, timestamptz, timestamptz) from public, anon;
revoke all on function public.decline_market_order(uuid, text) from public, anon;
revoke all on function public.cancel_market_order(uuid, text) from public, anon;
revoke all on function public.mark_order_ready(uuid) from public, anon;
revoke all on function public.complete_market_order(uuid, boolean, text, int) from public, anon;
revoke all on function public.order_pickup_details(uuid) from public, anon;
grant execute on function public.create_market_order(uuid, jsonb, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.confirm_market_order(uuid) to authenticated;
grant execute on function public.propose_order_time(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.respond_order_proposal(uuid, boolean, timestamptz, timestamptz) to authenticated;
grant execute on function public.decline_market_order(uuid, text) to authenticated;
grant execute on function public.cancel_market_order(uuid, text) to authenticated;
grant execute on function public.mark_order_ready(uuid) to authenticated;
grant execute on function public.complete_market_order(uuid, boolean, text, int) to authenticated;
grant execute on function public.order_pickup_details(uuid) to authenticated;
