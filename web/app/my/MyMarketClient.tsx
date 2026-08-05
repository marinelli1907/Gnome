'use client';

// "My Market" — the seller's dashboard. Every listing they've ever posted
// (RLS lets owners read all statuses, not just active), grouped by state,
// with promotion status and the quick actions that make sense on the web:
// mark sold, remove, relist. Full editing stays in the app for now.
import { useCallback, useEffect, useState } from 'react';
import { categoryFor } from '../../lib/categories';
import { formatPrice, listingPath, timeLeft, TYPE_LABEL } from '../../lib/format';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { SignInCard, useSession } from '../components/auth';

// Explicit column list — post-0010 the base table rejects select=* for
// non-service roles (lat/lng/slug are revoked; everything else is granted).
const COLS =
  'id,title,category,listing_type,status,price_cents,unit,photos,created_at,expires_at,is_featured,featured_until';

interface MyListing {
  id: string;
  title: string;
  category: string;
  listing_type: 'free' | 'trade' | 'sale' | 'wanted';
  status: 'active' | 'claimed' | 'completed' | 'expired' | 'removed';
  price_cents: number | null;
  unit: string | null;
  photos: string[];
  created_at: string;
  expires_at: string;
  is_featured: boolean | null;
  featured_until: string | null;
}

interface MyMarket { id: string; name: string; slug: string; plan: string | null }

const GROUPS: { key: string; title: string; blurb: string; match: (l: MyListing) => boolean }[] = [
  {
    key: 'live', title: 'Live', blurb: 'Visible to neighbors right now.',
    match: (l) => (l.status === 'active' || l.status === 'claimed') && new Date(l.expires_at) > new Date(),
  },
  {
    key: 'sold', title: 'Sold & shared', blurb: 'Completed — nice work.',
    match: (l) => l.status === 'completed',
  },
  {
    key: 'unsold', title: 'Unsold', blurb: 'Expired or removed. Relist anytime.',
    match: (l) =>
      l.status === 'expired' || l.status === 'removed' ||
      (l.status === 'active' && new Date(l.expires_at) <= new Date()),
  },
];

function isLiveGroup(l: MyListing) { return GROUPS[0].match(l); }

export default function MyMarketClient() {
  const { session, ready } = useSession();
  const uid = session?.user?.id;

  const [market, setMarket] = useState<MyMarket | null>(null);
  const [listings, setListings] = useState<MyListing[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    const supabase = supabaseBrowser();
    const [{ data: m }, { data: ls, error: lerr }] = await Promise.all([
      supabase.from('markets').select('id,name,slug,plan').eq('owner_id', uid).limit(1).maybeSingle(),
      supabase.from('listings').select(COLS).eq('owner_id', uid).order('created_at', { ascending: false }),
    ]);
    if (lerr) setError(lerr.message);
    setMarket((m as MyMarket) ?? null);
    setListings((ls as unknown as MyListing[]) ?? []);
  }, [uid]);

  useEffect(() => { void load(); }, [load]);

  async function setStatus(l: MyListing, status: string, extra: Record<string, unknown> = {}) {
    setBusyId(l.id);
    setError(null);
    const { error } = await supabaseBrowser()
      .from('listings')
      .update({ status, ...extra })
      .eq('id', l.id);
    setBusyId(null);
    if (error) setError(error.message);
    else await load();
  }

  const markSold = (l: MyListing) => setStatus(l, 'completed');
  const remove = (l: MyListing) => setStatus(l, 'removed');
  const relist = (l: MyListing) =>
    setStatus(l, 'active', {
      expires_at: new Date(
        Date.now() + (l.listing_type === 'wanted' ? 30 : 7) * 86400_000,
      ).toISOString(),
    });

  if (!ready) return <div className="empty"><p>Loading…</p></div>;
  if (!session) {
    return (
      <SignInCard
        title="Sign in to see your Market"
        blurb="Your storefront: every listing, what sold, and what to relist."
      />
    );
  }
  if (listings === null) return <div className="empty"><p>Loading your Market…</p></div>;

  const activeCount = listings.filter(isLiveGroup).length;
  const soldCount = listings.filter((l) => l.status === 'completed').length;
  const featured = listings.filter(
    (l) => l.is_featured && l.featured_until && new Date(l.featured_until) > new Date(),
  );

  return (
    <div>
      <div className="mm-head">
        <div>
          <h1>{market?.name ?? 'My Market'}</h1>
          <p className="mm-stats">
            <strong>{activeCount}</strong> live · <strong>{soldCount}</strong> sold &amp; shared
            {featured.length > 0 && <> · <strong>{featured.length}</strong> boosted ✨</>}
            {market?.plan && <> · {market.plan} plan</>}
          </p>
        </div>
        <div className="mm-actions">
          <a className="btn btn-primary btn-sm" href="/sell">+ New listing</a>
          {market?.slug && (
            <a className="btn btn-secondary btn-sm" href={`/market/${market.slug}`}>Public page</a>
          )}
        </div>
      </div>

      {error && <p className="autherror">{error}</p>}

      {listings.length === 0 && (
        <div className="empty">
          <div className="emoji">🌱</div>
          <h2>Nothing posted yet</h2>
          <p>Your first listing takes under a minute — the AI even writes it for you.</p>
          <p><a className="btn btn-primary" href="/sell">Post your first listing</a></p>
        </div>
      )}

      {GROUPS.map((g) => {
        const rows = listings.filter(g.match);
        if (rows.length === 0) return null;
        return (
          <section key={g.key} className="section">
            <div className="section-head">
              <h2>{g.title} <span className="mm-count">{rows.length}</span></h2>
            </div>
            <p className="sub">{g.blurb}</p>
            <div className="mm-list">
              {rows.map((l) => {
                const cat = categoryFor(l.category);
                const boosted =
                  l.is_featured && l.featured_until && new Date(l.featured_until) > new Date();
                const live = g.key === 'live';
                return (
                  <div key={l.id} className="mm-row">
                    <div className="mm-thumb">
                      {l.photos?.[0]
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={l.photos[0]} alt="" />
                        : <span>{cat.emoji}</span>}
                    </div>
                    <div className="mm-info">
                      <a className="mm-title" href={listingPath(l.id, l.title)}>{l.title}</a>
                      <div className="mm-meta">
                        <span className={`tag type-${l.listing_type}`}>
                          {l.listing_type === 'sale' && l.price_cents
                            ? formatPrice(l.price_cents, l.unit)
                            : TYPE_LABEL[l.listing_type]}
                        </span>
                        {boosted && <span className="tag featured">✨ Boosted</span>}
                        {l.status === 'claimed' && <span className="tag type-trade">Claimed — pending pickup</span>}
                        {live && l.status === 'active' && <span className="mm-expiry">{timeLeft(l.expires_at)}</span>}
                      </div>
                    </div>
                    <div className="mm-btns">
                      {live && (
                        <>
                          <button className="mm-btn" disabled={busyId === l.id} onClick={() => void markSold(l)}>
                            Mark sold
                          </button>
                          <button className="mm-btn danger" disabled={busyId === l.id} onClick={() => void remove(l)}>
                            Remove
                          </button>
                        </>
                      )}
                      {g.key === 'unsold' && (
                        <button className="mm-btn" disabled={busyId === l.id} onClick={() => void relist(l)}>
                          Relist
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="authhint" style={{ marginTop: 24 }}>
        Editing details, boosts, and pickup chat live in the Gnome app for now.
      </p>
    </div>
  );
}
