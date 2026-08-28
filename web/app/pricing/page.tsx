import type { Metadata } from 'next';
import PricingCTA from './PricingCTA';

export const metadata: Metadata = {
  title: 'Pricing — grow your Market',
  description:
    'Gnome is free to start. Upgrade to Pro or Farm for unlimited Sell listings, premium QR tools, and more daily Zordy requests.',
  alternates: { canonical: '/pricing' },
};

// Product KEYS, not payment links. billing-checkout resolves the key to the
// right test-or-live Stripe price and refuses entirely when the owner's
// Payments Live switch is off. The old NEXT_PUBLIC_STRIPE_LINK_* vars pointed
// straight at Stripe and bypassed that switch — see PricingCTA for the story.

export const revalidate = 3600;

// Plan numbers come from plan_limits — the same rows the backend enforces —
// so this page can never drift from reality (Part 1: one source of truth).
//
// The allowance columns (display_name, monthly_publish_allowance,
// included_renewals_per_period, wanted_intros_per_day, qr_tools) arrive with
// migration 0104. Production may not have them yet, so the fetch selects `*`
// and every helper checks for `undefined` — column not deployed — and falls
// back to the canonical copy below. It NEVER reads max_active_listings; that
// column is the retired cap model, kept only for legacy readers, and must not
// resurface here.
interface PlanRow {
  plan: string;
  price_cents: number;
  max_pickup_locations: number;
  extra_location_fee_cents: number | null;
  // 0104 allowance columns — undefined until the migration applies, null = unlimited.
  monthly_publish_allowance?: number | null;
  included_renewals_per_period?: number | null;
  wanted_intros_per_day?: number | null;
  qr_tools?: boolean | null;
}

async function fetchPlanLimits(): Promise<Record<string, PlanRow>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return {};
  try {
    // select=* rather than naming the 0104 columns: naming a column PostgREST
    // does not have yet fails the whole request, and this page should degrade
    // per-line, not all-or-nothing.
    const res = await fetch(`${url}/rest/v1/plan_limits?select=*`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return {};
    const rows = (await res.json()) as PlanRow[];
    return Object.fromEntries(rows.map((r) => [r.plan, r]));
  } catch {
    return {};
  }
}

// Each helper degrades to the canonical fallback string when the row is
// missing OR the 0104 column is undefined (not yet migrated). `null` is a
// real server value meaning unlimited — the two must not be conflated.
const publishesLine = (r: PlanRow | undefined, fallback: string) => {
  if (!r || r.monthly_publish_allowance === undefined) return fallback;
  return r.monthly_publish_allowance === null
    ? 'Unlimited Sell listings'
    : `${r.monthly_publish_allowance} Sell listings included per month`;
};
const renewalsLine = (r: PlanRow | undefined, fallback: string) => {
  if (!r || r.included_renewals_per_period === undefined) return fallback;
  if (r.included_renewals_per_period === null) return 'Unlimited free renewals';
  if (r.included_renewals_per_period === 0) return 'Renewals $0.99 each — none included';
  return `${r.included_renewals_per_period} free renewals included — then $0.99 each`;
};
const wantedLine = (r: PlanRow | undefined, fallback: string) => {
  if (!r || r.wanted_intros_per_day === undefined) return fallback;
  if (r.wanted_intros_per_day === null) return 'Unlimited Wanted responses';
  return `${r.wanted_intros_per_day} Wanted response${r.wanted_intros_per_day === 1 ? '' : 's'} per day`;
};
const qrLine = (r: PlanRow | undefined, fallback: string) => {
  if (!r || r.qr_tools === undefined) return fallback;
  return r.qr_tools
    ? 'Premium QR tools for your Market'
    : 'Free public Market link — QR tools on paid plans';
};
const locationsLine = (r: PlanRow | undefined, fallback: string) => {
  if (!r || r.max_pickup_locations === undefined) return fallback;
  const base = `${r.max_pickup_locations} pickup location${r.max_pickup_locations === 1 ? '' : 's'}`;
  return r.extra_location_fee_cents != null
    ? `${base} — add more for $${(r.extra_location_fee_cents / 100).toFixed(0)}/mo each`
    : base;
};

// Customer-facing names ONLY. The internal enum values behind them are
// deliberately different (grower → "Pro", farm → "Farm" since 0126; the
// retired sponsor row displays "Legacy Farm" and must never render).
const TIERS = [
  {
    name: 'Free',
    price: 'Free',
    cadence: 'forever',
    blurb: 'For browsing, sharing occasionally, and selling a few things.',
    features: [
      '@PUBLISHES',
      '@RENEWALS',
      'Extra Sell listing: $0.99',
      '@QR',
      '@LOCATIONS',
      'Share Free & Trade posts — always free, never counted',
      'Your own Market page',
      'Local delivery — up to 15 miles, one flat fee',
      'Zordy — 5 requests/day',
      'Local pickup, no fees ever',
    ],
    cta: null,
  },
  {
    name: 'Pro',
    price: '$9.99',
    cadence: '/month',
    blurb: 'For serious gardeners who sell regularly — the natural next step.',
    highlight: true,
    features: [
      '@PUBLISHES',
      '@RENEWALS',
      '@QR',
      '@LOCATIONS',
      'Delivery your way — distance fees, same-day & next-day cutoffs, weekly schedules',
      'Offer plots — neighbors reserve, you grow',
      '3 listing promotions every month',
      'Zordy — 25 requests/day',
      'Featured eligibility on the homepage rail',
    ],
    cta: { productKey: 'GNOME_GROWER_MONTHLY', label: 'Upgrade to Pro' },
  },
  {
    name: 'Farm',
    price: '$29.99',
    cadence: '/month',
    blurb: 'For working farms, farm stands, and established producers.',
    features: [
      '@PUBLISHES',
      '@RENEWALS',
      '@QR',
      '@LOCATIONS',
      '10 listing promotions every month',
      'Offer plots — pre-sell your whole season',
      'Featured eligibility + verified review',
      'Zordy — 100 requests/day',
      'Everything in Pro',
    ],
    cta: { productKey: 'GNOME_FARM_MONTHLY', label: 'Upgrade to Farm' },
  },
];

export default async function PricingPage() {
  const limits = await fetchPlanLimits();
  // Customer-facing name → internal plan_limits row. Since 0126 the enum row
  // 'farm' IS customer-facing Farm ($29.99); 'sponsor' is the retired Legacy
  // Farm comp rung and has no card here. 'grower' remains Pro.
  const PLAN_KEY: Record<string, string> = { Free: 'free', Pro: 'grower', Farm: 'farm' };
  const FALLBACK: Record<string, Record<string, string>> = {
    Free: {
      '@PUBLISHES': '3 Sell listings included per month',
      '@RENEWALS': 'Renewals $0.99 each — none included',
      '@QR': 'Free public Market link — QR tools on paid plans',
      '@LOCATIONS': '1 pickup location',
    },
    Pro: {
      '@PUBLISHES': 'Unlimited Sell listings',
      '@RENEWALS': 'Unlimited free renewals',
      '@QR': 'Premium QR tools for your Market',
      '@LOCATIONS': '2 pickup locations — add more for $5/mo each',
    },
    Farm: {
      '@PUBLISHES': 'Unlimited Sell listings',
      '@RENEWALS': 'Unlimited free renewals',
      '@QR': 'Premium QR tools for your Market',
      '@LOCATIONS': '10 pickup locations',
    },
  };
  const resolved = TIERS.map((t) => {
    const row = limits[PLAN_KEY[t.name]];
    const fb = FALLBACK[t.name];
    return {
      ...t,
      features: t.features.map((f) => {
        if (f === '@PUBLISHES') return publishesLine(row, fb[f]);
        if (f === '@RENEWALS') return renewalsLine(row, fb[f]);
        if (f === '@QR') return qrLine(row, fb[f]);
        if (f === '@LOCATIONS') return locationsLine(row, fb[f]);
        return f;
      }),
    };
  });
  return (
    <main className="container page-theme page-pricing" style={{ paddingTop: 40, paddingBottom: 64 }}>
      <section className="hero page-hero pricing-hero-panel" style={{ paddingTop: 0, paddingBottom: 20 }}>
        <div>
          <span className="kicker">Simple, neighborly pricing</span>
          <h1>Free for neighbors. Fair for growers.</h1>
          <p>
            Sharing your surplus never costs a cent. When your garden becomes a
            business, your Market grows with you — and Gnome still never takes a
            cut of what you sell.
          </p>
        </div>
        <div className="pricing-promise">
          <strong>0%</strong>
          <span>transaction fees on neighbor sales</span>
        </div>
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

      <p className="pricing-fine">
        Every Sell listing runs for 7 days on every plan — including Farm — then
        can be renewed to stay up. Only Sell listings use your monthly allowance:
        Share Free and Trade posts never count, on any plan. Beyond your
        included allowance, an extra Sell listing or renewal is $0.99. Unlimited
        allowances are subject to anti-abuse limits.
      </p>

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
        simply returns to the Free plan at the end of the billing period. Plan limits are
        enforced by the platform itself, not the buttons on this page. Questions or a
        billing problem? We’ll make it right — cancel first, ask second.
      </p>
    </main>
  );
}
