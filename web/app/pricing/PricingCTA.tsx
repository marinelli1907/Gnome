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
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { useSession } from '../components/auth';
import {
  NATIVE_APP_PLATFORM_PARAM,
  NATIVE_APP_PLATFORM_SESSION_KEY,
} from '../components/NativeAppVisitMarker';

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
  // Holds a created-but-not-yet-opened checkout URL while the test-mode warning
  // is on screen. Non-null means "we told them, and they have not continued".
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [androidAppVisit, setAndroidAppVisit] = useState(false);

  const cls = `btn ${primary ? 'btn-primary' : 'btn-secondary'}`;

  useEffect(() => {
    const queryPlatform = new URLSearchParams(window.location.search)
      .get(NATIVE_APP_PLATFORM_PARAM)?.toLowerCase();
    const storedPlatform = window.sessionStorage
      .getItem(NATIVE_APP_PLATFORM_SESSION_KEY)?.toLowerCase();
    setAndroidAppVisit(queryPlatform === 'android' || storedPlatform === 'android');
  }, []);

  if (androidAppVisit) {
    return (
      <p className="notice-inline" style={{ marginTop: 8 }}>
        Digital plan checkout is unavailable from Android app-opened pages.
      </p>
    );
  }

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
      //
      // This used to setNote(...) and then assign window.location.href in the
      // same synchronous block. React batches state updates and the navigation
      // won the race every time, so the warning NEVER painted: a real visitor
      // clicking "Upgrade to Pro" went straight to a test-mode Stripe page and
      // had their real card declined with no explanation. Telling someone
      // afterwards does not count as telling them.
      //
      // So in test mode the redirect now waits for an explicit second click.
      // The session is already created and stays valid, so continuing costs
      // nothing; the difference is that the person knows what they are
      // continuing into.
      if (mode === 'test') {
        setNote('Payments are in test mode — a real card will not be charged, and nothing will be activated. Continue only if you are testing checkout.');
        setPendingUrl(url);
        return;
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
      {pendingUrl && (
        <button
          className="btn btn-secondary"
          style={{ marginTop: 8 }}
          onClick={() => { window.location.href = pendingUrl; }}
        >
          Continue to test checkout
        </button>
      )}
      {err && <p className="notice-inline" style={{ marginTop: 8 }}>{err}</p>}
    </>
  );
}
