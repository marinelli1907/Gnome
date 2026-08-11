-- Gnome — one plot listing can offer several identical plots (2026-08-10).
--
-- Growers asked for a plot SIZE and a count of AVAILABLE plots on the listing
-- itself instead of posting N duplicate rows. No new columns needed:
--   listings.quantity        (text)  → the plot size ("4×8 ft raised bed")
--   listings.inventory_count (int)   → how many identical plots remain
--
-- Approval semantics for plot listings that carry an inventory_count:
--   · approve a reservation  → decrement; the listing stays ACTIVE while
--     plots remain, flips to 'claimed' only when the last one goes; other
--     pending requests are NOT auto-declined while plots remain.
--   · cancel/decline a previously-approved reservation → increment back and
--     reopen the listing if it was full.
-- Plot listings without inventory_count, and every non-plot claim type, keep
-- the exact 0001 behavior (single item: claim → 'claimed' + decline others).

create or replace function public.handle_claim_status()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  l public.listings;
begin
  select * into l from public.listings where id = new.listing_id;

  if new.status = 'approved' and old.status is distinct from 'approved' then
    if l.listing_type = 'plot' and l.inventory_count is not null then
      update public.listings
         set inventory_count = greatest(0, inventory_count - 1),
             status = case when inventory_count - 1 <= 0 then 'claimed'::listing_status else status end
       where id = new.listing_id;
      -- Only shut the door on other requests when the last plot just went.
      if l.inventory_count - 1 <= 0 then
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

  elsif new.status in ('cancelled', 'declined') and old.status = 'approved' then
    if l.listing_type = 'plot' and l.inventory_count is not null then
      update public.listings
         set inventory_count = inventory_count + 1,
             status = case when status = 'claimed' then 'active'::listing_status else status end
       where id = new.listing_id;
    else
      update public.listings set status = 'active'
        where id = new.listing_id and status = 'claimed';
    end if;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
