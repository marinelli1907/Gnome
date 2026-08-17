'use client';

// Following feed: the user's own follows (RLS own-rows) joined against the
// PUBLIC views only — markets, listings, AND Market Drops render exactly what
// any visitor could see; following just curates it.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ListingCard from '../components/ListingCard';
import MarketCard from '../components/MarketCard';
import { sortDropsLiveFirst, type WebListing, type WebMarket } from '../../lib/gnome';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { SignInCard, useSession } from '../components/auth';

type FollowedDrop = {
  id: string; market_id: string; title: string; description: string | null;
  starts_at: string; ends_at: string; timezone: string; phase: string;
  available_items: number;
};

// Client component, so the window renders on the viewer's own clock — labelled
// with the zone so there's no guessing whose "10:00 AM" it is.
const dropWindow = (d: FollowedDrop) => {
  const s = new Date(d.starts_at);
  const e = new Date(d.ends_at);
  const day = s.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const t = (x: Date) => x.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  return `${day}, ${t(s)} – ${t(e)}`;
};

// Best-effort, authenticated analytics — same posture as the Drops editor.
function logFollowingEvent(eventType: string, meta?: Record<string, unknown>) {
  try {
    void supabaseBrowser().from('events')
      .insert({ event_type: eventType, metadata: meta ?? {} })
      .then(() => {}, () => {});
  } catch { /* analytics never breaks the page */ }
}

const LISTING_COLS =
  'id,slug,title,description,category,listing_type,status,price_cents,currency,trade_for,quantity,unit,photos,city,county,state,fulfillment_type,market_id,market_name,market_slug,market_avatar_url,market_type,market_verified,created_at,expires_at,is_featured,featured_until,has_active_promotion,is_demo';
const MARKET_COLS =
  'id,slug,name,description,market_type,status,avatar_url,banner_url,city,county,state,verified,sponsor_visible,website_url,instagram_url,facebook_url,created_at,active_listing_count,member_since,listings_shared,listings_sold,trades_completed,response_rate,verified_email';

export default function FollowingClient() {
  const { session, ready } = useSession();
  const uid = session?.user?.id;

  const [markets, setMarkets] = useState<WebMarket[] | null>(null);
  const [listings, setListings] = useState<WebListing[]>([]);
  const [drops, setDrops] = useState<FollowedDrop[]>([]);
  // Drop-alert status is DISPLAY-ONLY on web: push delivery exists only in the
  // app, so the toggle lives where it can actually do something (Expo).
  const [alertsOn, setAlertsOn] = useState<Set<string>>(new Set());
  const viewLogged = useRef(false);

  useEffect(() => {
    if (!uid) return;
    if (!viewLogged.current) { viewLogged.current = true; logFollowingEvent('following_screen_viewed'); }
    void (async () => {
      const sb = supabaseBrowser();
      const { data: follows } = await sb
        .from('market_follows').select('market_id, drop_alerts_enabled').eq('follower_id', uid);
      const ids = (follows ?? []).map((f) => f.market_id);
      setAlertsOn(new Set((follows ?? []).filter((f) => f.drop_alerts_enabled).map((f) => f.market_id)));
      if (ids.length === 0) { setMarkets([]); return; }
      const [m, l, d] = await Promise.all([
        sb.from('public_markets').select(MARKET_COLS).in('id', ids),
        sb.from('public_listings').select(LISTING_COLS).in('market_id', ids)
          .order('created_at', { ascending: false }).limit(48),
        sb.from('public_market_drops')
          .select('id,market_id,title,description,starts_at,ends_at,timezone,phase,available_items')
          .in('market_id', ids).order('starts_at', { ascending: true }).limit(12),
      ]);
      setMarkets((m.data as unknown as WebMarket[]) ?? []);
      setListings((l.data as unknown as WebListing[]) ?? []);
      setDrops(sortDropsLiveFirst((d.data as unknown as FollowedDrop[]) ?? []));
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

  const marketById = new Map(markets.map((m) => [m.id, m]));

  return (
    <div>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="section-head"><h2>Your Markets <span className="mm-count">{markets.length}</span></h2></div>
        <div className="grid" onClickCapture={() => logFollowingEvent('followed_market_opened')}>
          {markets.map((m) => (
            <div key={m.id}>
              <MarketCard market={m} />
              {alertsOn.has(m.id) && (
                <p className="sub" style={{ margin: '6px 2px 0', fontSize: 13 }}>
                  🔔 Drop alerts on — manage in the Gnome app
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {drops.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>🧺 Market Drops from them</h2></div>
          <div className="preview-note" style={{ maxWidth: 720, display: 'grid', gap: 8 }}>
            {drops.map((d) => {
              const m = marketById.get(d.market_id);
              return (
                <div key={d.id}>
                  <strong>
                    🧺 {d.title}{' '}
                    {d.phase === 'live' ? <span className="chip" style={{ fontSize: 11 }}>LIVE NOW</span>
                      : d.phase === 'ended' ? <span className="chip" style={{ fontSize: 11 }}>Just ended</span>
                      : <span className="chip" style={{ fontSize: 11 }}>Coming up</span>}
                  </strong>
                  <p style={{ margin: '4px 0 0' }}>
                    {m ? `${m.name} · ` : ''}{dropWindow(d)} · {d.phase !== 'ended' && d.available_items === 0
                      ? 'Sold out'
                      : `${d.available_items} item${d.available_items === 1 ? '' : 's'}`}
                    {m && d.phase !== 'ended' && d.available_items > 0 && (
                      <>
                        {' · '}
                        <Link
                          href={`/market/${m.slug}?drop=${d.id}`}
                          onClick={() => logFollowingEvent('followed_drop_opened', { drop: d.id })}
                        >
                          See what’s in it
                        </Link>
                      </>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

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
