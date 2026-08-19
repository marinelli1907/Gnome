import Link from 'next/link';
import { areaLabel, marketPath } from '@/lib/format';
import type { WebMarket } from '@/lib/gnome';

export default function MarketCard({ market }: { market: WebMarket }) {
  return (
    <Link className="card" href={marketPath(market.slug)}>
      {market.banner_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={market.banner_url} alt={market.name} style={{ width: '100%', height: 110, objectFit: 'cover' }} />
      ) : (
        <div style={{ height: 110, background: 'linear-gradient(120deg,var(--garden-green),var(--harvest-yellow))' }} />
      )}
      <div className="body" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div className="avatar">
          {market.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={market.avatar_url} alt={market.name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            (market.name || '?').charAt(0).toUpperCase()
          )}
        </div>
        <div>
          <div className="title" style={{ marginBottom: 0 }}>
            {market.name} {market.verified ? '✓' : ''}
          </div>
          <div className="meta">
            {areaLabel(market.city, market.state)} · {market.active_listing_count} active
          </div>
        </div>
      </div>
    </Link>
  );
}
