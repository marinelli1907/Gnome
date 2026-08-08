'use client';

// Minimal moderation console. This UI holds NO authority: every query and
// mutation below succeeds only because 0024's RLS policies grant it to rows
// in the admins table — a non-admin hitting the same endpoints gets empty
// reads and 0-row writes. Every action also records an admin_actions row.
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { SignInCard, useSession } from '../components/auth';

interface Report {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  status: 'open' | 'reviewed' | 'actioned' | 'dismissed';
  admin_notes: string | null;
  created_at: string;
}
interface AdminListing {
  id: string; title: string; status: string; listing_type: string;
  owner_id: string; created_at: string;
}
interface AdminProfile { id: string; name: string | null; suspended: boolean }
interface Action {
  id: string; action: string; target_type: string; target_id: string | null;
  note: string | null; created_at: string;
}

type Tab = 'reports' | 'listings' | 'users' | 'seeds' | 'drops' | 'audit';

interface SeedLot {
  id: string; internal_lot_number: string; current_qty: number; unit: string;
  germination_pct: number | null; next_review_date: string | null; status: string;
  received_date: string; supplier: string | null;
}
interface SeedProductRow {
  id: string; crop: string; variety: string; category: string;
  packet_seed_count: number; active: boolean; lots: SeedLot[];
}
interface SeedDropOrder {
  id: string; user_id: string; status: string; packet_count: number;
  tracking: string | null; created_at: string; profile_snapshot: Record<string, unknown>;
  items: { id: string; status: string; product: { crop: string; variety: string } | null;
           lot: { internal_lot_number: string } | null }[];
}

export default function AdminClient() {
  const { session, ready } = useSession();
  const uid = session?.user?.id;

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('reports');
  const [reports, setReports] = useState<Report[]>([]);
  const [listings, setListings] = useState<AdminListing[]>([]);
  const [users, setUsers] = useState<AdminProfile[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [seedRows, setSeedRows] = useState<SeedProductRow[]>([]);
  const [drops, setDrops] = useState<SeedDropOrder[]>([]);
  const [lotForm, setLotForm] = useState({ product: '', lotNo: '', qty: '', germ: '', supplier: '' });
  const [testForm, setTestForm] = useState<{ lot: string; tested: string; germd: string } | null>(null);
  const [trackForm, setTrackForm] = useState<{ order: string; tracking: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admin gate: RLS lets a user read only their own admins row — a non-admin
  // simply gets zero rows here (and zero rows from everything below).
  useEffect(() => {
    if (!uid) return;
    supabaseBrowser().from('admins').select('user_id').eq('user_id', uid).maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [uid]);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [r, a, s, d] = await Promise.all([
      sb.from('reports').select('*').order('created_at', { ascending: false }).limit(50),
      sb.from('admin_actions').select('id,action,target_type,target_id,note,created_at')
        .order('created_at', { ascending: false }).limit(50),
      sb.from('seed_products')
        .select('id,crop,variety,category,packet_seed_count,active,lots:seed_lots(id,internal_lot_number,current_qty,unit,germination_pct,next_review_date,status,received_date,supplier)')
        .order('crop'),
      sb.from('seed_orders')
        .select('id,user_id,status,packet_count,tracking,created_at,profile_snapshot,items:seed_order_items(id,status,product:seed_products(crop,variety),lot:seed_lots(internal_lot_number))')
        .order('created_at', { ascending: false }).limit(50),
    ]);
    setReports((r.data as Report[]) ?? []);
    setActions((a.data as Action[]) ?? []);
    setSeedRows((s.data as unknown as SeedProductRow[]) ?? []);
    setDrops((d.data as unknown as SeedDropOrder[]) ?? []);
  }, []);

  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  async function audit(action: string, targetType: string, targetId: string | null, extra?: string) {
    await supabaseBrowser().from('admin_actions').insert({
      admin_id: uid, action, target_type: targetType, target_id: targetId, note: extra ?? (note.trim() || null),
    });
  }

  async function resolveReport(r: Report, status: Report['status']) {
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().from('reports').update({
      status, admin_notes: note.trim() || r.admin_notes, resolved_by: uid, resolved_at: new Date().toISOString(),
    }).eq('id', r.id);
    if (error) setError(error.message);
    else { await audit(`report_${status}`, r.target_type, r.target_id); setNote(''); await load(); }
    setBusy(false);
  }

  async function searchListings() {
    const sb = supabaseBrowser();
    const { data, error } = await sb
      .from('listings')
      .select('id,title,status,listing_type,owner_id,created_at')
      .or(`title.ilike.*${q}*,id.eq.${/^[0-9a-f-]{36}$/.test(q) ? q : '00000000-0000-0000-0000-000000000000'}`)
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) setError(error.message);
    setListings((data as AdminListing[]) ?? []);
  }

  async function setListingStatus(l: AdminListing, status: 'removed' | 'active') {
    setBusy(true); setError(null);
    const patch: Record<string, unknown> = { status };
    if (status === 'active') patch.expires_at = new Date(Date.now() + 7 * 86400_000).toISOString();
    const { error } = await supabaseBrowser().from('listings').update(patch).eq('id', l.id);
    if (error) setError(error.message);
    else { await audit(status === 'removed' ? 'listing_removed' : 'listing_restored', 'listing', l.id); await searchListings(); }
    setBusy(false);
  }

  async function searchUsers() {
    const { data, error } = await supabaseBrowser()
      .from('profiles').select('id,name,suspended')
      .or(`name.ilike.*${q}*,id.eq.${/^[0-9a-f-]{36}$/.test(q) ? q : '00000000-0000-0000-0000-000000000000'}`)
      .limit(25);
    if (error) setError(error.message);
    setUsers((data as AdminProfile[]) ?? []);
  }

  async function setSuspended(p: AdminProfile, suspended: boolean) {
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().from('profiles').update({ suspended }).eq('id', p.id);
    if (error) setError(error.message);
    else { await audit(suspended ? 'user_suspended' : 'user_restored', 'user', p.id); await searchUsers(); }
    setBusy(false);
  }

  // ---- Seed inventory actions (every change audited to seed_inventory_log) --
  async function addLot() {
    if (!lotForm.product || !lotForm.lotNo.trim() || !Number(lotForm.qty)) {
      return setError('Lot needs a product, a lot number, and a quantity.');
    }
    setBusy(true); setError(null);
    const sb = supabaseBrowser();
    const { data: lot, error } = await sb.from('seed_lots').insert({
      seed_product_id: lotForm.product,
      internal_lot_number: lotForm.lotNo.trim(),
      original_qty: Number(lotForm.qty),
      current_qty: Number(lotForm.qty),
      unit: 'packets',
      germination_pct: lotForm.germ ? Number(lotForm.germ) : null,
      germination_test_date: lotForm.germ ? new Date().toISOString().slice(0, 10) : null,
      supplier: lotForm.supplier.trim() || null,
      status: 'fresh',
    }).select('id').single();
    if (error) setError(error.message);
    else {
      await sb.from('seed_inventory_log').insert({ lot_id: lot.id, delta: Number(lotForm.qty), reason: 'received', actor: uid });
      setLotForm({ product: '', lotNo: '', qty: '', germ: '', supplier: '' });
      await load();
    }
    setBusy(false);
  }

  async function adjustLot(lot: SeedLot, delta: number, reason: string) {
    setBusy(true); setError(null);
    const sb = supabaseBrowser();
    const newQty = Math.max(0, Number(lot.current_qty) + delta);
    const { error } = await sb.from('seed_lots')
      .update({ current_qty: newQty, status: newQty === 0 ? 'depleted' : lot.status === 'depleted' ? 'active' : lot.status })
      .eq('id', lot.id);
    if (error) setError(error.message);
    else {
      await sb.from('seed_inventory_log').insert({ lot_id: lot.id, delta, reason, actor: uid });
      await load();
    }
    setBusy(false);
  }

  async function setLotStatus(lot: SeedLot, status: string) {
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().from('seed_lots').update({ status }).eq('id', lot.id);
    if (error) setError(error.message);
    else { await audit(`lot_${status}`, 'seed_lot', lot.id); await load(); }
    setBusy(false);
  }

  async function recordTest() {
    if (!testForm) return;
    const tested = Number(testForm.tested), germd = Number(testForm.germd);
    if (!tested || germd < 0 || germd > tested) return setError('Check the test numbers.');
    setBusy(true); setError(null);
    const sb = supabaseBrowser();
    const pct = Math.round((germd / tested) * 1000) / 10;
    const next = new Date(Date.now() + 180 * 86400_000).toISOString().slice(0, 10);
    const { error } = await sb.from('germination_tests').insert({
      lot_id: testForm.lot, seeds_tested: tested, germinated: germd, next_review_date: next, tester: 'admin',
    });
    if (!error) {
      await sb.from('seed_lots').update({
        germination_pct: pct,
        germination_test_date: new Date().toISOString().slice(0, 10),
        next_review_date: next,
        status: pct >= 70 ? 'active' : 'failed',
      }).eq('id', testForm.lot);
    }
    if (error) setError(error.message);
    else { setTestForm(null); await load(); }
    setBusy(false);
  }

  // ---- Seed Drop fulfillment ------------------------------------------------
  async function runSelection(o: SeedDropOrder) {
    setBusy(true); setError(null);
    const { data, error } = await supabaseBrowser().rpc('admin_generate_seed_drop', { p_order: o.id });
    if (error) setError(error.message);
    else { await audit('seed_drop_selected', 'seed_order', o.id, `${data} packets`); await load(); }
    setBusy(false);
  }
  async function releaseOrder(o: SeedDropOrder) {
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().rpc('admin_release_seed_drop', { p_order: o.id });
    if (error) setError(error.message);
    else { await audit('seed_drop_released', 'seed_order', o.id); await load(); }
    setBusy(false);
  }
  async function setOrderStatus(o: SeedDropOrder, status: string, tracking?: string) {
    setBusy(true); setError(null);
    const sb = supabaseBrowser();
    const patch: Record<string, unknown> = { status };
    if (tracking) patch.tracking = tracking;
    const { error } = await sb.from('seed_orders').update(patch).eq('id', o.id);
    if (!error && (status === 'packed' || status === 'shipped')) {
      await sb.from('seed_order_items').update({ status }).eq('order_id', o.id).eq('status', status === 'packed' ? 'reserved' : 'packed');
    }
    if (error) setError(error.message);
    else { await audit(`seed_drop_${status}`, 'seed_order', o.id, tracking); setTrackForm(null); await load(); }
    setBusy(false);
  }

  if (!ready) return <div className="empty"><p>Loading…</p></div>;
  if (!session) return <SignInCard title="Moderation sign-in" blurb="Admins only." />;
  if (isAdmin === null) return <div className="empty"><p>Checking access…</p></div>;
  if (!isAdmin) {
    return (
      <div className="empty">
        <div className="emoji">🔒</div>
        <h2>Not authorized</h2>
        <p>This area is for Gnome staff. Nothing here is accessible to your account.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mm-head">
        <div>
          <h1>Moderation</h1>
          <p className="mm-stats">
            <strong>{reports.filter((r) => r.status === 'open').length}</strong> open reports
          </p>
        </div>
      </div>

      <div className="seg" style={{ maxWidth: 680, marginBottom: 18 }}>
        {(['reports', 'listings', 'users', 'seeds', 'drops', 'audit'] as Tab[]).map((t) => (
          <button key={t} type="button" className={`seg-btn${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {error && <p className="autherror">{error}</p>}

      {tab === 'reports' && (
        <div className="mm-list">
          {reports.length === 0 && <div className="empty"><p>No reports. Quiet neighborhood. 🌱</p></div>}
          {reports.map((r) => (
            <div key={r.id} className="mm-row">
              <div className="mm-thumb"><span>🚩</span></div>
              <div className="mm-info">
                <span className="mm-title">{r.target_type} · {r.target_id.slice(0, 8)}…</span>
                <div className="mm-meta">
                  <span className={`tag ${r.status === 'open' ? 'type-sale' : 'type-free'}`}>{r.status}</span>
                  {r.reason && <span className="mm-expiry">“{r.reason}”</span>}
                  {r.admin_notes && <span className="mm-expiry">📝 {r.admin_notes}</span>}
                </div>
              </div>
              {r.status === 'open' && (
                <div className="mm-btns">
                  <button className="mm-btn" disabled={busy} onClick={() => void resolveReport(r, 'reviewed')}>Reviewed</button>
                  <button className="mm-btn" disabled={busy} onClick={() => void resolveReport(r, 'actioned')}>Actioned</button>
                  <button className="mm-btn danger" disabled={busy} onClick={() => void resolveReport(r, 'dismissed')}>Dismiss</button>
                </div>
              )}
            </div>
          ))}
          <div className="field" style={{ maxWidth: 480 }}>
            <label>Note attached to the next action (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note…" />
          </div>
        </div>
      )}

      {(tab === 'listings' || tab === 'users') && (
        <div>
          <div className="locrow" style={{ marginBottom: 14 }}>
            <input
              value={q}
              placeholder={tab === 'listings' ? 'Search listings by title or UUID' : 'Search users by name or UUID'}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void (tab === 'listings' ? searchListings() : searchUsers()); }}
            />
            <button className="btn btn-primary btn-sm" onClick={() => void (tab === 'listings' ? searchListings() : searchUsers())}>
              Search
            </button>
          </div>

          {tab === 'listings' && (
            <div className="mm-list">
              {listings.map((l) => (
                <div key={l.id} className="mm-row">
                  <div className="mm-info">
                    <span className="mm-title">{l.title}</span>
                    <div className="mm-meta">
                      <span className={`tag type-${l.listing_type}`}>{l.listing_type}</span>
                      <span className="tag">{l.status}</span>
                    </div>
                  </div>
                  <div className="mm-btns">
                    {l.status !== 'removed' ? (
                      <button className="mm-btn danger" disabled={busy} onClick={() => void setListingStatus(l, 'removed')}>Remove</button>
                    ) : (
                      <button className="mm-btn" disabled={busy} onClick={() => void setListingStatus(l, 'active')}>Restore</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'users' && (
            <div className="mm-list">
              {users.map((p) => (
                <div key={p.id} className="mm-row">
                  <div className="mm-info">
                    <span className="mm-title">{p.name ?? 'Unnamed'} · {p.id.slice(0, 8)}…</span>
                    <div className="mm-meta">
                      {p.suspended && <span className="tag type-sale">suspended</span>}
                    </div>
                  </div>
                  <div className="mm-btns">
                    {!p.suspended ? (
                      <button className="mm-btn danger" disabled={busy} onClick={() => void setSuspended(p, true)}>Suspend</button>
                    ) : (
                      <button className="mm-btn" disabled={busy} onClick={() => void setSuspended(p, false)}>Restore</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'seeds' && (
        <div>
          <div className="preview-note" style={{ marginBottom: 14 }}>
            <strong>Receive inventory:</strong>{' '}
            <select value={lotForm.product} onChange={(e) => setLotForm({ ...lotForm, product: e.target.value })} style={{ width: 'auto', display: 'inline-block', padding: '6px 8px', marginRight: 6 }}>
              <option value="">variety…</option>
              {seedRows.map((p) => <option key={p.id} value={p.id}>{p.crop} · {p.variety}</option>)}
            </select>
            <input style={{ width: 110, display: 'inline-block', marginRight: 6, padding: '6px 8px' }} placeholder="lot #" value={lotForm.lotNo} onChange={(e) => setLotForm({ ...lotForm, lotNo: e.target.value })} />
            <input style={{ width: 70, display: 'inline-block', marginRight: 6, padding: '6px 8px' }} placeholder="qty" inputMode="numeric" value={lotForm.qty} onChange={(e) => setLotForm({ ...lotForm, qty: e.target.value.replace(/[^0-9]/g, '') })} />
            <input style={{ width: 70, display: 'inline-block', marginRight: 6, padding: '6px 8px' }} placeholder="germ %" inputMode="numeric" value={lotForm.germ} onChange={(e) => setLotForm({ ...lotForm, germ: e.target.value.replace(/[^0-9]/g, '') })} />
            <input style={{ width: 120, display: 'inline-block', marginRight: 6, padding: '6px 8px' }} placeholder="supplier" value={lotForm.supplier} onChange={(e) => setLotForm({ ...lotForm, supplier: e.target.value })} />
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void addLot()}>Receive</button>
          </div>

          <div className="mm-list">
            {seedRows.map((p) => (
              <div key={p.id} className="mm-row" style={{ alignItems: 'flex-start' }}>
                <div className="mm-info">
                  <span className="mm-title">{p.crop} · {p.variety} <span className="mm-expiry">({p.category} · {p.packet_seed_count} seeds/packet)</span></span>
                  <div className="mm-meta" style={{ flexWrap: 'wrap', gap: 6 }}>
                    {p.lots.length === 0 && <span className="mm-expiry">no lots — out of stock</span>}
                    {p.lots.map((l) => {
                      const low = Number(l.current_qty) > 0 && Number(l.current_qty) < 5;
                      const overdue = l.next_review_date && l.next_review_date < new Date().toISOString().slice(0, 10);
                      return (
                        <span key={l.id} className={`tag ${l.status === 'quarantined' || l.status === 'failed' ? 'type-sale' : low || overdue ? 'type-wanted' : 'type-free'}`}>
                          {l.internal_lot_number}: {l.current_qty} {l.unit}
                          {l.germination_pct != null ? ` · ${l.germination_pct}% germ` : ' · untested'}
                          {' · '}{l.status}{overdue ? ' · RETEST DUE' : ''}
                          {' '}
                          <button className="linkbtn" disabled={busy} onClick={() => void adjustLot(l, 1, 'adjusted')}>+1</button>{' '}
                          <button className="linkbtn" disabled={busy} onClick={() => void adjustLot(l, -1, 'adjusted')}>−1</button>{' '}
                          <button className="linkbtn" disabled={busy} onClick={() => setTestForm({ lot: l.id, tested: '', germd: '' })}>test</button>{' '}
                          {l.status !== 'quarantined'
                            ? <button className="linkbtn" disabled={busy} onClick={() => void setLotStatus(l, 'quarantined')}>quarantine</button>
                            : <button className="linkbtn" disabled={busy} onClick={() => void setLotStatus(l, 'active')}>restore</button>}
                        </span>
                      );
                    })}
                  </div>
                  {testForm && p.lots.some((l) => l.id === testForm.lot) && (
                    <div className="locrow" style={{ marginTop: 8 }}>
                      <input placeholder="seeds tested" inputMode="numeric" value={testForm.tested} onChange={(e) => setTestForm({ ...testForm, tested: e.target.value.replace(/[^0-9]/g, '') })} />
                      <input placeholder="germinated" inputMode="numeric" value={testForm.germd} onChange={(e) => setTestForm({ ...testForm, germd: e.target.value.replace(/[^0-9]/g, '') })} />
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void recordTest()}>Record</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setTestForm(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'drops' && (
        <div className="mm-list">
          {drops.length === 0 && <div className="empty"><p>No Seed Drop orders yet.</p></div>}
          {drops.map((o) => (
            <div key={o.id} className="mm-row" style={{ alignItems: 'flex-start' }}>
              <div className="mm-thumb"><span>📦</span></div>
              <div className="mm-info">
                <span className="mm-title">
                  {o.id.slice(0, 8)}… · {o.packet_count} packets · {new Date(o.created_at).toLocaleDateString()}
                  {' · zone '}{String((o.profile_snapshot as { zone?: number })?.zone ?? '?')}
                  {' · '}{String((o.profile_snapshot as { garden_size?: string })?.garden_size ?? '?')}
                </span>
                <div className="mm-meta" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <span className={`tag ${o.status === 'needs_review' ? 'type-sale' : 'type-free'}`}>{o.status}</span>
                  {o.tracking && <span className="mm-expiry">{o.tracking}</span>}
                  {o.items.filter((i) => i.status !== 'released').map((i) => (
                    <span key={i.id} className="tag">
                      {i.product ? `${i.product.crop}/${i.product.variety}` : '?'}
                      {i.lot ? ` [${i.lot.internal_lot_number}]` : ''}
                    </span>
                  ))}
                </div>
                {trackForm?.order === o.id && (
                  <div className="locrow" style={{ marginTop: 8 }}>
                    <input placeholder="tracking number" value={trackForm.tracking} onChange={(e) => setTrackForm({ order: o.id, tracking: e.target.value })} />
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void setOrderStatus(o, 'shipped', trackForm.tracking)}>Ship</button>
                  </div>
                )}
              </div>
              <div className="mm-btns">
                {(o.status === 'paid' || o.status === 'needs_review') && (
                  <button className="mm-btn" disabled={busy} onClick={() => void runSelection(o)}>Run selection</button>
                )}
                {o.status === 'selected' && (
                  <>
                    <button className="mm-btn" disabled={busy} onClick={() => void setOrderStatus(o, 'packed')}>Mark packed</button>
                    <button className="mm-btn" disabled={busy} onClick={() => void runSelection(o)}>Re-run</button>
                  </>
                )}
                {o.status === 'packed' && (
                  <button className="mm-btn" disabled={busy} onClick={() => setTrackForm({ order: o.id, tracking: '' })}>Add tracking</button>
                )}
                {(o.status === 'paid' || o.status === 'selected' || o.status === 'needs_review') && (
                  <button className="mm-btn danger" disabled={busy} onClick={() => void releaseOrder(o)}>Release</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'audit' && (
        <div className="mm-list">
          {actions.length === 0 && <div className="empty"><p>No admin actions recorded yet.</p></div>}
          {actions.map((a) => (
            <div key={a.id} className="mm-row">
              <div className="mm-info">
                <span className="mm-title">{a.action} · {a.target_type}{a.target_id ? ` · ${a.target_id.slice(0, 8)}…` : ''}</span>
                <div className="mm-meta">
                  <span className="mm-expiry">{new Date(a.created_at).toLocaleString()}</span>
                  {a.note && <span className="mm-expiry">📝 {a.note}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
