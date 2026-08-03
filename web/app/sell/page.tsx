import type { Metadata } from 'next';
import SellClient from './SellClient';

export const metadata: Metadata = {
  title: 'Sell on Gnome — post your garden surplus',
  description:
    'Post homegrown produce, eggs, honey, plants, and garden goods for neighbors — free, trade, or sale. Snap a photo and AI writes the listing for you.',
};

export default function SellPage() {
  return (
    <main className="container">
      <section className="hero" style={{ paddingBottom: 8 }}>
        <span className="kicker">Your garden’s storefront</span>
        <h1>Post it in under a minute</h1>
        <p>
          Share it free, trade it, or sell it — your listing shows to neighbors on
          this site and in the Gnome app. Add a photo and our AI writes the
          title, description, and a fair neighborly price for you.
        </p>
      </section>
      <section className="section" style={{ maxWidth: 640 }}>
        <SellClient />
      </section>
    </main>
  );
}
