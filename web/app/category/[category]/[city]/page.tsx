import type { Metadata } from 'next';
import Link from 'next/link';
import ListingCard from '../../../components/ListingCard';
import { getActiveListings } from '@/lib/gnome';
import { categoryFor } from '@/lib/categories';
import { cityLabel } from '@/lib/format';

export const revalidate = 60;

type Params = { params: Promise<{ category: string; city: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { category, city } = await params;
  const cat = categoryFor(category);
  const name = cityLabel(city);
  const title = `Free ${cat.label} near ${name}`;
  const description = `Find free ${cat.label.toLowerCase()} shared by neighbors near ${name} on Gnome.`;
  return {
    title,
    description,
    alternates: { canonical: `/category/${category}/${city}` },
    openGraph: { title, description, type: 'website' },
  };
}

export default async function CategoryCityPage({ params }: Params) {
  const { category, city } = await params;
  const cat = categoryFor(category);
  const name = cityLabel(city);
  const listings = await getActiveListings({ category, limit: 60 });

  return (
    <main className="container">
      <div className="crumbs">
        <Link href={`/near/${city}`}>← Everything near {name}</Link>
      </div>
      <section className="hero">
        <h1>
          {cat.emoji} Free {cat.label} near {name}
        </h1>
        <p>Fresh {cat.label.toLowerCase()} shared free by neighbors.</p>
      </section>

      {listings.length > 0 ? (
        <div className="grid">
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <div className="emoji">{cat.emoji}</div>
          <p>
            No free {cat.label.toLowerCase()} near {name} right now. Try{' '}
            <Link href={`/near/${city}`} style={{ color: 'var(--green)', fontWeight: 600 }}>
              everything nearby
            </Link>
            .
          </p>
        </div>
      )}
    </main>
  );
}
