import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms for using Gnome, the neighborhood farmers market.',
};

const UPDATED = 'August 18, 2026';

// These terms are the contract users actually accept (the app's sign-in screen
// and the web login link here), so everything below has to match what the code
// does — not what the marketing pages hope it will do. Two standing rules for
// anyone editing this file:
//   1. Never describe a product that cannot be bought. Seed Drop is Coming Soon
//      and the Founding Member program is built but switched off; both are
//      written here in the conditional for that reason.
//   2. Never promise a control the product doesn't have. There is no self-serve
//      cancel page and no web delete page today, so §12 and §16 say "email us,"
//      which is the path that actually exists. §16 warns that deleting an
//      account does NOT cancel a subscription because delete-account/index.ts
//      touches no Stripe object — when that is fixed, this warning should go.
// REQUIRES COUNSEL, unresolved and deliberately left alone here: whether the
// $100 liability cap in §18 survives in a consumer contract; whether an
// arbitration or class-waiver clause should exist at all; whether the age
// split in §2 is sufficient without an age gate in signup; and the whole
// Founding Member section once that program is enabled (§13).

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
        supplies, and similar items. For that marketplace, Gnome is a{' '}
        <strong>venue only</strong>: we don&rsquo;t sell the items neighbors
        list, we don&rsquo;t process payments between neighbors, and we&rsquo;re
        not a party to any exchange between them. Pickup, payment, and the goods
        themselves are arranged directly between users. If Gnome ever sells
        something itself, we&rsquo;ll say so plainly on that product&rsquo;s page,
        and that sale will have its own terms.
      </p>

      <h2>2. Your account</h2>
      <p>
        You must be at least 18 to sell, and at least 13 to use Gnome. You&rsquo;re
        responsible for what happens on your account, including anything posted
        or sent from it. One person, one account. We may suspend or remove
        accounts or listings that break these terms or the law.
      </p>

      <h2>3. What you can post</h2>
      <p>
        A listing can give something away, offer a trade, offer something for
        sale, ask for something you want, or offer a garden plot for a neighbor
        to reserve. A <strong>Wanted</strong> post is a request, not an offer to
        buy at any price — and when a neighbor answers it, everything in these
        terms about sellers applies to them. Whatever the type, the listing has
        to describe the real thing you actually have, honestly.
      </p>

      {/* Anchored: a refused listing links straight to this section. */}
      <h2 id="prohibited">4. What&rsquo;s not allowed</h2>
      <p>
        Gnome has no tolerance for objectionable content or abusive behavior.
        Don&rsquo;t post or send anything harassing, threatening, hateful,
        sexually explicit, violent, or meant to deceive another neighbor.
        Don&rsquo;t impersonate anyone, don&rsquo;t scrape or spam, and don&rsquo;t
        use Gnome to arrange anything illegal.
      </p>
      <p>
        Some things may never be listed on Gnome: alcohol, cannabis, tobacco and
        nicotine products, prescription and medical products, weapons and
        ammunition, and unsafe chemicals. Pesticides and fertilizers may only be
        listed in their original labeled packaging. Don&rsquo;t list anything
        illegal, recalled, unsafe, misrepresented, stolen, or that you don&rsquo;t
        have the right to sell. Our{' '}
        <a href="/trust">Trust &amp; Safety</a> page explains the categories that
        need extra care — eggs, baked and canned goods, meat and dairy, pet food
        — and forms part of these terms.
      </p>

      <h2>5. Seller responsibilities</h2>
      <p>
        Sellers are solely responsible for their listings and for complying with
        all laws that apply to what they offer — including state cottage-food
        laws, egg and dairy regulations, meat inspection and licensing
        requirements, seed labeling laws, pet-food and feed registration, and
        local zoning. Some things need permits or are prohibited from
        neighbor-to-neighbor sale in some states; it&rsquo;s the seller&rsquo;s job
        to know. You are also responsible for your own taxes.
      </p>

      <h2>6. Regulated categories</h2>
      <p>
        Some categories are gated. Depending on the category and where you are,
        Gnome may block publishing outright, ask you to affirm a statement about
        how the item was produced, require a paid seller plan, or require you to
        upload a permit, license, or registration for us to review before your
        listing can go live. While a document is under review you can save a
        draft but not publish. Documents you upload are stored privately and are
        visible only to you and to Gnome.
      </p>
      <p>
        These gates are our house rules, and they are not legal permission. Us
        approving a document, or not gating a category at all, never means your
        listing is lawful where you live — that judgment stays yours.
      </p>

      <h2>7. Buyer responsibility</h2>
      <p>
        Homegrown and homestead goods are not commercially inspected. Use your
        judgment, ask sellers questions, and handle food appropriately. Meet in
        safe, public-ish places (a porch counts) and bring a friend if you like.
      </p>

      <h2>8. Claims, requests, and pickup</h2>
      <p>
        When you claim a free item, offer a trade, request to buy, or answer a
        Wanted post, the seller decides whether to accept. If they accept, a
        message thread opens between the two of you for that one exchange, and
        it becomes read-only once the exchange is marked complete. A claim is an
        arrangement between neighbors — Gnome doesn&rsquo;t reserve the item,
        guarantee it will be there, or hold anything for you. Show up when you
        said you would, and tell the other person if plans change.
      </p>

      <h2>9. Money changes hands between you, not through us</h2>
      <p>
        <strong>Gnome takes no cut of neighbor-to-neighbor exchanges — no
        transaction fee, no commission, no listing fee.</strong> We don&rsquo;t
        process, hold, escrow, or refund those payments. Sellers can publish how
        they&rsquo;d like to be paid (cash at pickup, Venmo, PayPal, Cash App,
        Zelle, or something else) and the payment itself happens on that service
        or in person, under that service&rsquo;s terms and not ours. The same is
        true of any delivery fee a seller sets: Gnome calculates and displays it,
        the seller collects it directly, and we never touch it.
      </p>
      <p>
        The Sales Notebook is the seller&rsquo;s own private record of exchanges
        that already happened somewhere else. It records money; it never moves
        money. It isn&rsquo;t an accounting service, a receipt, or a tax
        document, and we don&rsquo;t verify what&rsquo;s entered in it.
      </p>

      <h2>10. Your content</h2>
      <p>
        You keep ownership of the photos and text you post. You grant Gnome a
        non-exclusive, worldwide, royalty-free license to host, store, resize,
        and display them in the app, on the website, and in the parts of the site
        search engines can see, so the marketplace works. That license ends when
        you delete the content or your account, except for copies we&rsquo;re
        required to keep or that already exist in backups. Don&rsquo;t post
        content you don&rsquo;t have rights to. If you believe something on Gnome
        infringes your copyright, email us and we&rsquo;ll look into it.
      </p>

      <h2>11. AI features</h2>
      <p>
        Gnome&rsquo;s AI features — listing drafts from a photo or a description,
        the garden planner, and the in-app assistant — generate suggestions
        automatically, and they can be wrong. They are suggestions and nothing
        more: <strong>Gnome never publishes a listing for you.</strong> An AI
        draft lands in the normal editor, and nothing goes live until you read
        it, fix what&rsquo;s wrong, and post it yourself. Once you post it,
        it&rsquo;s your listing and your responsibility — including its price,
        its description, and whether it&rsquo;s legal for you to sell. Treat
        planner and assistant answers as gardening guidance, not professional,
        legal, tax, medical, or food-safety advice.
      </p>

      <h2>12. Plans and billing</h2>
      <p>
        Gnome is free to use, and sharing your surplus always will be. Sellers
        who want more included listings each month, more pickup locations,
        delivery controls, plots, and higher AI limits can subscribe to a paid
        plan. Paying us never
        changes §9 — we still take no cut of what you sell to a neighbor.
      </p>
      <p>
        If you subscribe, a paid plan is a <strong>subscription that renews
        automatically</strong> at the price and interval shown to you at
        checkout, and it keeps renewing until it&rsquo;s cancelled. Card payments
        are handled by Stripe; we never see your full card number. Some things
        are one-time or add-on purchases instead — promoting a single listing, or
        an extra pickup location billed monthly — and those are described where
        you buy them. A promoted listing is always labeled{' '}
        <strong>Promoted</strong> where it appears.
      </p>
      <p>
        <strong>Cancelling.</strong> You can cancel at any time by emailing{' '}
        <a href="mailto:daniel@boonesystems.com">daniel@boonesystems.com</a>{' '}
        — we&rsquo;ll cancel the subscription and stop the next charge. Your plan
        keeps working through the period you&rsquo;ve already paid for, and your
        Market then returns to the free tier. Listings you already posted run
        out their normal term; new listings then draw on the free plan&rsquo;s
        smaller included allowance. Pickup locations above the free limit stop being
        selectable rather than being deleted. We don&rsquo;t generally refund
        partial periods, but if something went wrong on our end, email us and
        we&rsquo;ll make it right. If we change the price of a plan you&rsquo;re
        on, we&rsquo;ll email you before it takes effect so you can cancel first.
      </p>

      <h2>13. Founding Member</h2>
      <p>
        The Founding Member program is <strong>not open</strong>. No one has been
        made a Founding Member, no number has been issued, and no price or
        benefit has been promised to anyone. If we open it, we&rsquo;ll publish
        its terms first. It would recognize people holding a paid Gnome
        marketplace subscription — signing up early, joining a waitlist, or
        expressing interest wouldn&rsquo;t qualify anyone — the number of
        memberships would be limited, and membership would depend on keeping that
        subscription current: it lapses if the subscription lapses, and can be
        revoked on a refund, a chargeback, or abuse.
      </p>
      <p>
        To be unambiguous about what it isn&rsquo;t: a Founding Member
        subscription would be prepayment for services and nothing else. It is not
        equity, ownership, a stake, an investment, a security, or any share of
        Gnome&rsquo;s revenue or profit, and it confers no control over Boone
        Systems LLC.
      </p>

      <h2>14. Seed Drop</h2>
      <p>
        Seed Drop is <strong>coming soon</strong>. There is nothing to buy, no
        price, and no opening date. Telling Gnome about your garden saves a
        garden profile so our first suggestions fit your zone and space — it is
        not an order, a reservation, or a subscription, it does not put you in a
        queue, and it creates no payment obligation of any kind. Seed Drop would
        be the one place Gnome sells something itself rather than acting as a
        venue, so before it opens we will update these terms and say plainly what
        changes.
      </p>

      <h2>15. Reports, moderation, and suspension</h2>
      <p>
        Every listing, Market, and conversation has a report option, and you can
        block any neighbor. Reports go to a person. We may remove content,
        restrict features, suspend an account, or permanently remove one — with
        or without notice, at our discretion — when something breaks these terms
        or the law, or when we think a neighbor is at risk. A suspended account
        can&rsquo;t post listings or make claims. We don&rsquo;t pre-screen
        listings or messages, and we&rsquo;re not obligated to monitor them; the
        report button is how most problems reach us, so please use it.
      </p>

      <h2>16. Ending it</h2>
      <p>
        You can stop using Gnome at any time. You can delete your account from
        Settings in the Gnome app, or on the web at{' '}
        <a href="/delete-account">gnomefarmersmarket.com/delete-account</a> —
        either way it removes your profile, listings, and uploads, and it
        can&rsquo;t be undone. If you can&rsquo;t sign in at all, email{' '}
        <a href="mailto:daniel@boonesystems.com">daniel@boonesystems.com</a>{' '}
        from the address on the account and we&rsquo;ll delete it for you. If you have a paid plan,{' '}
        <strong>cancel it first</strong> — or say so in the same email — because
        deleting your account does not by itself stop a subscription from
        renewing. Sections 9, 17, and 18 survive your account ending.
      </p>

      <h2>17. Disputes between neighbors</h2>
      <p>
        If an exchange goes wrong — the item wasn&rsquo;t as described, someone
        didn&rsquo;t show up, a payment didn&rsquo;t arrive — that&rsquo;s
        between the two of you. Gnome isn&rsquo;t a party to it, doesn&rsquo;t
        arbitrate it, and can&rsquo;t reverse a payment we never handled. Report
        it anyway: we can act on the account, even when we can&rsquo;t fix the
        exchange.
      </p>

      <h2>18. No warranties; limitation of liability</h2>
      <p>
        Gnome is provided &ldquo;as is.&rdquo; To the maximum extent permitted by
        law, Boone Systems LLC is not liable for the conduct of users, the
        quality or safety of listed items, or indirect, incidental, or
        consequential damages arising from your use of the service. Our total
        liability for any claim is limited to $100.
      </p>

      <h2>19. Changes and contact</h2>
      <p>
        We may update these terms; we&rsquo;ll change the date at the top, and
        continued use means acceptance. These terms are governed by Ohio law.
        Questions:{' '}
        <a href="mailto:daniel@boonesystems.com">daniel@boonesystems.com</a>.
      </p>
    </main>
  );
}
