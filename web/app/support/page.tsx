import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Gnome Support',
  description:
    'Get help with your Gnome account, listings, orders, safety reports, payments, AI features, and account deletion.',
  alternates: { canonical: '/support' },
};

const CONTACT = 'daniel@boonesystems.com';

export default function SupportPage() {
  return (
    <main className="container legalpage">
      <h1>Gnome Support</h1>
      <p className="sub">
        Need help with your account, a listing, an order, or a safety concern?
        Email{' '}
        <a href={`mailto:${CONTACT}?subject=Gnome%20support`}>{CONTACT}</a>.
      </p>

      <h2>Account help</h2>
      <p>
        If you cannot sign in, email us from the address on your Gnome account.
        If you want to permanently delete your account and data, use the public{' '}
        <Link href="/delete-account">account deletion page</Link> or open the
        Gnome app and go to <strong>Profile → Settings → Delete my account</strong>.
      </p>

      <h2>Listings, Markets, and orders</h2>
      <p>
        Include the listing title, Market name, order details, and the email on
        your account when you write in. Payments between neighbors are arranged
        directly with the seller; Gnome does not collect card numbers or settle
        payments for marketplace orders.
      </p>

      <h2>Safety reports</h2>
      <p>
        Every listing, Market, and pickup conversation in the app has report and
        block controls. For urgent help with objectionable content, harassment,
        or a pickup that feels unsafe, email us with the listing or Market name
        and any relevant details. Do not include payment card numbers or private
        account passwords.
      </p>

      <h2>AI features</h2>
      <p>
        The Garden Planner and listing assistant are assistive tools. They can
        be wrong, so check seed packets, product labels, local rules, and your
        county extension office before acting on planting, food-safety, or
        pesticide-related advice.
      </p>

      <h2>Policies</h2>
      <p>
        Review the <Link href="/terms">Terms</Link>,{' '}
        <Link href="/privacy">Privacy Policy</Link>, and{' '}
        <Link href="/trust">Trust &amp; Safety</Link> page for more detail about
        what Gnome collects, what stays private, and what is not allowed.
      </p>
    </main>
  );
}
