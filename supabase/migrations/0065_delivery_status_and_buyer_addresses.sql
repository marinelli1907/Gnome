-- Gnome — delivery groundwork: order status label + private buyer addresses.
--
-- (Enum label added in its own migration, like 0045's 'paused' — a label can't
-- be used in the transaction that creates it.)

alter type public.market_order_status add value if not exists 'OUT_FOR_DELIVERY' after 'READY';

-- ---------------------------------------------------------------------------
-- Buyer delivery addresses — PRIVATE. RLS is owner-only; sellers never read
-- this table. A confirmed order carries its own snapshot, released to the
-- seller through order_delivery_details() only. lat/lng are geocoded by the
-- buyer's own client when the address is saved (same keyless Nominatim path
-- Browse uses); a row without coords simply isn't delivery-quotable yet.
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_delivery_addresses (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Home' check (char_length(label) between 1 and 40),
  address_line text not null check (char_length(address_line) between 3 and 200),
  city text,
  state text,
  postal_code text,
  lat double precision,
  lng double precision,
  delivery_notes text check (char_length(delivery_notes) <= 500),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists buyer_delivery_addresses_default_idx
  on public.buyer_delivery_addresses (buyer_id) where is_default;
create index if not exists buyer_delivery_addresses_buyer_idx
  on public.buyer_delivery_addresses (buyer_id);

alter table public.buyer_delivery_addresses enable row level security;

drop policy if exists buyer_addresses_own on public.buyer_delivery_addresses;
create policy buyer_addresses_own on public.buyer_delivery_addresses
  for all using (buyer_id = auth.uid()) with check (buyer_id = auth.uid());

-- No anon access at all; authenticated is row-limited to self by RLS.
revoke all on public.buyer_delivery_addresses from anon;
grant select, insert, update, delete on public.buyer_delivery_addresses to authenticated;

notify pgrst, 'reload schema';
