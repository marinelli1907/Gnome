'use client';

// Reserve-a-plot request (M11 Phase 1). Creates a claim of type
// 'plot_reservation' under the buyer's own RLS — the grower approves or
// declines from My Market (web) or the app. NO payment is taken here:
// the reservation price is settled directly with the grower, like every
// Gnome sale. Escrow is Phase 2 (docs/PLOTS.md).
import { useState } from 'react';
import { logWeb } from '../../lib/analytics';
import { formatPrice } from '../../lib/format';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { SignInCard, useSession } from './auth';

export default function ReservePlot({
  listingId,
  priceCents,
  options,
  allowCustom = true,
}: {
  listingId: string;
  priceCents: number | null;
  options?: { node_id?: string | null; label: string }[] | null;
  allowCustom?: boolean;
}) {
  const { session, ready } = useSession();
  const [open, setOpen] = useState(false);
  const [crop, setCrop] = useState('');
  const [picked, setPicked] = useState<{ label: string; node_id?: string | null } | null>(null);
  const [pickedCustom, setPickedCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const opts = options ?? [];
  const hasOptions = opts.length > 0;
  const price = priceCents != null ? formatPrice(priceCents) : null;

  if (done) {
    return (
      <div className="authcard">
        <h2>🌱 Reservation requested</h2>
        <p className="sub">
          The grower will approve or decline your request. Once approved, you’ll
          arrange payment and pickup together — details are shared in the Gnome app.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        className="btn btn-primary"
        onClick={() => { setOpen(true); logWeb('reserve_started', { listing: listingId }); }}
      >
        Reserve this plot{price ? ` · ${price}` : ''}
      </button>
    );
  }

  if (!ready) return <div className="empty"><p>Loading…</p></div>;
  if (!session) {
    return (
      <SignInCard
        title="Sign in to reserve this plot"
        blurb="One code by email and your request goes straight to the grower."
      />
    );
  }

  async function submit() {
    if (busy) return;
    if (hasOptions && !picked && !pickedCustom) return setError('Pick what you’d like grown.');
    if (pickedCustom && !allowCustom) return setError('This grower only grows the listed crops.');
    if (pickedCustom && !crop.trim()) return setError('Tell the grower what you have in mind.');
    if (!hasOptions && !crop.trim()) return setError('Tell the grower what you’d like grown.');
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().from('claims').insert({
      listing_id: listingId,
      claimer_id: session!.user.id,
      claim_type: 'plot_reservation',
      // Plot reservations require a non-empty note (DB constraint): fall back
      // to the chosen crop label when the free-text detail is blank.
      buyer_note: crop.trim() || picked?.label || null,
      selected_option_label: picked?.label ?? null,
      selected_taxonomy_node_id: picked?.node_id ?? null,
      is_custom_option: pickedCustom,
      agreed_price_cents: priceCents ?? 0,
      payment_status: 'external',
    });
    setBusy(false);
    if (error) {
      if (error.code === '23505') setError('You’ve already requested this plot — the grower has your request.');
      else if (error.message.includes('claims_insert_claimer')) setError('You can’t reserve your own plot.');
      else setError(error.message);
    } else {
      logWeb('reserve_submitted', { listing: listingId });
      setDone(true);
    }
  }

  return (
    <div className="authcard">
      <h2>Reserve this plot{price ? ` · ${price}` : ''}</h2>
      <p className="sub">
        Tell the grower what you’d like them to grow. They approve your request,
        then you arrange payment and pickup together — Gnome takes no cut.
      </p>
      {hasOptions && (
        <div className="field">
          <label>What would you like grown?</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            {opts.map((o) => {
              const on = !pickedCustom && picked?.label === o.label;
              return (
                <button
                  type="button"
                  key={o.label}
                  aria-pressed={on}
                  className={`btn btn-sm ${on ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { setPicked(o); setPickedCustom(false); }}
                >
                  {o.label}
                </button>
              );
            })}
            {allowCustom && (
              <button
                type="button"
                aria-pressed={pickedCustom}
                className={`btn btn-sm ${pickedCustom ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { setPickedCustom(true); setPicked(null); }}
              >
                Something else
              </button>
            )}
          </div>
        </div>
      )}
      <div className="field">
        <label>{hasOptions ? 'Additional details' : 'What should they grow?'}</label>
        <textarea
          rows={3}
          value={crop}
          placeholder="Type what you’d like them to grow…"
          onChange={(e) => setCrop(e.target.value)}
        />
      </div>
      {error && <p className="autherror">{error}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Sending…' : 'Send reservation request'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
