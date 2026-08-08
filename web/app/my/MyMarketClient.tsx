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
import PlotThread from '../components/PlotThread';

// Explicit column list — post-0010 the base table rejects select=* for
// non-service roles (lat/lng/slug are revoked; everything else is granted).
const BOOST_LINK = process.env.NEXT_PUBLIC_STRIPE_LINK_BOOST;

const COLS =
  'id,title,category,listing_type,status,price_cents,unit,photos,created_at,expires_at,is_featured,featured_until';

interface MyListing {
  id: string;
  title: string;
  category: string;
  listing_type: 'free' | 'trade' | 'sale' | 'wanted' | 'plot';
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

// A plot-reservation request on one of MY plot listings (I'm the grower).
interface Reservation {
  id: string;
  listing_id: string;
  status: 'pending' | 'approved' | 'declined' | 'cancelled' | 'completed' | 'expired';
  buyer_note: string | null;
  agreed_price_cents: number | null;
  created_at: string;
  claimer: { name: string | null } | null;
}

// A Seed Drop order (mine), with the exact varieties the engine reserved.
interface SeedOrder {
  id: string;
  status: string;
  packet_count: number;
  tracking: string | null;
  created_at: string;
  items: { id: string; status: string; product: { crop: string; variety: string } | null }[];
}

// A plot I reserved in someone else's garden (I'm the buyer).
interface MyReservation {
  id: string;
  status: Reservation['status'];
  buyer_note: string | null;
  agreed_price_cents: number | null;
  created_at: string;
  listing: { id: string; title: string; status: string } | null;
}

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
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [myReservations, setMyReservations] = useState<MyReservation[]>([]);
  const [seedOrders, setSeedOrders] = useState<SeedOrder[]>([]);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [credits, setCredits] = useState<number>(0);
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
    const rows = (ls as unknown as MyListing[]) ?? [];
    setListings(rows);

    // Incoming plot reservations on my plot listings (claims RLS shows the
    // owner every claim on their listings; the FK-qualified embed avoids the
    // ambiguous double-FK to profiles).
    const plotIds = rows.filter((l) => l.listing_type === 'plot').map((l) => l.id);
    if (plotIds.length > 0) {
      const { data: rs } = await supabase
        .from('claims')
        .select('id,listing_id,status,buyer_note,agreed_price_cents,created_at,claimer:profiles!claims_claimer_id_fkey(name)')
        .eq('claim_type', 'plot_reservation')
        .in('listing_id', plotIds)
        .order('created_at', { ascending: false });
      setReservations((rs as unknown as Reservation[]) ?? []);
    } else {
      setReservations([]);
    }

    // Plots I reserved elsewhere (buyer side). The listing embed works even
    // after the plot flips to 'claimed' thanks to 0026's claimer-read policy.
    const { data: mine } = await supabase
      .from('claims')
      .select('id,status,buyer_note,agreed_price_cents,created_at,listing:listings!claims_listing_id_fkey(id,title,status)')
      .eq('claim_type', 'plot_reservation')
      .eq('claimer_id', uid)
      .order('created_at', { ascending: false });
    setMyReservations((mine as unknown as MyReservation[]) ?? []);

    // My Seed Drop orders (own-row RLS; items embed the public catalog row).
    const { data: sorders } = await supabase
      .from('seed_orders')
      .select('id,status,packet_count,tracking,created_at,items:seed_order_items(id,status,product:seed_products(crop,variety))')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    setSeedOrders((sorders as unknown as SeedOrder[]) ?? []);

    if (m?.id) {
      const { data: c } = await supabase.rpc('market_boost_credits_remaining', {
        p_market_id: (m as MyMarket).id,
      });
      setCredits(typeof c === 'number' ? c : 0);
    }
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

  // Redeem a plan boost credit → 7-day featured promotion (M7 trigger
  // enforces the monthly allowance server-side; we just surface it).
  async function boost(l: MyListing) {
    if (!market) return;
    setBusyId(l.id);
    setError(null);
    const { error } = await supabaseBrowser().from('listing_promotions').insert({
      listing_id: l.id,
      market_id: market.id,
      source: 'plan_credit',
      status: 'active',
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
      created_by: uid,
    });
    setBusyId(null);
    if (error) {
      setError(
        error.message.includes('credit')
          ? 'No boost credits left this month — upgrade for more, or grab a one-off boost.'
          : error.message,
      );
    } else await load();
  }

  // Approve/decline a plot reservation. Approving fires the claim-status
  // trigger: the plot listing flips to 'claimed' (off the marketplace) and
  // other pending requests auto-decline.
  async function setReservation(r: Reservation, status: 'approved' | 'declined') {
    setBusyId(r.id);
    setError(null);
    const { error } = await supabaseBrowser().from('claims').update({ status }).eq('id', r.id);
    setBusyId(null);
    if (error) setError(error.message);
    else await load();
  }

  const markSold = (l: MyListing) => setStatus(l, 'completed');
  const remove = (l: MyListing) => setStatus(l, 'removed');
  const relist = (l: MyListing) =>
    setStatus(l, 'active', {
      expires_at: new Date(
        Date.now() +
          (l.listing_type === 'wanted' ? 30 : l.listing_type === 'plot' ? 45 : 7) * 86400_000,
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

      <div className="plan-card">
        <div>
          <strong className="plan-name">{(market?.plan ?? 'free') === 'free' ? 'Neighbor (free)' : `${market?.plan} plan`}</strong>
          <span className="plan-usage">
            {activeCount}/{market?.plan === 'farm' || market?.plan === 'sponsor' ? 500 : market?.plan === 'grower' ? 100 : 10} listings
            {' · '}{credits} boost credit{credits === 1 ? '' : 's'} left this month
          </span>
        </div>
        {(market?.plan ?? 'free') === 'free' && (
          <a className="btn btn-primary btn-sm" href="/pricing">Upgrade</a>
        )}
        {(market?.plan ?? 'free') !== 'free' && (
          <a className="btn btn-secondary btn-sm" href="/pricing">Plans</a>
        )}
      </div>

      {error && <p className="autherror">{error}</p>}

      {reservations.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Plot reservations <span className="mm-count">{reservations.length}</span></h2>
          </div>
          <p className="sub">
            Neighbors asking to reserve a plot. Approve one and that plot comes off
            the marketplace; other requests on it decline automatically. Payment is
            arranged directly — details and updates in the app chat.
          </p>
          <div className="mm-list">
            {reservations.map((r) => {
              const plot = listings.find((l) => l.id === r.listing_id);
              const who = r.claimer?.name || 'A neighbor';
              const chatable = r.status === 'approved' || r.status === 'completed';
              return (
                <div key={r.id}>
                  <div className="mm-row">
                    <div className="mm-thumb"><span>🧑‍🌾</span></div>
                    <div className="mm-info">
                      <span className="mm-title">
                        {who} · {plot?.title ?? 'your plot'}
                        {r.agreed_price_cents != null && r.agreed_price_cents > 0
                          ? ` · ${formatPrice(r.agreed_price_cents)}`
                          : ''}
                      </span>
                      <div className="mm-meta">
                        {r.status === 'pending' && <span className="tag type-wanted">New request</span>}
                        {r.status === 'approved' && <span className="tag type-free">Reserved ✓</span>}
                        {r.status === 'completed' && <span className="tag type-free">Season complete</span>}
                        {(r.status === 'declined' || r.status === 'cancelled') && (
                          <span className="tag">{r.status === 'declined' ? 'Declined' : 'Cancelled'}</span>
                        )}
                        {r.buyer_note && <span className="mm-expiry">“{r.buyer_note}”</span>}
                      </div>
                    </div>
                    <div className="mm-btns">
                      {r.status === 'pending' && (
                        <>
                          <button className="mm-btn" disabled={busyId === r.id} onClick={() => void setReservation(r, 'approved')}>
                            Approve
                          </button>
                          <button className="mm-btn danger" disabled={busyId === r.id} onClick={() => void setReservation(r, 'declined')}>
                            Decline
                          </button>
                        </>
                      )}
                      {chatable && (
                        <button
                          className="mm-btn"
                          onClick={() => setOpenThread(openThread === r.id ? null : r.id)}
                        >
                          {openThread === r.id ? 'Close' : '🌱 Updates & chat'}
                        </button>
                      )}
                    </div>
                  </div>
                  {openThread === r.id && chatable && (
                    <PlotThread claimId={r.id} isGrower readOnly={r.status === 'completed'} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {seedOrders.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Your Seed Drop <span className="mm-count">{seedOrders.length}</span></h2>
          </div>
          <p className="sub">
            Built for your garden from live inventory. Tap the gnome any time for
            help with the exact seeds you received.
          </p>
          <div className="mm-list">
            {seedOrders.map((o) => (
              <div key={o.id} className="mm-row">
                <div className="mm-thumb"><span>📦</span></div>
                <div className="mm-info">
                  <span className="mm-title">
                    Starter Drop · {new Date(o.created_at).toLocaleDateString()}
                  </span>
                  <div className="mm-meta">
                    {o.status === 'paid' && <span className="tag type-wanted">Building your box…</span>}
                    {o.status === 'selected' && <span className="tag type-free">Seeds picked — packing soon</span>}
                    {o.status === 'needs_review' && <span className="tag type-wanted">Being reviewed by a human 🌱</span>}
                    {o.status === 'packed' && <span className="tag type-free">Packed</span>}
                    {o.status === 'shipped' && <span className="tag type-free">Shipped{o.tracking ? ` · ${o.tracking}` : ''}</span>}
                    {(o.status === 'cancelled' || o.status === 'refunded') && <span className="tag">{o.status}</span>}
                  </div>
                  {o.items.filter((i) => i.status !== 'released').length > 0 && (
                    <div className="mm-meta" style={{ marginTop: 4 }}>
                      {o.items.filter((i) => i.status !== 'released').map((i) => (
                        <span key={i.id} className="tag type-free">
                          {i.product ? `${i.product.crop} · ${i.product.variety}` : 'Seed packet'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {myReservations.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Plots you’ve reserved <span className="mm-count">{myReservations.length}</span></h2>
          </div>
          <p className="sub">
            Your grower posts growth updates here, and you can message them any time.
          </p>
          <div className="mm-list">
            {myReservations.map((r) => {
              const chatable = r.status === 'approved' || r.status === 'completed';
              const key = `mine-${r.id}`;
              return (
                <div key={r.id}>
                  <div className="mm-row">
                    <div className="mm-thumb"><span>🌱</span></div>
                    <div className="mm-info">
                      <span className="mm-title">
                        {r.listing?.title ?? 'A plot'}
                        {r.agreed_price_cents != null && r.agreed_price_cents > 0
                          ? ` · ${formatPrice(r.agreed_price_cents)}`
                          : ''}
                      </span>
                      <div className="mm-meta">
                        {r.status === 'pending' && <span className="tag type-wanted">Awaiting grower</span>}
                        {r.status === 'approved' && <span className="tag type-free">Reserved — growing for you</span>}
                        {r.status === 'completed' && <span className="tag type-free">Season complete</span>}
                        {(r.status === 'declined' || r.status === 'cancelled') && (
                          <span className="tag">{r.status === 'declined' ? 'Declined' : 'Cancelled'}</span>
                        )}
                        {r.buyer_note && <span className="mm-expiry">“{r.buyer_note}”</span>}
                      </div>
                    </div>
                    <div className="mm-btns">
                      {r.status === 'pending' && (
                        <button
                          className="mm-btn danger"
                          disabled={busyId === r.id}
                          onClick={async () => {
                            setBusyId(r.id);
                            await supabaseBrowser().from('claims').update({ status: 'cancelled' }).eq('id', r.id);
                            setBusyId(null);
                            await load();
                          }}
                        >
                          Cancel request
                        </button>
                      )}
                      {chatable && (
                        <button className="mm-btn" onClick={() => setOpenThread(openThread === key ? null : key)}>
                          {openThread === key ? 'Close' : '🌱 Updates & chat'}
                        </button>
                      )}
                    </div>
                  </div>
                  {openThread === key && chatable && (
                    <PlotThread claimId={r.id} isGrower={false} readOnly={r.status === 'completed'} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

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
                        {l.status === 'claimed' && (
                          <span className="tag type-trade">
                            {l.listing_type === 'plot' ? 'Reserved — growing' : 'Claimed — pending pickup'}
                          </span>
                        )}
                        {live && l.status === 'active' && <span className="mm-expiry">{timeLeft(l.expires_at)}</span>}
                      </div>
                    </div>
                    <div className="mm-btns">
                      {live && (
                        <>
                          {!boosted && l.status === 'active' && credits > 0 && (
                            <button className="mm-btn" disabled={busyId === l.id} onClick={() => void boost(l)}>
                              ✨ Boost
                            </button>
                          )}
                          {!boosted && l.status === 'active' && credits === 0 && BOOST_LINK && (
                            <a className="mm-btn" href={`${BOOST_LINK}?client_reference_id=boost_${l.id}`}>
                              ✨ Boost $4.99
                            </a>
                          )}
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
        Editing details and pickup chat live in the Gnome app for now.{' '}
        Want more reach? <a href="/pricing">See plans &amp; boosts</a>.
      </p>
    </div>
  );
}
