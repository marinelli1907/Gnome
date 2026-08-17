-- 0125: renew_listing must meter a listing that is PAST its expiry but whose
-- status column still reads 'active'.
--
-- Found by the §13 adversarial reviewers as a residual RISK surviving 0112 and
-- 0123, and re-measured here against the REAL resolver 0124 §1 recovered (the
-- one-column stub fourteen runners install cannot express a complimentary
-- grant, so the original measurement was taken under a plan resolver production
-- does not use).
--
-- THE WINDOW. Expiry converges in two places that do not agree instantly:
-- expires_at is the truth, and status is swept to 'expired' by the 0018 pg_cron
-- job on '*/15 * * * *'. So for up to fifteen minutes after a listing expires it
-- sits status='active' AND expires_at < now(). expires_at is a readable column,
-- so a seller can time that window exactly, every seven days, forever.
--
-- WHAT HAPPENED IN IT. renew_listing's idempotent branch (0112) returns early
-- only when the listing is active AND unexpired, so an expired-but-active row
-- correctly fell through to the renewal UPDATE. That UPDATE sets status =
-- 'active' on a row whose status is ALREADY 'active', and
-- enforce_publish_allowance (0104) opens with
--
--     if tg_op = 'UPDATE' and old.status = 'active' then return new; end if;
--
-- an exemption that exists so ordinary edits to a live listing are not
-- re-metered, and which 0112's own header relies on. The renewal therefore
-- restamped expires_at to now()+7d while consuming NO renewal entitlement,
-- requiring NO $0.99 payment, and writing NO ledger row — and then reported
-- funded='included' by reading the PREVIOUS publish event, so the ledger looked
-- undisturbed because it was undisturbed.
--
-- Measured on PG17 with 0124's real resolver, every metered tier extended for
-- free (consumed=0) inside the window, while the same listing one sweep later
-- metered correctly — free and allowance-exhausted markets being REFUSED
-- outright. The free plan carries included_renewals_per_period = 0, so for it
-- the window was a total bypass of paid renewal.
--
-- THE FIX, and why it is here rather than in the trigger. The invariant wanted
-- is "renew_listing always presents a transition INTO active". Demoting the row
-- first restores exactly that: the subsequent UPDATE becomes expired->active,
-- which enforce_publish_allowance meters as it always has — included while the
-- allowance lasts, then a paid authorization, then PUBLISH_ALLOWANCE_EXHAUSTED.
-- Relaxing the trigger's active->active exemption instead would re-meter every
-- ordinary edit of a live listing and change behaviour under bundles, drops and
-- admin ops; this touches one function and no policy. The demote is invisible
-- outside the transaction (the row is locked FOR UPDATE two statements earlier)
-- and no trigger on listings reacts to 'expired' — it is a state the sweep
-- writes routinely.
--
-- Not changed: the idempotent fresh-listing branch, the ownership check, the
-- lifetime lookup, the return shape, and the grants.

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

  -- Past this point the listing is DUE: either the sweep already wrote
  -- 'expired'/'paused', or it is still 'active' with expires_at <= now() and the
  -- sweep has not caught up. Demote that second case so the renewal below is a
  -- real transition INTO active and the allowance trigger meters it. Without
  -- this the UPDATE is active->active, which the trigger deliberately exempts —
  -- a free, unmetered, indefinitely repeatable renewal.
  if l.status = 'active' then
    update public.listings set status = 'expired' where id = p_listing;
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

-- Same exposure as 0104/0112: sellers call it, anon does not. Re-stated because
-- CREATE OR REPLACE preserves grants, but a fresh local replay applies files in
-- order and must end up identical.
revoke execute on function public.renew_listing(uuid) from public, anon;
grant  execute on function public.renew_listing(uuid) to authenticated;

-- Self-check: the exemption this migration exists to close is a SILENT one, so
-- assert the pieces it depends on are actually present rather than trusting the
-- apply. A missing allowance trigger would make the demote pointless and the
-- bypass would reopen with no error anywhere.
do $$
begin
  if to_regproc('public.enforce_publish_allowance') is null then
    raise exception '0125 self-check: enforce_publish_allowance missing; the demote meters nothing';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.listings'::regclass
                    and tgname = 'trg_enforce_publish_allowance'
                    and not tgisinternal) then
    raise exception '0125 self-check: trg_enforce_publish_allowance not attached to listings';
  end if;
  if to_regproc('public.market_effective_plan') is null then
    raise exception '0125 self-check: market_effective_plan missing (0124 §1)';
  end if;
end $$;

notify pgrst, 'reload schema';
