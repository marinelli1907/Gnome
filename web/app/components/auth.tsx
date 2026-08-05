'use client';

// Shared web auth: email + 6-digit code (OTP). No OAuth redirects to configure,
// works the same on any device, and doubles as the double-opt-in email capture.
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabaseBrowser } from '../../lib/supabaseBrowser';

export function useSession(): { session: Session | null; ready: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, ready };
}

export function SignInCard({ title, blurb }: { title?: string; blurb?: string }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: true,
        // Magic-link fallback returns to this page; the code path needs no redirect.
        emailRedirectTo: window.location.href,
      },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setStage('code');
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (error) setError('That code didn’t work — check it and try again.');
    // On success onAuthStateChange flips the page; nothing else to do here.
  }

  return (
    <div className="authcard">
      <h2>{title ?? 'Sign in to continue'}</h2>
      <p className="sub">
        {blurb ?? 'We’ll email you a sign-in code — no password to remember.'}
      </p>
      {stage === 'email' ? (
        <form
          className="authrow"
          onSubmit={(e) => { e.preventDefault(); if (email.includes('@') && !busy) void sendCode(); }}
        >
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" disabled={busy || !email.includes('@')}>
            {busy ? 'Sending…' : 'Email me a code'}
          </button>
        </form>
      ) : (
        <form
          className="authrow"
          onSubmit={(e) => { e.preventDefault(); if (code.trim().length >= 6 && !busy) void verify(); }}
        >
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" disabled={busy || code.trim().length < 6}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </form>
      )}
      {stage === 'code' && (
        <p className="authhint">
          Sent to <strong>{email}</strong> — enter the code, or just tap the sign-in
          link in the email.{' '}
          <button className="linkbtn" onClick={() => { setStage('email'); setCode(''); }}>
            Use a different email
          </button>
        </p>
      )}
      {error && <p className="autherror">{error}</p>}
      <p className="authhint">
        By continuing you agree to the <a href="/terms">Terms</a> and{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>
    </div>
  );
}
