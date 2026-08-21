import type { Metadata } from 'next';
import Link from 'next/link';
import ListingCard from '../../components/ListingCard';
import MarketCard from '../../components/MarketCard';
import { CATEGORIES } from '@/lib/categories';
import { LAUNCH_LISTING_TYPES, parseArea, TYPE_LABEL, type ListingType } from '@/lib/format';
import { getActiveListings, getFeaturedListings, getFeaturedMarkets } from '@/lib/gnome';

export const revalidate = 300;

type Params = { params: Promise<{ city: string }>; searchParams: Promise<{ type?: string }> };
// Canonical order, minus plots — those have their own page (/plots) and were
// never offered as a chip here.
const TYPES: ListingType[] = LAUNCH_LISTING_TYPES.filter((t) => t !== 'plot');

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city } = await params;
  const area = parseArea(city);
  const title = `Fresh Local Produce, Plants & Farm Goods Near ${area}`;
  const description = `Browse for-sale, free, trade and wanted homegrown goods from Markets near ${area} on Gnome.`;
  return { title, description, alternates: { canonical: `/near/${city}` }, openGraph: { title, description, type: 'website' } };
}

export default async function NearPage({ params, searchParams }: Params) {
  const { city } = await params;
  const { type } = await searchParams;
  const area = parseArea(city);
  const activeType = TYPES.includes(type as ListingType) ? (type as ListingType) : undefined;

  const [featuredAll, listings, markets] = await Promise.all([
    getFeaturedListings(10),
    getActiveListings({ listingType: activeType, limit: 60 }),
    getFeaturedMarkets(6),
  ]);
  const featured = activeType ? featuredAll.filter((l) => l.listing_type === activeType) : featuredAll;

  return (
    <main className="container">
      <section className="hero" style={{ paddingBottom: 8 }}>
        <h1>Fresh near {area}</h1>
        <p>Homegrown produce, plants, eggs and farm goods shared, traded, and sold by neighbors.</p>
      </section>

      <div className="filterbar">
        <div className="chiprow">
          <Link className={`chip${!activeType ? ' active' : ''}`} href={`/near/${city}`}>All</Link>
          {TYPES.map((t) => (
            <Link
              key={t}
              className={`chip${activeType === t ? ' active' : ''}`}
              href={`/near/${city}?type=${t}`}
            >
              {TYPE_LABEL[t]}
            </Link>
          ))}
        </div>
        <div className="chiprow">
          {CATEGORIES.filter((c) => c.id !== 'other').map((c) => (
            <Link key={c.id} className="chip" href={`/category/${c.id}`}>{c.emoji} {c.label}</Link>
          ))}
        </div>
      </div>

      {featured.length >= 2 && (
        <section className="section">
          <div className="section-head"><h2>✨ Featured Near You</h2></div>
          <div className="rail">{featured.map((l) => <ListingCard key={l.id} listing={l} promoted />)}</div>
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2>{activeType ? `${TYPE_LABEL[activeType]} near ${area}` : `Available near ${area}`}</h2></div>
        {listings.length > 0 ? (
          <div className="grid">{listings.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
        ) : (
          <div className="empty">
            <div className="emoji">🌱</div>
            <h2>No fresh listings here yet</h2>
            <p>Be the first to start a Market in this area.</p>
            <p><a className="btn btn-primary" href={process.env.NEXT_PUBLIC_IOS_APP_URL || 'https://apps.apple.com/'}>Open Gnome</a></p>
          </div>
        )}
      </section>

      {markets.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Markets near {area}</h2></div>
          <div className="grid">{markets.map((m) => <MarketCard key={m.id} market={m} />)}</div>
        </section>
      )}
    </main>
  );
}
