'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  acceptCurrentAccountPolicies,
  loadAccountPolicyVersions,
  loadAccountReadiness,
  readinessLabel,
  resendEmailVerification,
  verifyEmailCode,
  type AccountPolicyVersions,
  type AccountReadiness,
} from '../../lib/accountReadiness';

export default function AccountReadinessPanel({
  email,
  onReady,
}: {
  email: string;
  onReady?: (readiness: AccountReadiness) => void;
}) {
  const [readiness, setReadiness] = useState<AccountReadiness | null>(null);
  const [policies, setPolicies] = useState<AccountPolicyVersions | null>(null);
  const [emailCode, setEmailCode] = useState('');
  const [emailCooldown, setEmailCooldown] = useState(0);
  const [consent, setConsent] = useState({
    age18: false,
    terms: false,
    privacy: false,
    marketplaceRules: false,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [r, p] = await Promise.all([loadAccountReadiness(), loadAccountPolicyVersions()]);
    setReadiness(r);
    setPolicies(p);
  }, []);

  useEffect(() => {
    if (emailCooldown <= 0) return;
    const timer = window.setTimeout(() => setEmailCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [emailCooldown]);

  useEffect(() => {
    refresh().catch((e) => setMsg(e instanceof Error ? e.message : 'Could not load account status.'));
  }, [refresh]);

  useEffect(() => {
    if (readiness?.account_ready) onReady?.(readiness);
  }, [onReady, readiness]);

  async function run(action: () => Promise<void>, success: string) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await action();
      await refresh();
      setMsg(success);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const items = [
    ['verified_email', readiness?.email_verified],
    ['age_18', readiness?.age_confirmed],
    ['terms', readiness?.terms_accepted],
    ['privacy', readiness?.privacy_accepted],
    ['marketplace_rules', readiness?.marketplace_rules_accepted],
  ] as const;

  return (
    <div className="authcard" style={{ marginTop: 18 }}>
      <h2>One quick account update</h2>
      <p className="sub">
        Posting, Market setup, requests, messaging, and pickup details require a ready account.
      </p>
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {items.map(([key, ok]) => (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>{readinessLabel(key)}</span>
            <strong style={{ color: ok ? 'var(--success-ink)' : 'var(--danger)' }}>
              {ok ? 'Done' : 'Needed'}
            </strong>
          </div>
        ))}
      </div>

      {!readiness?.email_verified && (
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy || !email || emailCooldown > 0}
            onClick={() => void run(async () => {
              await resendEmailVerification(email);
              setEmailCooldown(60);
            }, 'Verification code sent.')}
          >
            {emailCooldown > 0 ? `Resend in ${emailCooldown}s` : 'Email me a verification code'}
          </button>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={emailCode}
            placeholder="6-digit email code"
            maxLength={6}
            onChange={(e) => setEmailCode(e.target.value)}
            style={{ maxWidth: 220 }}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || !email || emailCode.trim().length < 6}
            onClick={() => void run(() => verifyEmailCode(email, emailCode), 'Email verified.')}
          >
            Verify email
          </button>
        </div>
      )}

      {policies && (
        <div style={{ marginTop: 14 }}>
          <p className="authhint">{policies.marketplace_notice}</p>
          {(!readiness?.age_confirmed || !readiness?.terms_accepted || !readiness?.privacy_accepted || !readiness?.marketplace_rules_accepted) && (
            <div style={{ display: 'grid', gap: 10 }}>
              <label><input type="checkbox" checked={consent.age18} onChange={(e) => setConsent((v) => ({ ...v, age18: e.target.checked }))} /> I confirm I am 18 or older</label>
              <label><input type="checkbox" checked={consent.terms} onChange={(e) => setConsent((v) => ({ ...v, terms: e.target.checked }))} /> I accept the <a href="/terms">Terms of Service</a></label>
              <label><input type="checkbox" checked={consent.privacy} onChange={(e) => setConsent((v) => ({ ...v, privacy: e.target.checked }))} /> I accept the <a href="/privacy">Privacy Policy</a></label>
              <label><input type="checkbox" checked={consent.marketplaceRules} onChange={(e) => setConsent((v) => ({ ...v, marketplaceRules: e.target.checked }))} /> I accept the <a href="/trust">Marketplace Rules</a></label>
              <button
                className="btn btn-primary btn-sm"
                disabled={busy || !consent.age18 || !consent.terms || !consent.privacy || !consent.marketplaceRules}
                onClick={() => void run(() => acceptCurrentAccountPolicies(consent), 'Current policies accepted.')}
              >
                Save confirmations
              </button>
            </div>
          )}
        </div>
      )}

      {readiness?.account_ready && (
        <p className="authhint" style={{ marginTop: 12, color: 'var(--success-ink)', fontWeight: 700 }}>
          Your account is ready.
        </p>
      )}
      {msg && <p className="authhint" style={{ marginTop: 10, fontWeight: 700 }}>{msg}</p>}
    </div>
  );
}
