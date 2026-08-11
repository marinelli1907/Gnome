-- 0079: plot gate must read the EFFECTIVE plan, not the raw base plan.
-- Found by a parallel review session: enforce_plot_plan() (from 0022) selected
-- markets.plan directly, so a market on base 'free' with an ACTIVE complimentary
-- Grower/Farm grant was wrongly blocked from offering plots. This was the only
-- enforcement point left reading the raw column instead of
-- market_effective_plan() — every other gate (listing cap, pickup allowance,
-- delivery, my_plan_entitlements) already routes through the resolver.
-- Applied to production via MCP as plot_gate_uses_effective_plan.
-- Live-proven: comp-granted market (base free → effective grower) can now insert
-- a plot; a market resolving to 'free' is still blocked.
create or replace function public.enforce_plot_plan()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pl market_plan;
begin
  if new.listing_type <> 'plot' then return new; end if;

  if new.market_id is null then
    raise exception 'PLOTS_REQUIRE_PLAN'
      using errcode = 'P0001', hint = 'plot listings must belong to a market';
  end if;

  select plan into pl from public.market_effective_plan(new.market_id);
  if pl is null or pl = 'free' then
    raise exception 'PLOTS_REQUIRE_PLAN'
      using errcode = 'P0001',
            hint = 'offering plots requires a Grower or Farm plan';
  end if;

  return new;
end;
$$;
