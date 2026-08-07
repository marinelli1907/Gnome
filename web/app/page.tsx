import Link from 'next/link';
import { GnomeMascot, Sun, Vine } from './components/art';
import HomeLocate from './components/HomeLocate';
import ListingCard from './components/ListingCard';
import MarketCard from './components/MarketCard';
import { CATEGORIES } from '@/lib/categories';
import { getActiveListings, getFeaturedListings, getFeaturedMarkets } from '@/lib/gnome';

export const revalidate = 120;

const AREAS = [
  { slug: 'lyndhurst-oh', label: 'Lyndhurst' },
  { slug: 'richmond-heights-oh', label: 'Richmond Heights' },
  { slug: 'mayfield-heights-oh', label: 'Mayfield Heights' },
  { slug: 'south-euclid-oh', label: 'South Euclid' },
];

const STEPS = [
  { n: '🍅', t: 'Find what’s growing nearby', d: 'Browse fresh produce, eggs, honey, plants and garden goods from neighbors and small growers around you.' },
  { n: '🌱', t: 'Grow your own, with help', d: 'The AI Garden Planner knows your zone and the calendar; the Seed Drop sends the right seeds. No land? Reserve a plot in a neighbor’s garden.' },
  { n: '🤝', t: 'Share or sell the extra', d: 'Claim a free share, offer a trade, or request to buy — pickup is arranged neighbor to neighbor, no fees between you.' },
  { n: '🏡', t: 'Build your neighborhood market', d: 'Every grower gets a storefront with real trust stats. Repeat buyers, plot reservations, a stronger local food network.' },
];

// Hero collage — real listing shapes, no stock photos needed.
const HERO_CARDS = [
  { emoji: '🍅', title: 'Cherry tomatoes', tag: 'FREE', tone: 'free' },
  { emoji: '🥚', title: 'Pasture eggs', tag: '$5 · dozen', tone: 'sale' },
  { emoji: '🍯', title: 'Raw honey', tag: '$9 · jar', tone: 'sale' },
  { emoji: '🍄', title: 'Garden gnome', tag: 'TRADE', tone: 'trade' },
];

export default async function HomePage() {
  const [featured, recent, markets] = await Promise.all([
    getFeaturedListings(8),
    getActiveListings({ limit: 8 }),
    getFeaturedMarkets(6),
  ]);

  return (
    <main>
      {/* ------------------------------------------------ hero */}
      <section className="container hero2">
        <div className="hero2-copy">
          <div className="kicker">🌱 Your neighborhood’s farmers market</div>
          <h1>
            Fresh from the garden <em>next door</em>.
          </h1>
          <p>
            Gnome is where neighbors share, trade, and sell what they grow — tomatoes,
            eggs, honey, flowers, plants, and the occasional hand-painted gnome.
          </p>
          <HomeLocate />
          <div className="row">
            <Link className="btn btn-primary" href="/browse">Browse near you</Link>
            <Link className="btn btn-secondary" href="/sell">Sell what you grow</Link>
          </div>
          <ul className="hero-points">
            <li>Free for neighbors</li>
            <li>No fees between neighbors</li>
            <li>Local pickup, not shipping</li>
          </ul>
        </div>
        <div className="hero2-visual" aria-hidden>
          <Sun className="hero-sun" />
          <div className="hero-cards">
            {HERO_CARDS.map((c, i) => (
              <div key={c.title} className={`hero-card hc-${i}`}>
                <div className="hero-card-emoji">{c.emoji}</div>
                <div className="hero-card-title">{c.title}</div>
                <span className={`tag type-${c.tone}`}>{c.tag}</span>
              </div>
            ))}
          </div>
          <GnomeMascot className="hero-gnome" />
        </div>
      </section>

      {/* ------------------------------------------- featured rail */}
      {featured.length >= 2 && (
        <section className="container section">
          <div className="section-head"><h2>✨ Featured near you</h2></div>
          <div className="rail">
            {featured.map((l) => <ListingCard key={l.id} listing={l} promoted />)}
          </div>
        </section>
      )}

      {/* ------------------------------------------- categories */}
      <section className="container section">
        <Vine className="vine" />
        <div className="section-head">
          <h2>What’s growing near you</h2>
        </div>
        <div className="cat-grid">
          {CATEGORIES.filter((c) => c.id !== 'other').map((c) => (
            <Link key={c.id} className="cat-tile" href={`/category/${c.id}`}>
              <span className="cat-emoji">{c.emoji}</span>
              <span className="cat-label">{c.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ------------------------------------------- fresh grid */}
      {recent.length > 0 && (
        <section className="container section">
          <div className="section-head">
            <h2>Fresh on Gnome</h2>
            <Link href="/browse">See more →</Link>
          </div>
          <div className="grid">{recent.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
        </section>
      )}

      {/* ------------------------------------------- how it works */}
      <section className="container section">
        <Vine className="vine" />
        <div className="section-head"><h2>How Gnome works</h2></div>
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

      {/* ------------------------------------------- growers split */}
      <section className="container section">
        <div className="split">
          <div className="split-copy">
            <div className="kicker">For growers & makers</div>
            <h2>Your garden deserves a storefront.</h2>
            <p className="sub">
              Every seller on Gnome gets a Market — a page with your goods, your
              followers, and trust you earn by showing up (no star ratings, no drama).
              Post in seconds: snap a photo and our AI drafts the listing for you.
            </p>
            <ul className="checks">
              <li>Free to start — your first 10 listings cost nothing</li>
              <li>AI writes your listings from a photo</li>
              <li>Boost a listing when you want the spotlight</li>
            </ul>
            <div className="row">
              <a className="btn btn-primary" href={process.env.NEXT_PUBLIC_IOS_APP_URL || 'https://apps.apple.com/'}>
                Get the app
              </a>
            </div>
          </div>
          <div className="split-side">
            {markets.length > 0 ? (
              <div className="mini-stack">
                {markets.slice(0, 3).map((m) => <MarketCard key={m.id} market={m} />)}
              </div>
            ) : (
              <div className="split-placeholder" aria-hidden>
                <div className="hero-card hc-static">
                  <div className="hero-card-emoji">🏡</div>
                  <div className="hero-card-title">Daniel’s Garden</div>
                  <span className="tag type-free">12 shared · responds fast</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------- more ways to grow: plots + seed drop */}
      <section className="container" style={{ marginTop: 6 }}>
        <Link href="/plots" className="band band-plot">
          <div className="band-emoji">🧑‍🌾</div>
          <div className="band-copy">
            <h2>No garden? Reserve a plot</h2>
            <p>
              Pick a plot in a neighbor’s garden and choose the crop — they grow it,
              you harvest it. Growers: pre-sell your season and turn the whole
              garden into income.
            </p>
          </div>
          <span className="band-cta">
            Explore plots <span className="band-arrow">→</span>
          </span>
        </Link>
      </section>

      <section className="container" style={{ marginTop: 14 }}>
        <Link href="/seeds" className="band">
          <div className="band-emoji">📦</div>
          <div className="band-copy">
            <h2>Start growing: The Gnome Seed Drop</h2>
            <p>
              Seeds picked for your zone and the season — chosen by AI, packed by
              hand, shipped anywhere in the U.S. with a growing tip for every packet.
            </p>
          </div>
          <span className="band-cta">
            See the drops <span className="band-arrow">→</span>
          </span>
        </Link>
      </section>

      {/* ------------------------------------------- areas + final CTA */}
      <section className="container section">
        <Vine className="vine" />
        <div className="section-head"><h2>Now growing near you</h2></div>
        <div className="chips">
          {AREAS.map((a) => <Link key={a.slug} className="chip" href={`/near/${a.slug}`}>📍 {a.label}</Link>)}
        </div>
      </section>

      <section className="container">
        <div className="final-band">
          <GnomeMascot size={92} className="final-gnome" />
          <h2>Got extra tomatoes?</h2>
          <p>Someone nearby wants them. That’s the whole idea.</p>
          <div className="row center">
            <a className="btn btn-light" href={process.env.NEXT_PUBLIC_IOS_APP_URL || 'https://apps.apple.com/'}>
              Get the free app
            </a>
            <Link className="btn btn-ghost" href="/seeds">Shop the Seed Drop</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
