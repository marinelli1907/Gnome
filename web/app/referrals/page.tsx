import { Suspense } from 'react';
import type { Metadata } from 'next';
import ReferralsClient from './ReferralsClient';

export const metadata: Metadata = { title: 'Referrals & rewards' };

export default function ReferralsPage() {
  return (
    <main className="container" style={{ maxWidth: 780 }}>
      <Suspense fallback={<p className="sub">Loading referrals...</p>}>
        <ReferralsClient />
      </Suspense>
    </main>
  );
}
