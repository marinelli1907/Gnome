'use client';

// Following feed: the user's own follows (RLS own-rows) joined against the
// PUBLIC views only — markets and listings render exactly what any visitor
// could see; following just curates it.
import { useEffect, useState } from 'react';
import ListingCard from '../components/ListingCard';
import MarketCard from '../components/MarketCard';
import type { WebListing, WebMarket } from '../../lib/gnome';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { SignInCard, useSession } from '../components/auth';

const LISTING_COLS =
  'id,slug,title,description,category,listing_type,status,price_cents,currency,trade_for,quantity,unit,photos,city,county,state,fulfillment_type,market_id,market_name,market_slug,market_avatar_url,market_type,market_verified,created_at,expires_at,is_featured,featured_until,has_active_promotion,is_demo';
const MARKET_COLS =
  'id,slug,name,description,market_type,status,avatar_url,banner_url,city,county,state,verified,sponsor_visible,website_url,instagram_url,facebook_url,created_at,active_listing_count,member_since,listings_shared,listings_sold,trades_completed,response_rate,verified_email';

export default function FollowingClient() {
  const { session, ready } = useSession();
  const uid = session?.user?.id;

  const [markets, setMarkets] = useState<WebMarket[] | null>(null);
  const [listings, setListings] = useState<WebListing[]>([]);

  useEffect(() => {
    if (!uid) return;
    void (async () => {
      const sb = supabaseBrowser();
      const { data: follows } = await sb
        .from('market_follows').select('market_id').eq('follower_id', uid);
      const ids = (follows ?? []).map((f) => f.market_id);
      if (ids.length === 0) { setMarkets([]); return; }
      const [m, l] = await Promise.all([
        sb.from('public_markets').select(MARKET_COLS).in('id', ids),
        sb.from('public_listings').select(LISTING_COLS).in('market_id', ids)
          .order('created_at', { ascending: false }).limit(48),
      ]);
      setMarkets((m.data as unknown as WebMarket[]) ?? []);
      setListings((l.data as unknown as WebListing[]) ?? []);
    })();
  }, [uid]);

  if (!ready) return <div className="empty"><p>Loading…</p></div>;
  if (!session) {
    return (
      <SignInCard
        title="Sign in to see your Markets"
        blurb="Follow growers you like and their fresh listings gather here."
      />
    );
  }
  if (markets === null) return <div className="empty"><p>Checking the garden gates…</p></div>;

  if (markets.length === 0) {
    return (
      <div className="empty">
        <div className="emoji">🏡</div>
        <h2>You’re not following anyone yet</h2>
        <p>Find a Market you like and tap “Follow” — their new listings will show up here.</p>
        <p><a className="btn btn-primary" href="/browse">Browse near you</a></p>
      </div>
    );
  }

  return (
    <div>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="section-head"><h2>Your Markets <span className="mm-count">{markets.length}</span></h2></div>
        <div className="grid">
          {markets.map((m) => <MarketCard key={m.id} market={m} />)}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Fresh from them</h2></div>
        {listings.length === 0 ? (
          <p className="sub">Nothing active right now — check back after the weekend harvest.</p>
        ) : (
          <div className="grid">
            {listings.map((l) => <ListingCard key={l.id} listing={l} />)}
          </div>
        )}
      </section>
    </div>
  );
}
