import type { Metadata } from 'next';
import Link from 'next/link';
import { GnomeMascot, Vine } from '../components/art';
import ListingCard from '../components/ListingCard';
import { getActiveListings } from '@/lib/gnome';

export const revalidate = 120;

export const metadata: Metadata = {
  title: 'Reserve a plot — a neighbor grows it for you',
  description:
    'Reserve a plot in a local grower’s garden, pick the crop, and they grow it for you. Growers: turn your whole garden into income with plot reservations on Gnome.',
  alternates: { canonical: '/plots' },
};

const STEPS = [
  { n: '🗺️', t: 'Pick a plot', d: 'Local growers offer pieces of their garden — a raised bed, a row, a corner of the greenhouse.' },
  { n: '🍅', t: 'Choose the crop', d: 'Tell the grower what you want grown. Heirloom tomatoes, salsa peppers, cut flowers — your call.' },
  { n: '🧑‍🌾', t: 'They grow it', d: 'Your grower plants, tends, and harvests. You get updates and garden-fresh food without the weeding.' },
  { n: '🧺', t: 'Pick up the harvest', d: 'Reservation and payment are arranged directly with the grower — Gnome takes no cut.' },
];

export default async function PlotsPage() {
  const plots = await getActiveListings({ listingType: 'plot', limit: 24 });

  return (
    <main>
      <section className="container hero" style={{ paddingBottom: 20 }}>
        <span className="kicker">🌱 Reserve a plot</span>
        <h1>A neighbor’s garden, growing what <em>you</em> want.</h1>
        <p>
          Reserve a plot in a local grower’s garden and pick the crop. They do the
          growing; you get the harvest. No yard, no time, no problem.
        </p>
        <div className="row">
          {plots.length > 0 && <a className="btn btn-primary" href="#plots">See open plots</a>}
          <Link className="btn btn-secondary" href="/sell?type=plot">🧑‍🌾 Offer a plot</Link>
        </div>
      </section>

      <section className="container section">
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.t}>
              <div className="n">{s.n}</div>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container section" id="plots">
        <Vine className="vine" />
        <div className="section-head">
          <h2>Open plots</h2>
          <Link href="/browse?type=plot">Browse all →</Link>
        </div>
        {plots.length > 0 ? (
          <div className="grid">
            {plots.map((l) => <ListingCard key={l.id} listing={l} />)}
          </div>
        ) : (
          <div className="empty">
            <div className="emoji">🌱</div>
            <h2>No open plots yet — be the first</h2>
            <p>
              Growers: your garden can earn before the season starts. Offer a plot,
              set a reservation price, and a neighbor picks the crop.
            </p>
            <p><Link className="btn btn-primary" href="/sell?type=plot">Offer a plot</Link></p>
          </div>
        )}
      </section>

      <section className="container section" style={{ maxWidth: 760 }}>
        <h2>Set expectations before money moves</h2>
        <p className="sub" style={{ maxWidth: 700 }}>
          A plot reservation is an agreement between you and a grower — Gnome
          introduces you and keeps the request on record, but the two of you set
          the terms. Before paying, agree on:
        </p>
        <ul className="checks">
          <li><strong>What you’re buying</strong> — growing space, the grower’s labor, a share of the harvest, or all three. Say it out loud.</li>
          <li><strong>The crop plan</strong> — what gets planted, roughly when it’s ready, and who picks substitutes if something can’t be grown.</li>
          <li><strong>Updates</strong> — how often you’ll hear from the grower (weekly photos in chat is the friendly default).</li>
          <li><strong>If a crop fails</strong> — gardens aren’t factories. Agree up front: replant, partial refund, or credit toward next season.</li>
          <li><strong>Harvest &amp; pickup</strong> — who harvests, and when and where you collect it.</li>
        </ul>
        <div className="preview-note" style={{ marginTop: 16 }}>
          <strong>A sample arrangement:</strong> “$40 reserves my 4×8 raised bed for
          the season. You pick the crop from what grows in our zone; I plant, tend,
          water, and harvest. Weekly photo updates in Gnome chat. Pickup at my
          garden gate as things ripen. If a crop fails outright, I replant if the
          calendar allows — otherwise half the fee comes back.”
        </div>
        <p className="authhint" style={{ marginTop: 12 }}>
          Growing has no guarantees — weather, pests, and luck are part of every
          season. Payment is arranged directly between you and the grower; Gnome
          doesn’t hold funds or take a cut.
        </p>
      </section>

      <section className="container">
        <div className="final-band">
          <GnomeMascot size={92} className="final-gnome" />
          <h2>Turn your whole garden into income.</h2>
          <p>
            Pre-sell your growing season: neighbors reserve plots before you plant,
            so every bed has a buyer. Plot offers are a Grower &amp; Farm plan feature.
          </p>
          <div className="row center">
            <Link className="btn btn-light" href="/sell?type=plot">Offer a plot</Link>
            <Link className="btn btn-ghost" href="/pricing">See plans</Link>
          </div>
        </div>
      </section>

      <section className="container" style={{ paddingBottom: 40 }}>
        <p className="authhint">
          Reservations are requests — the grower approves each one. Payment is arranged
          directly between you and the grower (Gnome never takes a cut and doesn’t hold
          funds). Crops are living things: agree on expectations, timing, and what
          happens if a crop fails before money changes hands.
        </p>
      </section>
    </main>
  );
}
