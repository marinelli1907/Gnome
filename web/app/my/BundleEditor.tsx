'use client';

// Build a basket — combine a few things you sell into one offer (0121).
//
// A basket IS a Sell listing: publishing one consumes one Sell publish
// through the normal allowance machinery, runs 7 days, renews like anything
// else. Composition goes through the canonical create_market_bundle RPC;
// nothing here writes listing_components directly. When the plan's publishes
// are spent, the existing $0.99 extra-publish checkout takes over — same
// billing-checkout → webhook → market-bound authorization flow as everywhere
// else, consumed automatically by the allowance trigger on retry.
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { logWeb } from '../../lib/analytics';

type OwnListing = { id: string; title: string; price_cents: number | null; unit: string | null };
type OwnBundle = {
  id: string; title: string; price_cents: number | null; status: string;
  inventory_count: number | null; expires_at: string; components: string[];
  available: boolean;
};

export default function BundleEditor({ marketId }: { marketId: string }) {
  const [bundles, setBundles] = useState<OwnBundle[]>([]);
  const [listings, setListings] = useState<OwnListing[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [inventory, setInventory] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [overage, setOverage] = useState<'offer' | 'waiting' | null>(null);

  const refresh = useCallback(async () => {
    const sb = supabaseBrowser();
    const { data: bs } = await sb.from('listings')
      .select('id,title,price_cents,status,inventory_count,expires_at')
      .eq('market_id', marketId).eq('is_bundle', true)
      .in('status', ['active', 'claimed', 'completed'])
      .order('created_at', { ascending: false }).limit(12);
    const rows: OwnBundle[] = [];
    for (const b of bs ?? []) {
      const { data: comps } = await sb.from('listing_components')
        .select('component_listing_id').eq('listing_id', b.id);
      const ids = (comps ?? []).map((c) => c.component_listing_id);
      let titles: string[] = [];
      if (ids.length) {
        const { data: cls } = await sb.from('listings').select('id,title').in('id', ids);
        titles = (cls ?? []).map((c) => c.title);
      }
      const { data: avail } = await sb.rpc('bundle_components_available', { p_listing: b.id });
      rows.push({ ...b, components: titles, available: avail === true && b.status === 'active' });
    }
    setBundles(rows);
    const { data: ls } = await sb.from('listings')
      .select('id,title,price_cents,unit')
      .eq('market_id', marketId).eq('status', 'active').eq('is_bundle', false)
      .eq('listing_type', 'sale')
      .order('created_at', { ascending: false }).limit(60);
    setListings((ls ?? []) as OwnListing[]);
  }, [marketId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    setNote(null); setOverage(null);
    const ids = Object.keys(picked).filter((k) => picked[k]);
    const cents = Math.round(parseFloat(price || '0') * 100);
    if (!title.trim()) { setNote('Give the basket a name.'); return; }
    if (!Number.isFinite(cents) || cents < 1) { setNote('Set one price for the whole basket.'); return; }
    if (ids.length < 2) { setNote('Pick at least two of your listings for the basket.'); return; }
    setBusy(true);
    try {
      const inv = inventory.trim() ? parseInt(inventory, 10) : null;
      const { error } = await supabaseBrowser().rpc('create_market_bundle', {
        p_title: title.trim(),
        p_price_cents: cents,
        p_component_ids: ids,
        p_description: description.trim() || null,
        p_unit: null,
        p_inventory: inv && inv > 0 ? inv : null,
        p_request: null,
      });
      if (error) throw new Error(String(error.message ?? ''));
      logWeb('bundle_created_ui');
      setCreating(false);
      setTitle(''); setDescription(''); setPrice(''); setInventory(''); setPicked({});
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (/PUBLISH_ALLOWANCE_EXHAUSTED/.test(msg)) {
        setNote('Your plan’s Sell publishes are used up for this period.');
        setOverage('offer');
      } else {
        setNote(/BUNDLE_NEEDS_ITEMS/.test(msg) ? 'A basket needs at least two items.'
          : /BUNDLE_ITEM_LIMIT/.test(msg) ? 'A basket holds up to 12 items.'
          : /COMPONENT_NOT_AVAILABLE/.test(msg) ? 'One of those listings isn’t live right now.'
          : /INVALID_PRICE/.test(msg) ? 'Prices go from $0.01 to $1,000.'
          : 'Couldn’t create the basket — check the details and try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  // The existing $0.99 extra-publish checkout: market-bound authorization,
  // consumed by the allowance trigger when we retry the create.
  const buyExtraPublish = async () => {
    setOverage('waiting'); setNote('Opening the $0.99 checkout in a new tab…');
    const sb = supabaseBrowser();
    try {
      const { data, error } = await sb.functions.invoke('billing-checkout', {
        body: { product_key: 'GNOME_LISTING_PUBLISH', platform: 'web' },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('NO_URL');
      window.open(data.url, '_blank', 'noopener');
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const { data: ov } = await sb.rpc('my_overage_required', { p_listing: null });
        const row = Array.isArray(ov) ? ov[0] : ov;
        if (row && (row.reason === 'ALREADY_AUTHORIZED' || row.required === false)) {
          setNote('Payment received — creating your basket…');
          setOverage(null);
          await create();
          return;
        }
      }
      setNote('Haven’t seen the payment yet. If you finished checkout, click “Create basket” again — you won’t be charged twice.');
      setOverage('offer');
    } catch {
      setNote('The checkout could not start. Nothing was charged.');
      setOverage('offer');
    }
  };

  const priceLabel = (c: number | null) =>
    c == null ? '' : `$${(c / 100).toFixed(2).replace(/\.00$/, '')}`;

  return (
    <div className="preview-note" style={{ display: 'grid', gap: 10 }}>
      <span>🎁<strong> Gift Baskets</strong></span>
      <span style={{ fontSize: 13 }}>
        Combine a few things you sell into one offer — “Sunday Breakfast Basket”.
        A basket is available only while all items inside it are available.
      </span>

      {bundles.length === 0 && <span style={{ fontSize: 13 }}>No baskets yet.</span>}
      {bundles.map((b) => (
        <div key={b.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 10 }}>
          <strong>{b.title}</strong>{' '}
          <span className="chip" style={{ fontSize: 11 }}>
            {b.status !== 'active' ? b.status
              : b.available ? 'available' : 'unavailable — an item is spoken for'}
          </span>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {priceLabel(b.price_cents)}
            {b.inventory_count != null && <> · {b.inventory_count} left</>}
            {' · '}{b.components.length} items: {b.components.join(', ')}
          </div>
        </div>
      ))}

      {!creating ? (
        <button className="btn btn-primary btn-sm" style={{ justifySelf: 'start' }}
          onClick={() => setCreating(true)}>
          + Build a basket
        </button>
      ) : (
        <>
          <input placeholder="Basket name — e.g. Sunday Breakfast Basket" maxLength={80}
            value={title} onChange={(e) => setTitle(e.target.value)} />
          <input placeholder="Short description (optional)" maxLength={400}
            value={description} onChange={(e) => setDescription(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, display: 'grid', gap: 4 }}>
              Basket price ($)
              <input inputMode="decimal" placeholder="25" value={price} style={{ maxWidth: 120 }}
                onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} />
            </label>
            <label style={{ fontSize: 13, display: 'grid', gap: 4 }}>
              How many complete baskets do you have ready or can assemble?
              <input inputMode="numeric" placeholder="e.g. 3 (optional)" value={inventory} style={{ maxWidth: 220 }}
                onChange={(e) => setInventory(e.target.value.replace(/[^0-9]/g, ''))} />
            </label>
          </div>
          <span style={{ fontSize: 13 }}>Pick what goes inside (at least two):</span>
          <div style={{ display: 'grid', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
            {listings.map((l) => (
              <label key={l.id} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={!!picked[l.id]}
                  style={{ width: 18, height: 18, padding: 0, flex: 'none', accentColor: 'var(--brand)' }}
                  onChange={(e) => setPicked((p) => ({ ...p, [l.id]: e.target.checked }))} />
                {l.title}
                {l.price_cents != null && (
                  <span style={{ opacity: 0.6 }}>
                    ${(l.price_cents / 100).toFixed(2).replace(/\.00$/, '')}{l.unit ? `/${l.unit}` : ''}
                  </span>
                )}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" disabled={busy || overage === 'waiting'} onClick={() => void create()}>
              Create basket
            </button>
            {overage === 'offer' && (
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void buyExtraPublish()}>
                Get an extra publish — $0.99
              </button>
            )}
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { setCreating(false); setNote(null); setOverage(null); }}>
              Close
            </button>
          </div>
        </>
      )}
      {note && <span style={{ fontSize: 13 }}>{note}</span>}
    </div>
  );
}
