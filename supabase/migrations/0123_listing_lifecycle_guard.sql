-- 0123: listing lifecycle guard — closes the §12 audit's confirmed defects.
--
-- The audit (8 independent sweeps, adversarially verified) confirmed that the
-- 0104 allowance model guards every RPC but not the TABLE:
--   D1. expires_at is client-writable. On INSERT the 0022 stamper only fills
--       it when NULL, so a crafted insert buys an arbitrary lifetime for one
--       publish. On UPDATE nothing fires at all (the allowance trigger is
--       `update OF status`), so PATCHing expires_at on an active listing is a
--       free, unmetered, permanent renewal — the active->active exploit class
--       0112 closed in renew_listing, still open at the table.
--   D2. listing_type is client-writable on live rows: publish 'free' (spends
--       nothing), then PATCH to 'sale' — a Sell listing that never consumed a
--       publish.
--   D3. market_id NULL skips the gate entirely (enforce_publish_allowance
--       early-returns), and market_id is owner-writable.
--   D4. Listings published before 0104 have no ledger rows, so their FIRST
--       renewal is derived as kind='publish' and inflates publish usage.
--
-- One BEFORE trigger fixes D1–D3 for direct client writes only: server paths
-- (renew_listing, create_market_bundle, publish_listing_draft, admin ops,
-- workers, SQL fixtures) run as the definer/superuser role and are untouched.
-- D4 is a one-time historic backfill that the usage counters ignore.

create or replace function public.listing_lifecycle_guard()
returns trigger language plpgsql as $$
declare
  v_market uuid;
begin
  -- Only direct client writes (PostgREST runs as anon/authenticated). Inside
  -- a SECURITY DEFINER RPC current_user is the function owner, so every
  -- canonical server path — and psql/test fixtures — passes through untouched.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- The lifetime is the server's to grant: discard any caller-supplied
    -- expiry and let the canonical stamper fill it by type (D1-insert).
    new.expires_at := null;
    -- A Sell listing must carry its market or the allowance gate never fires
    -- (D3). Every account gets a Market; attach it, or refuse like the
    -- canonical RPCs do.
    if new.listing_type = 'sale' and new.market_id is null then
      select id into v_market from public.markets
       where owner_id = new.owner_id limit 1;
      if v_market is null then
        raise exception 'NO_MARKET';
      end if;
      new.market_id := v_market;
    end if;
    return new;
  end if;

  -- UPDATE: identity columns are settled at publish time. The type cannot
  -- quietly flip (free->sale would dodge the publish allowance, D2) and the
  -- market binding cannot be dropped or swapped (a NULL market bypasses the
  -- gate, D3). No shipped client writes any of these on update.
  new.listing_type := old.listing_type;
  new.kind := old.kind;
  new.market_id := old.market_id;

  if old.status is distinct from 'active' and new.status = 'active' then
    -- A real activation (relist/restock via direct status write): the
    -- allowance trigger meters it; the lifetime is restamped server-side,
    -- mirroring the 0022 defaults. Client-clock values are ignored.
    new.expires_at := case new.listing_type
      when 'wanted' then now() + interval '30 days'
      when 'plot'   then now() + interval '45 days'
      else               now() + interval '7 days'
    end;
  elsif new.expires_at is distinct from old.expires_at then
    -- Outside an activation, a lifetime change only happens through
    -- renew_listing (D1-update). Silently keep the old value: edits that
    -- merely echo columns back keep working, deliberate tampering does not.
    new.expires_at := old.expires_at;
  end if;
  return new;
end $$;

-- Name sorts before 'listings_before_write' (BEFORE triggers fire in name
-- order), so a nulled INSERT expiry reaches the canonical stamper.
drop trigger if exists listing_lifecycle_guard_trg on public.listings;
create trigger listing_lifecycle_guard_trg
  before insert or update on public.listings
  for each row execute function public.listing_lifecycle_guard();

-- ---------------------------------------------------------------------------
-- D4: one-time ledger backfill for pre-0104 Sell listings. funded='unlimited'
-- keeps every usage counter untouched (publishes_used counts 'included' only)
-- while giving the kind-derivation the publish history it needs, so the first
-- renewal of a legacy listing is metered as a renewal, not a publish.
-- ---------------------------------------------------------------------------
insert into public.listing_publish_events
  (market_id, listing_id, kind, funded, period_start, period_source, plan_at_time, occurred_at, actor)
select l.market_id, l.id, 'publish', 'unlimited',
       date_trunc('month', l.created_at), 'calendar_month',
       coalesce(m.plan, 'free'::public.market_plan), l.created_at, l.owner_id
  from public.listings l
  left join public.markets m on m.id = l.market_id
 where l.listing_type = 'sale'
   and l.market_id is not null
   and not exists (select 1 from public.listing_publish_events e
                    where e.listing_id = l.id and e.kind = 'publish');

-- ---------------------------------------------------------------------------
-- Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'listing_lifecycle_guard_trg') then
    raise exception '0123 self-check: lifecycle guard trigger missing';
  end if;
  if 'listing_lifecycle_guard_trg' >= 'listings_before_write' then
    raise exception '0123 self-check: guard would fire after the canonical stamper';
  end if;
  if exists (select 1 from public.listings l
              where l.listing_type = 'sale' and l.market_id is not null
                and not exists (select 1 from public.listing_publish_events e
                                 where e.listing_id = l.id and e.kind = 'publish')) then
    raise exception '0123 self-check: backfill left a sale listing without publish history';
  end if;
end $$;

notify pgrst, 'reload schema';
