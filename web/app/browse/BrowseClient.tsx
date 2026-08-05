'use client';

// Location-aware browse: the browser's position + a radius filter over the
// privacy-safe coarse coordinates (approx_lat/lng, ~0.7mi cells — never exact
// addresses). Falls back gracefully when location is denied: everything shows,
// sorted newest-first, and the radius chips prompt for permission.
import { useEffect, useMemo, useState } from 'react';
import ListingCard from '../components/ListingCard';
import { CATEGORIES } from '../../lib/categories';
import type { WebListing } from '../../lib/gnome';
import { TYPE_LABEL } from '../../lib/format';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const COLS =
  'id,slug,title,description,category,listing_type,status,price_cents,currency,trade_for,quantity,unit,photos,city,county,state,fulfillment_type,market_id,market_name,market_slug,market_avatar_url,market_type,market_verified,created_at,expires_at,is_featured,featured_until,has_active_promotion,approx_lat,approx_lng';

type GeoListing = WebListing & { approx_lat: number | null; approx_lng: number | null };

const TYPES = ['free', 'trade', 'sale', 'wanted'] as const;
const RADII = [5, 10, 25, 50, 0] as const; // 0 = anywhere

function miles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export default function BrowseClient() {
  const [listings, setListings] = useState<GeoListing[] | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'asking' | 'granted' | 'denied'>('idle');
  const [radius, setRadius] = useState<number>(25);
  const [type, setType] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [q, setQ] = useState('');

  // Load listings once (client-side, anon REST — same boundary as the server pages).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/public_listings?select=${COLS}&order=created_at.desc&limit=300`,
          { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } },
        );
        setListings(res.ok ? await res.json() : []);
      } catch {
        setListings([]);
      }
    })();
  }, []);

  // Ask for location on first paint; harmless if declined.
  useEffect(() => {
    if (!('geolocation' in navigator)) { setGeoState('denied'); return; }
    setGeoState('asking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoState('granted');
      },
      () => setGeoState('denied'),
      { maximumAge: 300_000, timeout: 8_000 },
    );
  }, []);

  const filtered = useMemo(() => {
    if (!listings) return null;
    let rows = listings.map((l) => ({
      ...l,
      distance:
        coords && l.approx_lat != null && l.approx_lng != null
          ? miles(coords.lat, coords.lng, l.approx_lat, l.approx_lng)
          : null,
    }));
    if (type) rows = rows.filter((l) => l.listing_type === type);
    if (category) rows = rows.filter((l) => l.category === category);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter(
        (l) =>
          l.title.toLowerCase().includes(needle) ||
          (l.description ?? '').toLowerCase().includes(needle),
      );
    }
    if (coords && radius > 0) {
      rows = rows.filter((l) => l.distance == null || l.distance <= radius);
    }
    rows.sort((a, b) => {
      if (a.distance != null && b.distance != null && a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      if (a.distance != null && b.distance == null) return -1;
      if (a.distance == null && b.distance != null) return 1;
      return +new Date(b.created_at) - +new Date(a.created_at);
    });
    return rows;
  }, [listings, coords, radius, type, category, q]);

  return (
    <div>
      <div className="filterbar">
        <div className="browse-search">
          <input
            value={q}
            placeholder="Search tomatoes, eggs, firewood…"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="chiprow">
          <button className={`chip${!type ? ' active' : ''}`} onClick={() => setType(null)}>All</button>
          {TYPES.map((t) => (
            <button
              key={t}
              className={`chip${type === t ? ' active' : ''}`}
              onClick={() => setType(type === t ? null : t)}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
          <span className="chip-divider" aria-hidden />
          {RADII.map((r) => (
            <button
              key={r}
              className={`chip${radius === r ? ' active' : ''}`}
              disabled={!coords && r !== 0}
              title={!coords && r !== 0 ? 'Allow location to filter by distance' : undefined}
              onClick={() => setRadius(r)}
            >
              {r === 0 ? 'Anywhere' : `${r} mi`}
            </button>
          ))}
        </div>

        <div className="chiprow">
          <button className={`chip${!category ? ' active' : ''}`} onClick={() => setCategory(null)}>
            All categories
          </button>
          {CATEGORIES.filter((c) => c.id !== 'other').map((c) => (
            <button
              key={c.id}
              className={`chip${category === c.id ? ' active' : ''}`}
              onClick={() => setCategory(category === c.id ? null : c.id)}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>

        {geoState === 'denied' && (
          <p className="geo-note">
            📍 Location is off — showing everything, newest first. Allow location in your browser
            to filter by distance.
          </p>
        )}
        {geoState === 'granted' && coords && (
          <p className="geo-note">
            📍 Sorted by distance from you{radius > 0 ? ` · within ${radius} miles` : ''}. Locations
            are approximate — exact pickup spots are shared only after a claim is accepted.
          </p>
        )}
      </div>

      {filtered === null ? (
        <div className="empty"><p>Loading fresh listings…</p></div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <div className="emoji">🌱</div>
          <h2>Nothing matches yet</h2>
          <p>Widen the radius or clear a filter — or be the first to post nearby.</p>
          <p><a className="btn btn-primary" href="/sell">Post a listing</a></p>
        </div>
      ) : (
        <div className="grid">
          {filtered.map((l) => (
            <div key={l.id} className="browse-cardwrap">
              <ListingCard listing={l} />
              {l.distance != null && (
                <span className="distance-pill">
                  {l.distance < 1 ? '< 1 mi' : `${Math.round(l.distance)} mi`}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
