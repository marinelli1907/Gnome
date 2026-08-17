'use client';

// SHARE YOUR MARKET — the seller's link and QR home on My Market.
//
// Two halves with different rules. The Market LINK half works for every plan: copy and share are
// included with Free, full stop. The QR half follows the server's entitled flag from
// my_market_qr() — and a failure to load is rendered as a failure, never as a paywall, because
// telling an entitled seller to upgrade when the RPC errored is the one confusion this screen
// must never cause.
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import {
  brandedQrPng, nakedQrSvg, nakedQrPng, qrTargetUrl, downloadDataUrl, QR_BASE,
} from '../../lib/marketQr';

type QrState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'none' }                                    // no market yet
  | { kind: 'ready'; code: string | null; entitled: boolean; slug: string; name: string };

export default function ShareMarketCard() {
  const [qr, setQr] = useState<QrState>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabaseBrowser().rpc('my_market_qr').then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setQr({ kind: 'error' }); return; }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) { setQr({ kind: 'none' }); return; }
      setQr({ kind: 'ready', code: row.code, entitled: row.entitled === true, slug: row.slug, name: row.market_name ?? 'My Market' });
    });
    return () => { cancelled = true; };
  }, []);

  // Entitled sellers get an on-screen preview of the branded asset.
  useEffect(() => {
    if (qr.kind !== 'ready' || !qr.code || !qr.entitled) return;
    let cancelled = false;
    brandedQrPng(qr.code, qr.name)
      .then((url) => { if (!cancelled) setPreview(url); })
      .catch(() => { if (!cancelled) setExportErr(true); });
    return () => { cancelled = true; };
  }, [qr]);

  if (qr.kind === 'none') return null;

  const marketUrl = qr.kind === 'ready' ? `${QR_BASE}/market/${qr.slug}` : null;

  const copyLink = async () => {
    if (!marketUrl) return;
    await navigator.clipboard.writeText(marketUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = async () => {
    if (!marketUrl || qr.kind !== 'ready') return;
    // Web Share API where it exists (mobile browsers); copy is the desktop fallback.
    if (navigator.share) {
      await navigator.share({ title: qr.name, url: marketUrl }).catch(() => {});
    } else {
      await copyLink();
    }
  };

  const doExport = async (kind: 'png' | 'svg' | 'naked') => {
    if (qr.kind !== 'ready' || !qr.code) return;
    setExportErr(false);
    try {
      if (kind === 'png') {
        downloadDataUrl(await brandedQrPng(qr.code, qr.name), 'gnome-market-qr.png');
      } else if (kind === 'svg') {
        const svg = await nakedQrSvg(qr.code);
        downloadDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, 'gnome-market-qr.svg');
      } else {
        downloadDataUrl(await nakedQrPng(qr.code), 'gnome-market-qr-plain.png');
      }
    } catch {
      // A generation failure is a FAILURE — never rendered as an entitlement problem.
      setExportErr(true);
    }
  };

  return (
    <section className="section" style={{ paddingTop: 8 }}>
      <div className="section-head"><h2>Share your Market</h2></div>
      <div className="card" style={{ padding: 16 }}>
        {qr.kind === 'loading' && <p className="sub" style={{ margin: 0 }}>Loading your Market link…</p>}
        {qr.kind === 'error' && (
          <p className="sub" style={{ margin: 0 }}>
            Your Market link couldn’t load just now. Refresh to try again — nothing about your
            Market has changed.
          </p>
        )}

        {qr.kind === 'ready' && (
          <>
            {/* The link: every plan, always. */}
            <div className="dc-label" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>Market link</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 4 }}>
              <code style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{marketUrl}</code>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyLink()}>
                {copied ? '✓ Copied' : 'Copy link'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void shareLink()}>
                Share
              </button>
            </div>

            {/* The QR: entitlement decides which of three states renders. */}
            <div className="dc-label" style={{ textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 16 }}>
              Your Market QR
            </div>

            {qr.entitled && qr.code ? (
              <div style={{ marginTop: 8 }}>
                {preview ? (
                  <img
                    src={preview}
                    alt={`QR code for ${qr.name}`}
                    style={{ width: 200, maxWidth: '100%', border: '1px solid var(--line, #e6e1d6)', borderRadius: 8 }}
                  />
                ) : !exportErr ? (
                  <p className="sub">Preparing your QR…</p>
                ) : null}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void doExport('png')}>
                    Download sign (PNG)
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void doExport('svg')}>
                    Download SVG
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void doExport('naked')}>
                    Plain QR (PNG)
                  </button>
                </div>
                {exportErr && (
                  <p className="autherror" style={{ marginTop: 6 }}>
                    Generating the QR image failed — this is a technical problem, not a plan
                    problem. Try again.
                  </p>
                )}
                <p className="authhint" style={{ marginTop: 6 }}>
                  Points to {qrTargetUrl(qr.code)} — this destination is yours for good. Print it
                  once; renames and plan changes never break it.
                </p>
              </div>
            ) : qr.code ? (
              // Downgraded: identity exists, toolkit locked. The promise printed on their signs
              // is stated out loud.
              <div style={{ marginTop: 8 }}>
                <p className="sub" style={{ margin: 0 }}>
                  Your existing QR keeps working — anything you’ve printed still opens your Market.
                  Upgrading unlocks the QR design tools again for new signs and downloads.
                </p>
                <a className="btn btn-secondary btn-sm" href="/pricing" style={{ marginTop: 8 }}>
                  Upgrade to unlock QR tools
                </a>
              </div>
            ) : (
              // Free, never issued: honest pitch, nothing hidden, link sharing unaffected above.
              <div style={{ marginTop: 8 }}>
                <p className="sub" style={{ margin: 0 }}>
                  Turn your Market into a scannable sign for your farm stand, packaging, business
                  cards, flyers and social media. Unlock custom Market QR tools with Pro.
                </p>
                <a className="btn btn-primary btn-sm" href="/pricing" style={{ marginTop: 8 }}>
                  Upgrade to Pro — $9.99/month
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
