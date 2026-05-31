import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import OpenInApp from '../../components/OpenInApp';
import { getListingById } from '@/lib/gnome';
import { categoryFor } from '@/lib/categories';
import { cityLabel, idFromSlugId, timeLeft } from '@/lib/format';

export const revalidate = 60;

type Params = { params: Promise<{ slugId: string }> };

function locationLabel(city: string | null, state: string | null): string {
  if (city && state) return `${city}, ${state}`;
  return city || 'your area';
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slugId } = await params;
  const id = idFromSlugId(slugId);
  const listing = id ? await getListingById(id) : null;
  if (!listing) {
    return { title: 'Listing not found', robots: { index: false } };
  }
  const cat = categoryFor(listing.category);
  const where = locationLabel(listing.city, listing.state);
  const title = `Free ${listing.title} in ${where}`;
  const description =
    listing.description?.slice(0, 160) ||
    `${listing.quantity ? listing.quantity + ' of ' : ''}${cat.label.toLowerCase()} shared free by a neighbor on Gnome.`;
  const image = listing.photos?.[0];
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ListingPage({ params }: Params) {
  const { slugId } = await params;
  const id = idFromSlugId(slugId);
  const listing = id ? await getListingById(id) : null;
  if (!listing) notFound();

  const cat = categoryFor(listing.category);
  const where = locationLabel(listing.city, listing.state);
  const photo = listing.photos?.[0];

  return (
    <main className="container">
      <div className="crumbs">
        <Link href="/">Home</Link> · {cat.emoji} {cat.label}
      </div>

      <article className="detail">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="hero-img" src={photo} alt={listing.title} />
        ) : (
          <div className="hero-img photo-fallback" style={{ fontSize: 72 }}>
            {cat.emoji}
          </div>
        )}

        <div>
          <span className="pill">Available · Free</span>
          <h1 style={{ marginTop: 10 }}>{listing.title}</h1>
          <p className="sub">
            {cat.emoji} {cat.label}
            {listing.quantity ? ` · ${listing.quantity}` : ''} · in {where} ·{' '}
            {timeLeft(listing.expires_at)}
          </p>

          {listing.description ? <p className="desc">{listing.description}</p> : null}

          <div className="cta-row">
            <OpenInApp listingId={listing.id} label="Claim in app" variant="primary" />
            <OpenInApp listingId={listing.id} label="Open in app" variant="secondary" />
          </div>

          <p className="owner">
            Shared by {listing.owner?.name ?? 'a neighbor'} · Claiming and pickup happen
            in the free Gnome app.
          </p>
        </div>
      </article>
    </main>
  );
}
