import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

const SITE_NAME = 'Gnome';
const DESCRIPTION =
  'Gnome is a hyperlocal sharing network for surplus garden produce — find free fruit, vegetables, herbs, eggs and more from neighbors near you.';

export const metadata: Metadata = {
  metadataBase: new URL('https://gnome.boonesystems.app'),
  title: {
    default: 'Gnome — Free surplus produce from neighbors',
    template: '%s | Gnome',
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    siteName: SITE_NAME,
    type: 'website',
    title: 'Gnome — Free surplus produce from neighbors',
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container inner">
            <Link href="/" className="brand">
              🍅 Gnome <span>surplus produce, shared</span>
            </Link>
          </div>
        </header>
        {children}
        <footer className="footer">
          <div className="container">
            Gnome by Boone Systems LLC · Free hyperlocal produce sharing. Browsing is
            public; posting and claiming happen in the app.
          </div>
        </footer>
      </body>
    </html>
  );
}
