-- Gnome — M2 Listing Types, per "Market Architecture v2" §7. Run after 0001–0005.
-- Additive; V1 + M1 untouched. The six enums already exist from 0005.
--
-- Reconciliation with the V1.1 `kind` enum (offer/wanted): `listing_type` becomes
-- the SOURCE OF TRUTH. `kind` is kept in sync as a derived/deprecated mirror
-- (wanted -> 'wanted'; free/trade/sale -> 'offer') by the listings_before_write
-- trigger below, so all existing kind-based logic (7d/30d expiry, offer->wanted
-- matching, browse) keeps working unchanged.

-- ---------------------------------------------------------------------------
-- New columns (v2 §7)
-- ---------------------------------------------------------------------------
alter table public.listings
  add column if not exists listing_type        listing_type not null default 'free',
  add column if not exists price_cents          integer,
  add column if not exists currency             text default 'USD',
  add column if not exists trade_for            text,
  add column if not exists unit                 text,
  add column if not exists inventory_count      integer,
  add column if not exists allow_partial_claim  boolean not null default false,
  add column if not exists fulfillment_type     listing_fulfillment_type not null default 'pickup',
  add column if not exists payment_status       listing_payment_status not null default 'none',
  add column if not exists seller_note          text,
  add column if not exists buyer_note_required  boolean not null default false,
  add column if not exists is_featured          boolean not null default false,
  add column if not exists featured_until       timestamptz,
  add column if not exists view_count           integer not null default 0,
  add column if not exists claim_count          integer not null default 0;

create index if not exists listings_type_idx on public.listings (listing_type);

-- ---------------------------------------------------------------------------
-- Backfill listing_type from the existing kind (existing offers were free shares)
-- ---------------------------------------------------------------------------
update public.listings
set listing_type = case when kind = 'wanted' then 'wanted'::listing_type
                        else 'free'::listing_type end;

-- ---------------------------------------------------------------------------
-- Integrity (added AFTER backfill so existing rows validate):
--   sale  => price_cents > 0
--   trade => trade_for non-empty
--   inventory_count (when set) > 0
-- ---------------------------------------------------------------------------
alter table public.listings drop constraint if exists listings_sale_price_chk;
alter table public.listings add constraint listings_sale_price_chk
  check (listing_type <> 'sale' or (price_cents is not null and price_cents > 0));

alter table public.listings drop constraint if exists listings_trade_for_chk;
alter table public.listings add constraint listings_trade_for_chk
  check (listing_type <> 'trade' or (trade_for is not null and length(btrim(trade_for)) > 0));

alter table public.listings drop constraint if exists listings_inventory_chk;
alter table public.listings add constraint listings_inventory_chk
  check (inventory_count is null or inventory_count > 0);

-- ---------------------------------------------------------------------------
-- listings_before_write: listing_type is source of truth. Keep `kind` synced,
-- compute expiry by type, and keep the V1.1 fulfilled_by validation.
-- (Replaces the 0003 version; same trigger.)
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
    new.expires_at := now() + (case when new.listing_type = 'wanted'
                                     then interval '30 days'
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

drop trigger if exists listings_before_write on public.listings;
create trigger listings_before_write
  before insert or update on public.listings
  for each row execute function public.listings_before_write();

-- No RLS changes: listings policies (owner-write, public-read active) are unchanged.
