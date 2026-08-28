'use client';

// Location-aware browse: the browser's position + a radius filter over the
// privacy-safe coarse coordinates (approx_lat/lng, ~0.7mi cells — never exact
// addresses). Falls back gracefully when location is denied: everything shows,
// sorted newest-first, and the radius chips prompt for permission.
import { useEffect, useMemo, useRef, useState } from 'react';
import ListingCard from '../components/ListingCard';
import {
  fetchTaxonomy,
  breadcrumb,
  matchNodes,
  nodeInAnySubtree,
  subtreeIds,
  type TaxonomyIndex,
  type TaxonomyNode,
} from '../../lib/taxonomy';
import type { WebListing } from '../../lib/gnome';
import { logWeb } from '../../lib/analytics';
import { LAUNCH_LISTING_TYPES, TYPE_LABEL } from '../../lib/format';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const COLS =
  'id,slug,title,description,category,listing_type,status,price_cents,currency,trade_for,quantity,unit,photos,city,county,state,fulfillment_type,market_id,market_name,market_slug,market_avatar_url,market_type,market_verified,created_at,expires_at,is_featured,featured_until,has_active_promotion,is_demo,approx_lat,approx_lng,taxonomy_node_id,harvest_date';

type GeoListing = WebListing & {
  approx_lat: number | null;
  approx_lng: number | null;
  taxonomy_node_id: string | null;
};

// Canonical display order. Browse has no default type — "All" is the resting
// state here — but when a type IS shown, it shows in this order.
const TYPES = LAUNCH_LISTING_TYPES;

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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'asking' | 'granted' | 'denied' | 'manual'>('idle');
  const [manualLabel, setManualLabel] = useState<string | null>(null);
  const [locOpen, setLocOpen] = useState(false);
  const [locInput, setLocInput] = useState('');
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [radius, setRadius] = useState<number>(25);
  const [type, setType] = useState<string | null>(null);
  const [q, setQ] = useState('');

  // Categories — the app's backend-managed taxonomy tree, not the legacy flat
  // list. `taxNodeId` is the active filter (any depth); the drilldown browses
  // one level at a time like the app's TaxonomyPicker.
  const [taxIndex, setTaxIndex] = useState<TaxonomyIndex | null>(null);
  const [taxNodeId, setTaxNodeId] = useState<string | null>(null);
  // Deep link: /browse?cat=<root slug> (homepage category tiles). Resolved
  // once the taxonomy index lands.
  const [pendingCatSlug, setPendingCatSlug] = useState<string | null>(null);
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillAtId, setDrillAtId] = useState<string | null>(null); // null = roots
  const drillRef = useRef<HTMLDivElement>(null);

  // Move focus into the panel on open — the trigger that opened it may be
  // about to unmount ("Browse all categories ›" renders only while closed),
  // which would otherwise drop keyboard focus to <body>.
  useEffect(() => {
    if (drillOpen) drillRef.current?.focus();
  }, [drillOpen]);

  useEffect(() => {
    // Bounded retry: the app's react-query hook retries transient failures;
    // without this a single blip (e.g. Supabase free-tier unpause) would hide
    // the whole category system until a reload. fetchTaxonomy un-poisons its
    // cache on failure, so each attempt is a fresh request.
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
    if (!taxIndex || !pendingCatSlug) return;
    const root = taxIndex.roots.find((r) => r.slug === pendingCatSlug);
    if (root) setTaxNodeId(root.id);
    setPendingCatSlug(null);
  }, [taxIndex, pendingCatSlug]);

  const taxNode: TaxonomyNode | null =
    taxIndex && taxNodeId ? taxIndex.byId.get(taxNodeId) ?? null : null;
  const drillAt: TaxonomyNode | null =
    taxIndex && drillAtId ? taxIndex.byId.get(drillAtId) ?? null : null;

  // Honor deep links: ?type= (from the Plots page) and ?loc= (the homepage
  // ZIP/city box) — a passed location geocodes and persists like manual entry.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('type');
    if (t && (TYPES as readonly string[]).includes(t)) setType(t);
    const cat = params.get('cat');
    if (cat?.trim()) setPendingCatSlug(cat.trim());
    const loc = params.get('loc');
    if (loc?.trim()) {
      void (async () => {
        try {
          const found = await geocode(loc.trim());
          if (found) {
            setCoords({ lat: found.lat, lng: found.lng });
            setManualLabel(found.label);
            setGeoState('manual');
            logWeb('browse_location_set', { label: found.label, via: 'zip_box' });
            try { localStorage.setItem(LOC_KEY, JSON.stringify(found)); } catch { /* ignore */ }
          }
        } catch { /* keep whatever location state we had */ }
      })();
    }
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
        logWeb('browse_location_set', { label: found.label });
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
    rows = rows.filter((l) => (TYPES as readonly string[]).includes(l.listing_type));
    if (type) rows = rows.filter((l) => l.listing_type === type);
    if (taxNode && taxIndex) {
      // Subtree filter, same as the app: "Vegetables" matches a listing filed
      // under Vegetables › Tomatoes › Roma.
      const ids = subtreeIds(taxIndex, taxNode);
      rows = rows.filter((l) => l.taxonomy_node_id != null && ids.has(l.taxonomy_node_id));
    }
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      // Alias-aware, like the app: a listing matches when its title/description
      // contains the query OR its taxonomy node sits inside any node the query
      // matched by name/synonym ("hamburger" finds Ground Beef).
      const matched = taxIndex ? matchNodes(taxIndex, needle) : [];
      rows = rows.filter(
        (l) =>
          l.title.toLowerCase().includes(needle) ||
          (l.description ?? '').toLowerCase().includes(needle) ||
          (taxIndex !== null && nodeInAnySubtree(taxIndex, l.taxonomy_node_id, matched)),
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
  }, [listings, coords, radius, type, taxNode, taxIndex, q]);

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

        {/* Categories — same model as the app: root chips from the backend
            tree, always visible; tapping the active root again drills in. */}
        {taxIndex && (
          <div className="tax-rail" role="group" aria-label="Category">
            <button
              className={`chip${!taxNode ? ' active' : ''}`}
              aria-pressed={!taxNode}
              onClick={() => { setTaxNodeId(null); setDrillOpen(false); }}
            >
              All
            </button>
            {taxIndex.roots.map((root) => {
              const active =
                !!taxNode && (taxNode.id === root.id || taxNode.path.startsWith(root.path + '/'));
              return (
                <button
                  key={root.id}
                  className={`chip${active ? ' active' : ''}`}
                  aria-pressed={active}
                  aria-expanded={drillOpen && drillAtId === root.id}
                  aria-controls="tax-drill"
                  onClick={() => {
                    if (active && taxNode?.id === root.id) {
                      setDrillAtId(root.id);
                      setDrillOpen(true);
                    } else {
                      setTaxNodeId(root.id);
                      setDrillOpen(false);
                    }
                  }}
                >
                  {root.icon ? `${root.icon} ` : ''}{root.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Active category: breadcrumb chip to refine, ✕ to clear — or the
            full-tree drilldown entry point when nothing is selected. */}
        {taxIndex && taxNode ? (
          <div className="tax-active-row">
            <button
              className="chip active"
              onClick={() => {
                // Open where the app's TaxonomyPicker does: at the node itself
                // when it has children to refine into, else at its parent so a
                // leaf selection shows its siblings instead of an empty panel.
                setDrillAtId(
                  taxIndex.childrenOf(taxNode.id).length ? taxNode.id : taxNode.parent_id,
                );
                setDrillOpen(!drillOpen);
              }}
              aria-expanded={drillOpen}
              aria-controls="tax-drill"
            >
              ⚙ {breadcrumb(taxIndex, taxNode)}
            </button>
            <button
              className="chip"
              aria-label="Remove category filter"
              onClick={() => { setTaxNodeId(null); setDrillOpen(false); }}
            >
              ✕
            </button>
          </div>
        ) : taxIndex && !drillOpen ? (
          <button className="linkbtn tax-browse-all" onClick={() => { setDrillAtId(null); setDrillOpen(true); }}>
            Browse all categories ›
          </button>
        ) : null}

        {/* Drilldown: one level at a time, like the app's TaxonomyPicker.
            Focused on open (so Escape works and screen readers land in it). */}
        {taxIndex && drillOpen && (
          <div
            className="tax-drill"
            id="tax-drill"
            role="region"
            aria-label="Category browser"
            tabIndex={-1}
            ref={drillRef}
            onKeyDown={(e) => { if (e.key === 'Escape') setDrillOpen(false); }}
          >
            <div className="tax-drill-head">
              {drillAt ? (
                <>
                  <button
                    className="linkbtn"
                    onClick={() => setDrillAtId(drillAt.parent_id)}
                  >
                    ‹ Back
                  </button>
                  <span className="tax-drill-crumb">{breadcrumb(taxIndex, drillAt)}</span>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => { setTaxNodeId(drillAt.id); setDrillOpen(false); }}
                  >
                    All {drillAt.name}
                  </button>
                </>
              ) : (
                <span className="tax-drill-crumb">All categories</span>
              )}
              <button className="linkbtn tax-drill-close" aria-label="Close category browser" onClick={() => setDrillOpen(false)}>
                ✕
              </button>
            </div>
            <div className="chiprow">
              {taxIndex.childrenOf(drillAt?.id ?? null).map((child) => {
                const leaf = taxIndex.childrenOf(child.id).length === 0;
                return (
                  <button
                    key={child.id}
                    className={`chip${taxNodeId === child.id ? ' active' : ''}`}
                    aria-pressed={taxNodeId === child.id}
                    onClick={() => {
                      if (leaf) {
                        setTaxNodeId(child.id);
                        setDrillOpen(false);
                      } else {
                        setDrillAtId(child.id);
                      }
                    }}
                  >
                    {child.icon ? `${child.icon} ` : ''}{child.name}{leaf ? '' : ' ›'}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* One compact bar: everything else lives behind the Filters button. */}
        {(() => {
          const activeCount =
            (type ? 1 : 0) + (coords && radius > 0 && radius !== 25 ? 1 : 0);
          return (
            <div className="filter-toggle-row">
              <button
                className={`btn ${filtersOpen || activeCount > 0 ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen(!filtersOpen)}
              >
                ⚙ Filters{activeCount > 0 ? ` (${activeCount})` : ''} {filtersOpen ? '▴' : '▾'}
              </button>
              {!filtersOpen && type && (
                <button className="chip active" onClick={() => setType(null)}>
                  {TYPE_LABEL[type as keyof typeof TYPE_LABEL]} ✕
                </button>
              )}
              {!filtersOpen && coords && radius > 0 && (
                <span className="chip" aria-hidden>within {radius} mi</span>
              )}
            </div>
          );
        })()}

        {filtersOpen && (
          <div className="filter-panel">
            <div className="fp-section">
              <span className="filter-label">Show</span>
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
              </div>
            </div>

            <div className="fp-section">
              <span className="filter-label">Distance</span>
              {coords ? (
                <div className="radius-row">
                  <input
                    type="range"
                    min={1}
                    max={50}
                    value={radius === 0 ? 50 : Math.min(50, radius)}
                    disabled={radius === 0}
                    aria-label="Search radius in miles"
                    onChange={(e) => setRadius(Number(e.target.value))}
                  />
                  <input
                    className="radius-num"
                    inputMode="numeric"
                    aria-label="Radius in miles"
                    value={radius === 0 ? '' : String(radius)}
                    placeholder="mi"
                    onChange={(e) => {
                      const v = Number(e.target.value.replace(/[^0-9]/g, ''));
                      setRadius(Math.min(200, Math.max(0, v)));
                    }}
                  />
                  <span className="radius-unit">mi</span>
                  <button
                    className={`chip${radius === 0 ? ' active' : ''}`}
                    onClick={() => setRadius(radius === 0 ? 25 : 0)}
                  >
                    Anywhere
                  </button>
                </div>
              ) : (
                <p className="geo-note" style={{ margin: 0 }}>
                  Set a location to filter by distance —{' '}
                  <button className="linkbtn" onClick={() => setLocOpen(true)}>enter your address or city</button>.
                </p>
              )}
            </div>

            <div className="fp-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { setType(null); setRadius(25); }}
              >
                Clear all
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setFiltersOpen(false)}>Done</button>
            </div>
          </div>
        )}

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
              placeholder="Address or city, state"
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

      {filtered !== null && filtered.length > 0 && (
        <p className="browse-count">
          <strong>{filtered.length}</strong> thing{filtered.length === 1 ? '' : 's'} growing{' '}
          {coords && radius > 0 ? `within ${radius} miles` : 'nearby'}
          {manualLabel && geoState === 'manual' ? ` of ${manualLabel.split(',')[0]}` : ''}
        </p>
      )}

      {filtered !== null && filtered.length > 0 && filtered.every((l) => l.is_demo) && (
        <p className="geo-note" style={{ marginBottom: 14 }}>
          🌱 These are <strong>preview listings</strong> showing how Gnome works — real
          neighbors haven’t posted here yet. <a href="/sell">Be the first grower nearby</a>.
        </p>
      )}

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
