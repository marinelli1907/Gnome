'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ListingCard from '../components/ListingCard';
import {
  fetchTaxonomy,
  matchNodes,
  nodeInAnySubtree,
  subtreeIds,
  type TaxonomyIndex,
  type TaxonomyNode,
} from '../../lib/taxonomy';
import type { WebListing } from '../../lib/gnome';
import { areaLabel, formatPrice, LAUNCH_LISTING_TYPES, listingPath, TYPE_LABEL } from '../../lib/format';
import { logWeb } from '../../lib/analytics';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const LOC_KEY = 'gnome-manual-location';

const COLS =
  'id,slug,title,description,category,listing_type,status,price_cents,currency,trade_for,quantity,unit,photos,city,county,state,fulfillment_type,market_id,market_name,market_slug,market_avatar_url,market_type,market_verified,created_at,expires_at,is_featured,featured_until,has_active_promotion,is_demo,approx_lat,approx_lng,taxonomy_node_id,harvest_date';

type MapListing = WebListing & {
  approx_lat: number | null;
  approx_lng: number | null;
  taxonomy_node_id: string | null;
  distance?: number | null;
};

type MappedListing = MapListing & { approx_lat: number; approx_lng: number };
type LeafletModule = typeof import('leaflet');
type LeafletMap = import('leaflet').Map;
type LeafletLayerGroup = import('leaflet').LayerGroup;

const TYPES = LAUNCH_LISTING_TYPES;

const TYPE_ICON: Record<string, string> = {
  sale: 'Sell',
  free: 'Free',
  trade: 'Trade',
  plot: 'Plot',
};

function miles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function geocode(q: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!rows[0]) return null;
  const label = rows[0].display_name
    .split(',')
    .map((s) => s.trim())
    .filter((s) => !/^(United States|\d{5}(-\d{4})?|.+ County)$/.test(s))
    .slice(0, 2)
    .join(', ');
  return { lat: +rows[0].lat, lng: +rows[0].lon, label };
}

function listingValue(listing: MapListing): string {
  if (listing.listing_type === 'sale') {
    return listing.price_cents != null ? formatPrice(listing.price_cents, listing.unit) : 'For sale';
  }
  if (listing.listing_type === 'trade') return 'Trade';
  if (listing.listing_type === 'plot') return listing.price_cents != null ? `Reserve ${formatPrice(listing.price_cents)}` : 'Reserve';
  return 'Free';
}

function rootForListing(index: TaxonomyIndex | null, listing: MapListing): TaxonomyNode | null {
  if (!index || !listing.taxonomy_node_id) return null;
  const node = index.byId.get(listing.taxonomy_node_id);
  if (!node) return null;
  return index.roots.find((root) => node.id === root.id || node.path.startsWith(`${root.path}/`)) ?? null;
}

function hasMapPoint(listing: MapListing): listing is MappedListing {
  return typeof listing.approx_lat === 'number' && typeof listing.approx_lng === 'number';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export default function MapClient() {
  const router = useRouter();
  const [listings, setListings] = useState<MapListing[] | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'asking' | 'granted' | 'denied' | 'manual'>('idle');
  const [manualLabel, setManualLabel] = useState<string | null>(null);
  const [locInput, setLocInput] = useState('');
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [radius, setRadius] = useState(25);
  const [type, setType] = useState<string | null>(null);
  const [taxIndex, setTaxIndex] = useState<TaxonomyIndex | null>(null);
  const [taxNodeId, setTaxNodeId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LeafletLayerGroup | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      for (let attempt = 0; attempt < 3 && alive; attempt++) {
        const idx = await fetchTaxonomy();
        if (idx) {
          if (alive) setTaxIndex(idx);
          return;
        }
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cat = params.get('cat');
    if (cat?.trim()) {
      const root = taxIndex?.roots.find((r) => r.slug === cat.trim());
      if (root) setTaxNodeId(root.id);
    }
    const t = params.get('type');
    if (t && (TYPES as readonly string[]).includes(t)) setType(t);
  }, [taxIndex]);

  useEffect(() => {
    void (async () => {
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
    } catch { /* ask normally */ }
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

  const taxNode = taxIndex && taxNodeId ? taxIndex.byId.get(taxNodeId) ?? null : null;

  const filtered = useMemo<MapListing[] | null>(() => {
    if (!listings) return null;
    let rows = listings.map((listing) => ({
      ...listing,
      distance:
        coords && listing.approx_lat != null && listing.approx_lng != null
          ? miles(coords.lat, coords.lng, listing.approx_lat, listing.approx_lng)
          : null,
    }));
    rows = rows.filter((listing) => (TYPES as readonly string[]).includes(listing.listing_type));
    if (type) rows = rows.filter((listing) => listing.listing_type === type);
    if (taxNode && taxIndex) {
      const ids = subtreeIds(taxIndex, taxNode);
      rows = rows.filter((listing) => listing.taxonomy_node_id != null && ids.has(listing.taxonomy_node_id));
    }
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      const matched = taxIndex ? matchNodes(taxIndex, needle) : [];
      rows = rows.filter(
        (listing) =>
          listing.title.toLowerCase().includes(needle) ||
          (listing.description ?? '').toLowerCase().includes(needle) ||
          (taxIndex !== null && nodeInAnySubtree(taxIndex, listing.taxonomy_node_id, matched)),
      );
    }
    if (coords && radius > 0) {
      rows = rows.filter((listing) => listing.distance == null || listing.distance <= radius);
    }
    rows.sort((a, b) => {
      if (a.distance != null && b.distance != null && a.distance !== b.distance) return a.distance - b.distance;
      if (a.distance != null && b.distance == null) return -1;
      if (a.distance == null && b.distance != null) return 1;
      return +new Date(b.created_at) - +new Date(a.created_at);
    });
    return rows;
  }, [coords, listings, q, radius, taxIndex, taxNode, type]);

  const markets = useMemo(() => {
    const groups = new Map<string, MapListing[]>();
    for (const listing of filtered ?? []) {
      const key = listing.market_id ?? listing.market_name ?? listing.id;
      groups.set(key, [...(groups.get(key) ?? []), listing]);
    }
    return Array.from(groups.entries()).map(([key, rows]) => ({
      key,
      name: rows[0]?.market_name ?? 'Neighborhood market',
      slug: rows[0]?.market_slug ?? null,
      location: areaLabel(rows[0]?.city ?? null, rows[0]?.state ?? null),
      distance: rows.find((row) => row.distance != null)?.distance ?? null,
      rows,
    }));
  }, [filtered]);

  const mappedListings = useMemo<MappedListing[]>(() => (filtered ?? []).filter(hasMapPoint).slice(0, 120), [filtered]);

  useEffect(() => {
    if (!mapElRef.current) return;
    let cancelled = false;

    void (async () => {
      try {
        const L = leafletRef.current ?? await import('leaflet');
        if (cancelled || !mapElRef.current) return;
        leafletRef.current = L;

        if (!mapRef.current) {
          const start: [number, number] = coords
            ? [coords.lat, coords.lng]
            : mappedListings[0]
              ? [mappedListings[0].approx_lat, mappedListings[0].approx_lng]
              : [39.5, -98.35];
          mapRef.current = L.map(mapElRef.current, {
            center: start,
            zoom: coords || mappedListings[0] ? 12 : 4,
            scrollWheelZoom: true,
            zoomControl: true,
          });
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors',
          }).addTo(mapRef.current);
          layerRef.current = L.layerGroup().addTo(mapRef.current);
        }

        const map = mapRef.current;
        const layer = layerRef.current;
        if (!map || !layer) return;
        layer.clearLayers();

        if (coords) {
          L.circle([coords.lat, coords.lng], {
            radius: radius > 0 ? radius * 1609.344 : 1609.344,
            color: '#6B2FB9',
            fillColor: '#6B2FB9',
            fillOpacity: radius > 0 ? 0.07 : 0.12,
            opacity: 0.45,
            weight: 2,
          }).addTo(layer);
        }

        const bounds = L.latLngBounds([]);
        mappedListings.forEach((listing) => {
          const path = listingPath(listing.id, listing.slug ?? listing.title);
          const point: [number, number] = [listing.approx_lat, listing.approx_lng];
          const icon = L.divIcon({
            className: 'leaflet-gnome-icon',
            iconSize: [154, 40],
            iconAnchor: [77, 20],
            html: `
              <span class="leaflet-gnome-pin pin-${escapeHtml(listing.listing_type)}">
                <span class="leaflet-pin-symbol">${escapeHtml(TYPE_ICON[listing.listing_type] ?? 'Pin')}</span>
                <span class="leaflet-pin-label">${escapeHtml(listing.title)}</span>
              </span>
            `,
          });
          const marker = L.marker(point, {
            icon,
            keyboard: true,
            title: `${listing.title}, ${TYPE_LABEL[listing.listing_type]}`,
          }).addTo(layer);
          marker.on('click', () => router.push(path));
          marker.bindTooltip(`${listing.title} · ${listingValue(listing)}`, { direction: 'top', offset: [0, -12] });
          bounds.extend(point);
        });

        if (mappedListings.length > 1 && bounds.isValid()) {
          map.fitBounds(bounds, { padding: [52, 52], maxZoom: 13 });
        } else if (mappedListings.length === 1) {
          map.setView([mappedListings[0].approx_lat, mappedListings[0].approx_lng], coords ? 13 : 12);
        } else if (coords) {
          map.setView([coords.lat, coords.lng], 12);
        }
        setMapError(null);
      } catch {
        setMapError('The map tiles could not load. Listings and Markets are still available below.');
      }
    })();

    return () => { cancelled = true; };
  }, [coords, mappedListings, radius, router]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  async function useAddress() {
    if (locBusy || !locInput.trim()) return;
    setLocBusy(true);
    setLocError(null);
    try {
      const found = await geocode(locInput.trim());
      if (!found) {
        setLocError('Couldn’t find that spot. Try a city, state, or ZIP code.');
      } else {
        setCoords({ lat: found.lat, lng: found.lng });
        setManualLabel(found.label);
        setGeoState('manual');
        setLocInput('');
        try { localStorage.setItem(LOC_KEY, JSON.stringify(found)); } catch { /* private mode */ }
        logWeb('map_location_set', { label: found.label });
      }
    } catch {
      setLocError('Location lookup failed. Try again in a moment.');
    } finally {
      setLocBusy(false);
    }
  }

  function useCurrentLocation() {
    try { localStorage.removeItem(LOC_KEY); } catch { /* ignore */ }
    setManualLabel(null);
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

  return (
    <div className="map-workspace">
      <section className="map-filter-panel">
        <div className="browse-search map-search">
          <input
            value={q}
            placeholder="Search tomatoes, herbs, eggs, firewood..."
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="map-filter-row">
          <div className="locrow map-locrow">
            <input
              value={locInput}
              placeholder="Address, ZIP, or city"
              onChange={(e) => setLocInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void useAddress(); }}
            />
            <button className="btn btn-primary btn-sm" disabled={locBusy} onClick={() => void useAddress()}>
              {locBusy ? 'Finding...' : 'Use it'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={useCurrentLocation}>Current</button>
          </div>
          <div className="radius-row map-radius">
            <input
              type="range"
              min={1}
              max={50}
              value={radius === 0 ? 50 : Math.min(50, radius)}
              disabled={radius === 0}
              aria-label="Search radius in miles"
              onChange={(e) => setRadius(Number(e.target.value))}
            />
            <span className="chip">{radius === 0 ? 'Anywhere' : `${radius} mi`}</span>
            <button className={`chip${radius === 0 ? ' active' : ''}`} onClick={() => setRadius(radius === 0 ? 25 : 0)}>
              Anywhere
            </button>
          </div>
        </div>
        {locError ? <p className="autherror">{locError}</p> : null}
        <p className="geo-note map-note">
          {geoState === 'manual' && manualLabel ? `Near ${manualLabel}` : coords ? 'Using your current location' : 'Set a location to sort by distance'}
          {coords && radius > 0 ? ` · within ${radius} miles` : ''}
        </p>

        {taxIndex ? (
          <div className="tax-rail map-tax-rail" role="group" aria-label="Category">
            <button className={`chip${!taxNode ? ' active' : ''}`} onClick={() => setTaxNodeId(null)}>
              All
            </button>
            {taxIndex.roots.map((root) => {
              const active = !!taxNode && (taxNode.id === root.id || taxNode.path.startsWith(`${root.path}/`));
              return (
                <button
                  key={root.id}
                  className={`chip${active ? ' active' : ''}`}
                  onClick={() => setTaxNodeId(active ? null : root.id)}
                >
                  {root.icon ? `${root.icon} ` : ''}{root.name}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="chiprow map-type-row">
          <button className={`chip${!type ? ' active' : ''}`} onClick={() => setType(null)}>All types</button>
          {TYPES.map((item) => (
            <button
              key={item}
              className={`chip type-chip-${item}${type === item ? ' active' : ''}`}
              onClick={() => setType(type === item ? null : item)}
            >
              {TYPE_LABEL[item]}
            </button>
          ))}
        </div>
      </section>

      <section className="market-map-canvas" aria-label="Filtered Gnome markets map">
        <div className="map-canvas-head">
          <div>
            <strong>{mappedListings.length}</strong>
            <span> pin{mappedListings.length === 1 ? '' : 's'} · {filtered?.length ?? 0} listing{(filtered?.length ?? 0) === 1 ? '' : 's'}</span>
          </div>
          <Link href="/browse" className="btn btn-secondary btn-sm">List view</Link>
        </div>
        <div ref={mapElRef} className="leaflet-market-map" aria-label="Interactive listing map" />
        {mapError ? <div className="map-tile-error">{mapError}</div> : null}
        <div className="map-legend">
          {TYPES.map((item) => (
            <span key={item} className={`legend-dot pin-${item}`}>
              <i /> {TYPE_LABEL[item]}
            </span>
          ))}
        </div>
      </section>

      <section className="map-market-results">
        <div className="section-head">
          <h2>Markets underneath</h2>
          <span className="map-result-count">{markets.length} market{markets.length === 1 ? '' : 's'}</span>
        </div>
        {filtered === null ? (
          <div className="empty"><p>Loading map listings...</p></div>
        ) : markets.length === 0 ? (
          <div className="empty">
            <div className="emoji">🌱</div>
            <h2>No nearby matches</h2>
            <p>Try a wider radius or another category.</p>
          </div>
        ) : (
          <div className="map-market-list">
            {markets.map((market) => (
              <article key={market.key} className="map-market-result">
                <div className="map-market-result-head">
                  <div>
                    {market.slug ? (
                      <Link href={`/market/${market.slug}`} className="map-market-name">{market.name}</Link>
                    ) : (
                      <strong className="map-market-name">{market.name}</strong>
                    )}
                    <p>{market.location}{market.distance != null ? ` · ${market.distance < 1 ? '< 1 mi' : `${Math.round(market.distance)} mi`}` : ''}</p>
                  </div>
                  <span>{market.rows.length} item{market.rows.length === 1 ? '' : 's'}</span>
                </div>
                <div className="map-listing-strip">
                  {market.rows.slice(0, 4).map((listing) => (
                    <Link key={listing.id} href={listingPath(listing.id, listing.slug ?? listing.title)} className={`map-listing-pill pin-${listing.listing_type}`}>
                      <span>{rootForListing(taxIndex, listing)?.icon ?? TYPE_ICON[listing.listing_type]}</span>
                      <b>{listing.title}</b>
                      <small>{listingValue(listing)}</small>
                    </Link>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {filtered && filtered.length > 0 ? (
        <section className="map-card-grid">
          {filtered.slice(0, 12).map((listing) => (
            <div key={listing.id} className="browse-cardwrap">
              <ListingCard listing={listing} />
              {listing.distance != null ? (
                <span className="distance-pill">
                  {listing.distance < 1 ? '< 1 mi' : `${Math.round(listing.distance)} mi`}
                </span>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
