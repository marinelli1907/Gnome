-- Gnome — M4 Plan Limits + Monetization instrumentation, per v2 §9 + §16.
-- Run after 0001–0007. Additive; payments still OFFLINE (no Stripe).
-- plan_limits is already seeded (free=10, grower=100, farm=500, sponsor=500).
-- Monetization events are just new event_type strings in the existing `events`
-- table — no events schema change.

-- ---------------------------------------------------------------------------
-- Active-listing count for a market (server-side, authoritative)
-- ---------------------------------------------------------------------------
create or replace function public.market_active_listing_count(mid uuid)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select count(*)::int
  from public.listings
  where market_id = mid and status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- Enforce the plan's active-listing cap on INSERT of an active listing.
-- Reads the market's plan -> plan_limits.max_active_listings. Raises a
-- recognizable exception the app catches to show an upgrade prompt.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_plan_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  pl  market_plan;
  cap integer;
  cur integer;
begin
  -- Only active listings count toward the cap; market_id is required to enforce.
  if new.status <> 'active' or new.market_id is null then
    return new;
  end if;

  select plan into pl from public.markets where id = new.market_id;
  if pl is null then return new; end if;

  select max_active_listings into cap from public.plan_limits where plan = pl;
  if cap is null then return new; end if;

  cur := public.market_active_listing_count(new.market_id);
  if cur >= cap then
    raise exception 'PLAN_LIMIT_REACHED'
      using errcode = 'P0001',
            hint = format('active listing cap of %s reached for plan %s', cap, pl);
  end if;

  return new;
end;
$$;

-- Separate BEFORE INSERT trigger. Fires after listings_before_write (alphabetical
-- order: b < e), so kind/type/expiry are already normalized before we count.
drop trigger if exists listings_enforce_plan_limit on public.listings;
create trigger listings_enforce_plan_limit
  before insert on public.listings
  for each row execute function public.enforce_plan_limit();

-- ---------------------------------------------------------------------------
-- Log a market_created monetization event when a profile's default Market is
-- created. Extends the 0005 handle_new_profile (security definer -> bypasses
-- events RLS for this server-side write). Existing backfilled markets have no
-- historical event, which is fine.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  mid uuid := gen_random_uuid();
  nm  text := coalesce(nullif(trim(new.name), ''), 'Neighbor') || '''s Garden';
begin
  insert into public.markets (id, owner_id, name, slug)
  values (mid, new.id, nm, public.gnome_slugify(nm) || '-' || substr(mid::text, 1, 8));

  insert into public.market_members (market_id, user_id, role)
  values (mid, new.id, 'owner')
  on conflict (market_id, user_id) do nothing;

  insert into public.events (event_type, user_id, metadata)
  values ('market_created', new.id, jsonb_build_object('market_id', mid));

  return new;
end;
$$;

-- (Trigger on_profile_created already points at this function from 0005.)
