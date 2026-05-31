import type { Metadata } from 'next';
import Link from 'next/link';
import ListingCard from '../../components/ListingCard';
import { getActiveListings } from '@/lib/gnome';
import { CATEGORIES } from '@/lib/categories';
import { cityLabel } from '@/lib/format';

export const revalidate = 60;

type Params = { params: Promise<{ city: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city } = await params;
  const name = cityLabel(city);
  const title = `Free surplus produce near ${name}`;
  const description = `Browse free garden surplus near ${name} — fruit, vegetables, herbs, eggs and more shared by neighbors on Gnome.`;
  return {
    title,
    description,
    alternates: { canonical: `/near/${city}` },
    openGraph: { title, description, type: 'website' },
  };
}

export default async function NearCityPage({ params }: Params) {
  const { city } = await params;
  const name = cityLabel(city);
  const listings = await getActiveListings({ limit: 60 });

  return (
    <main className="container">
      <section className="hero">
        <h1>Free surplus produce near {name}</h1>
        <p>Fresh-picked extras shared by neighbors. Grab what you can use — it&apos;s all free.</p>
      </section>

      <div className="chips">
        {CATEGORIES.map((c) => (
          <Link key={c.id} href={`/category/${c.id}/${city}`} className="chip">
            {c.emoji} {c.label}
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
          <p>No active listings near {name} right now. Check back soon!</p>
        </div>
      )}
    </main>
  );
}
