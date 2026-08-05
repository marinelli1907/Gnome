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
    <main className="container" style={{ paddingTop: 28, paddingBottom: 56 }}>
      <div className="section-head" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 32 }}>Fresh near you</h2>
      </div>
      <BrowseClient />
    </main>
  );
}
