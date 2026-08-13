-- 0084: transactional webhook helpers the Stripe handler calls. Each is
-- idempotent on the Stripe session/order so replays and out-of-order retries
-- apply at most once (Parts 12, 14, 22, 23).

-- Buy-to-promote: grant one purchased credit for this session AND immediately
-- promote the listing, atomically. Idempotent: a replayed session neither
-- double-grants nor double-promotes.
create or replace function public.billing_purchase_and_promote(
  p_session text, p_livemode boolean, p_market uuid, p_listing uuid, p_amount int
) returns text language plpgsql security definer set search_path = public
as $$
declare v_owns boolean; v_promo uuid;
begin
  -- replay guard: this session already recorded a purchase → done.
  if exists (select 1 from public.market_promotion_credits where stripe_session_id = p_session) then
    return 'replay';
  end if;
  select exists (select 1 from public.listings where id = p_listing and market_id = p_market) into v_owns;
  if not v_owns then return 'listing_market_mismatch'; end if;

  -- +1 purchased credit (unique on session → replay-safe).
  insert into public.market_promotion_credits (market_id, delta, reason, source, stripe_session_id, stripe_livemode)
  values (p_market, 1, 'Purchased promotion (checkout)', 'PURCHASED_SINGLE', p_session, p_livemode);

  -- activate 7-day promotion if the listing is still promotable + not already featured
  if exists (select 1 from public.listings where id = p_listing and status = 'active' and expires_at > now())
     and not exists (select 1 from public.listing_promotions where listing_id = p_listing and status='active' and ends_at > now()) then
    insert into public.listing_promotions (listing_id, market_id, source, status, stripe_livemode)
    values (p_listing, p_market, 'paid', 'active', p_livemode) returning id into v_promo;
    insert into public.market_promotion_credits (market_id, delta, reason, source, promotion_id, stripe_livemode)
    values (p_market, -1, 'Promotion activated (checkout)', 'CONSUMED', v_promo, p_livemode);
    return 'promoted';
  end if;
  -- otherwise the credit simply sits in the ledger for later use
  return 'credit_only';
end $$;
revoke execute on function public.billing_purchase_and_promote(text,boolean,uuid,uuid,int) from public, anon, authenticated;

-- Seasonal Seed Drop payment: move the subscriber's order for this window from
-- pending_payment → paid. If the wave hasn't been generated yet, generate this
-- subscriber's order now (paid). Idempotent on the Stripe session id.
create or replace function public.billing_pay_seed_seasonal(
  p_session text, p_livemode boolean, p_sub uuid, p_amount int
) returns text language plpgsql security definer set search_path = public
as $$
declare s public.seed_drop_subscriptions; v_win uuid; v_order uuid;
begin
  if exists (select 1 from public.seed_orders where stripe_session_id = p_session) then
    return 'replay';
  end if;
  select * into s from public.seed_drop_subscriptions where id = p_sub for update;
  if s is null then return 'sub_not_found'; end if;

  -- current eligible window for this subscriber
  select nw.window_id into v_win from public.seed_sub_next_window(p_sub) nw;

  -- existing pending order for the window?
  select id into v_order from public.seed_orders
   where user_id = s.user_id and season_window_id = v_win
     and status = 'pending_payment' limit 1;

  if v_order is null then
    -- generate this subscriber's order now (paid path handles reservation)
    v_order := public.generate_seed_subscription_order(p_sub, true);
    update public.seed_orders set season_window_id = v_win where id = v_order;
  end if;

  update public.seed_orders
     set status = 'paid', stripe_session_id = p_session,
         stripe_livemode = p_livemode, amount_cents = coalesce(p_amount, price_from_sub(s)),
         updated_at = now()
   where id = v_order;
  return 'paid:'||v_order::text;
end $$;
revoke execute on function public.billing_pay_seed_seasonal(text,boolean,uuid,int) from public, anon, authenticated;

-- tiny helper so the above can default the amount from the sub's price
create or replace function public.price_from_sub(s public.seed_drop_subscriptions)
returns int language sql immutable as $$ select coalesce(s.price_cents, 2499); $$;

-- Bundle activation: set the seller plan AND activate the seed subscription,
-- atomically. Idempotent by (market, stripe subscription).
create or replace function public.billing_activate_bundle(
  p_market uuid, p_user uuid, p_plan market_plan, p_sub_stripe text,
  p_customer text, p_livemode boolean
) returns void language plpgsql security definer set search_path = public
as $$
begin
  -- seller plan (same table the plan path uses)
  update public.markets set plan = p_plan where id = p_market;
  insert into public.market_subscriptions (market_id, plan, kind, provider, customer_id, subscription_id, status, stripe_livemode)
  values (p_market, p_plan, 'plan', 'stripe', p_customer, p_sub_stripe, 'active', p_livemode)
  on conflict do nothing;
  -- seed access: activate (or create) the user's seasonal subscription
  update public.seed_drop_subscriptions
     set status = 'active', stripe_customer_id = p_customer, stripe_subscription_id = p_sub_stripe
   where user_id = p_user;
  if not found then
    insert into public.seed_drop_subscriptions (user_id, cadence, status, packet_count, profile_snapshot, stripe_customer_id, stripe_subscription_id)
    values (p_user, 'seasonal', 'active', 6, coalesce((select to_jsonb(sp) from public.seed_profiles sp where sp.user_id = p_user), '{}'::jsonb), p_customer, p_sub_stripe);
  end if;
  perform public.reconcile_pickup_locations(p_market);
end $$;
revoke execute on function public.billing_activate_bundle(uuid,uuid,market_plan,text,text,boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';