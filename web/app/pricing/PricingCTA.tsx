'use client';

// Upgrade button.
//
// This used to be an <a> pointing at a raw Stripe Payment Link held in
// NEXT_PUBLIC_STRIPE_LINK_*. Two problems with that, both found the hard way:
//
//   1. A Payment Link goes straight to Stripe. It never touches billing-checkout,
//      so billing_config.payments_live_enabled — the owner's "Payments Live"
//      switch, whose own UI promises "no real money moves" — did not govern it.
//      The switch was off and the site was quietly offering live $9.99/mo and
//      $29.99/mo subscriptions.
//   2. The link lived in .env.local, which is gitignored, so no amount of reading
//      the source could reveal it. It only showed up in the deployed HTML.
//
// Everything now goes through the billing-checkout edge function, which consults
// the live gate, resolves the test-vs-live price in one place, and binds the
// session to the caller's OWN market server-side. The button cannot outlive the
// switch again.
import { useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { useSession } from '../components/auth';

type Mode = 'test' | 'live';

const FRIENDLY: Record<string, string> = {
  NO_MARKET: 'Post something once to create your Market, then you can upgrade.',
  UNKNOWN_PRODUCT: 'That plan is not available right now.',
  SEED_DROP_COMING_SOON: 'The Seed Drop is not on sale yet.',
  STRIPE_KEY_MISSING: 'Checkout is not configured yet. Nothing was charged.',
  PRICE_MISSING: 'This plan has no price configured yet. Nothing was charged.',
  CHECKOUT_FAILED: 'Stripe could not start checkout. Nothing was charged.',
  NOT_YOUR_LISTING: 'That listing is not yours.',
};

const UNAVAILABLE = 'Checkout is unavailable right now. Nothing was charged.';

export default function PricingCTA({
  productKey, label, primary,
}: { productKey: string; label: string; primary?: boolean }) {
  const { session, ready } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const cls = `btn ${primary ? 'btn-primary' : 'btn-secondary'}`;

  if (ready && !session) {
    return <a className={cls} href="/sell">Sign in to upgrade</a>;
  }

  async function go() {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const { data, error } = await supabaseBrowser().functions.invoke('billing-checkout', {
        body: { product_key: productKey },
      });
      // A non-2xx from an edge function surfaces as `error`, but the server's own
      // JSON body still arrives in `data` — read the specific code first so the
      // seller gets the real reason rather than a shrug.
      const code = (data as { error?: string } | null)?.error;
      if (code) { setErr(FRIENDLY[code] ?? UNAVAILABLE); return; }
      if (error) { setErr(UNAVAILABLE); return; }

      const { url, mode } = (data ?? {}) as { url?: string; mode?: Mode };
      if (!url) { setErr(UNAVAILABLE); return; }

      // Say so plainly rather than sending someone to a Stripe page that will
      // refuse their real card without explaining why.
      if (mode === 'test') {
        setNote('Opening Stripe in test mode — a real card will not be charged. Use 4242 4242 4242 4242.');
      }
      window.location.href = url;
    } catch {
      setErr(UNAVAILABLE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className={cls} onClick={go} disabled={busy}>
        {busy ? 'Opening checkout…' : label}
      </button>
      {note && <p className="notice-inline" style={{ marginTop: 8 }}>{note}</p>}
      {err && <p className="notice-inline" style={{ marginTop: 8 }}>{err}</p>}
    </>
  );
}
