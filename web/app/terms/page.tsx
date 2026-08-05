import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms for using Gnome, the neighborhood farmers market.',
};

const UPDATED = 'August 4, 2026';

export default function TermsPage() {
  return (
    <main className="container legalpage">
      <h1>Terms of Service</h1>
      <p className="sub">Last updated {UPDATED}</p>

      <h2>1. What Gnome is</h2>
      <p>
        Gnome (operated by Boone Systems LLC, Ohio, USA) is a neighborhood
        marketplace where people share, trade, buy, and sell homegrown and
        homestead goods — produce, plants, seeds, eggs, honey, firewood, garden
        supplies, and similar items. Gnome is a <strong>venue only</strong>: we
        don&rsquo;t sell the listed items, we don&rsquo;t process payments between
        neighbors, and we&rsquo;re not a party to any exchange. Pickup, payment, and
        the goods themselves are arranged directly between users.
      </p>

      <h2>2. Your account</h2>
      <p>
        You must be at least 18 to sell, and at least 13 to use Gnome. You&rsquo;re
        responsible for what happens on your account. We may suspend or remove
        accounts or listings that break these terms or the law.
      </p>

      <h2>3. Seller responsibilities</h2>
      <p>
        Sellers are solely responsible for their listings and for complying with
        all laws that apply to what they offer — including state cottage-food
        laws, egg and dairy regulations, meat inspection and licensing
        requirements, seed labeling laws, and local zoning. Some things need
        permits or are prohibited from neighbor-to-neighbor sale in some states;
        it&rsquo;s the seller&rsquo;s job to know. Don&rsquo;t list anything illegal, recalled,
        unsafe, misrepresented, or that you don&rsquo;t have the right to sell.
      </p>

      <h2>4. Buyer responsibility</h2>
      <p>
        Homegrown and homestead goods are not commercially inspected. Use your
        judgment, ask sellers questions, and handle food appropriately. Meet in
        safe, public-ish places (a porch counts) and bring a friend if you like.
      </p>

      <h2>5. Your content</h2>
      <p>
        You keep ownership of the photos and text you post. You grant Gnome a
        non-exclusive license to display them in the app and on the website so
        the marketplace works. Don&rsquo;t post content you don&rsquo;t have rights to.
      </p>

      <h2>6. AI features</h2>
      <p>
        Gnome&rsquo;s AI features (listing drafts, the garden planner) generate
        suggestions automatically. They can be wrong. Review AI-drafted listings
        before posting, and treat planner advice as gardening guidance, not
        professional, legal, or safety advice.
      </p>

      <h2>7. No warranties; limitation of liability</h2>
      <p>
        Gnome is provided &ldquo;as is.&rdquo; To the maximum extent permitted by law,
        Boone Systems LLC is not liable for the conduct of users, the quality or
        safety of listed items, or indirect, incidental, or consequential
        damages arising from your use of the service. Our total liability for
        any claim is limited to $100.
      </p>

      <h2>8. Changes and contact</h2>
      <p>
        We may update these terms; continued use means acceptance. These terms
        are governed by Ohio law. Questions:{' '}
        <a href="mailto:hello@gnomefarmersmarket.com">hello@gnomefarmersmarket.com</a>.
      </p>
    </main>
  );
}
