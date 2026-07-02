-- Gnome — Trust layer: verified-email signal. Run after 0001–0014.
-- Adds `verified_email` to public_markets: true when the market owner's email is
-- confirmed in Supabase Auth. The view is owner-defined (runs with owner
-- privileges — same pattern as 0012/0013), so it may read auth.users; only the
-- derived BOOLEAN is exposed, never the email or any auth.users row data.
--
-- NOTE: apply this before shipping the app build that selects verified_email
-- from public_markets (expo useMarketReputation / web MARKET_COLS).

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
    rr.response_rate,
    exists (
      select 1 from auth.users u
      where u.id = m.owner_id and u.email_confirmed_at is not null
    ) as verified_email
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

notify pgrst, 'reload schema';
