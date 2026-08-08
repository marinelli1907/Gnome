'use client';

// Follow a Market — writes the user's own market_follows row (RLS from 0005:
// insert/delete/select own rows only). Signed-out clicks route to /login.
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { useSession } from './auth';

export default function FollowButton({ marketId }: { marketId: string }) {
  const { session, ready } = useSession();
  const uid = session?.user?.id;
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid) { setFollowing(false); return; }
    supabaseBrowser().from('market_follows')
      .select('id').eq('market_id', marketId).eq('follower_id', uid).maybeSingle()
      .then(({ data }) => setFollowing(!!data));
  }, [uid, marketId]);

  if (!ready || following === null) return null;

  async function toggle() {
    if (!uid) { window.location.href = '/login'; return; }
    setBusy(true);
    const sb = supabaseBrowser();
    if (following) {
      await sb.from('market_follows').delete().eq('market_id', marketId).eq('follower_id', uid);
      setFollowing(false);
    } else {
      await sb.from('market_follows').insert({ market_id: marketId, follower_id: uid });
      setFollowing(true);
    }
    setBusy(false);
  }

  return (
    <button
      className={`btn ${following ? 'btn-secondary' : 'btn-primary'} btn-sm`}
      disabled={busy}
      onClick={() => void toggle()}
    >
      {following ? '✓ Following' : '+ Follow this Market'}
    </button>
  );
}
