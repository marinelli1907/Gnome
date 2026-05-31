import Link from 'next/link';
import ListingCard from './components/ListingCard';
import { getActiveListings } from '@/lib/gnome';

export const revalidate = 60;

// A few seed communities for landing pages (Richmond Heights 44143 is the launch
// zip). These are display/SEO entry points; the feed is citywide for now.
const CITIES = [
  'richmond-heights',
  'lyndhurst',
  'mayfield-heights',
  'south-euclid',
  'cleveland-heights',
];

export default async function HomePage() {
  const listings = await getActiveListings({ limit: 12 });
  return (
    <main className="container">
      <section className="hero">
        <h1>Free surplus produce from neighbors near you</h1>
        <p>
          Someone&apos;s zucchini always wins. Gnome connects gardeners with extra
          fruit, veg, herbs and eggs to neighbors who&apos;ll use them — for free.
        </p>
      </section>

      <div className="chips">
        {CITIES.map((c) => (
          <Link key={c} href={`/near/${c}`} className="chip">
            {c.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')}
          </Link>
        ))}
      </div>

      {listings.length > 0 ? (
        <div className="grid">
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <div className="emoji">🌱</div>
          <p>No active listings yet — check back soon, or post the first one in the app.</p>
        </div>
      )}
    </main>
  );
}
