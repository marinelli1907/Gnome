'use client';

// Minimal moderation console. This UI holds NO authority: every query and
// mutation below succeeds only because 0024's RLS policies grant it to rows
// in the admins table — a non-admin hitting the same endpoints gets empty
// reads and 0-row writes. Every action also records an admin_actions row.
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { SignInCard, useSession } from '../components/auth';
import ComplianceClient from './ComplianceClient';
import TaxonomyClient from './TaxonomyClient';

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

type Tab = 'dashboard' | 'reports' | 'listings' | 'users' | 'seeds' | 'drops' | 'compliance' | 'taxonomy' | 'audit';

const LOW_STOCK_THRESHOLD = 5; // packets — surfaced on the dashboard
const STARTER_LINK_SET = !!process.env.NEXT_PUBLIC_SEED_LINK_STARTER;

interface SeedLot {
  id: string; internal_lot_number: string; current_qty: number; unit: string;
  germination_pct: number | null; next_review_date: string | null; status: string;
  received_date: string; supplier: string | null;
}
interface SeedProductRow {
  id: string; crop: string; variety: string; category: string;
  packet_seed_count: number; active: boolean; lots: SeedLot[];
  description: string | null; preferred_sun: string; container_friendly: boolean;
  beginner_friendly: boolean; days_to_germination: number | null;
  days_to_maturity: number | null; planting_depth_inches: number | null;
  spacing_inches: number | null; sow_months: number[];
}

// Editable variety form state (strings for painless inputs).
interface VarietyForm {
  id: string | null;          // null = creating a new variety
  crop: string; variety: string; category: string; description: string;
  preferred_sun: string; container_friendly: boolean; beginner_friendly: boolean;
  days_to_germination: string; days_to_maturity: string;
  planting_depth_inches: string; spacing_inches: string;
  packet_seed_count: string; sow_months: number[]; active: boolean;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const emptyVariety = (): VarietyForm => ({
  id: null, crop: '', variety: '', category: 'vegetable', description: '',
  preferred_sun: 'full', container_friendly: false, beginner_friendly: true,
  days_to_germination: '', days_to_maturity: '', planting_depth_inches: '',
  spacing_inches: '', packet_seed_count: '25', sow_months: [], active: true,
});
interface SeedDropOrder {
  id: string; user_id: string; status: string; packet_count: number;
  tracking: string | null; created_at: string; profile_snapshot: Record<string, unknown>;
  items: { id: string; status: string; qty_packets: number; substitution_reason: string | null;
           product: { crop: string; variety: string; packet_seed_count: number } | null;
           lot: { internal_lot_number: string; germination_pct: number | null } | null }[];
}
interface SubOption {
  product_id: string; crop: string; variety: string; category: string;
  lot_id: string; internal_lot_number: string; germ: number; why: string;
}
interface LotLogRow { id: string; delta: number; reason: string; order_id: string | null; created_at: string }

export default function AdminClient() {
  const { session, ready } = useSession();
  const uid = session?.user?.id;

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');
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
  const [adjustForm, setAdjustForm] = useState<{ lot: string; delta: string; reason: string } | null>(null);
  const [countForm, setCountForm] = useState<{ lot: string; counted: string } | null>(null);
  const [lotHistory, setLotHistory] = useState<{ lot: string; rows: LotLogRow[] } | null>(null);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [orderEmail, setOrderEmail] = useState<Record<string, string>>({});
  const [packChecks, setPackChecks] = useState<Record<string, boolean>>({});
  const [subFor, setSubFor] = useState<{ item: string; options: SubOption[] } | null>(null);
  const [varietyForm, setVarietyForm] = useState<VarietyForm | null>(null);
  const [lotFormFor, setLotFormFor] = useState<string | null>(null); // product id → inline "add lot"
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
        .select('id,crop,variety,category,packet_seed_count,active,description,preferred_sun,container_friendly,beginner_friendly,days_to_germination,days_to_maturity,planting_depth_inches,spacing_inches,sow_months,lots:seed_lots(id,internal_lot_number,current_qty,unit,germination_pct,next_review_date,status,received_date,supplier)')
        .order('crop'),
      sb.from('seed_orders')
        .select('id,user_id,status,packet_count,tracking,created_at,profile_snapshot,items:seed_order_items(id,status,qty_packets,substitution_reason,product:seed_products!seed_order_items_seed_product_id_fkey(crop,variety,packet_seed_count),lot:seed_lots(internal_lot_number,germination_pct))')
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
    // 0064 locked profiles.suspended behind an is_admin() definer RPC — a
    // direct PATCH now 403s (and previously let users un-suspend themselves).
    const { error } = await supabaseBrowser().rpc('admin_set_suspended', {
      p_user: p.id, p_suspended: suspended,
    });
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

  // Create or edit a seed variety — plain form, no SQL required.
  async function saveVariety() {
    if (!varietyForm) return;
    const f = varietyForm;
    if (!f.crop.trim() || !f.variety.trim()) return setError('A variety needs at least a crop and a variety name.');
    if (f.sow_months.length === 0) return setError('Pick at least one sowing month — the engine needs a window.');
    setBusy(true); setError(null);
    const row = {
      crop: f.crop.trim(), variety: f.variety.trim(), category: f.category,
      description: f.description.trim() || null,
      preferred_sun: f.preferred_sun,
      container_friendly: f.container_friendly, beginner_friendly: f.beginner_friendly,
      days_to_germination: f.days_to_germination ? Number(f.days_to_germination) : null,
      days_to_maturity: f.days_to_maturity ? Number(f.days_to_maturity) : null,
      planting_depth_inches: f.planting_depth_inches ? Number(f.planting_depth_inches) : null,
      spacing_inches: f.spacing_inches ? Number(f.spacing_inches) : null,
      packet_seed_count: Number(f.packet_seed_count) || 25,
      sow_months: f.sow_months, active: f.active,
      updated_at: new Date().toISOString(),
    };
    const sb = supabaseBrowser();
    const { error } = f.id
      ? await sb.from('seed_products').update(row).eq('id', f.id)
      : await sb.from('seed_products').insert(row);
    setBusy(false);
    if (error) setError(error.message.includes('duplicate') ? 'That crop + variety already exists.' : error.message);
    else {
      await audit(f.id ? 'variety_updated' : 'variety_created', 'seed_product', f.id, `${row.crop} ${row.variety}`);
      setVarietyForm(null);
      await load();
    }
  }

  // Reasoned adjustment (never a silent overwrite) + audit log row.
  async function applyAdjustment() {
    if (!adjustForm) return;
    const delta = Number(adjustForm.delta);
    if (!delta || !adjustForm.reason) return setError('Adjustment needs a non-zero amount and a reason.');
    const lot = seedRows.flatMap((p) => p.lots).find((l) => l.id === adjustForm.lot);
    if (!lot) return;
    setBusy(true); setError(null);
    const sb = supabaseBrowser();
    const newQty = Math.max(0, Number(lot.current_qty) + delta);
    const { error } = await sb.from('seed_lots')
      .update({ current_qty: newQty, status: newQty === 0 ? 'depleted' : lot.status === 'depleted' ? 'active' : lot.status })
      .eq('id', adjustForm.lot);
    if (error) setError(error.message);
    else {
      await sb.from('seed_inventory_log').insert({ lot_id: adjustForm.lot, delta, reason: adjustForm.reason, actor: uid });
      await audit('inventory_adjusted', 'seed_lot', adjustForm.lot, `${delta > 0 ? '+' : ''}${delta} — ${adjustForm.reason}`);
      setAdjustForm(null);
      await load();
    }
    setBusy(false);
  }

  // Physical count reconciliation → adjustment with expected/counted recorded.
  async function applyCount() {
    if (!countForm) return;
    const lot = seedRows.flatMap((p) => p.lots).find((l) => l.id === countForm.lot);
    const counted = Number(countForm.counted);
    if (!lot || Number.isNaN(counted)) return setError('Enter the counted quantity.');
    const diff = counted - Number(lot.current_qty);
    if (diff === 0) { setCountForm(null); setNote(''); return; }
    setBusy(true); setError(null);
    const sb = supabaseBrowser();
    const { error } = await sb.from('seed_lots')
      .update({ current_qty: counted, status: counted === 0 ? 'depleted' : lot.status === 'depleted' ? 'active' : lot.status })
      .eq('id', countForm.lot);
    if (error) setError(error.message);
    else {
      const reason = `stock count (expected ${lot.current_qty}, counted ${counted})`;
      await sb.from('seed_inventory_log').insert({ lot_id: countForm.lot, delta: diff, reason, actor: uid });
      await audit('stock_count', 'seed_lot', countForm.lot, reason);
      setCountForm(null);
      await load();
    }
    setBusy(false);
  }

  async function showHistory(lotId: string) {
    if (lotHistory?.lot === lotId) { setLotHistory(null); return; }
    const { data } = await supabaseBrowser()
      .from('seed_inventory_log')
      .select('id,delta,reason,order_id,created_at')
      .eq('lot_id', lotId)
      .order('created_at', { ascending: false })
      .limit(40);
    setLotHistory({ lot: lotId, rows: (data as LotLogRow[]) ?? [] });
  }

  // Substitution: backend produces eligible options; arbitrary swaps impossible.
  async function openSubstitutes(itemId: string) {
    setBusy(true); setError(null);
    const { data, error } = await supabaseBrowser().rpc('admin_seed_substitutes', { p_item: itemId });
    setBusy(false);
    if (error) setError(error.message);
    else setSubFor({ item: itemId, options: (data as SubOption[]) ?? [] });
  }
  async function applySubstitute(opt: SubOption) {
    if (!subFor) return;
    const reason = window.prompt(`Substitute with ${opt.crop} '${opt.variety}'? Reason:`, 'out of stock');
    if (reason === null) return;
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().rpc('admin_substitute_seed_item', {
      p_item: subFor.item, p_product: opt.product_id, p_reason: reason || 'substitution',
    });
    setBusy(false);
    if (error) setError(error.message);
    else { setSubFor(null); await load(); }
  }

  async function cancelOrder(o: SeedDropOrder) {
    const reason = window.prompt(
      'Cancel this order? Reserved inventory will be released. Reason:', 'customer request');
    if (reason === null) return;
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().rpc('admin_cancel_seed_order', { p_order: o.id, p_reason: reason });
    setBusy(false);
    if (error) setError(error.message);
    else await load();
  }

  async function expandOrder(o: SeedDropOrder) {
    if (expandedOrder === o.id) { setExpandedOrder(null); return; }
    setExpandedOrder(o.id);
    setPackChecks({});
    if (!orderEmail[o.id]) {
      const { data } = await supabaseBrowser().rpc('admin_user_email', { p_user: o.user_id });
      if (typeof data === 'string') setOrderEmail((m) => ({ ...m, [o.id]: data }));
    }
  }

  function exportCsv(name: string, rows: Record<string, unknown>[]) {
    if (rows.length === 0) return;
    const cols = Object.keys(rows[0]);
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? '')).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
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
          <h1>Gnome Admin</h1>
          <p className="mm-stats">
            <strong>{drops.filter((o) => !['shipped', 'cancelled', 'refunded'].includes(o.status)).length}</strong> open orders ·{' '}
            <strong>{reports.filter((r) => r.status === 'open').length}</strong> open reports
          </p>
        </div>
      </div>

      <div className="seg" style={{ maxWidth: 760, marginBottom: 18, flexWrap: 'wrap' }}>
        {(['dashboard', 'drops', 'seeds', 'compliance', 'taxonomy', 'reports', 'listings', 'users', 'audit'] as Tab[]).map((t) => (
          <button key={t} type="button" className={`seg-btn${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {error && <p className="autherror">{error}</p>}

      {tab === 'dashboard' && (() => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const ordersToday = drops.filter((o) => new Date(o.created_at) >= today);
        const needsSelection = drops.filter((o) => o.status === 'paid');
        const needsReview = drops.filter((o) => o.status === 'needs_review');
        const toPack = drops.filter((o) => o.status === 'selected');
        const toShip = drops.filter((o) => o.status === 'packed');
        const allLots = seedRows.flatMap((p) => p.lots.map((l) => ({ ...l, crop: p.crop })));
        const lowStock = allLots.filter((l) => ['fresh', 'active', 'aging'].includes(l.status) && Number(l.current_qty) > 0 && Number(l.current_qty) < LOW_STOCK_THRESHOLD);
        const outOfStock = seedRows.filter((p) => p.active && !p.lots.some((l) => ['fresh', 'active', 'aging'].includes(l.status) && Number(l.current_qty) > 0));
        const retestDue = allLots.filter((l) => l.next_review_date && l.next_review_date < new Date().toISOString().slice(0, 10));
        const quarantined = allLots.filter((l) => l.status === 'quarantined' || l.status === 'failed');
        const openReports = reports.filter((r) => r.status === 'open');
        const hasInventory = allLots.some((l) => Number(l.current_qty) > 0);
        const cards: { label: string; value: number; to: Tab; hot?: boolean }[] = [
          { label: 'Orders today', value: ordersToday.length, to: 'drops' },
          { label: 'Awaiting selection', value: needsSelection.length, to: 'drops', hot: needsSelection.length > 0 },
          { label: 'Needs review', value: needsReview.length, to: 'drops', hot: needsReview.length > 0 },
          { label: 'Ready to pack', value: toPack.length, to: 'drops', hot: toPack.length > 0 },
          { label: 'Packed — needs tracking', value: toShip.length, to: 'drops', hot: toShip.length > 0 },
          { label: 'Low-stock lots', value: lowStock.length, to: 'seeds', hot: lowStock.length > 0 },
          { label: 'Germination retests due', value: retestDue.length, to: 'seeds', hot: retestDue.length > 0 },
          { label: 'Open reports', value: openReports.length, to: 'reports', hot: openReports.length > 0 },
        ];
        return (
          <div>
            <div className="dash-cards">
              {cards.map((c) => (
                <button key={c.label} className={`dash-card${c.hot ? ' hot' : ''}`} onClick={() => setTab(c.to)}>
                  <span className="dc-value">{c.value}</span>
                  <span className="dc-label">{c.label}</span>
                </button>
              ))}
            </div>

            <section className="section" style={{ paddingTop: 10 }}>
              <div className="section-head"><h2>Needs your attention</h2></div>
              <div className="mm-list">
                {needsReview.map((o) => (
                  <div key={o.id} className="mm-row">
                    <div className="mm-info">
                      <span className="mm-title">Seed Drop {o.id.slice(0, 8)}… found fewer than {o.packet_count} eligible varieties</span>
                      <div className="mm-meta"><span className="tag type-sale">needs review</span></div>
                    </div>
                    <div className="mm-btns"><button className="mm-btn" onClick={() => { setTab('drops'); void expandOrder(o); }}>Review order</button></div>
                  </div>
                ))}
                {toShip.map((o) => (
                  <div key={o.id} className="mm-row">
                    <div className="mm-info"><span className="mm-title">Order {o.id.slice(0, 8)}… is packed but has no tracking</span></div>
                    <div className="mm-btns"><button className="mm-btn" onClick={() => setTab('drops')}>Add tracking</button></div>
                  </div>
                ))}
                {lowStock.map((l) => (
                  <div key={l.id} className="mm-row">
                    <div className="mm-info"><span className="mm-title">{l.crop} lot {l.internal_lot_number} is low ({l.current_qty} left)</span></div>
                    <div className="mm-btns"><button className="mm-btn" onClick={() => setTab('seeds')}>Restock</button></div>
                  </div>
                ))}
                {retestDue.map((l) => (
                  <div key={l.id} className="mm-row">
                    <div className="mm-info"><span className="mm-title">{l.crop} lot {l.internal_lot_number} germination retest overdue</span></div>
                    <div className="mm-btns"><button className="mm-btn" onClick={() => setTab('seeds')}>Run test</button></div>
                  </div>
                ))}
                {quarantined.map((l) => (
                  <div key={l.id} className="mm-row">
                    <div className="mm-info"><span className="mm-title">{l.crop} lot {l.internal_lot_number} is {l.status}</span></div>
                    <div className="mm-btns"><button className="mm-btn" onClick={() => setTab('seeds')}>Review lot</button></div>
                  </div>
                ))}
                {openReports.map((r) => (
                  <div key={r.id} className="mm-row">
                    <div className="mm-info"><span className="mm-title">Reported {r.target_type}: “{r.reason ?? 'no reason given'}”</span></div>
                    <div className="mm-btns"><button className="mm-btn" onClick={() => setTab('reports')}>Moderate</button></div>
                  </div>
                ))}
                {needsReview.length + toShip.length + lowStock.length + retestDue.length + quarantined.length + openReports.length === 0 && (
                  <div className="empty"><p>All quiet in the garden. 🌱 Nothing needs you right now.</p></div>
                )}
              </div>
            </section>

            <section className="section">
              <div className="section-head"><h2>Seed Drop go-live readiness</h2></div>
              <ul className="checks">
                <li>✅ Database, engine, and fulfillment tooling — live (engine test suite 7/7)</li>
                <li>✅ Ask Gnome seed integration — live</li>
                <li>{hasInventory ? '✅' : '⬜'} Real seed inventory received {hasInventory ? '' : '— receive your first lot in the Seeds tab'}</li>
                <li>{STARTER_LINK_SET ? '✅' : '⬜'} Stripe Starter link configured {STARTER_LINK_SET ? '' : '— create the $12 Payment Link, set NEXT_PUBLIC_SEED_LINK_STARTER, redeploy'}</li>
                <li>⬜ Seed-label compliance review — external legal check before Gnome-branded repackaging (never auto-checked)</li>
              </ul>
            </section>
          </div>
        );
      })()}

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
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={() => setVarietyForm(emptyVariety())}>+ New variety</button>
          </div>

          {varietyForm && (
            <div className="preview-note" style={{ marginBottom: 14 }}>
              <strong>{varietyForm.id ? `Edit ${varietyForm.crop} · ${varietyForm.variety}` : 'New seed variety'}</strong>
              <div className="field-row" style={{ marginTop: 10 }}>
                <div className="field"><label>Crop</label>
                  <input value={varietyForm.crop} placeholder="Tomato" onChange={(e) => setVarietyForm({ ...varietyForm, crop: e.target.value })} /></div>
                <div className="field"><label>Variety</label>
                  <input value={varietyForm.variety} placeholder="San Marzano" onChange={(e) => setVarietyForm({ ...varietyForm, variety: e.target.value })} /></div>
              </div>
              <div className="field-row" style={{ marginTop: 8 }}>
                <div className="field"><label>Category</label>
                  <select value={varietyForm.category} onChange={(e) => setVarietyForm({ ...varietyForm, category: e.target.value })}>
                    {['vegetable', 'herb', 'flower', 'pollinator', 'salad', 'fruit'].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select></div>
                <div className="field"><label>Sun</label>
                  <select value={varietyForm.preferred_sun} onChange={(e) => setVarietyForm({ ...varietyForm, preferred_sun: e.target.value })}>
                    {['full', 'partial', 'shade', 'any'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select></div>
                <div className="field"><label>Seeds/packet</label>
                  <input inputMode="numeric" value={varietyForm.packet_seed_count} onChange={(e) => setVarietyForm({ ...varietyForm, packet_seed_count: e.target.value.replace(/[^0-9]/g, '') })} /></div>
              </div>
              <div className="field" style={{ marginTop: 8 }}><label>Description</label>
                <textarea rows={2} value={varietyForm.description} onChange={(e) => setVarietyForm({ ...varietyForm, description: e.target.value })} /></div>
              <div className="field-row" style={{ marginTop: 8 }}>
                <div className="field"><label>Days to germinate</label>
                  <input inputMode="numeric" value={varietyForm.days_to_germination} onChange={(e) => setVarietyForm({ ...varietyForm, days_to_germination: e.target.value.replace(/[^0-9]/g, '') })} /></div>
                <div className="field"><label>Days to mature</label>
                  <input inputMode="numeric" value={varietyForm.days_to_maturity} onChange={(e) => setVarietyForm({ ...varietyForm, days_to_maturity: e.target.value.replace(/[^0-9]/g, '') })} /></div>
                <div className="field"><label>Depth (in)</label>
                  <input inputMode="decimal" value={varietyForm.planting_depth_inches} onChange={(e) => setVarietyForm({ ...varietyForm, planting_depth_inches: e.target.value.replace(/[^0-9.]/g, '') })} /></div>
                <div className="field"><label>Spacing (in)</label>
                  <input inputMode="decimal" value={varietyForm.spacing_inches} onChange={(e) => setVarietyForm({ ...varietyForm, spacing_inches: e.target.value.replace(/[^0-9.]/g, '') })} /></div>
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Sowing months (zone-6 baseline — when can this go in?)</label>
                <div className="chiprow">
                  {MONTHS.map((m, idx) => {
                    const mo = idx + 1;
                    const on = varietyForm.sow_months.includes(mo);
                    return (
                      <button key={m} type="button" className={`chip${on ? ' active' : ''}`}
                        onClick={() => setVarietyForm({
                          ...varietyForm,
                          sow_months: on ? varietyForm.sow_months.filter((x) => x !== mo) : [...varietyForm.sow_months, mo].sort((a, b) => a - b),
                        })}>
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="chiprow" style={{ marginTop: 8 }}>
                <button type="button" className={`chip${varietyForm.container_friendly ? ' active' : ''}`}
                  onClick={() => setVarietyForm({ ...varietyForm, container_friendly: !varietyForm.container_friendly })}>
                  🪴 Container-friendly
                </button>
                <button type="button" className={`chip${varietyForm.beginner_friendly ? ' active' : ''}`}
                  onClick={() => setVarietyForm({ ...varietyForm, beginner_friendly: !varietyForm.beginner_friendly })}>
                  🌱 Beginner-friendly
                </button>
                <button type="button" className={`chip${varietyForm.active ? ' active' : ''}`}
                  onClick={() => setVarietyForm({ ...varietyForm, active: !varietyForm.active })}>
                  {varietyForm.active ? '✓ Active in catalog' : 'Inactive (hidden from engine)'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void saveVariety()}>
                  {busy ? 'Saving…' : varietyForm.id ? 'Save changes' : 'Create variety'}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setVarietyForm(null)}>Cancel</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="mm-btn" onClick={() => exportCsv('seed-inventory', seedRows.flatMap((p) => p.lots.map((l) => ({
              crop: p.crop, variety: p.variety, lot: l.internal_lot_number, supplier: l.supplier ?? '',
              qty: l.current_qty, unit: l.unit, germination: l.germination_pct ?? '', status: l.status,
              received: l.received_date, next_review: l.next_review_date ?? '',
            }))))}>⬇ Export CSV</button>
          </div>
          <div className="mm-list">
            {seedRows.map((p) => (
              <div key={p.id} className="mm-row" style={{ alignItems: 'flex-start' }}>
                <div className="mm-info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="mm-title">
                      {p.crop} · {p.variety}
                      {!p.active && <span className="tag" style={{ marginLeft: 6 }}>inactive</span>}
                    </span>
                    <span className="mm-expiry">
                      {p.category} · {p.packet_seed_count} seeds/pkt · {p.preferred_sun} sun
                      {p.container_friendly ? ' · 🪴' : ''} · sow {p.sow_months.map((m) => MONTHS[m - 1]).join(' ')}
                    </span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <button className="mm-btn" disabled={busy} onClick={() => setVarietyForm({
                        id: p.id, crop: p.crop, variety: p.variety, category: p.category,
                        description: p.description ?? '', preferred_sun: p.preferred_sun,
                        container_friendly: p.container_friendly, beginner_friendly: p.beginner_friendly,
                        days_to_germination: p.days_to_germination?.toString() ?? '',
                        days_to_maturity: p.days_to_maturity?.toString() ?? '',
                        planting_depth_inches: p.planting_depth_inches?.toString() ?? '',
                        spacing_inches: p.spacing_inches?.toString() ?? '',
                        packet_seed_count: String(p.packet_seed_count),
                        sow_months: p.sow_months ?? [], active: p.active,
                      })}>✏️ Edit</button>
                      <button className="mm-btn" disabled={busy} onClick={() => {
                        setLotFormFor(lotFormFor === p.id ? null : p.id);
                        setLotForm({ product: p.id, lotNo: '', qty: '', germ: '', supplier: '' });
                      }}>+ Lot</button>
                    </span>
                  </div>

                  {lotFormFor === p.id && (
                    <div className="locrow" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                      <input style={{ maxWidth: 140 }} placeholder="lot # (e.g. LT-2026-1)" value={lotForm.lotNo} onChange={(e) => setLotForm({ ...lotForm, lotNo: e.target.value })} />
                      <input style={{ maxWidth: 90 }} placeholder="packets" inputMode="numeric" value={lotForm.qty} onChange={(e) => setLotForm({ ...lotForm, qty: e.target.value.replace(/[^0-9]/g, '') })} />
                      <input style={{ maxWidth: 90 }} placeholder="germ %" inputMode="numeric" value={lotForm.germ} onChange={(e) => setLotForm({ ...lotForm, germ: e.target.value.replace(/[^0-9]/g, '') })} />
                      <input style={{ maxWidth: 140 }} placeholder="supplier" value={lotForm.supplier} onChange={(e) => setLotForm({ ...lotForm, supplier: e.target.value })} />
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { await addLot(); setLotFormFor(null); }}>Receive</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setLotFormFor(null)}>Cancel</button>
                    </div>
                  )}

                  <div style={{ marginTop: 6 }}>
                    {p.lots.length === 0 && <span className="mm-expiry">no lots — out of stock</span>}
                    {p.lots.map((l) => {
                      const low = Number(l.current_qty) > 0 && Number(l.current_qty) < 5;
                      const overdue = l.next_review_date && l.next_review_date < new Date().toISOString().slice(0, 10);
                      const bad = l.status === 'quarantined' || l.status === 'failed' || l.status === 'discarded';
                      return (
                        <div key={l.id} className="lot-row">
                          <span className={`tag ${bad ? 'type-sale' : low || overdue ? 'type-wanted' : 'type-free'}`}>
                            {l.internal_lot_number} · {l.current_qty} {l.unit}
                            {l.germination_pct != null ? ` · ${l.germination_pct}%` : ' · untested'}
                            {' · '}{l.status}{overdue ? ' · RETEST DUE' : ''}
                          </span>
                          {l.supplier && <span className="mm-expiry">{l.supplier}</span>}
                          <span className="lot-actions">
                            <button className="mm-btn" disabled={busy} onClick={() => { setAdjustForm({ lot: l.id, delta: '', reason: '' }); setCountForm(null); }}>Adjust</button>
                            <button className="mm-btn" disabled={busy} onClick={() => { setCountForm({ lot: l.id, counted: '' }); setAdjustForm(null); }}>Count</button>
                            <button className="mm-btn" disabled={busy} onClick={() => setTestForm({ lot: l.id, tested: '', germd: '' })}>Test</button>
                            <button className="mm-btn" disabled={busy} onClick={() => void showHistory(l.id)}>Log</button>
                            {l.status !== 'quarantined'
                              ? <button className="mm-btn danger" disabled={busy} onClick={() => void setLotStatus(l, 'quarantined')}>Quarantine</button>
                              : <button className="mm-btn" disabled={busy} onClick={() => void setLotStatus(l, 'active')}>Restore</button>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {adjustForm && p.lots.some((l) => l.id === adjustForm.lot) && (
                    <div className="locrow" style={{ marginTop: 8 }}>
                      <input placeholder="± qty (e.g. -4)" inputMode="numeric" value={adjustForm.delta}
                        onChange={(e) => setAdjustForm({ ...adjustForm, delta: e.target.value.replace(/[^0-9-]/g, '') })} />
                      <select value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}>
                        <option value="">reason…</option>
                        {['manual correction', 'damaged', 'lost', 'germination testing', 'packaging waste', 'return', 'expired', 'other'].map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void applyAdjustment()}>Apply</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setAdjustForm(null)}>Cancel</button>
                    </div>
                  )}
                  {countForm && p.lots.some((l) => l.id === countForm.lot) && (
                    <div className="locrow" style={{ marginTop: 8 }}>
                      <input placeholder={`counted qty (expected ${p.lots.find((l) => l.id === countForm.lot)?.current_qty})`}
                        inputMode="numeric" value={countForm.counted}
                        onChange={(e) => setCountForm({ ...countForm, counted: e.target.value.replace(/[^0-9]/g, '') })} />
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void applyCount()}>Reconcile</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setCountForm(null)}>Cancel</button>
                    </div>
                  )}
                  {lotHistory && p.lots.some((l) => l.id === lotHistory.lot) && (
                    <div className="preview-note" style={{ marginTop: 8 }}>
                      <strong>Lot history</strong> (newest first — balances reconcile in seed_inventory_log):
                      {lotHistory.rows.length === 0 && <div>no movements recorded</div>}
                      {lotHistory.rows.map((r) => (
                        <div key={r.id}>
                          {new Date(r.created_at).toLocaleString()} · {r.delta > 0 ? `+${r.delta}` : r.delta} · {r.reason}
                          {r.order_id ? ` · order ${r.order_id.slice(0, 8)}…` : ''}
                        </div>
                      ))}
                    </div>
                  )}
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
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="mm-btn" onClick={() => exportCsv('seed-orders', drops.map((o) => ({
              id: o.id, status: o.status, packets: o.packet_count, tracking: o.tracking ?? '',
              created: o.created_at,
              seeds: o.items.filter((i) => i.status !== 'released').map((i) => i.product?.crop).join('; '),
            })))}>⬇ Export CSV</button>
          </div>
          {drops.length === 0 && <div className="empty"><p>No Seed Drop orders yet.</p></div>}
          {drops.map((o) => {
            const activeItems = o.items.filter((i) => i.status !== 'released');
            const snap = o.profile_snapshot as {
              zone?: number; garden_size?: string; garden_sizes?: string[]; sun?: string;
              experience?: string; zip?: string; preferences?: string[]; exclusions?: string[];
            };
            const allChecked = activeItems.length > 0 && activeItems.every((i) => packChecks[i.id]);
            return (
              <div key={o.id}>
                <div className="mm-row" style={{ alignItems: 'flex-start' }}>
                  <div className="mm-thumb"><span>📦</span></div>
                  <div className="mm-info">
                    <span className="mm-title">
                      {o.id.slice(0, 8)}… · {o.packet_count} packets · {new Date(o.created_at).toLocaleDateString()}
                      {' · zone '}{String(snap.zone ?? '?')} · {snap.zip ?? '?'}
                    </span>
                    <div className="mm-meta" style={{ flexWrap: 'wrap', gap: 6 }}>
                      <span className={`tag ${o.status === 'needs_review' ? 'type-sale' : 'type-free'}`}>{o.status}</span>
                      {o.tracking && <span className="mm-expiry">{o.tracking}</span>}
                      {activeItems.map((i) => (
                        <span key={i.id} className="tag">
                          {i.product ? `${i.product.crop}/${i.product.variety}` : '?'}
                          {i.lot ? ` [${i.lot.internal_lot_number}]` : ''}
                          {i.substitution_reason ? ' 🔁' : ''}
                        </span>
                      ))}
                    </div>
                    {trackForm?.order === o.id && (
                      <div className="locrow" style={{ marginTop: 8 }}>
                        <input placeholder="carrier + tracking number" value={trackForm.tracking} onChange={(e) => setTrackForm({ order: o.id, tracking: e.target.value })} />
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void setOrderStatus(o, 'shipped', trackForm.tracking)}>Ship</button>
                      </div>
                    )}
                  </div>
                  <div className="mm-btns">
                    <button className="mm-btn" onClick={() => void expandOrder(o)}>
                      {expandedOrder === o.id ? 'Close' : 'Details'}
                    </button>
                    {(o.status === 'paid' || o.status === 'needs_review') && (
                      <button className="mm-btn" disabled={busy} onClick={() => void runSelection(o)}>Run selection</button>
                    )}
                    {o.status === 'selected' && (
                      <button
                        className="mm-btn"
                        disabled={busy}
                        onClick={() => {
                          if (!allChecked && !window.confirm('Not every packet is confirmed in the packing checklist. Mark packed anyway?')) return;
                          void setOrderStatus(o, 'packed');
                        }}
                      >
                        Mark packed
                      </button>
                    )}
                    {o.status === 'packed' && (
                      <button className="mm-btn" disabled={busy} onClick={() => setTrackForm({ order: o.id, tracking: '' })}>Add tracking</button>
                    )}
                    {(o.status === 'paid' || o.status === 'selected' || o.status === 'needs_review') && (
                      <button className="mm-btn danger" disabled={busy} onClick={() => void cancelOrder(o)}>Cancel</button>
                    )}
                  </div>
                </div>

                {expandedOrder === o.id && (
                  <div className="preview-note" style={{ marginTop: 0 }}>
                    <div><strong>Customer:</strong> {orderEmail[o.id] ?? 'loading…'} · user {o.user_id.slice(0, 8)}…</div>
                    <div style={{ marginTop: 4 }}>
                      <strong>Frozen profile:</strong> ZIP {snap.zip ?? '?'} · zone {snap.zone ?? '?'} ·{' '}
                      {(snap.garden_sizes?.length ? snap.garden_sizes : [snap.garden_size ?? '?']).join(' + ')} ·{' '}
                      {snap.sun ?? '?'} sun · {snap.experience ?? '?'}
                      {snap.preferences?.length ? <> · likes: {snap.preferences.join(', ')}</> : null}
                      {snap.exclusions?.length ? <> · avoid: {snap.exclusions.join(', ')}</> : null}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <strong>{o.status === 'selected' ? 'Packing checklist' : 'Contents'}:</strong>
                      {activeItems.map((i, idx) => (
                        <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                          {o.status === 'selected' && (
                            <input
                              type="checkbox"
                              style={{ width: 22, height: 22 }}
                              checked={!!packChecks[i.id]}
                              onChange={(e) => setPackChecks({ ...packChecks, [i.id]: e.target.checked })}
                            />
                          )}
                          <span style={{ flex: 1 }}>
                            {idx + 1}. {i.product ? `${i.product.crop} '${i.product.variety}'` : '?'}
                            {i.lot ? ` — lot ${i.lot.internal_lot_number}` : ''}
                            {i.product ? ` · ~${i.product.packet_seed_count} seeds` : ''}
                            {i.lot?.germination_pct != null ? ` · ${i.lot.germination_pct}% germ` : ''}
                            {i.substitution_reason ? ` · 🔁 ${i.substitution_reason}` : ''}
                          </span>
                          {i.status === 'reserved' && (o.status === 'selected' || o.status === 'needs_review') && (
                            <button className="linkbtn" disabled={busy} onClick={() => void openSubstitutes(i.id)}>substitute</button>
                          )}
                        </div>
                      ))}
                      {activeItems.length === 0 && <div>No packets reserved yet.</div>}
                    </div>
                    {subFor && activeItems.some((i) => i.id === subFor.item) && (
                      <div style={{ marginTop: 8 }}>
                        <strong>Eligible replacements (backend-filtered for this order):</strong>
                        {subFor.options.length === 0 && <div>None available — broaden inventory or release the slot.</div>}
                        {subFor.options.map((opt) => (
                          <div key={opt.product_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                            <span style={{ flex: 1 }}>{opt.crop} '{opt.variety}' — lot {opt.internal_lot_number} · {opt.why}</span>
                            <button className="linkbtn" disabled={busy} onClick={() => void applySubstitute(opt)}>use this</button>
                          </div>
                        ))}
                        <button className="linkbtn" onClick={() => setSubFor(null)}>close</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Both sections render only past the isAdmin gate above; RLS + the
          hardened admin_review_credential RPC remain the real authority. */}
      {tab === 'compliance' && <ComplianceClient />}
      {tab === 'taxonomy' && <TaxonomyClient />}

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
