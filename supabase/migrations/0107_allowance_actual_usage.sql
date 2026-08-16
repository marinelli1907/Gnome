-- Gnome — separate ALLOWANCE, INCLUDED USAGE, ACTUAL ACTIVITY and PAID OVERAGE.
--
-- WHY
-- 0104 answered one question: how much of the plan's entitlement has been spent. The seller UI has
-- to answer a second, different one: how much did I actually do this period. Those diverge in two
-- places, and 0104 could not express either.
--
--   Farm reads as ZERO. publishes_used counts only funded='included', and the unlimited branch of
--   enforce_publish_allowance writes funded='unlimited'. A Farm seller who published 47 listings
--   sees 0, because nothing they did was "included" — it was uncapped.
--
--   Paid overages vanish. A Pro seller with 20 included and 3 paid has done 23 publishes, but
--   publishes_used stays pinned at 20 and paid_publishes was a LIFETIME total, so the period figure
--   did not exist at all.
--
-- The fix is more fields, not cleverer ones. Overloading publishes_used to mean both would produce
-- exactly the nonsense the spec forbids — "23 of 20 used, -3 remaining".
--
--   allowance          what the plan grants          publishes_allowed      (NULL = unlimited)
--   included usage     entitlement consumed          publishes_used         (never exceeds allowance)
--   actual activity    everything that happened      publishes_actual       (included + paid + unlimited)
--   paid overage       bought beyond entitlement     paid_publishes_period
--   remaining          entitlement left              publishes_remaining    (NULL = unlimited, never < 0)
--
-- Lifetime totals are kept and RENAMED to *_lifetime. They were previously called paid_publishes
-- and paid_renewals, which sat next to per-period fields and read as though they shared a period.
-- Nothing consumes them yet — 0104-0106 are unapplied — so the rename costs nothing now and
-- prevents a whole class of misread later.
--
-- Every *_period value uses market_allowance_period() — the SAME boundary the allowance itself
-- uses. A second interpretation of "this month" would let the numbers disagree with each other.
--
-- Run after 0106. Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Recreate, in dependency order
-- ---------------------------------------------------------------------------
-- Postgres cannot widen a RETURNS TABLE in place: CREATE OR REPLACE fails with "cannot change
-- return type of existing function". my_listing_allowance selects * from market_allowance_usage,
-- so it must go first and come back after.
drop function if exists public.my_listing_allowance();
drop function if exists public.market_allowance_usage(uuid);

create or replace function public.market_allowance_usage(p_market uuid)
returns table (
  plan                     public.market_plan,
  display_name             text,
  period_start             timestamptz,
  period_end               timestamptz,
  period_source            text,

  -- allowance
  publishes_allowed        int,     -- NULL = unlimited
  renewals_allowed         int,     -- NULL = unlimited

  -- included usage (entitlement consumed; never exceeds allowance)
  publishes_used           int,
  renewals_used            int,

  -- actual activity this period (included + paid + unlimited)
  publishes_actual         int,
  renewals_actual          int,

  -- paid overage this period
  paid_publishes_period    int,
  paid_renewals_period     int,
  paid_cents_period        int,

  -- lifetime, for admin/accounting. Explicitly NOT period-scoped.
  paid_publishes_lifetime  int,
  paid_renewals_lifetime   int,
  paid_cents_lifetime      int,

  -- remaining entitlement (NULL = unlimited)
  publishes_remaining      int,
  renewals_remaining       int,

  listing_lifetime_days    int,
  qr_tools                 boolean,
  wanted_intros_per_day    int
)
language plpgsql stable security definer set search_path = public
as $$
declare
  eff record; per record; lim record;
begin
  select ep.plan into eff from public.market_effective_plan(p_market) ep;
  if eff.plan is null then return; end if;

  select * into per from public.market_allowance_period(p_market);
  select pl.* into lim from public.plan_limits pl where pl.plan = eff.plan;

  plan                  := eff.plan;
  display_name          := coalesce(lim.display_name, eff.plan::text);
  period_start          := per.period_start;
  period_end            := per.period_end;
  period_source         := per.source;
  publishes_allowed     := lim.monthly_publish_allowance;
  renewals_allowed      := lim.included_renewals_per_period;
  listing_lifetime_days := coalesce(lim.listing_lifetime_days, 7);
  qr_tools              := coalesce(lim.qr_tools, false);
  wanted_intros_per_day := lim.wanted_intros_per_day;

  -- Every reference is table-qualified: this function's OUT parameters share names with
  -- listing_publish_events columns, and an unqualified one resolves to the PL/pgSQL variable,
  -- silently comparing a column to itself.
  --
  -- 'included' is entitlement spent. 'actual' is everything that happened, which for an unlimited
  -- plan is entirely funded='unlimited' — the reason Farm previously read as zero. admin_grant is
  -- counted as activity but never as entitlement, since it was given rather than bought or owed.
  select
    count(*) filter (where e.kind = 'publish' and e.funded = 'included'),
    count(*) filter (where e.kind = 'renewal' and e.funded = 'included'),
    count(*) filter (where e.kind = 'publish'),
    count(*) filter (where e.kind = 'renewal'),
    count(*) filter (where e.kind = 'publish' and e.funded = 'paid'),
    count(*) filter (where e.kind = 'renewal' and e.funded = 'paid')
  into publishes_used, renewals_used, publishes_actual, renewals_actual,
       paid_publishes_period, paid_renewals_period
  from public.listing_publish_events e
  where e.market_id = p_market and e.period_start = per.period_start;

  -- Money is read from the authorizations, not the ledger: the ledger records that an action was
  -- paid for, the authorization records what it cost. Scoped by the authorization it funded so a
  -- payment lands in the period it was SPENT in, matching the counts above.
  select coalesce(sum(a.amount_cents), 0)::int into paid_cents_period
  from public.listing_publish_authorizations a
  where a.market_id = p_market
    and a.status = 'consumed'
    and exists (
      select 1 from public.listing_publish_events e2
       where e2.authorization_id = a.id and e2.period_start = per.period_start);

  select
    count(*) filter (where e.kind = 'publish' and e.funded = 'paid'),
    count(*) filter (where e.kind = 'renewal' and e.funded = 'paid')
  into paid_publishes_lifetime, paid_renewals_lifetime
  from public.listing_publish_events e
  where e.market_id = p_market;

  select coalesce(sum(a.amount_cents), 0)::int into paid_cents_lifetime
  from public.listing_publish_authorizations a
  where a.market_id = p_market and a.status in ('paid','consumed');

  -- greatest(0, …) is belt and braces: included usage cannot exceed the allowance because the
  -- trigger stops issuing 'included' rows at the cap, but a negative "remaining" reaching the UI
  -- is precisely the nonsense this migration exists to prevent.
  publishes_remaining := case when publishes_allowed is null then null
                              else greatest(0, publishes_allowed - publishes_used) end;
  renewals_remaining  := case when renewals_allowed  is null then null
                              else greatest(0, renewals_allowed  - renewals_used)  end;
  return next;
end $$;

-- The seller's own view. Pinned to auth.uid() through their market: it takes NO user parameter, so
-- there is nothing for a client to substitute in order to read somebody else's usage.
--
-- The column list is spelled out rather than `setof record` because PostgREST cannot call a
-- record-returning function without a runtime column definition — that would compile here and fail
-- from every client.
create or replace function public.my_listing_allowance()
returns table (
  plan                     public.market_plan,
  display_name             text,
  period_start             timestamptz,
  period_end               timestamptz,
  period_source            text,
  publishes_allowed        int,
  renewals_allowed         int,
  publishes_used           int,
  renewals_used            int,
  publishes_actual         int,
  renewals_actual          int,
  paid_publishes_period    int,
  paid_renewals_period     int,
  paid_cents_period        int,
  paid_publishes_lifetime  int,
  paid_renewals_lifetime   int,
  paid_cents_lifetime      int,
  publishes_remaining      int,
  renewals_remaining       int,
  listing_lifetime_days    int,
  qr_tools                 boolean,
  wanted_intros_per_day    int
)
language plpgsql stable security definer set search_path = public
as $$
declare m uuid;
begin
  select id into m from public.markets where owner_id = auth.uid() limit 1;
  if m is null then return; end if;
  return query select * from public.market_allowance_usage(m);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Grants, re-applied because DROP took them with it
-- ---------------------------------------------------------------------------
-- DROP FUNCTION discards the ACL. Recreating without restating these leaves market_allowance_usage
-- executable by PUBLIC — the default — which would let any authenticated caller read any market's
-- usage by passing an id. This repo has been bitten three times by grants silently going missing
-- after a schema change; the assertion below is why that cannot happen quietly a fourth time.
revoke execute on function public.market_allowance_usage(uuid) from public, anon, authenticated;
revoke execute on function public.my_listing_allowance()       from public, anon;
grant  execute on function public.my_listing_allowance()       to authenticated;

do $$
begin
  if has_function_privilege('authenticated', 'public.market_allowance_usage(uuid)', 'execute') then
    raise exception
      '0107: authenticated can execute market_allowance_usage(uuid). It takes a market id, so that '
      'is a read of any seller''s usage. The REVOKE above did not take effect.';
  end if;
  if not has_function_privilege('authenticated', 'public.my_listing_allowance()', 'execute') then
    raise exception
      '0107: authenticated cannot execute my_listing_allowance(). The seller dashboard would be '
      'empty for every user.';
  end if;
end $$;

notify pgrst, 'reload schema';
