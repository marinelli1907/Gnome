import Link from 'next/link';
import { categoryFor } from '@/lib/categories';
import { listingPath, timeLeft } from '@/lib/format';
import type { WebListing } from '@/lib/gnome';

export default function ListingCard({ listing }: { listing: WebListing }) {
  const cat = categoryFor(listing.category);
  const photo = listing.photos?.[0];
  return (
    <Link href={listingPath(listing.id, listing.title)} className="card">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="photo" src={photo} alt={listing.title} loading="lazy" />
      ) : (
        <div className="photo-fallback">{cat.emoji}</div>
      )}
      <div className="body">
        <div className="cat">
          {cat.emoji} {cat.label}
        </div>
        <div className="title">{listing.title}</div>
        <div className="meta">
          {listing.quantity ? `${listing.quantity} · ` : ''}
          {timeLeft(listing.expires_at)}
        </div>
      </div>
    </Link>
  );
}
