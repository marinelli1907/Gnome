'use client';

// The persistent seller usage card on My Market.
//
// Exists so a seller can answer "how many listings have I used this month?" without starting a
// listing to find out. Everything shown comes from my_listing_allowance(); this component performs
// no allowance arithmetic and never reads the ledger. If the RPC fails it says so — a card that
// renders 0 of 0 on error would tell the seller they had used nothing, which is worse than
// admitting the number is unavailable.
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import {
  type AllowanceRow, type Meter, type WantedRow,
  listingsMeter, renewalsMeter, wantedMeter, exhaustedHint, upgradeHint, resetLabel,
} from '../../lib/allowance';

function MeterBlock({ meter, hint }: { meter: Meter; hint: string | null }) {
  return (
    // minWidth:0 lets the block shrink inside the grid instead of forcing the row wider than the
    // viewport, which is what produces horizontal scroll on a narrow phone.
    <div style={{ minWidth: 0 }}>
      <div className="dc-label" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {meter.heading}
      </div>
      {meter.lines.map((l, i) => (
        <div
          key={l.value}
          style={{
            // The first line is the headline figure; the rest are supporting detail.
            fontSize: i === 0 ? 20 : 14,
            fontWeight: i === 0 ? 600 : 400,
            lineHeight: 1.35,
            opacity: i === 0 ? 1 : 0.75,
            overflowWrap: 'anywhere',
          }}
        >
          {l.value}
        </div>
      ))}
      {hint ? (
        <div className="authhint" style={{ marginTop: 6 }}>{hint}</div>
      ) : null}
    </div>
  );
}

export default function AllowanceCard() {
  const [row, setRow] = useState<AllowanceRow | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'none'>('loading');
  // Wanted meters daily through its own RPC. Held separately so a failure here degrades to a
  // one-line note instead of taking the listing meters down with it — and never to fake zeros.
  const [wanted, setWanted] = useState<WantedRow | null | 'error'>(null);

  useEffect(() => {
    let cancelled = false;
    void supabaseBrowser().rpc('my_listing_allowance').then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setState('error'); return; }
      const r = (Array.isArray(data) ? data[0] : data) as AllowanceRow | undefined;
      // No row is a real state, not an error: the seller has no Market yet.
      if (!r) { setState('none'); return; }
      setRow(r); setState('ready');
    });
    void supabaseBrowser().rpc('my_wanted_allowance').then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setWanted('error'); return; }
      const w = (Array.isArray(data) ? data[0] : data) as WantedRow | undefined;
      setWanted(w ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  if (state === 'none') return null;

  if (state === 'loading' || state === 'error') {
    return (
      <section className="section" style={{ paddingTop: 8 }}>
        <div className="section-head"><h2>Your plan</h2></div>
        <div className="card" style={{ padding: 16 }}>
          <p className="sub" style={{ margin: 0 }}>
            {state === 'loading'
              ? 'Checking your listing allowance…'
              : 'We couldn’t load your listing allowance just now. Refresh to try again — nothing about your plan has changed.'}
          </p>
        </div>
      </section>
    );
  }

  const r = row!;
  const listings = listingsMeter(r);
  const renewals = renewalsMeter(r);
  const upgrade = upgradeHint(r);

  return (
    <section className="section" style={{ paddingTop: 8 }}>
      <div className="section-head">
        {/* display_name is the customer-facing name the server resolved. The internal enum
            (free/grower/farm/sponsor) is never fetched here, so it cannot leak. */}
        <h2>Your plan · {r.display_name}</h2>
      </div>

      <div className="card" style={{ padding: 16 }}>
        {/* Listings and renewals are deliberately two blocks, never one combined meter — they are
            separate entitlements that run out independently. auto-fit keeps them side by side on
            desktop and stacks them on a phone with no media query and no overflow. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
            gap: 20,
          }}
        >
          <MeterBlock meter={listings} hint={exhaustedHint(r, 'listings')} />
          <MeterBlock meter={renewals} hint={exhaustedHint(r, 'renewals')} />
          {wanted && wanted !== 'error' ? (
            <MeterBlock
              meter={wantedMeter(wanted)}
              hint={wantedMeter(wanted).exhausted ? 'More Wanted responses tomorrow — or upgrade' : null}
            />
          ) : null}
        </div>
        {wanted === 'error' ? (
          <p className="authhint" style={{ marginTop: 8 }}>
            Wanted response usage couldn’t load just now — this doesn’t affect your allowance.
          </p>
        ) : null}

        <div
          style={{
            display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
            marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border, #E5E7EB)',
          }}
        >
          <span className="dc-label">{resetLabel(r)}</span>
          <span className="dc-label" style={{ opacity: 0.7 }}>
            Listings run for {r.listing_lifetime_days} days
          </span>
          {upgrade ? (
            // A link, not a checkout. The dashboard reports status; the server decides at publish
            // time whether anything is actually owed.
            <a className="btn btn-secondary btn-sm" href="/pricing" style={{ marginLeft: 'auto' }}>
              Upgrade to {upgrade.name} — {upgrade.price}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
