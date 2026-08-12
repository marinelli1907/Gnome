-- 0083: Stripe test-mode hardening — the payment system, provably safe before
-- a single real card is ever charged.
--
-- Pillars:
--  1. livemode EVERYWHERE. Every billing record learns whether it came from a
--     TEST or LIVE Stripe event. Real business revenue = livemode true ONLY;
--     test transactions never contaminate MRR/revenue (Parts 24/25).
--  2. A server-side LIVE-PAYMENTS GATE (billing_config.payments_live_enabled,
--     default FALSE, owner-only + audited). Even with live keys present, Gnome
--     will not create a live Checkout Session until the owner flips it (Part 29).
--  3. Test/live PRICE MAPPING on billing_products (Part 3) + a resolver.
--  4. A billing_events ledger (append-only) linking each Stripe event to its
--     effect for the financial audit trail (Part 34).
-- All additive.

-- ============================================================ livemode flags
alter table public.market_subscriptions   add column if not exists stripe_livemode boolean;
alter table public.seed_orders            add column if not exists stripe_livemode boolean;
alter table public.market_promotion_credits add column if not exists stripe_livemode boolean;
alter table public.listing_promotions     add column if not exists stripe_livemode boolean;
alter table public.stripe_events          add column if not exists livemode boolean;

-- ============================================================ price mapping
alter table public.billing_products
  add column if not exists stripe_product_id_test text,
  add column if not exists stripe_price_id_test text,
  add column if not exists stripe_product_id_live text,
  add column if not exists stripe_price_id_live text;
-- Legacy single columns kept for back-compat; new code reads test/live.

-- billing_price_id(key, mode) → the configured price id for that mode, or null.
create or replace function public.billing_price_id(p_key text, p_mode text)
returns text language sql stable security definer set search_path = public
as $$
  select case when p_mode = 'live' then stripe_price_id_live else stripe_price_id_test end
    from public.billing_products where key = p_key;
$$;
revoke execute on function public.billing_price_id(text,text) from public, anon;
grant execute on function public.billing_price_id(text,text) to authenticated, service_role;

-- ============================================================ live gate + config
create table if not exists public.billing_config (
  id boolean primary key default true check (id),
  payments_live_enabled boolean not null default false,
  stripe_mode text not null default 'test' check (stripe_mode in ('test','live')),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.billing_config (id) values (true) on conflict (id) do nothing;
alter table public.billing_config enable row level security;
drop policy if exists billing_config_read on public.billing_config;
create policy billing_config_read on public.billing_config
  for select using (public.admin_has_perm('subscriptions.view'));
revoke insert, update, delete on public.billing_config from anon, authenticated;
grant select on public.billing_config to authenticated;

-- Owner-only, audited, strong: turn LIVE payments on/off. Default stays OFF.
create or replace function public.admin_set_payments_live(p_enabled boolean)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  update public.billing_config
     set payments_live_enabled = p_enabled,
         stripe_mode = case when p_enabled then 'live' else 'test' end,
         updated_by = auth.uid(), updated_at = now()
   where id = true;
  perform public.admin_audit(
    case when p_enabled then 'PAYMENTS_LIVE_ENABLED' else 'PAYMENTS_LIVE_DISABLED' end,
    'billing_config', 'singleton', null,
    jsonb_build_object('payments_live_enabled', p_enabled), null);
end $$;
revoke execute on function public.admin_set_payments_live(boolean) from public, anon;
grant execute on function public.admin_set_payments_live(boolean) to authenticated;

-- ============================================================ billing ledger
create table if not exists public.billing_events (
  id bigint generated always as identity primary key,
  stripe_event_id text,
  type text not null,
  livemode boolean,
  market_id uuid,
  user_id uuid,
  product_key text,
  amount_cents integer,
  effect text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists billing_events_market_idx on public.billing_events (market_id, created_at desc);
create index if not exists billing_events_mode_idx on public.billing_events (livemode, created_at desc);
alter table public.billing_events enable row level security;
drop policy if exists billing_events_read on public.billing_events;
create policy billing_events_read on public.billing_events
  for select using (public.admin_has_perm('finance.view_transactions') or public.admin_has_perm('subscriptions.view'));
revoke insert, update, delete on public.billing_events from anon, authenticated;
grant select on public.billing_events to authenticated;

-- Service-role writer used by the webhook (append-only).
create or replace function public.billing_log_event(
  p_event text, p_type text, p_livemode boolean, p_market uuid, p_user uuid,
  p_product text, p_amount int, p_effect text, p_meta jsonb default null
) returns void language plpgsql security definer set search_path = public
as $$
begin
  insert into public.billing_events (stripe_event_id, type, livemode, market_id, user_id, product_key, amount_cents, effect, metadata)
  values (p_event, p_type, p_livemode, p_market, p_user, p_product, p_amount, p_effect, p_meta);
end $$;
revoke execute on function public.billing_log_event(text,text,boolean,uuid,uuid,text,int,text,jsonb) from public, anon, authenticated;

-- Idempotent purchased-promotion-credit grant (webhook path). Unique on the
-- Stripe session id: a replayed event grants NOTHING extra (Part 12).
create or replace function public.billing_grant_promo_credit(
  p_market uuid, p_session text, p_livemode boolean, p_qty int default 1,
  p_source text default 'PURCHASED_SINGLE'
) returns boolean language plpgsql security definer set search_path = public
as $$
begin
  insert into public.market_promotion_credits (market_id, delta, reason, source, stripe_session_id, stripe_livemode)
  values (p_market, p_qty, 'Purchased promotion credit', p_source, p_session, p_livemode);
  return true;
exception when unique_violation then
  return false;  -- replay: session already granted
end $$;
revoke execute on function public.billing_grant_promo_credit(uuid,text,boolean,int,text) from public, anon, authenticated;

-- Refund of a purchased promotion credit (before it was consumed). If the
-- market's purchased balance still covers it, claw back one credit; else it
-- already ran and history is preserved (Part 13).
create or replace function public.billing_refund_promo_credit(
  p_session text, p_livemode boolean
) returns text language plpgsql security definer set search_path = public
as $$
declare v_market uuid; v_bal int;
begin
  select market_id into v_market from public.market_promotion_credits
   where stripe_session_id = p_session and delta > 0 limit 1;
  if v_market is null then return 'no_purchase_found'; end if;
  select public.market_purchased_promo_balance(v_market) into v_bal;
  if v_bal <= 0 then return 'already_consumed_history_preserved'; end if;
  insert into public.market_promotion_credits (market_id, delta, reason, source, stripe_livemode)
  values (v_market, -1, 'Refund: promotion purchase reversed', 'REFUND', p_livemode);
  return 'credit_clawed_back';
end $$;
revoke execute on function public.billing_refund_promo_credit(text,boolean) from public, anon, authenticated;

-- ============================================================ REVENUE: real vs test
-- CRITICAL: real business revenue counts livemode = true ONLY. Rows with
-- livemode false (test) or null (pre-0083 / comp) are excluded from MRR and
-- revenue. Test panels read the livemode=false slice separately.
create or replace function public.admin_commercial_overview()
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when not public.admin_has_perm('subscriptions.view') then null else
  jsonb_build_object(
    'plan_mix', (select jsonb_object_agg(plan, n) from (
       select ep.plan::text as plan, count(*) n from public.markets m
       cross join lateral public.market_effective_plan(m.id) ep group by 1) t),
    'source_mix', (select jsonb_object_agg(source, n) from (
       select ep.source, count(*) n from public.markets m
       cross join lateral public.market_effective_plan(m.id) ep group by 1) t),
    -- MRR: live-mode plan subscriptions only.
    'mrr_cents', (select coalesce(sum(pl.price_cents), 0) from public.market_subscriptions s
       join public.plan_limits pl on pl.plan = s.plan
       where s.kind = 'plan' and s.status in ('active','trialing') and s.stripe_livemode is true),
    'active_comp_grants', (select count(*) from public.admin_plan_grants
       where status = 'ACTIVE' and (expires_at is null or expires_at > now())),
    'pickup_addons', (select coalesce(sum(extra_pickup_locations), 0) from public.markets),
    'seed_subscribers_active', (select count(*) from public.seed_drop_subscriptions where status = 'active'),
    'seed_revenue_cents_90d', (select coalesce(sum(amount_cents), 0) from public.seed_orders
       where status in ('paid','selected','packed','shipped') and stripe_livemode is true
         and created_at > now() - interval '90 days'),
    'promotions_active', (select count(*) from public.listing_promotions where status = 'active' and ends_at > now()),
    'promotions_30d', (select count(*) from public.listing_promotions where created_at > now() - interval '30 days'),
    'promo_purchases_cents_30d', (select coalesce(sum(bp.unit_amount_cents * c.delta), 0)
       from public.market_promotion_credits c
       cross join lateral (select unit_amount_cents from public.billing_products where key='GNOME_LISTING_PROMOTION') bp
       where c.source in ('PURCHASED_SINGLE','PURCHASED_PACK_3','PURCHASED_PACK_10')
         and c.stripe_livemode is true and c.created_at > now() - interval '30 days'),
    'growers_near_cap', (select count(*) from public.markets m
       cross join lateral public.market_effective_plan(m.id) ep
       where ep.plan = 'grower' and public.market_active_listing_count(m.id) >= 20),
    -- TEST-mode totals, clearly separated so QA is visible but never mixed in.
    'test', jsonb_build_object(
      'plan_subs', (select count(*) from public.market_subscriptions where kind='plan' and status in ('active','trialing') and stripe_livemode is false),
      'seed_revenue_cents', (select coalesce(sum(amount_cents),0) from public.seed_orders where stripe_livemode is false),
      'promo_purchases', (select count(*) from public.market_promotion_credits where source like 'PURCHASED%' and stripe_livemode is false))
  ) end;
$$;
revoke execute on function public.admin_commercial_overview() from public, anon;
grant execute on function public.admin_commercial_overview() to authenticated;

-- ============================================================ BILLING HEALTH
-- Product mapping status + gate + last events. No secret values (booleans only).
create or replace function public.admin_billing_health()
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when not public.admin_has_perm('subscriptions.view') then null else
  jsonb_build_object(
    'payments_live_enabled', (select payments_live_enabled from public.billing_config where id),
    'stripe_mode', (select stripe_mode from public.billing_config where id),
    'products', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', key, 'description', description, 'unit_amount_cents', unit_amount_cents, 'active', active,
        'test_ready', stripe_price_id_test is not null,
        'live_ready', stripe_price_id_live is not null
      ) order by key), '[]'::jsonb) from public.billing_products),
    'last_event', (select jsonb_build_object('type', type, 'livemode', livemode, 'at', received_at)
       from public.stripe_events order by received_at desc limit 1),
    'last_test_payment', (select jsonb_build_object('type', type, 'amount_cents', amount_cents, 'at', created_at)
       from public.billing_events where livemode is false and amount_cents is not null order by created_at desc limit 1),
    'last_live_payment', (select jsonb_build_object('type', type, 'amount_cents', amount_cents, 'at', created_at)
       from public.billing_events where livemode is true and amount_cents is not null order by created_at desc limit 1),
    'events_test_30d', (select count(*) from public.billing_events where livemode is false and created_at > now() - interval '30 days'),
    'events_live_30d', (select count(*) from public.billing_events where livemode is true and created_at > now() - interval '30 days')
  ) end;
$$;
revoke execute on function public.admin_billing_health() from public, anon;
grant execute on function public.admin_billing_health() to authenticated;

-- ============================================================ product keys
-- Ensure every canonical key exists (unit amounts; price ids stay owner config).
insert into public.billing_products (key, kind, description, unit_amount_cents, currency, active) values
  ('GNOME_GROWER_MONTHLY','subscription','Grower plan, monthly',999,'usd',true),
  ('GNOME_FARM_MONTHLY','subscription','Farm plan, monthly',2999,'usd',true),
  ('GNOME_PICKUP_LOCATION_ADDON','addon','Extra pickup location, per unit monthly',500,'usd',true),
  ('GNOME_LISTING_PROMOTION','one_time','Featured listing promotion, 7 days',399,'usd',true),
  ('GNOME_SEED_DROP_SEASONAL','subscription','Seasonal Seed Drop, per season',2499,'usd',true),
  ('GNOME_GROWER_SEED_BUNDLE','subscription','Grower + Seed Drop bundle, annual',19900,'usd',false),
  ('GNOME_FARM_SEED_BUNDLE','subscription','Farm + Seed Drop bundle, annual',42900,'usd',false)
on conflict (key) do update set unit_amount_cents = excluded.unit_amount_cents, description = excluded.description;

notify pgrst, 'reload schema';
