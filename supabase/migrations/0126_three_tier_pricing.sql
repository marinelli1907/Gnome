-- 0126: Free / Pro / Farm — the three-tier simplification.
--
-- Owner direction (2026-08-18): customer-facing "Max" disappears; Pro means
-- "I sell regularly" with no listing arithmetic; Farm means "I run a real
-- farm/business" at $29.99. The naming trap this migration navigates, stated
-- plainly because getting it backwards restructures the wrong tier: the enum
-- value `farm` is customer-facing "Max" ($29.99), and `sponsor` is
-- customer-facing "Farm" ($99). See plan_limits.display_name, or the comments
-- in 0104 §mapping.
--
-- STRATEGY: RE-POINT, DO NOT REMOVE. Enum `farm` keeps its value and its
-- $29.99 price and simply becomes customer-facing "Farm", lifted to the
-- capability set `sponsor` already had. `sponsor` retires from sale (its
-- Stripe SKU deactivates) but the enum value survives as the internal
-- house/comp rung it already is in market_effective_plan and the admin grant
-- machinery. Dropping an enum value would mean recreating market_plan across
-- five dependents and is the one irreversible move available here — and it
-- buys nothing.
--
-- VERIFIED BEFORE WRITING (production, read-only, 2026-08-18): zero rows in
-- market_subscriptions ever, zero in admin_plan_grants ever, zero markets on
-- 'farm' or 'sponsor', zero active Sell listings anywhere. Nobody is migrated
-- by this because there is nobody to migrate; it is a pre-customer re-point.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH:
--   * free stays 3 publishes/month, 0 included renewals, $0.99 overage. The
--     "3 ACTIVE Sell listings + $0.99 slot" semantics from the design spec is
--     a real product change to enforce_publish_allowance (publish-events vs
--     active-slots) with open owner decisions (slot scope, expiry model) and
--     a concurrency design of its own — it ships separately, not as a rider
--     on a display rename.
--   * included_renewals_per_period stays 0 on free. Setting it NULL would hit
--     enforce_publish_allowance's unlimited early-exit and reopen — wider —
--     the exact bypass 0125 closed. (Found by adversarial review of the first
--     draft of this plan; the paid tiers below are safe because unlimited is
--     the *intended* behavior there.)
--   * anti-spam rails stay on every tier (max_sale_publishes_per_hour,
--     free wanted_intros_per_day): "unlimited selling" is not "unlimited
--     posting velocity".
--
-- ROLLBACK (exact inverse, values read from production before this ran):
--   update plan_limits set monthly_publish_allowance=20,
--     included_renewals_per_period=3, max_active_listings=25 where plan='grower';
--   update plan_limits set display_name='Max', monthly_publish_allowance=40,
--     included_renewals_per_period=10, max_pickup_locations=5,
--     wanted_intros_per_day=15, max_sale_publishes_per_hour=60 where plan='farm';
--   update plan_limits set display_name='Farm' where plan='sponsor';
--   update billing_products set active=true where key='GNOME_SPONSOR_MONTHLY';

-- Pro: unlimited Sell. NULL means "no cap" to every reader of these columns
-- (enforce_publish_allowance treats NULL allowance as the unlimited tier).
update public.plan_limits
   set monthly_publish_allowance = null,
       included_renewals_per_period = null,
       max_active_listings = null
 where plan = 'grower';

-- Customer-facing Farm is now the enum row that already charges $29.99,
-- lifted to the full capability set sponsor carried.
update public.plan_limits
   set display_name = 'Farm',
       monthly_publish_allowance = null,
       included_renewals_per_period = null,
       max_pickup_locations = 10,
       wanted_intros_per_day = null,
       max_sale_publishes_per_hour = 120
 where plan = 'farm';

-- sponsor retires from sale. The display name says what it now is; the enum
-- value, rank and limits survive for market_effective_plan and comp grants.
update public.plan_limits
   set display_name = 'Legacy Farm'
 where plan = 'sponsor';

update public.billing_products
   set active = false,
       -- Kept in lockstep with billing-admin's CATALOG entry, which mirrors
       -- migration seeds verbatim so a rebuilt environment and a migrated one
       -- describe the same SKU identically (the 0124 rule).
       description = 'Legacy Farm (retired 0126; internal comp rung only)'
 where key = 'GNOME_SPONSOR_MONTHLY';

-- Self-check: the rename direction is the whole point, so assert it rather
-- than trusting the apply. If 'Max' survives anywhere, or two sellable rows
-- both claim the name Farm, fail loudly.
do $$
declare bad int;
begin
  select count(*) into bad from public.plan_limits where display_name = 'Max';
  if bad > 0 then raise exception '0126 self-check: display_name Max still present'; end if;

  select count(*) into bad from public.plan_limits pl
   join public.billing_products bp
     on bp.key = 'GNOME_' || upper(pl.plan::text) || '_MONTHLY' and bp.active
   where pl.display_name = 'Farm' and pl.plan <> 'farm';
  if bad > 0 then raise exception '0126 self-check: a second sellable Farm row exists'; end if;

  if (select monthly_publish_allowance from public.plan_limits where plan='grower') is not null then
    raise exception '0126 self-check: Pro is still metered';
  end if;
  if (select included_renewals_per_period from public.plan_limits where plan='free') is distinct from 0 then
    raise exception '0126 self-check: free renewals changed — that is the 0125 bypass, revert immediately';
  end if;
  if (select active from public.billing_products where key='GNOME_SPONSOR_MONTHLY') then
    raise exception '0126 self-check: GNOME_SPONSOR_MONTHLY still sellable';
  end if;
end $$;

notify pgrst, 'reload schema';
