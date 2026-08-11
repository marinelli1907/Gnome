'use client';

// Seller-side pickup order manager. Reads market_orders (RLS: parties only);
// EVERY write goes through the lifecycle RPCs — confirm/propose/decline/
// ready/complete — never direct table writes, so inventory holds and the
// event log stay correct. Completing with payment recorded writes the Sales
// Notebook ledger automatically (idempotent server-side).
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';

type OrderStatus =
  | 'REQUESTED' | 'CONFIRMED' | 'TIME_PROPOSED' | 'DECLINED'
  | 'READY' | 'COMPLETED' | 'CANCELLED';

interface OrderItem {
  id: string; title: string; unit: string | null; quantity: number;
  unit_price_cents: number; item_total_cents: number;
}
interface PickupOrder {
  id: string; status: OrderStatus;
  requested_start: string; requested_end: string;
  confirmed_start: string | null; confirmed_end: string | null;
  proposed_start: string | null; proposed_end: string | null;
  timezone: string; subtotal_cents: number;
  fulfillment_type?: 'pickup' | 'delivery';
  delivery_fee_cents?: number | null;
  delivery_distance_miles?: number | null;
  buyer_note: string | null; decline_reason: string | null; created_at: string;
  items: OrderItem[];
  buyer: { name: string | null } | null;
}
interface OrderEvent {
  actor_role: string; old_status: string | null; new_status: string;
  reason: string | null; created_at: string;
}
interface Slot { slot_start: string; slot_end: string; remaining: number | null; }

const STATUS_ORDER: OrderStatus[] =
  ['REQUESTED', 'TIME_PROPOSED', 'CONFIRMED', 'READY', 'COMPLETED', 'DECLINED', 'CANCELLED'];
const STATUS_META: Record<OrderStatus, { label: string; tag: string }> = {
  REQUESTED: { label: 'New request', tag: 'tag type-wanted' },
  TIME_PROPOSED: { label: 'Time proposed', tag: 'tag type-trade' },
  CONFIRMED: { label: 'Confirmed', tag: 'tag type-free' },
  READY: { label: 'Ready for pickup', tag: 'tag type-free' },
  COMPLETED: { label: 'Completed', tag: 'tag type-free' },
  DECLINED: { label: 'Declined', tag: 'tag' },
  CANCELLED: { label: 'Cancelled', tag: 'tag' },
};
const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', venmo: 'Venmo', paypal: 'PayPal', cashapp: 'Cash App',
  zelle: 'Zelle', check: 'Check', other: 'Other',
};
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

function fmtStamp(iso: string, tz: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Date(iso).toLocaleString('en-US', { ...opts, timeZone: tz || 'America/New_York' });
  } catch {
    return new Date(iso).toLocaleString('en-US', opts);
  }
}
function fmtWindow(start: string | null, end: string | null, tz: string): string {
  if (!start) return 'No time set';
  const s = fmtStamp(start, tz, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const e = end ? fmtStamp(end, tz, { hour: 'numeric', minute: '2-digit' }) : '';
  return e ? `${s} – ${e}` : s;
}
// Map RPC errors to friendly copy; everything else is surfaced as-is.
function friendlyError(msg: string): string {
  if (msg.includes('INSUFFICIENT_INVENTORY')) {
    const item = /INSUFFICIENT_INVENTORY:?\s*(.+)/.exec(msg)?.[1]?.trim();
    return item
      ? `Not enough inventory to confirm — “${item}” is short. Restock that listing or decline the order.`
      : 'Not enough inventory to confirm this order — restock the listing or decline.';
  }
  return msg;
}

export default function PickupOrdersManager({ marketId }: { marketId: string }) {
  const [orders, setOrders] = useState<PickupOrder[] | null>(null);
  const [enabledMethods, setEnabledMethods] = useState<string[]>(['cash']);
  const [events, setEvents] = useState<Record<string, OrderEvent[]>>({});
  const [filter, setFilter] = useState<'all' | OrderStatus>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [proposeFor, setProposeFor] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotChoice, setSlotChoice] = useState('');
  const [completeFor, setCompleteFor] = useState<string | null>(null);
  const [payForm, setPayForm] = useState({ received: true, method: 'cash', amount: '' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [{ data: os, error: oerr }, { data: pm }] = await Promise.all([
      sb.from('market_orders')
        .select('id,status,requested_start,requested_end,confirmed_start,confirmed_end,proposed_start,proposed_end,timezone,subtotal_cents,buyer_note,decline_reason,created_at,fulfillment_type,delivery_fee_cents,delivery_distance_miles,items:market_order_items(*),buyer:profiles!market_orders_buyer_id_fkey(name)')
        .eq('market_id', marketId)
        .order('created_at', { ascending: false }),
      sb.from('market_payment_methods')
        .select('method').eq('market_id', marketId).eq('enabled', true),
    ]);
    if (oerr) setError(oerr.message);
    setOrders((os as unknown as PickupOrder[]) ?? []);
    const methods = ((pm as { method: string }[] | null) ?? []).map((r) => r.method);
    setEnabledMethods(methods.includes('cash') ? methods : ['cash', ...methods]);
  }, [marketId]);

  useEffect(() => { void load(); }, [load]);

  const loadEvents = useCallback(async (orderId: string) => {
    const { data } = await supabaseBrowser()
      .from('market_order_events')
      .select('actor_role,old_status,new_status,reason,created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });
    setEvents((ev) => ({ ...ev, [orderId]: ((data as unknown as OrderEvent[]) ?? []) }));
  }, []);

  function toggleExpand(id: string) {
    setProposeFor(null); setCompleteFor(null);
    if (expanded === id) {
      setExpanded(null);
    } else {
      setExpanded(id);
      void loadEvents(id);
    }
  }

  async function runAction(
    id: string,
    fn: () => PromiseLike<{ error: { message: string } | null }>,
  ): Promise<boolean> {
    setBusyId(id); setError(null);
    const { error: err } = await fn();
    setBusyId(null);
    if (err) { setError(friendlyError(err.message)); return false; }
    await load();
    if (expanded) void loadEvents(expanded);
    return true;
  }

  const confirmOrder = (o: PickupOrder) =>
    runAction(o.id, () => supabaseBrowser().rpc('confirm_market_order', { p_order: o.id }));

  const markReady = (o: PickupOrder) =>
    runAction(o.id, () => supabaseBrowser().rpc('mark_order_ready', { p_order: o.id }));

  async function openPropose(o: PickupOrder) {
    setProposeFor(o.id); setCompleteFor(null); setSlots(null); setSlotChoice(''); setError(null);
    const { data, error: err } = await supabaseBrowser()
      .rpc('market_available_slots', { p_market: marketId, p_days: 14 });
    if (err) { setError(err.message); setSlots([]); return; }
    const open = ((data as Slot[] | null) ?? []).filter((s) => s.remaining === null || s.remaining > 0);
    setSlots(open);
    if (open.length > 0) setSlotChoice(open[0].slot_start);
  }

  async function propose(o: PickupOrder) {
    const slot = (slots ?? []).find((s) => s.slot_start === slotChoice);
    if (!slot) return setError('Pick a time slot first.');
    const ok = await runAction(o.id, () => supabaseBrowser()
      .rpc('propose_order_time', { p_order: o.id, p_start: slot.slot_start, p_end: slot.slot_end }));
    if (ok) { setProposeFor(null); setSlots(null); }
  }

  async function decline(o: PickupOrder) {
    const reason = window.prompt('Decline this pickup request? The buyer will see your reason:', '');
    if (reason === null) return;
    if (!reason.trim()) return setError('A reason is required to decline.');
    await runAction(o.id, () => supabaseBrowser()
      .rpc('decline_market_order', { p_order: o.id, p_reason: reason.trim() }));
  }

  function openComplete(o: PickupOrder) {
    setCompleteFor(o.id); setProposeFor(null); setError(null);
    setPayForm({
      received: true,
      method: enabledMethods[0] ?? 'cash',
      amount: (o.subtotal_cents / 100).toFixed(2),
    });
  }

  async function complete(o: PickupOrder) {
    if (!payForm.received) {
      const ok = await runAction(o.id, () => supabaseBrowser()
        .rpc('complete_market_order', { p_order: o.id, p_record_payment: false }));
      if (ok) setCompleteFor(null);
      return;
    }
    const cents = Math.round(Number(payForm.amount) * 100);
    if (!cents || cents <= 0) return setError('Enter the amount you received.');
    const ok = await runAction(o.id, () => supabaseBrowser().rpc('complete_market_order', {
      p_order: o.id, p_record_payment: true, p_method: payForm.method, p_amount_cents: cents,
    }));
    if (ok) setCompleteFor(null);
  }

  if (orders === null || orders.length === 0) return null;

  const counts = orders.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});
  const filtered = filter === 'all' ? orders : orders.filter((o) => o.status === filter);

  return (
    <section className="section">
      <div className="section-head">
        <h2>Orders <span className="mm-count">{orders.length}</span></h2>
      </div>
      <p className="sub">
        Buyers request a pickup window from your public page. Confirm, propose a
        different time, or decline — then mark it ready and complete it at handoff.
      </p>
      {error && <p className="autherror">{error}</p>}

      <div className="chiprow" style={{ marginBottom: 12 }}>
        <button type="button" className={`chip${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
          All ({orders.length})
        </button>
        {STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0).map((s) => (
          <button key={s} type="button" className={`chip${filter === s ? ' active' : ''}`} onClick={() => setFilter(s)}>
            {STATUS_META[s].label} ({counts[s]})
          </button>
        ))}
      </div>

      <div className="mm-list">
        {filtered.map((o) => {
          const who = o.buyer?.name || 'A neighbor';
          const [winStart, winEnd] = o.confirmed_start
            ? [o.confirmed_start, o.confirmed_end]
            : o.status === 'TIME_PROPOSED'
              ? [o.proposed_start, o.proposed_end]
              : [o.requested_start, o.requested_end];
          const winLabel = o.confirmed_start ? 'Pickup' : o.status === 'TIME_PROPOSED' ? 'You proposed' : 'Requested';
          const isOpen = expanded === o.id;
          const itemCount = o.items.reduce((s, i) => s + Number(i.quantity), 0);
          return (
            <div key={o.id}>
              <div className="mm-row">
                <div className="mm-thumb"><span>🧺</span></div>
                <div className="mm-info">
                  <span className="mm-title">
                    {who} · {itemCount} item{itemCount === 1 ? '' : 's'} · {money(o.subtotal_cents + (o.delivery_fee_cents ?? 0))}
                    {o.fulfillment_type === 'delivery'
                      ? ` · 🚚 Delivery${o.delivery_distance_miles != null ? ` ${o.delivery_distance_miles} mi` : ''}${o.delivery_fee_cents ? ` (${money(o.delivery_fee_cents)} fee)` : ''}`
                      : ''}
                  </span>
                  <div className="mm-meta">
                    <span className={STATUS_META[o.status].tag}>{STATUS_META[o.status].label}</span>
                    <span className="mm-expiry">{winLabel}: {fmtWindow(winStart, winEnd, o.timezone)}</span>
                  </div>
                </div>
                <div className="mm-btns">
                  <button className="mm-btn" onClick={() => toggleExpand(o.id)}>
                    {isOpen ? 'Close' : 'Details'}
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="preview-note" style={{ marginTop: 6 }}>
                  {o.items.map((i) => (
                    <div key={i.id} className="lot-row">
                      <span>
                        {Number(i.quantity)} × {i.title}{i.unit ? ` (${i.unit})` : ''}
                        {' · '}{money(i.unit_price_cents)} each
                      </span>
                      <span className="lot-actions">{money(i.item_total_cents)}</span>
                    </div>
                  ))}
                  <div className="lot-row">
                    <span style={{ fontWeight: 700 }}>Subtotal</span>
                    <span className="lot-actions" style={{ fontWeight: 700 }}>{money(o.subtotal_cents + (o.delivery_fee_cents ?? 0))}</span>
                  </div>
                  {o.buyer_note && (
                    <p className="authhint" style={{ marginTop: 8 }}>Buyer note: “{o.buyer_note}”</p>
                  )}
                  {(o.status === 'DECLINED' || o.status === 'CANCELLED') && o.decline_reason && (
                    <p className="authhint" style={{ marginTop: 8 }}>Reason: {o.decline_reason}</p>
                  )}

                  {o.status === 'REQUESTED' && (
                    <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                      <button className="btn btn-primary btn-sm" disabled={busyId === o.id} onClick={() => void confirmOrder(o)}>
                        {busyId === o.id ? 'Working…' : 'Confirm'}
                      </button>
                      <button className="btn btn-secondary btn-sm" disabled={busyId === o.id} onClick={() => void openPropose(o)}>
                        Propose different time
                      </button>
                      <button className="btn btn-secondary btn-sm" disabled={busyId === o.id} onClick={() => void decline(o)}>
                        Decline
                      </button>
                    </div>
                  )}
                  {o.status === 'CONFIRMED' && (
                    <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                      <button className="btn btn-primary btn-sm" disabled={busyId === o.id} onClick={() => void markReady(o)}>
                        {busyId === o.id ? 'Working…' : 'Mark ready'}
                      </button>
                      <button className="btn btn-secondary btn-sm" disabled={busyId === o.id} onClick={() => openComplete(o)}>
                        Complete
                      </button>
                    </div>
                  )}
                  {o.status === 'READY' && (
                    <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                      <button className="btn btn-primary btn-sm" disabled={busyId === o.id} onClick={() => openComplete(o)}>
                        Complete
                      </button>
                    </div>
                  )}
                  {o.status === 'TIME_PROPOSED' && (
                    <p className="authhint" style={{ marginTop: 10 }}>
                      Waiting on the buyer to accept or decline your proposed time.
                    </p>
                  )}

                  {proposeFor === o.id && (
                    <div style={{ marginTop: 10 }}>
                      <div className="field">
                        <label>Pick a new window (from your open slots)</label>
                        {slots === null && <p className="authhint">Loading open slots…</p>}
                        {slots !== null && slots.length === 0 && (
                          <p className="authhint">
                            No open slots in the next 14 days — add pickup windows first.
                          </p>
                        )}
                        {slots !== null && slots.length > 0 && (
                          <select value={slotChoice} onChange={(e) => setSlotChoice(e.target.value)}>
                            {slots.map((s) => (
                              <option key={s.slot_start} value={s.slot_start}>
                                {fmtWindow(s.slot_start, s.slot_end, o.timezone)}
                                {s.remaining != null ? ` · ${s.remaining} left` : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={busyId === o.id || !slotChoice}
                          onClick={() => void propose(o)}
                        >
                          Send proposal
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setProposeFor(null); setSlots(null); }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {completeFor === o.id && (o.status === 'CONFIRMED' || o.status === 'READY') && (
                    <div style={{ marginTop: 10 }}>
                      <div className="field">
                        <label>Was payment received?</label>
                        <div className="chiprow">
                          <button
                            type="button" className={`chip${payForm.received ? ' active' : ''}`}
                            onClick={() => setPayForm({ ...payForm, received: true })}
                          >
                            Yes — record it
                          </button>
                          <button
                            type="button" className={`chip${!payForm.received ? ' active' : ''}`}
                            onClick={() => setPayForm({ ...payForm, received: false })}
                          >
                            No — just complete
                          </button>
                        </div>
                      </div>
                      {payForm.received && (
                        <div className="field-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                          <div className="field">
                            <label>How were you paid?</label>
                            <div className="chiprow">
                              {enabledMethods.map((m) => (
                                <button
                                  key={m} type="button"
                                  className={`chip${payForm.method === m ? ' active' : ''}`}
                                  onClick={() => setPayForm({ ...payForm, method: m })}
                                >
                                  {METHOD_LABEL[m] ?? m}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="field" style={{ maxWidth: 120 }}>
                            <label>Amount $</label>
                            <input
                              inputMode="decimal" value={payForm.amount}
                              onChange={(e) => setPayForm({ ...payForm, amount: e.target.value.replace(/[^0-9.]/g, '') })}
                            />
                          </div>
                        </div>
                      )}
                      <p className="authhint" style={{ margin: '8px 0 0' }}>
                        {payForm.received
                          ? 'Recording payment adds this sale to your Sales Notebook ledger automatically.'
                          : 'The order completes without a ledger entry — you can still record the sale manually later.'}
                      </p>
                      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                        <button className="btn btn-primary btn-sm" disabled={busyId === o.id} onClick={() => void complete(o)}>
                          {busyId === o.id ? 'Working…' : 'Complete order'}
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setCompleteFor(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {(events[o.id]?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <strong style={{ fontSize: 13 }}>History</strong>
                      {events[o.id].map((ev, i) => (
                        <p key={i} className="authhint" style={{ margin: '4px 0 0' }}>
                          {fmtStamp(ev.created_at, o.timezone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          {' · '}{ev.actor_role}
                          {ev.old_status ? ` · ${ev.old_status} → ` : ' · '}{ev.new_status}
                          {ev.reason ? ` — ${ev.reason}` : ''}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
