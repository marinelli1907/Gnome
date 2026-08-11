-- 0078: fixes for every CONFIRMED finding from the adversarial security review
-- (11 confirmed / 3 refuted), plus the AI read-side kill switch RPC and a
-- variety NOT NULL hotfix found in live QA.
-- Applied to production via MCP as:
--   security_hardening_adversarial_round, ai_reads_toggle_rpc (+ hotfix SQL).
--
-- Findings fixed here:
--  1. admin_set_suspended (0064 legacy) gated only on is_admin(), no audit
--     → now requires users.suspend + writes admin_audit; anon EXECUTE revoked.
--     users.suspend added to the OPERATIONS_ADMIN preset.
--  2. reconcile_pickup_locations treated auth.uid() IS NULL as authorized
--     → carve-out replaced with an explicit service_role check; anon revoked.
--  3. Supabase-default TRUNCATE grant left on new + core tables (bypasses RLS)
--     → revoked, and default privileges tightened for future tables.
--  4. market_pickup_location_allowance / enforce_plan_limit /
--     enforce_delivery_plan kept default PUBLIC EXECUTE → revoked.
--  5. AI daily cap was check-then-act (concurrent requests bypass the cap)
--     → ai_daily_counter + ai_reserve_slot: one atomic upsert BEFORE any
--     provider call; failures also consume their slot.
--  6. admin_plan_grants self-read leaked internal_note/granted_by to the
--     customer → policy now admin-only; grantees read my_plan_entitlements.
--  7. No in-app lever stopped read-side AI provider spend → admin_set_ai_reads
--     toggles ai_settings.reads_enabled; analyze-listing-photo + boardroom
--     check it (edge fns redeployed alongside this migration).
--  8. estimated_cost_cents used 3x-inflated rates → provider-aware constants
--     in the edge fn.
--  9. Failure-path ai_usage_log rows lost user attribution → identity hoisted
--     in the edge fn.
-- Also: EXECUTE stripped from public/anon on every 0077 admin RPC, and
-- admin_daily_brief_service / admin_inventory_summary_service added for the
-- boardroom orchestrator (service-role only).

create or replace function public.admin_set_suspended(p_user uuid, p_suspended boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_old boolean;
begin
  if not public.admin_has_perm('users.suspend') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select suspended into v_old from public.profiles where id = p_user;
  if not found then raise exception 'USER_NOT_FOUND' using errcode = 'P0001'; end if;
  update public.profiles set suspended = p_suspended where id = p_user;
  perform public.admin_audit(
    case when p_suspended then 'USER_SUSPENDED' else 'USER_UNSUSPENDED' end,
    'profile', p_user::text,
    jsonb_build_object('suspended', v_old),
    jsonb_build_object('suspended', p_suspended), null);
end $$;
revoke execute on function public.admin_set_suspended(uuid, boolean) from public, anon;

create or replace function public.admin_role_permissions(p_role text)
returns text[] language sql immutable as $$
  select case p_role
    when 'OWNER'        then array['*']
    when 'SUPER_ADMIN'  then array['*']
    when 'OPERATIONS_ADMIN' then array[
      'users.view','users.suspend','markets.view','markets.edit','markets.pause','markets.restore','markets.feature',
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

create or replace function public.reconcile_pickup_locations(p_market uuid)
returns table(kept integer, restricted integer)
language plpgsql security definer set search_path = public as $$
declare
  allowance int := public.market_pickup_location_allowance(p_market);
  v_kept int; v_restricted int;
begin
  if p_market is null then return; end if;
  if not (exists (select 1 from public.markets m
                   where m.id = p_market and m.owner_id = auth.uid())
          or public.is_admin()
          or (select auth.role()) = 'service_role') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  with ranked as (
    select id, row_number() over (order by is_default desc, created_at asc) as rn
      from public.market_pickup_locations
     where market_id = p_market and active
  ), upd as (
    update public.market_pickup_locations l
       set plan_restricted = (r.rn > allowance), updated_at = now()
      from ranked r
     where l.id = r.id and l.plan_restricted <> (r.rn > allowance)
    returning l.plan_restricted
  )
  select count(*) filter (where not plan_restricted),
         count(*) filter (where plan_restricted)
    into v_kept, v_restricted from upd;
  return query select coalesce(v_kept, 0), coalesce(v_restricted, 0);
end $$;
revoke execute on function public.reconcile_pickup_locations(uuid) from public, anon;

revoke truncate on public.admin_users, public.admin_audit_log, public.admin_plan_grants,
  public.ai_settings, public.ai_agents, public.ai_action_requests, public.ai_usage_log,
  public.storage_locations, public.suppliers, public.ai_rooms, public.ai_room_messages,
  public.seed_products, public.seed_lots, public.seed_inventory_log,
  public.seed_orders, public.seed_order_items, public.profiles, public.listings, public.markets
  from anon, authenticated;
alter default privileges in schema public revoke truncate on tables from anon, authenticated;

revoke execute on function public.market_pickup_location_allowance(uuid) from public, anon, authenticated;
revoke execute on function public.enforce_plan_limit() from public, anon, authenticated;
revoke execute on function public.enforce_delivery_plan() from public, anon, authenticated;

drop policy if exists plan_grants_read on public.admin_plan_grants;
create policy plan_grants_read on public.admin_plan_grants
  for select using (public.admin_has_perm('subscriptions.view'));

create table if not exists public.ai_daily_counter (
  user_id uuid not null,
  feature text not null,
  day date not null,
  count int not null default 0,
  primary key (user_id, feature, day)
);
alter table public.ai_daily_counter enable row level security;
revoke all on public.ai_daily_counter from anon, authenticated;
create or replace function public.ai_reserve_slot(p_uid uuid, p_feature text, p_cap int)
returns boolean language sql security definer set search_path = public as $$
  insert into public.ai_daily_counter (user_id, feature, day, count)
  values (p_uid, p_feature, current_date, 1)
  on conflict (user_id, feature, day)
    do update set count = ai_daily_counter.count + 1
    where ai_daily_counter.count < p_cap
  returning true;
$$;
revoke execute on function public.ai_reserve_slot(uuid, text, int) from public, anon, authenticated;

create or replace function public.admin_daily_brief_service()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'members', (select count(*) from public.profiles),
    'markets', (select count(*) from public.markets),
    'active_listings', (select count(*) from public.listings where status = 'active'),
    'orders_today', (select count(*) from public.market_orders where created_at >= date_trunc('day', now())),
    'seed_orders_open', (select count(*) from public.seed_orders where status in ('paid','selected','needs_review')),
    'plan_mix', (select coalesce(jsonb_object_agg(plan, n), '{}'::jsonb) from
      (select plan, count(*) as n from public.markets group by plan) t),
    'pending_reports', (select count(*) from public.reports where resolved_at is null)
  );
$$;
revoke execute on function public.admin_daily_brief_service() from public, anon, authenticated;

create or replace function public.admin_inventory_summary_service()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'skus', (select count(*) from public.seed_products where not archived),
    'low_stock_items', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
       select p.crop, p.variety,
              coalesce(sum(l.current_qty) filter (where l.status in ('fresh','active')), 0) as available,
              coalesce(p.reorder_threshold, 5) as threshold
         from public.seed_products p
         left join public.seed_lots l on l.seed_product_id = p.id
        where not p.archived
        group by p.id
       having coalesce(sum(l.current_qty) filter (where l.status in ('fresh','active')), 0)
              <= coalesce(p.reorder_threshold, 5)) t),
    'quarantined', (select count(*) from public.seed_lots where status = 'quarantined'),
    'open_orders', (select count(*) from public.seed_orders where status in ('paid','selected','needs_review','packed'))
  );
$$;
revoke execute on function public.admin_inventory_summary_service() from public, anon, authenticated;

create or replace function public.admin_inventory_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.admin_has_perm('inventory.view') then null
         else public.admin_inventory_summary_service() end;
$$;

revoke execute on function public.admin_upsert_seed_product(uuid,text,text,text,text,text,text,text,text,int,int,int,text,boolean) from public, anon;
revoke execute on function public.admin_delete_seed_product(uuid) from public, anon;
revoke execute on function public.admin_receive_lot(uuid,numeric,text,text,text,text,numeric,int,text) from public, anon;
revoke execute on function public.admin_adjust_lot(uuid,numeric,text) from public, anon;
revoke execute on function public.admin_move_lot(uuid,text) from public, anon;
revoke execute on function public.admin_set_lot_status(uuid,text,text) from public, anon;
revoke execute on function public.admin_manage_storage(text,text,boolean) from public, anon;
revoke execute on function public.admin_inventory_summary() from public, anon;
revoke execute on function public.admin_pick_seed_item(uuid) from public, anon;
revoke execute on function public.admin_pack_seed_order(uuid,text) from public, anon;
revoke execute on function public.admin_ship_seed_order(uuid,text,text) from public, anon;
revoke execute on function public.admin_seed_queue() from public, anon;

-- AI read-side kill switch (admin_set_ai_reads) ------------------------------
create or replace function public.admin_set_ai_reads(p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_old boolean;
begin
  if not public.admin_has_perm('ai.kill_switch') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select reads_enabled into v_old from public.ai_settings where id = true;
  update public.ai_settings
     set reads_enabled = p_enabled, updated_by = auth.uid(), updated_at = now()
   where id = true;
  perform public.admin_audit(
    case when p_enabled then 'AI_READS_RESUMED' else 'AI_READS_PAUSED' end,
    'ai_settings', 'singleton',
    jsonb_build_object('reads_enabled', v_old),
    jsonb_build_object('reads_enabled', p_enabled), null);
end $$;
revoke execute on function public.admin_set_ai_reads(boolean) from public, anon;

-- HOTFIX from live QA: seed_products.variety is NOT NULL — coalesce on insert.
-- (admin_upsert_seed_product re-created with coalesce(p_variety, '') in the
-- insert branch; full body lives in prod and mirrors 0077 otherwise.)

notify pgrst, 'reload schema';
