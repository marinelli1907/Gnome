import type { Metadata } from 'next';
import Link from 'next/link';

// The Gnome Seed Drop — first-party, garage-run seed shop. Web-only by design:
// the app stays a payment-free community marketplace and links out here.
// Checkout is Stripe Payment Links (created in the Stripe dashboard, pasted
// into env) — no payment code in this repo.

export const metadata: Metadata = {
  title: 'The Gnome Seed Drop — seeds picked for your zone, shipped to your door',
  description:
    'A seed subscription from Gnome. Every drop is chosen for your growing zone and the season, packed by hand in Ohio, and ships anywhere in the U.S. with a growing tip card for each packet.',
};

const PLANS = [
  {
    id: 'starter',
    emoji: '🌱',
    name: 'Starter Pack',
    price: '$12',
    cadence: 'one-time · start here',
    highlight: true,
    blurb:
      '5 hand-picked packets for your USDA zone and the current season, with a growing tip card for each. One-time, no subscription — the low-risk way to try the drop.',
    link: process.env.NEXT_PUBLIC_SEED_LINK_STARTER,
    cta: 'Get the Starter Pack',
  },
  {
    id: 'season',
    emoji: '📦',
    name: 'Season Box',
    price: '$29',
    cadence: 'per season · 4 boxes a year',
    blurb: 'A bigger box at the start of each season — what to sow now, plus one “try something new”.',
    link: process.env.NEXT_PUBLIC_SEED_LINK_SEASON,
    cta: 'Start the Season Box',
  },
  {
    id: 'monthly',
    emoji: '🗓️',
    name: 'Year-Round Grower',
    price: '$9',
    cadence: 'per month',
    blurb: 'A monthly drop timed to your zone — succession sowings, season extenders, winter planning.',
    link: process.env.NEXT_PUBLIC_SEED_LINK_MONTHLY,
    cta: 'Grow year-round',
  },
];

const STEPS = [
  { n: '📍', t: 'Tell us where you grow', d: 'Your zip sets your USDA zone and frost dates — the drop is picked for your actual garden, not a generic calendar.' },
  { n: '🤖', t: 'AI picks the drop', d: 'Each drop is chosen for your zone and the week it ships — and every packet comes with its own growing tip card.' },
  { n: '📦', t: 'Packed & shipped right', d: 'Hand-packed in Ohio and shipped by people who ship for a living. Track it to your door.' },
];

export default function SeedsPage() {
  return (
    <main className="container">
      <section className="hero">
        <h1>The Gnome Seed Drop 🌱</h1>
        <p>
          Seeds picked for <em>your</em> zone and the season — chosen by AI, packed by hand,
          shipped to your door with a growing tip for every packet.
        </p>
      </section>

      <section className="section">
        <div className="steps">
          {STEPS.map((s) => (
            <div key={s.t} className="step">
              <div style={{ fontSize: 28 }}>{s.n}</div>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Pick your drop</h2></div>
        <div className="grid">
          {PLANS.map((p) => (
            <div
              key={p.id}
              className="card"
              style={{
                padding: 20, display: 'flex', flexDirection: 'column', gap: 8,
                ...('highlight' in p && p.highlight
                  ? { border: '2px solid var(--green)', boxShadow: '0 10px 26px rgba(27,67,50,.12)' }
                  : {}),
              }}
            >
              <div style={{ fontSize: 30 }}>{p.emoji}</div>
              <h3 style={{ margin: 0 }}>{p.name}</h3>
              <div>
                <strong style={{ fontSize: 22 }}>{p.price}</strong>{' '}
                <span className="sub">{p.cadence}</span>
              </div>
              <p className="sub" style={{ flex: 1 }}>{p.blurb}</p>
              {p.link ? (
                <a className="btn btn-primary" href={p.link}>{p.cta}</a>
              ) : (
                <span className="btn btn-secondary" aria-disabled style={{ opacity: 0.6, cursor: 'default' }}>
                  Launching this season
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="sub" style={{ marginTop: 12 }}>
          Ships within the U.S., usually within a week of your order. Subscriptions are
          managed through Stripe — change or cancel anytime. Packets that fail to
          germinate get replaced in your next drop, no questions — just tell us.
          Substitutions may occur when a variety sells out; always zone-appropriate.
        </p>
      </section>

      <section className="section">
        <h2>Why a drop, not a catalog?</h2>
        <p className="sub" style={{ maxWidth: 640 }}>
          A thousand seed packets is a chore; the five right ones for your zone, this month,
          is a garden. We do the choosing, you do the growing — and every packet’s tip card
          tells you exactly what to do the week it arrives.
        </p>
      </section>

      <section className="section">
        <h2>Already growing more than you can eat?</h2>
        <p className="sub">
          That’s the other half of Gnome — the neighborhood market where you share, trade,
          and sell your surplus.
        </p>
        <div className="row">
          <Link className="btn btn-secondary" href="/">Browse the neighborhood market</Link>
        </div>
      </section>
    </main>
  );
}
