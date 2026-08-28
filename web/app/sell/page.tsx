import type { Metadata } from 'next';
import { isLaunchListingType } from '../../lib/format';
import SellClient from './SellClient';

export const metadata: Metadata = {
  title: 'Sell on Gnome — post your garden surplus',
  description:
    'Post homegrown produce, eggs, honey, plants, and garden goods for neighbors — sell it, share it free, or trade. Snap a photo and Zordy writes the listing for you.',
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
  const initialType = isLaunchListingType(type) ? type : undefined;
  return (
    <main className="container page-theme page-sell sell-page">
      <section className="hero page-hero" style={{ paddingBottom: 8 }}>
        <span className="kicker">Your own Market</span>
        <h1>Post it in under a minute</h1>
        <p>
          Sell it, share it free, trade it, or offer a plot. Your listing appears
          on the website and in the Gnome app, with photo-powered Zordy drafting when
          you want a faster start.
        </p>
      </section>
      <section className="section sell-grid">
        <div className="sell-main">
          <SellClient initialType={initialType} />
        </div>
        <aside className="page-side" aria-label="Posting guidance">
          <div className="side-card">
            <strong>Sell</strong>
            <p>Green means growing, selling, and successful posting.</p>
          </div>
          <div className="side-card side-card-blue">
            <strong>Share Free</strong>
            <p>Blue is for community giving and map discovery.</p>
          </div>
          <div className="side-card side-card-red">
            <strong>Trade</strong>
            <p>Red marks high-attention swaps and barter requests.</p>
          </div>
          <div className="side-card side-card-purple">
            <strong>Zordy</strong>
            <p>Add a photo and let Zordy draft the listing details.</p>
          </div>
        </aside>
      </section>
    </main>
  );
}
