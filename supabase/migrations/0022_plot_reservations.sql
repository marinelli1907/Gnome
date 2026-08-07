-- Gnome — M11 Phase 1 "Reserve a Plot", part 2 of 2. Run after 0021.
--
-- A plot listing = ONE reservable plot (one listing per plot; approve a
-- reservation and the existing claim-approval trigger flips the listing to
-- 'claimed', hiding it from the marketplace and auto-declining other pending
-- requests — exactly the semantics a reservation needs, for free).
--
-- Reservations reuse the claims engine as claim_type 'plot_reservation':
--   buyer_note           = what the buyer wants grown (required)
--   agreed_price_cents   = reservation price snapshot at request time
--   payment_status       = 'external' (arranged in person; NO escrow in Phase 1)
--
-- Offering plots is a paid-plan (grower/farm/sponsor) feature, enforced
-- server-side like the 0008 plan cap; the web catches PLOTS_REQUIRE_PLAN and
-- shows an upgrade prompt.

-- ---------------------------------------------------------------------------
-- Listings: a plot must carry a reservation price.
-- ---------------------------------------------------------------------------
alter table public.listings drop constraint if exists listings_plot_price_chk;
alter table public.listings add constraint listings_plot_price_chk
  check (listing_type <> 'plot' or (price_cents is not null and price_cents > 0));

-- ---------------------------------------------------------------------------
-- Expiry by type: plots stay up 45 days by default (a growing-season offer,
-- not a basket of tomatoes). Replaces the 0006 listings_before_write body;
-- everything else is unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.listings_before_write()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  want record;
begin
  -- Keep the deprecated `kind` mirror in sync with the source-of-truth type.
  new.kind := case when new.listing_type = 'wanted' then 'wanted'::listing_kind
                   else 'offer'::listing_kind end;

  -- Expiry by type, only when the caller didn't provide one.
  if tg_op = 'INSERT' and new.expires_at is null then
    new.expires_at := now() + (case
      when new.listing_type = 'wanted' then interval '30 days'
      when new.listing_type = 'plot'   then interval '45 days'
      else interval '7 days' end);
  end if;

  -- "Offer against a want" link integrity (unchanged from M1.1).
  if new.fulfilled_by_listing_id is not null then
    select kind, owner_id into want
      from public.listings where id = new.fulfilled_by_listing_id;
    if not found then
      raise exception 'fulfilled_by_listing_id % does not exist', new.fulfilled_by_listing_id;
    end if;
    if want.kind <> 'wanted' then
      raise exception 'fulfilled_by_listing_id must reference a wanted post';
    end if;
    if want.owner_id = new.owner_id then
      raise exception 'cannot fulfill your own wanted post';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Plan gate: only paid-plan markets can offer plots. Mirrors the 0008
-- enforce_plan_limit pattern (separate BEFORE trigger, recognizable errcode).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_plot_plan()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  pl market_plan;
begin
  if new.listing_type <> 'plot' then return new; end if;

  if new.market_id is null then
    raise exception 'PLOTS_REQUIRE_PLAN'
      using errcode = 'P0001', hint = 'plot listings must belong to a market';
  end if;

  select plan into pl from public.markets where id = new.market_id;
  if pl is null or pl = 'free' then
    raise exception 'PLOTS_REQUIRE_PLAN'
      using errcode = 'P0001',
            hint = 'offering plots requires a Grower or Farm plan';
  end if;

  return new;
end;
$$;

drop trigger if exists listings_enforce_plot_plan on public.listings;
create trigger listings_enforce_plot_plan
  before insert on public.listings
  for each row execute function public.enforce_plot_plan();

-- ---------------------------------------------------------------------------
-- Claims: allow the new type; a reservation must say what to grow and carry
-- the price snapshot. (claim_type is text+CHECK from 0007 — replace in place.)
-- ---------------------------------------------------------------------------
alter table public.claims drop constraint if exists claims_claim_type_check;
alter table public.claims add constraint claims_claim_type_check
  check (claim_type in ('claim','trade_offer','purchase_request','wanted_response','plot_reservation'));

alter table public.claims drop constraint if exists claims_plot_reservation_chk;
alter table public.claims add constraint claims_plot_reservation_chk
  check (
    claim_type <> 'plot_reservation'
    or (
      buyer_note is not null and length(btrim(buyer_note)) > 0
      and agreed_price_cents is not null and agreed_price_cents >= 0
    )
  );

-- No RLS changes: claims_insert_claimer / claims_select_involved /
-- claims_update_involved and the approve→claimed trigger all apply as-is.

notify pgrst, 'reload schema';
