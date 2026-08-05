import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Gnome handles your information.',
};

const UPDATED = 'August 4, 2026';

export default function PrivacyPage() {
  return (
    <main className="container legalpage">
      <h1>Privacy Policy</h1>
      <p className="sub">Last updated {UPDATED}</p>

      <h2>What we collect</h2>
      <p>
        Your email address (for sign-in), the profile details you choose to add
        (name, town), your listings and photos, messages you exchange about
        pickups, and basic usage events (like &ldquo;listing created&rdquo;) that help us
        improve the product. If you allow location access in the app, we use it
        to show nearby listings; the public map and website only ever show an
        approximate area, never your exact address.
      </p>

      <h2>How it&rsquo;s used</h2>
      <p>
        To run the marketplace: showing your listings to neighbors, sending the
        notifications you&rsquo;d expect (claims, messages), signing you in, and
        keeping the community safe. Photos you attach to AI drafting and
        questions you ask the garden planner are processed by our AI provider
        (Anthropic) to generate the response, and aren&rsquo;t used to build
        advertising profiles.
      </p>

      <h2>What we don&rsquo;t do</h2>
      <p>
        We don&rsquo;t sell your personal information, and we don&rsquo;t show third-party
        ads. Your exact location and email are never shown publicly.
      </p>

      <h2>Where it lives</h2>
      <p>
        Data is stored with Supabase (our database and authentication provider)
        on servers in the United States. The website uses local storage for your
        sign-in session — no third-party tracking cookies.
      </p>

      <h2>Your choices</h2>
      <p>
        You can edit or delete your listings anytime, and delete your account
        from the app&rsquo;s Settings (or by emailing us) — which removes your profile
        and listings. Email{' '}
        <a href="mailto:hello@gnomefarmersmarket.com">hello@gnomefarmersmarket.com</a>{' '}
        for any access, correction, or deletion request.
      </p>

      <h2>Children</h2>
      <p>Gnome isn&rsquo;t for children under 13, and we don&rsquo;t knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes materially, we&rsquo;ll note it here with a new date.
        Questions are always welcome at the email above.
      </p>
    </main>
  );
}
