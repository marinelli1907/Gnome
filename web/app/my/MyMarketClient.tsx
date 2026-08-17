'use client';

// "My Market" — the seller's dashboard. Every listing they've ever posted
// (RLS lets owners read all statuses, not just active), grouped by state,
// with promotion status and the quick actions that make sense on the web:
// mark sold, remove, relist. Full editing stays in the app for now.
import { useCallback, useEffect, useState } from 'react';
import { logWeb } from '../../lib/analytics';
import { categoryFor } from '../../lib/categories';
import { formatPrice, listingPath, timeLeft, TYPE_LABEL, type ListingType } from '../../lib/format';
import {
  isUnderReview,
  mapServerError,
  reviewReason,
  RULES_HREF,
  SCREENING_COLS,
  SUPPORT_EMAIL,
  type ServerError,
  type ScreenedListing,
} from '../../lib/gnome';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import AllowanceCard from '../components/AllowanceCard';
import ShareMarketCard from '../components/ShareMarketCard';
import { planDisplay } from '../../lib/allowance';
import AppLink from '../components/AppLink';
import { SignInCard, useSession } from '../components/auth';
import { HeldForReview, ServerErrorNotice } from '../components/ScreeningNotice';
import PlotThread from '../components/PlotThread';
import PaymentMethodsEditor from './PaymentMethodsEditor';
import PickupAvailabilityEditor from './PickupAvailabilityEditor';
import DeliverySettingsEditor from './DeliverySettingsEditor';
import PickupOrdersManager from './PickupOrdersManager';

// Explicit column list — post-0010 the base table rejects select=* for
// non-service roles (lat/lng/slug are revoked; everything else is granted).
const COLS =
  'id,title,category,listing_type,status,price_cents,unit,photos,created_at,expires_at,is_featured,featured_until,market_position,market_featured,inventory_count';

interface MyListing extends ScreenedListing {
  id: string;
  title: string;
  category: string;
  listing_type: ListingType;
  // 'paused' is content screening holding a listing: the row saved, but it is
  // not public until a person clears it.
  status: 'active' | 'claimed' | 'completed' | 'expired' | 'removed' | 'paused';
  price_cents: number | null;
  unit: string | null;
  photos: string[];
  created_at: string;
  expires_at: string;
  is_featured: boolean | null;
  featured_until: string | null;
  market_position: number | null;
  market_featured: boolean;
  inventory_count: number | null;
}

interface MyMarket {
  id: string; name: string; slug: string; plan: string | null;
  tagline: string | null; theme: string; description: string | null;
}

interface Txn {
  id: string; listing_id: string | null; quantity: number;
  gross_cents: number; discount_cents: number; fee_cents: number; net_cents: number;
  payment_method: string; buyer_label: string | null; notes: string | null;
  status: string; sold_at: string;
}
interface Expense {
  id: string; spent_at: string; category: string; amount_cents: number;
  vendor: string | null; notes: string | null; status: string;
}
const PAY_METHODS = [
  ['cash', 'Cash'], ['venmo', 'Venmo'], ['zelle', 'Zelle'], ['cashapp', 'Cash App'],
  ['check', 'Check'], ['external_card', 'Card (external)'], ['other', 'Other'],
] as const;
const THEMES = ['garden', 'harvest', 'herb', 'farm_stand', 'minimal'] as const;
const EXPENSE_CATS = ['seeds', 'soil', 'fertilizer', 'packaging', 'market_fees', 'supplies', 'mileage', 'other'] as const;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

// A plot-reservation request on one of MY plot listings (I'm the grower).
interface Reservation {
  id: string;
  listing_id: string;
  status: 'pending' | 'approved' | 'declined' | 'cancelled' | 'completed' | 'expired';
  buyer_note: string | null;
  agreed_price_cents: number | null;
  created_at: string;
  claimer: { name: string | null } | null;
}

// A Seed Drop order (mine), with the exact varieties the engine reserved.
interface SeedOrder {
  id: string;
  status: string;
  packet_count: number;
  tracking: string | null;
  created_at: string;
  items: { id: string; status: string; product: { crop: string; variety: string } | null }[];
}

// A plot I reserved in someone else's garden (I'm the buyer).
interface MyReservation {
  id: string;
  status: Reservation['status'];
  buyer_note: string | null;
  agreed_price_cents: number | null;
  created_at: string;
  listing: { id: string; title: string; status: string } | null;
}

// A held listing is never "Live", "Unsold", or anything else — it is its own
// state, and it has to be checked first or a paused row silently vanishes from
// the dashboard (no group matched it before this existed).
function isHeld(l: MyListing) { return isUnderReview(l); }
function isLiveGroup(l: MyListing) {
  return !isHeld(l)
    && (l.status === 'active' || l.status === 'claimed')
    && new Date(l.expires_at) > new Date();
}

const GROUPS: { key: string; title: string; blurb: string; match: (l: MyListing) => boolean }[] = [
  {
    key: 'review', title: 'Under review',
    blurb: 'Saved, but not public yet — a person at Gnome is taking a look.',
    match: isHeld,
  },
  {
    key: 'live', title: 'Live', blurb: 'Visible to neighbors right now.',
    match: isLiveGroup,
  },
  {
    key: 'sold', title: 'Sold & shared', blurb: 'Completed — nice work.',
    match: (l) => !isHeld(l) && l.status === 'completed',
  },
  {
    key: 'unsold', title: 'Unsold', blurb: 'Expired or removed. Relist anytime.',
    match: (l) =>
      !isHeld(l) && (
        l.status === 'expired' || l.status === 'removed' ||
        (l.status === 'active' && new Date(l.expires_at) <= new Date())),
  },
];

export default function MyMarketClient() {
  const { session, ready } = useSession();
  const uid = session?.user?.id;

  const [market, setMarket] = useState<MyMarket | null>(null);
  const [listings, setListings] = useState<MyListing[] | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [myReservations, setMyReservations] = useState<MyReservation[]>([]);
  const [seedOrders, setSeedOrders] = useState<SeedOrder[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [custForm, setCustForm] = useState({ name: '', tagline: '', description: '', theme: 'garden' });
  const [saleOpen, setSaleOpen] = useState(false);
  const [saleForm, setSaleForm] = useState({ listing: '', qty: '1', amount: '', discount: '', fee: '', method: 'cash', buyer: '', notes: '' });
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expForm, setExpForm] = useState({ category: 'seeds', amount: '', vendor: '', notes: '' });
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [pickupOpen, setPickupOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  // Resolved plan entitlements — the backend's single source (0064). No more
  // hardcoded caps in this file.
  const [ent, setEnt] = useState<{
    plan: string; subscription_status: string | null;
    max_active_listings: number | null; active_listings: number;
    max_pickup_locations: number; extra_location_fee_cents: number | null;
    extra_pickup_locations: number; effective_pickup_locations: number;
  } | null>(null);
  useEffect(() => {
    const sb = supabaseBrowser();
    void sb.rpc('my_plan_entitlements').then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setEnt(row);
    });
  }, []);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [credits, setCredits] = useState<number>(0);

  // Stripe sends the seller back here after checkout. Without this they land on
  // their dashboard with no acknowledgement that anything happened — and a
  // cancelled checkout looks identical to a failed one.
  const [checkoutNote, setCheckoutNote] = useState<string | null>(null);
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('checkout');
    if (r === 'success') {
      setCheckoutNote('Payment received — thank you. If your plan or boost is not showing yet, give it a few seconds and refresh.');
    } else if (r === 'cancelled') {
      setCheckoutNote('Checkout cancelled. Nothing was charged.');
    }
    if (r) window.history.replaceState({}, '', '/my');
  }, []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A refusal from the server, translated out of Postgres.
  const [refused, setRefused] = useState<ServerError | null>(null);
  // A write that succeeded but came back held — e.g. a relist that screening
  // caught. Never let that read as "it's live again".
  const [heldNow, setHeldNow] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    const supabase = supabaseBrowser();
    // The screening columns are a separate column grant from the rest of the
    // row, so they are asked for in their own statement: if that grant is
    // missing the dashboard still loads, and 'paused' alone still marks the
    // listing Under review — only the server's written explanation is lost.
    const [{ data: m }, { data: ls, error: lerr }, { data: screens }] = await Promise.all([
      supabase.from('markets').select('id,name,slug,plan,tagline,theme,description').eq('owner_id', uid).limit(1).maybeSingle(),
      supabase.from('listings').select(COLS).eq('owner_id', uid).order('created_at', { ascending: false }),
      supabase.from('listings').select(`id,${SCREENING_COLS}`).eq('owner_id', uid),
    ]);
    if (lerr) setRefused(mapServerError(lerr));
    setMarket((m as MyMarket) ?? null);
    const rows = (ls as unknown as MyListing[]) ?? [];

    type ScreenFields = Pick<ScreenedListing, 'screening_status' | 'screening_reason'>;
    const screenById = new Map<string, ScreenFields>();
    for (const s of (screens as unknown as ({ id: string } & ScreenFields)[] | null) ?? []) {
      screenById.set(s.id, { screening_status: s.screening_status, screening_reason: s.screening_reason });
    }
    setListings(rows.map((l) => ({ ...l, ...(screenById.get(l.id) ?? {}) })));

    // Incoming plot reservations on my plot listings (claims RLS shows the
    // owner every claim on their listings; the FK-qualified embed avoids the
    // ambiguous double-FK to profiles).
    const plotIds = rows.filter((l) => l.listing_type === 'plot').map((l) => l.id);
    if (plotIds.length > 0) {
      const { data: rs } = await supabase
        .from('claims')
        .select('id,listing_id,status,buyer_note,agreed_price_cents,created_at,claimer:profiles!claims_claimer_id_fkey(name)')
        .eq('claim_type', 'plot_reservation')
        .in('listing_id', plotIds)
        .order('created_at', { ascending: false });
      setReservations((rs as unknown as Reservation[]) ?? []);
    } else {
      setReservations([]);
    }

    // Plots I reserved elsewhere (buyer side). The listing embed works even
    // after the plot flips to 'claimed' thanks to 0026's claimer-read policy.
    const { data: mine } = await supabase
      .from('claims')
      .select('id,status,buyer_note,agreed_price_cents,created_at,listing:listings!claims_listing_id_fkey(id,title,status)')
      .eq('claim_type', 'plot_reservation')
      .eq('claimer_id', uid)
      .order('created_at', { ascending: false });
    setMyReservations((mine as unknown as MyReservation[]) ?? []);

    // My Seed Drop orders (own-row RLS; items embed the public catalog row).
    const { data: sorders } = await supabase
      .from('seed_orders')
      .select('id,status,packet_count,tracking,created_at,items:seed_order_items(id,status,product:seed_products!seed_order_items_seed_product_id_fkey(crop,variety))')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    setSeedOrders((sorders as unknown as SeedOrder[]) ?? []);

    if (m?.id) {
      const { data: c } = await supabase.rpc('market_boost_credits_remaining', {
        p_market_id: (m as MyMarket).id,
      });
      setCredits(typeof c === 'number' ? c : 0);
      const [{ data: tx }, { data: ex }] = await Promise.all([
        supabase.from('seller_transactions').select('*').eq('market_id', (m as MyMarket).id)
          .order('sold_at', { ascending: false }).limit(200),
        supabase.from('seller_expenses').select('*').eq('market_id', (m as MyMarket).id)
          .order('spent_at', { ascending: false }).limit(100),
      ]);
      setTxns((tx as Txn[]) ?? []);
      setExpenses((ex as Expense[]) ?? []);
      const mm = m as MyMarket;
      setCustForm({ name: mm.name, tagline: mm.tagline ?? '', description: mm.description ?? '', theme: mm.theme ?? 'garden' });
    }
  }, [uid]);

  useEffect(() => { void load(); }, [load]);

  // Mark sold / remove / relist. Relisting re-publishes, which re-runs the
  // server's gates: it can be refused outright, and it can come back saved but
  // held. Both have to reach the seller — a relist that lands in review must
  // never look like the listing is live again.
  async function setStatus(l: MyListing, status: string, extra: Record<string, unknown> = {}) {
    setBusyId(l.id);
    setError(null);
    setRefused(null);
    setHeldNow(null);
    const sb = supabaseBrowser();
    const { data: rows, error } = await sb
      .from('listings')
      .update({ status, ...extra })
      .eq('id', l.id)
      .select('id,status');
    setBusyId(null);
    if (error) {
      setRefused(mapServerError(error));
      return;
    }
    if (status === 'active') {
      const saved = (rows?.[0] as { id: string; status: string } | undefined) ?? { id: l.id, status };
      let screened: ScreenedListing = { status: saved.status };
      const { data: srow } = await sb
        .from('listings')
        .select(SCREENING_COLS)
        .eq('id', l.id)
        .maybeSingle();
      if (srow) screened = srow as ScreenedListing;
      if (isUnderReview(screened)) setHeldNow(reviewReason(screened));
    }
    await load();
  }

  // Redeem a plan boost credit → 7-day featured promotion (M7 trigger
  // enforces the monthly allowance server-side; we just surface it).
  // Buying a one-off promotion when the monthly credits are gone. This used to
  // be an <a> to a raw Stripe Payment Link, which went straight to Stripe and so
  // ignored the owner's Payments Live switch entirely. It goes through
  // billing-checkout now, which checks that switch, picks the test-or-live price,
  // and verifies server-side that this listing actually belongs to the caller.
  async function buyBoost(l: MyListing) {
    setBusyId(l.id);
    setError(null);
    setRefused(null);
    try {
      const { data, error } = await supabaseBrowser().functions.invoke('billing-checkout', {
        body: { product_key: 'GNOME_LISTING_PROMOTION', listing_id: l.id },
      });
      const code = (data as { error?: string } | null)?.error;
      if (code === 'NOT_YOUR_LISTING') { setError('That listing is not yours.'); return; }
      if (code === 'PRICE_MISSING' || code === 'STRIPE_KEY_MISSING') {
        setError('Promotions are not on sale yet. Nothing was charged.'); return;
      }
      if (code || error) { setError('Checkout is unavailable right now. Nothing was charged.'); return; }
      const { url, mode } = (data ?? {}) as { url?: string; mode?: string };
      if (!url) { setError('Checkout is unavailable right now. Nothing was charged.'); return; }
      if (mode === 'test') {
        setError('Opening Stripe in test mode — a real card will not be charged. Use 4242 4242 4242 4242.');
      }
      window.location.href = url;
    } catch {
      setError('Checkout is unavailable right now. Nothing was charged.');
    } finally {
      setBusyId(null);
    }
  }

  async function boost(l: MyListing) {
    if (!market) return;
    setBusyId(l.id);
    setError(null);
    setRefused(null);
    const { error } = await supabaseBrowser().from('listing_promotions').insert({
      listing_id: l.id,
      market_id: market.id,
      source: 'plan_credit',
      status: 'active',
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
      created_by: uid,
    });
    setBusyId(null);
    if (error) {
      if (error.message.includes('credit')) {
        setError('No boost credits left this month — upgrade for more, or grab a one-off boost.');
      } else setRefused(mapServerError(error));
    } else await load();
  }

  // Approve/decline a plot reservation. Approving fires the claim-status
  // trigger: the plot listing flips to 'claimed' (off the marketplace) and
  // other pending requests auto-decline.
  async function setReservation(r: Reservation, status: 'approved' | 'declined') {
    setBusyId(r.id);
    setError(null);
    setRefused(null);
    const { error } = await supabaseBrowser().from('claims').update({ status }).eq('id', r.id);
    setBusyId(null);
    if (error) setRefused(mapServerError(error));
    else await load();
  }

  async function saveCustomize() {
    if (!market) return;
    const name = custForm.name.trim();
    if (name.length < 3 || name.length > 60) return setError('Market name needs 3–60 characters.');
    setBusyId('customize'); setError(null); setRefused(null);
    const { error } = await supabaseBrowser().from('markets').update({
      name,
      tagline: custForm.tagline.trim().slice(0, 120) || null,
      description: custForm.description.trim() || null,
      theme: custForm.theme,
    }).eq('id', market.id);
    setBusyId(null);
    if (error) setRefused(mapServerError(error));
    else { logWeb('market_customized'); setCustomizeOpen(false); await load(); }
  }

  async function recordSale() {
    if (!market) return;
    const gross = Math.round(Number(saleForm.amount) * 100);
    if (!gross || gross <= 0) return setError('Enter the sale amount.');
    setBusyId('sale'); setError(null); setRefused(null);
    const { error } = await supabaseBrowser().rpc('record_sale', {
      p_market: market.id,
      p_listing: saleForm.listing || null,
      p_claim: null,
      p_quantity: Math.max(1, Number(saleForm.qty) || 1),
      p_gross_cents: gross,
      p_discount_cents: Math.round(Number(saleForm.discount || 0) * 100),
      p_fee_cents: Math.round(Number(saleForm.fee || 0) * 100),
      p_payment_method: saleForm.method,
      p_buyer_label: saleForm.buyer.trim() || null,
      p_notes: saleForm.notes.trim() || null,
      p_source: 'manual',
    });
    setBusyId(null);
    if (error) {
      if (error.message.includes('INSUFFICIENT_INVENTORY')) {
        setError('Not enough inventory on that listing — check the quantity.');
      } else setRefused(mapServerError(error));
    } else {
      logWeb('sale_recorded', { method: saleForm.method });
      setSaleOpen(false);
      setSaleForm({ listing: '', qty: '1', amount: '', discount: '', fee: '', method: 'cash', buyer: '', notes: '' });
      await load();
    }
  }

  async function voidTxn(t: Txn) {
    const reason = window.prompt('Void this recorded sale? It stays in your history as voided, and any inventory it used is restored. Reason:', 'entered by mistake');
    if (reason === null) return;
    setBusyId(t.id); setError(null); setRefused(null);
    const { error } = await supabaseBrowser().rpc('void_sale', { p_txn: t.id, p_reason: reason });
    setBusyId(null);
    if (error) setRefused(mapServerError(error)); else await load();
  }

  async function addExpense() {
    if (!market) return;
    const amt = Math.round(Number(expForm.amount) * 100);
    if (!amt || amt <= 0) return setError('Enter the expense amount.');
    setBusyId('expense'); setError(null); setRefused(null);
    const { error } = await supabaseBrowser().from('seller_expenses').insert({
      market_id: market.id, category: expForm.category, amount_cents: amt,
      vendor: expForm.vendor.trim() || null, notes: expForm.notes.trim() || null,
    });
    setBusyId(null);
    if (error) setRefused(mapServerError(error));
    else { logWeb('expense_recorded'); setExpenseOpen(false); setExpForm({ category: 'seeds', amount: '', vendor: '', notes: '' }); await load(); }
  }

  // Presentation-only reordering: writes market_position under the owner's own
  // listing RLS (a foreign listing update simply matches zero rows).
  async function moveListing(l: MyListing, dir: 'up' | 'down' | 'top') {
    const live = (listings ?? []).filter(isLiveGroup);
    const ordered = [...live].sort((a, b) =>
      (a.market_position ?? 1e9) - (b.market_position ?? 1e9)
      || +new Date(b.created_at) - +new Date(a.created_at));
    const idx = ordered.findIndex((x) => x.id === l.id);
    if (idx < 0) return;
    const next = [...ordered];
    next.splice(idx, 1);
    next.splice(dir === 'top' ? 0 : dir === 'up' ? Math.max(0, idx - 1) : Math.min(next.length, idx + 1), 0, l);
    setBusyId(l.id);
    const sb = supabaseBrowser();
    await Promise.all(next.map((x, i) => sb.from('listings').update({ market_position: i + 1 }).eq('id', x.id)));
    setBusyId(null);
    logWeb('market_reordered');
    await load();
  }

  async function toggleFeatured(l: MyListing) {
    const featuredCount = (listings ?? []).filter((x) => x.market_featured).length;
    if (!l.market_featured && featuredCount >= 4) return setError('Up to 4 featured listings — unfeature one first.');
    setBusyId(l.id);
    await supabaseBrowser().from('listings').update({ market_featured: !l.market_featured }).eq('id', l.id);
    setBusyId(null);
    await load();
  }

  function exportLedgerCsv() {
    const rows = txns.map((t) => ({
      date: t.sold_at.slice(0, 10),
      listing: (listings ?? []).find((x) => x.id === t.listing_id)?.title ?? '',
      quantity: t.quantity,
      gross: (t.gross_cents / 100).toFixed(2),
      discount: (t.discount_cents / 100).toFixed(2),
      fee: (t.fee_cents / 100).toFixed(2),
      net: (t.net_cents / 100).toFixed(2),
      payment_method: t.payment_method,
      buyer: t.buyer_label ?? '',
      status: t.status,
      notes: t.notes ?? '',
    }));
    if (rows.length === 0) return;
    const cols = Object.keys(rows[0]);
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => JSON.stringify((r as Record<string, unknown>)[c] ?? '')).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `gnome-sales-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const markSold = (l: MyListing) => setStatus(l, 'completed');
  const remove = (l: MyListing) => setStatus(l, 'removed');
  const relist = (l: MyListing) =>
    setStatus(l, 'active', {
      expires_at: new Date(
        Date.now() +
          (l.listing_type === 'wanted' ? 30 : l.listing_type === 'plot' ? 45 : 7) * 86400_000,
      ).toISOString(),
    });

  if (!ready) return <div className="empty"><p>Loading…</p></div>;
  if (!session) {
    return (
      <SignInCard
        title="Sign in to see your Market"
        blurb="Your storefront: every listing, what sold, and what to relist."
      />
    );
  }
  if (listings === null) return <div className="empty"><p>Loading your Market…</p></div>;

  const activeCount = listings.filter(isLiveGroup).length;
  const heldCount = listings.filter(isHeld).length;
  const soldCount = listings.filter((l) => !isHeld(l) && l.status === 'completed').length;
  const featured = listings.filter(
    (l) => l.is_featured && l.featured_until && new Date(l.featured_until) > new Date(),
  );

  // A market row exists for every account (listings, orders, pickup hours and
  // the ledger all key off market_id), but someone who has never listed
  // anything is a buyer, not a storefront. Show them a way in instead of an
  // empty seller cockpit with "0 live" and a Record-sale button.
  if (listings.length === 0) {
    return (
      <div>
        <div className="mm-head">
          <div>
            <h1>Start selling on Gnome</h1>
            <p className="mm-stats">
              Your Market opens with your first listing — free, and you can name it then.
            </p>
          </div>
          <div className="mm-actions">
            <a className="btn btn-primary btn-sm" href="/sell">+ New listing</a>
          </div>
        </div>
        {error && <p className="autherror">{error}</p>}
        {refused && <ServerErrorNotice error={refused} />}
        <div className="empty">
          <div className="emoji">🌱</div>
          <h2>Nothing posted yet</h2>
          <p>Your first listing takes under a minute — the AI even writes it for you.</p>
          <p><a className="btn btn-primary" href="/sell">Post your first listing</a></p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AllowanceCard />
      <ShareMarketCard />
      <div className="mm-head">
        <div>
          <h1>{market?.name ?? 'My Market'}</h1>
          <p className="mm-stats">
            <strong>{activeCount}</strong> live · <strong>{soldCount}</strong> sold &amp; shared
            {heldCount > 0 && <> · <strong>{heldCount}</strong> under review 🔎</>}
            {featured.length > 0 && <> · <strong>{featured.length}</strong> boosted ✨</>}
            {market?.plan && <> · {planDisplay(market.plan)} plan</>}
          </p>
        </div>
        <div className="mm-actions">
          <a className="btn btn-primary btn-sm" href="/sell">+ New listing</a>
          {market?.slug && (
            <a className="btn btn-secondary btn-sm" href={`/market/${market.slug}`}>Public page</a>
          )}
        </div>
      </div>

      <div className="plan-card">
        <div>
          <strong className="plan-name">{`${planDisplay(market?.plan)} plan`}</strong>
          <span className="plan-usage">
            {ent
              ? ent.max_active_listings == null
                ? `${activeCount} listings · unlimited`
                : `${activeCount}/${ent.max_active_listings} listings`
              : `${activeCount} listings`}
            {ent ? (
              <> · {ent.max_pickup_locations} pickup location{ent.max_pickup_locations === 1 ? '' : 's'} included
              {ent.extra_pickup_locations > 0 ? ` +${ent.extra_pickup_locations} add-on` : ''}
              {` · ${ent.effective_pickup_locations} allowed`}
              {ent.extra_location_fee_cents != null ? ` · extras $${(ent.extra_location_fee_cents / 100).toFixed(0)}/mo each` : ''}</>
            ) : null}
            {' · '}{credits} boost credit{credits === 1 ? '' : 's'} left this month
          </span>
        </div>
        {(market?.plan ?? 'free') === 'free' && (
          <a className="btn btn-primary btn-sm" href="/pricing">Upgrade</a>
        )}
        {(market?.plan ?? 'free') !== 'free' && (
          <a className="btn btn-secondary btn-sm" href="/pricing">Plans</a>
        )}
      </div>

      {checkoutNote && <p className="notice">{checkoutNote}</p>}
      {error && <p className="autherror">{error}</p>}
      {refused && <ServerErrorNotice error={refused} />}
      {heldNow && (
        <HeldForReview reason={heldNow} heading="Saved — but back under review" />
      )}

      {/* ---------------- Seller business dashboard ---------------- */}
      {market && (() => {
        const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
        const done = txns.filter((t) => t.status === 'completed');
        const monthTx = done.filter((t) => new Date(t.sold_at) >= monthStart);
        const gross = monthTx.reduce((s, t) => s + t.net_cents, 0);
        const items = monthTx.reduce((s, t) => s + Number(t.quantity), 0);
        const byMethod = new Map<string, number>();
        monthTx.forEach((t) => byMethod.set(t.payment_method, (byMethod.get(t.payment_method) ?? 0) + t.net_cents));
        const byListing = new Map<string, number>();
        monthTx.forEach((t) => { if (t.listing_id) byListing.set(t.listing_id, (byListing.get(t.listing_id) ?? 0) + t.net_cents); });
        const top = [...byListing.entries()].sort((a, b) => b[1] - a[1])[0];
        const topTitle = top ? listings.find((l) => l.id === top[0])?.title : null;
        const monthExp = expenses.filter((e) => e.status === 'recorded' && new Date(e.spent_at) >= monthStart)
          .reduce((s, e) => s + e.amount_cents, 0);
        return (
          <section className="section" style={{ paddingTop: 8 }}>
            <div className="section-head"><h2>This month</h2></div>
            <div className="dash-cards" style={{ marginBottom: 10 }}>
              <div className="dash-card" style={{ cursor: 'default' }}>
                <span className="dc-value">{money(gross)}</span><span className="dc-label">recorded sales</span>
              </div>
              <div className="dash-card" style={{ cursor: 'default' }}>
                <span className="dc-value">{monthTx.length}</span><span className="dc-label">sales · {items} items</span>
              </div>
              <div className="dash-card" style={{ cursor: 'default' }}>
                <span className="dc-value" style={{ fontSize: 16, lineHeight: 1.3 }}>{topTitle ?? '—'}</span>
                <span className="dc-label">top seller{top ? ` · ${money(top[1])}` : ''}</span>
              </div>
              <div className="dash-card" style={{ cursor: 'default' }}>
                <span className="dc-value" style={{ fontSize: 15, lineHeight: 1.4 }}>
                  {byMethod.size === 0 ? '—'
                    : [...byMethod.entries()].sort((a, b) => b[1] - a[1])
                        .map(([m, c]) => `${PAY_METHODS.find(([k]) => k === m)?.[1] ?? m} ${money(c)}`).join(' · ')}
                </span>
                <span className="dc-label">how you were paid{monthExp > 0 ? ` · expenses ${money(monthExp)}` : ''}</span>
              </div>
            </div>
            <div className="mm-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => { setSaleOpen(!saleOpen); setExpenseOpen(false); setCustomizeOpen(false); setPaymentsOpen(false); setPickupOpen(false); setDeliveryOpen(false); }}>
                💵 Record sale
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setExpenseOpen(!expenseOpen); setSaleOpen(false); setCustomizeOpen(false); setPaymentsOpen(false); setPickupOpen(false); setDeliveryOpen(false); }}>
                Record expense
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setLedgerOpen(!ledgerOpen)}>
                {ledgerOpen ? 'Hide ledger' : `Ledger (${done.length})`}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setPaymentsOpen(!paymentsOpen); setPickupOpen(false); setSaleOpen(false); setExpenseOpen(false); setCustomizeOpen(false); }}>
                💳 Payment methods
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setPickupOpen(!pickupOpen); setDeliveryOpen(false); setPaymentsOpen(false); setSaleOpen(false); setExpenseOpen(false); setCustomizeOpen(false); }}>
                🕐 Pickup times
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setDeliveryOpen(!deliveryOpen); setPickupOpen(false); setPaymentsOpen(false); setSaleOpen(false); setExpenseOpen(false); setCustomizeOpen(false); }}>
                🚚 Delivery
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setCustomizeOpen(!customizeOpen); setSaleOpen(false); setExpenseOpen(false); setPaymentsOpen(false); setPickupOpen(false); setDeliveryOpen(false); }}>
                🎨 Customize Market
              </button>
            </div>

            {saleOpen && (
              <div className="preview-note" style={{ marginTop: 12 }}>
                <strong>Record a sale</strong>
                <div className="field-row" style={{ marginTop: 8 }}>
                  <div className="field"><label>Listing (optional)</label>
                    <select value={saleForm.listing} onChange={(e) => setSaleForm({ ...saleForm, listing: e.target.value })}>
                      <option value="">Quick sale — no listing</option>
                      {listings.filter(isLiveGroup).map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title}{l.inventory_count != null ? ` (${l.inventory_count} left)` : ''}
                        </option>
                      ))}
                    </select></div>
                  <div className="field" style={{ maxWidth: 90 }}><label>Qty</label>
                    <input inputMode="numeric" value={saleForm.qty} onChange={(e) => setSaleForm({ ...saleForm, qty: e.target.value.replace(/[^0-9]/g, '') })} /></div>
                  <div className="field" style={{ maxWidth: 120 }}><label>Amount $</label>
                    <input inputMode="decimal" placeholder="12.00" value={saleForm.amount} onChange={(e) => setSaleForm({ ...saleForm, amount: e.target.value.replace(/[^0-9.]/g, '') })} /></div>
                </div>
                <div className="field" style={{ marginTop: 8 }}>
                  <label>How were you paid?</label>
                  <div className="chiprow">
                    {PAY_METHODS.map(([v, l]) => (
                      <button key={v} type="button" className={`chip${saleForm.method === v ? ' active' : ''}`}
                        onClick={() => setSaleForm({ ...saleForm, method: v })}>{l}</button>
                    ))}
                  </div>
                </div>
                <div className="field-row" style={{ marginTop: 8 }}>
                  <div className="field"><label>Buyer (optional)</label>
                    <input placeholder="Walk-up, Sarah from the app…" value={saleForm.buyer} onChange={(e) => setSaleForm({ ...saleForm, buyer: e.target.value })} /></div>
                  <div className="field" style={{ maxWidth: 110 }}><label>Discount $</label>
                    <input inputMode="decimal" value={saleForm.discount} onChange={(e) => setSaleForm({ ...saleForm, discount: e.target.value.replace(/[^0-9.]/g, '') })} /></div>
                  <div className="field" style={{ maxWidth: 110 }}><label>Fee $</label>
                    <input inputMode="decimal" value={saleForm.fee} onChange={(e) => setSaleForm({ ...saleForm, fee: e.target.value.replace(/[^0-9.]/g, '') })} /></div>
                </div>
                <div className="field" style={{ marginTop: 8 }}><label>Notes (private)</label>
                  <input value={saleForm.notes} onChange={(e) => setSaleForm({ ...saleForm, notes: e.target.value })} /></div>
                <p className="authhint" style={{ margin: '8px 0 0' }}>
                  Gnome is recording this sale for your records — payment was handled
                  {saleForm.method === 'gnome' ? ' by Gnome' : ' outside Gnome'}.
                </p>
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button className="btn btn-primary btn-sm" disabled={busyId === 'sale'} onClick={() => void recordSale()}>
                    {busyId === 'sale' ? 'Saving…' : 'Save sale'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setSaleOpen(false)}>Cancel</button>
                </div>
              </div>
            )}

            {expenseOpen && (
              <div className="preview-note" style={{ marginTop: 12 }}>
                <strong>Record an expense</strong>
                <div className="field-row" style={{ marginTop: 8 }}>
                  <div className="field"><label>Category</label>
                    <select value={expForm.category} onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}>
                      {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                    </select></div>
                  <div className="field" style={{ maxWidth: 120 }}><label>Amount $</label>
                    <input inputMode="decimal" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value.replace(/[^0-9.]/g, '') })} /></div>
                  <div className="field"><label>Vendor (optional)</label>
                    <input value={expForm.vendor} onChange={(e) => setExpForm({ ...expForm, vendor: e.target.value })} /></div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button className="btn btn-primary btn-sm" disabled={busyId === 'expense'} onClick={() => void addExpense()}>Save expense</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setExpenseOpen(false)}>Cancel</button>
                </div>
              </div>
            )}

            {customizeOpen && (
              <div className="preview-note" style={{ marginTop: 12 }}>
                <strong>Customize your Market</strong>
                <div className="field" style={{ marginTop: 8 }}><label>Market name</label>
                  <input maxLength={60} value={custForm.name} placeholder="Marinelli Backyard Market" onChange={(e) => setCustForm({ ...custForm, name: e.target.value })} /></div>
                <div className="field" style={{ marginTop: 8 }}><label>Tagline (shows under your name)</label>
                  <input maxLength={120} value={custForm.tagline} placeholder="Backyard vegetables, herbs, and homemade dog treats." onChange={(e) => setCustForm({ ...custForm, tagline: e.target.value })} /></div>
                <div className="field" style={{ marginTop: 8 }}><label>About your Market</label>
                  <textarea rows={3} value={custForm.description} onChange={(e) => setCustForm({ ...custForm, description: e.target.value })} /></div>
                <div className="field" style={{ marginTop: 8 }}>
                  <label>Theme</label>
                  <div className="chiprow">
                    {THEMES.map((t) => (
                      <button key={t} type="button" className={`chip${custForm.theme === t ? ' active' : ''}`}
                        onClick={() => setCustForm({ ...custForm, theme: t })}>{t.replace('_', ' ')}</button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary btn-sm" disabled={busyId === 'customize'} onClick={() => void saveCustomize()}>Save</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setCustomizeOpen(false)}>Cancel</button>
                  {market.slug && <a className="btn btn-secondary btn-sm" href={`/market/${market.slug}`}>Preview public page</a>}
                </div>
              </div>
            )}

            {paymentsOpen && <PaymentMethodsEditor marketId={market.id} />}
            {pickupOpen && <PickupAvailabilityEditor marketId={market.id} />}
            {deliveryOpen && <DeliverySettingsEditor marketId={market.id} plan={market.plan ?? 'free'} />}

            {ledgerOpen && (
              <div className="preview-note" style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>Sales ledger</strong>
                  <button className="mm-btn" onClick={exportLedgerCsv}>⬇ Export CSV</button>
                </div>
                {txns.length === 0 && <p className="authhint">No sales recorded yet — tap “Record sale” after your next exchange.</p>}
                {txns.map((t) => (
                  <div key={t.id} className="lot-row">
                    <span style={{ textDecoration: t.status === 'void' ? 'line-through' : 'none' }}>
                      {t.sold_at.slice(0, 10)} · {listings.find((l) => l.id === t.listing_id)?.title ?? 'Quick sale'}
                      {' · '}×{t.quantity} · {money(t.net_cents)} · {PAY_METHODS.find(([k]) => k === t.payment_method)?.[1] ?? t.payment_method}
                      {t.buyer_label ? ` · ${t.buyer_label}` : ''}
                    </span>
                    {t.status === 'void' && <span className="tag">void</span>}
                    {t.status === 'completed' && (
                      <span className="lot-actions">
                        <button className="mm-btn danger" disabled={busyId === t.id} onClick={() => void voidTxn(t)}>Void</button>
                      </span>
                    )}
                  </div>
                ))}
                <p className="authhint" style={{ marginTop: 8 }}>
                  Recorded sales are for your own tracking and may not represent complete
                  tax or accounting records.
                </p>
              </div>
            )}
          </section>
        );
      })()}

      {market && <PickupOrdersManager marketId={market.id} />}

      {reservations.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Plot reservations <span className="mm-count">{reservations.length}</span></h2>
          </div>
          <p className="sub">
            Neighbors asking to reserve a plot. Approve one and that plot comes off
            the marketplace; other requests on it decline automatically. Payment is
            arranged directly — details and updates in the app chat.
          </p>
          <div className="mm-list">
            {reservations.map((r) => {
              const plot = listings.find((l) => l.id === r.listing_id);
              const who = r.claimer?.name || 'A neighbor';
              const chatable = r.status === 'approved' || r.status === 'completed';
              return (
                <div key={r.id}>
                  <div className="mm-row">
                    <div className="mm-thumb"><span>🧑‍🌾</span></div>
                    <div className="mm-info">
                      <span className="mm-title">
                        {who} · {plot?.title ?? 'your plot'}
                        {r.agreed_price_cents != null && r.agreed_price_cents > 0
                          ? ` · ${formatPrice(r.agreed_price_cents)}`
                          : ''}
                      </span>
                      <div className="mm-meta">
                        {r.status === 'pending' && <span className="tag type-wanted">New request</span>}
                        {r.status === 'approved' && <span className="tag type-free">Reserved ✓</span>}
                        {r.status === 'completed' && <span className="tag type-free">Season complete</span>}
                        {(r.status === 'declined' || r.status === 'cancelled') && (
                          <span className="tag">{r.status === 'declined' ? 'Declined' : 'Cancelled'}</span>
                        )}
                        {r.buyer_note && <span className="mm-expiry">“{r.buyer_note}”</span>}
                      </div>
                    </div>
                    <div className="mm-btns">
                      {r.status === 'pending' && (
                        <>
                          <button className="mm-btn" disabled={busyId === r.id} onClick={() => void setReservation(r, 'approved')}>
                            Approve
                          </button>
                          <button className="mm-btn danger" disabled={busyId === r.id} onClick={() => void setReservation(r, 'declined')}>
                            Decline
                          </button>
                        </>
                      )}
                      {chatable && (
                        <button
                          className="mm-btn"
                          onClick={() => setOpenThread(openThread === r.id ? null : r.id)}
                        >
                          {openThread === r.id ? 'Close' : '🌱 Updates & chat'}
                        </button>
                      )}
                    </div>
                  </div>
                  {openThread === r.id && chatable && (
                    <PlotThread claimId={r.id} isGrower readOnly={r.status === 'completed'} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {seedOrders.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Your Seed Drop <span className="mm-count">{seedOrders.length}</span></h2>
          </div>
          <p className="sub">
            Built for your garden from live inventory. Tap the gnome any time for
            help with the exact seeds you received.
          </p>
          <div className="mm-list">
            {seedOrders.map((o) => (
              <div key={o.id} className="mm-row">
                <div className="mm-thumb"><span>📦</span></div>
                <div className="mm-info">
                  <span className="mm-title">
                    Starter Drop · {new Date(o.created_at).toLocaleDateString()}
                  </span>
                  <div className="mm-meta">
                    {o.status === 'paid' && <span className="tag type-wanted">Building your box…</span>}
                    {o.status === 'selected' && <span className="tag type-free">Seeds picked — packing soon</span>}
                    {o.status === 'needs_review' && <span className="tag type-wanted">Being reviewed by a human 🌱</span>}
                    {o.status === 'packed' && <span className="tag type-free">Packed</span>}
                    {o.status === 'shipped' && <span className="tag type-free">Shipped{o.tracking ? ` · ${o.tracking}` : ''}</span>}
                    {(o.status === 'cancelled' || o.status === 'refunded') && <span className="tag">{o.status}</span>}
                  </div>
                  {o.items.filter((i) => i.status !== 'released').length > 0 && (
                    <div className="mm-meta" style={{ marginTop: 4 }}>
                      {o.items.filter((i) => i.status !== 'released').map((i) => (
                        <span key={i.id} className="tag type-free">
                          {i.product ? `${i.product.crop} · ${i.product.variety}` : 'Seed packet'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {myReservations.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Plots you’ve reserved <span className="mm-count">{myReservations.length}</span></h2>
          </div>
          <p className="sub">
            Your grower posts growth updates here, and you can message them any time.
          </p>
          <div className="mm-list">
            {myReservations.map((r) => {
              const chatable = r.status === 'approved' || r.status === 'completed';
              const key = `mine-${r.id}`;
              return (
                <div key={r.id}>
                  <div className="mm-row">
                    <div className="mm-thumb"><span>🌱</span></div>
                    <div className="mm-info">
                      <span className="mm-title">
                        {r.listing?.title ?? 'A plot'}
                        {r.agreed_price_cents != null && r.agreed_price_cents > 0
                          ? ` · ${formatPrice(r.agreed_price_cents)}`
                          : ''}
                      </span>
                      <div className="mm-meta">
                        {r.status === 'pending' && <span className="tag type-wanted">Awaiting grower</span>}
                        {r.status === 'approved' && <span className="tag type-free">Reserved — growing for you</span>}
                        {r.status === 'completed' && <span className="tag type-free">Season complete</span>}
                        {(r.status === 'declined' || r.status === 'cancelled') && (
                          <span className="tag">{r.status === 'declined' ? 'Declined' : 'Cancelled'}</span>
                        )}
                        {r.buyer_note && <span className="mm-expiry">“{r.buyer_note}”</span>}
                      </div>
                    </div>
                    <div className="mm-btns">
                      {r.status === 'pending' && (
                        <button
                          className="mm-btn danger"
                          disabled={busyId === r.id}
                          onClick={async () => {
                            setBusyId(r.id);
                            await supabaseBrowser().from('claims').update({ status: 'cancelled' }).eq('id', r.id);
                            setBusyId(null);
                            await load();
                          }}
                        >
                          Cancel request
                        </button>
                      )}
                      {chatable && (
                        <button className="mm-btn" onClick={() => setOpenThread(openThread === key ? null : key)}>
                          {openThread === key ? 'Close' : '🌱 Updates & chat'}
                        </button>
                      )}
                    </div>
                  </div>
                  {openThread === key && chatable && (
                    <PlotThread claimId={r.id} isGrower={false} readOnly={r.status === 'completed'} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {listings.length === 0 && (
        <div className="empty">
          <div className="emoji">🌱</div>
          <h2>Nothing posted yet</h2>
          <p>Your first listing takes under a minute — the AI even writes it for you.</p>
          <p><a className="btn btn-primary" href="/sell">Post your first listing</a></p>
        </div>
      )}

      {GROUPS.map((g) => {
        const rows = listings.filter(g.match).sort((a, b) =>
          g.key === 'live'
            ? (a.market_position ?? 1e9) - (b.market_position ?? 1e9)
              || +new Date(b.created_at) - +new Date(a.created_at)
            : +new Date(b.created_at) - +new Date(a.created_at));
        if (rows.length === 0) return null;
        return (
          <section key={g.key} className="section">
            <div className="section-head">
              <h2>{g.title} <span className="mm-count">{rows.length}</span></h2>
            </div>
            <p className="sub">{g.blurb}</p>
            <div className="mm-list">
              {rows.map((l) => {
                const cat = categoryFor(l.category);
                const boosted =
                  l.is_featured && l.featured_until && new Date(l.featured_until) > new Date();
                const live = g.key === 'live';
                const held = g.key === 'review';
                return (
                  <div key={l.id}>
                  <div className="mm-row">
                    <div className="mm-thumb">
                      {l.photos?.[0]
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={l.photos[0]} alt="" />
                        : <span>{cat.emoji}</span>}
                    </div>
                    <div className="mm-info">
                      {held
                        ? <span className="mm-title">{l.title}</span>
                        : <a className="mm-title" href={listingPath(l.id, l.title)}>{l.title}</a>}
                      <div className="mm-meta">
                        <span className={`tag type-${l.listing_type}`}>
                          {l.listing_type === 'sale' && l.price_cents
                            ? formatPrice(l.price_cents, l.unit)
                            : TYPE_LABEL[l.listing_type]}
                        </span>
                        {held && <span className="tag review">🔎 Under review</span>}
                        {boosted && !held && <span className="tag featured">✨ Boosted</span>}
                        {l.status === 'claimed' && (
                          <span className="tag type-trade">
                            {l.listing_type === 'plot' ? 'Reserved — growing' : 'Claimed — pending pickup'}
                          </span>
                        )}
                        {live && l.status === 'active' && <span className="mm-expiry">{timeLeft(l.expires_at)}</span>}
                      </div>
                    </div>
                    <div className="mm-btns">
                      {live && (
                        <>
                          <button className="mm-btn" title="Move up" disabled={busyId === l.id} onClick={() => void moveListing(l, 'up')}>↑</button>
                          <button className="mm-btn" title="Move down" disabled={busyId === l.id} onClick={() => void moveListing(l, 'down')}>↓</button>
                          <button className="mm-btn" title="Move to top" disabled={busyId === l.id} onClick={() => void moveListing(l, 'top')}>⤒</button>
                          <button
                            className="mm-btn"
                            title={l.market_featured ? 'Remove from your featured section' : 'Feature in your Market (max 4)'}
                            disabled={busyId === l.id}
                            onClick={() => void toggleFeatured(l)}
                          >
                            {l.market_featured ? '★' : '☆'}
                          </button>
                          {!boosted && l.status === 'active' && credits > 0 && (
                            <button className="mm-btn" disabled={busyId === l.id} onClick={() => void boost(l)}>
                              ✨ Boost
                            </button>
                          )}
                          {!boosted && l.status === 'active' && credits === 0 && (
                            <button
                              className="mm-btn"
                              disabled={busyId === l.id}
                              onClick={() => void buyBoost(l)}
                            >
                              ✨ Boost this listing
                            </button>
                          )}
                          <button className="mm-btn" disabled={busyId === l.id} onClick={() => void markSold(l)}>
                            Mark sold
                          </button>
                          <button className="mm-btn danger" disabled={busyId === l.id} onClick={() => void remove(l)}>
                            Remove
                          </button>
                        </>
                      )}
                      {g.key === 'unsold' && (
                        <button className="mm-btn" disabled={busyId === l.id} onClick={() => void relist(l)}>
                          Relist
                        </button>
                      )}
                      {held && (
                        <button className="mm-btn danger" disabled={busyId === l.id} onClick={() => void remove(l)}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  {held && (
                    <div className="notice-inline">
                      {/* The server's own words. screening_term / screening_category
                          are internal keyword matches and never shown. */}
                      <p style={{ margin: 0 }}>{reviewReason(l)}</p>
                      <p style={{ margin: '6px 0 0' }}>
                        A person at Gnome decides this one — you’ll be notified, and it
                        stays saved in the meantime. Documentation can help:{' '}
                        <AppLink kind="compliance" label="open the Credential Center" plain />.
                        See <a href={RULES_HREF}>what Gnome allows</a>, or{' '}
                        <a href={`mailto:${SUPPORT_EMAIL}`}>ask us about it</a>.
                      </p>
                    </div>
                  )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="authhint" style={{ marginTop: 24 }}>
        Editing details and pickup chat live in the Gnome app for now.{' '}
        Want more reach? <a href="/pricing">See plans &amp; boosts</a>.
      </p>
    </div>
  );
}
