-- Gnome — M9 Trust Layer. Run after 0001–0012.
-- Objective reputation derived from existing data (no reviews/stars) + a general
-- reports table for safety flags. Reputation is exposed only via public_markets
-- (public-safe), and response_rate is hidden until there are enough signals.

-- ---------------------------------------------------------------------------
-- 1) claims.responded_at — when the owner approved/declined a request.
-- ---------------------------------------------------------------------------
alter table public.claims add column if not exists responded_at timestamptz;

create or replace function public.set_claim_responded_at()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('approved','declined') and new.responded_at is null then
    new.responded_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists set_claim_responded_at on public.claims;
create trigger set_claim_responded_at
  before update on public.claims
  for each row execute function public.set_claim_responded_at();

-- Backfill already-decided claims (approved/declined/completed) so historical
-- responses don't count as "no response". Approximate the response time as the
-- claim's creation time (well within the 48h window).
update public.claims
  set responded_at = created_at
  where responded_at is null and status in ('approved','declined','completed');

-- ---------------------------------------------------------------------------
-- 2) public_markets += derived reputation. Recreate the view (can't insert
--    columns mid-list with CREATE OR REPLACE), then re-grant.
--    response_rate = % of eligible incoming requests responded within 48h;
--    eligible excludes claimer-cancelled; hidden (null) until >= 5 eligible.
-- ---------------------------------------------------------------------------
drop view if exists public.public_markets;

create view public.public_markets as
  select
    m.id, m.slug, m.name, m.description, m.market_type, m.status,
    m.avatar_url, m.banner_url, m.city, m.county, m.state,
    m.verified, m.sponsor_visible, m.website_url, m.instagram_url, m.facebook_url,
    m.created_at,
    m.created_at as member_since,
    (select count(*) from public.listings l
       where l.market_id = m.id and l.status = 'active' and l.expires_at > now())
      as active_listing_count,
    (select count(*) from public.listings l
       where l.market_id = m.id and l.status = 'completed' and l.listing_type = 'free')
      as listings_shared,
    (select count(*) from public.claims c join public.listings l on l.id = c.listing_id
       where l.market_id = m.id and c.claim_type = 'purchase_request' and c.status = 'completed')
      as listings_sold,
    (select count(*) from public.claims c join public.listings l on l.id = c.listing_id
       where l.market_id = m.id and c.claim_type = 'trade_offer' and c.status = 'completed')
      as trades_completed,
    rr.response_rate
  from public.markets m
  left join lateral (
    select case
      when count(*) >= 5
      then round(
        100.0 * count(*) filter (
          where c.responded_at is not null and c.responded_at <= c.created_at + interval '48 hours'
        ) / count(*)
      )
      else null
    end as response_rate
    from public.claims c
    join public.listings l on l.id = c.listing_id
    where l.market_id = m.id and c.status <> 'cancelled'
  ) rr on true
  where m.status = 'active';

grant select on public.public_markets to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) General reports table (safety flags). Authed users insert their own; no
--    public read (reviewed server-side).
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('listing','market','claim','message','user')),
  target_id   uuid not null,
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists reports_target_idx   on public.reports (target_type, target_id);
create index if not exists reports_reporter_idx on public.reports (reporter_id);

alter table public.reports enable row level security;

drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports
  for insert with check (auth.uid() = reporter_id);
-- (no SELECT policy: nobody reads reports via the API)

notify pgrst, 'reload schema';
