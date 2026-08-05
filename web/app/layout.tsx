import type { Metadata } from 'next';
import Link from 'next/link';
import { Fraunces, Inter } from 'next/font/google';
import './globals.css';
import { GnomeMark } from './components/art';

const inter = Inter({ subsets: ['latin'], display: 'swap' });
// Display face: a soft, seed-catalog serif for headlines only.
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  style: ['normal', 'italic'],
  variable: '--font-display',
});

const SITE = 'Gnome';
const BASE = 'https://gnomefarmersmarket.com';
const DESC =
  'A farmers market in your pocket. Share, trade, buy, and sell homegrown produce, plants, eggs and farm goods from Markets near you — plus the Seed Drop, seeds picked for your zone and shipped to your door.';
const IOS = process.env.NEXT_PUBLIC_IOS_APP_URL || 'https://apps.apple.com/';

export const metadata: Metadata = {
  metadataBase: new URL(BASE),
  title: { default: 'Gnome — A farmers market in your pocket', template: '%s | Gnome' },
  description: DESC,
  applicationName: SITE,
  openGraph: { siteName: SITE, type: 'website', title: 'Gnome — A farmers market in your pocket', description: DESC },
  twitter: { card: 'summary_large_image' },
};

const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'Gnome',
      url: BASE,
      description: 'Hyperlocal farmers market: neighbors sharing, trading, and selling homegrown goods, wherever you are in the U.S.',
      parentOrganization: { '@type': 'Organization', name: 'Boone Systems LLC' },
    },
    {
      '@type': 'WebSite',
      name: 'Gnome',
      url: BASE,
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.className} ${fraunces.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        <header className="site-header">
          <div className="container inner">
            <Link href="/" className="brand">
              <GnomeMark size={30} className="brand-mark" /> Gnome{' '}
              <span>a farmers market in your pocket</span>
            </Link>
            <nav className="nav-cta">
              <span className="nav-links">
                <Link href="/near/richmond-heights-oh">Browse</Link>
                <Link href="/garden">Garden Planner ✨</Link>
                <Link href="/seeds">Seed Drop 🌱</Link>
              </span>
              <Link className="btn btn-primary btn-sm" href="/sell">Sell</Link>
              <a className="btn btn-secondary btn-sm" href={IOS}>Get the app</a>
            </nav>
          </div>
        </header>
        {children}
        <footer className="footer">
          <div className="container">
            <div className="footer-cols">
              <div>
                <div className="footer-brand"><GnomeMark size={24} className="brand-mark" /> Gnome</div>
                <p className="footer-tag">
                  The neighborhood farmers market — fresh from the garden next door,
                  wherever you live.
                </p>
              </div>
              <div>
                <h4>Explore</h4>
                <ul>
                  <li><Link href="/near/richmond-heights-oh">Browse near you</Link></li>
                  <li><Link href="/garden">AI Garden Planner</Link></li>
                  <li><Link href="/seeds">The Seed Drop</Link></li>
                  <li><Link href="/category/vegetables">Vegetables</Link></li>
                  <li><Link href="/category/eggs">Eggs</Link></li>
                  <li><Link href="/category/honey">Honey</Link></li>
                </ul>
              </div>
              <div>
                <h4>For growers</h4>
                <ul>
                  <li><Link href="/sell">Sell on Gnome</Link></li>
                  <li><a href={IOS}>Get the app</a></li>
                  <li><a href={IOS}>Start your Market</a></li>
                  <li><Link href="/category/supplies">Garden supplies</Link></li>
                  <li><Link href="/category/decor">Garden decor</Link></li>
                </ul>
              </div>
              <div>
                <h4>Areas</h4>
                <ul>
                  <li><Link href="/near/richmond-heights-oh">Richmond Heights</Link></li>
                  <li><Link href="/near/lyndhurst-oh">Lyndhurst</Link></li>
                  <li><Link href="/near/mayfield-heights-oh">Mayfield Heights</Link></li>
                  <li><Link href="/near/south-euclid-oh">South Euclid</Link></li>
                </ul>
              </div>
            </div>
            <div className="legal">
              Gnome by Boone Systems LLC · Browse and sell on the web or in the free Gnome app.
              Payments between neighbors are arranged directly with sellers. Sellers are
              responsible for following local food laws.
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
