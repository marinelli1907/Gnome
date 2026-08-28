'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SignInCard, useSession } from '../components/auth';
import { supabaseBrowser } from '../../lib/supabaseBrowser';

type Program = {
  code: string; share_url: string; qualified_sellers: number; pending_referrals: number;
  featured_listing_credits: number; featured_market_boosts: number; next_milestone: number | null;
};

export default function ReferralsClient() {
  const { session, ready } = useSession();
  const search = useSearchParams();
  const incoming = search.get('code')?.toUpperCase() ?? '';
  const [program, setProgram] = useState<Program | null>(null);
  const [code, setCode] = useState(incoming);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc('my_referral_program');
    if (error) setMessage('Your referral details could not load. Nothing changed.');
    else setProgram(data as Program);
  }, []);

  const capture = useCallback(async (value: string, source = 'WEB_LINK') => {
    if (!session || !value.trim()) return;
    setBusy(true); setMessage(null);
    const { error } = await supabaseBrowser().rpc('capture_my_referral', {
      p_code: value.trim().toUpperCase(), p_source: source, p_market: null,
    });
    setBusy(false);
    if (error) {
      setMessage(/SELF_REFERRAL/.test(error.message) ? 'You cannot use your own referral code.'
        : /ALREADY_ATTRIBUTED/.test(error.message) ? 'This account already has a referral source.'
          : 'That referral code could not be applied.');
    } else {
      setMessage('Referral saved. Rewards begin only after seller qualification.');
      await load();
    }
  }, [load, session]);

  useEffect(() => { if (session) void load(); }, [load, session]);
  useEffect(() => { if (session && incoming) void capture(incoming, search.get('source') === 'market_qr' ? 'MARKET_QR' : 'WEB_LINK'); }, [capture, incoming, search, session]);

  if (!ready) return <section className="section"><p className="sub">Loading referrals…</p></section>;
  if (!session) return <section className="section"><SignInCard title="You were invited to Gnome" blurb="Sign in with the invited email. Your referral code stays on this page." /></section>;

  const share = async () => {
    if (!program) return;
    if (navigator.share) await navigator.share({ title: 'Join me on Gnome', url: program.share_url }).catch(() => {});
    else { await navigator.clipboard.writeText(program.share_url); setMessage('Referral link copied.'); }
  };

  return (
    <section className="section">
      <div className="section-head"><div><h1>Referrals &amp; rewards</h1><p>Bring qualified local sellers to Gnome. Rewards are issued once, from server-verified activity.</p></div></div>
      {program ? (
        <div className="card" style={{ padding: 18, marginBottom: 14 }}>
          <div className="dc-label">YOUR REFERRAL CODE</div>
          <code style={{ display: 'block', fontSize: 22, margin: '7px 0 12px' }}>{program.code}</code>
          <button className="btn btn-primary" onClick={() => void share()}>Share referral link</button>
          <div className="stats" style={{ marginTop: 16 }}>
            <div><strong>{program.qualified_sellers}</strong><span>Qualified sellers</span></div>
            <div><strong>{program.pending_referrals}</strong><span>Pending</span></div>
            <div><strong>{program.featured_listing_credits}</strong><span>Listing credits</span></div>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <h2 style={{ fontSize: 20 }}>Launch rewards</h2>
        <p><strong>Each qualified seller:</strong> 1 Featured Listing credit for the new seller and 1 for a seller referrer.</p>
        <p><strong>3 qualified:</strong> 3 additional listing credits.</p>
        <p><strong>5 qualified:</strong> 30 days Pro and 5 listing credits.</p>
        <p><strong>10 qualified:</strong> 90 days Pro, 10 listing credits, and 1 Featured Market Boost.</p>
        <p className="sub">A seller qualifies after account readiness and a legitimate public Sell listing. Buyer rewards are deferred until the referrer becomes a seller, rather than issuing a useless seller credit. Milestones 25 and 50 are tracked only; no automatic long-term plan reward is granted.</p>
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <h2 style={{ fontSize: 20 }}>Have a referral code?</h2>
        <div className="authrow">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="GN..." autoCapitalize="characters" />
          <button className="btn btn-secondary btn-sm" disabled={busy || !code.trim()} onClick={() => void capture(code)}>{busy ? 'Saving…' : 'Apply'}</button>
        </div>
        {message ? <p className="notice-inline" style={{ marginTop: 8 }}>{message}</p> : null}
      </div>

      {program?.featured_market_boosts ? (
        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ fontSize: 20 }}>Featured Market Boost available</h2>
          <p className="sub">Activation schedules seven featured days and never changes billing.</p>
          <button className="btn btn-primary" onClick={async () => {
            const { error } = await supabaseBrowser().rpc('redeem_market_featured_boost');
            setMessage(error ? error.message : 'Market Boost scheduled.'); if (!error) await load();
          }}>Activate Market Boost</button>
        </div>
      ) : null}
    </section>
  );
}
