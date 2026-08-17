import type { Metadata } from 'next';
import { isListingType } from '../../lib/format';
import SellClient from './SellClient';

export const metadata: Metadata = {
  title: 'Sell on Gnome — post your garden surplus',
  description:
    'Post homegrown produce, eggs, honey, plants, and garden goods for neighbors — sell it, share it free, or trade. Snap a photo and AI writes the listing for you.',
};

export default async function SellPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  // An explicit deep link (/sell?type=trade, /sell?type=plot) still wins.
  // Anything else stays undefined so SellClient falls back to the canonical
  // default — resolved in its initial state, not after a repaint.
  const initialType = isListingType(type) ? type : undefined;
  return (
    <main className="container" style={{ maxWidth: 720 }}>
      <section className="hero" style={{ paddingBottom: 8 }}>
        <span className="kicker">Your own Market</span>
        <h1>Post it in under a minute</h1>
        <p>
          Sell it, share it free, trade it — or offer a plot of your garden for a
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
