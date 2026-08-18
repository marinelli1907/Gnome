import type { Metadata } from 'next';
import DeleteAccountClient from './DeleteAccountClient';

// Google Play requires a publicly reachable URL where a user can request
// account deletion — reachable WITHOUT installing the app and without signing
// in first, because the reviewer will open it cold. So this page is indexable
// (unlike /login) and explains the whole thing before asking for a session.
//
// Apple 5.1.1(v) is satisfied separately by the in-app path in expo/app/settings.tsx;
// both call the same delete-account edge function, which takes identity from the
// caller's JWT and never from a request body.
export const metadata: Metadata = {
  title: 'Delete your Gnome account',
  description:
    'Permanently delete your Gnome account and everything in it — your Market, listings, messages, orders and uploaded documents. See exactly what is removed and how to request deletion.',
  alternates: { canonical: '/delete-account' },
};

export default function DeleteAccountPage() {
  return (
    <main className="container" style={{ paddingTop: 40, paddingBottom: 64 }}>
      <section className="hero" style={{ paddingTop: 0, paddingBottom: 16 }}>
        <span className="kicker">Your account, your call</span>
        <h1>Delete your Gnome account</h1>
        <p>
          This removes your account and everything attached to it, permanently. Nothing is
          archived and nothing can be restored afterwards — so it&rsquo;s worth reading what
          goes before you start.
        </p>
      </section>

      <section className="section" style={{ maxWidth: 640, paddingTop: 0 }}>
        <h2 style={{ marginBottom: 8 }}>What gets deleted</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          Gnome (Boone Systems LLC) removes all of the following:
        </p>
        <ul>
          <li>Your sign-in and profile — name, photo, town and ZIP</li>
          <li>Your contact details, including phone number and any delivery addresses</li>
          <li>Your Market, every listing in it, and their photos</li>
          <li>Your claims and every message in those conversations, for both sides</li>
          <li>Your orders and your sales records</li>
          <li>Seller credentials and any permit documents you uploaded</li>
          <li>Grow Log photos, saved blocks, and your activity history</li>
          <li>Push notification tokens for your devices</li>
        </ul>
        <p>
          Your listings and conversations disappear for the neighbors who could see them too,
          not just for you.
        </p>

        <h2 style={{ marginBottom: 8 }}>What is kept</h2>
        <p style={{ marginTop: 0 }}>
          Nothing that identifies you stays in Gnome. Payments are processed by Stripe, and
          Stripe keeps its own transaction records under its retention rules and the financial
          record-keeping law that applies to them — that is Stripe&rsquo;s copy, not a copy in
          Gnome, and deleting your Gnome account does not reach into it.
        </p>
        <p>
          If you have an active paid plan, cancel it before deleting so no further charge is
          raised. Deleting the account does not by itself cancel a Stripe subscription.
        </p>

        <h2 style={{ marginBottom: 8 }}>How long it takes</h2>
        <p style={{ marginTop: 0 }}>
          Immediately. The deletion runs while you wait — there is no grace period and no queue,
          which is also why there is no undo.
        </p>

        <h2 style={{ marginBottom: 8 }}>Delete it now</h2>
        <DeleteAccountClient />

        <h2 style={{ marginBottom: 8, marginTop: 32 }}>Other ways to ask</h2>
        <p style={{ marginTop: 0 }}>
          You can do the same thing in the Gnome app under <strong>Settings → Delete account</strong>.
          If you can&rsquo;t sign in at all, email{' '}
          <a href="mailto:hello@gnomefarmersmarket.com?subject=Account%20deletion%20request">
            hello@gnomefarmersmarket.com
          </a>{' '}
          from the address on the account and we&rsquo;ll verify you and delete it for you.
        </p>
      </section>
    </main>
  );
}
