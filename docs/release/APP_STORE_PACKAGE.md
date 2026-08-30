# App Store submission package — Gnome 1.1.0

Audited 2026-08-13 against `54e141e`, then reconciled on 2026-08-29 against the
1.1.0 release branch and final EAS build 27. Every factual claim below cites
the file or command it came from.
Where a thing genuinely cannot be checked from this machine, it says so instead
of guessing.

**Companion doc:** `docs/release/GOOGLE_PLAY_PACKAGE.md` (Play side).
**Prior audit:** `docs/launch/CREDENTIAL_HANDOFFS.md` (2026-08-10). Several of its
blockers are now resolved — see "Resolved since the last audit" at the end.

---

## 0. The one structural fact that shapes this whole document

`expo/ios/` and `expo/android/` are **gitignored and untracked**
(`expo/.gitignore` → `# Native`; `git ls-files expo/ios expo/android` returns 0
files). They are local `expo prebuild` output from the 2026-08-12 device build.

So:

- **`expo/app.json` is the source of truth for anything EAS builds.** EAS Build
  receives no native directories and runs prebuild in the cloud.
- The local `expo/ios/*` and `expo/android/*` values quoted below are useful
  *evidence of what prebuild generates*, but they are **not** what ships. Every
  place that distinction matters is marked.

---

## 1. Configuration audit

### 1.1 Identity and versioning

| Item | Actual value | Source | Verdict |
|---|---|---|---|
| Bundle identifier | `app.boonesystems.gnome` | `expo/app.json` → `ios.bundleIdentifier` | OK |
| App name (binary) | `Gnome` | `expo/app.json` → `name`; `CFBundleDisplayName` in prebuilt `Info.plist` | OK |
| Marketing version | `1.1.0` | `expo/app.json` → `version` | OK |
| Build number | **Managed remotely — currently `27`** | `eas build:version:get --platform ios --profile production --non-interactive` on 2026-08-29 | Final artifact exists |
| `appVersionSource` | `remote` | `expo/eas.json` → `cli.appVersionSource` | OK |
| `autoIncrement` | `true` on `production` | `expo/eas.json` → `build.production` | OK |
| EAS project | `@marinelli1907/gnome`, id `b84fe5e3-5446-45dd-b078-9db076159143` | `eas project:info` | OK |
| Deployment target | iOS **15.1** | prebuilt `ios/Gnome.xcodeproj/project.pbxproj` → `IPHONEOS_DEPLOYMENT_TARGET` | OK |
| iPad support | **No** — `supportsTablet: false` | `expo/app.json` → `ios.supportsTablet` | OK (no iPad screenshots needed) |
| Orientation | Portrait | `expo/app.json` → `orientation` | OK |
| Encryption declaration | `ITSAppUsesNonExemptEncryption: false` | `expo/app.json` → `ios.infoPlist` | OK — skips the per-build export questionnaire |

**Build-number note.** Remote iOS buildNumber is `27` and `autoIncrement: true`.
Build 27 is the final release artifact; older builds are superseded and must not
be selected for version 1.1.0.

### 1.2 Build history

The final signed iOS archive is version 1.1.0 build 27 at
`artifacts/ios/Gnome-1.1.0-final.ipa`. It passed signature, entitlement, privacy
manifest, and icon checks, uploaded to App Store Connect, and finished Apple
processing. `eas.json` configures the existing App Store Connect app id; the
build has not been attached to or submitted with the public version.

### 1.3 Signing, capabilities, entitlements

| Item | Actual | Source | Verdict |
|---|---|---|---|
| Signing | EAS-managed; signed build 27 verifies and satisfies its designated requirement | `codesign --verify --deep --strict` on the final IPA | VERIFIED |
| Sign in with Apple | `usesAppleSignIn: true`; plugin `expo-apple-authentication` present; prebuild emits `com.apple.developer.applesignin = [Default]` | `expo/app.json`; prebuilt `ios/Gnome/Gnome.entitlements` | OK |
| Apple provider enabled server-side | **`"apple": true`** | `curl https://fgybyghwcjlstqxkclch.supabase.co/auth/v1/settings` — verified live today | OK |
| Google provider enabled server-side | **`"google": true`** | same call | OK |
| Push entitlement | signed build 27 carries `aps-environment = production` | `codesign -d --entitlements :-` on the final IPA | VERIFIED |
| `UIBackgroundModes` | absent | prebuilt `Info.plist` | Correct — Gnome sends alert pushes only, not silent pushes |
| Associated domains | **absent** — no `com.apple.developer.associated-domains` | `expo/app.json`, prebuilt entitlements | See risk R4 |

### 1.4 Permissions and usage strings

| Permission | Usage string | Actually used by code? |
|---|---|---|
| `NSLocationWhenInUseUsageDescription` | "Gnome uses your location to show surplus produce listings near you." | **Yes** — `expo/lib/location.ts` `getCurrentCoords` / `currentLocationFields` / `getCoordsIfGranted`, all `requestForegroundPermissionsAsync` + `Accuracy.Balanced` |
| `NSPhotoLibraryUsageDescription` | "Gnome needs access to your photos so you can add pictures to your listings." | **Yes** — `expo/lib/images.ts` `pickImages` → `ImagePicker.launchImageLibraryAsync` |
| `NSCameraUsageDescription` | "Gnome uses your camera when you take photos for listings or Zordy." | **Yes** — `expo/lib/images.ts` requests camera permission and calls `launchCameraAsync`; Post, Zordy, profile, Market, grow-log, and compliance flows expose that path. |
| Background location | **Explicitly disabled** — `isIosBackgroundLocationEnabled: false`, `locationAlwaysPermission: false` | Correct; no Always-location review burden |
| Notifications | no usage string needed on iOS | `expo/lib/notifications.ts` |

Nothing required is missing.

### 1.5 Deep links

| Item | Actual |
|---|---|
| Custom scheme | `gnome://` (plus `app.boonesystems.gnome://`) — `expo/app.json` → `scheme`; prebuilt `CFBundleURLTypes` |
| Universal links | **None.** No associated-domains entitlement, no AASA file referenced. |
| Auth callback | `gnome://auth-callback` — `expo/providers/AuthProvider.tsx` builds it with `Linking.createURL('auth-callback')` for both Google OAuth and password reset |
| Callback handler | **Present** (this was a blocker in the 2026-08-10 audit and is now fixed): `AuthProvider.tsx` registers `Linking.getInitialURL()` + `Linking.addEventListener('url', …)`, parses `?code=`, and calls `exchangeCodeForSession`, which fires `PASSWORD_RECOVERY` and flips `recoveryMode` |
| Notification routing | `expo/lib/useNotificationRouting.ts`, wired in `expo/app/_layout.tsx` |

### 1.6 Privacy manifest

`expo/app.json` now populates `expo.ios.privacyManifests` with
`NSPrivacyTracking: false`, no tracking domains, and the same 15 collected data
types declared in §5. `npx expo config --type public` resolves those 15 entries.

Signed build 27's root `PrivacyInfo.xcprivacy` carries all 15 configured
collected-data rows and `NSPrivacyTracking = false`.

### 1.7 Icon

`expo/assets/images/icon.png` is the 1024×1024 source icon. Expo's generator
flattened it correctly: signed build 27's `AppIcon60x60@2x.png` is 120×120 and
has no alpha channel.

---

## 2. BLOCKERS and RISKS, ranked

### R1 — Dead-end purchase surfaces were a Guideline 2.1 rejection risk. **RESOLVED**

The previous binary showed real prices next to buttons that could not complete
a purchase:

- `expo/app/promote/[listingId].tsx` rendered a paid single-promotion button
  with the default $3.99 price, and tapping it opened a "checkout is almost
  ready" alert.
- `expo/components/UpgradePromptCard.tsx:47` — tapping "Upgrade" opens
  `Alert.alert('Coming soon', '<Plan> plans arrive soon…')`.
- `expo/app/upgrade.tsx` showed monthly add-on pricing with a billing-setup
  placeholder.
- `expo/app/upgrade.tsx` showed monthly prices in the full tier list.

App Review Guideline **2.1 (App Completeness)** rejects placeholder and
"coming soon" functionality; **2.3.1** covers hidden/non-functional features.
Priced buttons that resolve to an apology alert are exactly the pattern that
draws it. This is the single most likely reason a first submission bounces.

**Current release behavior.** The dead-end controls were removed. The iOS
`/upgrade` screen now loads and sells the real Pro and Farm StoreKit products,
restores purchases, and opens Apple's subscription-management UI. The server
must verify the signed transaction before the app changes a plan. Android does
not expose digital-purchase controls under owner decision D1. The separate iOS
$0.99 listing-overage path remains a disclosed App Review risk (§6).

### R2 — Seed Drop: **fixed in the working tree and live website.** **RESOLVED**

**What I found first.** `expo/app/(tabs)/index.tsx` rendered a Browse-feed card
reading "Seeds picked for your zone & season, **shipped to your door**" whose
`onPress` was `Linking.openURL('https://gnomefarmersmarket.com/seeds')`. I
fetched that page: HTTP 200, an active purchase flow ("Build my Seed Drop",
"built the day you buy") with packet prices — for a product with
`billing_config.payments_live_enabled = false` and no live Stripe price IDs.

**What is true now.** The Seed Drop lane changed it mid-audit. Re-read at the
end of this audit, `expo/app/(tabs)/index.tsx:294-322` now:

- carries a **"Coming soon" pill** next to the title;
- subtitle is "Seed selections for your location, growing space & season" — the
  shipping promise is gone;
- `onPress` opens **`expo/components/SeedDropComingSoon.tsx`**, an in-app modal,
  and **no longer opens any URL**. Grepping the whole app for
  `Linking.openURL` now returns only the three legal links (terms, privacy,
  trust) in `settings.tsx` and `sign-in.tsx`.

The modal's own header comment states the constraint it was built to: *"Seed
Drop is announced, not sold. Nothing here may lead to a purchase, subscription,
reservation or waitlist."* It shows inert drop sizes and frequencies with no
price, no date, and no CTA. `web/app/seeds/page.tsx` was likewise stripped of its
Stripe Payment Links. See `docs/release/SEED_DROP_OFF.md` for that lane's own
evidence inventory.

**Current live check.** Direct production probes on 2026-08-20 confirm
`/seeds` is now Coming Soon only: no purchase CTA, no visible price, and no
Stripe subscription promise. A "coming soon" teaser is still a mild Guideline
2.1 surface, but an announcement with no purchase path is materially different
from R1's priced button that failed.

*(Policy note for the record: the old link was **not** an IAP violation either —
seed packets are physical goods, explicitly outside IAP under Guideline 3.1.3(e).
The risk was completeness and honesty, not 3.1.1.)*

### R3 — Privacy Policy names the wrong AI provider. **RESOLVED**

Original finding: `web/app/privacy/page.tsx` said photos and planner questions
"are processed by our AI provider (**Anthropic**)". The actual provider chain in
`supabase/functions/draft-listing/index.ts` is Gemini first, with paid fallback
providers only when both the database flag and the disclosure env gate allow it:

```
gemini (MODELS.vision)  →  openai / anthropic only if allow_paid_fallback AND AI_PAID_FALLBACK_DISCLOSED=true
```

Current state: the privacy policy names Google's Gemini models and the provider
adapter hides OpenAI/Anthropic keys unless `AI_PAID_FALLBACK_DISCLOSED=true`.
Apple still needs the normal AI disclosure review, but this provider-name defect
is closed.

### R4 — No universal links; password-reset arrives as a `gnome://` scheme link. **MEDIUM**

Reset emails redirect to `gnome://auth-callback?code=…`
(`AuthProvider.requestPasswordReset`). The in-app handler now exists and is
correct (§1.5), but custom-scheme URLs are not reliably linkified by every mail
client, and there is no associated-domains fallback. If a reviewer tests
"forgot password", it may look broken through no fault of the code.

**Mitigation without code changes:** tell the reviewer, in the review notes, to
use the **email code** sign-in path (below) rather than password reset. That path
is fully server-side and needs no deep link.

### R5 — Privacy manifest declares collected data types. **CONFIG FIXED** (see §1.6)

### R6 — Final-archive entitlement inspection. **BUILD 19 VERIFIED; REPEAT ON FINAL**

### NOT a blocker: account deletion. **Verified present.** See §7.

---

## 3. Listing copy

All copy below deliberately avoids: any claim that Seed Drop is available; any
price; any medical/food-safety claim; any "first/only/best" superlative.

### 3.1 Fields

| Field | Value | Limit | Used |
|---|---|---|---|
| **App Name** | `Gnome` | 30 | 5 |
| **Subtitle** | `Farmers market in your pocket` | 30 | 29 |
| **Primary category** | Shopping | — | — |
| **Secondary category** | Food & Drink | — | — |
| **Age rating** | 13+ (see §4) | — | — |

### 3.2 Keywords (100 char limit, comma-separated, no spaces)

```
local,produce,garden,homegrown,homemade,trade,barter,sell,neighbor,harvest,fresh,csa,eggs,honey
```
95 characters. Deliberately omits "farmers" and "market" — both already appear
in the subtitle, and Apple indexes name + subtitle + keywords together, so
repeating them wastes the budget. Omits "gnome" for the same reason.

### 3.3 Promotional text (170 chars — editable without a new build)

```
Fresh from nearby. Buy, sell, trade, or give away homegrown produce and homemade
goods with neighbors — and let Gnome AI turn a photo into a ready-to-post listing.
```
161 characters.

### 3.4 Description (4000 char limit)

```
Gnome is a farmers market in your pocket.

Whatever you grow, bake, or make, there are neighbors nearby who want it — and
whatever you're looking for, someone within a few miles probably has too much of
it. Gnome connects the two, without a middleman and without a delivery fleet.

BROWSE WHAT'S GROWING NEARBY
See what neighbors are offering right now, sorted by distance. Filter by
category or by how you want it: for sale, free to a good home, open to a trade,
or a garden plot you can grow in. Set your radius anywhere from one mile to
anywhere in the country.

FIVE WAYS TO POST
• Sell — set your price and your unit
• Share Free — surplus zucchini finds a home
• Trade — your basil for their tomatoes
• Wanted — ask for what you're after, and let neighbors offer it
• Offer a Plot — share space in your garden with someone who has none

GNOME AI TURNS A PHOTO INTO A LISTING
Photograph what you have. Gnome AI drafts a title, description, category, unit,
and a suggested price — then hands the draft back to you. Nothing is ever posted
automatically. You review, edit anything you like, and publish when it's right.
Ask the Garden Planner what to plant and when for where you live.

YOUR OWN MARKET
Every seller gets a Market: a page that collects your listings, your pickup
spots, your hours, and your story. Neighbors can follow it and see when you post
something new.

CLAIMS, CHAT, AND PICKUP
When someone wants what you posted, they send a request. Approve it and a
private thread opens for the two of you to sort out time and place. Set standing
pickup locations and hours so you're not negotiating the same details twice.
Payment happens between the two of you, however you already pay each other —
Gnome doesn't take a cut of your sale.

A SALES NOTEBOOK THAT ACTUALLY MATCHES YOUR SEASON
Record sales you make off the app — at the roadside stand, at the co-op, to the
neighbor who knocked on your door — alongside your Gnome sales, plus your seed,
soil, and mileage expenses. One ledger for the whole season.

GROW LOG FOR PLOTS
If you're growing on someone else's plot, log the stages with photos so the plot
owner can follow along.

BUILT FOR A REAL NEIGHBORHOOD
• Your exact address is never shown. Listings appear at an approximate location,
  and photos are stripped of their metadata before they're uploaded.
• Report and block are one tap away on every listing, Market, and conversation.
• Sellers can upload permits and licenses for the categories that need them.
• Delete your account, and everything in it, from Settings.

Gnome works anywhere in the United States. Sellers are responsible for following
their own state and local food laws; Gnome is not a party to any sale between
neighbors and does not process payments between them.
```

~2,650 characters.

### 3.5 What's New (release notes, version 1.1.0)

Because this is the first public release, the notes read as an introduction
rather than a changelog:

```
Welcome to Gnome — a farmers market in your pocket.

This first release includes everything you need to trade with the neighborhood:
browse and map what's growing nearby, post something to sell, share, trade, or
ask for, run your own Market page with pickup spots and hours, and message
buyers privately once you approve their request.

Gnome AI is here too: photograph what you have, and it drafts the listing for
you to review and edit before anything is published.

Sellers get a Sales Notebook for the sales you make off the app, a Grow Log for
shared plots, and a place to keep permits and licenses on file.

Found something confusing or broken? Settings → Send feedback goes straight to
the people building this.
```

### 3.6 URLs

| Field | Value | Verified |
|---|---|---|
| Support URL | `https://gnomefarmersmarket.com/support` | HTTP 200 on 2026-08-28 |
| Marketing URL | `https://gnomefarmersmarket.com` | HTTP 200 on 2026-08-28 |
| Privacy Policy URL | `https://gnomefarmersmarket.com/privacy` | HTTP 200 on 2026-08-28 |
| Terms (EULA) | `https://gnomefarmersmarket.com/terms` | HTTP 200 on 2026-08-28 — use as a Custom EULA; **required**, see §4.5 |

Copyright: `2026 Boone Systems LLC`.

---

## 4. Age rating questionnaire — answers with reasoning

Apple's current rating tiers are 4+ / 9+ / 13+ / 16+ / 18+.

| Question | Answer | Reasoning |
|---|---|---|
| Cartoon or Fantasy Violence | None | No such content. |
| Realistic Violence / Prolonged Graphic Violence | None | — |
| Sexual Content or Nudity | None | — |
| Profanity or Crude Humor | None | Gnome's own copy contains none. User-typed text is covered by the UGC answer below, not this one. |
| Alcohol, Tobacco, or Drug Use or References | None | The marketplace taxonomy classifies items as GENERALLY_UNRESTRICTED / CONDITIONAL / REGULATED / PROHIBITED and blocks posting in PROHIBITED categories at the database level (`supabase/migrations/0043_compliance_storage_and_gate.sql`, `0046_compliance_ui_support.sql`). Nothing in the app depicts or promotes these. |
| Simulated Gambling / Contests | None | — |
| Horror/Fear, Medical/Treatment Info, Mature Themes | None | The Garden Planner gives horticultural advice only. |
| **Unrestricted Web Access** | **No** | The app opens only specific, first-party or payment-app URLs via `Linking.openURL` (`gnomefarmersmarket.com/*`, venmo/paypal/cashapp handles) and `expo-web-browser` solely for the OAuth session. There is no in-app browser the user can navigate freely. |
| **User-Generated Content** | **Yes** | Listings, photos, Market pages, profile names/avatars, private chat messages. |
| — Is the UGC moderated? | **Yes** | Listing writes are proactively blocked or held by `0095_prohibited_content.sql`; report is available on every listing / Market / chat (`expo/lib/db.ts` `useReport` → `reports`, `supabase/migrations/0013_trust_layer.sql`); block/unblock uses `useBlockUser`; admin moderation is backed by `0101_moderation_and_team_console.sql`; demo/sample content is labeled "Preview" (`0023_demo_labeling.sql`). |
| **Messaging / user-to-user communication** | **Yes** | Private pickup chat between a claimer and a listing owner (`expo/app/chat/[claimId].tsx`). |
| **Does the app share the user's location with other users?** | **Yes, approximate only** | Listings surface an approximate area and a distance. Exact coordinates are deliberately not exposed — `listings.lat/lng` is revoked at the DB level, photo EXIF (including GPS) is stripped before upload (`expo/lib/images.ts`), and exact pickup addresses are released only to an approved counterparty. |
| Made for Kids | **No** | The Privacy Policy states Gnome is not for children under 13. |
| Gambling / Contests / Loot boxes | None | No gambling, contests, or loot boxes. IAP is limited to seller plan subscriptions. |

**Resulting rating: 13+.** The drivers are user-generated content, direct
messaging between strangers, and location-based discovery — not any depicted
content. This is consistent with the Privacy Policy's under-13 statement.

### 4.5 EULA requirement for UGC apps

Guideline 1.2 requires apps with user-generated content to have terms the user
agrees to. Gnome satisfies the pieces as follows:

| 1.2 requirement | Status | Evidence |
|---|---|---|
| A method for filtering objectionable material | **Present.** Every listing write is screened server-side. Prohibited terms/categories are blocked; regulated or review terms are held unpublished for human moderation. Image concerns remain covered by report/takedown. | Production-applied `0095_prohibited_content.sql`; moderation queue in `0101_moderation_and_team_console.sql`; seller-safe screening state in `0102_screening_columns_readable.sql` |
| A mechanism to report offensive content | Present | `useReport` on listing, Market, and chat screens |
| The ability to block abusive users | Present | `useBlockUser`; blocks also suppress match pushes (`supabase/functions/notify/index.ts`) |
| Published contact information | Present | `daniel@boonesystems.com` on `/support`, `/privacy` and `/terms`; in-app feedback form and mailto support link in Settings |
| EULA the user accepts | Present | `expo/app/sign-in.tsx:370` — "By continuing you agree to our Terms" |

**Attach `https://gnomefarmersmarket.com/terms` as a Custom EULA in App Store
Connect** and state the 24-hour objectionable-content removal commitment in the
review notes (§8). The server-side screen is a first layer rather than a
guarantee; report, block, human moderation, and takedown remain the backstop.

---

## 5. App Privacy — what Gnome actually collects

Every row was determined by reading code, not by assumption. **Nothing is used
for tracking; there is no advertising SDK, no analytics SDK, and no attribution
SDK anywhere in `expo/package.json`.** Answer "No" to tracking; no ATT prompt is
needed.

### 5.1 Data types to declare

| Apple data type | Collected | Linked to user | Purpose | Evidence |
|---|---|---|---|---|
| Contact Info → **Email Address** | Yes | Yes | App Functionality | Supabase auth identity; `user_private_contact.contact_email` (`0086_onboarding_and_ai_drafts.sql:25-33`) |
| Contact Info → **Name** | Yes | Yes | App Functionality | `profiles.name` (public, rendered "First L."); `user_private_contact.first_name/last_name` (private) |
| Contact Info → **Phone Number** | Yes (optional) | Yes | App Functionality | `user_private_contact.phone_e164`, validated in `save_onboarding_contact` |
| Contact Info → **Physical Address** | Yes | Yes | App Functionality | Buyer delivery addresses — street/city/state/ZIP/notes (`expo/app/market/order/[marketId].tsx:355-368`, `buyer_delivery_addresses`); seller exact pickup addresses (`expo/app/market/pickup-settings.tsx:477`) |
| Location → **Coarse Location** | Yes | Yes | App Functionality | Profile city/county/state/ZIP; approximate listing coordinates |
| Location → **Precise Location** | **Yes** | Yes | App Functionality | `Location.getCurrentPositionAsync({ accuracy: Balanced })` in `expo/lib/location.ts`; delivery addresses are forward-geocoded and the resulting `lat`/`lng` are **stored** on the buyer's private address row (`expo/lib/delivery.ts:145-160`). Declare Precise — the device reading is full-resolution even though only approximate values are ever shown to other users. |
| User Content → **Photos or Videos** | Yes | Yes | App Functionality | `expo/lib/images.ts` → `listing-images` bucket; grow-log photos; compliance document images |
| User Content → **Other User Content** | Yes | Yes | App Functionality | Listings, Market pages, chat messages (`claim_messages`), Sales Notebook entries, Grow Log notes, feedback |
| Identifiers → **User ID** | Yes | Yes | App Functionality | Supabase `auth.users.id` on every row |
| Identifiers → **Device ID** | Yes | Yes | App Functionality | Expo push token in `device_tokens` (`expo/lib/notifications.ts`, `0002_push.sql`) |
| Usage Data → **Product Interaction** | Yes | Yes | Analytics, App Functionality | `logEvent` → `events` table with `user_id` (`expo/lib/db.ts:12-27`). 22 distinct event names are emitted from the app today, e.g. `listing_viewed`, `listing_card_opened`, `listing_claim_started`, `claim_message_sent`, `market_viewed`, `market_order_requested`, `payment_link_opened`, `ai_draft_used`, `garden_planner_used`, `sale_recorded_mobile`, `promotion_created`, `plan_limit_hit`, `seed_drop_coming_soon_viewed` |
| Financial Info → **Other Financial Info** | Yes | Yes | App Functionality | Sales Notebook: sale amounts, quantities, optional buyer label, expenses with vendor and category (`expo/components/RecordSaleSheet.tsx`, `expo/app/notebook.tsx`) |
| Other Data | Yes | Yes | App Functionality | Seller credentials: credential type, issuing agency, permit/license number, issue and expiration dates, and the uploaded document (`expo/app/compliance/upload.tsx:69-75`, `seller_credentials`, `compliance-docs` bucket) |
| **Purchases → Purchase History** | **Yes** | Yes | App Functionality | Marketplace orders record what a buyer requested, from which Market, when, and for how much (`market_orders`, `market_order_items`). StoreKit subscription transactions are linked to the authenticated account for server verification and entitlement. Gnome still does **not** collect card or bank Payment Info. |
| **Health / Fitness / Financial → Payment Info / Sensitive Info / Browsing History / Search History / Contacts / Diagnostics** | **No** | — | — | No such collection. No crash-reporting SDK is installed. Permits are business licenses, not personal identity documents, so they do not meet Apple's "Sensitive Info" definition |

### 5.2 Third parties that receive user data

| Recipient | What it receives | Where in code |
|---|---|---|
| **Supabase** (US) | Everything — database, auth, storage, edge functions | `expo/lib/supabase.ts`; project `fgybyghwcjlstqxkclch` |
| **Expo push service** (`exp.host`) | Push token + notification body, including chat message previews | `supabase/functions/notify/index.ts` |
| **Google Gemini** (primary) | Listing photos, plant photos, Garden Planner and AI-tab text, redacted onboarding turns | AI edge functions through `_shared/providers.ts`; paid fallback providers require `AI_PAID_FALLBACK_DISCLOSED=true` |
| **OpenStreetMap Nominatim** | **The buyer's full street address**, sent from the device | `expo/lib/delivery.ts:117` — `fetch('https://nominatim.openstreetmap.org/search?…&q=<address>')` |
| **Apple / Google** | OAuth identity during sign-in only | `expo/providers/AuthProvider.tsx` |

The Nominatim call is worth a second look: a US home address leaves the device
for a third-party volunteer-run service with no data-processing agreement. It is
now disclosed in the Privacy Policy and in the App Privacy answer packet.
Consider moving the geocode server-side after launch so the disclosure becomes
"our backend" and the user's IP address is not paired with their home address at
Nominatim.

---

## 6. In-app purchase and subscription analysis

This section is authoritative for version 1.1.0. Older no-IAP analyses are
superseded and must not be pasted into App Store Connect.

### 6.1 Current iOS subscription architecture — verified

- `expo-iap` 5.3.2 supplies StoreKit integration.
- Pro uses `gnome.pro.monthly`; Farm uses `gnome.farm.monthly`.
- `expo/lib/nativeSubscriptions.ts` loads products, requests the subscription,
  obtains Apple's signed transaction JWS, and sends it to the authenticated
  `subscription-sync` Edge Function.
- The app calls `finishTransaction` only after the server accepts the purchase.
  A pending, missing, malformed, or rejected transaction never changes the plan.
- The plan screen includes **Restore purchases** and Apple's subscription
  management link.
- Paid plan cards show StoreKit's localized monthly price and the screen links
  directly to Gnome's Terms of Use and Privacy Policy.
- `FOUNDING3` selects the Pro product and uses Apple's store-confirmed
  introductory-offer eligibility. The checkout sheet was verified showing a
  three-month free trial without changing the intended business terms.

Apple sandbox testing passed product load, purchase, server verification, Pro
entitlement, and restore. The fail-closed path was also proved: StoreKit first
reported a successful sandbox purchase while server verification failed, and
the account remained Free until a valid server verification completed.

### 6.2 Other payment surfaces

- `expo/lib/billing.ts` can open a Stripe-hosted $0.99 checkout on iOS and web
  for one additional Sell publish or renewal after the included allowance is
  exhausted. Android hides this path through
  `canBuyDigitalInApp = Platform.OS !== 'android'`.
- Payments for produce and other physical marketplace goods occur directly
  between buyer and seller. The app may open the seller's Venmo, PayPal, Cash
  App, or Zelle details. Opening a payment link never marks an order paid;
  `PaymentDisclaimer` explains that the seller confirms payment separately.
- Seed Drop is a non-transactional coming-soon surface and has no purchase CTA.

### 6.3 App Review posture

| Guideline | Posture |
|---|---|
| **3.1.1 — In-App Purchase** | Pro and Farm are digital seller subscriptions and use StoreKit. Restore is present, and entitlement is server-verified. |
| **3.1.3(e) — Physical goods and services** | Produce and homemade-goods payments remain outside IAP and are handled directly between users. |
| **3.1.1(a) — $0.99 listing overage** | The external Stripe link is allowed without an external-purchase entitlement in the United States storefront. Gnome 1.1.0 must therefore remain U.S.-only; expanding availability requires a fresh storefront-policy review. Disclose the path and never describe it as a physical-goods payment. |
| **Android D1** | Android exposes no digital-purchase UI and no link-out to Stripe. |

Do not tell App Review that nothing is purchasable or that the plan screen is
informational. Submit the two StoreKit subscription products with the app, set
availability to the United States only, and use the exact review notes in §8.2.
If Apple still rejects the $0.99 external overage, remove or convert that
one-time path; do not weaken the verified subscription architecture to preserve
it.

### 6.4 Live-payment gate

`billing_config.payments_live_enabled` remains **false**. Stripe remains in TEST
mode, no real charge is authorized, and no public release may be submitted until
the owner follows the separate activation path. StoreKit sandbox proof does not
authorize production billing.

---

## 7. Account deletion — Guideline 5.1.1(v)

**Requirement:** an app that lets a user create an account must let the user
initiate deletion of that account **from within the app**. A link to a website,
or an instruction to email support, does not satisfy the rule.

**Status: PRESENT and correctly built. Not a blocker.**

| Piece | Evidence |
|---|---|
| In-app entry point | `expo/app/settings.tsx` → "Delete my account", `accessibilityLabel="Delete my account permanently"` |
| Two-step destructive confirm | `confirmDelete()` — "Delete your account?" → "This is permanent" → "Delete forever" |
| Server implementation | `supabase/functions/delete-account/index.ts` — identity taken from the caller's JWT (never from the body), service-role key stays server-side |
| Scope of the purge | `device_tokens`, `claim_messages`, `claims` (both as claimer and on the user's own listings), `listings`, `seller_credentials` + `credential_taxonomy_scope`, `markets`, `user_blocks` (both directions), `events`, `profiles`, then `auth.admin.deleteUser` |
| Storage cleanup | `grow-log` folders for every affected claim, `compliance-docs/<uid>`, `listing-images/<uid>` — purged before the rows cascade |
| Post-delete client behavior | `signOut()` then `router.replace('/')` |

Answer **"Yes"** to the account-deletion question in App Store Connect. In the
review notes, tell the reviewer exactly where it is (§8) — reviewers check this
one by hand, and burying it costs a review cycle.

---

## 8. Reviewer notes and demo credentials

### 8.1 Demo account

App Review needs a working account. **Do not commit credentials to this repo.**
Create the reviewer account by hand and type the credentials directly into App
Store Connect → App Review Information.

Two things make this easy here:
- `mailer_autoconfirm` is **`true`** on the Supabase project (verified via
  `/auth/v1/settings`), so a new signup is usable immediately with no inbox
  round-trip.
- The app offers an **email 6-digit code** sign-in path
  (`expo/app/sign-in.tsx` → `requestEmailCode` / `verifyEmailCode`) alongside
  email+password. Give the reviewer **email + password**; it needs no deep link
  and no second device.

Set the account up before submitting so the reviewer lands on something real:
one Market with a name and a couple of published listings, at least one pickup
location, and a claim in the "approved" state so the pickup chat has content.

Check "Sign-in required: Yes".

### 8.2 Review notes text

```
WHAT GNOME IS
Gnome is a local marketplace for surplus produce and homemade goods. Neighbors
post what they grow or make and sell, give away, trade, or request it. All
handoffs are arranged directly between the two people, in person.

SELLER PURCHASES
The iOS app sells Pro ($9.99/month) and Farm ($29.99/month) through Apple
StoreKit using gnome.pro.monthly and gnome.farm.monthly. Restore Purchases is on
the plan screen. Gnome unlocks a plan only after server verification of Apple's
signed transaction. Pro may show Apple's three-month introductory offer when
the App Store says the account is eligible.

The iOS app also includes a one-time Stripe-hosted $0.99 checkout for one extra
Sell publish/renewal after a seller exhausts the included allowance; Android
does not expose that path. This release is available only in the United States
storefront. Payments for physical marketplace goods happen directly between
buyer and seller. The app can open the seller's Venmo, PayPal, Cash App, or
Zelle details, but Gnome never marks an order paid from that action. A
disclaimer is shown every time.

SIGNING IN
Use the email and password in App Review Information. The app also supports
Sign in with Apple and Google. If you prefer, "Email me a code" issues a 6-digit
code; new signups are confirmed automatically.

ACCOUNT DELETION (Guideline 5.1.1(v))
Profile tab → Settings → "Delete my account", near the bottom. Two confirmations,
then the account, Market, listings, photos, and messages are permanently removed
server-side. Please use a throwaway account if you want to exercise it.

USER-GENERATED CONTENT (Guideline 1.2)
Listing writes are screened server-side; prohibited content is blocked and
regulated or review terms are held unpublished for moderation. Every listing,
Market page, and conversation also has a Report control, and users can block
one another. Reports go to a staffed moderation queue and we act on
objectionable content within 24 hours, removing the content and ejecting the
poster. Sample listings are labeled "Preview" so they are never mistaken for
real offers.

LOCATION
Location is foreground-only and optional — the app works without it, you just
can't sort by distance. Listings are shown at an approximate location; exact
addresses are never public, and photo metadata (including GPS) is stripped
before upload.

PERMITS
Sellers in regulated categories can upload a permit or license. Those are
business licenses, not personal identity documents.

CONTACT
daniel@boonesystems.com
```

---

## 9. Screenshot plan

`supportsTablet` is `false`, so no iPad set is needed. Four opaque 6.9-inch-sized
screenshots are ready in `artifacts/store/apple/`; each is 1320 × 2868 JPEG and
depicts the actual cross-platform release-mode app UI.

| # | File | Screen |
|---|---|---|
| 1 | `01-browse.jpg` | Browse feed with real photo listings and filters |
| 2 | `02-map.jpg` | Live map tiles, listing pins, and Apple attribution |
| 3 | `03-market.jpg` | A customized public Market with cover/profile photos, followers, hours, visit requests, and a live Drop |
| 4 | `04-listing.jpg` | The same Market's live Drop and photo inventory |

The set contains no emoji-only listing cards, no fake app mockup, no Upgrade or
Boost screen, and no real private contact information. The website's app preview
uses the same actual Browse capture. App Preview video is optional and omitted
for 1.1.0.

---

## 10. Exact remaining actions

The app is not ready for public submission until every open item below is
closed. This package deliberately stops before the final Submit for Review
action.

### Before App Store submission

1. **Owner:** apply the one remaining read-only grant repair listed in
   `docs/release/PRODUCTION_MIGRATION_HANDOFF.md`. The preceding five release
   migrations are applied and verified. Production remains read-only to coding
   agents. Afterward, run the read-only proof and update the ledger.
2. Leave `billing_config.payments_live_enabled = false`; do not make a real
   charge or activate public paid subscriptions during release preparation.
3. Use final iOS build 27. Do not rebuild unless a new code defect requires it;
   any rebuild must increment the build number and repeat artifact inspection.

### Apple Developer portal (owner)

4. The App ID, distribution signing, App Store profile, Sign in with Apple, and
   production push entitlement are proven by signed final build 27.
5. Complete a real-device APNs alert delivery test if it has not already been
   recorded. A production entitlement alone does not prove delivery.

### App Store Connect (owner)

6. Use the existing Gnome app record, App Store Connect id `6799531520`; do not
   create a duplicate.
7. Set Availability to the **United States only** for 1.1.0. The product,
   legal copy, and Guideline 3.1.1(a) external-overage posture are U.S.-specific.
8. Paste §3 (name, subtitle, keywords, promotional text, description, What's New,
   categories, URLs, and copyright).
9. Upload the four approved screenshots from §9.
10. Complete **App Privacy** from §5. Tracking: **No**. Do not skip the
    Precise Location or Financial Info rows — both are real.
11. Complete the **age rating** questionnaire from §4. Expected result: **13+**.
12. Attach `https://gnomefarmersmarket.com/terms` as the **Custom EULA**.
13. Attach the existing `gnome.pro.monthly` and `gnome.farm.monthly` products to
    the version for review; do not create duplicate products. Include the
    `FOUNDING3` introductory offer configured on Pro.
14. Answer **"Yes"** to account deletion (§7).
15. Create or confirm the reviewer account, enter its credentials in **App Review
    Information**, and paste the §8.2 notes. Do not put credentials in this repo.
16. Content Rights: confirm the app contains third-party content — it hosts
    user-generated content and you have the rights/permissions to display it.

### Build and submit

17. **Complete:** final build 27 was built, inspected, uploaded, and processed.
18. **Complete:** the final archive has a valid signature, correct bundle id and
    version, opaque icon, `aps-environment = production`, Sign in with Apple
    entitlement, and all 15 privacy-manifest collected-data rows.
19. Install the exact final artifact on a physical iPhone and rerun sign-in,
    Browse, Map, post, report/block, account deletion entry point, StoreKit
    product load, sandbox purchase, server entitlement, restore, and fail-closed
    verification.
20. Attach processed build 27 to version 1.1.0 in the existing app record.
    `eas.json` already holds the non-secret `ascAppId`; do not add Apple
    credentials to the repository.
21. Stop before **Submit for Review** and request the owner's final submission
    approval. Public submission and live-payment activation are separate gates.

---

## Resolved since the 2026-08-10 audit

`docs/launch/CREDENTIAL_HANDOFFS.md` listed six historical blockers. Current
status:

| Old blocker | Status now | Evidence |
|---|---|---|
| eas.json has no `env` block → unconfigured binary | **RESOLVED, twice over.** `eas.json` now sets `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` on all three profiles, **and** the same two are set in the EAS `production` environment | `expo/eas.json`; `eas build:version:get` printed "The following environment variables are defined in both the production build profile env configuration and the production environment on EAS… The values from the build profile configuration will be used." |
| `OAUTH_READY` hardcoded; providers possibly disabled | **RESOLVED.** `sign-in.tsx` now fetches `/auth/v1/settings` at runtime and only renders a provider's button if the server says it is enabled. Live check today: `apple: true`, `google: true`, `email: true` | `expo/app/sign-in.tsx:39-68`; `curl …/auth/v1/settings` |
| Password-reset deep link had no handler | **RESOLVED.** `AuthProvider.tsx` handles `getInitialURL` + the `url` event, parses `?code=`, exchanges it for a session | `expo/providers/AuthProvider.tsx:77-96` |
| No EAS build has ever run | **RESOLVED.** Final signed version 1.1.0 build 27 was downloaded, inspected, uploaded, and processed. | `artifacts/ios/Gnome-1.1.0-final.ipa` |
| APNs credentials / device push test | **PARTIAL.** Build 27 proves the production APNs entitlement. A recorded real-device delivery test remains open. | Signed build 27 entitlement inspection; §10 |
| App Store Connect metadata | **OPEN.** The app record exists, and this document plus `artifacts/store/apple/` is the upload package. | §3–§5, §8–§10 |
