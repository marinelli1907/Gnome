import Link from 'next/link';
import { GnomeMascot, Sun, Vine } from './components/art';
import HomeLocate from './components/HomeLocate';
import ListingCard from './components/ListingCard';
import MarketCard from './components/MarketCard';
import { CATEGORIES } from '@/lib/categories';
import { getActiveListings, getFeaturedListings, getFeaturedMarkets, getTaxonomyRoots } from '@/lib/gnome';

export const revalidate = 120;

const AREAS = [
  { slug: 'lyndhurst-oh', label: 'Lyndhurst' },
  { slug: 'richmond-heights-oh', label: 'Richmond Heights' },
  { slug: 'mayfield-heights-oh', label: 'Mayfield Heights' },
  { slug: 'south-euclid-oh', label: 'South Euclid' },
];

const STEPS = [
  { n: '🍅', t: 'Find what’s fresh nearby', d: 'Browse produce, eggs, honey, plants and handmade goods from neighbors and small growers around you.' },
  { n: '🌱', t: 'Grow your own, with help', d: 'The AI Garden Planner knows your zone and the calendar; the Seed Drop is coming soon. No land? Reserve a plot in a neighbor’s garden.' },
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
  const [featured, recent, markets, roots] = await Promise.all([
    getFeaturedListings(8),
    getActiveListings({ limit: 8 }),
    getFeaturedMarkets(6),
    getTaxonomyRoots(),
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
            See what your neighbors are growing, sharing, selling, and looking for
            today — tomatoes, eggs, honey, plants, and the occasional hand-painted gnome.
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

      {/* --------------------------------------- four pillars: the product map */}
      <section className="container section pillars-section">
        <div className="pillars">
          <Link href="/browse" className="pillar">
            <span className="pillar-emoji">🧺</span>
            <h3>See what’s fresh near you</h3>
            <p>Produce, eggs, honey, baked goods, and handmade goods from people nearby — for sale, free to share, trades, and wanted posts.</p>
            <span className="pillar-cta">Browse nearby →</span>
          </Link>
          <Link href="/garden" className="pillar">
            <span className="pillar-emoji">🌱</span>
            <h3>Grow with Gnome</h3>
            <p>The Garden Planner tells you what to plant; the Seed Drop is coming soon; no yard? Reserve a plot nearby.</p>
            <span className="pillar-cta">Start growing →</span>
          </Link>
          <Link href="/my" className="pillar">
            <span className="pillar-emoji">🏡</span>
            <h3>Your garden deserves a storefront</h3>
            <p>Post what you grow, manage availability, chat with neighbors, and build repeat local customers.</p>
            <span className="pillar-cta">Open My Market →</span>
          </Link>
          <Link href="/pricing" className="pillar">
            <span className="pillar-emoji">🌿</span>
            <h3>Start free. Grow when you need more.</h3>
            <p>Browse and share for free, forever. Upgrade when your Market needs more listings, boosts, and AI.</p>
            <span className="pillar-cta">View plans →</span>
          </Link>
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

      {/* ------------------------------------------- categories
          Same 16 backend taxonomy roots as the app and the Buy page; each tile
          opens Browse with that category already selected. Flat legacy list
          only if the taxonomy fetch comes back empty. */}
      <section className="container section">
        <Vine className="vine" />
        <div className="section-head">
          <h2>Grown, raised &amp; made near you</h2>
        </div>
        <div className="cat-grid">
          {roots.length > 0
            ? roots.map((r) => (
                <Link key={r.slug} className="cat-tile" href={`/browse?cat=${r.slug}`}>
                  <span className="cat-emoji">{r.icon ?? '🧺'}</span>
                  <span className="cat-label">{r.name}</span>
                </Link>
              ))
            : CATEGORIES.filter((c) => c.id !== 'other').map((c) => (
                <Link key={c.id} className="cat-tile" href={`/category/${c.id}`}>
                  <span className="cat-emoji">{c.emoji}</span>
                  <span className="cat-label">{c.label}</span>
                </Link>
              ))}
        </div>
      </section>

      {/* ------------------------------------------- growing near you today */}
      {recent.length > 0 && (
        <section className="container section">
          <div className="section-head">
            <h2>Fresh near you today</h2>
            <Link href="/browse">View everything nearby →</Link>
          </div>
          <div className="grid">{recent.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
        </section>
      )}

      {/* ------------------------------------------- markets near you */}
      {markets.length >= 2 && (
        <section className="container section">
          <Vine className="vine" />
          <div className="section-head">
            <h2>Markets near you</h2>
          </div>
          <p className="sub">Neighborhood farm stands — each one is a real person’s garden.</p>
          <div className="grid">
            {markets.slice(0, 6).map((m) => <MarketCard key={m.id} market={m} />)}
          </div>
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

      {/* ------------------------------------------- grow with gnome */}
      <section className="grow-band">
        <div className="container">
          <div className="section-head"><h2>Grow with Gnome</h2></div>
          <p className="grow-band-sub">
            One ecosystem, three ways in — whether you have a whole yard, a windowsill,
            or no space at all.
          </p>
          <div className="grow-cards">
            <Link href="/garden" className="grow-card">
              <span className="pillar-emoji">✨</span>
              <h3>Garden Planner</h3>
              <p>Figure out what to grow and when — zone-aware answers for your exact town and week. Free during beta.</p>
              <span className="pillar-cta">Ask the planner →</span>
            </Link>
            <Link href="/seeds" className="grow-card">
              <span className="pillar-emoji">📦</span>
              <h3>Seed Drop</h3>
              <p>Personalized seed selections based on your location, growing space and season. Coming soon.</p>
              <span className="pillar-cta">Coming soon →</span>
            </Link>
            <Link href="/plots" className="grow-card">
              <span className="pillar-emoji">🧑‍🌾</span>
              <h3>Reserve a Plot</h3>
              <p>No room to grow? Reserve space in a nearby grower’s garden — you pick the crop, they grow it, you harvest.</p>
              <span className="pillar-cta">Find growing space →</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------- pricing strip */}
      <section className="container section">
        <div className="pricing-strip">
          <div>
            <h2>Start free. Grow when you need more.</h2>
            <p className="sub" style={{ margin: '4px 0 0' }}>
              Free forever · Pro $9.99/mo · Max $29.99/mo · Farm $99/mo —
              and <strong>Gnome takes 0% of neighbor-to-neighbor sales</strong>.
            </p>
          </div>
          <Link className="btn btn-primary" href="/pricing">View plans</Link>
        </div>
      </section>

      {/* ------------------------------------------- trust strip */}
      <section className="container">
        <p className="trust-strip">
          🛡️ Built for neighborly exchanges — approximate public locations, private
          pickup details, report &amp; block, and food-safety guidance.{' '}
          <Link href="/trust">How Gnome keeps it friendly →</Link>
        </p>
      </section>

      {/* ------------------------------------------- areas + final CTA */}
      <section className="container section">
        <Vine className="vine" />
        <div className="section-head"><h2>Gnome is growing in…</h2></div>
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
            <Link className="btn btn-ghost" href="/seeds">Seed Drop — coming soon</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
