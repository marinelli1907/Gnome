-- Gnome — billing foundation (2026-08-10).
--
-- CANONICAL PRODUCT MAP (Part 26): one server-side row per sellable thing.
-- Stripe product/price ids are OWNER CONFIG — they stay NULL until the owner
-- creates them in the Stripe dashboard and fills them in (or sets the
-- matching STRIPE_PRICE_* function secrets; the webhook checks both). The
-- client never carries a price id; it reads this table for display only.
--
-- ENTITLEMENT SOURCE OF TRUTH (Part 28): Stripe webhook (service role) is the
-- ONLY writer of markets.plan / markets.extra_pickup_locations /
-- seed_drop_subscriptions billing states. 0064's column grants make the
-- client physically unable to write them; my_plan_entitlements() is the one
-- resolved read. Chain: Stripe event → webhook → markets/subscriptions rows →
-- plan_limits join → enforcement triggers + UI.
--
-- REPLAY IDEMPOTENCY (Part 34): every processed Stripe event id is recorded;
-- a replayed event is acknowledged and skipped.

create table if not exists public.billing_products (
  key text primary key,
  kind text not null check (kind in ('subscription','one_time','addon')),
  description text not null,
  unit_amount_cents int,
  currency text not null default 'usd',
  stripe_product_id text,
  stripe_price_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.billing_products (key, kind, description, unit_amount_cents) values
  ('GNOME_GROWER_MONTHLY',       'subscription', 'Grower plan, monthly',                        999),
  ('GNOME_FARM_MONTHLY',         'subscription', 'Farm plan, monthly',                          2999),
  ('GNOME_PICKUP_LOCATION_ADDON','addon',        'Extra pickup location (per location, monthly)', 500),
  ('GNOME_SEED_DROP_ONE_TIME',   'one_time',     'Seed Drop box, one-time',                     null),
  ('GNOME_SEED_DROP_SUBSCRIPTION','subscription','Seed Drop subscription (monthly or seasonal)', null)
on conflict (key) do nothing;

alter table public.billing_products enable row level security;

drop policy if exists billing_products_read on public.billing_products;
create policy billing_products_read on public.billing_products
  for select using (true);
drop policy if exists billing_products_admin on public.billing_products;
create policy billing_products_admin on public.billing_products
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.billing_products to anon, authenticated;

-- Processed Stripe events — insert-first, skip on conflict.
create table if not exists public.stripe_events (
  id text primary key,           -- evt_...
  type text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- service role only; no client policies at all.
revoke all on public.stripe_events from anon, authenticated;

notify pgrst, 'reload schema';
