import type { Metadata } from 'next';
import GardenClient from './GardenClient';

export const metadata: Metadata = {
  title: 'Zordy Garden Planner — what to plant now, where you live',
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

      <section className="section" style={{ maxWidth: 720 }}>
        <h2>What it looks like</h2>
        <div className="chatlog" aria-label="Example planner conversation">
          <div className="bubble user">What can I still start from seed this month?</div>
          <div className="bubble assistant">
            <p>
              Good timing to ask — in <strong>zone 6b</strong> with first frost around
              mid-October, you have roughly 10 growing weeks left. Safe bets to
              direct-sow this week: <strong>bush beans</strong> (50 days),{' '}
              <strong>spinach</strong> and <strong>leaf lettuce</strong> (they prefer
              the cooling weather), <strong>radishes</strong> (25 days — sow every 10
              days), and <strong>turnips</strong>. Skip direct-seeding broccoli — grab
              transplants instead. One catch: fall daylight is shrinking, so add
              10–14 days to any &ldquo;days to maturity&rdquo; number on the packet.
            </p>
          </div>
        </div>
        <p className="sub" style={{ marginTop: 14 }}>
          The planner considers your town’s hardiness zone, typical frost dates,
          today’s date, and what you tell it about your space, sun, and soil.
          Ask about yellowing tomato leaves, what fits a 4×8 bed, what follows
          spring lettuce, or what handles afternoon shade.
        </p>
        <p className="authhint">
          It’s a knowledgeable helper, not a guarantee — real results depend on
          weather, soil, pests, disease, and seed quality. For pesticide or
          food-regulation questions, follow product labels and local rules.
        </p>
      </section>
    </main>
  );
}
