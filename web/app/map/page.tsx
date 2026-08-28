import type { Metadata } from 'next';
import MapClient from './MapClient';

export const metadata: Metadata = {
  title: 'Map fresh markets near you',
  description:
    'Map nearby Gnome markets and filter local listings by category, distance, and type.',
  alternates: { canonical: '/map' },
};

export default function MapPage() {
  return (
    <main className="container page-theme page-map map-page">
      <div className="section-head page-hero map-hero-panel">
        <div>
          <span className="kicker">Map nearby</span>
          <h1>Find fresh markets around you.</h1>
          <p className="sub">
            Filter by category, distance, and listing type. Pins change by what neighbors are offering.
          </p>
        </div>
      </div>
      <MapClient />
    </main>
  );
}
