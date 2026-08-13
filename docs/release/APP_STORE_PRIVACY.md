# App Store privacy answers + review metadata — Gnome 1.1.0 (iOS)

Every answer below was derived by reading this repository's code and schema, and
by inspecting the prebuild output and the live website. Where a claim could only
be established statically — because building or running the app was out of scope
for this pass — it says so in place rather than implying it was exercised.

**Audited:** 2026-08-13 against `983a1d4` on `main`, plus the one uncommitted
working-tree change (`supabase/functions/gnome-onboarding/index.ts`).
**Companion docs:** `docs/release/APP_STORE_PACKAGE.md` (submission mechanics),
`docs/release/GOOGLE_PLAY_PACKAGE.md` (Play Data Safety),
`docs/release/SUBSCRIPTION_POSTURE.md`, `docs/privacy/AI_DATA_FLOW.md`,
`docs/legal/LAUNCH_COMPLIANCE_AUDIT.md`. The last two landed from other lanes
while this was being written; where they disagree with §5 or §11.5, reconcile
before submitting rather than assuming this one is newer.

**This document supersedes §5 of `APP_STORE_PACKAGE.md`, which is wrong in two
places.** See §13, findings F3 and F1.

---

## 0. The rule this document was written under

> A data type is **collected** if it leaves the device, regardless of who
> receives it.

Supabase, Google, Apple, the Expo push service and OpenStreetMap are Gnome's
processors, not third parties Gnome is insulated from. "It only goes to
Supabase, not to us" is not a defence — Supabase *is* Gnome's server. Every row
below was scored that way.

---

## 1. The answer sheet

Paste-ready. App Store Connect → App Privacy.

| Question | Answer |
|---|---|
| Does this app collect data? | **Yes** |
| Is any data used for **tracking**? | **No** (§3) |
| Is any data used for **third-party advertising**? | **No** |
| Is any data used for **developer's advertising or marketing**? | **No** |
| Data types collected | **15** — see §2 |
| Data types linked to identity | **All 15.** Nothing is collected anonymously except one event row (§2.9) |
| Account creation offered? | **Yes** |
| Account deletion offered in-app? | **Yes** (§10) |
| In-app purchases / subscriptions? | **No** (§11.5) |
| ATT prompt needed? | **No** — no `NSUserTrackingUsageDescription` anywhere (§3) |

---

## 2. Per-data-type determinations

Apple's categories, in Apple's order. "Optional" means the user can complete the
app's core loop without supplying it.

### Summary

| Apple data type | Collected | Linked | Tracking | Purpose | Optional | Primary processor |
|---|---|---|---|---|---|---|
| Contact Info → Email Address | Yes | Yes | No | App Functionality | **Required** | Supabase |
| Contact Info → Name | Yes | Yes | No | App Functionality | **Required** | Supabase |
| Contact Info → Phone Number | Yes | Yes | No | App Functionality | Optional | Supabase |
| Contact Info → Physical Address | Yes | Yes | No | App Functionality | Optional | Supabase + OpenStreetMap |
| Location → Coarse Location | Yes | Yes | No | App Functionality | Optional | Supabase |
| Location → Precise Location | **Yes** | Yes | No | App Functionality | Optional | Supabase + OpenStreetMap |
| User Content → Photos or Videos | Yes | Yes | No | App Functionality | Optional | Supabase + Google |
| User Content → Customer Support | Yes | Yes | No | App Functionality | Optional | Supabase |
| User Content → Other User Content | Yes | Yes | No | App Functionality | Optional | Supabase + Google + Expo |
| Identifiers → User ID | Yes | Yes | No | App Functionality | **Required** | Supabase |
| Identifiers → Device ID | Yes | Yes | No | App Functionality | Optional | Expo push service |
| Usage Data → Product Interaction | Yes | Yes | No | Analytics + App Functionality | **Not offerable** | Supabase |
| Financial Info → Other Financial Info | Yes | Yes | No | App Functionality | Optional | Supabase |
| **Purchases → Purchase History** | **Yes** | Yes | No | App Functionality | Optional | Supabase |
| Other Data | Yes | Yes | No | App Functionality | Optional | Supabase |
| Contact Info → Other Contact Info | No | — | — | — | — | — |
| Health & Fitness (all) | No | — | — | — | — | — |
| Financial Info → Payment Info / Credit Info | **No** | — | — | — | — | — |
| Sensitive Info | **No** | — | — | — | — | — |
| Contacts (address book) | **No** | — | — | — | — | — |
| Browsing History | **No** | — | — | — | — | — |
| Search History | **No** | — | — | — | — | — |
| Diagnostics (all) | **No** | — | — | — | — | — |
| Identifiers → Advertising Identifier | **No** | — | — | — | — | — |
| Surroundings / Body / Other Data Types | No | — | — | — | — | — |

**Fifteen data types are "Yes".** In full: Email Address, Name, Phone Number,
Physical Address, Coarse Location, Precise Location, Photos or Videos, Customer
Support, Other User Content, User ID, Device ID, Product Interaction, Other
Financial Info, Purchase History, Other Data. Declare each one — Apple groups
several onto the same screen (both User Content rows, both Location rows, both
Identifier rows), which makes it easy to tick one and move on.

### 2.1 Contact Info → Email Address — **collected, linked, required**

Sign-in identity. Every auth path produces one: password
(`supabase.auth.signUp` / `signInWithPassword`), 6-digit email code
(`signInWithOtp` / `verifyOtp`), Google OAuth, and Sign in with Apple —
`expo/providers/AuthProvider.tsx:100-181`, which requests
`AppleAuthenticationScope.EMAIL`. Apple users who choose **Hide My Email** give
Gnome only a relay address; Gnome never sees the real one and does nothing to
defeat that.

Onboarding separately captures a *contact* email into
`user_private_contact.contact_email`
(`supabase/migrations/0086_onboarding_and_ai_drafts.sql:25-33`). That table has
one RLS policy, `auth.uid() = user_id`, and no world-read policy — it is
deliberately not `profiles`, which is where a world-readable footgun would have
been.

**Never shown to other users.** The public projection `public_profiles`
(`0087_profiles_public_projection.sql`, applied 2026-08-13 per
`supabase/migrations/APPLIED.tsv`) enumerates its columns and does not include
any email.

### 2.2 Contact Info → Name — **collected, linked, required**

Two forms, deliberately separated:

- **Public display name** — `profiles.name`, rendered "First L.". Exposed
  through `public_profiles`.
- **Legal first + last name** — `user_private_contact.first_name/last_name`,
  owner-only.

Sign in with Apple requests `FULL_NAME` scope
(`AuthProvider.tsx:180`); users may substitute a name of their choosing at the
Apple prompt.

### 2.3 Contact Info → Phone Number — **collected, linked, optional**

`user_private_contact.phone_e164`, written only through the
`save_onboarding_contact` SECURITY DEFINER RPC, which re-validates digit count
server-side. Onboarding is skippable and the phone field is explicitly optional
— the system prompt in `supabase/functions/gnome-onboarding/index.ts:75` tells
the assistant to say so: neighbours reach each other through in-app messaging,
so a number is never required. Also collected as `markets.contact_phone` when a
seller chooses to publish one on their Market page.

### 2.4 Contact Info → Physical Address — **collected, linked, optional**

Two distinct address stores, both real:

- **Buyer delivery addresses** — street line, city, state, ZIP and free-text
  delivery notes ("gate code, porch, dog"), entered at
  `expo/app/market/order/[marketId].tsx:355-368`, stored in
  `buyer_delivery_addresses` (`0065_delivery_status_and_buyer_addresses.sql:15-29`),
  RLS'd to the owning buyer.
- **Seller exact pickup address** — `expo/app/market/pickup-settings.tsx:477`,
  labelled in the UI "Exact pickup details · Only buyers with a confirmed
  pickup see this." A seller may *additionally* publish a coarser "Public
  address (shown to everyone)" (`pickup-settings.tsx:457`); that one is
  published by the seller's own choice.

The buyer's address is also **forward-geocoded off-device** — see §4.3 and
finding F5.

### 2.5 Location → Coarse Location — **collected, linked, optional**

City / county / state / ZIP on `profiles` and `markets`; the ~0.7-mile-grid
`approx_lat` / `approx_lng` generated columns on `listings`
(`0009_map_privacy.sql:18-32`) and `pickup_locations`
(`0052_pickup_locations.sql:20`), rounded to two decimal places.

The app functions without any location permission — the user simply loses
distance sorting.

### 2.6 Location → Precise Location — **collected, linked, optional. Declare it.**

This is the row most likely to be under-declared, so the reasoning is spelled
out. **Precise location USE and precise location STORAGE are different
questions, and the answer to both is yes.**

**Use.** `expo/lib/location.ts` takes device readings in three places —
`getCurrentCoords()` (line 130), `getCoordsIfGranted()` (line 99), and
`currentLocationFields()` (line 203) — all with
`Location.Accuracy.Balanced`. The prebuilt `Info.plist` contains **no**
`NSLocationDefaultAccuracyReduced` key (verified: `plutil -p
expo/ios/Gnome/Info.plist`), so iOS presents the full-accuracy prompt and the
app receives full-resolution coordinates unless the user downgrades to
"Approximate" at the prompt. Apple's threshold for Precise is three or more
decimal places of latitude (~111 m); `Accuracy.Balanced` is ~100 m and the
returned floats are unrounded. That is Precise.

**Storage.** Two paths store unrounded coordinates:

1. `buyer_delivery_addresses.lat/lng` — written at
   `expo/lib/delivery.ts:145-159` from the geocoder result, at whatever
   precision Nominatim returns. Private to the buyer at the RLS layer, but
   stored.
2. `listings.lat/lng` and `pickup_locations.lat/lng` — the exact values exist in
   the table. Client roles cannot read them: `0009_map_privacy.sql:28` revokes
   column SELECT and `0010_map_privacy_fix.sql` closes the table-level-grant
   hole that made the first attempt ineffective. The app reads only the `approx_`
   columns.

Two mitigations are genuine and worth telling Apple's reviewer about (§11.4):
`currentLocationFields()` returns City/State/ZIP strings and its header comment
records the design — the raw coordinates never leave the function. And
`fmtDistance()` deliberately caps displayed precision because approximate
coordinates do not support more.

**None of this makes the answer "No."** Declare Precise Location, purpose *App
Functionality*, linked, not used for tracking.

### 2.7 User Content → Photos or Videos — **collected, linked, optional**

Photos only; there is no video capture or upload anywhere in the app.

**Sources.** Eight call sites reach the photo library. Seven go through the
single hardened helper `pickImages()` (`expo/lib/images.ts:57`): the Post
composer, the Gnome AI tab, Grow Log, profile avatar, Market avatar, the Garden
Planner's "check my plant", and compliance document upload. The eighth,
`expo/app/ai-listing.tsx:70`, calls `ImagePicker.launchImageLibraryAsync`
directly. A ninth picker, `DocumentPicker.getDocumentAsync`
(`expo/app/compliance/upload.tsx:119`), reaches the Files app rather than the
photo library, for permit PDFs.

**Camera.** `expo/app/ai-listing.tsx:65,69` calls
`requestCameraPermissionsAsync()` and `launchCameraAsync()`. This contradicts
`APP_STORE_PACKAGE.md` §1.4, which states the camera is never invoked, and it is
a crash risk — see finding **F1**, classified BLOCKER. **The Photos answer does
not change either way** (library use alone makes it Yes), but whether Gnome
should describe itself as using the camera depends on how F1 is resolved.

**EXIF.** Metadata stripping is real and is applied on every path that leaves
the device:

- `pickImages()` passes `exif: false` and `base64: false` to the picker, then
  runs every asset through `normalizeImageAsset()`, which re-encodes via
  `ImageManipulator` to plain JPEG and explicitly nulls `fileName` and `exif`
  (`expo/lib/images.ts:28-49`). The header comment states why: iOS returns
  original HEIC bytes with full EXIF including GPS, and publishing that to the
  public bucket would defeat the entire `approx_lat/lng` design.
- `uploadListingImages()` re-normalizes defensively if handed a raw asset
  (`images.ts:91-94`).
- The one direct-picker path, `ai-listing.tsx:76-80`, re-encodes through
  `ImageManipulator` before sending, so it strips EXIF too.

I read this code; I did not run it against a GPS-tagged HEIC. The claim is
"correct by construction", not "observed".

**Where photos go.** Listing, avatar and Market photos are uploaded to the
Supabase Storage bucket `listing-images`, which is created **public**
(`0001_init.sql:260-262`) — those URLs are world-readable by design, which is
what a marketplace listing photo is. Grow Log photos (`grow-log`) and permit
scans (`compliance-docs`) are in **private** buckets
(`0049_grow_log.sql:148`, `0043_compliance_storage_and_gate.sql:9`) served via
short-lived signed URLs. Photos sent to AI are transmitted to Google in-memory
and, per `supabase/functions/analyze-listing-photo/index.ts`, are not written to
storage by that function.

### 2.8 User Content → Other User Content (+ Customer Support)

Listing titles/descriptions, Market page copy, private pickup chat
(`claim_messages`), Grow Log notes, Sales Notebook notes, request/decline
reasons, moderation report reasons (`reports.reason`,
`0013_trust_layer.sql:86-93`), Garden Planner and Gnome AI conversation text
(`ai_chat_messages`, `0086:109-115`), and in-app feedback
(`feedback`, `0017_feedback.sql:5-10` — declare as **Customer Support**).

### 2.9 Usage Data → Product Interaction — **collected, linked**

`logEvent()` (`expo/lib/db.ts:12-27`) inserts into the `events` table
(`0001_init.sql:110-121`) with `user_id`, `listing_id` and a `metadata` JSONB
blob. **Twenty-eight call sites** across the app emit 24 literal event names
(plus a few composed at runtime, e.g. `listing_created_${type}`) —
`listing_viewed`, `listing_card_opened`, `listing_claim_started`,
`claim_message_sent`, `market_viewed`, `market_order_requested`,
`payment_link_opened`, `ai_draft_used`, `garden_planner_used`,
`sale_recorded_mobile`, `promotion_created`, `plan_limit_hit`,
`seed_drop_coming_soon_viewed`, and others.

Rows are private: `events_select_self` restricts SELECT to `auth.uid() =
user_id` (`0001_init.sql:253-255`). Aggregation happens server-side with the
service role.

One event is anonymous — `payment_link_opened` (`expo/lib/marketops.ts:192`)
passes no `userId`, so `user_id` is null.

**One event carries free text.** `garden_planner_used`
(`expo/app/garden.tsx:124`) puts the user's typed question into
`metadata: { q }`. That is user content living in an analytics table. See
finding **F4**. It does not change the Usage Data answer, but it is why User
Content is *also* declared for this path.

There is **no analytics SDK** — see §3.

### 2.10 Identifiers → User ID and Device ID

- **User ID** — the Supabase `auth.users.id` UUID stamped on effectively every
  row. Required.
- **Device ID** — the Expo push token, upserted into `device_tokens`
  (`expo/lib/notifications.ts:42-47`). It is a push routing identifier, not a
  hardware or advertising identifier, and Apple's Device ID category is the
  right home for it. Optional: `registerForPushNotifications` returns early
  unless the user grants notification permission (line 29), and
  `unregisterPushToken()` deletes the row on sign-out.
- **Advertising Identifier — NOT collected.** Grepping `expo/ios/Podfile.lock`
  and the whole app source for `IDFA`, `advertisingIdentifier`, `AdSupport`,
  `ASIdentifierManager` and `AppTrackingTransparency` returns **zero** matches.

### 2.11 Financial Info → Other Financial Info — **collected, linked, optional**

Sales Notebook: `seller_transactions` (gross/discount/fee cents, quantity,
payment method, optional buyer label, notes, sold-at) and `seller_expenses`
(date, category, amount, vendor, notes) — `0032_seller_storefront.sql:7-11`,
written through the `record_sale` RPC (`expo/lib/db.ts:1440-1460`).

**Payment Info is NOT collected.** No card number, bank account or payment
credential is ever entered. Grepping `expo/{app,components,lib,providers}` for
`stripe`, `checkout`, `payment_intent`, `card_number` yields exactly two hits,
both inert: a TypeScript union member `'stripe'` in `expo/app/upgrade.tsx:23`,
and the word "checkout" inside an Alert string in
`expo/app/promote/[listingId].tsx:119`.

### 2.12 Purchases → Purchase History — **collected, linked, optional**

**`APP_STORE_PACKAGE.md` §5.1 answers "No" to Purchases. That is wrong.**

Apple defines Purchases as "an account's or individual's purchases or purchase
tendencies". Gnome records exactly that: `market_orders`
(`0048_market_ops.sql:144-161` — buyer id, market, requested/confirmed window,
`subtotal_cents`, buyer note) and `market_order_items`
(`:166-172` — per-item title, unit and quantity snapshots).

The confusion is understandable and the distinction matters, so state it
plainly in the declaration and in the reviewer notes: **Gnome records what was
ordered; Gnome never processes the payment.** Purchase History = Yes, Payment
Info = No. Those are consistent, not contradictory.

### 2.13 Other Data — **collected, linked, optional**

Seller credentials: credential type, issuing agency, permit/licence number,
issue and expiration dates, plus the uploaded document
(`expo/app/compliance/upload.tsx:69-75`; `seller_credentials`;
`compliance-docs` private bucket).

### 2.14 Sensitive Info — **NOT collected**

Apple's Sensitive Info means racial/ethnic origin, sexual orientation,
pregnancy, disability, religious or philosophical beliefs, trade union
membership, political opinion, genetic information or biometric data. Gnome
collects none of these. Seller permits are **business** licences (food handler,
cottage food, egg dealer), not personal identity documents, and the app never
asks for a driver's licence, passport, SSN or date of birth.

---

## 3. Tracking: **No** — with evidence

Apple defines tracking as linking user or device data collected in this app with
third-party data for targeted advertising or measurement, or sharing it with a
data broker.

| Check | Method | Result |
|---|---|---|
| Ad SDK | grep `admob`, `google-mobile-ads`, `facebook-sdk`, `react-native-fbsdk` across `expo/package.json` + all app source | **none** |
| Attribution SDK | grep `adjust`, `appsflyer`, `branch.io`, `revenuecat` | **none** |
| Analytics SDK | grep `amplitude`, `segment`, `mixpanel`, `firebase`, `posthog`, `datadog` | **none** |
| Crash reporter | grep `sentry`, `bugsnag`, `crashlytics`, `@sentry` | **none** |
| ATT | grep `expo-tracking-transparency`, `AppTrackingTransparency`; `plutil -p` on the prebuilt `Info.plist` for `NSUserTrackingUsageDescription` | **absent from both** |
| IDFA | grep `IDFA`, `advertisingIdentifier`, `AdSupport`, `ASIdentifierManager` in source + `Podfile.lock` | **none** |
| Third-party pods | full `Podfile.lock` pod list minus React Native / Expo first-party | only `SDWebImage` (+ AVIF/SVG/WebP codecs, via `expo-image`), `libwebp`, `libavif`, `ReachabilitySwift`, `RNCAsyncStorage`, `react-native-netinfo`, `EASClient`, `FBLazyVector`. All image decoding, connectivity or Expo infrastructure. **No advertising, attribution or analytics pod.** |
| Maps | `expo/components/MapListings.native.tsx:3` imports `react-native-maps` with no `PROVIDER_GOOGLE`; `grep -ci GoogleMaps expo/ios/Podfile.lock` → **0** | Apple MapKit only; map rendering sends nothing to Google |

The generated privacy manifest already agrees: `NSPrivacyTracking` is `<false/>`
in `expo/ios/Gnome/PrivacyInfo.xcprivacy`.

Two things to say out loud so nobody mistakes them for tracking:

- The `events` table *is* Gnome's own analytics, first-party and
  self-read-only. Apple's "Analytics" purpose is the right one; "Tracking" is
  not, because nothing is joined to third-party data or shared with a broker.
- `payment_link_opened` fires when a user taps through to Venmo / PayPal /
  Cash App. Gnome logs *that a method was used* (`metadata: { method }`), never
  an amount, handle or outcome, and Gnome receives no callback from those apps
  (`expo/lib/marketops.ts:186-196`).

**Answer "No" to tracking. No ATT prompt is required or should be added.**

---

## 4. Location, in detail

### 4.1 What is requested

`NSLocationWhenInUseUsageDescription` only. The `expo-location` plugin config in
`expo/app.json:48-55` sets `locationAlwaysAndWhenInUsePermission: false`,
`locationAlwaysPermission: false`, `isIosBackgroundLocationEnabled: false` and
`isAndroidBackgroundLocationEnabled: false`. The prebuilt `Info.plist` carries
no Always key and no `UIBackgroundModes`. There is no background location, no
geofencing, no significant-change monitoring, and no Always-authorisation review
burden.

### 4.2 When it prompts

Only on user action. `getCurrentCoords()` and `currentLocationFields()` call
`requestForegroundPermissionsAsync()`; passive surfaces use
`getCoordsIfGranted()`, which calls `getForegroundPermissionsAsync()` and
returns null rather than prompting (`expo/lib/location.ts:99-110`). The comment
above it names the rule: only Browse's explicit "Use current location" action
may prompt.

### 4.3 What leaves the device

| Path | Leaves device? | Destination |
|---|---|---|
| Device reading → distance sort / map centring | No | stays in memory |
| Device reading → `reverseGeocodeAsync` | No | on-device (Apple CoreLocation) |
| Device reading → City/State/ZIP saved to profile | Coarse only | Supabase |
| Listing/pickup coordinates entered by the user | Yes | Supabase (`lat/lng` stored, client-unreadable; `approx_*` public) |
| **Buyer's typed street address → forward geocode** | **Yes** | **`nominatim.openstreetmap.org`** (`expo/lib/delivery.ts:114-127`) |

That last row is the one that deserves attention: a US home address is sent
from the user's device, over the public internet, to a volunteer-run service
with no data-processing agreement, and it is disclosed nowhere. See finding
**F5**.

---

## 5. AI prompts and photos — what Google receives

**Provider is Google Gemini, and only Google Gemini.** `ai_settings` has
`allow_paid_fallback = false` and `reads_enabled = true` in production
(established by the coordinator), so the OpenAI and Anthropic branches in
`supabase/functions/_shared/providers.ts` are unreachable. **Anthropic and
OpenAI receive nothing.** Every AI edge function builds its chain the same way,
e.g. `draft-listing/index.ts:124-126`:

```
if (keys.gemini)                       chain.push({ provider: 'gemini', … })
if (allow_paid_fallback && keys.openai)    chain.push({ provider: 'openai', … })
if (allow_paid_fallback && keys.anthropic) chain.push({ provider: 'anthropic', … })
```

The only outbound model endpoint that can fire is
`https://generativelanguage.googleapis.com/…` (`_shared/providers.ts:110`).

| Feature | Sent to Google | Not sent |
|---|---|---|
| AI listing draft (`draft-listing`, `analyze-listing-photo`) | One re-encoded, EXIF-stripped JPEG + the chosen listing type | user id, name, email, coordinates |
| Garden Planner (`garden-planner`) | Location string (≤120 chars, e.g. "Cleveland Heights, OH"), last ≤12 chat turns (≤2000 chars each), optional plant photo | user id, name, email, exact coordinates |
| Gnome AI tab (`gnome-assistant`) | Conversation turns and attached photos | payment data |
| Conversational onboarding (`gnome-onboarding`) | The neighbour's own words, **with email addresses and phone numbers redacted** | the stored contact record; only *field names* still needed are sent |

**Onboarding, after this release.** The working-tree fix to
`supabase/functions/gnome-onboarding/index.ts` changes this materially, and this
document describes the post-fix behaviour. Previously the function passed the
stored `user_private_contact` record on every turn, putting a neighbour's real
email, phone and legal name in front of the provider from turn two onward and
again on every resume. After this release: contact values are parsed
**deterministically on the server** (`parseContact`, line 50), every turn in
both directions passes through `redactForProvider` (line 44), and the model is
told only which field names are still missing — the system prompt is suffixed
`"STILL NEEDED (field names only — you are never given the values)"` (line 161).

**One honest caveat.** `redactForProvider` redacts emails and phone numbers, not
names. If a neighbour types "I'm Dana Whitfield", that string still reaches
Google in the turn history. That is the minimum needed for the assistant to
acknowledge an answer, it is the user's own volunteered text in the current
conversation, and it is not read back out of storage — but the accurate
statement is "contact numbers and addresses are redacted", not "no personal
data reaches the provider". Say it that way in the policy.

**Retention.** `ai_usage_log` records metering only — feature, user id,
provider, model, image count, token counts, cost, duration, success
(`draft-listing/index.ts:178-185`). **No prompt or completion text is stored in
it.** Conversation text lives in `ai_chat_messages`, owner-only under
`ai_chat_messages_own`.

**Declare AI prompts under User Content**, purpose App Functionality, linked,
not used for tracking. Do not declare a separate "AI" type — Apple has none.

---

## 6. Diagnostics: **No**

There is no crash reporter, no performance monitor and no diagnostic uploader in
the binary. Verified by the grep in §3 and by the absence of any such pod in
`expo/ios/Podfile.lock`.

Two things that are *not* Diagnostics and should not be declared as such:

- `console.warn` / `console.error` calls (e.g.
  `expo/lib/notifications.ts:48`) write to the local device log only.
- `expo-updates` is enabled (`EXUpdatesEnabled: true`,
  `EXUpdatesURL: https://u.expo.dev/b84fe5e3-…` in
  `expo/ios/Gnome/Supporting/Expo.plist`) and contacts Expo's update server on
  every launch to check for a JS bundle. That request carries platform and
  runtime version, not user data or crash payloads. It does not meet Apple's
  Diagnostics definition. Expo is still listed as a processor in §7 because it
  receives a request from the user's device.

---

## 7. Processors — everyone who receives user data

The "In the policy?" column has two states, because the web lane rewrote
`web/app/privacy/page.tsx` during this audit and **that rewrite is not
deployed**. "Deployed" is what Apple's reviewer will read. See F2.

| Recipient | Receives | Evidence | Deployed policy | Rewritten policy (in tree) |
|---|---|---|---|---|
| **Supabase** (US) | Everything — auth, database, storage, edge functions | `expo/lib/supabase.ts`; project `fgybyghwcjlstqxkclch` | Yes | Yes |
| **Google (Gemini)** | Listing photos, plant photos, Garden Planner and AI-tab text, redacted onboarding turns | `_shared/providers.ts:110`; every AI function's chain | **No** | Yes |
| **Expo push service** (`exp.host`) | Push token; notification title and body, **including an 80-character preview of chat messages** and counterparties' first names | `supabase/functions/notify/index.ts:16,108,112,250` | **No** | Yes |
| **Expo updates** (`u.expo.dev`) | Launch-time update check: platform, runtime version | `expo/ios/Gnome/Supporting/Expo.plist` | **No** | Yes |
| **OpenStreetMap Nominatim** | **The buyer's full street address**, sent from the device | `expo/lib/delivery.ts:117` | **No** | Yes — F5's disclosure half is closed |
| **Apple** | Sign in with Apple identity; MapKit tiles; APNs delivery | `AuthProvider.tsx:178-181`; `react-native-maps` on MapKit | Implicit | Yes |
| **Google Identity** | OAuth identity at sign-in only | `AuthProvider.tsx:152` | **No** | Yes |
| ~~Anthropic~~ | **Nothing.** Unreachable while `allow_paid_fallback = false` | `_shared/providers.ts`; coordinator-verified config | **Named as the AI provider — wrong** | Removed (0 occurrences) |
| ~~Stripe~~ | **Nothing from the app.** No Stripe code path in the binary | §2.11 grep | n/a | n/a |

---

## 8. Data NOT collected — and how that was established

| Type | How verified |
|---|---|
| Advertising Identifier | grep across source + `Podfile.lock`: zero hits (§3) |
| Payment Info / Credit Info | No payment SDK, no card field, no Stripe call in the binary (§2.11) |
| Contacts (address book) | No `expo-contacts` dependency; no `NSContactsUsageDescription` in `Info.plist` |
| Health & Fitness | No HealthKit entitlement; no such dependency |
| Browsing History | The app has no browser. `WebBrowser.openBrowserAsync` is used twice — for the OAuth session (`AuthProvider.tsx:159`) and to open a signed URL for the user's *own* permit document (`expo/app/compliance/index.tsx:106`). Neither records history |
| Search History | There is no search feature. No search term is captured or logged |
| Sensitive Info | §2.14 |
| Diagnostics | §6 |
| Microphone / audio | `expo-image-picker` plugin sets `microphonePermission: false`; no `NSMicrophoneUsageDescription` in the prebuilt `Info.plist` |

---

## 9. Privacy manifest (`PrivacyInfo.xcprivacy`)

The prebuild-generated manifest declares the four required-reason API categories
(FileTimestamp `C617.1/0A2A.1/3B52.1`, UserDefaults `CA92.1`, SystemBootTime
`35F9.1`, DiskSpace `E174.1/85F4.1`), `NSPrivacyTracking` `<false/>` — and
**`NSPrivacyCollectedDataTypes` as an empty `<array/>`**.

That empty array is factually wrong against §2 and should be populated via
`expo.ios.privacyManifests` in `app.json` (coordinator owns that file). App
Store Connect's questionnaire is the authoritative disclosure and Apple's
automated check reads third-party SDK manifests, so this is not a rejection
today — but shipping a manifest that says "we collect nothing" alongside a
questionnaire declaring fifteen types is an inconsistency nobody should have to
explain later. Finding **F6**.

---

## 10. Retention and user control

| Control | Where | Effect |
|---|---|---|
| Edit / delete individual listings | Listing screen | Immediate |
| Delete a saved delivery address | Order flow → `useDeleteAddress` | Immediate |
| Revoke location | iOS Settings | App degrades to no-distance-sort |
| Revoke photo access | iOS Settings | Picker unavailable; nothing retroactive |
| Turn off notifications | iOS Settings; sign-out deletes the token row (`unregisterPushToken`) | Push stops |
| Block another user | Listing / Market / chat → also suppresses match pushes | Immediate |
| **Delete account** | **Profile tab → "Settings, feedback & blocked neighbors" → "Delete my account"** | Below |

**Account deletion — Guideline 5.1.1(v): present and correct.**
`expo/app/settings.tsx:59` invokes the `delete-account` edge function behind a
two-step destructive confirm. Identity comes from the caller's JWT
(`delete-account/index.ts:52`), never from the request body.

Explicitly purged (`delete-account/index.ts:78-119`): `device_tokens`,
`claim_messages`, `claims` (as claimer and on the user's own listings),
`listings`, `seller_credentials` + `credential_taxonomy_scope`, `markets`,
`user_blocks` (both directions), `events`, `profiles`, then
`auth.admin.deleteUser`. Storage folders for `grow-log` (per affected claim),
`compliance-docs/<uid>` and `listing-images/<uid>` are purged first, before the
rows cascade.

Removed by cascade rather than by name — I traced each foreign key:

| Table | Key | Result |
|---|---|---|
| `user_private_contact` | `user_id → auth.users on delete cascade` | Removed at `deleteUser` |
| `ai_chat_messages` | `user_id → auth.users on delete cascade` | Removed |
| `listing_drafts` | `owner_id → auth.users on delete cascade` | Removed |
| `market_orders` | `buyer_id → auth.users on delete cascade` | Removed |
| `buyer_delivery_addresses` | `buyer_id → profiles on delete cascade` | Removed when `profiles` is deleted |
| `reports` (filed by the user) | `reporter_id → profiles on delete cascade` | Removed |
| `feedback` | `user_id → profiles on delete **set null**` | Body survives, **de-linked** — acceptable, and arguably better |
| **`ai_usage`** | **no foreign key at all** (`0019_ai_usage_caps.sql:9-15`) | **Survives.** Finding **F7** |

Answer **"Yes"** to the account-deletion question, and put the exact path in the
review notes (§11.2) — reviewers check this by hand.

---

## 11. App Review metadata

### 11.1 URLs — all verified HTTP 200 on 2026-08-13

| Field | Value |
|---|---|
| Privacy Policy URL | `https://gnomefarmersmarket.com/privacy` |
| Terms of Use (attach as **Custom EULA**) | `https://gnomefarmersmarket.com/terms` |
| Support URL | `https://gnomefarmersmarket.com` |
| Marketing URL | `https://gnomefarmersmarket.com` |
| Trust & safety (referenced in-app) | `https://gnomefarmersmarket.com/trust` |
| Contact | `hello@gnomefarmersmarket.com` |

There is no dedicated `/support` route. Using the homepage is acceptable —
Apple requires a page a user can get help from, and the homepage carries the
contact address. Consider a real `/support` page before public release
(BACKLOG).

**The privacy policy at that URL is currently inaccurate** — see F2. It must be
corrected before the App Privacy answers above are submitted, because the two
have to agree.

### 11.2 Account-deletion instructions for the reviewer

```
ACCOUNT DELETION (Guideline 5.1.1(v))

From the bottom tab bar, open the Profile tab (rightmost). Tap
"Settings, feedback & blocked neighbors". Scroll to the bottom of that screen
and tap "Delete my account".

Two confirmations follow ("Delete your account?" then "This is permanent"),
and the final button is "Delete forever". Deletion runs server-side and is not
reversible: the account, Market page, listings, uploaded photos, permit
documents, pickup chats and push registrations are all removed, and the auth
identity is deleted last.

Please use a throwaway account if you want to exercise this — the reviewer
account we supplied has demo content set up for you.
```

### 11.3 Reviewer explanation — AI features

```
AI FEATURES

Gnome uses one AI provider: Google (Gemini). Three surfaces use it, and all
three are assistive only — the AI never publishes, sends, buys or changes
anything on a user's behalf.

1. PHOTO TO LISTING. The user picks a photo of what they grew or made. We
   re-encode it on the device (which strips all camera metadata, including GPS)
   and send only that image plus the chosen listing type. Gemini returns a
   suggested title, category, description, unit and price. It comes back as an
   editable DRAFT. The user reviews it, changes anything they want, and taps
   publish. Nothing is ever posted automatically; drafts that fall into
   commonly regulated categories (eggs, dairy, meat, canned goods) are
   deliberately excluded from "publish all" so a person always looks at them.

2. GARDEN PLANNER. A gardening Q&A. We send the town/state the user typed and
   the recent conversation turns, optionally with a photo of a plant. It answers
   with planting advice for that location and season. It is instructed to give
   no medical, food-safety or pesticide-safety advice beyond "follow the label
   or consult your local extension office".

3. WELCOME CHAT. A short conversational intake that asks a new neighbor for a
   first name, last name and contact email (phone is optional and can be
   skipped). The assistant's job is conversation only: email addresses and
   phone numbers are redacted before any text is sent to the provider, the
   values are parsed on our own server, and every field is re-validated
   server-side before it is saved. The whole flow is skippable — a plain form
   does the same job.

No user identifier, name, email address or exact location is sent to the AI
provider. AI usage is metered (feature, token counts, cost) for our own
budgeting; prompt and response text are not stored in that metering table.

All three degrade gracefully: if AI is unavailable the app tells the user and
they fill the form by hand, exactly as they would otherwise.
```

### 11.4 Reviewer explanation — user-generated content and moderation

```
USER-GENERATED CONTENT AND MODERATION (Guideline 1.2)

Gnome is a marketplace for surplus home-grown produce and homemade goods.
Neighbors post what they have and sell it, give it away, trade it, or ask for
something they want. All content — listings, photos, Market pages, display
names, avatars and private messages — is created by users.

TERMS. Every user agrees to our Terms on the sign-in screen before creating an
account. The same Terms are attached as a Custom EULA.

REPORTING. Every listing, every Market page and every conversation carries a
Report control. Reports land in a moderation queue staffed by us.

BLOCKING. Any user can be blocked from a listing or Market screen. Blocking is
symmetric, it hides that person's content, and it also suppresses the
notification matcher so a blocked user's new posts cannot reach the blocker.
Blocked neighbors are listed and can be unblocked in Settings.

REMOVAL COMMITMENT. We act on reports of objectionable content within 24 hours:
the content is removed and the poster is ejected from the service.

POST-TIME GATE. Our marketplace taxonomy classifies every item as unrestricted,
conditional, regulated or prohibited. Posting in a prohibited category is
blocked at the database level, not just in the UI. Sellers in regulated
categories can upload the relevant permit or license; those are business
licenses (cottage food, egg dealer, food handler), never personal identity
documents.

SAMPLE CONTENT. Any seeded demo listing is labeled "Preview" so it can never be
mistaken for a real offer from a real neighbor.

LOCATION SAFETY. A user's exact address is never public. Listings and pickup
spots appear at a coordinate rounded to roughly a 0.7-mile grid, and exact
coordinates are unreadable by client roles at the database permission level, not
merely hidden in the app. Photo metadata, including GPS, is stripped on the
device before any upload. An exact pickup address is released only to a
counterparty whose pickup has been confirmed.

WHAT WE DO NOT HAVE. There is no automated profanity or image classifier. Our
moderation is reactive — report, block, admin review, plus the post-time
category gate above. We are stating that plainly rather than implying coverage
we do not have.
```

### 11.5 Subscription disclosure — FREE launch, no in-app purchases

**Verified absent.** `expo/package.json` contains no `expo-in-app-purchases`,
no `react-native-iap`, no `react-native-purchases`/RevenueCat, and no StoreKit
usage anywhere in `expo/{app,components,lib,providers}`. `expo/ios/Podfile.lock`
contains no purchase pod. There is no Stripe call path in the binary (§2.11).

App Store Connect answers:

- In-App Purchases: **No**
- Subscriptions: **none configured**. Do not create a subscription group.
- "Restore Purchases" control: **not required** (nothing is purchasable). It
  becomes mandatory the day IAP is added.
- Content Rights: **Yes**, the app contains third-party content — it hosts
  user-generated content and Gnome has the rights/permissions to display it.

Disclosure text for the review notes:

```
NOTHING IS PURCHASABLE IN THIS BUILD

This version of Gnome sells nothing. There is no in-app purchase, no
subscription, and no payment processing of any kind inside the app. Gnome is
free to download and free to use, and it takes no commission on anything
neighbors trade.

Where the app describes seller plan tiers, those are descriptions only — there
is no purchase path behind them.

When a buyer and a seller settle up, they do it directly with each other. If the
seller has published a Venmo, PayPal or Cash App handle, the app can open that
app for them; the payment happens entirely there. Gnome never sees the payment,
never records that it happened, and opening the link marks nothing as paid. A
disclaimer to that effect is shown every time: "Payment is handled outside
Gnome. The seller confirms payment separately."

Seed Drop, which appears in the browse feed, is announced but not sold. Tapping
it opens an in-app notice with no price, no date and no way to buy, reserve or
join a waitlist.
```

> **Cross-lane note, not this document's fix.** `APP_STORE_PACKAGE.md` risk R1
> flags that the Upgrade and Boost surfaces still print real dollar amounts next
> to buttons that resolve to a "coming soon" alert (`expo/app/upgrade.tsx`,
> `expo/app/promote/[listingId].tsx:119`, `expo/components/UpgradePromptCard.tsx`).
> That is a Guideline 2.1 completeness risk owned by the app lane. It does not
> change any answer in this document — with no IAP and no external purchase
> link, neither 3.1.1 nor its anti-steering clause is triggered.

---

## 12. What I could **not** verify

Stated plainly, because "I read the code" is not the same as "I ran it":

1. **I did not build or run the app.** Every behavioural claim here — EXIF
   stripping, the camera crash in F1, permission prompt copy, the deletion flow
   end to end — is from source and from prebuild output, not from execution.
2. **`expo/ios/` is local prebuild output and is gitignored.** EAS Build runs
   its own prebuild in the cloud from `expo/app.json`. The `Info.plist` and
   `PrivacyInfo.xcprivacy` I inspected are strong evidence of what that prebuild
   generates from this exact config, but they are not the shipped artifact.
   Re-check the built `.ipa` for F1 and F6.
3. **Production `ai_settings` and `billing_config` values** were taken as
   given from the coordinator (`allow_paid_fallback=false`,
   `reads_enabled=true`, `payments_live_enabled=false`). I did not query the
   database.
4. **`ai_usage_log`'s CREATE statement is not in `supabase/migrations/`** — only
   `ALTER`s in 0078 and 0080. I could confirm from the edge functions what is
   *written* to it (metering only, no prompt text) but not its full column list
   or whether it has a cascading FK to `auth.users`. F7 covers the table I
   could fully read (`ai_usage`); `ai_usage_log`'s deletion behaviour is
   **unverified**.
5. **The markets anon-readability fix is written but NOT APPLIED.** It landed
   mid-audit as `supabase/migrations/0093_market_privacy.sql`: it revokes the
   table-wide SELECT grant on `markets` and re-grants every column except
   `lat`, `lng`, `zip`, `contact_email`, `contact_phone` and
   `pickup_instructions`, handing owners their own row back through a
   `my_market()` definer RPC. I read the migration; I did not run it, and 0093
   appears in neither `APPLIED.tsv` nor `UNAPPLIED.txt`. §2.3, §2.4 and §11.4
   are written as if it is applied, per the coordinator's instruction.
   **Confirm it is applied before submitting** — until it is, a seller who fills
   in a contact phone or an exact Market address publishes it to anonymous
   visitors, and §11.4's claim to the reviewer that exact addresses are never
   public would be false.
6. **Whether Nominatim retains or logs the addresses it receives.** Out of
   scope here; it is a diligence question for whoever owns F5.

---

## 13. Findings

### F1 — `/ai-listing` invokes the camera with no `NSCameraUsageDescription`. **BLOCKER**

The chain, each link verified:

1. `expo/app/(tabs)/post.tsx:414-427` renders a banner — "Take a photo — Gnome
   drafts it" — for **every non-Wanted listing type, with no plan gate**, whose
   `onPress` is `router.push('/ai-listing')`.
2. `expo/app/ai-listing.tsx:153` renders a primary button "📷 Take photo" →
   `capture(true)`.
3. `capture(true)` calls `ImagePicker.requestCameraPermissionsAsync()` (line 65)
   and `ImagePicker.launchCameraAsync()` (line 69).
4. `expo/app.json:57-64` configures the `expo-image-picker` plugin with
   `"cameraPermission": false`, which **strips `NSCameraUsageDescription`** from
   the generated `Info.plist` — overriding the `NSCameraUsageDescription` string
   that `app.json:24` also declares under `ios.infoPlist`.
5. Confirmed empirically: `plutil -p expo/ios/Gnome/Info.plist` lists
   `NSLocationWhenInUseUsageDescription` and `NSPhotoLibraryUsageDescription`
   and **no camera key**.

iOS terminates a process that requests camera authorisation when the usage
description is absent. The plan gate does not save this: the locked state
renders only when `ent.data && !eligible`, and `ent.data` is `undefined` while
the entitlements query is in flight — so the camera button is on screen for
*every* user during that window, and permanently for any Grower / Farm /
complimentary account.

**I did not run the app and did not observe the termination.** The evidence is
static: a reachable code path calling a privacy-gated API whose required
Info.plist key is verifiably absent from this config's prebuild output.

Two fixes, both outside my owned files:

- **(a)** Add a real `"cameraPermission": "Gnome needs camera access so you can
  photograph what you grew or made."` to the `expo-image-picker` plugin block in
  `expo/app.json` (coordinator owns that file). Keeps the feature; then this
  document's §2.7 must say the camera is used.
- **(b)** Remove the camera branch from `expo/app/ai-listing.tsx` (library
  only), matching the eight other photo call sites. Simpler, and keeps the
  store answer to "photo library only".

Whichever is chosen, §2.7 and `APP_STORE_PACKAGE.md` §1.4 both need to match it.
Also worth noting for the app lane: `ai-listing.tsx:70` is the one photo path
that bypasses the hardened `pickImages()` helper. It happens to re-encode
correctly at lines 76-80, so there is no EXIF leak today — but it is the only
place where that guarantee rests on a second implementation rather than the
shared one.

### F2 — The **deployed** Privacy Policy names the wrong AI provider. Rewritten in the tree, not yet shipped. **FIX BEFORE APP REVIEW**

**Status changed during this audit.** Both states are recorded because the gap
between them is the actual risk.

**What is live right now.** I fetched `https://gnomefarmersmarket.com/privacy`
twice while writing this, most recently after the rewrite landed in the tree.
Both times it returned "…processed by our AI provider (**Anthropic**)".
Anthropic receives nothing (§5); Google does. The deployed page also never
mentions the Expo push service, Expo's update endpoint, Google Identity, or
OpenStreetMap.

**What is in the working tree.** The web lane has since rewritten
`web/app/privacy/page.tsx` end to end (`UPDATED` moved to August 13, 2026).
Verified against the new file: **zero** occurrences of "Anthropic"; Google and
Gemini named as the AI provider (lines 154-156, 213-214); Supabase, Apple, Expo
and **OpenStreetMap (Nominatim)** all named in a processor list (lines 208-237).
That resolves both F2 and the disclosure half of F5 — on paper.

**What is left.** The rewrite is **not deployed**. Apple's reviewer opens the URL
in the App Store listing, not the repo. Until the site is redeployed, the
privacy policy Apple reads contradicts the App Privacy answers in §2, which is
exactly the inconsistency that draws a Guideline 5.1.1 rejection.

**Action: deploy the web change before submitting**, then re-fetch the URL and
confirm the string "Anthropic" is gone. Nothing in this repo can prove that
happened; it has to be checked against the live page.

### F3 — `APP_STORE_PACKAGE.md` §5.1 answers "No" to Purchases. **FIX BEFORE APP REVIEW**

It should be **Yes → Purchase History** (§2.12). `market_orders` and
`market_order_items` record what a buyer ordered, from which Market, when, and
for how much. Answering "No" because no money moves through the app confuses
Purchase History with Payment Info; Payment Info is correctly "No". Submitting
the understated answer is a misdeclaration Apple can act on later. **Use §2 of
this document, not §5 of that one.**

### F4 — The Garden Planner writes the user's typed question into the analytics table. **FIX WITHIN 72 HOURS**

`expo/app/garden.tsx:124`:
`logEvent('garden_planner_used', { userId, metadata: { q } })` — `q` is the
user's free-text question, stored verbatim in `events.metadata`.

Rows are private (`events_select_self`), so this is not an exposure. It is a
classification problem: an analytics table now holds user content, which widens
what "usage data" means for retention, for export, and for anyone who later
reasons about the `events` table as if it were counters. The event's analytic
value is that the planner was used, not what was asked.

Fix: drop `q`, or replace it with `{ chars: q.length }`. If it is kept
deliberately, §2.9's dual declaration must stay.

### F5 — Buyer street addresses are sent from the device to OpenStreetMap Nominatim. **FIX BEFORE PUBLIC RELEASE**

`expo/lib/delivery.ts:114-127` sends the buyer's full assembled street address
as a query parameter to `https://nominatim.openstreetmap.org/search?…` directly
from the device, on every address save. Nominatim is a volunteer-run service
with no data-processing agreement, and the request is not proxied.

Two acceptable resolutions: move the geocode server-side into an edge function
so the disclosure becomes "our backend" and the user's IP is not exposed to a
third party alongside their home address; or name OpenStreetMap explicitly in
the privacy policy. The first is better.

**Half-closed during this audit.** The rewritten `web/app/privacy/page.tsx:237`
now names "OpenStreetMap (Nominatim)" and says what it is used for, which
satisfies the disclosure obligation — **once deployed** (F2). The *technical*
half stands: the call still originates on the user's device, so Nominatim sees
the user's IP address next to their home address. Disclosure makes that lawful;
it does not make it good. Proxying it server-side remains the right fix and is
tracked here rather than closed.

### F6 — `NSPrivacyCollectedDataTypes` is an empty array. **FIX BEFORE PUBLIC RELEASE**

§9. Populate via `expo.ios.privacyManifests` in `app.json` so the shipped
manifest agrees with the fifteen declared types. Not a rejection today; an
inconsistency that gets more expensive to explain the longer it ships.

### F7 — `ai_usage` rows survive account deletion. **BACKLOG**

`0019_ai_usage_caps.sql:9-15` declares `user_id uuid not null` with **no foreign
key**, and `delete-account` never touches the table. After a user deletes their
account, rows of `(user_id, day, feature, count)` remain, keyed to a UUID that
no longer resolves to a person.

Low severity — counters only, no content, and the table is service-role-only
with RLS enabled and no policies. But "delete my account" should mean it. One
line in `delete-account/index.ts`, or an `on delete cascade` FK in a future
migration. `ai_usage_log`'s behaviour here is **unverified** (§12.4) and should
be checked at the same time.

### F8 — No dedicated support page. **BACKLOG**

The Support URL is the homepage. Acceptable for submission; a real `/support`
route with the contact address, a short FAQ and the deletion instructions would
serve users better and pre-empts a reviewer question.

### F9 — Web has no account-deletion path. **BACKLOG**

Deletion exists on mobile only (`expo/app/settings.tsx` → `delete-account`).
Guideline 5.1.1(v) governs the app and is satisfied. The privacy policy's
wording — "delete your account from the app's Settings (or by emailing us)" —
is accurate as written. Worth closing for parity, and it becomes load-bearing
if a US state privacy law applies later.

---

## 14. Submission checklist for this lane

1. Resolve **F1** (app lane / coordinator — `app.json` or `ai-listing.tsx`), then
   reconcile §2.7 and `APP_STORE_PACKAGE.md` §1.4 with whichever way it went.
2. **Deploy the rewritten privacy policy** and re-fetch
   `https://gnomefarmersmarket.com/privacy` to confirm "Anthropic" is gone
   (**F2**). The rewrite is already in the tree; only the deploy is outstanding.
3. **Apply `0093_market_privacy.sql`** and ledger it, or accept that §11.4's
   statement to the reviewer is not yet true (§12.5).
4. Enter App Privacy from **§2**. Tracking: **No**. Do not skip Precise
   Location (§2.6), Financial Info (§2.11) or Purchase History (§2.12) — all
   three are real and all three are easy to under-declare.
5. Answer **No** to in-app purchases; configure no subscription products (§11.5).
6. Answer **Yes** to account deletion; paste **§11.2** into the review notes.
7. Paste **§11.3**, **§11.4** and the **§11.5** disclosure block into App Review
   Information.
8. Attach `https://gnomefarmersmarket.com/terms` as the **Custom EULA**.
9. Populate `expo.ios.privacyManifests` (**F6**) — before public release, not
   necessarily before this submission.
