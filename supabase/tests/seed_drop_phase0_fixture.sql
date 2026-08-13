-- Minimal stand-in for the production objects that 0089 builds on, so Phase 0
-- can be tested on a throwaway local database. TEST FIXTURE ONLY — never
-- applied to a hosted project.
--
-- Shapes mirror production exactly for the columns 0089 reads or extends
-- (introspected 2026-08-13 from fgybyghwcjlstqxkclch). Behaviour that Phase 0
-- does not touch is stubbed to the smallest thing that type-checks.

create table if not exists public.profiles (
  id uuid primary key, name text, created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(), name text not null,
  contact text, website text, account_ref text, notes text,
  active boolean not null default true, created_at timestamptz not null default now()
);

create table if not exists public.storage_locations (
  id uuid primary key default gen_random_uuid(), name text not null,
  zone text, archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.seed_products (
  id uuid primary key default gen_random_uuid(),
  crop text not null, variety text not null, botanical_name text, description text,
  category text not null, days_to_germination int, days_to_maturity int,
  preferred_sun text not null default 'full',
  direct_sow_allowed boolean not null default true,
  transplant_recommended boolean not null default false,
  spacing_inches numeric, planting_depth_inches numeric,
  sow_months int[] not null default '{}', beginner_friendly boolean not null default true,
  container_friendly boolean not null default false,
  packet_seed_count int not null default 25,
  tags text[] not null default '{}', active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  reorder_threshold int, sku text, supplier text, supplier_product_code text,
  packet_size text, barcode text, cost_cents int, suggested_reorder_qty int,
  image_url text, archived boolean not null default false
);

create table if not exists public.seed_lots (
  id uuid primary key default gen_random_uuid(),
  seed_product_id uuid not null references public.seed_products(id),
  supplier text, supplier_lot_number text, internal_lot_number text not null unique,
  purchase_date date, received_date date not null default current_date,
  original_qty numeric not null, current_qty numeric not null,
  unit text not null default 'packets', seeds_per_unit numeric, cost_cents int,
  germination_pct numeric, germination_test_date date, next_review_date date,
  storage_location text, condition_notes text,
  status text not null default 'active'
    constraint seed_lots_status_check
    check (status in ('fresh','active','aging','quarantined','depleted')),
  notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.seed_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, product text not null default 'starter',
  packet_count int not null default 6,
  status text not null default 'paid'
    constraint seed_orders_status_check
    check (status in ('pending_payment','paid','reserved','picked','packed','shipped',
                      'cancelled','needs_review')),
  profile_snapshot jsonb not null default '{}', stripe_session_id text,
  amount_cents int, tracking text, planting_confirmed_at timestamptz, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  season_window_id uuid, postage_cents int, packaging_cents int, insert_cents int,
  payment_fee_cents int, other_cost_cents int, stripe_livemode boolean
);

create table if not exists public.seed_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.seed_orders(id) on delete cascade,
  seed_product_id uuid references public.seed_products(id),
  lot_id uuid references public.seed_lots(id),
  qty_packets int not null default 1, status text not null default 'reserved',
  substituted_from uuid, substitution_reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.seed_drop_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, cadence text not null default 'seasonal',
  status text not null default 'incomplete', packet_count int not null default 6,
  next_order_date date, ship_name text, ship_address_line text, ship_city text,
  ship_state text, ship_postal_code text,
  profile_snapshot jsonb not null default '{}',
  preferences text[] not null default '{}', exclusions text[] not null default '{}',
  stripe_customer_id text, stripe_subscription_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  billing_model text not null default 'PAY_PER_SEASON', price_cents int not null default 2499
);

create table if not exists public.seed_inventory_log (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid references public.seed_lots(id) on delete cascade,
  delta numeric, reason text, order_id uuid, actor uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(), action text, resource_type text,
  resource_id text, old_value jsonb, new_value jsonb, reason text,
  actor uuid, actor_type text, approval uuid,
  created_at timestamptz not null default now()
);

-- Admin identity stubs. The tests drive these through GUCs so a single session
-- can play owner, permissioned admin, plain user and anon in turn.
create or replace function public.admin_is_owner() returns boolean
language sql stable as $$
  select coalesce(current_setting('test.is_owner', true), 'false')::boolean
$$;
create or replace function public.admin_has_perm(p_perm text) returns boolean
language sql stable as $$
  select p_perm = any(string_to_array(coalesce(current_setting('test.perms', true), ''), ','))
$$;
create or replace function public.is_admin() returns boolean
language sql stable as $$ select public.admin_is_owner() $$;

-- A product that exists BEFORE 0089 runs, carrying the old
-- `packet_seed_count NOT NULL DEFAULT 25` assumption. 0089's backfill has to
-- label it LEGACY_ASSUMED_25 rather than trust it or zero it.
insert into public.seed_products (crop, variety, category)
values ('Lettuce', 'Legacy Default', 'vegetable')
on conflict do nothing;

create or replace function public.admin_audit(
  p_action text, p_resource_type text, p_resource_id text, p_old jsonb,
  p_new jsonb, p_reason text, p_actor_type text, p_approval uuid
) returns void language sql as $$
  insert into public.admin_audit_log
    (action, resource_type, resource_id, old_value, new_value, reason, actor, actor_type, approval)
  values (p_action, p_resource_type, p_resource_id, p_old, p_new, p_reason,
          auth.uid(), p_actor_type, p_approval);
$$;
