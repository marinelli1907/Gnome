-- public_listings: append market_position + market_featured (append-only)
create or replace view public.public_listings as
  select
    l.id, l.slug, l.title, l.description, l.category, l.listing_type, l.status,
    l.price_cents, l.currency, l.trade_for, l.quantity, l.unit, l.photos,
    l.city, l.county, l.state, l.fulfillment_type,
    l.market_id,
    m.name as market_name, m.slug as market_slug, m.avatar_url as market_avatar_url,
    m.market_type as market_type, m.verified as market_verified,
    l.created_at, l.expires_at, l.is_featured, l.featured_until,
    exists (
      select 1 from public.listing_promotions p
      where p.listing_id = l.id and p.status = 'active' and p.ends_at > now()
    ) as has_active_promotion,
    l.approx_lat,
    l.approx_lng,
    l.is_demo,
    l.market_position,
    l.market_featured
  from public.listings l
  join public.markets m on m.id = l.market_id
  where l.status = 'active' and l.expires_at > now() and m.status = 'active';
grant select on public.public_listings to anon, authenticated;

-- public_markets: EXACT existing definition (from pg_get_viewdef) + tagline,
-- theme appended at the end.
create or replace view public.public_markets as
 SELECT m.id,
    m.slug,
    m.name,
    m.description,
    m.market_type,
    m.status,
    m.avatar_url,
    m.banner_url,
    m.city,
    m.county,
    m.state,
    m.verified,
    m.sponsor_visible,
    m.website_url,
    m.instagram_url,
    m.facebook_url,
    m.created_at,
    m.created_at AS member_since,
    ( SELECT count(*) AS count
           FROM listings l
          WHERE l.market_id = m.id AND l.status = 'active'::listing_status AND l.expires_at > now()) AS active_listing_count,
    ( SELECT count(*) AS count
           FROM listings l
          WHERE l.market_id = m.id AND l.status = 'completed'::listing_status AND l.listing_type = 'free'::listing_type) AS listings_shared,
    ( SELECT count(*) AS count
           FROM claims c
             JOIN listings l ON l.id = c.listing_id
          WHERE l.market_id = m.id AND c.claim_type = 'purchase_request'::text AND c.status = 'completed'::claim_status) AS listings_sold,
    ( SELECT count(*) AS count
           FROM claims c
             JOIN listings l ON l.id = c.listing_id
          WHERE l.market_id = m.id AND c.claim_type = 'trade_offer'::text AND c.status = 'completed'::claim_status) AS trades_completed,
    rr.response_rate,
    (EXISTS ( SELECT 1
           FROM auth.users u
          WHERE u.id = m.owner_id AND u.email_confirmed_at IS NOT NULL)) AS verified_email,
    m.tagline,
    m.theme
   FROM markets m
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN count(*) >= 5 THEN round(100.0 * count(*) FILTER (WHERE c.responded_at IS NOT NULL AND c.responded_at <= (c.created_at + '48:00:00'::interval))::numeric / count(*)::numeric)
                    ELSE NULL::numeric
                END AS response_rate
           FROM claims c
             JOIN listings l ON l.id = c.listing_id
          WHERE l.market_id = m.id AND c.status <> 'cancelled'::claim_status) rr ON true
  WHERE m.status = 'active'::market_status;
grant select on public.public_markets to anon, authenticated;

-- Analytics allowlist += seller events (names only, never amounts)
create or replace function public.events_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare cnt int;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'anon' then return new; end if;
  if new.event_type is null or new.event_type not in (
    'web_zip_search','web_browse_location_set','web_reserve_started',
    'web_reserve_submitted','web_listing_published',
    'web_gnome_opened','web_gnome_quick_action','web_gnome_message',
    'web_seed_profile_started','web_seed_profile_completed','web_seed_checkout_started',
    'web_sale_recorded','web_expense_recorded','web_market_customized','web_market_reordered'
  ) then
    raise exception 'EVENT_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if length(coalesce(new.metadata::text, '')) > 512 then
    raise exception 'EVENT_METADATA_TOO_LARGE' using errcode = 'P0001';
  end if;
  new.user_id := null; new.listing_id := null;
  select count(*) into cnt from public.events
  where user_id is null and created_at > now() - interval '1 minute';
  if cnt >= 300 then raise exception 'EVENT_RATE_LIMITED' using errcode = 'P0001'; end if;
  return new;
end $$;

notify pgrst, 'reload schema';