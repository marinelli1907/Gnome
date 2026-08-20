import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What Gnome collects, who handles it, and what stays private.',
};

const UPDATED = 'August 20, 2026';

export default function PrivacyPage() {
  return (
    <main className="container legalpage">
      <h1>Privacy Policy</h1>
      <p className="sub">Last updated {UPDATED}</p>

      <h2>The short version</h2>
      <p>
        Gnome collects what a neighborhood marketplace actually needs: a way to
        sign you in, the listings and photos you post, the messages you send
        about a pickup, and roughly where you are so we can show you what&rsquo;s
        nearby. Neighbors see your display name, your town, and
        an <strong>approximate</strong> map pin — never your exact address, your
        email, or your phone number. We don&rsquo;t run ads, we don&rsquo;t use
        third-party trackers, and we don&rsquo;t sell or rent your information to
        advertisers or data brokers.
      </p>

      <h2>Who we are</h2>
      <p>
        Gnome (Gnome Farmers Market) is operated by Boone Systems LLC, Ohio,
        USA. This policy covers the Gnome mobile app and gnomefarmersmarket.com.
        Reach us any time at{' '}
        <a href="mailto:daniel@boonesystems.com">daniel@boonesystems.com</a>.
      </p>

      <h2>What we collect</h2>
      <p>
        <strong>Account and contact details.</strong> Your email address — it&rsquo;s
        how you sign in. On the website you can use a password or a one-time
        sign-in link; in the app you sign in with a code emailed to you, or with
        Apple or Google. When you first join, Gnome&rsquo;s welcome conversation
        asks for your first name, last name, and the best email for order
        notices. A phone number is optional and Gnome never requires one.{' '}
        <strong>
          Your full last name, contact email, and phone are kept in a private
          record that other users cannot read.
        </strong>{' '}
        What neighbors see is your display name. When you give us a first and
        last name — in the welcome chat, or later in your profile — we build that
        name ourselves as your first name plus a last initial, like
        &ldquo;Daniel M.&rdquo;, and the full last name never leaves the private
        record. If you signed in with Apple or Google, or skipped the welcome
        chat, your display name starts as whatever your account supplied (which
        may be a full name or the front of your email address) until you set it.
        You can change it at any time in your profile.
      </p>
      <p>
        <strong>Your Market and profile.</strong> When you post, Gnome creates
        your Market — its name, description, photo and banner, your town, county
        and state, and any website or social links you add. You can also save a
        contact email, a phone number, and an exact pickup address for your
        Market. Those last ones are <strong>owner-only</strong>: public pages
        show only your town, and an exact pickup address is released to a buyer
        only after you confirm their order.
      </p>
      <p>
        <strong>Listings, photos, and messages.</strong> Everything you write in
        a listing — title, description, category, price or trade terms,
        quantity, and up to five photos — plus the messages you exchange with a
        neighbor about a claim or a pickup, and any report or feedback you send
        us. Photos you upload are re-encoded before they leave your device,
        which strips camera metadata, including the GPS coordinates an iPhone
        stores in a photo.
      </p>
      <p>
        <strong>Location.</strong> If you allow it, the app takes a single
        coarse reading of your device&rsquo;s position to sort listings by
        distance, and can fill in your town, state, and ZIP for your profile. A
        listing you post from the app stores the coordinates you posted it from
        so distance math works — those exact coordinates are locked at the
        database level and are never readable by anyone but you and us. See{' '}
        <strong>Location, in detail</strong> below.
      </p>
      <p>
        <strong>Orders, pickups, and deliveries.</strong> If you order from a
        seller, we store the items, times, and amounts of that order. If you
        save a delivery address, we store the address, any delivery notes, and
        coordinates for it so the seller&rsquo;s delivery fee can be calculated.
        Delivery addresses are private to you; the seller receives the address
        for a specific order only once that order is confirmed.
      </p>
      <p>
        <strong>Payments and subscriptions.</strong> Payments run through
        Stripe. Card numbers are entered on Stripe&rsquo;s own checkout page and
        never touch Gnome&rsquo;s servers — we don&rsquo;t see or store them. What
        we keep is the metadata: which plan or add-on, Stripe&rsquo;s customer and
        subscription identifiers, the status, the billing period, and the
        amount. (Paid plans are not switched on in Gnome yet, so no purchase can
        currently be made in the live app.)
      </p>
      <p>
        <strong>Permits and seller credentials.</strong> Some categories require
        a license or permit. If you submit one, we store what you type — state,
        county, credential type, issuing agency, credential number, issue and
        expiration dates, and your notes — and the document file itself. See{' '}
        <strong>Seller permits and documents</strong> below.
      </p>
      <p>
        <strong>Push notifications.</strong> If you turn them on, we store a
        push token for that device and which platform it is, so we can reach
        you about claims, messages, and orders.
      </p>
      <p>
        <strong>Gnome AI.</strong> The garden planner, the listing assistant,
        the in-app help gnome, and the welcome conversation are AI features. We
        store your side of those conversations and the assistant&rsquo;s replies
        so the conversation has a memory, along with usage counts (which
        feature, how many requests, how long they took) to enforce daily limits
        and watch costs. We do <em>not</em> store the photos you send to an AI
        feature except as part of a draft listing you asked it to make.
      </p>
      <p>
        <strong>Usage and diagnostics.</strong> Coarse product events —
        &ldquo;listing created,&rdquo; &ldquo;claim started,&rdquo; &ldquo;order
        completed,&rdquo; a ZIP typed into the website&rsquo;s search box — so we
        can tell what people actually use. The Garden Planner usage event
        records only non-content metadata, such as the question length and
        whether a photo was attached, not the question text itself. There are no
        advertising SDKs, no session recorders, and no third-party analytics in
        either the app or the website. The website stores your sign-in session
        in your browser&rsquo;s local storage; there are no tracking cookies.
      </p>

      <h2>Public, private, and administrative</h2>
      <p>
        <strong>Public.</strong> Your display name (&ldquo;Daniel M.&rdquo;, or
        whatever it is currently set to — see above),
        your avatar, your town, county and state, when you joined, your Market&rsquo;s
        name, description, photos and links, your active listings with their
        photos and text, and an approximate map pin. Anyone on the internet can
        see these — no account required.
      </p>
      <p>
        <strong>Private to you.</strong> Your sign-in email, your full last
        name, your contact email and phone, your exact coordinates, your
        delivery addresses, your Market&rsquo;s exact pickup address, your saved
        payment relationship with Stripe, your device push tokens, your AI
        conversations, your permit documents, and your messages (visible only to
        you and the neighbor you&rsquo;re talking to).
      </p>
      <p>
        <strong>Administrative.</strong> Some records exist so Gnome can be run
        safely and legally: permit reviews and their decisions, moderation
        reports, account status, plan and billing state, and audit logs of admin
        actions. Gnome staff can see these. Other users cannot.
      </p>

      <h2>What goes to the AI provider — and what doesn&rsquo;t</h2>
      <p>
        Gnome&rsquo;s AI features run on <strong>Google&rsquo;s Gemini models</strong>.
        Google is the only AI provider Gnome uses. Requests go from our servers
        to Google&rsquo;s API — your device never talks to Google directly, and
        neither your account id nor your sign-in email travels with the request.
      </p>
      <p>
        <strong>What is sent:</strong> what you type into an AI conversation;
        photos you deliberately attach to the listing assistant or the
        &ldquo;check my plant&rdquo; flow; the town or region you give the garden
        planner, after street addresses and exact coordinates are rejected,
        coarsened, or redacted; and a small, deliberately minimal pack of
        context about your own account — your Market&rsquo;s name and plan, how
        many active listings you have, your town, county and state, and, if you
        have a seed order, its status, tracking number, and the varieties in it.
        So the assistant can tell you what neighbors are looking for, it is also
        given a count of recent public &ldquo;wanted&rdquo; posts by category in your
        state — aggregate demand, never anyone&rsquo;s post text, name, or contact
        details.
      </p>
      <p>
        <strong>What is not sent:</strong> your sign-in email, your password,
        your phone number, your exact coordinates, your delivery or pickup
        addresses, your permit documents, your payment details, or the contents
        of your private messages with neighbors. In the welcome conversation,
        any email address or phone number you type is stripped out of the text
        before it is sent to Google — the model never receives it. Your name is
        part of that conversation, because the assistant is asking for it.
      </p>
      <p>
        We use Google&rsquo;s free service tier, which does not carry the data-use
        protections of Google&rsquo;s paid tier. Treat anything you send to an AI
        feature as something Google may review or use to improve its services.
        That is exactly why we keep what we send minimal — and why you should
        not paste anything sensitive into an AI chat.
      </p>

      <h2>How we use your information</h2>
      <p>
        To run the marketplace: showing your listings to neighbors, matching
        &ldquo;wanted&rdquo; posts to nearby offers, arranging claims, pickups,
        and deliveries, and sending the notifications you&rsquo;d expect. To sign
        you in and keep your account yours. To calculate delivery distance and
        fees. To answer your AI questions and draft listings you asked for. To
        review seller permits where the law requires one. To bill paid plans. To
        keep the community safe — reviewing reports, blocks, and abuse. And to
        understand, in aggregate, which parts of Gnome people use, so we can
        make it better. We do not use your information to build advertising
        profiles.
      </p>

      <h2>Who else handles your information</h2>
      <p>
        We keep the list short on purpose. Each of these does a specific job:
      </p>
      <p>
        <strong>Supabase</strong> — our database, authentication, file storage,
        and server functions, hosted in the United States. Almost everything
        described above lives there. Supabase also delivers the sign-in emails.
      </p>
      <p>
        <strong>Google</strong> — the Gemini models behind Gnome&rsquo;s AI
        features, and Google Sign-In if you choose it.
      </p>
      <p>
        <strong>Stripe</strong> — payments and subscriptions. Stripe collects
        your card and billing details directly and keeps its own record of the
        transaction under its own privacy policy.
      </p>
      <p>
        <strong>Apple</strong> — Sign in with Apple if you choose it, the App
        Store, Apple Maps in the app&rsquo;s map view, and Apple&rsquo;s geocoding
        when the app turns coordinates into a town name on an iPhone.
      </p>
      <p>
        <strong>Expo</strong> — the push-notification service that relays alerts
        to your device (and from there through Apple or Google), and the
        over-the-air update service for the app. Push notifications travel
        through these services in readable form, and can include an item title,
        a neighbor&rsquo;s display name, an order time and amount, or the first
        part of a chat message. If that matters to you, turn off notification
        previews on your phone&rsquo;s lock screen, or turn Gnome notifications
        off entirely.
      </p>
      <p>
        <strong>OpenStreetMap (Nominatim)</strong> — turns a delivery address or
        a searched place name into coordinates. The address text is sent to that
        public service to be looked up; no account information goes with it.
      </p>
      <p>
        Beyond these, we share personal information only when you ask us to,
        when it&rsquo;s part of a transaction you started (a confirmed order
        releasing a pickup address to the buyer), or when we are legally
        required to. If Gnome is ever sold or merged, information would transfer
        with the business, and we&rsquo;d say so here first.
      </p>

      <h2>Selling, ads, and tracking</h2>
      <p>
        We do not sell or rent your personal information for money, and we do
        not disclose it to advertising networks, data brokers, or anyone who
        would use it to target ads to you — including under the broader
        definitions of &ldquo;sell&rdquo; and &ldquo;share&rdquo; used by
        California and other state privacy laws. The only paid placements in
        Gnome are sellers boosting their own listings, which involves no data
        about you. The one thing worth naming plainly: the AI provider&rsquo;s free
        tier described above, where Google may use what is sent to improve its
        services.
      </p>

      <h2>Location, in detail</h2>
      <p>
        The app asks for location only when you use a feature that needs it, and
        takes a single balanced-accuracy reading rather than tracking you in the
        background. Coordinates attached to a listing are stored in a column
        that has been explicitly revoked from every client — the app and the
        website literally cannot read it. What is published instead is a rounded
        pair of coordinates, cut to two decimal places, which places you
        somewhere inside roughly a half-mile to a mile square. That is what the
        map pin, the browse list, and every distance figure are built from,
        which is also why distances are shown as approximate.
      </p>
      <p>
        Your exact address only ever reaches another person because you chose to
        send it: a pickup address released to a buyer whose order you confirmed,
        a delivery address released to the seller who is bringing your order, or
        something you typed into a message. Photos are stripped of embedded GPS
        data before upload on both the app and the website.
      </p>

      <h2>Seller permits and documents</h2>
      <p>
        Permit and license documents go into a private storage area, not the
        public one. Only you and Gnome&rsquo;s reviewers can open them, and reviewers
        do so through short-lived links rather than a permanent public address.
        Other sellers can never see them. We keep them because a reviewer needs
        to check the credential and because expiry has to be tracked. When you
        delete your account, your credential records and the uploaded documents
        are deleted with it.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your information for as long as your account exists. Listings
        that expire stay in your history as expired rather than vanishing;
        messages stay with the claim they belong to. When you delete your
        account, we delete your profile, listings, claims, messages, device
        tokens, credential records and documents, listing photos, AI
        conversations, contact record, and your product events. A few things
        survive: feedback you sent us stays, with your account link removed;
        Stripe keeps its own record of any payment it processed, which we
        can&rsquo;t delete on Stripe&rsquo;s behalf; and the daily counters we use to
        rate-limit AI features still hold a per-day request count against your
        old account id. Those counters are a fix we owe you, not a decision.
      </p>
      <p>
        Deletion is not instantaneous everywhere. Our database provider keeps
        routine backups, so a copy of deleted rows can persist in those backups
        for a period before they cycle out. Photos are removed from storage as
        part of account deletion; deleting a single listing removes the listing
        but may leave the photo file reachable by its direct link for a while.
      </p>

      <h2>Security</h2>
      <p>
        Access to data is enforced in the database itself, row by row, rather
        than trusted to the app — that is why your private contact details,
        addresses, exact coordinates, and permit documents are unreadable by
        other users even if a screen misbehaves. Traffic is encrypted in
        transit, and our storage provider encrypts data at rest. Sensitive
        operations run on our servers with keys that never reach your device.
      </p>
      <p>
        To be straight with you: messages between neighbors are{' '}
        <strong>not</strong> end-to-end encrypted. They are stored on our
        servers, and Gnome staff and our database provider are technically able
        to access them — we do so only to investigate abuse, a report, or a
        problem you asked us to look into. No system is perfectly secure, and we
        won&rsquo;t pretend otherwise.
      </p>

      <h2>Your choices and controls</h2>
      <p>
        You can edit or delete any listing, edit or clear your profile and
        Market details, add or remove delivery addresses, block another user,
        report a listing or a person, and turn push notifications off in your
        phone&rsquo;s settings or by declining the permission. Location permission
        can be revoked at any time from your phone&rsquo;s settings; Gnome keeps
        working, it just can&rsquo;t sort by distance. Email us for a copy of your
        data, a correction, or a deletion, and we&rsquo;ll take care of it.
      </p>

      <h2>Deleting your account</h2>
      <p>
        In the mobile app, go to <strong>Profile → Settings → Delete my account</strong>.
        On the web, use <a href="/delete-account">gnomefarmersmarket.com/delete-account</a> —
        sign in there and confirm. Either way it is permanent, it takes two
        confirmations, and it removes your listings and conversations for
        everyone, not just from your view. If you can&rsquo;t sign in at all,
        email{' '}
        <a href="mailto:daniel@boonesystems.com">daniel@boonesystems.com</a>{' '}
        from your account&rsquo;s email address and we will delete it for you.
      </p>

      <h2>What Gnome AI can and can&rsquo;t do for you</h2>
      <p>
        Gnome&rsquo;s AI is a helpful gardener, not an authority. It guesses at
        plants, pests, and varieties from a photo and it is sometimes wrong. It
        does not know your local ordinances, your state&rsquo;s cottage food or
        egg or meat rules, or whether a plant is safe to eat. Never rely on it
        to identify a foraged plant or mushroom, to judge whether food is safe,
        to diagnose an illness in a person or an animal, or to tell you what you
        are legally allowed to sell. Drafts it writes for your listing are
        yours to check before you publish — nothing is ever posted on your
        behalf without your approval, and you remain responsible for what your
        listing says.
      </p>

      <h2>Children</h2>
      <p>
        Gnome is not for children under 13, and we don&rsquo;t knowingly collect
        information from them. You must be at least 13 to use Gnome and at least
        18 to sell. If you believe a child under 13 has an account, email us and
        we will remove it.
      </p>

      <h2>State privacy rights</h2>
      <p>
        Depending on where you live — California, Colorado, Connecticut,
        Virginia, Utah, Texas, and a growing list of other states — you have the
        right to know what personal information we hold about you, to get a
        copy, to correct it, to have it deleted, and to not be treated worse for
        asking. Gnome doesn&rsquo;t sell or share personal information for targeted
        advertising, and doesn&rsquo;t profile you for decisions with legal
        effects, so there is nothing to opt out of on those fronts. To exercise
        any right, email{' '}
        <a href="mailto:daniel@boonesystems.com">daniel@boonesystems.com</a>{' '}
        — we&rsquo;ll verify you through your account email and respond within the
        time your state allows. If we turn a request down, reply and tell us
        why you disagree; a person will look at it again.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        When this policy changes we update the date at the top. If a change is
        material — a new category of information, a new company handling your
        data, a genuinely new use — we&rsquo;ll say so here in plain language and,
        where it matters, in the app before it takes effect.
      </p>

      <h2>Contact</h2>
      <p>
        Boone Systems LLC, Ohio, USA — reach a human at{' '}
        <a href="mailto:daniel@boonesystems.com">daniel@boonesystems.com</a>.
        Questions about this policy are always welcome, and so is being told
        we got something wrong.
      </p>
    </main>
  );
}
