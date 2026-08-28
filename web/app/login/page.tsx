import type { Metadata } from 'next';
import LoginClient from './LoginClient';

export const metadata: Metadata = {
  title: 'Sign in or create your account',
  description:
    'Sign in to Gnome with a password or an email code — or create a free account and get your own neighborhood Market.',
  alternates: { canonical: '/login' },
  robots: { index: false },
};

export default function LoginPage() {
  return (
    <main className="container page-theme page-account account-page" style={{ paddingTop: 40, paddingBottom: 64 }}>
      <div className="account-grid">
        <section className="hero page-hero" style={{ paddingTop: 0, paddingBottom: 16 }}>
          <span className="kicker">Welcome to the neighborhood</span>
          <h1>Sign in to Gnome</h1>
          <p>Buy from neighbors, or start selling any time — your Market opens with your first listing.</p>
        </section>
        <section className="section account-main" style={{ paddingTop: 0 }}>
          <LoginClient />
        </section>
        <aside className="page-side account-side" aria-label="Account features">
          <div className="side-card side-card-orange">
            <strong>Your Market</strong>
            <p>Manage listings, pickup details, QR tools, and buyer messages.</p>
          </div>
          <div className="side-card side-card-blue">
            <strong>Private Pickup</strong>
            <p>Exact addresses stay hidden until a claim is accepted.</p>
          </div>
          <div className="side-card side-card-green">
            <strong>Grow Locally</strong>
            <p>Your town powers nearby search without exposing your home.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
