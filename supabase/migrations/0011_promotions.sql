-- Gnome — M7 Promotion Foundation, per Vanth's promotions ruling. Run after 0001–0010.
-- Builds promotion data + activation + plan-credit redemption. NO payments:
-- source='paid' is reserved for M10 and is rejected here.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin create type promotion_status as enum ('draft','active','expired','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin create type promotion_source as enum ('manual','plan_credit','paid','sponsor');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- listing_promotions
-- ---------------------------------------------------------------------------
create table if not exists public.listing_promotions (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings (id) on delete cascade,
  market_id   uuid not null references public.markets (id) on delete cascade,
  source      promotion_source not null default 'manual',
  status      promotion_status not null default 'draft',
  starts_at   timestamptz,
  ends_at     timestamptz,
  price_cents integer,
  currency    text default 'USD',
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);

create index if not exists listing_promotions_market_idx  on public.listing_promotions (market_id);
create index if not exists listing_promotions_listing_idx on public.listing_promotions (listing_id);
create index if not exists listing_promotions_active_idx  on public.listing_promotions (status, ends_at);

-- ---------------------------------------------------------------------------
-- Included monthly boost credits per plan (no reset job — usage is counted).
-- ---------------------------------------------------------------------------
alter table public.plan_limits
  add column if not exists included_boost_credits integer not null default 0;

update public.plan_limits set included_boost_credits = 0 where plan = 'free';
update public.plan_limits set included_boost_credits = 1 where plan = 'grower';
update public.plan_limits set included_boost_credits = 5 where plan = 'farm';
update public.plan_limits set included_boost_credits = 5 where plan = 'sponsor';

-- remaining = plan allowance − plan_credit promotions created this calendar month.
create or replace function public.market_boost_credits_remaining(p_market_id uuid)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select greatest(
    0,
    coalesce((select pl.included_boost_credits
              from public.markets m
              join public.plan_limits pl on pl.plan = m.plan
              where m.id = p_market_id), 0)
    - coalesce((select count(*)::int
                from public.listing_promotions lp
                where lp.market_id = p_market_id
                  and lp.source = 'plan_credit'
                  and date_trunc('month', lp.created_at) = date_trunc('month', now())), 0)
  );
$$;

-- ---------------------------------------------------------------------------
-- BEFORE write: block paid (M10 only), enforce plan-credit allowance, and make
-- sure you only promote a listing that belongs to the named market.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_promotion()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.source = 'paid' then
    raise exception 'PAID_PROMOTIONS_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.listings l
      where l.id = new.listing_id and l.market_id = new.market_id
    ) then
      raise exception 'listing does not belong to this market';
    end if;
  end if;

  if new.source = 'plan_credit' and new.status = 'active' then
    if public.market_boost_credits_remaining(new.market_id) <= 0 then
      raise exception 'NO_BOOST_CREDITS' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_promotion on public.listing_promotions;
create trigger enforce_promotion
  before insert or update on public.listing_promotions
  for each row execute function public.enforce_promotion();

-- ---------------------------------------------------------------------------
-- AFTER write: keep the denormalized listings.is_featured / featured_until
-- display mirror in sync.
-- ---------------------------------------------------------------------------
create or replace function public.sync_listing_featured()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'active' then
    update public.listings
      set is_featured = true, featured_until = new.ends_at
      where id = new.listing_id;
  elsif new.status in ('expired','cancelled') then
    if not exists (
      select 1 from public.listing_promotions
      where listing_id = new.listing_id and status = 'active' and id <> new.id
    ) then
      update public.listings
        set is_featured = false, featured_until = null
        where id = new.listing_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_listing_featured on public.listing_promotions;
create trigger sync_listing_featured
  after insert or update on public.listing_promotions
  for each row execute function public.sync_listing_featured();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.listing_promotions enable row level security;

-- Public can read ACTIVE promotions (the rail / anon); the market owner reads
-- all of their own.
drop policy if exists "promotions_select_active_or_owner" on public.listing_promotions;
create policy "promotions_select_active_or_owner" on public.listing_promotions
  for select using (
    status = 'active'
    or auth.uid() = (select owner_id from public.markets m where m.id = market_id)
  );

-- Only the market owner inserts, and never source='paid' (M10/server only).
drop policy if exists "promotions_insert_owner" on public.listing_promotions;
create policy "promotions_insert_owner" on public.listing_promotions
  for insert with check (
    auth.uid() = (select owner_id from public.markets m where m.id = market_id)
    and source <> 'paid'
  );

-- Owner can update/cancel their own; still never flip to paid.
drop policy if exists "promotions_update_owner" on public.listing_promotions;
create policy "promotions_update_owner" on public.listing_promotions
  for update using (
    auth.uid() = (select owner_id from public.markets m where m.id = market_id)
  ) with check (
    auth.uid() = (select owner_id from public.markets m where m.id = market_id)
    and source <> 'paid'
  );

notify pgrst, 'reload schema';
