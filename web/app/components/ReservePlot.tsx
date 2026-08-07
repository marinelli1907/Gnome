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
}: {
  listingId: string;
  priceCents: number | null;
}) {
  const { session, ready } = useSession();
  const [open, setOpen] = useState(false);
  const [crop, setCrop] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
    if (!crop.trim()) return setError('Tell the grower what you’d like grown.');
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().from('claims').insert({
      listing_id: listingId,
      claimer_id: session!.user.id,
      claim_type: 'plot_reservation',
      buyer_note: crop.trim(),
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
      <div className="field">
        <label>What should they grow?</label>
        <textarea
          rows={3}
          value={crop}
          placeholder="San Marzano tomatoes and basil, please — enough for sauce season."
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
