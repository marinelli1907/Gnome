import type { Metadata } from 'next';
import GardenClient from './GardenClient';

export const metadata: Metadata = {
  title: 'AI Garden Planner — what to plant now, where you live',
  description:
    'Tell Gnome where your garden is and get a planting plan for this exact week — zone-aware picks, spacing, timing, and beginner tips. Free during beta.',
};

export default function GardenPage() {
  return (
    <main className="container">
      <section className="hero" style={{ paddingBottom: 8 }}>
        <span className="kicker">Free during beta</span>
        <h1>Know exactly what to plant this week</h1>
        <p>
          The Gnome garden planner knows your hardiness zone, your frost dates,
          and today’s date. Ask it anything — it answers for <em>your</em> town,
          not a generic almanac. Then list the surplus on Gnome. 🍅
        </p>
      </section>
      <section className="section" style={{ maxWidth: 720 }}>
        <GardenClient />
      </section>
    </main>
  );
}
