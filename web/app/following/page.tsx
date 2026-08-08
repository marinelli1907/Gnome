import type { Metadata } from 'next';
import FollowingClient from './FollowingClient';

export const metadata: Metadata = {
  title: 'Following — your Markets',
  description: 'The Markets you follow on Gnome, and what they’re growing right now.',
  robots: { index: false },
};

export default function FollowingPage() {
  return (
    <main className="container" style={{ paddingTop: 32, paddingBottom: 64 }}>
      <section className="hero" style={{ paddingTop: 0, paddingBottom: 12 }}>
        <span className="kicker">Your neighborhood, curated</span>
        <h1>Markets you follow</h1>
        <p>Fresh listings from the growers you keep an eye on.</p>
      </section>
      <FollowingClient />
    </main>
  );
}
