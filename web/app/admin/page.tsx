import type { Metadata } from 'next';
import AdminClient from './AdminClient';

export const metadata: Metadata = {
  title: 'Moderation',
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <main className="container" style={{ paddingTop: 32, paddingBottom: 64 }}>
      <AdminClient />
    </main>
  );
}
