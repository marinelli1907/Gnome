-- My Market: storefront customization + seller accounting. Additive only.

-- Storefront fields
alter table public.markets
  add column if not exists tagline text check (tagline is null or length(tagline) <= 120),
  add column if not exists theme text not null default 'garden'
    check (theme in ('garden','harvest','herb','farm_stand','minimal'));

-- Per-market listing presentation: position + market-level featured flag.
-- Presentation only — never touches created_at, paid boosts, or ranking.
alter table public.listings
  add column if not exists market_position int,
  add column if not exists market_featured boolean not null default false;
create index if not exists listings_market_position_idx
  on public.listings (market_id, market_position);

-- Seller ledger: sales recorded by the seller. Gnome RECORDS these; unless
-- payment_method = 'gnome' the money moved outside Gnome. Corrections are
-- void + re-record (corrected_from) — history is never overwritten.
create table if not exists public.seller_transactions (
  id             uuid primary key default gen_random_uuid(),
  market_id      uuid not null references public.markets (id) on delete cascade,
  listing_id     uuid references public.listings (id) on delete set null,
  claim_id       uuid references public.claims (id) on delete set null,
  source         text not null default 'manual' check (source in ('manual','request')),
  quantity       numeric not null default 1 check (quantity > 0),
  gross_cents    int not null check (gross_cents >= 0),
  discount_cents int not null default 0 check (discount_cents >= 0),
  fee_cents      int not null default 0 check (fee_cents >= 0),
  net_cents      int generated always as (gross_cents - discount_cents - fee_cents) stored,
  payment_method text not null check (payment_method in
    ('cash','venmo','zelle','cashapp','check','external_card','other','gnome')),
  buyer_label    text,                       -- 'Walk-up', a first name, or null
  notes          text,
  status         text not null default 'completed' check (status in ('completed','void')),
  void_reason    text,
  corrected_from uuid references public.seller_transactions (id),
  sold_at        timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists seller_txn_market_idx on public.seller_transactions (market_id, sold_at desc);

create table if not exists public.seller_expenses (
  id          uuid primary key default gen_random_uuid(),
  market_id   uuid not null references public.markets (id) on delete cascade,
  spent_at    date not null default current_date,
  category    text not null check (category in
    ('seeds','soil','fertilizer','packaging','market_fees','supplies','mileage','other')),
  amount_cents int not null check (amount_cents > 0),
  vendor      text,
  notes       text,
  status      text not null default 'recorded' check (status in ('recorded','void')),
  created_at  timestamptz not null default now()
);
create index if not exists seller_exp_market_idx on public.seller_expenses (market_id, spent_at desc);

-- RLS: OWNER-ONLY financials. Customers see nothing; admins may read for
-- support (never casually edit — no admin write policy on purpose).
alter table public.seller_transactions enable row level security;
alter table public.seller_expenses     enable row level security;

create or replace function public.owns_market(mid uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.markets m where m.id = mid and m.owner_id = auth.uid()); $$;

drop policy if exists seller_txn_owner on public.seller_transactions;
create policy seller_txn_owner on public.seller_transactions
  for all using (public.owns_market(market_id)) with check (public.owns_market(market_id));
drop policy if exists seller_txn_admin_read on public.seller_transactions;
create policy seller_txn_admin_read on public.seller_transactions
  for select using (public.is_admin());

drop policy if exists seller_exp_owner on public.seller_expenses;
create policy seller_exp_owner on public.seller_expenses
  for all using (public.owns_market(market_id)) with check (public.owns_market(market_id));
drop policy if exists seller_exp_admin_read on public.seller_expenses;
create policy seller_exp_admin_read on public.seller_expenses
  for select using (public.is_admin());

-- Record a sale atomically: ledger row + optional guarded inventory decrement.
-- SECURITY DEFINER but re-checks ownership; never allows negative inventory.
create or replace function public.record_sale(
  p_market uuid, p_listing uuid, p_claim uuid,
  p_quantity numeric, p_gross_cents int, p_discount_cents int, p_fee_cents int,
  p_payment_method text, p_buyer_label text, p_notes text, p_source text default 'manual'
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare txn uuid; inv int;
begin
  if not public.owns_market(p_market) then raise exception 'not your market'; end if;
  if p_listing is not null then
    if not exists (select 1 from listings l where l.id = p_listing and l.market_id = p_market) then
      raise exception 'listing does not belong to this market';
    end if;
    select inventory_count into inv from listings where id = p_listing for update;
    if inv is not null then
      if inv < p_quantity then raise exception 'INSUFFICIENT_INVENTORY (% left)', inv; end if;
      update listings set inventory_count = inv - p_quantity::int where id = p_listing;
    end if;
  end if;
  insert into seller_transactions
    (market_id, listing_id, claim_id, source, quantity, gross_cents, discount_cents,
     fee_cents, payment_method, buyer_label, notes)
  values
    (p_market, p_listing, p_claim, coalesce(p_source,'manual'), p_quantity, p_gross_cents,
     coalesce(p_discount_cents,0), coalesce(p_fee_cents,0), p_payment_method,
     p_buyer_label, p_notes)
  returning id into txn;
  return txn;
end $$;

-- Void (correction step 1): keeps the row, restores inventory it consumed.
create or replace function public.void_sale(p_txn uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare t record;
begin
  select * into t from seller_transactions where id = p_txn for update;
  if not found or not public.owns_market(t.market_id) then raise exception 'not your transaction'; end if;
  if t.status = 'void' then return; end if;
  update seller_transactions
     set status = 'void', void_reason = coalesce(p_reason,'corrected'), updated_at = now()
   where id = p_txn;
  if t.listing_id is not null then
    update listings set inventory_count = coalesce(inventory_count, 0) + t.quantity::int
    where id = t.listing_id and inventory_count is not null;
  end if;
end $$;

revoke execute on function public.record_sale(uuid,uuid,uuid,numeric,int,int,int,text,text,text,text) from public, anon;
revoke execute on function public.void_sale(uuid,text) from public, anon;