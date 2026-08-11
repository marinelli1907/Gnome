-- Gnome — sold-out / fully-reserved is a real state (found by the multi-plot
-- acceptance run). The 0002-era check (inventory_count > 0) made reaching
-- exactly zero impossible: the LAST plot reservation (0072) and a sale order
-- consuming the final unit both blew up with 23514. NULL still means "not
-- tracked"; zero now means "none left" (UI already renders Sold out).
alter table public.listings drop constraint if exists listings_inventory_chk;
alter table public.listings add constraint listings_inventory_chk
  check (inventory_count is null or inventory_count >= 0);
