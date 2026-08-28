import type { Metadata } from 'next';
import BrowseClient from './BrowseClient';

export const metadata: Metadata = {
  title: 'Browse fresh listings near you',
  description:
    'Homegrown produce, plants, eggs, honey, firewood and farm goods from neighbors near you — filter by distance, type, and category.',
  alternates: { canonical: '/browse' },
};

export default function BrowsePage() {
  return (
    <main className="container page-theme page-browse browse-page" style={{ paddingTop: 28, paddingBottom: 56 }}>
      <div className="section-head page-hero browse-hero-panel" style={{ marginBottom: 18 }}>
        <div>
          <span className="kicker">Browse nearby</span>
          <h2>Fresh near you</h2>
          <p className="sub">Search the neighborhood map for produce, goods, growers, and community shares.</p>
        </div>
      </div>
      <BrowseClient />
    </main>
  );
}
