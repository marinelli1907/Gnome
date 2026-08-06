'use client';

// Upgrade button: appends the signed-in user's market id as
// client_reference_id so the Stripe webhook knows which market to upgrade.
// Unconfigured (no payment link env) → honest "coming soon" state.
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';
import { useSession } from '../components/auth';

export default function PricingCTA({
  link, label, primary,
}: { link: string | undefined; label: string; primary?: boolean }) {
  const { session, ready } = useSession();
  const [marketId, setMarketId] = useState<string | null>(null);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    supabaseBrowser()
      .from('markets')
      .select('id')
      .eq('owner_id', uid)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setMarketId(data?.id ?? null));
  }, [session?.user?.id]);

  const cls = `btn ${primary ? 'btn-primary' : 'btn-secondary'}`;

  if (!link) {
    return <button className={cls} disabled title="Paid plans are almost here">Coming soon</button>;
  }
  if (ready && !session) {
    return <a className={cls} href="/sell">Sign in to upgrade</a>;
  }
  const href = marketId ? `${link}?client_reference_id=${marketId}` : link;
  return <a className={cls} href={href}>{label}</a>;
}
