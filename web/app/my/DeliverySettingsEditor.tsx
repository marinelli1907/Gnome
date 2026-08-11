'use client';

// Seller-side delivery settings: whether this Market delivers, how far, what
// it costs, and when. The free tier gets on/off + radius (≤15 mi) + one flat
// fee; paid plans add a distance surcharge and the timing models (same-day /
// next-day cutoffs, weekly schedule). The backend trigger enforces the plan
// gate — this UI just avoids letting free sellers type things that would
// bounce. Fees are between neighbors; Gnome takes no cut.
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';

interface DeliveryForm {
  enabled: boolean;
  radius_miles: string;        // text inputs; parsed on save
  flat_fee: string;            // dollars
  surcharge_after_miles: string;
  surcharge_fee: string;       // dollars
  same_day: boolean;
  same_day_cutoff: string;     // "HH:MM"
  next_day: boolean;
  next_day_cutoff: string;
  scheduled: boolean;
  order_by_dow: number | null;
  delivery_dows: number[];
  notes: string;
}

const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const blank = (): DeliveryForm => ({
  enabled: false, radius_miles: '', flat_fee: '',
  surcharge_after_miles: '', surcharge_fee: '',
  same_day: false, same_day_cutoff: '11:00',
  next_day: false, next_day_cutoff: '18:00',
  scheduled: false, order_by_dow: null, delivery_dows: [],
  notes: '',
});

const dollars = (cents: number | null | undefined) =>
  cents == null ? '' : (cents / 100).toFixed(2).replace(/\.00$/, '');
const cents = (s: string): number | null => {
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return s.trim() === '' || Number.isNaN(n) ? null : Math.round(n * 100);
};

export default function DeliverySettingsEditor({ marketId, plan }: { marketId: string; plan: string }) {
  const paid = plan !== 'free';
  const [form, setForm] = useState<DeliveryForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from('market_delivery_settings')
      .select('*')
      .eq('market_id', marketId)
      .maybeSingle();
    const f = blank();
    if (data) {
      f.enabled = data.enabled;
      f.radius_miles = data.radius_miles != null ? String(data.radius_miles) : '';
      f.flat_fee = dollars(data.flat_fee_cents);
      f.surcharge_after_miles = data.surcharge_after_miles != null ? String(data.surcharge_after_miles) : '';
      f.surcharge_fee = dollars(data.surcharge_fee_cents);
      f.same_day = data.same_day;
      f.same_day_cutoff = data.same_day_cutoff?.slice(0, 5) ?? '11:00';
      f.next_day = data.next_day;
      f.next_day_cutoff = data.next_day_cutoff?.slice(0, 5) ?? '18:00';
      f.scheduled = data.scheduled;
      f.order_by_dow = data.order_by_dow;
      f.delivery_dows = data.delivery_dows ?? [];
      f.notes = data.notes ?? '';
    }
    setForm(f);
  }, [marketId]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    const radius = form.radius_miles.trim() === '' ? null : Number(form.radius_miles);
    if (form.enabled && (radius == null || Number.isNaN(radius) || radius <= 0)) {
      setError('Enter how many miles you deliver.');
      setSaving(false);
      return;
    }
    if (form.scheduled && (form.order_by_dow == null || form.delivery_dows.length === 0)) {
      setError('Scheduled delivery needs an order-by day and at least one delivery day.');
      setSaving(false);
      return;
    }

    const row = {
      market_id: marketId,
      enabled: form.enabled,
      radius_miles: radius,
      flat_fee_cents: cents(form.flat_fee) ?? 0,
      surcharge_after_miles: paid && form.surcharge_after_miles.trim() !== ''
        ? Number(form.surcharge_after_miles) : null,
      surcharge_fee_cents: paid && form.surcharge_after_miles.trim() !== ''
        ? cents(form.surcharge_fee) ?? 0 : null,
      same_day: paid && form.same_day,
      same_day_cutoff: paid && form.same_day ? form.same_day_cutoff : null,
      next_day: paid && form.next_day,
      next_day_cutoff: paid && form.next_day ? form.next_day_cutoff : null,
      scheduled: paid && form.scheduled,
      order_by_dow: paid && form.scheduled ? form.order_by_dow : null,
      delivery_dows: paid && form.scheduled ? form.delivery_dows : [],
      notes: form.notes.trim() || null,
    };

    const { error: err } = await supabaseBrowser()
      .from('market_delivery_settings')
      .upsert(row, { onConflict: 'market_id' });
    if (err) {
      const m = /DELIVERY_PLAN_LIMIT:[^:]*:(.*)/.exec(err.message);
      setError(m ? m[1] : err.message);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
    setSaving(false);
  }

  if (!form) return <div className="preview-note" style={{ marginTop: 12 }}>Loading delivery settings…</div>;

  const set = (patch: Partial<DeliveryForm>) => setForm({ ...form, ...patch });

  return (
    <div className="preview-note" style={{ marginTop: 12 }}>
      <strong>Delivery</strong>
      <p className="authhint" style={{ marginTop: 4 }}>
        Tell buyers if you deliver, how far, and what it costs. Fees are paid to
        you directly, like everything else on Gnome.
      </p>

      <div className="chiprow" style={{ marginTop: 8 }}>
        <button type="button" className={`chip${form.enabled ? ' active' : ''}`}
          aria-pressed={form.enabled}
          onClick={() => set({ enabled: !form.enabled })}>
          {form.enabled ? '✓ We deliver' : 'We deliver'}
        </button>
        <button type="button" className={`chip${!form.enabled ? ' active' : ''}`}
          aria-pressed={!form.enabled}
          onClick={() => set({ enabled: false })}>
          Pickup only
        </button>
      </div>

      {form.enabled && (
        <>
          <div className="field-row" style={{ marginTop: 12 }}>
            <div className="field">
              <label>Delivery radius (miles{paid ? '' : ' — up to 15 on the free plan'})</label>
              <input inputMode="decimal" value={form.radius_miles} placeholder={paid ? '25' : '10'}
                onChange={(e) => set({ radius_miles: e.target.value })} />
            </div>
            <div className="field">
              <label>Delivery fee ($, flat — 0 = free delivery)</label>
              <input inputMode="decimal" value={form.flat_fee} placeholder="3.00"
                onChange={(e) => set({ flat_fee: e.target.value })} />
            </div>
          </div>

          {paid ? (
            <>
              <div className="field-row" style={{ marginTop: 8 }}>
                <div className="field">
                  <label>Extra fee kicks in after (miles — optional)</label>
                  <input inputMode="decimal" value={form.surcharge_after_miles} placeholder="10"
                    onChange={(e) => set({ surcharge_after_miles: e.target.value })} />
                </div>
                <div className="field">
                  <label>Extra fee beyond that ($)</label>
                  <input inputMode="decimal" value={form.surcharge_fee} placeholder="2.00"
                    disabled={form.surcharge_after_miles.trim() === ''}
                    onChange={(e) => set({ surcharge_fee: e.target.value })} />
                </div>
              </div>

              <div className="field" style={{ marginTop: 8 }}>
                <label>When do you deliver? (pick any)</label>
                <div className="chiprow">
                  <button type="button" className={`chip${form.same_day ? ' active' : ''}`}
                    aria-pressed={form.same_day}
                    onClick={() => set({ same_day: !form.same_day })}>Same-day</button>
                  <button type="button" className={`chip${form.next_day ? ' active' : ''}`}
                    aria-pressed={form.next_day}
                    onClick={() => set({ next_day: !form.next_day })}>Next-day</button>
                  <button type="button" className={`chip${form.scheduled ? ' active' : ''}`}
                    aria-pressed={form.scheduled}
                    onClick={() => set({ scheduled: !form.scheduled })}>Weekly schedule</button>
                </div>
              </div>

              {form.same_day && (
                <div className="field" style={{ marginTop: 8 }}>
                  <label>Same-day: order by</label>
                  <input type="time" value={form.same_day_cutoff}
                    onChange={(e) => set({ same_day_cutoff: e.target.value })} style={{ maxWidth: 160 }} />
                </div>
              )}
              {form.next_day && (
                <div className="field" style={{ marginTop: 8 }}>
                  <label>Next-day: order by</label>
                  <input type="time" value={form.next_day_cutoff}
                    onChange={(e) => set({ next_day_cutoff: e.target.value })} style={{ maxWidth: 160 }} />
                </div>
              )}
              {form.scheduled && (
                <>
                  <div className="field" style={{ marginTop: 8 }}>
                    <label>Order by (day of week)</label>
                    <div className="chiprow">
                      {DOWS.map((d, i) => (
                        <button key={d} type="button" className={`chip${form.order_by_dow === i ? ' active' : ''}`}
                          aria-pressed={form.order_by_dow === i}
                          onClick={() => set({ order_by_dow: i })}>{d}</button>
                      ))}
                    </div>
                  </div>
                  <div className="field" style={{ marginTop: 8 }}>
                    <label>We deliver on (pick any)</label>
                    <div className="chiprow">
                      {DOWS.map((d, i) => (
                        <button key={d} type="button" className={`chip${form.delivery_dows.includes(i) ? ' active' : ''}`}
                          aria-pressed={form.delivery_dows.includes(i)}
                          onClick={() => set({
                            delivery_dows: form.delivery_dows.includes(i)
                              ? form.delivery_dows.filter((x) => x !== i)
                              : [...form.delivery_dows, i].sort(),
                          })}>{d}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="authhint" style={{ marginTop: 8 }}>
              Distance-based fees, same-day &amp; next-day cutoffs, and weekly delivery
              schedules are Grower &amp; Farm features. <a href="/pricing">Upgrade</a> to
              customize delivery further.
            </p>
          )}

          <div className="field" style={{ marginTop: 8 }}>
            <label>Delivery notes (optional — shown to buyers)</label>
            <input value={form.notes} placeholder="Coolers on porches welcome; text when we're 10 min out."
              maxLength={500}
              onChange={(e) => set({ notes: e.target.value })} />
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
        <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save delivery settings'}
        </button>
        {saved && <span className="authhint">Saved ✓</span>}
      </div>
      {error && <p className="autherror" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
