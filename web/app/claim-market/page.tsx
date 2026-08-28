import type { Metadata } from 'next';
import { Suspense } from 'react';
import ClaimMarketClient from './ClaimMarketClient';

export const metadata: Metadata = {
  title: 'Claim your prepared Market',
  description: 'Securely verify your invitation and review the Market Gnome prepared for you.',
  robots: { index: false },
};

export default function ClaimMarketPage() {
  return (
    <main className="container page-theme page-account account-page" style={{ paddingTop: 40, paddingBottom: 64 }}>
      <div className="account-grid">
        <section className="hero page-hero" style={{ paddingTop: 0, paddingBottom: 16 }}>
          <span className="kicker">Seller Concierge</span>
          <h1>Claim your prepared Market</h1>
          <p>Verify the invited mailbox, finish the account update, and review everything before it becomes public.</p>
        </section>
        <section className="section account-main" style={{ paddingTop: 0 }}>
          <Suspense fallback={<div className="authcard"><p className="sub">Checking your invitation...</p></div>}>
            <ClaimMarketClient />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
