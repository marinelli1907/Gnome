import type { Metadata } from 'next';
import AccountReadyClient from './AccountReadyClient';

export const metadata: Metadata = {
  title: 'One quick account update',
  description: 'Verify the account requirements needed to post, request, message, and manage a Gnome Market.',
  robots: { index: false },
};

export default function AccountReadyPage() {
  return (
    <main className="container page-theme page-account account-page" style={{ paddingTop: 40, paddingBottom: 64 }}>
      <div className="account-grid">
        <section className="hero page-hero" style={{ paddingTop: 0, paddingBottom: 16 }}>
          <span className="kicker">Account trust</span>
          <h1>One quick account update</h1>
          <p>Complete the verification and marketplace-rule steps required before higher-trust actions unlock.</p>
        </section>
        <section className="section account-main" style={{ paddingTop: 0 }}>
          <AccountReadyClient />
        </section>
      </div>
    </main>
  );
}
