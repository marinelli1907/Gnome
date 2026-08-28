'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AccountReadinessPanel from '../components/AccountReadinessPanel';
import { SignInCard, useSession } from '../components/auth';
import { loadAccountReadiness, type AccountReadiness } from '../../lib/accountReadiness';
import { supabaseBrowser } from '../../lib/supabaseBrowser';

type Preview = {
  case_id: string;
  business_name: string;
  status: string;
  total_drafts: number;
  ready: number;
  needs_info: number;
  needs_compliance: number;
  expires_at: string;
};

type ClaimResult = {
  case_id: string;
  market_id: string;
  business_name: string;
  status?: string;
  total_drafts?: number;
  market_reviewed_at?: string | null;
};

type PersistedClaim = {
  id: string;
  business_name: string;
  status: string;
  claimed_market_id: string;
  market_reviewed_at: string | null;
};

const first = <T,>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? value[0] ?? null : value;

function friendlyError(message: string): string {
  if (/INVITE_EMAIL_MISMATCH/.test(message)) return 'This invitation belongs to a different email address. Switch accounts and use the mailbox that received it.';
  if (/EMAIL_OTP_SESSION_REQUIRED/.test(message)) return 'Open the sign-in link in the invitation email on this device to verify the mailbox.';
  if (/ACCOUNT_SUSPENDED/.test(message)) return 'This account is suspended and cannot claim a Market.';
  if (/INVALID_OR_EXPIRED_INVITE|INVALID_INVITE/.test(message)) return 'This invitation is invalid, expired, or already used.';
  if (/ACCOUNT_NOT_READY/.test(message)) return 'Finish the account update before claiming this Market.';
  return message || 'The invitation could not be verified.';
}

export default function ClaimMarketClient() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const claimedCaseId = params.get('claimed') ?? '';
  const { session, ready: sessionReady } = useSession();
  const verificationStarted = useRef<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [readiness, setReadiness] = useState<AccountReadiness | null>(null);
  const [claimed, setClaimed] = useState<ClaimResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshReadiness = useCallback(async () => {
    const current = await loadAccountReadiness();
    setReadiness(current);
    return current;
  }, []);

  const loadPersistedClaim = useCallback(async (caseId?: string) => {
    if (!session) return null;
    const supabase = supabaseBrowser();
    let query = supabase
      .from('seller_concierge_cases')
      .select('id,business_name,status,claimed_market_id,market_reviewed_at')
      .eq('claimed_by', session.user.id)
      .not('claimed_at', 'is', null);
    query = caseId
      ? query.eq('id', caseId)
      : query.order('claimed_at', { ascending: false }).limit(1);
    const { data, error: claimStateError } = await query.maybeSingle();
    if (claimStateError) throw claimStateError;
    const row = data as PersistedClaim | null;
    if (!row) return null;
    const { count, error: countError } = await supabase
      .from('seller_concierge_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', row.id);
    if (countError) throw countError;
    const result: ClaimResult = {
      case_id: row.id,
      market_id: row.claimed_market_id,
      business_name: row.business_name,
      status: row.status,
      total_drafts: count ?? 0,
      market_reviewed_at: row.market_reviewed_at,
    };
    setClaimed(result);
    return result;
  }, [session]);

  useEffect(() => {
    if (!sessionReady || token) return;
    if (!session) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        await loadPersistedClaim(claimedCaseId || undefined);
      } catch (cause) {
        setError(friendlyError(cause instanceof Error ? cause.message : ''));
      } finally {
        setLoading(false);
      }
    })();
  }, [claimedCaseId, loadPersistedClaim, session, sessionReady, token]);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const { data, error: previewError } = await supabaseBrowser().rpc('concierge_claim_preview', { p_token: token });
        if (previewError) throw previewError;
        const row = first<Preview>(data as Preview | Preview[] | null);
        if (!row) throw new Error('INVALID_OR_EXPIRED_INVITE');
        setPreview(row);
      } catch (cause) {
        setError(friendlyError(cause instanceof Error ? cause.message : ''));
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  useEffect(() => {
    if (!token || !session || !preview || preview.status === 'CLAIMED') return;
    const attemptKey = `${session.user.id}:${session.access_token}:${token}`;
    if (verificationStarted.current === attemptKey) return;
    verificationStarted.current = attemptKey;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const { error: verifyError } = await supabaseBrowser().rpc('verify_concierge_email', { p_token: token });
        if (verifyError) throw verifyError;
        await refreshReadiness();
      } catch (cause) {
        setError(friendlyError(cause instanceof Error ? cause.message : ''));
      } finally {
        setBusy(false);
      }
    })();
  }, [preview, refreshReadiness, session, token]);

  useEffect(() => {
    if (preview?.status !== 'CLAIMED' || !session) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await loadPersistedClaim(preview.case_id);
      } catch (cause) {
        setError(friendlyError(cause instanceof Error ? cause.message : ''));
      } finally {
        setBusy(false);
      }
    })();
  }, [loadPersistedClaim, preview, session]);

  async function switchAccount() {
    await supabaseBrowser().auth.signOut();
    verificationStarted.current = null;
    setReadiness(null);
    setError(null);
  }

  async function claim() {
    if (!token || busy || !readiness?.account_ready) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: claimError } = await supabaseBrowser().rpc('claim_prepared_market', { p_token: token });
      if (claimError) throw claimError;
      const result = data as ClaimResult;
      setClaimed({ ...result, total_drafts: preview?.total_drafts ?? 0 });
      window.history.replaceState(null, '', `/claim-market?claimed=${encodeURIComponent(result.case_id)}`);
    } catch (cause) {
      setError(friendlyError(cause instanceof Error ? cause.message : ''));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !sessionReady) return <div className="authcard"><p className="sub">Checking your invitation...</p></div>;
  if (claimed) {
    return (
      <div className="authcard">
        <h2>Market claimed</h2>
        <p className="sub"><strong>{claimed.business_name}</strong> is ready for your review.</p>
        <p className="authhint">{claimed.total_drafts ?? 0} private draft listing{claimed.total_drafts === 1 ? '' : 's'} prepared</p>
        <p className="authhint">The prepared products are still private drafts. Review, edit, or discard each one before publishing.</p>
        <a className="btn btn-primary btn-sm" href={`/my/import?case=${encodeURIComponent(claimed.case_id)}`}>Review my Market</a>
      </div>
    );
  }

  if (preview?.status === 'CLAIMED') {
    return (
      <div className="authcard">
        <h2>This Market has already been claimed</h2>
        <p className="sub">The invitation is single-use and cannot create another Market or another set of drafts.</p>
        {session ? <a className="btn btn-primary btn-sm" href={`/my/import?case=${encodeURIComponent(preview.case_id)}`}>Go to my Market</a> : null}
      </div>
    );
  }

  if (!token || (!preview && error)) return <div className="authcard"><h2>Invitation unavailable</h2><p className="autherror">{error ?? 'This invitation link is incomplete.'}</p></div>;
  if (!preview) return <div className="authcard"><p className="sub">Checking your invitation...</p></div>;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="authcard">
        <h2>{preview.business_name}</h2>
        <p className="sub">{preview.total_drafts} private product draft{preview.total_drafts === 1 ? '' : 's'} prepared</p>
        <p className="authhint">
          {preview.ready} ready · {preview.needs_info} need information · {preview.needs_compliance} need compliance review
        </p>
        <p className="authhint">Nothing becomes public until you review and publish it.</p>
      </div>

      {!session ? (
        <SignInCard
          title="Verify the invited mailbox"
          blurb="Use the email address that received this invitation. The one-time link proves the mailbox belongs to you."
        />
      ) : error ? (
        <div className="authcard">
          <h2>Verification needs attention</h2>
          <p className="autherror">{error}</p>
          <button className="btn btn-secondary btn-sm" onClick={() => void switchAccount()}>Switch account</button>
        </div>
      ) : busy && !readiness ? (
        <div className="authcard"><p className="sub">Verifying the invited mailbox...</p></div>
      ) : !readiness?.account_ready ? (
        <AccountReadinessPanel email={session.user.email ?? ''} onReady={setReadiness} />
      ) : (
        <div className="authcard">
          <h2>Ready to claim</h2>
          <p className="sub">Your email and account requirements are verified. Claiming creates private drafts only.</p>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void claim()}>
            {busy ? 'Claiming...' : 'Claim my Market'}
          </button>
        </div>
      )}
    </div>
  );
}
