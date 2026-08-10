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
    <main className="container" style={{ paddingTop: 40, paddingBottom: 64 }}>
      <section className="hero" style={{ paddingTop: 0, paddingBottom: 16 }}>
        <span className="kicker">Welcome to the neighborhood</span>
        <h1>Sign in to Gnome</h1>
        <p>Buy from neighbors, or start selling any time — your Market opens with your first listing.</p>
      </section>
      <section className="section" style={{ maxWidth: 460, paddingTop: 0 }}>
        <LoginClient />
      </section>
    </main>
  );
}
