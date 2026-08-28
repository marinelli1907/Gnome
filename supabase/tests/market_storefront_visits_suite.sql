\set ON_ERROR_STOP on

select set_config('request.jwt.claims','{"role":"service_role"}',false);

do $$
begin
  if position('auth.users' in pg_get_viewdef('public.public_markets'::regclass, true)) > 0 then
    raise exception 'public_markets still depends directly on auth.users';
  end if;
end $$;

do $$
declare
  v_seller uuid := 'b1000000-0000-4000-8000-000000000001';
  v_buyer uuid := 'b1000000-0000-4000-8000-000000000002';
  v_seller_market uuid;
  v_buyer_market uuid;
  v_location uuid;
begin
  select id into v_seller_market from public.markets where owner_id = v_seller order by created_at limit 1;
  select id into v_buyer_market from public.markets where owner_id = v_buyer order by created_at limit 1;

  update public.markets set status = 'active' where id in (v_seller_market, v_buyer_market);

  insert into public.admin_plan_grants
    (market_id,user_id,plan,starts_at,expires_at,status,reason,reason_code,grant_source)
  values
    (v_seller_market,v_seller,'grower',now()-interval '1 minute',now()+interval '1 day',
     'ACTIVE','Storefront visit QA','INTERNAL_QA','ADMIN');

  insert into public.market_pickup_locations
    (market_id,nickname,location_type,timezone,slot_minutes,lead_time_minutes,
     max_orders_per_slot,active,is_default,plan_restricted)
  values
    (v_seller_market,'Farm stand','PUBLIC_FARM_STAND','America/New_York',30,0,null,true,true,false)
  returning id into v_location;

  -- Exercise the legacy cross-platform editor path: location_id is omitted and
  -- must be attached by the migration trigger for the slot engine to see it.
  insert into public.market_pickup_hours (market_id,weekday,start_minute,end_minute)
  select v_seller_market, day_number, 0, 1440 from generate_series(0,6) day_number;

  if exists (
    select 1 from public.market_pickup_hours
     where market_id = v_seller_market and location_id is distinct from v_location
  ) then
    raise exception 'legacy hours were not attached to the default pickup location';
  end if;

  insert into public.market_follows(market_id,follower_id)
  values(v_seller_market,v_buyer);

  if not exists (
    select 1 from public.public_markets
     where id = v_seller_market and follower_count = 1 and scheduling_enabled
  ) then
    raise exception 'public storefront aggregate/scheduling projection is wrong';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='public_markets'
       and column_name in ('follower_id','address_line','pickup_address')
  ) then
    raise exception 'public storefront exposes follower identity or private address';
  end if;
end $$;

set role anon;
do $$
declare
  v_seller_market uuid;
begin
  select id into v_seller_market
    from public.public_markets
   where name = 'Apple QA''s Market'
   limit 1;
  if v_seller_market is null then
    raise exception 'anonymous storefront projection is not readable';
  end if;
  if exists (select 1 from public.market_follows) then
    raise exception 'anonymous user can enumerate follower identities';
  end if;
end $$;
reset role;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b1000000-0000-4000-8000-000000000002"}',false);

do $$
declare
  v_seller_market uuid;
  v_buyer_market uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_visit uuid;
begin
  select id into v_seller_market
    from public.markets where owner_id='b1000000-0000-4000-8000-000000000001'
    order by created_at limit 1;
  select id into v_buyer_market
    from public.markets where owner_id='b1000000-0000-4000-8000-000000000002'
    order by created_at limit 1;

  select slot_start,slot_end into v_start,v_end
    from public.market_available_slots(v_seller_market,3)
   order by slot_start limit 1;
  if v_start is null then raise exception 'paid storefront generated no visit slot'; end if;

  v_visit := public.create_market_visit_request(v_seller_market,v_start,v_end,'  Looking forward to visiting.  ');

  if not exists (
    select 1 from public.market_orders
     where id=v_visit and request_kind='VISIT' and status='REQUESTED'
       and buyer_id='b1000000-0000-4000-8000-000000000002'
       and subtotal_cents=0 and buyer_note='Looking forward to visiting.'
  ) then
    raise exception 'valid visit request was not persisted safely';
  end if;
  if exists (select 1 from public.market_order_items where order_id=v_visit) then
    raise exception 'visit request unexpectedly contains purchasable items';
  end if;

  begin
    perform public.create_market_visit_request(
      v_seller_market,v_start+interval '7 minutes',v_end+interval '7 minutes',null);
    raise exception 'forged visit time unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%SLOT_UNAVAILABLE%' then raise; end if;
  end;

  begin
    perform public.create_market_visit_request(v_buyer_market,v_start,v_end,null);
    raise exception 'owner requested a visit to their own Market';
  exception when others then
    if sqlerrm not like '%OWN_MARKET%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b1000000-0000-4000-8000-000000000001"}',false);

do $$
declare
  v_free_market uuid;
  v_start timestamptz := now()+interval '1 day';
  v_visit uuid;
begin
  select id into v_free_market
    from public.markets where owner_id='b1000000-0000-4000-8000-000000000002'
    order by created_at limit 1;
  begin
    perform public.create_market_visit_request(v_free_market,v_start,v_start+interval '30 minutes',null);
    raise exception 'free Market unexpectedly accepted a visit request';
  exception when others then
    if sqlerrm not like '%SUBSCRIPTION_REQUIRED%' then raise; end if;
  end;

  select id into v_visit
    from public.market_orders
   where request_kind='VISIT'
     and market_id=(select id from public.markets where owner_id='b1000000-0000-4000-8000-000000000001' order by created_at limit 1)
   order by created_at desc limit 1;
  perform public.confirm_market_order(v_visit);
  if (select status from public.market_orders where id=v_visit) <> 'CONFIRMED' then
    raise exception 'seller confirmation did not advance visit';
  end if;
  perform public.complete_market_order(v_visit,false,'cash',null);
  if (select status from public.market_orders where id=v_visit) <> 'COMPLETED' then
    raise exception 'seller completion did not close visit';
  end if;
  if exists (select 1 from public.seller_transactions where order_id=v_visit) then
    raise exception 'visit created a sale/payment record';
  end if;
end $$;

select set_config('request.jwt.claims','{"role":"service_role"}',false);

do $$
begin
  if not has_column_privilege('authenticated','public.market_orders','request_kind','select') then
    raise exception 'order parties cannot read visit discriminator';
  end if;
  if has_column_privilege('authenticated','public.market_orders','delivery_address','select') then
    raise exception 'private delivery address grant widened';
  end if;
  if (select payments_live_enabled from public.billing_config where id) then
    raise exception 'payments live changed';
  end if;
end $$;

\echo 'Paid Market storefront visit contract suite: PASS'
