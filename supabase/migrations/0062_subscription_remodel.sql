-- Gnome — subscription remodel (2026-08-10).
--
--   Neighbor (free):  5 active listings · 1 pickup location
--   Grower  ($9.99):  50 active listings · 2 pickup locations included,
--                     additional locations $5/mo each (purchasable add-on)
--   Farm   ($29.99):  unlimited listings · 5 pickup locations
--   Sponsor ($99):    untouched by this remodel except unlimited listings
--                     (was 500 — a sponsor should never trail farm)
--
-- "Unlimited" is NULL in max_active_listings — enforce_plan_limit (0008)
-- already returns early on a NULL cap, so no enforcement change is needed.
--
-- The $5/mo location add-on is DATA, not billing: plan_limits carries the
-- price (extra_location_fee_cents; NULL = add-ons not offered on that plan)
-- and markets.extra_pickup_locations counts purchased slots. Billing wiring
-- comes later; until then the column is admin-set and defaults to 0, so
-- nothing changes for existing sellers. Enforcement stays server-side:
-- market_pickup_location_allowance() now adds purchased slots on plans that
-- offer them, and both the location-limit trigger and
-- reconcile_pickup_locations() read allowance through that one function.

alter table public.plan_limits alter column max_active_listings drop not null;
alter table public.plan_limits add column if not exists extra_location_fee_cents integer;

alter table public.markets
  add column if not exists extra_pickup_locations integer not null default 0
    check (extra_pickup_locations >= 0 and extra_pickup_locations <= 20);

update public.plan_limits set max_active_listings = 5                            where plan = 'free';
update public.plan_limits set max_active_listings = 50, max_pickup_locations = 2,
                              extra_location_fee_cents = 500                     where plan = 'grower';
update public.plan_limits set max_active_listings = null, max_pickup_locations = 5 where plan = 'farm';
update public.plan_limits set max_active_listings = null                         where plan = 'sponsor';

create or replace function public.market_pickup_location_allowance(p_market uuid)
returns integer
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(pl.max_pickup_locations, 1)
       + case when pl.extra_location_fee_cents is not null
              then coalesce(m.extra_pickup_locations, 0)
              else 0 end
    from public.markets m
    left join public.plan_limits pl on pl.plan = m.plan
   where m.id = p_market;
$$;

notify pgrst, 'reload schema';
