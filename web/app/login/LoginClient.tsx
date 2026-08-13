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

// Account + profile: name, town, ZIP, avatar. Writes the user's own
// profiles row (profiles_update_self RLS); avatar goes to the public
// listing-images bucket under the user's own folder.
function AccountView({ email, uid, onSetPassword }: { email: string; uid: string; onSetPassword: () => void }) {
  const [name, setName] = useState('');          // derived public display name
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('OH');
  const [zip, setZip] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    // my_profile() is pinned to auth.uid() server-side and keeps working after
    // the private zip_code column's direct SELECT is revoked.
    supabaseBrowser().rpc('my_profile')
      .then(({ data }) => {
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return;
        setName(row.name ?? '');
        setCity(row.city ?? '');
        setState(row.state ?? 'OH');
        setZip(row.zip_code ?? '');
        setAvatarUrl(row.avatar_url ?? null);
      });
    // Private contact details live in user_private_contact, never on profiles.
    supabaseBrowser().rpc('my_onboarding_state')
      .then(({ data }) => {
        if (!data) return;
        setFirstName(data.first_name ?? '');
        setLastName(data.last_name ?? '');
        setContactEmail(data.contact_email ?? '');
        setPhone(data.phone ?? '');
      });
  }, [uid]);

  async function saveProfile() {
    if (busy) return;
    setBusy(true); setMsg(null);
    // `name` is derived from first/last by save_onboarding_contact — writing it
    // here would let a full legal name onto a world-readable field.
    const { error } = await supabaseBrowser().from('profiles').update({
      city: city.trim() || null,
      state: state.trim().toUpperCase() || null,
      zip_code: zip.trim() || null,
    }).eq('id', uid);
    setBusy(false);
    setMsg(error ? error.message : 'Profile saved.');
  }

  // Identical validated path to the mobile welcome chat: the RPC re-checks
  // every value and derives the public "First L." display name itself.
  async function saveDetails() {
    if (busy) return;
    setBusy(true); setMsg(null);
    const { data, error } = await supabaseBrowser().rpc('save_onboarding_contact', {
      p_first_name: firstName, p_last_name: lastName,
      p_email: contactEmail, p_phone: phone || null,
      p_complete: !!(firstName.trim() && lastName.trim() && contactEmail.trim()),
    });
    setBusy(false);
    if (error) {
      setMsg(/INVALID_EMAIL/.test(error.message) ? 'That email doesn’t look right.'
        : /INVALID_PHONE/.test(error.message) ? 'That phone number doesn’t look right.'
        : error.message);
      return;
    }
    if (data?.display_name) setName(data.display_name);
    setMsg('Details saved.');
  }

  async function uploadAvatar(file: File) {
    setBusy(true); setMsg(null);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.85));
      const sb = supabaseBrowser();
      const path = `${uid}/avatar-${Date.now()}.jpg`;
      const { error: upErr } = await sb.storage.from('listing-images').upload(path, blob, { contentType: 'image/jpeg' });
      if (upErr) throw new Error(upErr.message);
      const url = sb.storage.from('listing-images').getPublicUrl(path).data.publicUrl;
      const { error } = await sb.from('profiles').update({ avatar_url: url }).eq('id', uid);
      if (error) throw new Error(error.message);
      setAvatarUrl(url);
      setMsg('Photo updated.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Upload failed — try a smaller photo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="authcard">
      <h2>Your account</h2>
      <p className="sub">{email}</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '10px 0' }}>
        <div className="avatar lg" style={{ overflow: 'hidden', flex: 'none' }}>
          {avatarUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={avatarUrl} alt="Your photo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : (name || email).charAt(0).toUpperCase()}
        </div>
        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
          {busy ? 'Working…' : avatarUrl ? 'Change photo' : 'Add photo'}
          <input type="file" accept="image/*" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAvatar(f); e.target.value = ''; }} />
        </label>
      </div>

      <div className="field-row">
        <div className="field"><label>First name</label>
          <input maxLength={60} value={firstName} placeholder="First"
            onChange={(e) => setFirstName(e.target.value)} /></div>
        <div className="field"><label>Last name</label>
          <input maxLength={60} value={lastName} placeholder="Last"
            onChange={(e) => setLastName(e.target.value)} /></div>
      </div>
      <div className="field" style={{ marginTop: 8 }}><label>Email for notifications</label>
        <input type="email" value={contactEmail} placeholder="you@example.com"
          onChange={(e) => setContactEmail(e.target.value)} /></div>
      <div className="field" style={{ marginTop: 8 }}><label>Mobile (optional)</label>
        <input inputMode="tel" value={phone} placeholder="For pickup and delivery coordination"
          onChange={(e) => setPhone(e.target.value)} /></div>
      <p className="authhint" style={{ marginTop: 6 }}>
        Neighbors only ever see <strong>{name || 'your first name and last initial'}</strong>.
        Your full last name, email and phone stay private — neighbors reach you
        through Gnome messaging.
      </p>
      <div style={{ marginTop: 8 }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void saveDetails()}>
          Save details
        </button>
      </div>
      <div className="field-row" style={{ marginTop: 8 }}>
        <div className="field"><label>City</label>
          <input value={city} placeholder="City" onChange={(e) => setCity(e.target.value)} /></div>
        <div className="field" style={{ maxWidth: 80 }}><label>State</label>
          <input maxLength={2} value={state} onChange={(e) => setState(e.target.value)} /></div>
        <div className="field" style={{ maxWidth: 110 }}><label>ZIP</label>
          <input inputMode="numeric" maxLength={5} value={zip} onChange={(e) => setZip(e.target.value.replace(/[^0-9]/g, ''))} /></div>
      </div>
      <p className="authhint" style={{ marginTop: 6 }}>
        Your photo and display name show on your Market and listings. Your town
        powers nearby search — your exact address is never shown.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void saveProfile()}>Save profile</button>
        <a className="btn btn-secondary btn-sm" href="/my">My Market</a>
        <button className="btn btn-secondary btn-sm"
          onClick={async () => { await supabaseBrowser().auth.signOut(); window.location.reload(); }}>
          Sign out
        </button>
      </div>
      {msg && <p className="authhint" style={{ marginTop: 10, color: 'var(--green)', fontWeight: 700 }}>{msg}</p>}
      <p className="authhint" style={{ marginTop: 8 }}>
        Want a password (or a new one)?{' '}
        <button className="linkbtn" onClick={onSetPassword}>Set password</button>
      </p>
    </div>
  );
}

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

  // Signed in (and not mid-recovery): account + profile view.
  if (session && mode !== 'reset') {
    return <AccountView email={session.user.email ?? ''} uid={session.user.id} onSetPassword={() => setMode('reset')} />;
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
