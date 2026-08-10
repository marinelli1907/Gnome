'use client';

// Seller-side pickup availability. The public shape (timezone, slot size,
// lead time, weekly windows, exceptions) drives market_available_slots for
// buyers; the private address/instructions live in an owner-only table
// (market_pickup_private) and are released per-order after confirmation.
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';

const TIMEZONES = [
  ['America/New_York', 'Eastern (New York)'],
  ['America/Chicago', 'Central (Chicago)'],
  ['America/Denver', 'Mountain (Denver)'],
  ['America/Phoenix', 'Arizona (Phoenix)'],
  ['America/Los_Angeles', 'Pacific (Los Angeles)'],
] as const;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LEAD_TIMES = [
  [0, 'No lead time'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'],
  [240, '4 hours'], [720, '12 hours'], [1440, '1 day'], [2880, '2 days'],
] as const;
const LOCATION_TYPES = [
  ['PRIVATE_RESIDENCE', 'Private residence — address shared only after you confirm'],
  ['PUBLIC_BUSINESS', 'Public business / farm stand — address shown publicly'],
  ['CUSTOM_PICKUP_POINT', 'Custom pickup point — details shared only after you confirm'],
] as const;

interface SettingsForm {
  timezone: string; slot_minutes: string; lead_time_minutes: string;
  max_per_slot: string; location_type: string; public_address: string;
}
interface HourRow { id: string; weekday: number; start_minute: number; end_minute: number; }
interface ExceptionRow {
  id: string; date: string; closed: boolean;
  start_minute: number | null; end_minute: number | null; note: string | null;
}

const toMinutes = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const fmtMinute = (min: number) => {
  const h = Math.floor(min / 60); const mm = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${h >= 12 && h < 24 ? 'PM' : 'AM'}`;
};

export default function PickupAvailabilityEditor({ marketId }: { marketId: string }) {
  const [settings, setSettings] = useState<SettingsForm | null>(null);
  const [priv, setPriv] = useState({ pickup_address: '', pickup_instructions: '', instructions_public: false });
  const [hours, setHours] = useState<HourRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [newWin, setNewWin] = useState(() =>
    Array.from({ length: 7 }, () => ({ start: '09:00', end: '12:00' })));
  const [newExc, setNewExc] = useState({ date: '', closed: true, start: '09:00', end: '12:00', note: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [{ data: sdata, error: serr }, { data: pdata }, { data: hdata }, { data: edata }] = await Promise.all([
      sb.from('market_pickup_settings')
        .select('timezone,slot_minutes,lead_time_minutes,max_orders_per_slot,location_type,public_address')
        .eq('market_id', marketId).maybeSingle(),
      sb.from('market_pickup_private')
        .select('pickup_address,pickup_instructions,instructions_public')
        .eq('market_id', marketId).maybeSingle(),
      sb.from('market_pickup_hours')
        .select('id,weekday,start_minute,end_minute')
        .eq('market_id', marketId)
        .order('weekday', { ascending: true }).order('start_minute', { ascending: true }),
      sb.from('market_pickup_exceptions')
        .select('id,date,closed,start_minute,end_minute,note')
        .eq('market_id', marketId)
        .order('date', { ascending: true }),
    ]);
    if (serr) setError(serr.message);
    const s = sdata as {
      timezone: string; slot_minutes: number; lead_time_minutes: number;
      max_orders_per_slot: number | null; location_type: string; public_address: string | null;
    } | null;
    setSettings({
      timezone: s?.timezone ?? 'America/New_York',
      slot_minutes: String(s?.slot_minutes ?? 30),
      lead_time_minutes: String(s?.lead_time_minutes ?? 120),
      max_per_slot: s?.max_orders_per_slot == null ? '' : String(s.max_orders_per_slot),
      location_type: s?.location_type ?? 'PRIVATE_RESIDENCE',
      public_address: s?.public_address ?? '',
    });
    const p = pdata as {
      pickup_address: string | null; pickup_instructions: string | null; instructions_public: boolean;
    } | null;
    setPriv({
      pickup_address: p?.pickup_address ?? '',
      pickup_instructions: p?.pickup_instructions ?? '',
      instructions_public: p?.instructions_public ?? false,
    });
    setHours((hdata as unknown as HourRow[]) ?? []);
    setExceptions((edata as unknown as ExceptionRow[]) ?? []);
  }, [marketId]);

  useEffect(() => { void load(); }, [load]);

  async function saveSettings() {
    if (!settings) return;
    setBusy('settings'); setError(null); setSaved(false);
    const sb = supabaseBrowser();
    const maxRaw = settings.max_per_slot.trim();
    const { error: e1 } = await sb.from('market_pickup_settings').upsert({
      market_id: marketId,
      timezone: settings.timezone,
      slot_minutes: Number(settings.slot_minutes),
      lead_time_minutes: Number(settings.lead_time_minutes),
      max_orders_per_slot: maxRaw === '' ? null : Math.max(1, Math.round(Number(maxRaw))),
      location_type: settings.location_type,
      public_address: settings.location_type === 'PUBLIC_BUSINESS'
        ? (settings.public_address.trim() || null)
        : null,
    }, { onConflict: 'market_id' });
    const { error: e2 } = await sb.from('market_pickup_private').upsert({
      market_id: marketId,
      pickup_address: priv.pickup_address.trim() || null,
      pickup_instructions: priv.pickup_instructions.trim() || null,
      instructions_public: priv.instructions_public,
    }, { onConflict: 'market_id' });
    setBusy(null);
    const err = e1 ?? e2;
    if (err) setError(err.message);
    else { setSaved(true); await load(); }
  }

  async function addWindow(weekday: number) {
    const w = newWin[weekday];
    const start = toMinutes(w.start); const end = toMinutes(w.end);
    if (start == null || end == null) return setError('Pick a start and end time for the window.');
    if (end <= start) return setError('The window must end after it starts.');
    setBusy(`win-${weekday}`); setError(null);
    const { error: err } = await supabaseBrowser().from('market_pickup_hours').insert({
      market_id: marketId, weekday, start_minute: start, end_minute: end,
    });
    setBusy(null);
    if (err) setError(err.message); else await load();
  }

  async function removeWindow(id: string) {
    setBusy(id); setError(null);
    const { error: err } = await supabaseBrowser().from('market_pickup_hours').delete().eq('id', id);
    setBusy(null);
    if (err) setError(err.message); else await load();
  }

  async function addException() {
    if (!newExc.date) return setError('Pick a date for the exception.');
    let start: number | null = null; let end: number | null = null;
    if (!newExc.closed) {
      start = toMinutes(newExc.start); end = toMinutes(newExc.end);
      if (start == null || end == null) return setError('Pick the custom window times.');
      if (end <= start) return setError('The window must end after it starts.');
    }
    setBusy('exception'); setError(null);
    const { error: err } = await supabaseBrowser().from('market_pickup_exceptions').insert({
      market_id: marketId, date: newExc.date, closed: newExc.closed,
      start_minute: start, end_minute: end, note: newExc.note.trim() || null,
    });
    setBusy(null);
    if (err) setError(err.message);
    else { setNewExc({ date: '', closed: true, start: '09:00', end: '12:00', note: '' }); await load(); }
  }

  async function removeException(id: string) {
    setBusy(id); setError(null);
    const { error: err } = await supabaseBrowser().from('market_pickup_exceptions').delete().eq('id', id);
    setBusy(null);
    if (err) setError(err.message); else await load();
  }

  if (!settings) {
    return (
      <div className="preview-note" style={{ marginTop: 12 }}>
        <strong>Pickup availability</strong>
        {error ? <p className="autherror">{error}</p> : <p className="authhint">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="preview-note" style={{ marginTop: 12 }}>
      <strong>Pickup availability</strong>
      <p className="authhint" style={{ margin: '6px 0 0' }}>
        Buyers pick from open slots generated inside your weekly windows.
      </p>
      {error && <p className="autherror">{error}</p>}

      <div className="field-row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        <div className="field">
          <label>Timezone</label>
          <select value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}>
            {!TIMEZONES.some(([tz]) => tz === settings.timezone) && (
              <option value={settings.timezone}>{settings.timezone}</option>
            )}
            {TIMEZONES.map(([tz, label]) => <option key={tz} value={tz}>{label}</option>)}
          </select>
        </div>
        <div className="field" style={{ maxWidth: 140 }}>
          <label>Slot length</label>
          <select value={settings.slot_minutes} onChange={(e) => setSettings({ ...settings, slot_minutes: e.target.value })}>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
          </select>
        </div>
        <div className="field" style={{ maxWidth: 160 }}>
          <label>Lead time</label>
          <select value={settings.lead_time_minutes} onChange={(e) => setSettings({ ...settings, lead_time_minutes: e.target.value })}>
            {!LEAD_TIMES.some(([v]) => String(v) === settings.lead_time_minutes) && (
              <option value={settings.lead_time_minutes}>{settings.lead_time_minutes} minutes</option>
            )}
            {LEAD_TIMES.map(([v, label]) => <option key={v} value={String(v)}>{label}</option>)}
          </select>
        </div>
        <div className="field" style={{ maxWidth: 150 }}>
          <label>Max per slot</label>
          <input
            inputMode="numeric"
            placeholder="Unlimited"
            value={settings.max_per_slot}
            onChange={(e) => setSettings({ ...settings, max_per_slot: e.target.value.replace(/[^0-9]/g, '') })}
          />
        </div>
      </div>

      <div className="field" style={{ marginTop: 8 }}>
        <label>Pickup location</label>
        <select value={settings.location_type} onChange={(e) => setSettings({ ...settings, location_type: e.target.value })}>
          {LOCATION_TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      {settings.location_type === 'PUBLIC_BUSINESS' && (
        <div className="field" style={{ marginTop: 8 }}>
          <label>Public address (shown to everyone)</label>
          <input
            value={settings.public_address}
            placeholder="123 Market St, Richmond Heights, OH"
            onChange={(e) => setSettings({ ...settings, public_address: e.target.value })}
          />
        </div>
      )}

      <div style={{ borderTop: '1px dashed var(--border)', marginTop: 12, paddingTop: 10 }}>
        <strong style={{ fontSize: 14 }}>Private pickup details</strong>
        <p className="authhint" style={{ margin: '4px 0 0' }}>
          Shared only with confirmed pickups.
        </p>
        <div className="field" style={{ marginTop: 8 }}>
          <label>Pickup address (private)</label>
          <input
            value={priv.pickup_address}
            placeholder="Your street address"
            onChange={(e) => { setPriv({ ...priv, pickup_address: e.target.value }); setSaved(false); }}
          />
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <label>Pickup instructions</label>
          <textarea
            rows={2}
            placeholder="Side porch cooler — knock if the light's on."
            value={priv.pickup_instructions}
            onChange={(e) => { setPriv({ ...priv, pickup_instructions: e.target.value }); setSaved(false); }}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={priv.instructions_public}
            onChange={(e) => { setPriv({ ...priv, instructions_public: e.target.checked }); setSaved(false); }}
          />
          Also show the instructions publicly (your address stays private)
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
        <button className="btn btn-primary btn-sm" disabled={busy === 'settings'} onClick={() => void saveSettings()}>
          {busy === 'settings' ? 'Saving…' : 'Save pickup settings'}
        </button>
        {saved && <span className="tag type-free">Saved ✓</span>}
      </div>

      <div style={{ borderTop: '1px dashed var(--border)', marginTop: 14, paddingTop: 10 }}>
        <strong style={{ fontSize: 14 }}>Weekly pickup windows</strong>
        <p className="authhint" style={{ margin: '4px 0 8px' }}>
          Add as many windows per day as you like — slots are generated inside them.
        </p>
        {WEEKDAYS.map((name, wd) => {
          const wins = hours.filter((h) => h.weekday === wd);
          const draft = newWin[wd];
          return (
            <div key={wd} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px dashed var(--border)' }}>
              <span style={{ minWidth: 96, fontWeight: 700, fontSize: 14 }}>{name}</span>
              {wins.length === 0 && <span className="authhint" style={{ margin: 0 }}>No pickup</span>}
              {wins.map((h) => (
                <span key={h.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span className="tag type-free">{fmtMinute(h.start_minute)} – {fmtMinute(h.end_minute)}</span>
                  <button
                    className="mm-btn danger" title="Remove window" disabled={busy === h.id}
                    onClick={() => void removeWindow(h.id)}
                  >✕</button>
                </span>
              ))}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                <input
                  type="time" value={draft.start} style={{ width: 108 }}
                  onChange={(e) => setNewWin((ws) => ws.map((w, i) => (i === wd ? { ...w, start: e.target.value } : w)))}
                />
                <span>–</span>
                <input
                  type="time" value={draft.end} style={{ width: 108 }}
                  onChange={(e) => setNewWin((ws) => ws.map((w, i) => (i === wd ? { ...w, end: e.target.value } : w)))}
                />
                <button className="mm-btn" disabled={busy === `win-${wd}`} onClick={() => void addWindow(wd)}>
                  + Add
                </button>
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14 }}>
        <strong style={{ fontSize: 14 }}>Date exceptions</strong>
        <p className="authhint" style={{ margin: '4px 0 0' }}>
          Close a specific date, or replace that day&rsquo;s regular hours with a custom window.
        </p>
        {exceptions.map((ex) => (
          <div key={ex.id} className="lot-row">
            <span>
              {ex.date} · {ex.closed
                ? 'Closed'
                : `${fmtMinute(ex.start_minute ?? 0)} – ${fmtMinute(ex.end_minute ?? 0)}`}
              {ex.note ? ` · ${ex.note}` : ''}
            </span>
            <span className="lot-actions">
              <button className="mm-btn danger" disabled={busy === ex.id} onClick={() => void removeException(ex.id)}>
                Remove
              </button>
            </span>
          </div>
        ))}
        <div className="field-row" style={{ marginTop: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ maxWidth: 170 }}>
            <label>Date</label>
            <input type="date" value={newExc.date} onChange={(e) => setNewExc({ ...newExc, date: e.target.value })} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, paddingBottom: 12, cursor: 'pointer' }}>
            <input
              type="checkbox" checked={newExc.closed}
              onChange={(e) => setNewExc({ ...newExc, closed: e.target.checked })}
            />
            Closed all day
          </label>
          {!newExc.closed && (
            <>
              <div className="field" style={{ maxWidth: 130 }}>
                <label>Start</label>
                <input type="time" value={newExc.start} onChange={(e) => setNewExc({ ...newExc, start: e.target.value })} />
              </div>
              <div className="field" style={{ maxWidth: 130 }}>
                <label>End</label>
                <input type="time" value={newExc.end} onChange={(e) => setNewExc({ ...newExc, end: e.target.value })} />
              </div>
            </>
          )}
          <div className="field">
            <label>Note (optional)</label>
            <input
              value={newExc.note} placeholder="Out of town, market day…"
              onChange={(e) => setNewExc({ ...newExc, note: e.target.value })}
            />
          </div>
          <button className="btn btn-secondary btn-sm" disabled={busy === 'exception'} onClick={() => void addException()}>
            Add exception
          </button>
        </div>
      </div>
    </div>
  );
}
