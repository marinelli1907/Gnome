'use client';

// Follow a Market — writes the user's own market_follows row (RLS from 0005:
// insert/delete/select own rows only).
//
// Hardened per the Following directive:
//   * the UI only flips after the server accepted the write — a failed
//     mutation shows an error and keeps the real state;
//   * duplicate taps are blocked by the busy flag, and the insert itself is
//     idempotent (unique key + upsert-ignore) so a race can't double-follow;
//   * a signed-out tap remembers WHICH market the buyer wanted
//     (sessionStorage) and sends them to /login?next=<this page>; when they
//     come back signed in, the follow completes by itself.
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { useSession } from './auth';

const PENDING_KEY = 'gnome-pending-follow';

// Canonical follow analytics (market_followed / market_unfollowed): an
// authenticated, best-effort events insert — same posture as the Drops editor.
function logFollowEvent(eventType: string, marketId: string) {
  try {
    void supabaseBrowser().from('events')
      .insert({ event_type: eventType, metadata: { market: marketId } })
      .then(() => {}, () => {});
  } catch { /* analytics never breaks the button */ }
}

export default function FollowButton({ marketId }: { marketId: string }) {
  const { session, ready } = useSession();
  const uid = session?.user?.id;
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function follow(id: string, userId: string): Promise<boolean> {
    const { error: err } = await supabaseBrowser()
      .from('market_follows')
      .upsert({ market_id: id, follower_id: userId },
              { onConflict: 'market_id,follower_id', ignoreDuplicates: true });
    if (err) return false;
    logFollowEvent('market_followed', id);
    return true;
  }

  // A stored intent is only completed if the Market is STILL publicly
  // followable — canonical visibility (public_markets: status='active') is
  // re-resolved at completion time, never assumed from the moment of the tap.
  async function completePendingFollow(id: string, userId: string): Promise<boolean> {
    const { data } = await supabaseBrowser()
      .from('public_markets').select('id').eq('id', id).maybeSingle();
    if (!data) return false;
    return follow(id, userId);
  }

  useEffect(() => {
    if (!uid) { setFollowing(false); return; }
    let alive = true;
    void (async () => {
      const { data, error: err } = await supabaseBrowser().from('market_follows')
        .select('id').eq('market_id', marketId).eq('follower_id', uid).maybeSingle();
      if (!alive) return;
      let isFollowing = !err && !!data;
      // Back from sign-in with this market's follow still pending? Finish it.
      if (!isFollowing && sessionStorage.getItem(PENDING_KEY) === marketId) {
        isFollowing = await completePendingFollow(marketId, uid);
      }
      if (sessionStorage.getItem(PENDING_KEY) === marketId) {
        sessionStorage.removeItem(PENDING_KEY);
      }
      if (alive) setFollowing(isFollowing);
    })();
    return () => { alive = false; };
  }, [uid, marketId]);

  if (!ready || following === null) return null;

  async function toggle() {
    if (busy) return;
    if (!uid) {
      // Remember the intent and come back to this exact Market after auth.
      try { sessionStorage.setItem(PENDING_KEY, marketId); } catch { /* private mode */ }
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?next=${next}`;
      return;
    }
    setBusy(true); setError(false);
    if (following) {
      const { error: err } = await supabaseBrowser().from('market_follows')
        .delete().eq('market_id', marketId).eq('follower_id', uid);
      if (err) setError(true);
      else { setFollowing(false); logFollowEvent('market_unfollowed', marketId); }
    } else {
      const ok = await follow(marketId, uid);
      if (ok) setFollowing(true); else setError(true);
    }
    setBusy(false);
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        className={`btn ${following ? 'btn-secondary' : 'btn-primary'} btn-sm`}
        disabled={busy}
        onClick={() => void toggle()}
      >
        {busy ? '…' : following ? '✓ Following' : '+ Follow this Market'}
      </button>
      {error && (
        <span style={{ fontSize: 12, color: 'var(--danger, #C62828)' }}>
          That didn’t stick — try again.
        </span>
      )}
    </span>
  );
}
