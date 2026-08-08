'use client';

// Classic email + password auth alongside the existing email-code flow.
// Same Supabase auth backend (sessions, RLS, everything identical) — this
// just adds the password door. Handles: sign in, create account, forgot
// password (recovery email → set a new password here), signed-in account
// view with sign out.
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { SignInCard, useSession } from '../components/auth';

type Mode = 'signin' | 'signup' | 'forgot' | 'reset' | 'code';

export default function LoginClient() {
  const { session, ready } = useSession();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Arriving from a password-recovery email puts a special session in place —
  // offer the new-password form.
  useEffect(() => {
    const { data: sub } = supabaseBrowser().auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('reset');
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn() {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({
      email: email.trim(), password,
    });
    setBusy(false);
    if (error) {
      setError(
        error.message.includes('Invalid login credentials')
          ? 'Email or password didn’t match. If you usually sign in with an email code, use “email me a code” below — or set a password via “Forgot password”.'
          : error.message,
      );
    } else {
      window.location.href = '/my';
    }
  }

  async function signUp() {
    if (busy) return;
    if (password.length < 8) return setError('Password needs at least 8 characters.');
    setBusy(true); setError(null); setNotice(null);
    const { data, error } = await supabaseBrowser().auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else if (data.session) window.location.href = '/my';
    else setNotice('Check your email to confirm your account — then sign in here.');
  }

  async function forgot() {
    if (busy) return;
    if (!email.trim()) return setError('Enter your email first.');
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/login`,
    });
    setBusy(false);
    if (error) setError(error.message);
    else setNotice('Reset link sent — open it on this device and you’ll set a new password here.');
  }

  async function setNewPassword() {
    if (busy) return;
    if (password.length < 8) return setError('Password needs at least 8 characters.');
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else { setNotice('Password updated. You’re signed in.'); setMode('signin'); }
  }

  if (!ready) return <div className="empty"><p>Loading…</p></div>;

  // Signed in (and not mid-recovery): account view.
  if (session && mode !== 'reset') {
    return (
      <div className="authcard">
        <h2>You’re signed in</h2>
        <p className="sub">{session.user.email}</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a className="btn btn-primary btn-sm" href="/my">My Market</a>
          <button
            className="btn btn-secondary btn-sm"
            onClick={async () => { await supabaseBrowser().auth.signOut(); window.location.reload(); }}
          >
            Sign out
          </button>
        </div>
        <p className="authhint" style={{ marginTop: 12 }}>
          Want a password (or a new one)?{' '}
          <button className="linkbtn" onClick={() => setMode('reset')}>Set password</button>
        </p>
      </div>
    );
  }

  if (mode === 'code') {
    return (
      <div>
        <SignInCard title="Email me a code" blurb="No password needed — we’ll email you a 6-digit code." />
        <p className="authhint" style={{ marginTop: 10 }}>
          <button className="linkbtn" onClick={() => setMode('signin')}>← Use a password instead</button>
        </p>
      </div>
    );
  }

  return (
    <div className="authcard">
      {mode !== 'reset' && (
        <div className="seg" style={{ marginBottom: 16 }}>
          <button type="button" className={`seg-btn${mode === 'signin' ? ' active' : ''}`} onClick={() => { setMode('signin'); setError(null); }}>
            Sign in
          </button>
          <button type="button" className={`seg-btn${mode === 'signup' ? ' active' : ''}`} onClick={() => { setMode('signup'); setError(null); }}>
            Create account
          </button>
        </div>
      )}

      {mode === 'reset' ? (
        <>
          <h2>Set a new password</h2>
          <div className="field" style={{ marginTop: 10 }}>
            <label>New password (8+ characters)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void setNewPassword(); }} />
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={() => void setNewPassword()}>
            {busy ? 'Saving…' : 'Save password'}
          </button>
        </>
      ) : mode === 'forgot' ? (
        <>
          <h2>Forgot password</h2>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void forgot(); }} />
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={() => void forgot()}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
          <p className="authhint" style={{ marginTop: 10 }}>
            <button className="linkbtn" onClick={() => setMode('signin')}>← Back to sign in</button>
          </p>
        </>
      ) : (
        <>
          <div className="field">
            <label>Email</label>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Password{mode === 'signup' ? ' (8+ characters)' : ''}</label>
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void (mode === 'signup' ? signUp() : signIn()); }}
            />
          </div>
          <button className="btn btn-primary" style={{ marginTop: 14, width: '100%' }} disabled={busy}
            onClick={() => void (mode === 'signup' ? signUp() : signIn())}>
            {busy ? 'One moment…' : mode === 'signup' ? 'Create my account' : 'Sign in'}
          </button>
          <p className="authhint" style={{ marginTop: 12 }}>
            <button className="linkbtn" onClick={() => setMode('code')}>Email me a code instead</button>
            {mode === 'signin' && (
              <> · <button className="linkbtn" onClick={() => setMode('forgot')}>Forgot password?</button></>
            )}
          </p>
          {mode === 'signup' && (
            <p className="authhint">By continuing you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>
          )}
        </>
      )}

      {error && <p className="autherror">{error}</p>}
      {notice && <p className="authhint" style={{ color: 'var(--green)', fontWeight: 700 }}>{notice}</p>}
    </div>
  );
}
