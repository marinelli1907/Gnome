'use client';

// Market Drops — seller management panel on My Market.
//
// A Market Drop is a time-boxed collection of the seller's EXISTING listings
// ("Saturday Harvest, Sat 8AM–1PM"). Creation goes through the canonical
// create_market_drop RPC (the same one the AI's confirm path uses); everything
// else here is plain owner-scoped RLS: schedule/cancel are status updates,
// membership edits are join-table rows. Drops never touch the listings
// themselves — no allowance, no renewal, no expiry reset.
//
// NOT the Seed Drop. Seller-facing copy always says "Market Drop".
import { useCallback, useEffect, useState } from 'react';
import { logWeb } from '../../lib/analytics';
import { supabaseBrowser } from '../../lib/supabaseBrowser';

interface DropRow {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'scheduled' | 'cancelled';
  item_count?: number;
}

interface OwnListing { id: string; title: string; price_cents: number | null; unit: string | null; status: string }

const fmtWindow = (startsAt: string, endsAt: string) => {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const day = s.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const t = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${t(s)} – ${t(e)}`;
};

const phaseOf = (d: DropRow): string => {
  if (d.status !== 'scheduled') return d.status;
  const now = Date.now();
  if (now < Date.parse(d.starts_at)) return 'upcoming';
  if (now >= Date.parse(d.ends_at)) return 'ended';
  return 'live';
};

export default function MarketDropsEditor({ marketId, marketSlug }: { marketId: string; marketSlug: string }) {
  const [drops, setDrops] = useState<DropRow[]>([]);
  const [listings, setListings] = useState<OwnListing[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    const sb = supabaseBrowser();
    const { data: ds } = await sb.from('market_drops')
      .select('id,title,description,starts_at,ends_at,status')
      .eq('market_id', marketId)
      .neq('status', 'cancelled')
      .order('starts_at', { ascending: true });
    const rows = (ds ?? []) as DropRow[];
    if (rows.length) {
      const { data: items } = await sb.from('market_drop_items')
        .select('drop_id').in('drop_id', rows.map((d) => d.id));
      const counts = new Map<string, number>();
      for (const i of items ?? []) counts.set(i.drop_id, (counts.get(i.drop_id) ?? 0) + 1);
      for (const d of rows) d.item_count = counts.get(d.id) ?? 0;
    }
    setDrops(rows);
    const { data: ls } = await sb.from('listings')
      .select('id,title,price_cents,unit,status')
      .eq('market_id', marketId).eq('status', 'active')
      .order('created_at', { ascending: false }).limit(60);
    setListings((ls ?? []) as OwnListing[]);
  }, [marketId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async (publish: boolean) => {
    setNote(null);
    const ids = Object.keys(picked).filter((k) => picked[k]);
    if (!title.trim()) { setNote('Give the Market Drop a name.'); return; }
    if (!startsAt || !endsAt) { setNote('Pick a start and end time.'); return; }
    if (Date.parse(endsAt) <= Date.parse(startsAt)) { setNote('The Drop has to end after it starts.'); return; }
    if (!ids.length) { setNote('Pick at least one listing for the Drop.'); return; }
    setBusy(true);
    try {
      const { error } = await supabaseBrowser().rpc('create_market_drop', {
        p_title: title.trim(),
        p_starts_at: new Date(startsAt).toISOString(),
        p_ends_at: new Date(endsAt).toISOString(),
        p_listing_ids: ids,
        p_description: description.trim() || null,
        p_publish: publish,
        p_request: null,
      });
      if (error) throw new Error(String(error.message ?? ''));
      logWeb(publish ? 'drop_scheduled_ui' : 'drop_created_ui');
      setCreating(false);
      setTitle(''); setDescription(''); setStartsAt(''); setEndsAt(''); setPicked({});
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setNote(/RESERVED_TITLE/.test(msg) ? '“Seed” names are reserved — pick a different Drop name.'
        : /WINDOW_IN_PAST/.test(msg) ? 'That window is already in the past.'
        : /WINDOW_TOO_LONG/.test(msg) ? 'Keep a Drop to two weeks or less.'
        : /DROP_ITEM_LIMIT/.test(msg) ? 'A Market Drop holds up to 30 items.'
        : 'Couldn’t save the Drop — check the details and try again.');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (d: DropRow, status: 'scheduled' | 'cancelled') => {
    setBusy(true);
    try {
      const { error } = await supabaseBrowser().from('market_drops')
        .update({ status }).eq('id', d.id);
      if (error) throw error;
      await refresh();
    } catch {
      setNote('That change didn’t stick — try again.');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (d: DropRow) => {
    const url = `https://gnomefarmersmarket.com/market/${marketSlug}?drop=${d.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setNote('Drop link copied.');
      logWeb('drop_shared', { drop: d.id });
    } catch {
      setNote(url);
    }
  };

  return (
    <div className="preview-note" style={{ display: 'grid', gap: 10 }}>
      <strong>🧺 Market Drops</strong>
      <span style={{ fontSize: 13, opacity: 0.8 }}>
        A Market Drop is a time-boxed pick of your existing listings — “Saturday Harvest,
        Sat 8 AM–1 PM”. It appears on your public Market and never changes the listings
        themselves.
      </span>

      {drops.length === 0 && !creating && (
        <span style={{ fontSize: 13 }}>No Market Drops yet.</span>
      )}
      {drops.map((d) => (
        <div key={d.id} style={{ border: '1px solid var(--border, #ddd)', borderRadius: 10, padding: '8px 10px', display: 'grid', gap: 4 }}>
          <strong style={{ fontSize: 14 }}>
            {d.title}
            {' '}
            <span className="chip" style={{ fontSize: 11 }}>
              {phaseOf(d) === 'live' ? 'LIVE NOW' : phaseOf(d)}
            </span>
          </strong>
          <span style={{ fontSize: 13, opacity: 0.75 }}>
            {fmtWindow(d.starts_at, d.ends_at)} · {d.item_count ?? 0} item{(d.item_count ?? 0) === 1 ? '' : 's'}
          </span>
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {d.status === 'draft' && (
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void setStatus(d, 'scheduled')}>
                Schedule it
              </button>
            )}
            {d.status === 'scheduled' && (
              <>
                <button className="chip" disabled={busy} onClick={() => void copyLink(d)}>Copy Drop link</button>
                <button className="chip" disabled={busy} onClick={() => void setStatus(d, 'cancelled')}>Cancel Drop</button>
              </>
            )}
          </span>
        </div>
      ))}

      {!creating ? (
        <button className="btn btn-primary btn-sm" style={{ justifySelf: 'start' }} onClick={() => setCreating(true)}>
          + New Market Drop
        </button>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <input value={title} maxLength={80} placeholder="Drop name — e.g. Saturday Harvest"
            onChange={(e) => setTitle(e.target.value)} />
          <input value={description} maxLength={400} placeholder="Short description (optional)"
            onChange={(e) => setDescription(e.target.value)} />
          <label style={{ fontSize: 13 }}>Starts
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={{ marginLeft: 8 }} />
          </label>
          <label style={{ fontSize: 13 }}>Ends
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={{ marginLeft: 8 }} />
          </label>
          <span style={{ fontSize: 13 }}>Pick from your live listings:</span>
          <div style={{ display: 'grid', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
            {listings.map((l) => (
              <label key={l.id} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={!!picked[l.id]}
                  onChange={(e) => setPicked((p) => ({ ...p, [l.id]: e.target.checked }))} />
                {l.title}
                {l.price_cents != null && (
                  <span style={{ opacity: 0.6 }}>
                    ${(l.price_cents / 100).toFixed(2).replace(/\.00$/, '')}{l.unit ? `/${l.unit}` : ''}
                  </span>
                )}
              </label>
            ))}
            {listings.length === 0 && <span style={{ fontSize: 13, opacity: 0.7 }}>No live listings to pick from yet.</span>}
          </div>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void create(true)}>Schedule Drop</button>
            <button className="chip" disabled={busy} onClick={() => void create(false)}>Save draft</button>
            <button className="chip" disabled={busy} onClick={() => setCreating(false)}>Close</button>
          </span>
        </div>
      )}

      {note && <span style={{ fontSize: 13 }}>{note}</span>}
    </div>
  );
}
