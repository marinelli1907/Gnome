'use client';

import { useState } from 'react';
import type { WebPickupSlot } from '@/lib/gnome';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import { SignInCard, useSession } from '../../components/auth';

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function VisitRequestButton({
  marketId,
  marketName,
  slots,
}: {
  marketId: string;
  marketName: string;
  slots: WebPickupSlot[];
}) {
  const { session, ready } = useSession();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<WebPickupSlot | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (!selected || !session) return;
    setBusy(true);
    setMessage(null);
    const { error } = await supabaseBrowser().rpc('create_market_visit_request', {
      p_market: marketId,
      p_start: selected.slot_start,
      p_end: selected.slot_end,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      setMessage(error.message.includes('SLOT_UNAVAILABLE')
        ? 'That time was just taken. Refresh this page and choose another.'
        : 'This visit could not be requested right now. Nothing was booked.');
      return;
    }
    setSelected(null);
    setNote('');
    setMessage(`Request sent to ${marketName}. You’ll see their confirmation in Gnome.`);
  }

  return (
    <>
      <button className="btn btn-secondary" type="button" onClick={() => setOpen(true)}>
        Request a visit
      </button>
      {open ? (
        <div className="market-visit-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <section className="market-visit-dialog" role="dialog" aria-modal="true" aria-labelledby="visit-title">
            <div className="market-visit-head">
              <div>
                <h2 id="visit-title">Visit {marketName}</h2>
                <p>Choose a stand time for the seller to confirm.</p>
              </div>
              <button className="market-visit-close" type="button" onClick={() => setOpen(false)} aria-label="Close visit request">×</button>
            </div>
            {!ready ? <p className="sub">Checking your account…</p> : !session ? (
              <SignInCard title="Sign in to request a visit" blurb="We’ll email a six-digit code, then bring you right back here." />
            ) : (
              <>
                <div className="market-visit-slots" aria-label="Available visit times">
                  {slots.length ? slots.map((slot) => {
                    const active = selected?.slot_start === slot.slot_start;
                    return (
                      <button
                        key={slot.slot_start}
                        type="button"
                        className={`market-visit-slot${active ? ' active' : ''}`}
                        aria-pressed={active}
                        onClick={() => setSelected(slot)}
                      >
                        <strong>{dayLabel(slot.slot_start)}</strong>
                        <span>{timeLabel(slot.slot_start)}–{timeLabel(slot.slot_end)}</span>
                      </button>
                    );
                  }) : <p className="sub">No visit times are available right now.</p>}
                </div>
                <div className="field market-visit-note">
                  <label htmlFor="visit-note">Note (optional)</label>
                  <textarea
                    id="visit-note"
                    rows={3}
                    maxLength={500}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="We’d love to stop by and see what’s available."
                  />
                </div>
                <button className="btn btn-primary" type="button" disabled={!selected || busy} onClick={() => void submit()}>
                  {busy ? 'Sending…' : 'Send visit request'}
                </button>
              </>
            )}
            {message ? <p className="market-visit-message" role="status">{message}</p> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
