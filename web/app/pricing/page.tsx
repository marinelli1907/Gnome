import type { Metadata } from 'next';
import PricingCTA from './PricingCTA';

export const metadata: Metadata = {
  title: 'Pricing — grow your Market',
  description:
    'Gnome is free for neighbors. Growers and farms can upgrade for more listings, monthly boosts, and full AI access.',
  alternates: { canonical: '/pricing' },
};

const GROWER = process.env.NEXT_PUBLIC_STRIPE_LINK_GROWER;
const FARM = process.env.NEXT_PUBLIC_STRIPE_LINK_FARM;

const TIERS = [
  {
    name: 'Neighbor',
    price: 'Free',
    cadence: 'forever',
    blurb: 'For browsing, sharing occasionally, and posting wanted asks.',
    features: [
      '10 active listings',
      'Your own Market page',
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
      '100 active listings',
      'Offer plots — neighbors reserve, you grow',
      '1 free listing boost every month',
      'Full AI access — 25 drafts, 40 planner questions/day',
      'Featured eligibility on the homepage rail',
      'Market analytics (coming to the app)',
    ],
    cta: { link: GROWER, label: 'Upgrade to Grower' },
  },
  {
    name: 'Farm',
    price: '$29.99',
    cadence: '/month',
    blurb: 'For high-volume sellers, farm stands, and established producers.',
    features: [
      '500 active listings',
      'Offer plots — pre-sell your whole season',
      '5 free listing boosts every month',
      'Full AI access — 25 drafts, 40 planner questions/day',
      'Featured eligibility + verified review',
      'Everything in Grower',
    ],
    cta: { link: FARM, label: 'Upgrade to Farm' },
  },
];

export default function PricingPage() {
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
        {TIERS.map((t) => (
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
              <PricingCTA link={t.cta.link} label={t.cta.label} primary={'highlight' in t && !!t.highlight} />
            ) : (
              <a className="btn btn-secondary" href="/sell">Start free</a>
            )}
          </div>
        ))}
      </div>

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
