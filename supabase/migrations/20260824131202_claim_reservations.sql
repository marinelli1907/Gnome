-- 0128: Claim-side reservations for single-listing purchase requests.
--
-- Market orders already have a full multi-item REQUESTED -> CONFIRMED ->
-- READY -> COMPLETED lifecycle with atomic inventory and seller ledger writes.
-- This migration updates the older single-listing claims path so a "Reserve"
-- request behaves like a quantity reservation instead of claiming an entire
-- sale listing.
--
-- Design:
--   * REQUESTED/pending never consumes inventory.
--   * APPROVED sale/plot claims reserve quantity atomically by decrementing the
--     listing inventory under a row lock.
--   * A sale listing with remaining inventory stays active; pending buyers are
--     not auto-declined until the listing is sold out.
--   * CANCELLED/DECLINED/EXPIRED from approved returns the reserved quantity.
--   * COMPLETED does not touch inventory again; it records the existing
--     off-platform seller ledger exactly once per claim.
--   * No Stripe or custody path is introduced.

alter table public.claims
  add column if not exists payment_method text
    check (payment_method is null or payment_method in ('cash','venmo','cashapp','paypal','zelle','other')),
  add column if not exists pickup_start timestamptz,
  add column if not exists pickup_end timestamptz;

-- Existing seller ledger allowed PayPal only through Market orders by mapping
-- it to "other". Make the direct claim path explicit too, because payment is
-- still off-platform and seller-confirmed.
alter table public.seller_transactions drop constraint if exists seller_transactions_payment_method_check;
alter table public.seller_transactions add constraint seller_transactions_payment_method_check
  check (payment_method in ('cash','venmo','zelle','cashapp','paypal','check','external_card','other','gnome'));

create or replace function public._claim_reserved_qty(c public.claims)
returns int
language plpgsql
immutable
as $$
begin
  return greatest(1, coalesce(c.quantity_requested, 1));
end;
$$;
revoke all on function public._claim_reserved_qty(public.claims) from public, anon, authenticated;

create or replace function public._payment_method_from_claim(c public.claims)
returns text
language plpgsql
immutable
as $$
begin
  if c.payment_method in ('cash','venmo','cashapp','paypal','zelle','other') then
    return c.payment_method;
  end if;
  return 'other';
end;
$$;
revoke all on function public._payment_method_from_claim(public.claims) from public, anon, authenticated;

create or replace function public.handle_claim_status()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  l public.listings;
  qty int;
  txn uuid;
begin
  select * into l from public.listings where id = new.listing_id for update;
  if l is null then
    return new;
  end if;

  qty := public._claim_reserved_qty(new);

  if new.status = 'approved' and old.status is distinct from 'approved' then
    if l.listing_type in ('sale','plot') and l.inventory_count is not null then
      if l.inventory_count < qty then
        raise exception 'INSUFFICIENT_INVENTORY: % left', l.inventory_count using errcode = 'P0001';
      end if;

      update public.listings
         set inventory_count = inventory_count - qty,
             status = case
               when inventory_count - qty <= 0 then 'claimed'::listing_status
               else 'active'::listing_status
             end
       where id = new.listing_id;

      -- Quantity-based reservations can coexist while inventory remains.
      -- Once this approval sells out the listing, close unresolved siblings.
      if l.inventory_count - qty <= 0 then
        update public.claims
           set status = 'declined'
         where listing_id = new.listing_id
           and id <> new.id
           and status = 'pending';
      end if;
    else
      update public.listings set status = 'claimed' where id = new.listing_id;
      update public.claims
         set status = 'declined'
       where listing_id = new.listing_id
         and id <> new.id
         and status = 'pending';
    end if;

  elsif new.status in ('cancelled', 'declined', 'expired') and old.status = 'approved' then
    if l.listing_type in ('sale','plot') and l.inventory_count is not null then
      update public.listings
         set inventory_count = inventory_count + public._claim_reserved_qty(old),
             status = case when status = 'claimed' then 'active'::listing_status else status end
       where id = new.listing_id;
    else
      update public.listings set status = 'active'
       where id = new.listing_id and status = 'claimed';
    end if;

  elsif new.status = 'completed' and old.status is distinct from 'completed' then
    -- Completion finalizes a reservation already taken out of availability.
    -- Do NOT call record_sale(): that RPC decrements listing inventory.
    if l.listing_type = 'sale'
       and new.claim_type = 'purchase_request'
       and l.market_id is not null
       and new.agreed_price_cents is not null then
      insert into public.seller_transactions
        (market_id, listing_id, claim_id, source, quantity, gross_cents,
         discount_cents, fee_cents, payment_method, buyer_label, notes, status)
      values
        (l.market_id, l.id, new.id, 'request', qty, new.agreed_price_cents,
         0, 0, public._payment_method_from_claim(new), null,
         'Off-platform reservation pickup', 'completed')
      on conflict do nothing
      returning id into txn;
    end if;

    if l.listing_type in ('sale','plot') and l.inventory_count is not null then
      update public.listings
         set status = case when inventory_count <= 0 then 'completed'::listing_status else status end
       where id = new.listing_id;
    else
      update public.listings set status = 'completed' where id = new.listing_id;
    end if;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
