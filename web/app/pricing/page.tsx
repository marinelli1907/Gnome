import type { Metadata } from 'next';
import PricingCTA from './PricingCTA';

export const metadata: Metadata = {
  title: 'Pricing — grow your Market',
  description:
    'Gnome is free for neighbors. Growers and farms can upgrade for more listings, monthly boosts, and full AI access.',
  alternates: { canonical: '/pricing' },
};

// Product KEYS, not payment links. billing-checkout resolves the key to the
// right test-or-live Stripe price and refuses entirely when the owner's
// Payments Live switch is off. The old NEXT_PUBLIC_STRIPE_LINK_* vars pointed
// straight at Stripe and bypassed that switch — see PricingCTA for the story.

export const revalidate = 3600;

// Plan numbers come from plan_limits — the same rows the backend enforces —
// so this page can never drift from reality (Part 1: one source of truth).
interface PlanRow {
  plan: string;
  max_active_listings: number | null;
  max_pickup_locations: number;
  extra_location_fee_cents: number | null;
  price_cents: number;
}

async function fetchPlanLimits(): Promise<Record<string, PlanRow>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return {};
  try {
    const res = await fetch(
      `${url}/rest/v1/plan_limits?select=plan,max_active_listings,max_pickup_locations,extra_location_fee_cents,price_cents`,
      { headers: { apikey: anon, Authorization: `Bearer ${anon}` }, next: { revalidate: 3600 } },
    );
    if (!res.ok) return {};
    const rows = (await res.json()) as PlanRow[];
    return Object.fromEntries(rows.map((r) => [r.plan, r]));
  } catch {
    return {};
  }
}

const listingsLine = (r?: PlanRow, fallback = '') =>
  r ? (r.max_active_listings == null ? 'Unlimited active listings' : `${r.max_active_listings} active listings`) : fallback;
const locationsLine = (r?: PlanRow, fallback = '') => {
  if (!r) return fallback;
  const base = `${r.max_pickup_locations} pickup location${r.max_pickup_locations === 1 ? '' : 's'}`;
  return r.extra_location_fee_cents != null
    ? `${base} — add more for $${(r.extra_location_fee_cents / 100).toFixed(0)}/mo each`
    : base;
};

const TIERS = [
  {
    name: 'Neighbor',
    price: 'Free',
    cadence: 'forever',
    blurb: 'For browsing, sharing occasionally, and posting wanted asks.',
    features: [
      '@LISTINGS',
      '@LOCATIONS',
      'Your own Market page',
      'Local delivery — up to 15 miles, one flat fee',
      'AI listing drafts — 5/day',
      'Garden planner — 10 questions/day',
      'Local pickup, no fees ever',
    ],
    cta: null,
  },
  {
    name: 'Grower',
    price: '$9.99',
    cadence: '/month',
    blurb: 'For serious gardeners who sell regularly — the natural next step.',
    highlight: true,
    features: [
      '@LISTINGS',
      '@LOCATIONS',
      'Delivery your way — distance fees, same-day & next-day cutoffs, weekly schedules',
      'Offer plots — neighbors reserve, you grow',
      '3 listing promotions every month',
      'Full AI access — 25 drafts, 40 planner questions/day',
      'Featured eligibility on the homepage rail',
    ],
    cta: { productKey: 'GNOME_GROWER_MONTHLY', label: 'Upgrade to Grower' },
  },
  {
    name: 'Farm',
    price: '$29.99',
    cadence: '/month',
    blurb: 'For high-volume sellers, farm stands, and established producers.',
    features: [
      '@LISTINGS',
      '@LOCATIONS',
      'Delivery your way — distance fees, same-day & next-day cutoffs, weekly schedules',
      'Offer plots — pre-sell your whole season',
      '10 listing promotions every month',
      'Featured eligibility + verified review',
      'Everything in Grower',
    ],
    cta: { productKey: 'GNOME_FARM_MONTHLY', label: 'Upgrade to Farm' },
  },
];

export default async function PricingPage() {
  const limits = await fetchPlanLimits();
  const PLAN_KEY: Record<string, string> = { Neighbor: 'free', Grower: 'grower', Farm: 'farm' };
  const FALLBACK: Record<string, { listings: string; locations: string }> = {
    Neighbor: { listings: '5 active listings', locations: '1 pickup location' },
    Grower: { listings: '25 active listings', locations: '2 pickup locations — add more for $5/mo each' },
    Farm: { listings: 'Unlimited active listings', locations: '5 pickup locations' },
  };
  const resolved = TIERS.map((t) => ({
    ...t,
    features: t.features.map((f) => {
      const row = limits[PLAN_KEY[t.name]];
      if (f === '@LISTINGS') return listingsLine(row, FALLBACK[t.name].listings);
      if (f === '@LOCATIONS') return locationsLine(row, FALLBACK[t.name].locations);
      return f;
    }),
  }));
  return (
    <main className="container" style={{ paddingTop: 40, paddingBottom: 64 }}>
      <section className="hero" style={{ paddingTop: 0, paddingBottom: 20 }}>
        <span className="kicker">Simple, neighborly pricing</span>
        <h1>Free for neighbors. Fair for growers.</h1>
        <p>
          Sharing your surplus never costs a cent. When your garden becomes a
          business, your Market grows with you — and Gnome still never takes a
          cut of what you sell.
        </p>
      </section>

      <div className="tiers">
        {resolved.map((t) => (
          <div key={t.name} className={`tier${'highlight' in t && t.highlight ? ' highlight' : ''}`}>
            {'highlight' in t && t.highlight && <span className="tier-flag">Most popular</span>}
            <h2>{t.name}</h2>
            <p className="tier-price">
              {t.price}
              <span>{t.cadence}</span>
            </p>
            <p className="tier-blurb">{t.blurb}</p>
            <ul className="checks">
              {t.features.map((f) => <li key={f}>{f}</li>)}
            </ul>
            {t.cta ? (
              <PricingCTA productKey={t.cta.productKey} label={t.cta.label} primary={'highlight' in t && !!t.highlight} />
            ) : (
              <a className="btn btn-secondary" href="/sell">Start free</a>
            )}
          </div>
        ))}
      </div>

      {/* Seed Drop has no prices and no date. It is described here as a preview
          only — the seller plans above are the only things this page sells. */}
      <section className="hero" style={{ paddingTop: 36, paddingBottom: 24 }}>
        <span className="kicker">Coming soon</span>
        <h2 style={{ fontSize: 28 }}>Seed Drop is growing 🌱</h2>
        <p>
          Personalized seed selections based on your location, growing space and season
          are coming soon. You&rsquo;ll choose your Drop size and how often one arrives, and
          Gnome will explain what every packet can grow — with recommendations shaped by
          your ZIP and hardiness zone, sunlight, space and the season you&rsquo;re in. What
          Gnome can send will vary by location. No opening date has been set, but you can{' '}
          <a href="/seeds">tell Gnome about your garden →</a> so the first suggestions fit.
        </p>
      </section>

      <p className="pricing-fine">
        <strong>Gnome takes 0% of neighbor-to-neighbor sales — no transaction fees, ever.</strong>{' '}
        Plans are billed monthly through Stripe and can be cancelled anytime; your Market
        simply returns to the free tier at the end of the billing period, and your listings
        beyond the free cap pause rather than disappear. Plan limits are enforced by the
        platform itself, not the buttons on this page. Questions or a billing problem?
        We’ll make it right — cancel first, ask second.
      </p>
    </main>
  );
}
