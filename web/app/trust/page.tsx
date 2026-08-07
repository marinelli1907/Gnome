import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Trust & Safety — built for neighborly exchanges',
  description:
    'How Gnome keeps neighborhood exchanges friendly and safe: approximate public locations, private pickup details, reporting and blocking, safe-pickup guidance, and food-safety reminders.',
  alternates: { canonical: '/trust' },
};

const PILLARS = [
  {
    emoji: '📍',
    t: 'Your address stays private',
    d: 'Public listings show an approximate area only — never your home address. Locations are rounded to roughly a neighborhood-sized cell, and exact pickup details are shared only after you approve a request, by you, when you choose.',
  },
  {
    emoji: '💬',
    t: 'Private messaging',
    d: 'Pickup chat opens only between a seller and the neighbor they approved — nobody else can read it. Conversations stay attached to the exchange, so there’s a record if something goes wrong.',
  },
  {
    emoji: '🚩',
    t: 'Report & block',
    d: 'Every listing, Market, and conversation in the Gnome app has a report option, and you can block any user — they can’t message you or interact with your listings again. Reports go to a human.',
  },
  {
    emoji: '🤝',
    t: 'Earned trust, not star ratings',
    d: 'Grower profiles show objective history — how long they’ve been on Gnome, how much they’ve shared and completed, and how quickly they respond. No anonymous one-star drama; just a track record.',
  },
];

export default function TrustPage() {
  return (
    <main className="container" style={{ paddingBottom: 56 }}>
      <section className="hero" style={{ paddingBottom: 16 }}>
        <span className="kicker">Trust &amp; Safety</span>
        <h1>Built for neighborly exchanges</h1>
        <p>
          Gnome is neighbors trading tomatoes, not strangers meeting in parking
          lots. Here’s how the platform is designed to keep it that way.
        </p>
      </section>

      <section className="section">
        <div className="steps">
          {PILLARS.map((p) => (
            <div className="step" key={p.t}>
              <div className="n">{p.emoji}</div>
              <h3>{p.t}</h3>
              <p>{p.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" style={{ maxWidth: 760 }}>
        <h2>Meeting up, the smart way</h2>
        <ul className="checks">
          <li>First exchanges work great in a public spot — a porch, a driveway, a market, a library lot.</li>
          <li>Daylight pickups are easiest for everyone; bring a friend if it makes you comfortable.</li>
          <li>Keep the conversation in Gnome until you’ve met — it keeps a record attached to the exchange.</li>
          <li>Payment for sales is arranged directly between neighbors — cash or any app you both trust. Gnome never takes a cut, and nobody from Gnome will ever ask for your payment details.</li>
          <li>If something feels off, cancel. A declined pickup costs nothing; ignoring your gut can.</li>
        </ul>
      </section>

      <section className="section" style={{ maxWidth: 760 }}>
        <h2>Food safety, between neighbors</h2>
        <p className="sub" style={{ maxWidth: 700 }}>
          Sellers are responsible for what they share and for following their local
          rules. A few things worth knowing before you post or pick up:
        </p>
        <ul className="checks">
          <li><strong>Produce, plants, seeds, flowers</strong> — the heart of Gnome, and generally the simplest to share. Wash before eating, as with anything homegrown.</li>
          <li><strong>Eggs</strong> — many states (including Ohio) have small-flock rules on labeling, refrigeration, and where they can be sold. Check yours before selling.</li>
          <li><strong>Baked &amp; canned goods</strong> — usually covered by state “cottage food” laws that limit what can be sold from a home kitchen and require labels. Look up your state’s list.</li>
          <li><strong>Meat &amp; dairy</strong> — heavily regulated nearly everywhere and mostly not legal to sell neighbor-to-neighbor without licenses. When in doubt, don’t.</li>
          <li><strong>Not welcome on Gnome</strong> — alcohol, cannabis, tobacco, prescription products, weapons, and unsafe chemicals. Pesticides and fertilizers only in original labeled packaging.</li>
        </ul>
        <p className="authhint" style={{ marginTop: 14 }}>
          This is friendly guidance, not legal advice — rules differ by state and
          county, and it’s each seller’s job to know the ones that apply to them.
          When you’re unsure, your county extension office is a great first call.
        </p>
      </section>

      <section className="section" style={{ maxWidth: 760 }}>
        <h2>Growing with AI, honestly</h2>
        <p className="sub" style={{ maxWidth: 700 }}>
          The Garden Planner and listing assistant are AI helpers. They’re good at
          zone-aware timing and friendly drafts; they’re not a substitute for local
          expertise, pesticide labels, or food-regulation guidance. Results depend
          on weather, soil, pests, and seed quality — treat suggestions as a
          starting point, and always follow product labels and local rules.
        </p>
      </section>

      <section className="section">
        <div className="row">
          <Link className="btn btn-primary" href="/browse">Browse near you</Link>
          <Link className="btn btn-secondary" href="/terms">Terms</Link>
          <Link className="btn btn-secondary" href="/privacy">Privacy</Link>
        </div>
      </section>
    </main>
  );
}
