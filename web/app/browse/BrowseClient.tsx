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

const TYPES = ['free', 'trade', 'sale', 'wanted', 'plot'] as const;
const RADII = [5, 10, 25, 50, 0] as const; // 0 = anywhere

const LOC_KEY = 'gnome-manual-location';

// Free, keyless geocoding via OpenStreetMap Nominatim (browser sends the
// Referer header, which satisfies their usage policy at our volume).
async function geocode(q: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!rows[0]) return null;
  // "123 Main St, Lyndhurst, Cuyahoga County, Ohio, 44124, United States"
  // → keep the first few parts, drop county/zip/country noise.
  const label = rows[0].display_name
    .split(',')
    .map((s) => s.trim())
    .filter((s) => !/^(United States|\d{5}(-\d{4})?|.+ County)$/.test(s))
    .slice(0, 2)
    .join(', ');
  return { lat: +rows[0].lat, lng: +rows[0].lon, label };
}

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
  const [geoState, setGeoState] = useState<'idle' | 'asking' | 'granted' | 'denied' | 'manual'>('idle');
  const [manualLabel, setManualLabel] = useState<string | null>(null);
  const [locOpen, setLocOpen] = useState(false);
  const [locInput, setLocInput] = useState('');
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [radius, setRadius] = useState<number>(25);
  const [type, setType] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [q, setQ] = useState('');

  // Honor a ?type= deep link (e.g. /browse?type=plot from the Plots page).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('type');
    if (t && (TYPES as readonly string[]).includes(t)) setType(t);
  }, []);

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

  // A saved manual location wins (the user told us the browser guess was
  // wrong); otherwise ask for location on first paint — harmless if declined.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOC_KEY);
      if (saved) {
        const { lat, lng, label } = JSON.parse(saved) as { lat: number; lng: number; label: string };
        if (typeof lat === 'number' && typeof lng === 'number') {
          setCoords({ lat, lng });
          setManualLabel(label ?? null);
          setGeoState('manual');
          return;
        }
      }
    } catch { /* fall through to geolocation */ }
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

  async function useAddress() {
    if (locBusy || !locInput.trim()) return;
    setLocBusy(true);
    setLocError(null);
    try {
      const found = await geocode(locInput.trim());
      if (!found) {
        setLocError('Couldn’t find that — try "city, state" or a fuller address.');
      } else {
        setCoords({ lat: found.lat, lng: found.lng });
        setManualLabel(found.label);
        setGeoState('manual');
        setLocOpen(false);
        setLocInput('');
        try { localStorage.setItem(LOC_KEY, JSON.stringify(found)); } catch { /* private mode */ }
      }
    } catch {
      setLocError('Location lookup failed — try again in a moment.');
    } finally {
      setLocBusy(false);
    }
  }

  function useCurrentLocation() {
    try { localStorage.removeItem(LOC_KEY); } catch { /* ignore */ }
    setManualLabel(null);
    setLocOpen(false);
    if (!('geolocation' in navigator)) { setGeoState('denied'); return; }
    setGeoState('asking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoState('granted');
      },
      () => { setCoords(null); setGeoState('denied'); },
      { maximumAge: 0, timeout: 8_000 },
    );
  }

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

        {geoState === 'denied' && !locOpen && (
          <p className="geo-note">
            📍 Location is off — showing everything, newest first.{' '}
            <button className="linkbtn" onClick={() => setLocOpen(true)}>Enter your address or city</button>{' '}
            to sort by distance.
          </p>
        )}
        {geoState === 'granted' && coords && !locOpen && (
          <p className="geo-note">
            📍 Sorted by distance from you{radius > 0 ? ` · within ${radius} miles` : ''}. Locations
            are approximate — exact pickup spots are shared only after a claim is accepted.{' '}
            <button className="linkbtn" onClick={() => setLocOpen(true)}>Wrong spot? Enter an address</button>
          </p>
        )}
        {geoState === 'manual' && coords && !locOpen && (
          <p className="geo-note">
            📍 Near <strong>{manualLabel ?? 'your saved location'}</strong>
            {radius > 0 ? ` · within ${radius} miles` : ''}.{' '}
            <button className="linkbtn" onClick={() => setLocOpen(true)}>Change</button>
            {' · '}
            <button className="linkbtn" onClick={useCurrentLocation}>Use my current location</button>
          </p>
        )}
        {locOpen && (
          <div className="locrow">
            <input
              value={locInput}
              placeholder="Address or city, state — e.g. Richmond Heights, OH"
              onChange={(e) => setLocInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void useAddress(); }}
              autoFocus
            />
            <button className="btn btn-primary btn-sm" disabled={locBusy} onClick={() => void useAddress()}>
              {locBusy ? 'Finding…' : 'Use it'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setLocOpen(false); setLocError(null); }}>
              Cancel
            </button>
          </div>
        )}
        {locError && <p className="autherror">{locError}</p>}
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
