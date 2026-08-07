import type { Metadata } from 'next';
import SellClient from './SellClient';

export const metadata: Metadata = {
  title: 'Sell on Gnome — post your garden surplus',
  description:
    'Post homegrown produce, eggs, honey, plants, and garden goods for neighbors — free, trade, or sale. Snap a photo and AI writes the listing for you.',
};

export default async function SellPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const initialType = ['free', 'trade', 'sale', 'wanted', 'plot'].includes(type ?? '')
    ? (type as 'free' | 'trade' | 'sale' | 'wanted' | 'plot')
    : undefined;
  return (
    <main className="container" style={{ maxWidth: 720 }}>
      <section className="hero" style={{ paddingBottom: 8 }}>
        <span className="kicker">Your garden’s storefront</span>
        <h1>Post it in under a minute</h1>
        <p>
          Share it free, trade it, sell it — or offer a plot of your garden for a
          neighbor to reserve. Your listing shows on this site and in the Gnome
          app. Add a photo and our AI writes the title, description, and a fair
          neighborly price for you.
        </p>
      </section>
      <section className="section">
        <SellClient initialType={initialType} />
      </section>
    </main>
  );
}
