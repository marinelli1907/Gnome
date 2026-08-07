import Link from 'next/link';
import { categoryFor } from '@/lib/categories';
import { areaLabel, formatPrice, listingPath, TYPE_LABEL, timeLeft } from '@/lib/format';
import type { WebListing } from '@/lib/gnome';

function shortValue(l: WebListing): string {
  if (l.listing_type === 'sale') return l.price_cents != null ? formatPrice(l.price_cents, l.unit) : 'For sale';
  if (l.listing_type === 'trade') return 'Trade';
  if (l.listing_type === 'wanted') return 'Wanted';
  if (l.listing_type === 'plot') return l.price_cents != null ? `Reserve ${formatPrice(l.price_cents)}` : 'Reserve';
  return 'Free';
}

export default function ListingCard({ listing, promoted }: { listing: WebListing; promoted?: boolean }) {
  const cat = categoryFor(listing.category);
  const photo = listing.photos?.[0];
  const t = listing.listing_type;
  return (
    <Link className="card" href={listingPath(listing.id, listing.slug ?? listing.title)}>
      <div className="imgwrap">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={listing.title} loading="lazy" />
        ) : (
          <div className="fallback">{cat.emoji}</div>
        )}
        <span className={`badge ${t}`}>{TYPE_LABEL[t]}</span>
        {listing.is_demo ? <span className="preview-chip">Preview</span> : null}
        {promoted ? <span className="promoted">Promoted</span> : null}
        <span className="valuechip">{shortValue(listing)}</span>
      </div>
      <div className="body">
        <div className="title">{t === 'wanted' ? `Looking for ${listing.title}` : listing.title}</div>
        {listing.market_name ? <div className="market">🏡 {listing.market_name}</div> : null}
        <div className="meta">
          {areaLabel(listing.city, listing.state)} · {timeLeft(listing.expires_at)}
        </div>
      </div>
    </Link>
  );
}
