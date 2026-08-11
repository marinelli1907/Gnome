-- Gnome — Seed Drop grows a real order/subscription lifecycle (2026-08-10).
--
-- The flat $12 Payment Link stops being the architecture. Two product shapes:
--   ONE_TIME       — existing seed_orders path (0028), unchanged.
--   SUBSCRIPTION   — this table: cadence, status, address, preferences, and a
--                    generator that turns due subscriptions into seed_orders
--                    through the SAME deterministic engine (generate_seed_drop)
--                    and the SAME packet-unit inventory. No substitutions, no
--                    out-of-stock selections — engine behavior is unchanged.
--
-- CADENCE DECISION (Part 21): monthly and seasonal only; SEASONAL is the
-- default — it matches planting cycles and sealed-packet inventory reality.
-- No weekly seeds.
--
-- BILLING POSTURE: no live recurring charges. A subscription is created
-- 'incomplete' and only the Stripe webhook (service role) activates it or
-- advances billing state. Client column grants make entitlement fields
-- unreachable from the app (0064 pattern).
--
-- SEALED PACKETS (Part 23): inventory stays packet-unit (seed_lots.unit
-- 'packets' preserved); reorder_threshold supports garage-scale restocking,
-- storage_location already exists on lots (bins).

alter table public.seed_products
  add column if not exists reorder_threshold int check (reorder_threshold >= 0);

create table if not exists public.seed_drop_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  cadence text not null default 'seasonal' check (cadence in ('monthly','seasonal')),
  status text not null default 'incomplete' check (status in
    ('active','paused','cancelled','payment_failed','incomplete')),
  packet_count int not null default 6 check (packet_count between 1 and 24),
  next_order_date date,
  ship_name text,
  ship_address_line text,
  ship_city text,
  ship_state text,
  ship_postal_code text,
  profile_snapshot jsonb not null default '{}',
  preferences text[] not null default '{}',
  exclusions text[] not null default '{}',
  stripe_customer_id text,
  stripe_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists seed_drop_subs_user_idx on public.seed_drop_subscriptions (user_id);
create index if not exists seed_drop_subs_due_idx on public.seed_drop_subscriptions (next_order_date)
  where status = 'active';

alter table public.seed_drop_subscriptions enable row level security;

drop policy if exists seed_subs_own on public.seed_drop_subscriptions;
create policy seed_subs_own on public.seed_drop_subscriptions
  for all using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- Client may manage its own preferences/address/pause — never billing state
-- or the order clock.
revoke all on public.seed_drop_subscriptions from anon;
revoke insert, update on public.seed_drop_subscriptions from authenticated;
grant select on public.seed_drop_subscriptions to authenticated;
grant insert (user_id, cadence, packet_count, ship_name, ship_address_line,
              ship_city, ship_state, ship_postal_code,
              profile_snapshot, preferences, exclusions)
  on public.seed_drop_subscriptions to authenticated;
grant update (cadence, status, packet_count, ship_name, ship_address_line,
              ship_city, ship_state, ship_postal_code,
              preferences, exclusions, updated_at)
  on public.seed_drop_subscriptions to authenticated;

-- Status transitions a signed-in user may make: pause/resume/cancel. Billing
-- states (incomplete → active, payment_failed) belong to the webhook, which
-- runs as service role (auth.uid() is null here).
create or replace function public.seed_sub_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.status is distinct from old.status then
      if not (
        (old.status = 'active'    and new.status in ('paused','cancelled')) or
        (old.status = 'paused'    and new.status in ('active','cancelled')) or
        (old.status = 'incomplete' and new.status = 'cancelled')
      ) then
        raise exception 'BAD_TRANSITION: % → % is not yours to make', old.status, new.status
          using errcode = 'P0001';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists seed_subs_guard on public.seed_drop_subscriptions;
create trigger seed_subs_guard
  before update on public.seed_drop_subscriptions
  for each row execute function public.seed_sub_guard();

-- ---------------------------------------------------------------------------
-- Skip: push next_order_date one cadence out without generating an order.
-- ---------------------------------------------------------------------------
create or replace function public.skip_next_seed_order(p_sub uuid)
returns date
language plpgsql
security definer
set search_path to 'public'
as $$
declare s public.seed_drop_subscriptions;
begin
  select * into s from public.seed_drop_subscriptions
   where id = p_sub and (user_id = auth.uid() or public.is_admin())
   for update;
  if s is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if s.status <> 'active' or s.next_order_date is null then
    raise exception 'NOT_ACTIVE' using errcode = 'P0001';
  end if;
  update public.seed_drop_subscriptions
     set next_order_date = s.next_order_date
           + case when s.cadence = 'monthly' then interval '1 month' else interval '3 months' end,
         updated_at = now()
   where id = p_sub;
  return (select next_order_date from public.seed_drop_subscriptions where id = p_sub);
end $$;

grant execute on function public.skip_next_seed_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Generation: a due subscription becomes a seed_order through the existing
-- engine. Admin/service only (the webhook calls it after an invoice is paid;
-- admins can dry-run). p_paid=false creates a pending_payment order and does
-- NOT advance the clock — a safe rehearsal.
-- ---------------------------------------------------------------------------
create or replace function public.generate_seed_subscription_order(
  p_sub uuid,
  p_paid boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.seed_drop_subscriptions;
  prof public.seed_profiles;
  v_order uuid;
  v_reserved int;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select * into s from public.seed_drop_subscriptions where id = p_sub for update;
  if s is null then raise exception 'SUB_NOT_FOUND' using errcode = 'P0001'; end if;
  if s.status not in ('active') and p_paid then
    raise exception 'SUB_NOT_ACTIVE: %', s.status using errcode = 'P0001';
  end if;

  select * into prof from public.seed_profiles where user_id = s.user_id;

  insert into public.seed_orders
    (user_id, product, packet_count, status, profile_snapshot, notes)
  values
    (s.user_id, 'subscription', s.packet_count,
     case when p_paid then 'paid' else 'pending_payment' end,
     coalesce(to_jsonb(prof), '{}'::jsonb)
       || jsonb_build_object('subscription_id', s.id, 'cadence', s.cadence,
                             'preferences', s.preferences, 'exclusions', s.exclusions,
                             'ship', jsonb_build_object(
                               'name', s.ship_name, 'address', s.ship_address_line,
                               'city', s.ship_city, 'state', s.ship_state,
                               'postal_code', s.ship_postal_code)),
     'subscription ' || s.id)
  returning id into v_order;

  if p_paid then
    -- Engine reserves real packet inventory; out-of-stock is never selected
    -- and shortfalls park the order in needs_review — both engine behaviors.
    select public.generate_seed_drop(v_order) into v_reserved;
    update public.seed_drop_subscriptions
       set next_order_date = coalesce(s.next_order_date, current_date)
             + case when s.cadence = 'monthly' then interval '1 month' else interval '3 months' end,
           updated_at = now()
     where id = p_sub;
  end if;

  return v_order;
end $$;

notify pgrst, 'reload schema';
