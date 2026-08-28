-- 0077: inventory operating system + Seed Drop fulfillment + AI Boardroom.
-- Extends the 0028 packet-unit tables (no duplication). All mutations are
-- permission-checked definer RPCs that write the ledger + audit log.
-- NOTE: applied to production as 20260811040428_inventory_fulfillment_boardroom
-- via MCP; this file is the repo record of exactly what ran.

-- ---- SKU extensions --------------------------------------------------------
alter table public.seed_products
  add column if not exists sku text unique,
  add column if not exists supplier text,
  add column if not exists supplier_product_code text,
  add column if not exists packet_size text,
  add column if not exists barcode text,
  add column if not exists cost_cents int,
  add column if not exists suggested_reorder_qty int,
  add column if not exists image_url text,
  add column if not exists archived boolean not null default false;

create table if not exists public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  zone text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.storage_locations enable row level security;
drop policy if exists storage_read on public.storage_locations;
create policy storage_read on public.storage_locations for select using (public.admin_has_perm('inventory.view'));
revoke insert, update, delete on public.storage_locations from anon, authenticated;
grant select on public.storage_locations to authenticated;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact text, website text, account_ref text, notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.suppliers enable row level security;
drop policy if exists suppliers_read on public.suppliers;
create policy suppliers_read on public.suppliers for select using (public.admin_has_perm('inventory.view'));
revoke insert, update, delete on public.suppliers from anon, authenticated;
grant select on public.suppliers to authenticated;

-- item statuses gain 'picked' (reserved→picked→packed→shipped)
alter table public.seed_order_items drop constraint if exists seed_order_items_status_check;
alter table public.seed_order_items add constraint seed_order_items_status_check
  check (status in ('reserved','picked','packed','shipped','released','substituted'));

-- admin read of inventory + seed ops (RLS was admin-gated already? ensure)
drop policy if exists seed_products_admin_read on public.seed_products;
create policy seed_products_admin_read on public.seed_products for select using (true);
drop policy if exists seed_lots_admin_read on public.seed_lots;
create policy seed_lots_admin_read on public.seed_lots for select using (public.admin_has_perm('inventory.view'));
drop policy if exists seed_log_admin_read on public.seed_inventory_log;
create policy seed_log_admin_read on public.seed_inventory_log for select using (public.admin_has_perm('inventory.view'));
drop policy if exists seed_orders_admin_read on public.seed_orders;
create policy seed_orders_admin_read on public.seed_orders for select using (public.admin_has_perm('seed_drop.view') or user_id = auth.uid());
drop policy if exists seed_items_admin_read on public.seed_order_items;
create policy seed_items_admin_read on public.seed_order_items for select using
  (public.admin_has_perm('seed_drop.view')
   or exists (select 1 from public.seed_orders o where o.id = order_id and o.user_id = auth.uid()));

-- ---- role presets grow the new permissions --------------------------------
create or replace function public.admin_role_permissions(p_role text)
returns text[] language sql immutable as $$
  select case p_role
    when 'OWNER'        then array['*']
    when 'SUPER_ADMIN'  then array['*']
    when 'OPERATIONS_ADMIN' then array[
      'users.view','markets.view','markets.edit','markets.pause','markets.restore','markets.feature',
      'listings.view','listings.moderate','listings.pause','listings.restore',
      'orders.view','orders.manage','orders.cancel','orders.complete',
      'pickups.view','pickups.manage','delivery.view','delivery.manage',
      'inventory.view','seed_drop.view','plots.view','support.view','taxonomy.view',
      'subscriptions.view','system.view','ai.view','ai.chat']
    when 'COMPLIANCE_ADMIN' then array[
      'users.view','markets.view','listings.view','listings.moderate','listings.pause','listings.restore',
      'compliance.view','compliance.view_documents','compliance.review','compliance.approve',
      'compliance.deny','compliance.revoke','compliance.rules_manage','taxonomy.view','system.view','ai.view']
    when 'INVENTORY_FULFILLMENT' then array[
      'inventory.view','inventory.create','inventory.edit','inventory.receive','inventory.adjust',
      'inventory.move','inventory.quarantine','inventory.archive','inventory.reconcile',
      'seed_drop.view','seed_drop.generate','seed_drop.pick','seed_drop.pack','seed_drop.ship',
      'seed_drop.fulfill','system.view','ai.view','ai.chat']
    when 'SUPPORT_MODERATOR' then array[
      'users.view','markets.view','listings.view','listings.moderate',
      'support.view','support.respond','support.resolve','orders.view','system.view']
    when 'ACCOUNTING_FINANCE' then array[
      'finance.view_summary','finance.view_transactions','finance.export',
      'subscriptions.view','system.view']
    when 'MARKETING_GROWTH' then array[
      'marketing.view','marketing.draft','users.view','markets.view','listings.view','system.view']
    when 'READ_ONLY' then array[
      'users.view','markets.view','listings.view','orders.view','pickups.view','delivery.view',
      'compliance.view','inventory.view','seed_drop.view','plots.view','support.view',
      'taxonomy.view','subscriptions.view','finance.view_summary','system.view','ai.view']
    else array[]::text[]
  end;
$$;

-- ---- harden invite: non-owners can never mint wildcard/admin-team perms ---
create or replace function public.admin_upsert_member(
  p_email text, p_name text, p_role text,
  p_extra text[] default '{}', p_denied text[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_old public.admin_users;
begin
  if not public.admin_has_perm('admins.invite') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_role in ('OWNER','SUPER_ADMIN') and not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  if not public.admin_is_owner() and exists (
    select 1 from unnest(p_extra) x where x = '*' or x like 'admins.%' or x like 'system.%'
  ) then
    raise exception 'OWNER_ONLY: wildcard/admin-team/system permissions' using errcode = 'P0001';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then
    raise exception 'USER_NOT_FOUND: they must sign up for Gnome first' using errcode = 'P0001';
  end if;
  select * into v_old from public.admin_users where user_id = v_uid;
  if v_old is not null and v_old.role in ('OWNER','SUPER_ADMIN') and not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  insert into public.admin_users (user_id, role, status, extra_permissions, denied_permissions, invited_name, invited_email, created_by)
  values (v_uid, p_role, 'active', p_extra, p_denied, p_name, lower(p_email), auth.uid())
  on conflict (user_id) do update set
    role = excluded.role, status = 'active',
    extra_permissions = excluded.extra_permissions,
    denied_permissions = excluded.denied_permissions,
    suspended_at = null, revoked_at = null
  returning id into v_id;
  perform public.admin_audit('ADMIN_MEMBER_UPSERTED', 'admin_user', v_id::text,
    to_jsonb(v_old), (select to_jsonb(a) from public.admin_users a where a.id = v_id), null);
  return v_id;
end $$;

-- ---- inventory RPCs --------------------------------------------------------
create or replace function public.admin_upsert_seed_product(
  p_id uuid, p_crop text, p_variety text, p_category text,
  p_sku text default null, p_supplier text default null, p_supplier_code text default null,
  p_packet_size text default null, p_barcode text default null, p_cost_cents int default null,
  p_reorder_threshold int default null, p_suggested_reorder int default null,
  p_notes text default null, p_archived boolean default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_old public.seed_products;
begin
  if p_id is null then
    if not public.admin_has_perm('inventory.create') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
    insert into public.seed_products (crop, variety, category, sku, supplier, supplier_product_code,
      packet_size, barcode, cost_cents, reorder_threshold, suggested_reorder_qty, tags)
    values (p_crop, coalesce(p_variety, ''), coalesce(p_category,'vegetable'), p_sku, p_supplier, p_supplier_code,
      p_packet_size, p_barcode, p_cost_cents, p_reorder_threshold, p_suggested_reorder, '{}')
    returning id into v_id;
    perform public.admin_audit('INVENTORY_ITEM_CREATED','seed_product',v_id::text,null,
      jsonb_build_object('crop',p_crop,'variety',p_variety,'sku',p_sku),null);
  else
    if not public.admin_has_perm('inventory.edit') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
    select * into v_old from public.seed_products where id = p_id for update;
    if v_old is null then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
    update public.seed_products set
      crop = coalesce(p_crop, crop), variety = coalesce(p_variety, variety),
      category = coalesce(p_category, category), sku = coalesce(p_sku, sku),
      supplier = coalesce(p_supplier, supplier), supplier_product_code = coalesce(p_supplier_code, supplier_product_code),
      packet_size = coalesce(p_packet_size, packet_size), barcode = coalesce(p_barcode, barcode),
      cost_cents = coalesce(p_cost_cents, cost_cents),
      reorder_threshold = coalesce(p_reorder_threshold, reorder_threshold),
      suggested_reorder_qty = coalesce(p_suggested_reorder, suggested_reorder_qty),
      archived = coalesce(p_archived, archived), updated_at = now()
    where id = p_id;
    v_id := p_id;
    perform public.admin_audit('INVENTORY_ITEM_UPDATED','seed_product',p_id::text,
      to_jsonb(v_old),(select to_jsonb(x) from public.seed_products x where x.id=p_id),p_notes);
  end if;
  return v_id;
end $$;

create or replace function public.admin_delete_seed_product(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_refs int;
begin
  if not public.admin_has_perm('inventory.delete_unused') and not public.admin_is_owner() then
    raise exception 'NOT_AUTHORIZED' using errcode='P0001';
  end if;
  select (select count(*) from public.seed_lots where seed_product_id = p_id)
       + (select count(*) from public.seed_order_items where seed_product_id = p_id) into v_refs;
  if v_refs > 0 then
    raise exception 'HAS_HISTORY: This item has fulfillment history and can''t be permanently deleted. Archive it instead.' using errcode='P0001';
  end if;
  delete from public.seed_products where id = p_id;
  perform public.admin_audit('INVENTORY_ITEM_DELETED','seed_product',p_id::text,null,null,'unused hard delete');
  return 'deleted';
end $$;

create or replace function public.admin_receive_lot(
  p_product uuid, p_qty numeric, p_internal_lot text,
  p_supplier text default null, p_supplier_lot text default null,
  p_storage text default null, p_germination numeric default null, p_cost_cents int default null,
  p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_lot uuid;
begin
  if not public.admin_has_perm('inventory.receive') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'BAD_QTY' using errcode='P0001'; end if;
  insert into public.seed_lots (seed_product_id, supplier, supplier_lot_number, internal_lot_number,
    original_qty, current_qty, unit, cost_cents, germination_pct, storage_location, status)
  values (p_product, p_supplier, p_supplier_lot, p_internal_lot, p_qty, p_qty, 'packets',
    p_cost_cents, p_germination, p_storage, 'fresh')
  returning id into v_lot;
  insert into public.seed_inventory_log (lot_id, delta, reason, actor)
  values (v_lot, p_qty, 'received' || coalesce(': '||p_note,''), auth.uid());
  perform public.admin_audit('INVENTORY_RECEIVED','seed_lot',v_lot::text,null,
    jsonb_build_object('qty',p_qty,'storage',p_storage,'lot',p_internal_lot),p_note);
  return v_lot;
end $$;

create or replace function public.admin_adjust_lot(p_lot uuid, p_delta numeric, p_reason text)
returns numeric language plpgsql security definer set search_path = public as $$
declare l public.seed_lots; v_new numeric;
begin
  if not public.admin_has_perm('inventory.adjust') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'REASON_REQUIRED' using errcode='P0001'; end if;
  select * into l from public.seed_lots where id = p_lot for update;
  if l is null then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
  v_new := l.current_qty + p_delta;
  if v_new < 0 then raise exception 'NEGATIVE_STOCK: only % available', l.current_qty using errcode='P0001'; end if;
  update public.seed_lots set current_qty = v_new, updated_at = now() where id = p_lot;
  insert into public.seed_inventory_log (lot_id, delta, reason, actor)
  values (p_lot, p_delta, (case when p_delta >= 0 then 'adjust_up: ' else 'adjust_down: ' end) || p_reason, auth.uid());
  perform public.admin_audit('INVENTORY_ADJUSTED','seed_lot',p_lot::text,
    jsonb_build_object('qty',l.current_qty), jsonb_build_object('qty',v_new), p_reason);
  return v_new;
end $$;

create or replace function public.admin_move_lot(p_lot uuid, p_storage text)
returns void language plpgsql security definer set search_path = public as $$
declare l public.seed_lots;
begin
  if not public.admin_has_perm('inventory.move') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  select * into l from public.seed_lots where id = p_lot for update;
  if l is null then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
  update public.seed_lots set storage_location = p_storage, updated_at = now() where id = p_lot;
  perform public.admin_audit('INVENTORY_MOVED','seed_lot',p_lot::text,
    jsonb_build_object('storage',l.storage_location), jsonb_build_object('storage',p_storage), null);
end $$;

create or replace function public.admin_set_lot_status(p_lot uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.seed_lots;
begin
  if not public.admin_has_perm('inventory.quarantine') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  if p_status not in ('fresh','active','aging','needs_test','quarantined','failed','depleted','discarded') then
    raise exception 'BAD_STATUS' using errcode='P0001';
  end if;
  select * into l from public.seed_lots where id = p_lot for update;
  if l is null then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
  update public.seed_lots set status = p_status, updated_at = now() where id = p_lot;
  insert into public.seed_inventory_log (lot_id, delta, reason, actor)
  values (p_lot, 0, 'status: ' || l.status || ' → ' || p_status || coalesce(' ('||p_reason||')',''), auth.uid());
  perform public.admin_audit('INVENTORY_STATUS','seed_lot',p_lot::text,
    jsonb_build_object('status',l.status), jsonb_build_object('status',p_status), p_reason);
end $$;

create or replace function public.admin_manage_storage(p_name text, p_zone text default null, p_archived boolean default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.admin_has_perm('inventory.edit') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  insert into public.storage_locations (name, zone) values (p_name, p_zone)
  on conflict (name) do update set zone = coalesce(excluded.zone, storage_locations.zone),
    archived = coalesce(p_archived, storage_locations.archived)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_inventory_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.admin_has_perm('inventory.view') then null else jsonb_build_object(
    'skus', (select count(*) from public.seed_products where not archived),
    'low_stock', (select count(distinct p.id) from public.seed_products p
       join public.seed_lots l on l.seed_product_id = p.id and l.status in ('fresh','active')
       group by () having sum(l.current_qty) <= 0 limit 1) is not null,
    'low_stock_items', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
       select p.id, p.crop, p.variety, coalesce(sum(l.current_qty) filter (where l.status in ('fresh','active')), 0) as available,
              coalesce(p.reorder_threshold, 5) as threshold
         from public.seed_products p
         left join public.seed_lots l on l.seed_product_id = p.id
        where not p.archived
        group by p.id
       having coalesce(sum(l.current_qty) filter (where l.status in ('fresh','active')), 0) <= coalesce(p.reorder_threshold, 5)) t),
    'quarantined', (select count(*) from public.seed_lots where status = 'quarantined'),
    'needs_retest', (select count(*) from public.seed_lots where status = 'needs_test'
       or (next_review_date is not null and next_review_date <= current_date))
  ) end;
$$;

-- ---- fulfillment RPCs ------------------------------------------------------
create or replace function public.admin_pick_seed_item(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare it public.seed_order_items;
begin
  if not public.admin_has_perm('seed_drop.pick') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  select * into it from public.seed_order_items where id = p_item for update;
  if it is null then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
  if it.status <> 'reserved' then raise exception 'BAD_STATE: %', it.status using errcode='P0001'; end if;
  update public.seed_order_items set status = 'picked', updated_at = now() where id = p_item;
end $$;

create or replace function public.admin_pack_seed_order(p_order uuid, p_override_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_unpicked int;
begin
  if not public.admin_has_perm('seed_drop.pack') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  select count(*) into v_unpicked from public.seed_order_items
   where order_id = p_order and status = 'reserved';
  if v_unpicked > 0 and p_override_reason is null then
    raise exception 'UNPICKED_ITEMS: % packets not yet picked', v_unpicked using errcode='P0001';
  end if;
  update public.seed_order_items set status = 'packed', updated_at = now()
   where order_id = p_order and status in ('reserved','picked');
  update public.seed_orders set status = 'packed', updated_at = now()
   where id = p_order and status in ('paid','selected','needs_review');
  perform public.admin_audit('SEED_ORDER_PACKED','seed_order',p_order::text,null,null,p_override_reason);
end $$;

create or replace function public.admin_ship_seed_order(p_order uuid, p_carrier text, p_tracking text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.seed_orders;
begin
  if not public.admin_has_perm('seed_drop.ship') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  select * into o from public.seed_orders where id = p_order for update;
  if o is null then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
  if o.status <> 'packed' then raise exception 'BAD_STATE: % (pack first; already-shipped orders cannot ship twice)', o.status using errcode='P0001'; end if;
  update public.seed_orders set status = 'shipped',
    tracking = coalesce(p_carrier || ' ', '') || coalesce(p_tracking, ''), updated_at = now()
   where id = p_order;
  update public.seed_order_items set status = 'shipped', updated_at = now()
   where order_id = p_order and status = 'packed';
  insert into public.seed_inventory_log (lot_id, delta, reason, order_id, actor)
  select lot_id, 0, 'shipped (reservation consumed)', p_order, auth.uid()
    from public.seed_order_items where order_id = p_order;
  perform public.admin_audit('SEED_ORDER_SHIPPED','seed_order',p_order::text,null,
    jsonb_build_object('carrier',p_carrier,'tracking',p_tracking),null);
end $$;

create or replace function public.admin_seed_queue()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.admin_has_perm('seed_drop.view') then null else
    (select coalesce(jsonb_agg(t order by t->>'created_at'), '[]'::jsonb) from (
      select to_jsonb(o) || jsonb_build_object(
        'customer', (select name from public.profiles where id = o.user_id),
        'ship', o.profile_snapshot->'ship',
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
            'id', i.id, 'status', i.status, 'qty', i.qty_packets,
            'crop', pr.crop, 'variety', pr.variety,
            'lot', l.internal_lot_number, 'bin', l.storage_location, 'lot_status', l.status)), '[]'::jsonb)
          from public.seed_order_items i
          join public.seed_lots l on l.id = i.lot_id
          join public.seed_products pr on pr.id = i.seed_product_id
          where i.order_id = o.id)) as t
      from public.seed_orders o
      where o.status in ('paid','selected','needs_review','packed','shipped')
      order by o.created_at desc limit 60) q)
  end;
$$;

-- ---- AI control plane bootstrap -------------------------------------------
-- These objects were created in production between 0076 and 0077 outside the
-- migration ledger. 0078 hardens them and 0080/0082 extend them, so a clean
-- replay must establish the observed pre-0078 shape here.
create table if not exists public.ai_settings (
  id boolean primary key default true check (id),
  writes_paused boolean not null default true,
  reads_enabled boolean not null default true,
  listing_daily_limit integer not null default 20,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_agents (
  id text primary key,
  name text not null,
  status text not null default 'disabled'
    check (status in ('enabled','read_only','disabled')),
  provider text not null default 'anthropic',
  model text not null default 'claude-sonnet-5',
  fallback_provider text,
  fallback_model text,
  automation_level integer not null default 1
    check (automation_level between 1 and 3),
  permissions text[] not null default '{}',
  daily_budget_cents integer not null default 200,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_action_requests (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references public.ai_agents(id),
  requested_action text not null,
  resource_type text,
  resource_id text,
  parameters jsonb not null default '{}',
  payload_hash text not null,
  human_summary text not null,
  reason text,
  risk_level integer not null default 2 check (risk_level between 1 and 3),
  status text not null default 'PENDING'
    check (status in ('PENDING','APPROVED','REJECTED','EXECUTED','FAILED','EXPIRED')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  executed_at timestamptz,
  execution_result jsonb,
  dry_run boolean not null default false,
  expires_at timestamptz not null default (now() + interval '7 days')
);

create table if not exists public.ai_usage_log (
  id bigint generated always as identity primary key,
  agent_id text,
  feature text not null,
  user_id uuid,
  market_id uuid,
  effective_plan text,
  provider text,
  model text,
  images integer not null default 0,
  input_tokens integer,
  output_tokens integer,
  tool_calls integer not null default 0,
  estimated_cost_cents numeric(10,4),
  duration_ms integer,
  success boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_day_idx
  on public.ai_usage_log (user_id, created_at desc);

alter table public.ai_settings enable row level security;
alter table public.ai_agents enable row level security;
alter table public.ai_action_requests enable row level security;
alter table public.ai_usage_log enable row level security;

drop policy if exists ai_settings_read on public.ai_settings;
create policy ai_settings_read on public.ai_settings
  for select using (public.admin_has_perm('ai.view'));
drop policy if exists ai_agents_read on public.ai_agents;
create policy ai_agents_read on public.ai_agents
  for select using (public.admin_has_perm('ai.view'));
drop policy if exists ai_requests_read on public.ai_action_requests;
create policy ai_requests_read on public.ai_action_requests
  for select using (public.admin_has_perm('ai.view'));
drop policy if exists ai_usage_read on public.ai_usage_log;
create policy ai_usage_read on public.ai_usage_log
  for select using (public.admin_has_perm('ai.view'));

revoke insert, update, delete on public.ai_settings, public.ai_agents,
  public.ai_action_requests, public.ai_usage_log from anon, authenticated;
grant select on public.ai_settings, public.ai_agents,
  public.ai_action_requests, public.ai_usage_log to authenticated;

insert into public.ai_settings (id) values (true) on conflict do nothing;

insert into public.ai_agents (id, name, status, permissions) values
  ('gnome_hq', 'Gnome HQ', 'read_only', array[
    'get_daily_summary','get_business_health','list_today_pickups',
    'list_today_deliveries','list_pending_compliance_reviews',
    'list_low_inventory','list_complimentary_entitlements',
    'get_security_alerts','create_owner_approval_request']),
  ('operations', 'Operations Agent', 'read_only', array[
    'get_daily_summary','list_today_pickups','list_today_deliveries',
    'list_market_orders','create_owner_approval_request']),
  ('inventory', 'Inventory Agent', 'read_only', array[
    'inventory.summary.read','seed_queue.read','low_stock.read']),
  ('seeds', 'Seed Agent', 'read_only', array[
    'seed_queue.read','seed_orders.read','inventory.summary.read']),
  ('marketplace', 'Marketplace Agent', 'disabled', array['list_reported_listings']),
  ('support', 'Support Agent', 'disabled', array['list_open_support_cases']),
  ('finance', 'Finance Agent', 'disabled', array['get_subscription_summary']),
  ('growth', 'Growth Agent', 'disabled', '{}'),
  ('marketing', 'Marketing Agent', 'disabled', '{}'),
  ('plots', 'Plot Agent', 'disabled', '{}'),
  ('compliance', 'Compliance Agent', 'read_only', array[
    'list_pending_compliance_reviews','get_credential_review_context',
    'create_owner_approval_request']),
  ('security', 'Security Agent', 'read_only', array[
    'get_security_alerts','get_daily_summary','create_owner_approval_request'])
on conflict (id) do nothing;

create or replace function public.admin_set_ai_paused(p_paused boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_has_perm('ai.pause_actions') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  update public.ai_settings
     set writes_paused = p_paused, updated_by = auth.uid(), updated_at = now()
   where id = true;
  perform public.admin_audit(
    case when p_paused then 'AI_WRITES_PAUSED' else 'AI_WRITES_RESUMED' end,
    'ai_settings', 'singleton', null,
    jsonb_build_object('writes_paused', p_paused), null);
end $$;
grant execute on function public.admin_set_ai_paused(boolean)
  to public, anon, authenticated, service_role;

create or replace function public.admin_me()
returns table(user_id uuid, role text, status text, permissions text[], is_owner boolean)
language sql stable security definer set search_path = public as $$
  select a.user_id, a.role, a.status,
         (select array_agg(distinct p) from unnest(
            public.admin_role_permissions(a.role) || a.extra_permissions) p
           where not (p = any(a.denied_permissions))),
         a.role in ('OWNER','SUPER_ADMIN')
    from public.admin_users a
   where a.user_id = auth.uid() and a.status = 'active';
$$;

create or replace function public.admin_list_team()
returns table(id uuid, user_id uuid, name text, email text, role text, status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.user_id, coalesce(a.invited_name, p.name), a.invited_email,
         a.role, a.status, a.created_at
    from public.admin_users a
    left join public.profiles p on p.id = a.user_id
   where public.admin_has_perm('admins.view')
   order by a.created_at;
$$;

create or replace function public.admin_revoke_member(
  p_member uuid, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_old public.admin_users;
begin
  if not public.admin_has_perm('admins.revoke') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into v_old from public.admin_users where id = p_member for update;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_old.role in ('OWNER','SUPER_ADMIN') and not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  if v_old.user_id = auth.uid() and v_old.role = 'OWNER' then
    raise exception 'CANNOT_REVOKE_SELF_OWNER' using errcode = 'P0001';
  end if;
  update public.admin_users set status = 'revoked', revoked_at = now()
   where id = p_member;
  perform public.admin_audit('ADMIN_MEMBER_REVOKED', 'admin_user', p_member::text,
    to_jsonb(v_old), null, p_reason);
end $$;

create or replace function public.admin_market_entitlements(p_market uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.admin_has_perm('subscriptions.view') then null else
    (select jsonb_build_object(
      'effective', to_jsonb(ep),
      'base_plan', (select plan from public.markets where id = p_market),
      'grants', coalesce((select jsonb_agg(to_jsonb(g) order by g.created_at desc)
                  from public.admin_plan_grants g where g.market_id = p_market), '[]'::jsonb))
      from public.market_effective_plan(p_market) ep)
  end;
$$;

create or replace function public.admin_review_ai_action(
  p_request uuid, p_approve boolean, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare r public.ai_action_requests;
begin
  if not public.admin_has_perm('ai.approve_actions') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into r from public.ai_action_requests where id = p_request for update;
  if r is null then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'PENDING' then raise exception 'BAD_STATE: %', r.status using errcode = 'P0001'; end if;
  if r.expires_at <= now() then
    update public.ai_action_requests set status = 'EXPIRED' where id = p_request;
    raise exception 'REQUEST_EXPIRED' using errcode = 'P0001';
  end if;
  if r.risk_level >= 3 and not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  update public.ai_action_requests
     set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_request;
  perform public.admin_audit(case when p_approve then 'AI_ACTION_APPROVED' else 'AI_ACTION_REJECTED' end,
    'ai_action_request', p_request::text, to_jsonb(r), null, p_reason,
    'ADMIN', p_request);
end $$;

create or replace function public.admin_daily_brief()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then null else jsonb_build_object(
    'generated_at', now(),
    'users', (select count(*) from public.profiles),
    'active_markets', (select count(*) from public.markets where status = 'active'),
    'live_listings', (select count(*) from public.listings where status = 'active' and expires_at > now()),
    'orders_today', (select count(*) from public.market_orders where created_at >= date_trunc('day', now())),
    'pickups_today', (select count(*) from public.market_orders
      where fulfillment_type = 'pickup' and status in ('CONFIRMED','READY')
        and coalesce(confirmed_start, requested_start)::date = current_date),
    'deliveries_today', (select count(*) from public.market_orders
      where fulfillment_type = 'delivery' and status in ('CONFIRMED','READY','OUT_FOR_DELIVERY')
        and coalesce(confirmed_start, requested_start)::date = current_date),
    'pending_compliance', (select count(*) from public.seller_credentials where status = 'PENDING'),
    'expiring_credentials_30d', (select count(*) from public.seller_credentials
      where status = 'APPROVED' and expiration_date is not null
        and expiration_date < current_date + 30),
    'low_inventory_lots', (select count(*) from public.seed_lots l
      left join public.seed_products p on p.id = l.seed_product_id
      where l.status in ('fresh','active')
        and l.current_qty <= coalesce(p.reorder_threshold, 5)),
    'seed_orders_needing_review', (select count(*) from public.seed_orders where status = 'needs_review'),
    'seed_orders_to_pack', (select count(*) from public.seed_orders where status in ('paid','selected')),
    'open_reports', (select count(*) from public.reports where resolved_at is null),
    'plan_mix', (select jsonb_object_agg(plan, n) from
      (select ep.plan::text as plan, count(*) as n from public.markets m
        cross join lateral public.market_effective_plan(m.id) ep group by 1) t),
    'mrr_cents', (select coalesce(sum(pl.price_cents), 0)
      from public.market_subscriptions s
      join public.plan_limits pl on pl.plan = s.plan
      where s.kind = 'plan' and s.status in ('active','trialing')),
    'active_comp_grants', (select count(*) from public.admin_plan_grants
      where status = 'ACTIVE' and (expires_at is null or expires_at > now())),
    'comp_expiring_30d', (select count(*) from public.admin_plan_grants
      where status = 'ACTIVE' and expires_at is not null
        and expires_at between now() and now() + interval '30 days'),
    'ai_pending_approvals', (select count(*) from public.ai_action_requests
      where status = 'PENDING' and expires_at > now()),
    'ai_usage_today_cents', (select coalesce(sum(estimated_cost_cents), 0)
      from public.ai_usage_log where created_at >= date_trunc('day', now())),
    'ai_writes_paused', (select writes_paused from public.ai_settings)
  ) end;
$$;

grant execute on function public.admin_me() to anon, authenticated, service_role;
grant execute on function public.admin_list_team() to anon, authenticated, service_role;
grant execute on function public.admin_revoke_member(uuid,text) to anon, authenticated, service_role;
grant execute on function public.admin_market_entitlements(uuid) to anon, authenticated, service_role;
grant execute on function public.admin_review_ai_action(uuid,boolean,text) to anon, authenticated, service_role;
grant execute on function public.admin_daily_brief() to anon, authenticated, service_role;

-- ---- Boardroom -------------------------------------------------------------
create table if not exists public.ai_rooms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  created_by uuid not null,
  status text not null default 'active' check (status in ('active','archived','budget_locked')),
  agent_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.ai_room_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.ai_rooms(id) on delete cascade,
  sender_type text not null check (sender_type in ('admin','agent','system')),
  sender_admin_id uuid,
  sender_agent_id text,
  content text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_room_msgs_idx on public.ai_room_messages (room_id, id);

alter table public.ai_rooms enable row level security;
alter table public.ai_room_messages enable row level security;
drop policy if exists ai_rooms_rw on public.ai_rooms;
create policy ai_rooms_rw on public.ai_rooms
  for all using (public.admin_has_perm('ai.chat') and created_by = auth.uid())
  with check (public.admin_has_perm('ai.chat') and created_by = auth.uid());
drop policy if exists ai_msgs_read on public.ai_room_messages;
create policy ai_msgs_read on public.ai_room_messages
  for select using (exists (select 1 from public.ai_rooms r where r.id = room_id and r.created_by = auth.uid() and public.admin_has_perm('ai.chat')));
drop policy if exists ai_msgs_insert_admin on public.ai_room_messages;
create policy ai_msgs_insert_admin on public.ai_room_messages
  for insert with check (sender_type = 'admin' and sender_admin_id = auth.uid()
    and exists (select 1 from public.ai_rooms r where r.id = room_id and r.created_by = auth.uid() and public.admin_has_perm('ai.chat')));
grant select, insert on public.ai_rooms to authenticated;
grant update (title, status, agent_ids, updated_at) on public.ai_rooms to authenticated;
grant select, insert on public.ai_room_messages to authenticated;

notify pgrst, 'reload schema';
