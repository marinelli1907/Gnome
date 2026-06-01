import Link from 'next/link';
import ListingCard from './components/ListingCard';
import MarketCard from './components/MarketCard';
import { CATEGORIES } from '@/lib/categories';
import { getActiveListings, getFeaturedListings, getFeaturedMarkets } from '@/lib/gnome';

export const revalidate = 120;

const AREAS = [
  { slug: 'lyndhurst-oh', label: 'Lyndhurst' },
  { slug: 'richmond-heights-oh', label: 'Richmond Heights' },
  { slug: 'mayfield-heights-oh', label: 'Mayfield Heights' },
  { slug: 'south-euclid-oh', label: 'South Euclid' },
];
const TYPES = [
  { v: 'free', label: '🧺 Free' },
  { v: 'trade', label: '🔄 Trade' },
  { v: 'sale', label: '🏷️ For Sale' },
  { v: 'wanted', label: '🔎 Wanted' },
];
const STEPS = [
  { n: '🍅', t: 'Find it nearby', d: 'Browse fresh produce, plants, eggs and farm goods from Markets near you.' },
  { n: '🤝', t: 'Claim or request', d: 'Claim a free share, offer a trade, or request to buy — all in the app.' },
  { n: '🧺', t: 'Pick it up local', d: 'Arrange a neighborly pickup. No shipping, no middleman.' },
];

export default async function HomePage() {
  const [featured, recent, markets] = await Promise.all([
    getFeaturedListings(8),
    getActiveListings({ limit: 8 }),
    getFeaturedMarkets(6),
  ]);

  return (
    <main className="container">
      <section className="hero">
        <h1>A farmers market in your pocket.</h1>
        <p>Share, trade, buy, and sell homegrown goods from Markets near you.</p>
        <div className="row">
          <a className="btn btn-primary" href={process.env.NEXT_PUBLIC_IOS_APP_URL || 'https://apps.apple.com/'}>Open Gnome</a>
          <Link className="btn btn-secondary" href={`/near/${AREAS[0].slug}`}>Browse Near You</Link>
        </div>
      </section>

      {featured.length >= 2 && (
        <section className="section">
          <div className="section-head"><h2>✨ Featured Near You</h2></div>
          <div className="rail">
            {featured.map((l) => <ListingCard key={l.id} listing={l} promoted />)}
          </div>
        </section>
      )}

      <section className="section">
        <h2>Browse by type</h2>
        <p className="sub">Free shares, trades, things for sale, and wanted posts.</p>
        <div className="chips">
          {TYPES.map((t) => (
            <Link key={t.v} className="chip" href={`/near/${AREAS[0].slug}?type=${t.v}`}>{t.label}</Link>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Browse categories</h2>
        <div className="chips">
          {CATEGORIES.map((c) => (
            <Link key={c.id} className="chip" href={`/category/${c.id}`}>{c.emoji} {c.label}</Link>
          ))}
        </div>
      </section>

      {markets.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Featured Markets</h2></div>
          <div className="grid">{markets.map((m) => <MarketCard key={m.id} market={m} />)}</div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Fresh on Gnome</h2>
            <Link href={`/near/${AREAS[0].slug}`}>See more →</Link>
          </div>
          <div className="grid">{recent.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
        </section>
      )}

      <section className="section">
        <h2>How Gnome works</h2>
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.t}>
              <div className="n">{s.n}</div>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Get the Gnome app</h2>
        <p className="sub">Posting, claiming, trading and buying all happen in the free app.</p>
        <div className="row" style={{ display: 'flex', gap: 12 }}>
          <a className="btn btn-primary" href={process.env.NEXT_PUBLIC_IOS_APP_URL || 'https://apps.apple.com/'}>Open Gnome</a>
        </div>
      </section>

      <section className="section">
        <h2>Near you</h2>
        <div className="chips">
          {AREAS.map((a) => <Link key={a.slug} className="chip" href={`/near/${a.slug}`}>{a.label}</Link>)}
        </div>
      </section>
    </main>
  );
}
