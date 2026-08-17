-- Gnome — admin-gated read of a seller's allowance usage.
--
-- WHY A WRAPPER AND NOT A GRANT
-- market_allowance_usage(uuid) is revoked from authenticated, deliberately: it takes a market id,
-- so granting it would let any signed-in seller read any other seller's usage by passing an id.
-- The admin app authenticates as an ordinary user, so it cannot call it — and the fix is NOT to
-- loosen that grant.
--
-- This wrapper keeps the boundary where it belongs: is_admin() is checked server-side, inside a
-- SECURITY DEFINER function, before any usage is read. The admin app gains exactly one new
-- capability and sellers gain none. A UI need never justifies widening a grant.
--
-- Run after 0107. Idempotent.

create or replace function public.admin_market_allowance(p_market uuid)
returns table (
  market_id                uuid,
  market_name              text,
  owner_id                 uuid,
  owner_email              text,
  plan                     public.market_plan,   -- internal enum, admin-only
  display_name             text,                 -- customer-facing name
  period_start             timestamptz,
  period_end               timestamptz,
  period_source            text,
  publishes_allowed        int,
  publishes_used           int,
  publishes_actual         int,
  paid_publishes_period    int,
  publishes_remaining      int,
  renewals_allowed         int,
  renewals_used            int,
  renewals_actual          int,
  paid_renewals_period     int,
  renewals_remaining       int,
  paid_publishes_lifetime  int,
  paid_renewals_lifetime   int,
  paid_cents_period        int,
  paid_cents_lifetime      int,
  active_listings          int,
  expired_listings         int
)
language plpgsql stable security definer set search_path = public
as $$
declare u record; m record;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'P0001';
  end if;

  select mk.id, mk.name, mk.owner_id into m from public.markets mk where mk.id = p_market;
  if m.id is null then return; end if;

  select * into u from public.market_allowance_usage(p_market);
  if u.plan is null then return; end if;

  market_id   := m.id;
  market_name := m.name;
  owner_id    := m.owner_id;
  select au.email::text into owner_email from auth.users au where au.id = m.owner_id;

  -- Straight passthrough. Nothing is recomputed here: actual is NOT used + paid, which happens to
  -- hold on metered plans and is wrong on Farm, where all activity is funded='unlimited' and
  -- included usage is legitimately 0 while actual is 47.
  plan                    := u.plan;
  display_name            := u.display_name;
  period_start            := u.period_start;
  period_end              := u.period_end;
  period_source           := u.period_source;
  publishes_allowed       := u.publishes_allowed;
  publishes_used          := u.publishes_used;
  publishes_actual        := u.publishes_actual;
  paid_publishes_period   := u.paid_publishes_period;
  publishes_remaining     := u.publishes_remaining;
  renewals_allowed        := u.renewals_allowed;
  renewals_used           := u.renewals_used;
  renewals_actual         := u.renewals_actual;
  paid_renewals_period    := u.paid_renewals_period;
  renewals_remaining      := u.renewals_remaining;
  paid_publishes_lifetime := u.paid_publishes_lifetime;
  paid_renewals_lifetime  := u.paid_renewals_lifetime;
  paid_cents_period       := u.paid_cents_period;
  paid_cents_lifetime     := u.paid_cents_lifetime;

  -- Listing counts are a property of the listings table, not of the allowance ledger, so they are
  -- counted here rather than bolted onto the usage RPC the seller card also consumes. Sell only,
  -- matching what the allowance actually meters.
  select
    count(*) filter (where l.status = 'active'),
    count(*) filter (where l.status = 'expired')
  into active_listings, expired_listings
  from public.listings l
  where l.market_id = p_market and l.listing_type = 'sale';

  return next;
end $$;

revoke execute on function public.admin_market_allowance(uuid) from public, anon;
-- REVOKE ... FROM PUBLIC strips the default grant `authenticated` inherits, so without this the
-- admin app could not call the function at all. The grant is re-added explicitly and narrowly.
grant execute on function public.admin_market_allowance(uuid) to authenticated;

-- authenticated retains EXECUTE because the admin app signs in as an ordinary user; is_admin()
-- inside the function is the actual gate, exactly as every other admin_* RPC here works. A
-- non-admin caller reaches the function and is refused by it.
do $$
begin
  if has_function_privilege('anon', 'public.admin_market_allowance(uuid)', 'execute') then
    raise exception '0108: anon can execute admin_market_allowance — the REVOKE did not take.';
  end if;
  if has_function_privilege('authenticated', 'public.market_allowance_usage(uuid)', 'execute') then
    raise exception
      '0108: authenticated can execute market_allowance_usage(uuid) again. That is the grant 0107 '
      'removed on purpose — it takes a market id, so it reads ANY seller. The admin surface must '
      'go through admin_market_allowance, never through a widened grant.';
  end if;
end $$;

notify pgrst, 'reload schema';
