import type { Metadata } from 'next';
import ImportClient from './ImportClient';

export const metadata: Metadata = {
  title: 'Build My Market with Gnome',
  description:
    'Upload a screenshot or photo of what you already sell and Gnome turns it into draft listings.',
  robots: { index: false },
};

export default function ImportPage() {
  return (
    <main className="container" style={{ maxWidth: 720, paddingTop: 32, paddingBottom: 64 }}>
      <ImportClient />
    </main>
  );
}
