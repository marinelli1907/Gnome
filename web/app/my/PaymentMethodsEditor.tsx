'use client';

// Seller-side editor for how buyers can pay at pickup. Payment always happens
// OUTSIDE Gnome (Venmo/PayPal/cash/…) — Gnome just publishes the signage on
// the public market page and lets the seller confirm receipt in the Sales
// Notebook. Enabled rows are world-readable (that's the point of enabling
// them); disabled rows stay private drafts under RLS.
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';

type PayMethod = 'venmo' | 'paypal' | 'cashapp' | 'zelle' | 'cash' | 'other';

interface MethodForm { enabled: boolean; handle: string; label: string; instructions: string; }

const METHODS: {
  key: PayMethod; name: string; handleLabel?: string; placeholder?: string; note?: string;
}[] = [
  { key: 'venmo', name: 'Venmo', handleLabel: 'Venmo username', placeholder: '@your-username' },
  { key: 'paypal', name: 'PayPal', handleLabel: 'PayPal.Me name', placeholder: 'YourName' },
  { key: 'cashapp', name: 'Cash App', handleLabel: '$Cashtag', placeholder: '$yourcashtag' },
  {
    key: 'zelle', name: 'Zelle', handleLabel: 'Zelle identifier (email or phone)',
    placeholder: 'you@example.com',
    note: 'Zelle has no universal public payment link — buyers will see this identifier.',
  },
  { key: 'cash', name: 'Cash at pickup' },
  { key: 'other', name: 'Other' },
];

const blankForm = (): MethodForm => ({ enabled: false, handle: '', label: '', instructions: '' });

export default function PaymentMethodsEditor({ marketId }: { marketId: string }) {
  const [forms, setForms] = useState<Record<PayMethod, MethodForm> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabaseBrowser()
      .from('market_payment_methods')
      .select('method,enabled,handle,label,instructions')
      .eq('market_id', marketId);
    if (err) { setError(err.message); return; }
    const next = Object.fromEntries(METHODS.map((m) => [m.key, blankForm()])) as Record<PayMethod, MethodForm>;
    const rows = (data as unknown as {
      method: PayMethod; enabled: boolean;
      handle: string | null; label: string | null; instructions: string | null;
    }[]) ?? [];
    for (const row of rows) {
      if (next[row.method]) {
        next[row.method] = {
          enabled: row.enabled,
          handle: row.handle ?? '',
          label: row.label ?? '',
          instructions: row.instructions ?? '',
        };
      }
    }
    setForms(next);
  }, [marketId]);

  useEffect(() => { void load(); }, [load]);

  function patch(key: PayMethod, partial: Partial<MethodForm>) {
    setForms((f) => (f ? { ...f, [key]: { ...f[key], ...partial } } : f));
    setSaved(false);
  }

  async function save() {
    if (!forms) return;
    setSaving(true); setError(null); setSaved(false);
    const payload = METHODS.map(({ key }) => ({
      market_id: marketId,
      method: key,
      enabled: forms[key].enabled,
      handle: forms[key].handle.trim() || null,
      label: forms[key].label.trim() || null,
      instructions: forms[key].instructions.trim() || null,
    }));
    const { error: err } = await supabaseBrowser()
      .from('market_payment_methods')
      .upsert(payload, { onConflict: 'market_id,method' });
    setSaving(false);
    if (err) setError(err.message);
    else { setSaved(true); await load(); }
  }

  return (
    <div className="preview-note" style={{ marginTop: 12 }}>
      <strong>Payment methods</strong>
      <p className="authhint" style={{ margin: '6px 0 0' }}>
        Buyers only see methods you enable. Payment happens outside Gnome;
        you confirm it in your Sales Notebook.
      </p>
      {error && <p className="autherror">{error}</p>}
      {!forms && <p className="authhint">Loading…</p>}
      {forms && METHODS.map((m) => {
        const f = forms[m.key];
        return (
          <div key={m.key} style={{ borderTop: '1px dashed var(--border)', marginTop: 10, paddingTop: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={f.enabled}
                onChange={(e) => patch(m.key, { enabled: e.target.checked })}
              />
              {m.name}
            </label>
            {m.handleLabel && (
              <div className="field" style={{ marginTop: 8 }}>
                <label>{m.handleLabel}</label>
                <input
                  value={f.handle}
                  placeholder={m.placeholder}
                  onChange={(e) => patch(m.key, { handle: e.target.value })}
                />
              </div>
            )}
            {m.note && <p className="authhint" style={{ margin: '6px 0 0' }}>{m.note}</p>}
            {m.key === 'other' && (
              <>
                <div className="field" style={{ marginTop: 8 }}>
                  <label>Label (what buyers see)</label>
                  <input
                    value={f.label}
                    placeholder="Check, trade, barter…"
                    onChange={(e) => patch(m.key, { label: e.target.value })}
                  />
                </div>
                <div className="field" style={{ marginTop: 8 }}>
                  <label>Instructions</label>
                  <input
                    value={f.instructions}
                    placeholder="How buyers should pay"
                    onChange={(e) => patch(m.key, { instructions: e.target.value })}
                  />
                </div>
              </>
            )}
          </div>
        );
      })}
      {forms && (
        <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save payment methods'}
          </button>
          {saved && <span className="tag type-free">Saved ✓</span>}
        </div>
      )}
    </div>
  );
}
