'use client';

// The interactive half of /delete-account. Signed out, it offers the same
// email-code card as the rest of the site — deletion has to prove identity, and
// the edge function takes the user id from the JWT, so signing in IS the
// verification step. Signed in, it asks twice: an explicit checkbox and the
// typed word DELETE, mirroring the two-alert confirm the mobile app uses.
import { useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { SignInCard, useSession } from '../components/auth';

const CONFIRM_WORD = 'DELETE';

export default function DeleteAccountClient() {
  const { session, ready } = useSession();
  const [acknowledged, setAcknowledged] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function runDelete() {
    setBusy(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { data, error: fnErr } = await supabase.functions.invoke('delete-account', { body: {} });
      if (fnErr) {
        // functions.invoke surfaces a non-2xx as an opaque error; the real
        // sentence is in the response body the edge function wrote.
        const body = await (fnErr as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(body?.error ?? 'Could not delete your account.');
      }
      if (!data?.deleted) throw new Error(data?.error ?? 'Could not delete your account.');
      // The auth row is already gone; this just clears the local session so the
      // page doesn't keep rendering a dead JWT.
      await supabase.auth.signOut().catch(() => {});
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete your account.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="authcard">
        <h2>Your account is deleted</h2>
        <p className="sub">
          Everything tied to it has been removed. There&rsquo;s nothing left to sign in to — if you
          ever want to come back, you&rsquo;ll be starting fresh.
        </p>
        <a className="btn btn-secondary" href="/">
          Back to Gnome
        </a>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="authcard">
        <p className="sub">Checking whether you&rsquo;re signed in…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <>
        <p className="sub" style={{ marginTop: 0 }}>
          Sign in first so we know which account to delete. We&rsquo;ll email you a code — this is
          how we verify it&rsquo;s really you, and it&rsquo;s the only step before deletion.
        </p>
        <SignInCard
          title="Sign in to delete your account"
          blurb="We’ll email you a sign-in code. Signing in here does not delete anything on its own — you’ll confirm on the next screen."
        />
      </>
    );
  }

  const canDelete = acknowledged && typed.trim().toUpperCase() === CONFIRM_WORD && !busy;

  return (
    <div className="authcard">
      <h2>Delete {session.user.email}</h2>
      <p className="sub">
        This is the account that will be deleted. If it&rsquo;s not the right one,{' '}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void supabaseBrowser().auth.signOut()}
        >
          sign out
        </button>{' '}
        and sign in as someone else.
      </p>

      <label className="checks" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '16px 0' }}>
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          style={{ marginTop: 4 }}
        />
        <span>
          I understand this is permanent, that my listings and conversations will be removed for
          other people too, and that it cannot be undone.
        </span>
      </label>

      <div className="field">
        <label htmlFor="confirm-delete">
          Type <strong>{CONFIRM_WORD}</strong> to confirm
        </label>
        <input
          id="confirm-delete"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder={CONFIRM_WORD}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>

      {error ? <p className="autherror">{error}</p> : null}

      <button
        type="button"
        className="btn btn-primary"
        disabled={!canDelete}
        onClick={() => void runDelete()}
        style={{ marginTop: 12 }}
      >
        {busy ? 'Deleting…' : 'Delete my account forever'}
      </button>

      <p className="authhint">
        Changed your mind? Close this page — nothing happens until you press the button.
      </p>
    </div>
  );
}
