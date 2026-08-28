'use client';

import { useEffect } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { useSession } from './auth';

const PENDING = 'gnome.pendingReferral';

export default function ReferralCapture({ code, source, marketId }: { code?: string | null; source: 'MARKET_QR' | 'WEB_LINK'; marketId?: string }) {
  const { session } = useSession();
  useEffect(() => {
    if (code) try { localStorage.setItem(PENDING, JSON.stringify({ code, source, marketId })); } catch { /* private mode */ }
    if (!session) return;
    let pending: { code?: string; source?: string; marketId?: string } = { code: code ?? undefined, source, marketId };
    try { pending = JSON.parse(localStorage.getItem(PENDING) ?? '{}'); } catch { /* malformed local state */ }
    if (!pending.code) return;
    void supabaseBrowser().rpc('capture_my_referral', {
      p_code: pending.code, p_source: pending.source === 'MARKET_QR' ? 'MARKET_QR' : 'WEB_LINK', p_market: pending.marketId ?? null,
    }).then(({ error }) => { if (!error || /ALREADY_ATTRIBUTED/.test(error.message)) try { localStorage.removeItem(PENDING); } catch {} });
  }, [code, marketId, session, source]);
  return null;
}
