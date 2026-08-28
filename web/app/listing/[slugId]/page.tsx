import type { Metadata } from 'next';
import Link from 'next/link';
import AppLink from '../../components/AppLink';
import ListingCard from '../../components/ListingCard';
import ReservePlot from '../../components/ReservePlot';
import { categoryFor } from '@/lib/categories';
import { appCtaLabel, areaLabel, formatPrice, idFromSlugId, listingPath, listingValue, marketPath, pickedDateLabel, TYPE_LABEL } from '@/lib/format';
import { getActiveListings, getBundleComponents, getListingById, getMarketBySlug } from '@/lib/gnome';

export const revalidate = 60;

type Params = { params: Promise<{ slugId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slugId } = await params;
  const id = idFromSlugId(slugId);
  const l = id ? await getListingById(id) : null;
  if (!l) return { title: 'Listing unavailable', robots: { index: false } };
  const where = areaLabel(l.city, l.state);
  const cat = categoryFor(l.category);
  const verb = l.listing_type === 'wanted' ? 'Wanted' : TYPE_LABEL[l.listing_type];
  const title = `${verb}: ${l.title} near ${where}`;
  const description = l.description?.slice(0, 160) || `${cat.label} ${l.listing_type === 'sale' ? 'for sale' : 'shared'} on Gnome near ${where}.`;
  const image = l.photos?.[0];
  return {
    title,
    description,
    openGraph: { title, description, type: 'article', images: image ? [{ url: image }] : undefined },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, description, images: image ? [image] : undefined },
  };
}

export default async function ListingPage({ params }: Params) {
  const { slugId } = await params;
  const id = idFromSlugId(slugId);
  const listing = id ? await getListingById(id) : null;
  const components = listing?.is_bundle ? await getBundleComponents(listing.id) : [];

  // Not active (expired/removed/never existed) → unavailable + related.
  if (!listing) {
    const related = await getActiveListings({ limit: 6 });
    return (
      <main className="container">
        <div className="empty">
          <div className="emoji">🥕</div>
          <h2>This listing isn’t available</h2>
          <p>It may have expired or been picked up. Here’s what’s fresh right now.</p>
          <p><a className="btn btn-primary" href={process.env.NEXT_PUBLIC_IOS_APP_URL || 'https://apps.apple.com/'}>Open Gnome</a></p>
        </div>
        {related.length > 0 && <div className="grid">{related.map((l) => <ListingCard key={l.id} listing={l} />)}</div>}
      </main>
    );
  }

  const l = listing;
  const market = l.market_slug ? await getMarketBySlug(l.market_slug) : null;
  const repBits: string[] = [];
  if (market) {
    if (market.member_since) repBits.push(`Since ${new Date(market.member_since).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`);
    if (market.listings_shared) repBits.push(`${market.listings_shared} shared`);
    if (market.response_rate != null) repBits.push(`responds ${market.response_rate}% in 2 days`);
  }
  const cat = categoryFor(l.category);
  const where = areaLabel(l.city, l.state);
  const photos = l.photos ?? [];
  const fulfillment = l.fulfillment_type ? l.fulfillment_type.replace(/^\w/, (c) => c.toUpperCase()) : 'Pickup';
  const picked = pickedDateLabel(l.harvest_date);

  return (
    <main className="container">
      <div className="crumbs">
        <Link href="/">Home</Link> · <Link href={`/category/${l.category}`}>{cat.label}</Link>
      </div>

      {l.is_demo && (
        <div className="preview-note">
          👋 This is a <strong>preview listing</strong> showing how Gnome works — it isn’t
          real inventory. <Link href="/sell">Post something real</Link> and yours takes its place.
        </div>
      )}

      <article className="detail">
        <div className="gallery">
          {photos[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photos[0]} alt={l.title} />
          ) : (
            <div className="fallback">{cat.emoji}</div>
          )}
          {photos.length > 1 && (
            <div className="thumbs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {photos.slice(1, 5).map((p) => <img key={p} src={p} alt="" />)}
            </div>
          )}
        </div>

        <div className="sidebar">
          <div>
            <span className={`tag type-${l.listing_type}`}>{TYPE_LABEL[l.listing_type]}</span>
            {l.has_active_promotion ? <span className="tag featured" style={{ marginLeft: 6 }}>✨ Featured</span> : null}
            <h1>{l.listing_type === 'wanted' ? `Looking for ${l.title}` : l.title}</h1>
            <div className={`value ${l.listing_type === 'sale' ? 'sale' : ''}`}>{listingValue(l)}</div>
            <div className="meta-line">
              {cat.emoji} {cat.label}
              {l.quantity ? ` · ${l.listing_type === 'plot' ? `Plot size: ${l.quantity}` : l.quantity}` : ''}
              {l.listing_type === 'plot' && l.inventory_count != null
                ? ` · ${l.inventory_count} plot${l.inventory_count === 1 ? '' : 's'} available`
                : ''}
              {picked ? ` · ${picked}` : ''}
              {' · '}{where} · {fulfillment}
            </div>
            {l.description ? <p className="desc">{l.description}</p> : null}
            {l.is_bundle ? (
              <div className="preview-note" style={{ marginTop: 10 }}>
                <strong>🎁 What’s inside this basket</strong>
                {components.length > 0 ? (
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {components.map((c) => (
                      <li key={c.id} style={{ fontSize: 14 }}>
                        <Link href={listingPath(c.id, c.slug ?? c.title)}>{c.title}</Link>
                        {c.price_cents != null && (
                          <span style={{ opacity: 0.65 }}>
                            {' '}· usually {formatPrice(c.price_cents, c.unit)} on its own
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ margin: '6px 0 0' }}>This basket isn’t available right now — an item inside it is spoken for.</p>
                )}
                <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.75 }}>
                  One basket, one price — everything listed above comes together.
                </p>
              </div>
            ) : null}
          </div>

          {l.market_id && l.market_slug && (
            <Link className="mini-market" href={marketPath(l.market_slug)}>
              <div className="avatar">
                {l.market_avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.market_avatar_url} alt={l.market_name ?? ''} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  (l.market_name || '?').charAt(0).toUpperCase()
                )}
              </div>
              <div>
                <strong>{l.market_name} {l.market_verified ? '✓' : ''}</strong>
                <div className="meta">{where} · Visit Market →</div>
              </div>
            </Link>
          )}
          {repBits.length > 0 ? <div className="rep-compact">{repBits.join(' · ')}</div> : null}

          <div className="cta-stack">
            {l.listing_type === 'plot' ? (
              <ReservePlot
                listingId={l.id}
                priceCents={l.price_cents}
                options={l.request_options ?? null}
                allowCustom={l.allow_custom_request !== false}
              />
            ) : l.market_id ? (
              <AppLink kind="listing" id={l.id} label={appCtaLabel(l.listing_type)} variant="primary" />
            ) : null}
            <AppLink kind="listing" id={l.id} label="Open in Gnome" variant="secondary" />
          </div>

          {l.listing_type === 'sale' && (
            <div className="note">Payments are arranged directly with the seller. Gnome does not process payment on the web yet.</div>
          )}
          {l.listing_type === 'plot' && (
            <div className="note">
              A reservation is a request — the grower approves it, then you arrange
              payment and pickup together. Gnome doesn’t hold funds or take a cut.
              Agree up front on timing and what happens if a crop fails.
            </div>
          )}
          <div className="note">Meet in a safe, public spot for pickup. Pickup details are shared in the app after a request is approved.</div>
        </div>
      </article>
    </main>
  );
}
