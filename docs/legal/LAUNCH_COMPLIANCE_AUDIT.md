# Launch compliance audit — store policy, legal, privacy

**Audited:** 2026-08-13 00:56 EDT · repo HEAD `54e141e`, branch `main`
**Scope:** App Store Review Guidelines, Google Play Developer Program Policy,
US consumer/auto-renewal law, and the accuracy of the published Terms, Privacy
Policy, and Trust & Safety pages against what the code actually does.
**Author:** Lane 8 audit pass. Nothing in this document was applied. Every copy
change below is a proposal for the coordinator.

> This is an engineering compliance audit, not legal advice. Items marked
> **requires counsel** are ones I am not confident about and should not be
> resolved from this document alone.

## How this audit was performed, and its limits

Everything below was determined by reading source in this repository. I did
**not**: run the app, load the production website, sign in, open App Store
Connect or Play Console, inspect production environment variables, or query the
production database. Where a finding depends on runtime or on store metadata I
say so explicitly rather than claiming verification.

**Other lanes were editing the same tree throughout this audit, and two
findings changed underneath me while it was being written.** The Seed Drop lane
landed its fix to `web/app/seeds/SeedProfileClient.tsx` and
`web/app/pricing/page.tsx` mid-audit, which resolved the core of **B1**; and a
Founding Member program arrived as a new unapplied migration
`supabase/migrations/0091_founding_members.sql`, which changed **item 22** from
"no such program exists" to a real audit. Both sections below were rewritten
against the state at 01:05 EDT and record what the earlier state was, because
the earlier state is what the fix has to stay fixed against.

Anything in this document that cites a line number should be re-checked before
acting on it if other lanes have committed since.

### What I could not verify

| Cannot verify | Why | Who can |
|---|---|---|
| Whether `NEXT_PUBLIC_SEED_LINK_STARTER` is set in production | Env vars are not in the repo | Owner, in the Vercel/host dashboard |
| Whether `NEXT_PUBLIC_STRIPE_LINK_GROWER` / `_FARM` are set | Same | Owner |
| Whether the deployed site matches this tree | No production fetch performed | Owner |
| App Store Connect age rating, Support URL, App Privacy answers | Store metadata, not code | Owner |
| Play Console Data safety form and deletion URL field | Store metadata, not code | Owner |
| Whether Google's Gemini free-tier terms currently permit training on submitted content | External vendor terms | Owner / counsel |
| Whether the $100 liability cap and Ohio venue clause are enforceable as drafted | Legal question | **Requires counsel** |
| Whether Boone Systems LLC crosses any state privacy-law applicability threshold | Legal question | **Requires counsel** |
| Whether Android `CAMERA` permission is present in the built manifest | Requires a build | Owner, via an EAS build artifact |

---

## Verdict summary

| # | Requirement | Verdict | Class |
|---|---|---|---|
| 1 | Apple account-deletion (5.1.1(v)) | **PASS** | — |
| 2 | Google account-deletion (in-app + web URL) | **PASS** | `/delete-account` live, HTTP 200 re-verified 2026-08-20 |
| 3 | Subscription disclosures | **GAP** | FIX BEFORE PUBLICATION (paid) |
| 4 | Restore purchases | **PASS (N/A)** | — |
| 5 | Auto-renewal wording | **GAP** | FIX BEFORE PUBLICATION (paid) |
| 6 | Privacy disclosures | **PASS** | B2, B3, B4 resolved; live privacy re-verified 2026-08-20 |
| 7 | Data-collection accuracy | **FIXED IN WORKING TREE** | B3 resolved |
| 8 | Camera / photo access | **PASS** | — |
| 9 | Location access | **PASS** | — |
| 10 | Notification access | **PASS** | G10 resolved; physical delivery proof still build/device-gated |
| 11 | User-generated content policy | **PASS IN WORKING TREE** | Terms §4/§15 |
| 12 | Reporting | **PASS** | — |
| 13 | Blocking | **PASS** | — |
| 14 | Moderation | **PASS** | — |
| 15 | Prohibited products | **PASS IN WORKING TREE** | Terms §4 |
| 16 | Contact information | **PASS IN WORKING TREE** | deliverable support email |
| 17 | AI disclosures | **PASS** | Live privacy + mobile planner caveat |
| 18 | Terms acceptance | **PASS** | — |
| 19 | Privacy policy availability | **PASS** | — |
| 20 | Support contact | **PASS IN WORKING TREE** | Settings + web contact |
| 21 | Marketplace seller responsibility | **PASS** | — |
| 22 | Founding Member terms | **GAP** | FIX BEFORE PUBLICATION (paid) |
| 23 | Seed Drop "Coming Soon" accuracy | **PASS** | live `/seeds` has no price/date/purchase path |

---

## Blocker Record

B1 through B4 are resolved in the working tree. They stay here as a regression
record because each was a real blocker when the audit opened.

### B1 — Seed Drop "Coming Soon": **RESOLVED LIVE**

**Class: was BLOCKER.** The working tree and the live website now have no Seed
Drop price, date, purchase, subscription, waitlist, or "shop" CTA on web or
mobile. The site-wide metadata no longer promises shipped seeds; it describes
the marketplace only.

#### What was wrong (state at 00:56, now fixed — recorded so it stays fixed)

`web/app/seeds/page.tsx` had been rewritten into an honest Coming Soon page
whose hero read *"Seed Drop is not open yet, and there's nothing here to pay
for,"* and whose header comment claimed *"The links are deleted rather than
flagged off so there is nothing left to re-arm."*

That claim was false at the time. The same page rendered `<SeedProfileClient />`
at line 153, and that component had not been touched. It still contained a live
`STARTER_LINK = process.env.NEXT_PUBLIC_SEED_LINK_STARTER` env gate — one unset
variable away from a working purchase path — a checkout button reading *"Save &
start my Seed Drop — $12 founding intro (then $24.99/season)"*, live pricing
constants, and an **unconditionally rendered** running basket total (*"6 packets
· $21.00 + $4.95 shipping = $25.95 — add 2 more packets for free shipping"*)
that appeared regardless of the env gate. A visitor read "nothing here to pay
for" at the top of the page and itemised prices with a free-shipping upsell
further down. `web/app/pricing/page.tsx` separately advertised *"Seasonal Seed
Drop — $24.99 per season"* and *"Grower + Seed Drop (~$199/yr)"* bundles. The
four price structures on the site did not agree with one another.

#### What is fixed (verified 01:05 EDT)

- `web/app/seeds/SeedProfileClient.tsx` — rewritten. `grep` for `STARTER_LINK`,
  `checkout`, `PACKET_CENTS`, `money(` now returns **nothing**. The only
  remaining button is "Save my garden profile." Its new header comment is
  accurate, and is the right instinct: *"quantity steppers and running totals
  are a cart no matter what the button says."*
- `web/app/pricing/page.tsx` — the Seed Drop price section and the bundle
  pricing are gone, replaced with a dated-free, priced-free "Coming soon"
  preview.
- `expo/components/SeedDropComingSoon.tsx` — clean from the start, and the model
  the web should be held to: no price, no date, no purchase, no waitlist, and an
  explicit *"Nothing here is for sale yet — there is no pricing, and no way to
  order or subscribe."*

**PASS** on `/seeds`, `/pricing`, and the whole mobile surface.

#### Current verification

- `web/app/seeds/page.tsx` and `web/app/pricing/page.tsx` describe Seed Drop as
  coming soon with no price, no date, and no checkout CTA.
- Direct production probes on 2026-08-20 confirmed `/seeds` is Coming Soon only
  and `/pricing` has no `$24.99` Seed Drop subscription copy.
- `web/app/page.tsx` says "Seed Drop is coming soon" / "Coming soon" and links
  with non-purchase language.
- `web/app/layout.tsx` metadata no longer claims Seed Drop is shipping.
- `expo/components/SeedDropComingSoon.tsx` remains the mobile model: no price,
  no date, no purchase, no waitlist.

### B2 — The Privacy Policy named the wrong AI provider and omitted training use. **RESOLVED LIVE**

**Class: was BLOCKER.** File: `web/app/privacy/page.tsx`.

Original copy:

> "Photos you attach to AI drafting and questions you ask the garden planner are
> processed by our AI provider (Anthropic) to generate the response, and aren't
> used to build advertising profiles."

Two problems.

**The named provider is wrong.** Every AI edge function resolves Gemini first:
`supabase/functions/_shared/providers.ts` line 4 — *"Gemini Developer API free
tier is PRIMARY for every feature"* — and OpenAI/Anthropic require both
`ai_settings.allow_paid_fallback = true` and `AI_PAID_FALLBACK_DISCLOSED=true`.
The migration default for `allow_paid_fallback` is `false`. In practice user
photos and prompts go to **Google**, not Anthropic. This is true for
`draft-listing`, `analyze-listing-photo`, `garden-planner`, `ask-gnome`,
`gnome-assistant`, and `gnome-onboarding`.

**The training-use disclosure is missing.** `providers.ts` lines 11–13 state the
project's own understanding:

> "Free-tier privacy: free-tier Gemini content may be used by Google for product
> improvement → callers must keep MINIMUM-DATA packs (ids, zones, counts — never
> buyer addresses, permit docs, payment or auth data)."

The policy says only that content isn't used for *advertising profiles*, which is
a narrower promise that reads as reassurance while leaving the actual practice
undisclosed. Users are not told their photos and questions may be used by a
third party to improve that party's products.

**Resolved current state.** The live `https://gnomefarmersmarket.com/privacy`
page and `web/app/privacy/page.tsx` now name Google's Gemini models, say Gnome
is using Google's free service tier, and warn that content sent to AI may be
reviewed or used by Google to improve its services. Direct production fetch on
2026-08-20 confirmed "Anthropic" is gone. The Gemini data-safety owner decision
is still tracked separately: move to a paid Gemini key, or declare the affected
data shared with Google.

### B3 — "What we collect" omitted most collected data. **RESOLVED IN WORKING TREE**

**Class: was BLOCKER.** File: `web/app/privacy/page.tsx`.

Original list: email, profile details (name, town), listings and photos, pickup
messages, basic usage events, optional location.

Collected but **undisclosed**:

| Data | Where |
|---|---|
| Legal first **and last** name, optional **phone number**, separate contact email | `supabase/migrations/0086_onboarding_and_ai_drafts.sql` line 26 (`user_private_contact`); collected at `expo/app/onboarding.tsx` 174, `expo/app/profile/edit.tsx` 207, `web/app/login/LoginClient.tsx` 147 |
| Buyer **delivery address**, city, state, postal code, delivery notes | `supabase/migrations/0066_delivery_ordering.sql` 26, 330, 406 |
| Seed Drop **shipping name and address** | `supabase/migrations/0067_seed_drop_subscriptions.sql` 35–39 |
| Seller **pickup addresses** | `supabase/migrations/0052_pickup_locations.sql` 14–17 |
| **Push notification device tokens** | `device_tokens`, `expo/lib/notifications.ts` |
| Seller **payment-method handles** (Zelle/Venmo identifiers) | `expo/app/market/payment-settings.tsx` 40, `web/app/my/PaymentMethodsEditor.tsx` 22 |
| Uploaded **compliance/permit documents** | `compliance-docs` bucket, `supabase/functions/delete-account/index.ts` 110 |
| **Reports** filed against other users | `reports` table |

The optional phone number the task asked about is **specifically absent** from
the policy, despite being collected in three separate surfaces and stored under
the user's identity.

**Resolved current state.** "What we collect" now covers account/contact
details, Market/profile fields, listings/photos/messages, location,
orders/pickups/deliveries, payments/subscriptions, permits and seller
credentials, push notification tokens, Gnome AI conversations/usage, usage
events, reports, feedback, and administrative records.

### B4 — Signup identifiers reached the AI provider undisclosed. **RESOLVED IN WORKING TREE**

**Class: was BLOCKER.** Files: `supabase/functions/gnome-onboarding/index.ts`,
`expo/app/onboarding.tsx`.

Original finding: conversational onboarding is a chat. The user types their
first name, last name, email address, and optionally their mobile number into it
(`gnome-onboarding/index.ts` SYSTEM prompt, lines listing fields 1–4). Those chat
turns used to be forwarded verbatim to the AI provider — Gemini free tier by
default — at `gnome-onboarding/index.ts` line ~112 (`callWithFallback(chain, {
system, turns, … })`).

That meant **direct identifiers**, not the "ids, zones, counts" that
`providers.ts` line 12 instructs callers to keep to, transit a third-party model
whose free tier that same comment says may be used for product improvement.

The Privacy Policy discloses AI processing only for *"photos you attach to AI
drafting and questions you ask the garden planner."* Signup identifiers are not
mentioned anywhere.

To be fair to the design: the security model around it is sound — the model
never writes; `save_onboarding_contact()` re-validates every field; contact
details land in owner-only `user_private_contact`, never in world-readable
`profiles`. The defect is **disclosure**, not authorization.

**Resolved current state.** The function now deterministically parses email and
phone locally, redacts both before sending turns to the provider, and never
sends the stored contact record back to the model. Names can still appear in
the welcome conversation; the Privacy Policy now says that plainly.

---

## GAPS — fix before store submission

### G1 — No web account-deletion URL (Google Play). **RESOLVED LIVE**

**Class: was FIX BEFORE SUBMISSION.**

**Apple 5.1.1(v) is satisfied — PASS.** `expo/app/settings.tsx` lines 155–169
render "Delete my account" with a two-step destructive confirm, calling the
JWT-authenticated `supabase/functions/delete-account/index.ts`, which purges
storage folders, cascades the user's rows, and finishes with
`auth.admin.deleteUser`. Identity comes from the token, never the request body.
This is a genuine in-app deletion path, correctly built.

**Google Play is now satisfied.** `https://gnomefarmersmarket.com/delete-account`
is live and returned HTTP 200 on 2026-08-20. It is a public, signed-out reachable
URL that explains the app path, email fallback, what is deleted, what is
retained, and timing. Its client signs the user in with an email code and calls
the same `delete-account` edge function as the app. Submit that URL in Play
Console.

### G2 — Terms lacked the UGC / objectionable-content clause Apple 1.2 expects. **RESOLVED IN WORKING TREE**

**Class: was FIX BEFORE SUBMISSION.** File: `web/app/terms/page.tsx`.

The *mechanisms* Apple 1.2 requires are all present and verified in code:

- **Filtering** — a DB-enforced prohibited-goods gate:
  `supabase/migrations/0043_compliance_storage_and_gate.sql` 80–91 and
  `0046_compliance_ui_support.sql` 53–65 return `PROHIBITED`; the client honors
  it at `expo/app/(tabs)/post.tsx` 230, 245, 581, 589. **PASS.**
- **Reporting** — `useReport` (`expo/lib/db.ts` 681) surfaced on listings
  (`expo/app/listing/[id].tsx` 100–114), Markets (`expo/app/market/[id].tsx`
  131–145), and conversations (`expo/app/chat/[claimId].tsx` 107–120). The
  Trust page's claim that *"Every listing, Market, and conversation in the Gnome
  app has a report option"* is **accurate**. **PASS.**
- **Blocking** — `useBlockUser` on listing and Market pages, managed in
  `expo/app/settings.tsx` 126–144. **PASS.**
- **Moderation** — an open-reports queue exists in both admin surfaces:
  `admin/App.tsx` 475–505 and `web/app/admin/AdminClient.tsx` 550–576. **PASS.**

The contractual half now exists. `web/app/terms/page.tsx` §4 states no tolerance
for objectionable content or abusive behavior, bans harassment, threats, hate,
sexual content, violence, deception, impersonation, scraping, spam, and illegal
arrangements; §15 describes reporting, blocking, moderation and suspension.

### G3 — Prohibited-products list lived only on a marketing page. **RESOLVED IN WORKING TREE**

**Class: was FIX BEFORE SUBMISSION.** Files: `web/app/trust/page.tsx` line 81,
`web/app/terms/page.tsx`.

The Terms now restate the prohibited-products list directly in §4 and
incorporate `/trust` by reference for extra category guidance.

### G4 — No support contact inside the app. **RESOLVED IN WORKING TREE**

**Class: was FIX BEFORE SUBMISSION.** File: `expo/app/settings.tsx`.

Apple 1.2 requires published contact information for UGC apps. Settings now has
both the feedback textarea and a `Contact support` mailto row using
`daniel@boonesystems.com`, the deliverable address recorded in
`GOOGLE_PLAY_PACKAGE.md` after the `hello@gnomefarmersmarket.com` MX check
failed. Still confirm the Support URL is set in App Store Connect and Play
Console (metadata — owner).

### G5 — Age rating vs. the 13+ / 18+ split (metadata)

**Class: FIX BEFORE SUBMISSION.** Owner action, no code.

`web/app/terms/page.tsx` §2: *"You must be at least 18 to sell, and at least 13
to use Gnome."* The Privacy Policy line 59 matches (*"Gnome isn't for children
under 13"*). Consistent — **PASS on the policy text**.

But the app has open user-generated content and free-text messaging. An app
rated 4+ with UGC gets rejected. The rating must be set to reflect UGC, and the
Play content rating questionnaire must answer the UGC and messaging questions
truthfully. I cannot see either console, so I cannot confirm the current values.

There is also **no age gate in the signup flow** — nothing in
`expo/app/sign-in.tsx` or `web/app/login/LoginClient.tsx` asks for or asserts
age. Enforcement is by terms only. Whether that suffices is a question for
counsel, and depends on the final rating. **Requires counsel.**

### G6 — The Garden Planner showed no on-screen AI caveat. **RESOLVED IN WORKING TREE**

**Class: was FIX BEFORE SUBMISSION.** File: `expo/app/garden.tsx`.

The screen now shows a compact disclosure below the location row:
`Gnome's planner is AI. It can be wrong — check seed packets and product labels
before you act.` The picker path still strips photo metadata through
`pickImages()` before any plant photo leaves the device.

---

## GAPS — fix before publication

### G7 — Subscription, auto-renewal, and cancellation disclosures are incomplete

**Class: FIX BEFORE PUBLICATION (of paid plans).** Blocks flipping
`payments_live_enabled` to true; does not block a free-tier launch.

**Current launch state is narrower than paid-plan launch.** The live-payments
gate is still off, `/upgrade` is informational, `UpgradePromptCard` opens that
information screen, and `expo/app/promote/[listingId].tsx` no longer offers a
paid extra-promotion checkout. Android also gates the $0.99 publish/renewal
overage path through `canBuyDigitalInApp`.

Important correction to this 2026-08-13 audit: iOS still can open Stripe-hosted
checkout for a one-time $0.99 publish/renewal overage. That is now an explicit
owner launch decision and an App Review 3.1.1 risk disclosed in
`APP_STORE_PACKAGE.md` §6, not a hidden defect in this audit.

"Restore purchases" remains **N/A** today because there are no StoreKit/IAP
products to restore.

**What is missing for the web paid plans:**

`web/app/pricing/page.tsx` 177–184 is the only billing disclosure:

> "Plans are billed monthly through Stripe and can be cancelled anytime; your
> Market simply returns to the free tier at the end of the billing period…"

It does not state that the plan **auto-renews until cancelled**, does not state
the **renewal amount and interval** as a renewal (only as a price), does not say
**where or how to cancel**, and does not appear adjacent to the purchase button
— the CTAs are at lines 147–152, the disclosure is at the bottom of the page.
US auto-renewal statutes and the FTC negative-option framework generally require
these before billing information is collected, and require cancellation to be at
least as easy as enrollment. Applicability to a business this size **requires
counsel**.

**And there is no cancellation path in the product at all.** `grep` for
`billing_portal|manage.*subscription|cancel my` across `web/` and `expo/`
returns nothing. Stripe's Customer Portal is not wired. The only route to
cancelling is emailing — while the page says "cancel anytime."

**Required before payments go live:**
1. Wire the Stripe Customer Portal (or an equivalent in-product cancel control).
2. Move a complete auto-renewal disclosure directly above each purchase button.
3. Add subscription terms to the Terms of Service — see G8.

Suggested pre-purchase disclosure block:

> **Grower — $9.99/month.** Billed today and every month on the same date until
> you cancel. Cancel anytime from Account → Billing; cancelling stops the next
> charge and your Market returns to the free tier at the end of the period
> you've already paid for. Listings above the free limit pause rather than
> disappear. No refunds for partial months.

### G8 — The Terms contain no subscription, payment, or refund terms

**Class: FIX BEFORE PUBLICATION (of paid plans).** File: `web/app/terms/page.tsx`.

The Terms describe Gnome as *"a venue only: we don't sell the listed items, we
don't process payments between neighbors, and we're not a party to any
exchange."* That statement is **accurate for the neighbor-to-neighbor
marketplace** — Gnome genuinely takes no cut and touches no peer payment.
**PASS** on the marketplace-seller-responsibility framing, which is otherwise
well done: §3 puts cottage-food, egg/dairy, meat inspection, seed labelling and
zoning squarely on the seller, and §4 warns buyers the goods are uninspected.

But the Terms are silent on the relationship where Gnome **is** a party: the
paid Grower and Farm subscriptions billed by Gnome, through Stripe, to the user.
There is no section on fees, billing, renewal, cancellation, refunds, price
changes, or what happens to listings on downgrade.

The Terms also do not distinguish the user classes the product actually has —
free neighbor, paid subscriber, seller, buyer, and (later) Seed Drop customer.
Everyone is addressed as one undifferentiated "you," and the venue-only framing
in §1 will become **false** the day Seed Drop opens and Gnome becomes a
first-party seller of physical goods.

**Required before paid launch:** add a Plans and billing section (wording below)
and scope §1's venue-only sentence to the marketplace specifically.

### G9 — Undisclosed third-party recipients: OpenStreetMap and Expo. **RESOLVED LIVE**

**Class: was FIX BEFORE PUBLICATION.** File: `web/app/privacy/page.tsx`.

Current copy names exactly one processor:

> "Data is stored with Supabase (our database and authentication provider) on
> servers in the United States. The website uses local storage for your sign-in
> session — no third-party tracking cookies."

Undisclosed recipients:

- **OpenStreetMap Nominatim.** Called directly from the user's browser/device,
  so the third party receives the query **and the user's IP address**:
  `web/app/seeds/SeedProfileClient.tsx` 141–144 sends the user's ZIP;
  `web/app/browse/BrowseClient.tsx` 42 sends a typed location;
  `expo/lib/delivery.ts` 117 geocodes for delivery — i.e. address-adjacent text.
- **Expo's push service.** `supabase/functions/notify/index.ts` line 16 posts to
  `https://exp.host/--/api/v2/push/send`. Expo relays device tokens and
  **notification bodies, including chat message previews**
  (`expo/lib/notifications.ts` 59 confirms previews are in the payload).
- **Stripe.** Not named anywhere in the policy, though it is the payment
  processor for plans and the intended Seed Drop processor.

The "no third-party tracking cookies" sentence is accurate as far as it goes —
`grep` for `gtag|google-analytics|plausible|posthog|vercel/analytics` returns
zero hits, so there genuinely is no analytics SDK. Good. But it is doing double
duty as a general third-party-sharing statement, which it is not.

**Resolved in the current web policy.** `web/app/privacy/page.tsx` now names
Supabase, Google, Stripe, Apple, Expo and OpenStreetMap, and the live privacy
page was re-probed clean on 2026-08-20. The historical finding remains here as
the regression record.

### G10 — Notifications: no disclosure of what push carries. **RESOLVED LIVE**

**Class: was FIX BEFORE PUBLICATION.**

The permission mechanics are correct — `expo/lib/notifications.ts` 24–35
requests only after sign-in, iOS needs no usage string, and the Expo config
plugin supplies Android `POST_NOTIFICATIONS`. **PASS on mechanics.**

The current Privacy Policy now discloses the stored device token and platform,
and the Expo processor section says push notifications travel through Expo in
readable form and may include item titles, display names, order details, or the
first part of a chat message. The remaining push issue is not disclosure; it is
physical-device delivery proof for the final Android/iOS builds.

### G11 — Deleting your account does not cancel your Stripe subscription

**Class: FIX BEFORE PUBLICATION (of paid plans).** File:
`supabase/functions/delete-account/index.ts`.

The function contains no Stripe call. It deletes `profiles` (line 117), which
cascades `seed_drop_subscriptions` (FK `on delete cascade`,
`0067_seed_drop_subscriptions.sql` line 29) and the market subscription rows —
then deletes the auth user. **The Stripe subscription object itself survives and
keeps billing**, and the local rows that would let anyone notice are gone.

Harmless today, because live payments are off and no live price IDs exist. It
becomes a charge-after-deletion defect on day one of paid launch, and the
Privacy Policy's deletion promise would be materially incomplete.

**Required before paid launch:** cancel active Stripe subscriptions inside
`delete-account` before the cascade, and say so in the policy.

### G12 — Broken post-checkout return URLs

**Class: FIX BEFORE PUBLICATION (of paid plans).** File:
`supabase/functions/billing-checkout/index.ts` lines 92–93.

```
success_url: `${base}/account?checkout=success`,
cancel_url:  `${base}/account?checkout=cancelled`,
```

There is no `/account` route in `web/app` — the 18 page routes are `admin`,
`browse`, `category/[category]`, `following`, `garden`, `listing/[slugId]`,
`login`, `market/[slug]`, `my`, `near/[city]`, `/`, `plots`, `pricing`,
`privacy`, `seeds`, `sell`, `terms`, `trust`. Every paying customer lands on a
404 immediately after paying, and so does every customer who abandons checkout.

Legally this matters because it is also where a subscription-management control
would live (G7). **Required:** create `/account`, or point both URLs at `/my`.

### G13 — No data-retention statement

**Class: FIX BEFORE PUBLICATION.** File: `web/app/privacy/page.tsx`.

The policy says what is deleted on request but never how long anything is kept
otherwise. `docs/seed-drop/20-legal-policy-copy.md` R2.3 already anticipates
that seed compliance and recall-traceability records must survive account
deletion where law requires — meaning the current unqualified promise (*"which
removes your profile and listings"*) will need a carve-out before Seed Drop
opens. Adding a retention section now is cheaper than contradicting the policy
later.

Exact retention periods for seed/food records: **requires counsel.**

---

## FIX WITHIN 72 HOURS

### G14 — `CREDENTIAL_HANDOFFS.md` stated the camera was never used. **RESOLVED IN WORKING TREE**

`expo/app/ai-listing.tsx` previously had an iOS-only "Take photo" branch while
`expo-image-picker` was configured with `cameraPermission: false`, making the
reviewer-facing docs internally inconsistent. The working tree removes that
branch, and the import screen's matching shortcut was removed too. Both now use
the shared `pickImages()` library path, camera is not requested, and
`expo/app.json` no longer carries a dead `NSCameraUsageDescription`.

The remaining verification is artifact-level: inspect the rebuilt iOS
`Info.plist` and Android merged manifest to confirm photo/location are present
and camera is absent.

### G15 — Stale comment in `web/app/seeds/page.tsx` — RESOLVED mid-audit

**Class: was FIX WITHIN 72 HOURS, now closed.** The header comment claiming the
Payment Links were "deleted rather than flagged off so there is nothing left to
re-arm" was untrue when written, because `SeedProfileClient.tsx` still held the
`STARTER_LINK` gate. That component has since been rewritten and the claim is
now accurate. No action.

---

## BACKLOG

- **B4(b)** — restructure onboarding so identifiers never enter a model turn.
- **State-privacy rights notices** (access/delete/correct/appeal, categories
  table, "Do Not Sell or Share" if applicable). The policy's *"We don't sell
  your personal information"* is a good start but is not a rights notice.
  Applicability thresholds for a company this size: **requires counsel.**
- **No free-text or image objectionable-content filter.** The prohibited-goods
  gate is taxonomy-based; nothing screens listing titles, descriptions, photos,
  or chat for abusive content. Report + block + admin queue carry the load
  today. Acceptable at launch scale; revisit as volume grows.
- **Terms have no DMCA/copyright-complaint procedure**, despite §5 taking a
  content licence. Low risk at current scale.
- **Terms have no dispute-resolution clause** beyond Ohio governing law.
  Whether to add arbitration/class-waiver: **requires counsel.**
- **Seed Drop legal package** — `docs/seed-drop/20-legal-policy-copy.md` already
  scopes what Seed Drop terms and privacy changes will need (R1.x, R2.x, R3.x).
  None of it is needed while Seed Drop is Coming Soon; all of it is needed
  before it opens.

---

## Items that PASS, with the evidence

| Item | Evidence |
|---|---|
| Apple in-app account deletion | `expo/app/settings.tsx` 33–72, 155–169; `supabase/functions/delete-account/index.ts` — JWT-derived identity, storage purge, cascade, `auth.admin.deleteUser` |
| Reporting | `expo/lib/db.ts` 681; listing / market / chat surfaces |
| Blocking | `useBlockUser` + `expo/app/settings.tsx` 126–144 unblock management |
| Moderation queue | `admin/App.tsx` 475–505; `web/app/admin/AdminClient.tsx` 550–576 |
| Prohibited-goods enforcement | `0043_compliance_storage_and_gate.sql` 80–91; `expo/app/(tabs)/post.tsx` 230–245 |
| Terms acceptance | `expo/app/sign-in.tsx` 369–379 — "By continuing you agree to our Terms and Privacy Policy," both tappable |
| Policy availability | `/terms`, `/privacy`, `/trust` all exist and are linked from `expo/app/settings.tsx` 171–196 |
| Seller responsibility | Terms §3 and §4; Trust page food-safety section |
| Camera / photo strings | Photo/location strings in `expo/app.json` `ios.infoPlist`; camera intentionally absent |
| Location handling | when-in-use only, `Accuracy.Balanced`, approximate public display |
| No tracking SDKs | zero hits for gtag / GA / Plausible / PostHog / Vercel Analytics |
| Paid-placement disclosure | `expo/components/ListingCard.tsx` 84–86 and `web/app/components/ListingCard.tsx` 29 both render a visible "Promoted" tag |
| Seed Drop, mobile | `expo/components/SeedDropComingSoon.tsx` — no price, no date, no purchase, no waitlist |
| Seed Drop, `/seeds` and `/pricing` | fixed mid-audit — no prices, no checkout, no re-armable env gate (see B1) |
| Founding Member — no ownership language | zero hits for equity/investor/revenue-share vocabulary anywhere, including `0091_founding_members.sql` |
| Restore purchases | N/A — no IAP exists |

### Founding Member — no ownership language (PASS), but no terms either (GAP)

A Founding Member program arrived mid-audit as
`supabase/migrations/0091_founding_members.sql` — **unapplied**, and inert even
if applied (`founding_program_config.program_enabled` ships `false`, awards are
refused unless the Stripe event is live-mode, and no live price id exists for
any product). I audited it because the brief asked specifically about ownership
implications.

#### The ownership question — PASS

`grep -rniE "shareholder|equity|investor|revenue share|profit share|co-owner|
dividend|stake in"` across `web/`, `expo/`, `admin/`, `supabase/` and `docs/`
returns **zero hits**, including inside 0091. The program's own doctrine comment
(lines 11–21) is written the right way round:

> "Founding Member is EXCLUSIVELY for paid Gnome marketplace subscribers.
> Registering early qualifies nobody. Seed Drop interest qualifies nobody. A
> complimentary plan grant qualifies nobody — it is not a payment."

What a Founding Member actually gets, per the schema: a permanent number
(`founding_number`, 1–500), a public badge string ("Founding Member #0042"), an
optional Founding Market designation, and a time-boxed launch visibility boost
(`boost_until`, constrained to 60–90 days so "temporary" cannot drift into
permanent). Those are product benefits, not financial participation. The
price-lock column comment (line 101–103) is explicit that it *"promises no
dollar amount to anybody."* **Clean — no securities-shaped language anywhere.**

Two harmless residual uses of the word: `admin/App.tsx` 686–689 uses `'Founding
Grower'` as an audit label on a complimentary grant, and the `"$12 founding
intro"` string in `SeedProfileClient.tsx` was a **price**, not a membership, and
has since been deleted with the rest of the checkout.

#### The gap — the benefits exist in schema with no published terms

**Class: FIX BEFORE PUBLICATION (paid).**

1. **There are no Founding Member terms.** `web/app/terms/page.tsx` does not
   mention the program. The migration points at
   `docs/founding/FOUNDING_MEMBER_PROGRAM.md` (line 103) — **that file does not
   exist**; `docs/founding/` is not a directory. So a program that conditions a
   benefit on a payment currently has its only definition in a SQL comment.
2. **"Price lock" is a contractual promise and needs a defined one.** The column
   comment is careful — it records *which* price someone came in on and promises
   no amount. But the moment the phrase "price lock" reaches a marketing page,
   it is a commitment about future billing, and G7/G8's Terms work must define
   it precisely: what is locked, against what, for how long, and what ends it.
3. **Status is revocable; the badge must not overpromise.** Status can go
   `LAPSED` (30-day grace after a failed payment) or `REVOKED` (refund,
   chargeback, or owner action). The `founding_badges` view correctly shows only
   `ACTIVE` members. Any customer-facing copy must therefore say the badge
   reflects a **current** paid membership, never "yours forever."
4. **The badge is public.** `founding_badges` is granted `select` to `anon`,
   which means a member's paid-subscriber status is publicly visible by design.
   That is fine for an opt-in program, but the Privacy Policy should say so once
   the program is enabled.
5. **The visibility boost is paid placement.** Existing promotions are labeled
   correctly — `expo/components/ListingCard.tsx` 84–86 and
   `web/app/components/ListingCard.tsx` 29 both render a **"Promoted"** tag, so
   the current promotions system **PASSES** paid-placement disclosure. The
   Founding Market `boost_until` boost has no UI yet. When it gets one, it needs
   the same visible label; unlabeled paid placement is the exposure, not paid
   placement itself.

**Standing rule for the coordinator, which 0091 currently honors:** a Founding
Member tier may promise product access, pricing treatment, recognition, and
early features. It must never use "founder," "owner," "shareholder," "investor,"
"equity," "stake," "revenue share," or "profit share," and must never describe
the payment as anything other than prepayment for services. Those words turn a
subscription into a securities question. **Requires counsel** before the program
is enabled.

---

## Suggested copy — Privacy Policy

`web/app/privacy/page.tsx`. Replacements are complete section bodies; JSX entity
escaping (`&rsquo;` etc.) still needs applying to match the file's style. Bump
`UPDATED` at line 8 when these land.

### Replace "What we collect" (lines 17–24)

> **Account and contact details.** Your email address for sign-in. If you
> complete your profile, your first and last name, an optional contact email,
> and an optional mobile number. Other neighbors only ever see your first name
> and last initial, your town, and your public profile details — your full last
> name, email, and phone stay private.
>
> **What you post.** Your listings, photos, your Market page, and the messages
> you exchange with neighbors about pickups.
>
> **Addresses, when you give them.** Pickup locations you set up as a seller,
> and a delivery address when you order delivery. Exact addresses are shared
> only with the specific neighbor on the other side of that exchange, and only
> after it is confirmed. Public listings and the map show an approximate area
> only.
>
> **Location, if you allow it.** Used to show listings near you. The public map
> and website never show your exact position.
>
> **Notifications.** If you turn on push notifications, we store a device token
> so we can send them.
>
> **Payment details.** If you subscribe to a paid plan, Stripe processes your
> payment and we store only the subscription's status — never your card number.
>
> **Seller paperwork.** If you sell something that requires a permit or licence,
> the documents you upload to verify it.
>
> **Usage events.** Basic product events such as "listing created," used to
> improve Gnome.

### Replace "How it's used" (lines 27–34)

> To run the marketplace: showing your listings to neighbors, sending the
> notifications you'd expect, signing you in, and keeping the community safe.
>
> **About Gnome's AI features.** Gnome's AI runs on Google's Gemini models.
> Photos you send to the listing assistant or the garden planner, the questions
> you ask, and the answers you type during the conversational signup — which can
> include your name, email, and phone number — are sent to Google to generate
> the response. Gnome currently uses Google's free service tier, and Google may
> use content submitted on that tier to improve its own products. If you would
> rather not have that happen, skip the chat signup and use the plain form
> instead, and don't use the AI features. We never use your content to build
> advertising profiles, and we don't sell it.

If option **B4(b)** is implemented instead, delete the clause about signup
answers.

### Replace "What we don't do" (lines 37–40)

> We don't sell your personal information, and we don't show third-party ads.
> Gnome has no analytics or advertising trackers. Your exact location, email
> address, and phone number are never shown publicly.

### Replace "Where it lives" (lines 43–47)

> Your data is stored with Supabase, our database and authentication provider,
> on servers in the United States. We also share specific data with a small
> number of services that make Gnome work:
>
> - **Google** — AI features, as described above.
> - **Expo** — delivers push notifications. Expo's servers handle your device
>   token and the text of the notification, which can include a message preview.
> - **Stripe** — processes payments for paid plans.
> - **OpenStreetMap (Nominatim)** — turns a ZIP code or place name into
>   coordinates when you search or set up delivery. Your browser or app contacts
>   OpenStreetMap directly, so it also receives your IP address.
>
> The website uses local storage for your sign-in session. There are no
> third-party tracking cookies.

### Replace "Your choices" (lines 50–56)

> You can edit or delete your listings at any time.
>
> **Deleting your account.** Open the Gnome app, go to Settings, and tap "Delete
> my account." This permanently removes your account, your Market, your
> listings, your messages, your photos, and any documents you uploaded. It
> cannot be undone. If you can't use the app, email
> daniel@boonesystems.com and we'll delete it for you within 30 days. You
> can also request a copy of your data, or ask us to correct it, at that
> address.

### Add a new "How long we keep things" section

> Your listings, messages, and profile stay until you delete them or delete your
> account. Basic usage events are kept in aggregate. Where the law requires us
> to keep a record — for example a transaction or compliance record — we keep
> only that record, only for as long as required, and nothing else survives
> deletion.

The specific retention periods are **pending counsel**; the wording above is
deliberately general so it does not commit to a number.

---

## Suggested copy — Terms of Service

`web/app/terms/page.tsx`. Bump `UPDATED` at line 8 when these land.

### Amend §1, first sentence, so venue-only is scoped to the marketplace

Replace *"Gnome is a **venue only**: we don't sell the listed items…"* with:

> For the neighborhood marketplace, Gnome is a **venue only**: we don't sell the
> items neighbors list, we don't process payments between neighbors, and we're
> not a party to any exchange between them. Pickup, payment, and the goods
> themselves are arranged directly between users. Where Gnome sells something
> itself, we'll say so clearly on that product's page and those sales have their
> own terms.

### Add a new §3 — Acceptable use (renumber the rest)

> **3. What's not allowed**
>
> Gnome has no tolerance for objectionable content or abusive behavior. Don't
> post or send anything that is harassing, threatening, hateful, sexually
> explicit, violent, or intended to deceive another neighbor. Don't impersonate
> anyone, don't scrape or spam, and don't use Gnome to arrange anything illegal.
>
> Some things may never be listed on Gnome: alcohol, cannabis, tobacco or
> nicotine products, prescription or medical products, weapons and ammunition,
> live animals, and unsafe chemicals. Pesticides and fertilizers may only be
> listed in their original labeled packaging. Our Trust & Safety page explains
> the categories that need care — including eggs, baked and canned goods, meat
> and dairy, and pet food — and forms part of these terms.
>
> Every listing, Market, and conversation has a report option, and you can block
> any neighbor from Settings or from their listing. Reports go to a person. We
> review them and may remove content, or suspend or permanently remove an
> account, without notice and at our discretion.

### Add a new section — Plans and billing (before paid launch only)

> **Plans and billing**
>
> Gnome is free to use. Sellers who want more listings, more pickup locations,
> and additional tools can subscribe to a paid plan. Gnome never takes a cut of
> what you sell to a neighbor.
>
> Paid plans are subscriptions. They **renew automatically** at the price and
> interval shown when you subscribe, and continue until you cancel. Billing is
> handled by Stripe; we never see your full card number.
>
> **Cancelling.** You can cancel at any time from Account → Billing. Cancelling
> stops the next charge. Your plan keeps working through the period you've
> already paid for, and your Market then returns to the free tier — listings
> above the free limit pause rather than being deleted. We don't refund partial
> periods, but if something went wrong on our end, email us and we'll make it
> right.
>
> **Price changes.** If we change the price of a plan you're on, we'll email you
> at least 30 days before it takes effect, and you can cancel before then.
>
> Deleting your Gnome account also cancels any active subscription.

That last sentence must not ship until **G11** is actually implemented.

### §7 — no change proposed

The $100 liability cap, the "as is" disclaimer, and Ohio governing law are
outside what I should assess. **Requires counsel**, particularly on whether a
$100 cap survives in a consumer contract in the relevant states.

---

## Suggested copy — new page `/delete-account`

For `web/app/delete-account/page.tsx`, to be submitted as the Play Console
account-deletion URL. Static, no auth, must be reachable while signed out.

> # Deleting your Gnome account
>
> **From the app.** Open Gnome, go to **Settings**, and tap **Delete my
> account**. You'll confirm twice, because it can't be undone. Deletion happens
> immediately.
>
> **By email.** If you can't get into the app, email
> **daniel@boonesystems.com** from the address on your account and ask us
> to delete it. We'll confirm it's you and delete the account within 30 days.
>
> **What gets deleted:** your account and sign-in, your profile and contact
> details, your Market, your listings and their photos, your requests and
> pickups, your messages, your grow-log photos, and any documents you uploaded
> to verify a permit or licence.
>
> **What we may keep:** where the law requires us to keep a specific record —
> for example a transaction or compliance record — we keep only that record, for
> only as long as required. It isn't linked to a usable account and isn't shown
> to anyone.
>
> Questions: daniel@boonesystems.com

Retention wording here must stay consistent with the Privacy Policy retention
section, and the specifics are **pending counsel**.

---

## Recommended order of work

This order is updated for the 2026-08-20 launch tree. The original B1-B4 and
G1-G4/G6/G14 fixes have either landed in the working tree or been verified live;
the record above stays as regression evidence.

1. **G5** — owner sets store metadata; confirm the age rating reflects UGC.
2. **Android/iOS artifacts** — check the final Android manifest against a real
   AAB/APK and inspect the generated iOS privacy manifest in the final IPA.
3. **Console/device gates** — Supabase auth redirect/provider settings, physical
   Android push, iOS push/OAuth/password-reset round trips, and Play/App Store
   submission fields.
4. Everything under "fix before publication" **before** live payments are ever
   enabled. G7, G11, G12 and the Founding Member terms gap are
   a single coherent piece of work: a real `/account` page with a working cancel
   control, correct renewal disclosures, deletion that cancels billing, and
   written terms for any tier that conditions a benefit on a payment.
