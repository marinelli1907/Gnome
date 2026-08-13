import type { Metadata } from 'next';
import Link from 'next/link';
import SeedProfileClient from './SeedProfileClient';

// The Gnome Seed Drop is not open. This page used to render Stripe Payment
// Links from NEXT_PUBLIC_SEED_LINK_* — inert in production only because those
// vars were unset, which means one env var away from a live purchase path for
// a product that has no prices, no launch date and no fulfilment. The links
// are deleted rather than flagged off so there is nothing left to re-arm.
// Everything below is a preview of the shape of the product; the garden
// profile stores preferences and nothing else.

export const metadata: Metadata = {
  title: 'The Gnome Seed Drop — coming soon',
  description:
    'Seed Drop is growing. Personalized seed selections based on your location, growing space and season are coming soon from Gnome.',
};

// Preview only — packet counts are the plan, not a commitment, and no size
// is open. Nothing here carries a price or a date.
const DROPS = [
  {
    id: 'patio',
    emoji: '🪴',
    name: 'Patio Drop',
    packets: '4 packets',
    blurb: 'A small mix for containers, a balcony, or a bright windowsill.',
  },
  {
    id: 'garden',
    emoji: '🌿',
    name: 'Garden Drop',
    packets: '8 packets',
    blurb: 'Enough variety for a raised bed or a modest backyard plot.',
  },
  {
    id: 'homestead',
    emoji: '🚜',
    name: 'Homestead Drop',
    packets: '12 packets',
    blurb: 'A full season’s spread for a large garden or a market patch.',
  },
  {
    id: 'custom',
    emoji: '✍️',
    name: 'Build Your Drop',
    packets: '4–20 packets',
    blurb: 'Choose your own packet count and let Gnome fill it in around you.',
  },
];

// The rhythms being planned. Also preview only — none of them are open.
const FREQUENCIES = ['Monthly', 'Every other month', 'Seasonal', 'One-time'];

const STEPS = [
  {
    n: '📦',
    t: 'You choose your Drop size',
    d: 'Pick how many packets come in a Drop and how often one arrives. A bigger Drop means more variety, not more of the same seed.',
  },
  {
    n: '📖',
    t: 'Gnome explains every packet',
    d: 'Each packet will say what it can grow — what it turns into, roughly how long it takes, and what it needs from you along the way.',
  },
  {
    n: '📍',
    t: 'Picked for where you actually grow',
    d: 'Recommendations will weigh your location, how much sun you get, the space you’re working with, and the season you’re in.',
  },
  {
    n: '🌎',
    t: 'What Gnome can send varies',
    d: 'Seed selections differ by location and by season, so two neighbors in different regions won’t see the same suggestions.',
  },
];

export default function SeedsPage() {
  return (
    <main className="container">
      <section className="hero">
        <span className="kicker">Coming soon</span>
        <h1>Seed Drop is growing 🌱</h1>
        <p>
          Personalized seed selections based on your location, growing space and
          season are coming soon. This page is a look at what Gnome is building —
          Seed Drop is not open yet, and there’s nothing here to pay for.
        </p>
      </section>

      <section className="section">
        <div className="section-head"><h2>How the Drop will work</h2></div>
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
        <div className="section-head"><h2>Drop sizes — preview</h2></div>
        <p className="sub">
          The sizes Gnome is planning. None of them are open yet.
        </p>
        <div className="grid">
          {DROPS.map((d) => (
            <div
              key={d.id}
              className="card"
              style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <div style={{ fontSize: 30 }}>{d.emoji}</div>
              <h3 style={{ margin: 0 }}>{d.name}</h3>
              <div><strong style={{ fontSize: 18 }}>{d.packets}</strong></div>
              <p className="sub" style={{ flex: 1 }}>{d.blurb}</p>
              <span
                className="chip"
                style={{ display: 'inline-block', alignSelf: 'flex-start', cursor: 'default' }}
              >
                Preview — not yet available
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>How often — preview</h2></div>
        <p className="sub">
          The rhythms Gnome is planning. You’ll choose one when Seed Drop opens.
        </p>
        <div className="chiprow">
          {FREQUENCIES.map((f) => (
            <span key={f} className="chip" style={{ cursor: 'default' }}>{f}</span>
          ))}
        </div>
        <p className="sub" style={{ marginTop: 16 }}>
          Packet counts and rhythms may still change before Seed Drop opens, and what
          Gnome can send will vary by location and season. No opening date has been set.
        </p>
      </section>

      <section className="section" style={{ maxWidth: 640 }}>
        <div className="section-head"><h2>Tell Gnome about your garden</h2></div>
        <p className="sub">
          Optional, and it reserves nothing. It saves how and where you grow, so
          Gnome’s first suggestions fit your garden instead of starting from scratch.
        </p>
        <SeedProfileClient />
      </section>

      <section className="section">
        <h2>Why a drop, not a catalog?</h2>
        <p className="sub" style={{ maxWidth: 640 }}>
          A thousand seed packets is a chore; the handful that suit your zone, this
          month, is a garden. The idea is that Gnome does the choosing and you do the
          growing — and every packet explains what to do the week it lands.
        </p>
      </section>

      <section className="section">
        <h2>Already growing more than you can eat?</h2>
        <p className="sub">
          That’s the other half of Gnome — the neighborhood market where you share, trade,
          and sell your surplus. That part is open today.
        </p>
        <div className="row">
          <Link className="btn btn-secondary" href="/">Browse the neighborhood market</Link>
        </div>
      </section>
    </main>
  );
}
