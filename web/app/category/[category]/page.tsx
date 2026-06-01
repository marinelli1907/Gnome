import type { Metadata } from 'next';
import Link from 'next/link';
import ListingCard from '../../components/ListingCard';
import { categoryFor } from '@/lib/categories';
import { getCategoryListings } from '@/lib/gnome';

export const revalidate = 300;

type Params = { params: Promise<{ category: string }> };

function label(category: string) {
  const c = categoryFor(category);
  // For known ids show the label; for free-text intent terms, title-case the slug.
  return c.id === category ? c.label : category.charAt(0).toUpperCase() + category.slice(1);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { category } = await params;
  const name = label(category);
  const title = `Free & Local ${name} Near You`;
  const description = `Find ${name.toLowerCase()} shared, traded, and for sale by neighbors on Gnome.`;
  return { title, description, alternates: { canonical: `/category/${category}` }, openGraph: { title, description, type: 'website' } };
}

export default async function CategoryPage({ params }: Params) {
  const { category } = await params;
  const name = label(category);
  const cat = categoryFor(category);
  const listings = await getCategoryListings(category, 60);

  return (
    <main className="container">
      <div className="crumbs"><Link href="/">Home</Link> · {name}</div>
      <section className="hero" style={{ paddingBottom: 8 }}>
        <h1>{cat.id === category ? `${cat.emoji} ` : ''}{name} on Gnome</h1>
        <p>Homegrown {name.toLowerCase()} from Markets near you — free, trade, or for sale.</p>
      </section>
      {listings.length > 0 ? (
        <div className="grid">{listings.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
      ) : (
        <div className="empty">
          <div className="emoji">{cat.emoji}</div>
          <h2>No {name.toLowerCase()} listed right now</h2>
          <p>Check back soon, or open Gnome to post the first one.</p>
          <p><a className="btn btn-primary" href={process.env.NEXT_PUBLIC_IOS_APP_URL || 'https://apps.apple.com/'}>Open Gnome</a></p>
        </div>
      )}
    </main>
  );
}
