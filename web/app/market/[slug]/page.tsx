import type { Metadata } from 'next';
import Link from 'next/link';
import AppLink from '../../components/AppLink';
import FollowButton from '../../components/FollowButton';
import ListingCard from '../../components/ListingCard';
import { areaLabel, TYPE_LABEL } from '@/lib/format';
import { getMarketBySlug, getMarketListings } from '@/lib/gnome';

export const revalidate = 300;

type Params = { params: Promise<{ slug: string }> };

const MARKET_TYPE_LABEL: Record<string, string> = {
  neighbor: 'Neighbor', backyard_grower: 'Backyard Grower', farm: 'Farm', farm_stand: 'Farm Stand',
  nursery: 'Nursery', garden_center: 'Garden Center', sponsor: 'Sponsor', municipality: 'Municipality', nonprofit: 'Nonprofit',
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const m = await getMarketBySlug(slug);
  if (!m) return { title: 'Market not found', robots: { index: false } };
  const title = `${m.name} | Local Market on Gnome`;
  const description = m.description?.slice(0, 160) || `${m.name} — a local Market near ${areaLabel(m.city, m.state)} sharing homegrown goods on Gnome.`;
  const image = m.banner_url || m.avatar_url || undefined;
  return {
    title,
    description,
    openGraph: { title, description, type: 'profile', images: image ? [{ url: image }] : undefined },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, description, images: image ? [image] : undefined },
  };
}

export default async function MarketPage({ params }: Params) {
  const { slug } = await params;
  const m = await getMarketBySlug(slug);
  if (!m) {
    return (
      <main className="container">
        <div className="empty"><div className="emoji">🏡</div><h2>Market not found</h2><p>This Market may no longer be active.</p></div>
      </main>
    );
  }
  const listings = await getMarketListings(m.id, 60);
  const counts = listings.reduce<Record<string, number>>((acc, l) => {
    acc[l.listing_type] = (acc[l.listing_type] ?? 0) + 1;
    return acc;
  }, {});
  const where = areaLabel(m.city, m.state);

  return (
    <main className="container market-head">
      {m.banner_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="banner" src={m.banner_url} alt={m.name} />
      ) : (
        <div className="banner" />
      )}

      <div className="market-title">
        <div className="avatar lg">
          {m.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.avatar_url} alt={m.name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            (m.name || '?').charAt(0).toUpperCase()
          )}
        </div>
        <div style={{ flex: 1 }}>
          <h1>{m.name}</h1>
          <div className="meta-line" style={{ margin: '4px 0' }}>
            {m.market_type ? <span className="tag type-free">{MARKET_TYPE_LABEL[m.market_type] ?? m.market_type}</span> : null}
            {m.verified ? <span className="tag verified" style={{ marginLeft: 6 }}>✓ Verified</span> : null}
            <span style={{ marginLeft: 8 }}>{where} · {m.active_listing_count} active</span>
          </div>
        </div>
        <FollowButton marketId={m.id} />
      </div>

      {m.description ? <p className="desc" style={{ maxWidth: 720 }}>{m.description}</p> : null}

      <div className="rep">
        <div className="rep-stats">
          <div><strong>{m.listings_shared}</strong><span>Shared</span></div>
          <div><strong>{m.listings_sold}</strong><span>Sold</span></div>
          <div><strong>{m.trades_completed}</strong><span>Traded</span></div>
        </div>
        {m.response_rate != null ? (
          <div className="rep-resp">↩︎ Responds to {m.response_rate}% of requests within 2 days</div>
        ) : null}
        {m.verified_email ? <div className="rep-since">✉️ Email verified</div> : null}
        {m.member_since ? (
          <div className="rep-since">🌱 Member since {new Date(m.member_since).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</div>
        ) : null}
      </div>

      <div className="type-counts">
        {(['free', 'trade', 'sale', 'wanted'] as const).map((t) =>
          counts[t] ? <span key={t} className={`tag type-${t}`}>{counts[t]} {TYPE_LABEL[t]}</span> : null,
        )}
      </div>

      <div className="cta-stack" style={{ flexDirection: 'row', maxWidth: 460 }}>
        <AppLink kind="market" id={m.id} label="Follow in Gnome" variant="primary" />
        <AppLink kind="market" id={m.id} label="Open in Gnome" variant="secondary" />
      </div>

      {(m.website_url || m.instagram_url || m.facebook_url) && (
        <div className="contact-links">
          {m.website_url ? <a href={m.website_url} target="_blank" rel="noopener noreferrer">Website</a> : null}
          {m.instagram_url ? <a href={m.instagram_url} target="_blank" rel="noopener noreferrer">Instagram</a> : null}
          {m.facebook_url ? <a href={m.facebook_url} target="_blank" rel="noopener noreferrer">Facebook</a> : null}
        </div>
      )}

      <section className="section">
        <div className="section-head"><h2>From this Market</h2></div>
        {listings.length > 0 ? (
          <div className="grid">{listings.map((l) => <ListingCard key={l.id} listing={l} promoted={!!l.has_active_promotion} />)}</div>
        ) : (
          <div className="empty"><div className="emoji">🌱</div><h2>Nothing active right now</h2><p>Check back soon.</p></div>
        )}
      </section>
    </main>
  );
}
