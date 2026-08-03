import type { Metadata } from 'next';
import Link from 'next/link';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

const SITE = 'Gnome';
const DESC =
  'A farmers market in your pocket. Share, trade, buy, and sell homegrown produce, plants, eggs and farm goods from Markets near you.';
const IOS = process.env.NEXT_PUBLIC_IOS_APP_URL || 'https://apps.apple.com/';

export const metadata: Metadata = {
  metadataBase: new URL('https://gnomefarmersmarket.com'),
  title: { default: 'Gnome — A farmers market in your pocket', template: '%s | Gnome' },
  description: DESC,
  applicationName: SITE,
  openGraph: { siteName: SITE, type: 'website', title: 'Gnome — A farmers market in your pocket', description: DESC },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body>
        <header className="site-header">
          <div className="container inner">
            <Link href="/" className="brand">
              🍅 Gnome <span>a farmers market in your pocket</span>
            </Link>
            <nav className="nav-cta">
              <a className="btn btn-secondary btn-sm" href={IOS}>Get the app</a>
            </nav>
          </div>
        </header>
        {children}
        <footer className="footer">
          <div className="container">
            Gnome by Boone Systems LLC · Browse local Markets on the web; sharing, trading, buying
            and selling happen in the free Gnome app. Payments are arranged directly with sellers.
          </div>
        </footer>
      </body>
    </html>
  );
}
