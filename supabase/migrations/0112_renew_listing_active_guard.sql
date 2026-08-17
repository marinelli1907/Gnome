-- 0112: renew_listing must not extend a listing that is already fresh.
--
-- Found during the deployed end-to-end pass: renew_listing() ran its UPDATE unconditionally, and
-- the allowance trigger deliberately ignores active→active updates (it only gates transitions
-- INTO 'active'). Together that meant calling renew_listing on a listing that was already active
-- reset expires_at to now()+7d WITHOUT consuming a renewal or writing a ledger event — a seller
-- with nothing but curl could loop the RPC daily and keep every listing alive forever for free.
--
-- The repair: when the listing is already active and unexpired, answer idempotently — ok=true,
-- the CURRENT expires_at, funding of the period as recorded in the ledger — and touch nothing.
-- Idempotent success (rather than an error) is deliberate: the mobile flow retries renew_listing
-- after the $0.99 webhook lands, and a double-tap or a second poll must read as "you're done",
-- not as a new failure. The expired/paused path is unchanged: the status flip to 'active' runs
-- the allowance trigger, which decides included vs paid vs refuse exactly as before.

create or replace function public.renew_listing(p_listing uuid)
returns table (ok boolean, expires_at timestamptz, funded text)
language plpgsql security definer set search_path = public
as $$
declare
  l    public.listings;
  days int;
  ev   record;
begin
  select * into l from public.listings where id = p_listing for update;
  if not found then raise exception 'LISTING_NOT_FOUND' using errcode = 'P0001'; end if;

  if not exists (select 1 from public.markets m
                  where m.id = l.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_YOUR_LISTING' using errcode = 'P0001';
  end if;

  -- Already fresh: report the existing state, extend nothing, consume nothing.
  if l.status = 'active' and (l.expires_at is null or l.expires_at > now()) then
    select e.funded into ev
    from public.listing_publish_events e
    where e.listing_id = p_listing
    order by e.occurred_at desc limit 1;

    ok := true;
    expires_at := l.expires_at;
    funded := coalesce(ev.funded, 'included');
    return next;
    return;
  end if;

  select coalesce(pl.listing_lifetime_days, 7) into days
  from public.market_effective_plan(l.market_id) ep
  join public.plan_limits pl on pl.plan = ep.plan;

  -- The allowance trigger decides included vs paid vs refuse as the status flips to active.
  update public.listings
     set status = 'active', expires_at = now() + make_interval(days => coalesce(days, 7))
   where id = p_listing;

  select e.funded into ev
  from public.listing_publish_events e
  where e.listing_id = p_listing
  order by e.occurred_at desc limit 1;

  ok := true;
  expires_at := now() + make_interval(days => coalesce(days, 7));
  funded := coalesce(ev.funded, 'included');
  return next;
end $$;

-- Same exposure as 0104: sellers call it, anon does not. Re-stated because CREATE OR REPLACE
-- preserves grants, but a fresh local replay applies files in order and must end up identical.
revoke execute on function public.renew_listing(uuid) from public, anon;
grant  execute on function public.renew_listing(uuid) to authenticated;

notify pgrst, 'reload schema';
