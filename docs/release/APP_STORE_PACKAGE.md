# App Store submission package — Gnome 1.1.0

Audited 2026-08-13 against `54e141e`. Every factual claim below cites the file or
command it came from. Where a thing genuinely cannot be checked from this
machine, it says so instead of guessing.

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
| Build number | **Managed remotely — currently `2`** | `eas build:version:get --platform ios` → "iOS buildNumber - 2" | See note |
| `appVersionSource` | `remote` | `expo/eas.json` → `cli.appVersionSource` | OK |
| `autoIncrement` | `true` on `production` | `expo/eas.json` → `build.production` | OK |
| EAS project | `@marinelli1907/gnome`, id `b84fe5e3-5446-45dd-b078-9db076159143` | `eas project:info` | OK |
| Deployment target | iOS **15.1** | prebuilt `ios/Gnome.xcodeproj/project.pbxproj` → `IPHONEOS_DEPLOYMENT_TARGET` | OK |
| iPad support | **No** — `supportsTablet: false` | `expo/app.json` → `ios.supportsTablet` | OK (no iPad screenshots needed) |
| Orientation | Portrait | `expo/app.json` → `orientation` | OK |
| Encryption declaration | `ITSAppUsesNonExemptEncryption: false` | `expo/app.json` → `ios.infoPlist` | OK — skips the per-build export questionnaire |

**Build-number note.** Remote iOS buildNumber is `2` and `autoIncrement: true`,
so the next production build is **build 3 of version 1.1.0**. That is fine and
needs no action — but be aware **two iOS builds already exist** (below), so
"first build" language in older docs is out of date.

### 1.2 Build history (this contradicts "no build has ever run")

`eas build:list --json` returns exactly **2 builds, both iOS, both 2026-08-08**:

| Platform | Profile | Version | Build | Distribution | Finished |
|---|---|---|---|---|---|
| iOS | `production` | 1.0.0 | 2 | STORE | 2026-08-08 21:58 UTC |
| iOS | `preview` | 1.0.0 | 2 | INTERNAL | 2026-08-08 23:00 UTC |

A store-distribution `.ipa` therefore already exists. **No Android build has ever
run.** Nothing in the EAS record indicates a submission; `eas.json` →
`submit.production` is `{}`, so `eas submit` has never been configured.

### 1.3 Signing, capabilities, entitlements

| Item | Actual | Source | Verdict |
|---|---|---|---|
| Signing | EAS-managed (nothing in repo; `*.p8`, `*.p12`, `*.mobileprovision` are gitignored) | `expo/.gitignore` | **Unverifiable here** — see §9 |
| Sign in with Apple | `usesAppleSignIn: true`; plugin `expo-apple-authentication` present; prebuild emits `com.apple.developer.applesignin = [Default]` | `expo/app.json`; prebuilt `ios/Gnome/Gnome.entitlements` | OK |
| Apple provider enabled server-side | **`"apple": true`** | `curl https://fgybyghwcjlstqxkclch.supabase.co/auth/v1/settings` — verified live today | OK |
| Google provider enabled server-side | **`"google": true`** | same call | OK |
| Push entitlement | prebuild emits `aps-environment = development` | prebuilt `ios/Gnome/Gnome.entitlements` | **Verify in the built IPA** — Xcode/EAS normally substitutes `production` when exporting with an App Store profile, but this has never been checked on an actual archive |
| `UIBackgroundModes` | absent | prebuilt `Info.plist` | Correct — Gnome sends alert pushes only, not silent pushes |
| Associated domains | **absent** — no `com.apple.developer.associated-domains` | `expo/app.json`, prebuilt entitlements | See risk R4 |

### 1.4 Permissions and usage strings

| Permission | Usage string | Actually used by code? |
|---|---|---|
| `NSLocationWhenInUseUsageDescription` | "Gnome uses your location to show surplus produce listings near you." | **Yes** — `expo/lib/location.ts` `getCurrentCoords` / `currentLocationFields` / `getCoordsIfGranted`, all `requestForegroundPermissionsAsync` + `Accuracy.Balanced` |
| `NSPhotoLibraryUsageDescription` | "Gnome needs access to your photos so you can add pictures to your listings." | **Yes** — `expo/lib/images.ts` `pickImages` → `ImagePicker.launchImageLibraryAsync` |
| `NSCameraUsageDescription` | present in `app.json` | **No.** The camera is never invoked — `expo/lib/images.ts` uses `launchImageLibraryAsync` only, and the `expo-image-picker` plugin config sets `cameraPermission: false`, which **strips the key from the generated Info.plist** (confirmed: the prebuilt `Info.plist` has no `NSCameraUsageDescription`). The `app.json` line is dead config. Harmless, but misleading. |
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

`ios/Gnome/PrivacyInfo.xcprivacy` (prebuild-generated) declares the four
required-reason API categories (FileTimestamp, UserDefaults, SystemBootTime,
DiskSpace) with reason codes, `NSPrivacyTracking: false`, and
**`NSPrivacyCollectedDataTypes: <array/>` — empty.**

That empty array is factually wrong for this app (§5 enumerates roughly a dozen
collected types). It is not a hard rejection today — App Store Connect's App
Privacy questionnaire is the authoritative disclosure and third-party SDK
manifests are what Apple's automated check reads — but it is an inconsistency a
reviewer or a future audit can point at. **Recommend** populating it via
`expo.ios.privacyManifests` in `app.json` (coordinator owns that file).

### 1.7 Icon

`expo/assets/images/icon.png` is 1024×1024 **RGBA (has an alpha channel)**
(`file` output). App Store icons must be opaque. Expo's prebuild icon generator
flattens transparency for iOS icons, so this is *probably* fine — but it has
never been checked on a built artifact. Verify the app icon in the uploaded
build shows no black/transparent corners before releasing.

---

## 2. BLOCKERS and RISKS, ranked

### R1 — "Coming soon" purchase surfaces are a Guideline 2.1 rejection risk. **HIGH**

The binary shows real prices next to buttons that cannot do anything:

- `expo/app/promote/[listingId].tsx:155` renders `Feature for {days} days ·
  {formatPrice(priceCents)}` (default `399` = $3.99). Tapping it opens
  `Alert.alert('Buy a promotion · $3.99', 'Promotion checkout is almost ready.
  Until then, Grower ($9.99/mo) includes 3 promotions a month…')`.
- `expo/components/UpgradePromptCard.tsx:47` — tapping "Upgrade" opens
  `Alert.alert('Coming soon', '<Plan> plans arrive soon…')`.
- `expo/app/upgrade.tsx:95` — "Additional locations $X/mo each — billing setup
  coming soon."
- `expo/app/upgrade.tsx:104-119` — the full tier list with `$X/mo` per plan.

App Review Guideline **2.1 (App Completeness)** rejects placeholder and
"coming soon" functionality; **2.3.1** covers hidden/non-functional features.
Priced buttons that resolve to an apology alert are exactly the pattern that
draws it. This is the single most likely reason a first submission bounces.

**Recommended fix (coordinator/app owner, not this doc's owner):** either wire
billing, or remove the dollar amounts and the purchase framing from the button
labels and alerts — describe the plan tiers as capability tiers without prices
and without a call to action. Do **not** replace them with a link to
gnomefarmersmarket.com/pricing; that converts a completeness risk into an
anti-steering risk (§6).

### R2 — Seed Drop: **fixed in the working tree during this audit; the live website has not caught up.** **LOW (was HIGH)**

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

**What still stands:**

1. **The deployed website is still the old one.** My fetch of
   `gnomefarmersmarket.com/seeds` today showed the purchase flow, because the web
   fix is in the tree and not deployed. That no longer affects App Review (the
   app doesn't link there), but it does mean the store listing must not describe
   Seed Drop as available, and §3 does not.
2. **A "coming soon" teaser is still a mild Guideline 2.1 surface.** An
   announcement with no purchase path is materially different from R1's priced
   button that fails, and reviewers generally accept product teasers. Low risk,
   worth knowing if the review comes back citing 2.1.

*(Policy note for the record: the old link was **not** an IAP violation either —
seed packets are physical goods, explicitly outside IAP under Guideline 3.1.5(a).
The risk was completeness and honesty, not 3.1.1.)*

### R3 — Privacy Policy names the wrong AI provider. **MEDIUM**

`web/app/privacy/page.tsx` says photos and planner questions "are processed by
our AI provider (**Anthropic**)". The actual provider chain in
`supabase/functions/draft-listing/index.ts:123-126` is:

```
gemini (MODELS.vision)  →  openai gpt-4o (only if allow_paid_fallback)  →  anthropic claude-sonnet-5 (only if allow_paid_fallback)
```

Google is the **primary** processor of user photos, and is not named. Apple
requires the privacy policy to be accurate about third parties that receive
user data. Low rejection probability, real accuracy problem. Fix the policy text
(web lane owns it).

### R4 — No universal links; password-reset arrives as a `gnome://` scheme link. **MEDIUM**

Reset emails redirect to `gnome://auth-callback?code=…`
(`AuthProvider.requestPasswordReset`). The in-app handler now exists and is
correct (§1.5), but custom-scheme URLs are not reliably linkified by every mail
client, and there is no associated-domains fallback. If a reviewer tests
"forgot password", it may look broken through no fault of the code.

**Mitigation without code changes:** tell the reviewer, in the review notes, to
use the **email code** sign-in path (below) rather than password reset. That path
is fully server-side and needs no deep link.

### R5 — Privacy manifest declares zero collected data types. **LOW** (see §1.6)

### R6 — `aps-environment` unverified on a real archive. **LOW-MEDIUM** (see §1.3)

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
• Give away — surplus zucchini finds a home
• Trade — your basil for their tomatoes
• Wanted — ask for what you're after, and let neighbors offer it
• Offer a plot — share space in your garden with someone who has none

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
| Support URL | `https://gnomefarmersmarket.com` | HTTP 200 today |
| Marketing URL | `https://gnomefarmersmarket.com` | HTTP 200 |
| Privacy Policy URL | `https://gnomefarmersmarket.com/privacy` | HTTP 200 |
| Terms (EULA) | `https://gnomefarmersmarket.com/terms` | HTTP 200 — use as a Custom EULA; **required**, see §4.5 |

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
| — Is the UGC moderated? | **Yes** | Report on every listing / Market / chat (`expo/lib/db.ts` `useReport` → `reports`, `supabase/migrations/0013_trust_layer.sql`); block/unblock (`useBlockUser`, managed in `expo/app/settings.tsx`); admin moderation surfaces (`supabase/migrations/0024_admin_moderation.sql`, `web/app/admin/`); demo/sample content is labeled "Preview" (`0023_demo_labeling.sql`). |
| **Messaging / user-to-user communication** | **Yes** | Private pickup chat between a claimer and a listing owner (`expo/app/chat/[claimId].tsx`). |
| **Does the app share the user's location with other users?** | **Yes, approximate only** | Listings surface an approximate area and a distance. Exact coordinates are deliberately not exposed — `listings.lat/lng` is revoked at the DB level, photo EXIF (including GPS) is stripped before upload (`expo/lib/images.ts`), and exact pickup addresses are released only to an approved counterparty. |
| Made for Kids | **No** | The Privacy Policy states Gnome is not for children under 13. |
| Gambling / Contests / Loot boxes | None | No IAP of any kind. |

**Resulting rating: 13+.** The drivers are user-generated content, direct
messaging between strangers, and location-based discovery — not any depicted
content. This is consistent with the Privacy Policy's under-13 statement.

### 4.5 EULA requirement for UGC apps

Guideline 1.2 requires apps with user-generated content to have terms the user
agrees to. Gnome satisfies the pieces as follows:

| 1.2 requirement | Status | Evidence |
|---|---|---|
| A method for filtering objectionable material | **Partial — reactive only.** Prohibited categories are blocked at post time by the compliance gate; there is no proactive text/image filter. | `0043_compliance_storage_and_gate.sql`; no profanity/image classifier found anywhere in the repo |
| A mechanism to report offensive content | Present | `useReport` on listing, Market, and chat screens |
| The ability to block abusive users | Present | `useBlockUser`; blocks also suppress match pushes (`supabase/functions/notify/index.ts`) |
| Published contact information | Present | `hello@gnomefarmersmarket.com` on `/privacy` and `/terms`; in-app feedback form in Settings |
| EULA the user accepts | Present | `expo/app/sign-in.tsx:370` — "By continuing you agree to our Terms" |

**Attach `https://gnomefarmersmarket.com/terms` as a Custom EULA in App Store
Connect** and state the 24-hour objectionable-content removal commitment in the
review notes (§8). The missing proactive filter is the weakest leg; reviewers
generally accept report + block + admin moderation + a stated SLA.

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
| **Purchases** | **No** | — | — | No IAP; no payment instrument is ever collected. Payment happens off-platform (§6) |
| **Health / Fitness / Financial → Payment Info / Sensitive Info / Browsing History / Search History / Contacts / Diagnostics** | **No** | — | — | No such collection. No crash-reporting SDK is installed. Permits are business licenses, not personal identity documents, so they do not meet Apple's "Sensitive Info" definition |

### 5.2 Third parties that receive user data

| Recipient | What it receives | Where in code |
|---|---|---|
| **Supabase** (US) | Everything — database, auth, storage, edge functions | `expo/lib/supabase.ts`; project `fgybyghwcjlstqxkclch` |
| **Expo push service** (`exp.host`) | Push token + notification body, including chat message previews | `supabase/functions/notify/index.ts` |
| **Google Gemini** (primary), optionally **OpenAI** and **Anthropic** | Listing photos and Garden Planner text | `supabase/functions/draft-listing/index.ts:123-126` — see R3 |
| **OpenStreetMap Nominatim** | **The buyer's full street address**, sent from the device | `expo/lib/delivery.ts:117` — `fetch('https://nominatim.openstreetmap.org/search?…&q=<address>')` |
| **Apple / Google** | OAuth identity during sign-in only | `expo/providers/AuthProvider.tsx` |

The Nominatim call is worth a second look: a US home address leaves the device
for a third-party volunteer-run service with no data-processing agreement. It is
disclosed nowhere in the Privacy Policy. Consider moving the geocode server-side
(so the disclosure becomes "our backend") or naming OSM explicitly in the policy.

---

## 6. In-app purchase and subscription analysis

**This is the highest-value section of this document. Read it before submitting.**

### 6.1 What the binary actually does today — verified

- **No StoreKit, no IAP library.** `expo/package.json` contains no
  `expo-in-app-purchases`, `react-native-iap`, or `react-native-purchases`.
- **No Stripe in the app.** Grepping `expo/{app,components,lib,providers}` for
  `stripe`, `checkout`, `billing-checkout` yields exactly one hit: the string
  literal `'stripe'` as a possible value of `entitlement_source` in
  `expo/app/upgrade.tsx:23`. The `billing-checkout` edge function exists but the
  app never calls it.
- **No in-app link to a purchase page for a digital product.** There is no link
  to `/pricing` anywhere in the app.
- **Every upgrade/boost CTA resolves to a native alert saying "coming soon."**
  (Listed in R1.)
- **The only outbound purchase-adjacent links are for physical goods:**
  1. Seed Drop card → `gnomefarmersmarket.com/seeds` (seed packets — physical).
  2. "Pay seller" rows → `venmo://`, `paypal.me`, `cashapp`, Zelle identifier,
     or plain text instructions (`expo/lib/marketops.ts:168-192`,
     `expo/components/orders/PayMethods.tsx`). Opening a link never marks
     anything paid, and `PaymentDisclaimer` always renders: *"Payment is handled
     outside Gnome. The seller confirms payment separately."*

### 6.2 Which rules apply

| Guideline | Applies? | Why |
|---|---|---|
| **3.1.1 — In-App Purchase required** for unlocking features/functionality | **Not triggered today** | Nothing in the app unlocks anything for money. The plan tiers are read-only descriptions of entitlements granted server-side. |
| **3.1.5(a) — Goods and Services Outside of the App** | **Applies, and Gnome is on the right side of it** | Produce, homemade goods, and seed packets are physical goods consumed outside the app. Apple explicitly requires these **not** to use IAP and permits other payment methods. Both the peer-to-peer payment links and the Seed Drop link are covered here. |
| **3.1.3(b) — Multiplatform Services** | **The safe path for plans** | A subscription purchased on the web may be *used* inside the app. An existing Grower/Farm subscriber can log in and get their entitlements with no IAP involvement. This is explicitly allowed. |
| **3.1.1 anti-steering** — no buttons, external links, or other calls to action pointing at non-IAP purchasing for **digital** content | **Not triggered today; one line of code away from being triggered** | See 6.3. |
| **3.1.1 restore requirement** | **N/A today** | If IAP is ever added, a "Restore Purchases" control becomes mandatory. Gnome has none and needs none right now. |

### 6.3 The actual risk — stated plainly

**Gnome's seller plans (Grower, Farm) are a digital service.** They unlock
higher active-listing limits, more pickup locations, promotion credits, and the
AI Listing Assistant — all consumed inside the app. That is squarely the kind of
thing Apple expects to be sold through IAP if it is sold in the app at all.

Gnome's defensible position is that these are **seller tools that facilitate the
sale of physical goods** — the same shape as commerce-platform seller apps. That
argument has been accepted for some marketplace apps and rejected for others;
Apple has not been consistent about it. **Do not assume the exemption.**

Today the question is moot because nothing is purchasable in the app. The moment
somebody wires the "Upgrade" button to a Stripe URL, three things become true at
once:

1. It is a **call to action pointing at external purchasing for digital
   content** — the classic 3.1.1 anti-steering violation.
2. Apple may argue that IAP is required for the plan itself.
3. The app becomes rejectable on both grounds in a single review.

**There is a genuine and unsettled complication here.** Following the April 2025
US injunction in *Epic v. Apple*, Apple's US storefront rules on external
purchase links changed substantially. Whether that relief still stands, in what
form, and how App Review applies it to a marketplace app **cannot be determined
from this repository and should not be assumed from memory.** If and when
Gnome wants an in-app path to purchase a plan, someone must read the then-current
Guideline 3.1.1 and the then-current US storefront terms before writing the code
— not after.

### 6.4 Recommendation

**For this submission:** ship with nothing purchasable in the app, and remove
the price strings and purchase framing described in R1 so the "coming soon"
surfaces do not read as broken commerce. Answer **"No"** to in-app purchases in
App Store Connect. Declare no subscriptions. No StoreKit configuration, no
subscription group, no restore control is required.

**Before payments go live:** pick one deliberately.
- **(a) Web-only, no in-app mention.** Safest. Subscribers buy on
  gnomefarmersmarket.com and their entitlements simply work in the app under
  3.1.3(b). This is what the code does today.
- **(b) IAP for plans.** Highest friction, zero policy risk, 15–30% commission,
  and it splits the billing system in two — the app's entitlements would need to
  reconcile StoreKit against the existing Stripe/`billing_config` model.
- **(c) External link-out under the US-storefront rules.** Only after someone
  reads the current guideline text. Do not build this on the strength of a
  remembered headline.

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

NO PURCHASES IN THE APP
This version sells nothing. There is no in-app purchase, no subscription
purchase path, and no payment processing of any kind inside the app. Where the
app shows seller plan tiers, tapping through opens a notice that plans are not
yet available. When a buyer and seller settle up, the app can open the seller's
own Venmo / PayPal / Cash App / Zelle handle; the payment happens entirely in
that app, and Gnome never sees or records it. A disclaimer to that effect is
shown every time.

SIGNING IN
Use the email and password in App Review Information. The app also supports
Sign in with Apple and Google. If you prefer, "Email me a code" issues a 6-digit
code; new signups are confirmed automatically.

ACCOUNT DELETION (Guideline 5.1.1(v))
Profile tab → Settings → "Delete my account", near the bottom. Two confirmations,
then the account, Market, listings, photos, and messages are permanently removed
server-side. Please use a throwaway account if you want to exercise it.

USER-GENERATED CONTENT (Guideline 1.2)
Every listing, Market page, and conversation has a Report control, and any user
can be blocked from the listing or Market screen (blocked users are managed in
Settings). Reports go to a staffed moderation queue and we act on objectionable
content within 24 hours, removing the content and ejecting the poster. Sample
listings are labeled "Preview" so they are never mistaken for real offers.

LOCATION
Location is foreground-only and optional — the app works without it, you just
can't sort by distance. Listings are shown at an approximate location; exact
addresses are never public, and photo metadata (including GPS) is stripped
before upload.

PERMITS
Sellers in regulated categories can upload a permit or license. Those are
business licenses, not personal identity documents.

CONTACT
hello@gnomefarmersmarket.com
```

---

## 9. Screenshot plan

**Required sizes.** `supportsTablet` is `false`, so **no iPad screenshots are
needed**. Supply the 6.9" iPhone set (1320 × 2868 portrait); App Store Connect
scales it down for smaller devices. If you also want a hand-tuned 6.5" set
(1284 × 2778), add it — otherwise one set is enough.

Up to 10 slots; use 6–8. Portrait only (the app is portrait-locked).

| # | Screen | Route | Caption |
|---|---|---|---|
| 1 | Browse feed with distance chips and type filters | `app/(tabs)/index.tsx` | "See what's growing within a mile" |
| 2 | Listing detail with photo, price, and Request button | `app/listing/[id].tsx` | "Claim it before it's gone" |
| 3 | Post composer showing the five listing types | `app/(tabs)/post.tsx` | "Sell it, share it, trade it, or ask" |
| 4 | Gnome AI draft review (photo in, editable draft out) | `app/(tabs)/ai.tsx` | "A photo becomes a listing you approve" |
| 5 | Map of nearby listings | `app/(tabs)/map.tsx` | "Everything nearby, on one map" |
| 6 | Pickup chat | `app/chat/[claimId].tsx` | "Sort out the pickup, privately" |
| 7 | Market page with pickup locations | `app/market/[id].tsx` | "Your own Market, followed by neighbors" |
| 8 | Sales Notebook totals | `app/notebook.tsx` | "One ledger for the whole season" |

**Rules for the capture pass:**
- Sign in as a purpose-made screenshot account. **No real neighbor names, real
  addresses, real phone numbers, or real avatars** may appear in any frame.
- Do **not** photograph the Upgrade or Boost screens — they show prices for
  things that cannot be bought (R1), and Guideline 2.3.3 requires screenshots to
  show the app in actual use.
- The Seed Drop card may now appear in frame 1 — it carries a visible "Coming
  soon" pill and leads to a non-transactional modal (R2). Do **not** screenshot
  the Seed Drop modal itself as a feature; App Store screenshots must show the
  app in actual use, and a coming-soon teaser is not a shipped feature.
- No device frames with a status bar showing a carrier/battery state that
  contradicts Apple's templates; use a clean simulator status bar.

**App Preview video:** optional. Skip for 1.1.0.

---

## 10. Exact remaining actions for Daniel

Ordered. Everything marked **(owner)** requires an Apple account or a console
Claude cannot and should not touch.

### Before the build

1. **(code — coordinator)** Resolve R1: remove prices/purchase framing from the
   Upgrade and Boost surfaces, or ship billing. This is the most likely
   rejection cause.
2. ~~Resolve R2~~ — **done in the working tree by the Seed Drop lane during this
   audit.** Nothing left to do for the binary. The web `/seeds` fix is in the
   tree but **not deployed**; deploy it before anyone links to that page again.
3. **(web lane)** Fix R3: name Google/Gemini in the Privacy Policy's AI
   paragraph, and decide whether to disclose or eliminate the Nominatim address
   lookup (§5.2).
4. *(optional)* Populate `expo.ios.privacyManifests` in `app.json` so
   `NSPrivacyCollectedDataTypes` is not empty (R5).

### Apple Developer portal (owner)

5. Confirm the **App ID `app.boonesystems.gnome`** exists with **Sign In with
   Apple** and **Push Notifications** capabilities enabled. EAS syncs these from
   `usesAppleSignIn` and the push entitlement, but confirm rather than assume.
6. Run `eas credentials --platform ios` and confirm: a **Distribution
   certificate**, an **App Store provisioning profile**, and an **APNs key**
   exist for this project. **I could not verify any of these** — that command is
   interactive and nothing about signing is stored in the repo.

### App Store Connect (owner)

7. Create the app record: name **Gnome**, bundle id `app.boonesystems.gnome`,
   SKU (suggested `gnome-ios-001`), primary language English (U.S.).
8. Paste §3 (name, subtitle, keywords, promotional text, description, What's New,
   categories, URLs, copyright).
9. Upload the §9 screenshots.
10. Complete **App Privacy** from §5. Tracking: **No**. Do not skip the
    Precise Location or Financial Info rows — both are real.
11. Complete the **age rating** questionnaire from §4. Expected result: **13+**.
12. Attach `https://gnomefarmersmarket.com/terms` as the **Custom EULA**.
13. Answer **"No"** to in-app purchases and add no subscription products (§6.4).
14. Answer **"Yes"** to account deletion (§7).
15. Create the reviewer account by hand, enter its credentials in **App Review
    Information**, and paste the §8.2 notes. Do not put credentials in this repo.
16. Content Rights: confirm the app contains third-party content — it hosts
    user-generated content and you have the rights/permissions to display it.

### Build and submit

17. `cd expo && eas build --platform ios --profile production` — produces
    version **1.1.0**, build **3** (remote buildNumber is 2 with autoIncrement).
18. **Before submitting, verify on the artifact:** the app icon has no
    transparency, and the entitlements show `aps-environment = production`
    (R6). Neither has ever been checked on a real archive.
19. Fill `submit.production` in `eas.json` (`appleId`, `ascAppId`,
    `appleTeamId`) or submit with `eas submit --platform ios` and answer the
    prompts. **`submit.production` is currently `{}` — coordinator owns
    `eas.json`; do not add credentials to it, use EAS secrets or the prompts.**
20. Submit for review. Expect the first pass to probe: account deletion, the
    "coming soon" surfaces, and UGC moderation.

---

## Resolved since the 2026-08-10 audit

`docs/launch/CREDENTIAL_HANDOFFS.md` listed six blockers. Four are now closed:

| Old blocker | Status now | Evidence |
|---|---|---|
| eas.json has no `env` block → unconfigured binary | **RESOLVED, twice over.** `eas.json` now sets `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` on all three profiles, **and** the same two are set in the EAS `production` environment | `expo/eas.json`; `eas build:version:get` printed "The following environment variables are defined in both the production build profile env configuration and the production environment on EAS… The values from the build profile configuration will be used." |
| `OAUTH_READY` hardcoded; providers possibly disabled | **RESOLVED.** `sign-in.tsx` now fetches `/auth/v1/settings` at runtime and only renders a provider's button if the server says it is enabled. Live check today: `apple: true`, `google: true`, `email: true` | `expo/app/sign-in.tsx:39-68`; `curl …/auth/v1/settings` |
| Password-reset deep link had no handler | **RESOLVED.** `AuthProvider.tsx` handles `getInitialURL` + the `url` event, parses `?code=`, exchanges it for a session | `expo/providers/AuthProvider.tsx:77-96` |
| No EAS build has ever run | **RESOLVED.** Two iOS builds on 2026-08-08, one store-distribution | `eas build:list` |
| APNs credentials / device push test | **STILL OPEN** — nothing in the repo can prove these exist | interactive `eas credentials` required |
| App Store Connect metadata | **STILL OPEN** — this document is the input for it | §3–§5, §10 |
