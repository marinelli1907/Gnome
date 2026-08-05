import type { Metadata } from 'next';
import MyMarketClient from './MyMarketClient';

export const metadata: Metadata = {
  title: 'My Market',
  description: 'Your Gnome storefront — manage your listings, sold and unsold.',
  robots: { index: false },
};

export default function MyMarketPage() {
  return (
    <main className="container" style={{ paddingTop: 32, paddingBottom: 64 }}>
      <MyMarketClient />
    </main>
  );
}
