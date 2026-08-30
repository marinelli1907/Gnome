# Google Play submission package — Gnome 1.1.0

Audited 2026-08-13 against `54e141e`. Every factual claim cites the file or
command it came from. Where something cannot be checked from this machine, it
says so instead of guessing.

**Companion doc:** `docs/release/APP_STORE_PACKAGE.md` (iOS side). Sections that
are identical across stores — listing copy rationale, the data-collection
inventory, the in-app-purchase analysis — are summarized here and reasoned
through in full there.

> **Android build history is no longer empty, but the final launch artifact is
> still unproven.** Older Android artifacts exist (remote Android `versionCode`
> 4), and emulator testing has proven Maps/Firebase plumbing reached a build.
> No final reviewed Play-bound AAB has been cut from this working tree, uploaded
> to Play, installed through Play App Signing, or verified on a physical Android
> device. Everything below keeps that distinction explicit.

---

## 0. The structural fact that shapes this document

`expo/android/` is **gitignored and untracked** (`expo/.gitignore` → `# Native`;
`git ls-files expo/android` returns 0 files). It is local `expo prebuild` output.

**`expo/app.json` is the source of truth for anything EAS builds.** EAS receives
no native directory and runs prebuild in the cloud. The prebuilt
`android/app/build.gradle` and `AndroidManifest.xml` quoted below are evidence of
*what prebuild generates from the current app.json* — which is exactly what makes
them useful, and exactly why fixing anything means editing `app.json`, never the
generated files.

---

## 1. Configuration audit

### 1.1 Identity and versioning

| Item | Actual value | Source | Verdict |
|---|---|---|---|
| Application ID | `app.boonesystems.gnome` | `expo/app.json` → `android.package`; prebuilt `build.gradle` → `applicationId`, `namespace` | OK |
| App label | `Gnome` | `expo/app.json` → `name` → `@string/app_name` | OK |
| versionName | `1.1.0` | `expo/app.json` → `version` | OK |
| versionCode | **Remote Android `versionCode` 4** | `eas build:version:get --platform android` | OK — next build should auto-increment |
| `appVersionSource` | `remote` | `expo/eas.json` → `cli.appVersionSource` | OK |
| Remote version state | Android remote version configured | `eas build:version:get --platform android` | OK |
| minSdkVersion | **24** (Expo SDK 54 default) | `node_modules/expo-modules-core/android/ExpoModulesCorePlugin.gradle:68` → `safeExtGet("minSdkVersion", 24)` | OK |
| targetSdkVersion | **36** (Expo SDK 54 default) | `node_modules/expo-modules-core/android/ExpoModulesCorePlugin.gradle:69` → `safeExtGet("targetSdkVersion", 36)` | OK — comfortably above Play's current target-API floor for new apps |
| Architectures | `armeabi-v7a, arm64-v8a, x86, x86_64` | prebuilt `gradle.properties` → `reactNativeArchitectures` | OK |
| JS engine | Hermes | `gradle.properties` → `hermesEnabled=true` | OK |
| New architecture | Enabled | `app.json` → `newArchEnabled: true` | OK |
| Edge-to-edge | Enabled | `gradle.properties` → `edgeToEdgeEnabled=true` | OK for Android 15 |

**versionCode note.** With `appVersionSource: remote`, EAS owns the Android
versionCode and `autoIncrement: true` carries it forward. Do **not** hand-set
`android.versionCode` in `app.json` — with remote versioning that is ignored and
only creates confusion.

### 1.2 Signing

The prebuilt `android/app/build.gradle` contains the stock Expo/RN template
block:

```gradle
release {
    // Caution! In production, you need to generate your own keystore file.
    signingConfig signingConfigs.debug
}
```

**This is not the thing it looks like.** That file is generated, gitignored
output; EAS Build supplies and injects the release keystore from its own
credential store at build time. It matters only if somebody runs
`./gradlew assembleRelease` locally — which would produce a debug-signed
artifact that Play rejects outright.

**What genuinely cannot be verified here:** whether an EAS Android keystore
exists for this project. `eas credentials` is interactive and nothing about
Android signing is in the repo (`*.jks`, `*.keystore` are gitignored). See §8.

Plan to use **Play App Signing** (required for new apps): EAS generates the
upload keystore, Play holds the app signing key.

### 1.3 Permissions — the prebuilt merged app-module manifest

From `android/app/src/main/AndroidManifest.xml`:

| Permission | Where it comes from | Keep? |
|---|---|---|
| `ACCESS_COARSE_LOCATION` | `app.json` → `android.permissions` | **Keep** — used |
| `ACCESS_FINE_LOCATION` | `app.json` → `android.permissions` | **Keep** — `Location.getCurrentPositionAsync({ accuracy: Balanced })` in `expo/lib/location.ts` |
| `INTERNET` | Expo default | Keep |
| `VIBRATE` | expo-notifications | Keep |
| `CAMERA` | **removed** via `tools:node="remove"` (the `expo-image-picker` plugin's `cameraPermission: false`) | Correct — the camera is never invoked; photo flows use the shared library picker path |
| `RECORD_AUDIO` | **removed** via `tools:node="remove"` | Correct |
| `SYSTEM_ALERT_WINDOW` | React Native dev-support default, landed in the **main** manifest, not `debug/` | **Blocked in `app.json`** — verify absent in the final AAB |
| `READ_EXTERNAL_STORAGE` | expo-image-picker legacy | **Blocked in `app.json`** — verify absent in the final AAB and test photo picking |
| `WRITE_EXTERNAL_STORAGE` | expo-image-picker legacy | **Blocked in `app.json`** — verify absent in the final AAB and test photo picking |
| `POST_NOTIFICATIONS` | **not in the app module**, merges in from the library manifest (`node_modules/expo-notifications/android/src/main/AndroidManifest.xml` declares it) | Expected present in the merged AAB manifest — **verify in the final build output** |
| `RECEIVE_BOOT_COMPLETED` | same library manifest | Expected present |

No background-location permission is requested anywhere
(`isAndroidBackgroundLocationEnabled: false` in `app.json`), which avoids Play's
background-location review process entirely. Good.

### 1.4 Deep links

| Item | Actual |
|---|---|
| Custom scheme | `gnome://` — intent filter on `MainActivity` with `BROWSABLE` + `DEFAULT` |
| **Android App Links (verified https)** | **None.** No `autoVerify="true"` intent filter, no `assetlinks.json` referenced anywhere |
| Auth callback | `gnome://auth-callback`, handled in `expo/providers/AuthProvider.tsx:77-96` |
| Notification taps | `expo/lib/useNotificationRouting.ts` |

Same consequence as on iOS: password-reset emails carry a custom-scheme link, so
tell reviewers to use the email-code sign-in path instead (§7.2).

### 1.5 Push notifications — **configured / delivery unproven**

`expo-notifications` ships an Android `ExpoFirebaseMessagingService` bound to
`com.google.firebase.MESSAGING_EVENT` (read directly from
`node_modules/expo-notifications/android/src/main/AndroidManifest.xml`). Expo's
push service delivers to Android **through FCM**.

The original audit found no Firebase app config in the repo and no confirmable
FCM credential on the EAS side. That finding is now historical; see **B2** for
the current physical-device proof gate.

> **CONFIGURED 2026-08-18, DELIVERY UNPROVEN.** Firebase was added to the
> existing `Gnome Farmers Market` Cloud project, the Android app registered as
> `app.boonesystems.gnome`, `google-services.json` committed with
> `android.googleServicesFile` (commit `0705f34`), and the FCM V1 service-account
> key uploaded to the Expo project (key id `1ff17b318c…`, service account
> `firebase-adminsdk-fbsvc@gnome-farmers-market-70414`). Build vc4 confirms the
> plumbing arrived: `dumpsys` shows
> `expo.modules.notifications.service.ExpoFirebaseMessagingService` bound to
> `com.google.firebase.MESSAGING_EVENT`, which no previous Android build had.
>
> **What is still NOT proven: an actual delivered notification.** It cannot be
> proven on an emulator, by the app's own design —
> `lib/notifications.ts:22` guards registration with `!Device.isDevice`, which
> `expo-device` reports false for emulators, so `registerForPushNotifications`
> returns before requesting permission or fetching a token. Verified
> empirically on vc4: no POST_NOTIFICATIONS prompt appeared, the permission
> stayed `granted=false`, and no `device_tokens` row was written. That guard is
> correct for shipping (real users are always on real devices) — it is a
> TESTING limitation, not a defect.
>
> **Closing it requires one run on a physical Android device:** install the
> preview APK, sign in, accept the notification prompt, confirm a
> `device_tokens` row with `platform='android'`, then send a test push from
> https://expo.dev/notifications to that token and confirm it displays and
> routes on tap. Until that happens, treat Android push as a **release risk**:
> the configuration is right, the last mile is unverified.

### 1.6 Maps — **configured for Android / rebuild verify**

`react-native-maps@1.20.1` is a dependency and `expo/components/MapListings.native.tsx`
renders `<MapView>` with markers for the Map tab.

The original audit found no Android Maps key. That is no longer the intended
release config: `expo/app.config.js` injects `android.config.googleMaps.apiKey`
from `EXPO_ANDROID_GOOGLE_MAPS_API_KEY`, keeping key material out of source. A
compact config probe on 2026-08-20 also confirmed `android.googleServicesFile`,
`android.blockedPermissions`, and the 15 configured iOS privacy-manifest data
types without printing any key material.

Remaining proof: inspect the final AAB/APK merged manifest and re-run the Map
regression on the build that will be uploaded, then re-verify after Play App
Signing adds the production SHA-1. See **B1**.

### 1.7 Icons and branding assets

| Asset | Actual | Verdict |
|---|---|---|
| Adaptive icon foreground | `assets/images/adaptive-icon.png` — 1024×1024 RGBA | OK |
| Adaptive icon background | `#FFFFFF` | OK |
| Legacy icon fallback | falls back to `icon.png` (1024×1024 RGBA) | OK |
| Monochrome (themed) icon | **absent** | Optional; Android 13+ themed icons will fall back |
| Notification icon / color | **not configured** — the `expo-notifications` plugin is listed with no options | Android renders a white silhouette of the app icon. Cosmetic; a `notification.icon` would be better |
| Play Store icon (512×512) | `docs/release/play-icon-512.png` — 512×512 RGBA, 57 KB | OK |
| Feature graphic (1024×500) | `docs/release/play-feature-graphic.png` — 1024×500 RGB/no alpha, 49 KB | OK |

---

## 2. BLOCKERS and findings, ranked

### B1 — The Map tab will not render on Android. **RESOLVED 2026-08-18**

> **Key configured and behaviourally verified.** The owner created a restricted
> Android key in the `Gnome Farmers Market` Google Cloud project (Maps SDK for
> Android enabled, restricted to package `app.boonesystems.gnome` + the EAS
> upload key's SHA-1), wired into release config through
> `EXPO_ANDROID_GOOGLE_MAPS_API_KEY` (commit `be8bb2e`). Verified on an
> Android 16 emulator with build vc3: Google tiles render with attribution,
> four market pins plot correctly, pan/zoom works, and the app survives a full
> Browse→Map→My Gnome cycle on one PID with zero `API key not found` or
> ReactInstance-teardown log lines.
>
> **The original finding UNDERSTATED this.** Measured against a real build, a
> missing key does not render a blank map — it throws `RuntimeException` inside
> `FabricUIManager`, which destroys the entire ReactInstance. The whole app goes
> white permanently, including tabs never visited, until force-stop.
>
> ⚠️ **One step remains at first upload:** Play App Signing re-signs the app
> with a different key, so Store installs present a SHA-1 this restriction does
> not list and Maps will fail **in production only**. After the first AAB
> upload: Play Console → Setup → App signing → copy the app signing SHA-1 → add
> it to the same credential alongside the upload SHA-1.

Historical finding, for the record: the original audit correctly identified the
missing Android Maps key as a Play blocker. That is now fixed in configuration
and verified on an emulator build. The remaining risk is narrower: a Play-signed
install can use a different SHA-1 than the EAS upload build, so Maps must be
regressed after Play App Signing is available.

### B2 — Android push notifications. **CONFIGURED / DELIVERY UNPROVEN**

Expo push → Android goes through FCM (§1.5). The original audit found no
Firebase app config and no confirmable FCM credential. That is now fixed in
configuration and observed in an Android build: `google-services.json` is wired
through `android.googleServicesFile`, and the Firebase messaging service is
present in the built app.

Remaining proof is physical-device delivery, not repo configuration:
1. Install the final Android build on a real device.
2. Sign in and accept the notification permission prompt.
3. Confirm a `device_tokens` row is created.
4. Send an actual push.
5. Tap it and verify routing.

Do not weaken `Device.isDevice` in `expo/lib/notifications.ts` to make emulator
registration appear to work.

### B3 — Account deletion **web URL** — **RESOLVED 2026-08-16**

> **Fill the Data safety field with:**
> ```
> https://gnomefarmersmarket.com/delete-account
> ```
> Built as option (b), at `web/app/delete-account/` (`page.tsx` +
> `DeleteAccountClient.tsx`). Note the path is `/delete-account`, **not** the
> `/account-deletion` this document originally proposed — it matches the
> `delete-account` edge function it calls. The page is indexable on purpose
> (unlike `/login`) because the reviewer opens it cold, signed out.
>
> Signed out it explains everything and offers the email-code sign-in card;
> signing in IS the identity check, since the edge function takes the user id
> from the JWT. Signed in it requires a ticked acknowledgement **and** the typed
> word `DELETE`, mirroring mobile's two-alert confirm. Retention copy was written
> against the live schema, not assumed: every user-linked table either is purged
> explicitly or cascades (`seller_transactions` → `markets`, `market_orders` →
> `auth.users`, `buyer_delivery_addresses`/`user_private_contact` → `profiles`),
> so the page states plainly that nothing identifying survives in Gnome and that
> Stripe keeps its own records.
>
> **DEPLOYED and verified 2026-08-17** — the URL answers 200 with the real page
> (a bogus route 404s, so it is not a soft-200 fallback), renders correctly at
> desktop and 375px-wide mobile with no horizontal overflow, and the client
> bundle hydrates: signed out, the page shows the email-code sign-in card. The
> backend was re-verified the same day and one defect fixed before relying on
> it: `seed_orders.user_id → profiles` is `NO ACTION`, so a user holding a seed
> order had their `profiles` delete raise and the whole deletion answer 500 —
> one live account was affected. `delete-account` v9 purges `seed_orders`
> first (which also removes `profile_snapshot`, a copy of the buyer's seed
> profile the page's retention promise did not allow to survive).
>
> **Email fallback fixed 2026-08-17.** The pages originally advertised
> `hello@gnomefarmersmarket.com`, but that domain has **no MX records** and the
> A-record host listens on no SMTP port — mail to it bounces or blackholes. All
> twelve occurrences (web pages, `SUPPORT_EMAIL`, the app's support and appeal
> mailtos) now use `daniel@boonesystems.com`, whose domain runs Google
> Workspace mail (MX verified). Swap back only after real mail hosting or
> forwarding exists for gnomefarmersmarket.com.

Original finding, for the record:

Play's Data safety form requires apps that offer account creation to provide a
**URL where a user can request account and data deletion**, reachable without
installing the app. In-app deletion alone does not fill that field.

- In-app deletion is **present and thorough** (§5) — that part is done.
- `web/app/privacy/page.tsx` mentions deletion in one clause: *"You can edit or
  delete your listings anytime, and delete your account from the app's Settings
  (or by emailing us)"* with a `mailto:hello@gnomefarmersmarket.com` link.

That single clause is thin for the field. Play expects a page that explains what
is deleted, what is retained and for how long, and how to request it without the
app.

**Two options:**
- **(a) Minimum viable:** point the field at
  `https://gnomefarmersmarket.com/privacy` and expand the "Your choices" section
  into an explicit, headed **Account deletion** block: the in-app path, the email
  path, what gets deleted (§5's list), and the response time.
- **(b) Better:** add `web/app/account-deletion/page.tsx` as a dedicated page and
  point the field there.

Either way this is a **web lane change** — outside this document's owned files.

### F1 — `SYSTEM_ALERT_WINDOW` was declared in the production manifest. **CONFIG FIXED**

"Draw over other apps" is a permission Play scrutinizes and users see on the
listing. Gnome has no use for it; it arrives from React Native's dev-support
defaults and landed in `src/main/` rather than `src/debug/`.

**Fixed in `app.json`:**
```json
"android": { "blockedPermissions": ["android.permission.SYSTEM_ALERT_WINDOW"] }
```

Remaining proof: inspect the merged manifest from the final AAB and confirm the
permission is absent.

### F2 — Legacy storage permissions. **CONFIG FIXED / DEVICE VERIFY**

`READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` are declared. On Android 13+
these are inert for images, and `expo-image-picker` on SDK 54 uses the system
photo picker, which requires no permission at all. Play's Photo and Video
Permissions policy restricts broad media access and can require a declaration
form for apps that request it.

**Fixed in `app.json`:** both legacy storage permissions are listed under
`android.blockedPermissions` alongside `SYSTEM_ALERT_WINDOW`.

Remaining proof: inspect the merged manifest from the final AAB and confirm both
are absent, then confirm on a real device that picking a listing photo still
works on Android 10 and Android 14. Do not skip that check — it is exactly the
kind of change that looks free and breaks the oldest supported devices.

### F3 — Privacy Policy names the wrong AI provider. **RESOLVED 2026-08-17** — the deployed policy names Google's Gemini models as the only provider (verified live). Standing condition: `ai_settings.allow_paid_fallback` is FALSE in prod (verified). Working-tree guard: OpenAI/Anthropic keys are also hidden unless `AI_PAID_FALLBACK_DISCLOSED=true`, so flipping the database flag alone cannot re-falsify the policy. Original finding:

`web/app/privacy/page.tsx` says photos are processed by "our AI provider
(Anthropic)". The real chain in `supabase/functions/draft-listing/index.ts:123-126`
is Gemini first, with OpenAI and Anthropic only as paid fallbacks. Play's Data
safety declarations must match the policy. Fix the policy text.

### F4 — The buyer's street address is sent to a third-party geocoder. **MEDIUM**

`expo/lib/delivery.ts:117` calls
`https://nominatim.openstreetmap.org/search?…&q=<full address>` **from the
device** whenever a buyer saves a delivery address. That is a US home address
leaving for a volunteer-run service with no data-processing agreement, disclosed
nowhere. It affects how the Data safety form must be filled (§4.3).

**Recommended:** move the geocode behind the Supabase backend so the disclosure
becomes "our service provider", or name OSM in the privacy policy and declare
location/address as **shared**.

### F5 — Seed Drop: **fixed in the working tree during this audit.** **LOW (was MEDIUM)**

**What I found first.** `expo/app/(tabs)/index.tsx` linked the Browse feed to
`gnomefarmersmarket.com/seeds` with the copy "Seeds picked for your zone &
season, **shipped to your door**". That page, fetched today, presents an active
purchase flow with packet prices — while `billing_config.payments_live_enabled`
is `false` and no live Stripe price IDs exist.

**What is true now.** The Seed Drop lane changed it mid-audit.
`expo/app/(tabs)/index.tsx:294-322` now shows a **"Coming soon" pill**, drops the
shipping promise, and opens an in-app modal
(`expo/components/SeedDropComingSoon.tsx`) instead of a URL — no price, no date,
no purchase, no waitlist. A repo-wide grep confirms the app's only remaining
`Linking.openURL` calls are the three legal links. `web/app/seeds/page.tsx` was
likewise stripped of its Stripe Payment Links. Evidence inventory:
`docs/release/SEED_DROP_OFF.md`.

**What still stands:** closed by direct production probe on 2026-08-20. The
live `/seeds` page is Coming Soon only, with no `Build my box` copy, no visible
price, and no Stripe subscription promise. Play never sees the old path anyway
because the app no longer links there; §3 also does not describe Seed Drop as
available.

*(Policy-wise the old link was fine anyway: seed packets are physical goods,
which must **not** use Play Billing.)*

### F6 — Non-functional "coming soon" purchase surfaces. **FIXED IN WORKING TREE**

Upgrade and Boost used to show real prices behind buttons that opened "coming
soon" alerts. The working tree removes those priced dead ends: `/upgrade` is
informational, `expo/app/promote/[listingId].tsx` no longer offers a paid extra
promotion button, and shared upgrade cards use Android-safe copy.

---

### B4 — Android $0.99 overage checkout. **RESOLVED FOR V1.1.0 BY D1 GATE**

Publish rights are a digital service, so Android must not expose the Stripe
overage checkout at launch. The working tree implements owner decision D1:
Android sellers who exhaust the Free allowance see upgrade/reset copy, not a
Stripe checkout button or link-out. The $0.99 architecture remains available for
iOS/web and for a future native Play Billing implementation.

Standing verification: before upload, retest allowance exhaustion on Android and
confirm no `$0.99` checkout surface appears.

## 3. Store listing copy

Same product, Play's fields. Nothing below claims Seed Drop is available.

| Field | Value | Limit | Used |
|---|---|---|---|
| **App name** | `Gnome: Local Farmers Market` | 30 | 27 |
| **Short description** | `Buy, sell, trade and share homegrown produce with neighbors nearby.` | 80 | 67 |
| **Category** | Shopping | — | — |
| **Tags** | Marketplace, Food & Drink, Local | — | — |
| **Content rating** | Teen / IARC (see §4) | — | — |
| **Contains ads** | **No** | — | — |
| **In-app purchases** | **No** | D1: Android exposes no in-app digital purchase UI | — |

Play does not use keyword fields — the name and short description carry the
search weight, which is why the Play name spells out "Local Farmers Market"
where the App Store name is just "Gnome" (there, the subtitle does that work).

### 3.1 Full description (4000 char limit)

```
Gnome is a farmers market in your pocket.

Whatever you grow, bake, or make, there are neighbors nearby who want it — and whatever you're looking for, someone within a few miles probably has too much of it. Gnome connects the two, without a middleman.

BROWSE WHAT'S GROWING NEARBY
See what neighbors are offering right now, sorted by distance. Filter by category, or by how you want it: for sale, free to a good home, open to a trade, wanted, or a garden plot you can grow in. Set your search radius from one mile to the whole country. Search covers titles, descriptions, and category names and their synonyms.

MAP THE MARKET AROUND YOU
Switch to the Map tab and see what's nearby as color-coded pins on a real map, filtered by type and distance. Tap a pin and that listing opens right there. Pins sit at an approximate location — never anyone's exact address.

FIVE WAYS TO POST
• Sell — set your price and your unit
• Share Free — surplus zucchini finds a home
• Trade — your basil for their tomatoes
• Wanted — ask for what you're after, and let neighbors offer it
• Offer a Plot — share space in your garden with someone who has none

GNOME AI
In the Ask AI tab, photograph what you have and Gnome AI drafts a title, description, category, unit, and a suggested price — one draft per photo, several at once. Nothing is published automatically: every draft waits for you to publish, edit, or discard it. Ask it what's worth selling this week, which listings expire soon, or to mark your cucumbers sold out — it proposes, you confirm, and only then does anything change. Already selling elsewhere? Hand it screenshots of your existing shop and it turns them into drafts. And the Garden Planner will tell you what to plant, and when, for where you live.

YOUR OWN MARKET
Every seller gets a Market — its own tab — holding your listings, your pickup spots and hours, your story, and the payment handles you already use. Neighbors can follow it. Run a Market Drop — a time-boxed "Saturday Harvest, 8AM–1PM" collection of what you have ready. Or build a Gift Basket that sells several of your items as one offer.

PICKUP, DELIVERY, AND PRIVATE CHAT
Buyers order from your Market and choose a pickup window you set — or, if you offer it, a local delivery inside the radius you choose, for the fee you set. Someone claiming a single listing sends a request instead; approve it and a private thread opens to sort out time and place. Payment happens between the two of you, in whatever app you already use. Gnome takes no cut of your sale and never handles the money.

A SALES NOTEBOOK THAT MATCHES YOUR SEASON
Record the sales you make off the app — at the roadside stand, at the co-op, to the neighbor who knocked — alongside your Gnome sales, plus your seed, soil, and mileage expenses. One ledger for the whole season, with a monthly summary.

GROW LOG FOR PLOTS
Growing on someone else's plot? Log each stage with photos so the plot owner can follow along. When it's ready to harvest, one tap starts the listing.

BUILT FOR A REAL NEIGHBORHOOD
• Your exact address is never shown. Listings appear at an approximate location, and photos are stripped of their metadata — GPS included — before upload.
• Report and block are one tap away on every listing, Market, and conversation, and reports reach a staffed queue.
• Listings in regulated categories are screened before they go live, and sellers can upload the permits those categories require.
• Location is optional and foreground-only. The app works without it — you just can't sort by distance.
• Delete your account, and everything in it, from Settings.

Gnome works anywhere in the United States. Sellers are responsible for following their own state and local food laws. Gnome is not a party to any sale between neighbors and does not process payments between them.
```

~2,600 characters.

### 3.2 Release notes ("What's new", 500 char limit)

```
Welcome to Gnome. This first release has everything you need to trade with the
neighborhood: browse and map what's growing nearby; post something to sell,
share, trade, or ask for; run your own Market page with pickup spots and hours;
and message buyers privately once you approve their request. Gnome AI turns a
photo into a listing draft you review before publishing. Sellers get a Sales
Notebook and a Grow Log. Settings → Send feedback goes straight to the builders.
```

492 characters.

### 3.3 Store settings

| Field | Value | Verified |
|---|---|---|
| Email | `daniel@boonesystems.com` | Swapped 2026-08-17 from `hello@gnomefarmersmarket.com`, which cannot receive mail (no MX for that domain). boonesystems.com runs Google Workspace mail — MX verified deliverable. Appears on `/support`, `/privacy`, `/terms` and `/delete-account` |
| Website | `https://gnomefarmersmarket.com` | HTTP 200 today |
| Privacy Policy | `https://gnomefarmersmarket.com/privacy` | HTTP 200 today |
| Countries | United States only | The app is US-scoped: `countrycodes=us` on the geocoder, US state table in `expo/lib/location.ts`, USD throughout |
| Free / Paid | Free | D1 gates Android digital purchase UI; no Google Play Billing products |

---

## 4. Data safety form — answers with evidence

Derived by reading code. **No advertising SDK, no analytics SDK, no attribution
SDK exists in `expo/package.json`.** The full reasoning behind each row is in
`APP_STORE_PACKAGE.md` §5.

### 4.1 Global answers

| Question | Answer | Reasoning |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | §4.2 |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | All traffic is HTTPS (Supabase, exp.host, nominatim). `NSAllowsArbitraryLoads: false` on iOS; no cleartext traffic config on Android |
| Do you provide a way for users to request that their data be deleted? | **Yes** | §5; URL field = `https://gnomefarmersmarket.com/delete-account` (B3 resolved and live) |
| Does your app have an account creation feature? | **Yes** | Email/password, email code, Sign in with Apple, Google |
| Data collected in an ephemeral way only? | **No** for most rows; see the Precise Location note in 4.2 |
| Is data collection required, or can users choose? | **Mixed** — email and name are required to have an account; phone, address, photos, location, and permits are all optional |

### 4.2 Data types

Play's "Shared" means transferred to a **third party**; transfers to a service
provider processing on your behalf are excluded. Supabase, Expo's push service,
and the AI providers are service providers. **Nominatim is the row that needs a
decision (F4).**

| Play category → type | Collected | Shared | Purpose | Optional? | Evidence |
|---|---|---|---|---|---|
| Personal info → **Name** | Yes | No | App functionality, Account management | Required | `profiles.name`; `user_private_contact.first_name/last_name` (`0086`) |
| Personal info → **Email address** | Yes | No | App functionality, Account management | Required | Supabase auth; `user_private_contact.contact_email` |
| Personal info → **Phone number** | Yes | No | App functionality | Optional | `user_private_contact.phone_e164`, validated in `save_onboarding_contact` |
| Personal info → **Address** | Yes | **See F4** | App functionality | Optional | Buyer delivery addresses (`expo/app/market/order/[marketId].tsx:355-368`); seller exact pickup addresses (`expo/app/market/pickup-settings.tsx:477`). The full address string is sent to `nominatim.openstreetmap.org` from the device |
| Personal info → **User IDs** | Yes | No | App functionality | Required | Supabase `auth.users.id` |
| Personal info → **Other info** | Yes | No | App functionality | Optional | Seller credentials: type, issuing agency, permit number, issue/expiry dates (`expo/app/compliance/upload.tsx:69-75`) |
| Location → **Approximate location** | Yes | No | App functionality | Optional | Profile city/county/state/ZIP; approximate listing coordinates shown to other users |
| Location → **Precise location** | **Yes** | **See F4** | App functionality | Optional | `Location.getCurrentPositionAsync({ accuracy: Balanced })` (`expo/lib/location.ts`). The device reading itself is used in memory for distance filtering; the **geocoded lat/lng of a delivery address is stored** on the buyer's private row (`expo/lib/delivery.ts:145-160`), so this cannot be declared ephemeral-only |
| Financial info → **Other financial info** | Yes | No | App functionality | Optional | Sales Notebook — sale amounts, quantities, optional buyer label, expenses with vendor and category (`expo/components/RecordSaleSheet.tsx`, `expo/app/notebook.tsx`) |
| Financial info → **Payment info** | **No** | — | — | — | Gnome never collects a card or bank detail. Payment links open the seller's own Venmo/PayPal/Cash App/Zelle; `PaymentDisclaimer` states it every time |
| Photos and videos → **Photos** | Yes | **See §4.3b** | App functionality | Optional | `expo/lib/images.ts` → `listing-images`; grow-log photos; compliance document images. Photos are sent to the AI provider from five functions: `draft-listing`, `analyze-listing-photo`, `gnome-assistant` (draft_from_photos), `garden-planner`, `market-import` — all Gemini FREE tier, whose content Google may use for product improvement (Gnome's own /privacy says so) |
| Files and docs | Yes | No | App functionality | Optional | Permit/license uploads via `expo-document-picker` → `compliance-docs` bucket |
| Messages → **Other in-app messages** | Yes | No | App functionality | Optional | `claim_messages`; previews also travel in push payloads (`supabase/functions/notify/index.ts`) |
| Messages → AI chat / Other user content | Yes | **See §4.3b** | App functionality | Optional | Gnome AI tab chat turns + city/county/state context go to Gemini (`gnome-assistant`); Garden Planner sends coarsened city/state-style location plus recent turns with street-address/coordinate shapes redacted; full Gnome AI user and assistant text is stored verbatim in `ai_chat_messages` with no retention window |
| App activity → **App interactions** | Yes | No | Analytics, App functionality | Required | `logEvent` → `events` with `user_id` (`expo/lib/db.ts:12-27`). `garden_planner_used` now logs non-content metadata (`chars`, `has_photo`), not the user's question text. Other examples: `listing_viewed`, `listing_claim_started`, `claim_message_sent`, `market_order_requested`, `payment_link_opened`, `ai_draft_used`, `sale_recorded_mobile`, `plan_limit_hit` |
| Device or other IDs | Yes | No | App functionality | Optional | Expo push token in `device_tokens` (`expo/lib/notifications.ts`) |
| App info and performance → Crash logs, Diagnostics | **No** | — | — | — | No crash-reporting SDK installed |
| Health and fitness, Contacts, Calendar, Web browsing, Search history, Audio, Music, Installed apps | **No** | — | — | — | None collected |

### 4.3 The two rows that need a decision before you fill the form

**a) Address and Precise location (F4) — decided by deployment 2026-08-17.**
The live privacy policy now names OpenStreetMap (Nominatim) as the geocoder,
so the ship-as-is fork was taken: declare Personal info → Address as
**collected and shared** (recipient: OpenStreetMap Foundation, disclosed in
/privacy) and keep Precise location collected-not-ephemeral (geocoded lat/lng
stored). Moving the geocode server-side later lets both revert to not-shared.
The original two-option analysis, for the record:

- **Move the geocode server-side** (recommended) → the recipient becomes your own
  backend, and Address/Location can be declared **collected, not shared**.
- **Ship as-is** → declare Address and Precise location as **shared**, name
  OpenStreetMap in the privacy policy, and expect to explain it.

Declaring "not shared" while shipping the current code would be an inaccurate
Data safety declaration, which is itself a Play policy violation.

**b) Gemini free tier (new since 54e141e).** Every AI surface — draft-listing,
analyze-listing-photo, gnome-assistant (chat + photo drafts), market-import —
runs on Gemini's FREE tier, and Google may use free-tier content for product
improvement; Gnome's own deployed privacy policy says so. That defeats the
service-provider exclusion, so either declare Photos and AI-chat content
**shared** (recipient: Google), or move `GEMINI_API_KEY` to a tier with
data-use protections and keep them "collected only". Declaring not-shared
while on the free tier is the same inaccurate-declaration violation as F4.

---

## 5. Account deletion

**Play requirement (Data safety → Data deletion):** an app offering account
creation must (a) let users request deletion of the account and its data
**in-app**, and (b) provide a **web URL** where the same request can be made
without installing the app.

| Leg | Status |
|---|---|
| **In-app deletion** | **PRESENT.** `expo/app/settings.tsx` → "Delete my account", two destructive confirmations, calls the JWT-authenticated `delete-account` edge function |
| **Server implementation** | `supabase/functions/delete-account/index.ts` — identity from the caller's JWT, never the body. Purges `device_tokens`, `claim_messages`, `claims` (as claimer and on own listings), `listings`, `seller_credentials` + `credential_taxonomy_scope`, `markets`, `user_blocks` both directions, `events`, `profiles`, `seed_orders` (NO-ACTION FK — added in delete-account v9, 2026-08-17), then `auth.admin.deleteUser`. Known gap: `ai_usage` / `ai_daily_counter` rows (no FK) survive deletion — fix pending. Storage: `grow-log` folders per affected claim, `compliance-docs/<uid>`, `listing-images/<uid>` |
| **Web URL** | `https://gnomefarmersmarket.com/delete-account` — **live, HTTP 200, verified 2026-08-17** (see B3) |

So: not a blocker for the app's behavior and not a blocker for completing the
Play form. B3 is resolved in the repo and live on the public website.

---

## 6. Content rating (IARC questionnaire)

| Question | Answer | Reasoning |
|---|---|---|
| App category | **Reference, News, or Educational / Utility** → in practice select the **Social Networking / Communication** questionnaire path, because the app has user-to-user messaging | Gnome is a marketplace with direct messaging; answering as a plain shopping utility understates it |
| Violence (realistic, cartoon, or otherwise) | No | — |
| Sexuality or nudity | No | — |
| Profanity or crude humor | No | Gnome's own copy contains none; user-typed content is covered by the UGC questions |
| Controlled substances — drugs, alcohol, tobacco | No | Prohibited categories are blocked at post time by a database-level compliance gate (`supabase/migrations/0043_compliance_storage_and_gate.sql`, `0046_compliance_ui_support.sql`) |
| Gambling or simulated gambling | No | — |
| Horror / fear | No | — |
| **Does the app allow users to interact or exchange content with other users?** | **Yes** | Private pickup chat (`expo/app/chat/[claimId].tsx`); listings and Market pages are visible to all users |
| — Can users communicate with strangers? | **Yes** | Any user can request another user's listing, which opens a thread on approval |
| — Is user interaction moderated? | **Yes** | Report on every listing, Market, and chat (`useReport` → `reports`, `0013_trust_layer.sql`); block/unblock (`useBlockUser`, managed in Settings); admin moderation (`0024_admin_moderation.sql`, `web/app/admin/`) |
| **Does the app share the user's current location with other users?** | **Yes — approximate only** | Listings show an approximate area and a distance. Exact coordinates are deliberately withheld: `listings.lat/lng` is revoked at the DB level, photo EXIF including GPS is stripped before upload (`expo/lib/images.ts`), and exact pickup addresses are released only to an approved counterparty |
| **Does the app allow users to purchase digital goods?** | **No** | D1 gates Android native digital checkout off, Android-opened first-party web pages disable digital checkout, and Android-facing AI copy suppresses overage prices |
| Does the app provide unrestricted internet access (a browser)? | **No** | Only specific first-party and payment-app URLs via `Linking.openURL`, plus `expo-web-browser` for the OAuth session |
| Is the app "Designed for Families" / targeted at children? | **No** | The privacy policy states Gnome is not for children under 13 |

**Expected outcome:** ESRB **Teen**, PEGI **12**, USK **12**, with the
"Users Interact" and "Shares Location" interactive-elements descriptors. The
rating is driven by messaging and location sharing, not by any depicted content.

### 6.1 Play's User-Generated Content policy

Play requires: a UGC moderation policy, an in-app reporting mechanism, an
in-app blocking mechanism, and removal of objectionable content. Gnome has the
reporting, the blocking, and a staffed admin queue. **What it does not have is
a proactive IMAGE filter** — but since 0095 there IS a proactive server-side
text screen at publish time: prohibited goods are blocked outright and
ambiguous listings (raw milk, alcohol, etc.) are saved unpublished for human
review (`supabase/migrations/0095_prohibited_content.sql`; seller-facing flow
in `expo/lib/screening.ts`). Worded-around euphemisms still pass, so reactive
report/block/admin remain the backstop. State the 24-hour commitment in the
reviewer notes (§7.2).

---

## 7. Testing track, reviewer notes, and credentials

### 7.1 Closed testing — check this before you plan a launch date

Google requires **personal** developer accounts created after 13 November 2023 to
run a **closed test with at least 12 testers opted in continuously for 14 days**
before they can apply for production access. **Organization** accounts are exempt.

**I cannot determine which account type Boone Systems LLC holds** — that lives in
the Play Console, not the repo. If it is a personal account, the shortest path to
production is **at minimum two weeks longer than the iOS path**, and the 12
testers must stay opted in the whole time. Check this first; it is the single
biggest schedule risk on the Android side and it is invisible from the code.

### 7.2 Reviewer / tester notes

**Do not commit credentials to this repo.** Create the reviewer account by hand
and enter it in Play Console → App content → App access.

Two things make this easy: `mailer_autoconfirm` is **`true`** on the Supabase
project (verified live via `/auth/v1/settings`), so signups are usable
immediately; and the app offers a **6-digit email code** sign-in
(`expo/app/sign-in.tsx` → `requestEmailCode` / `verifyEmailCode`) alongside
email+password. Give reviewers **email + password** — it needs no deep link.

```
APP ACCESS
Parts of Gnome require an account. Credentials are provided above. The app also
supports Sign in with Google and Sign in with Apple; the email + password path
is the simplest for review. Browsing listings works signed out.

WHAT GNOME IS
A local marketplace for surplus produce and homemade goods. Neighbors post what
they grow or make and sell, give away, trade, or request it. Handoffs are
arranged directly between the two people, in person.

NO PURCHASES ON ANDROID
This version sells nothing on Android. There is no Google Play Billing
integration and no payment processing inside the Android app. Sellers who
exhaust their monthly publishing allowance are shown the plan comparison, not a
purchase. When a buyer and seller settle up for goods, the app can open the
seller's own Venmo / PayPal / Cash App / Zelle handle; the payment happens
entirely in that app and Gnome never sees or records it. A disclaimer saying so
is shown every time.

ACCOUNT DELETION
Profile tab → Settings → "Delete my account". Two confirmations, then the
account, Market, listings, photos, and messages are permanently deleted
server-side. Web instructions: https://gnomefarmersmarket.com/delete-account.

DELIVERY SETTINGS
Market tab → edit Market → Delivery settings. A Free Market can offer delivery
up to 15 miles with one flat fee; paid plans add distance surcharges and
scheduling controls.

USER-GENERATED CONTENT
Every listing, Market page, and conversation has a Report control, and any user
can be blocked from the listing or Market screen (blocked users are managed in
Settings). Reports reach a staffed moderation queue; we remove objectionable
content and eject the poster within 24 hours. Sample listings are labeled
"Preview" so they are never mistaken for real offers.

LOCATION
Location is foreground-only and optional — the app works without it, you just
can't sort by distance. Listings show an approximate area only; exact addresses
are never public and photo metadata including GPS is stripped before upload.
No background location is requested.

CONTACT
daniel@boonesystems.com
```

### 7.3 App content declarations

| Declaration | Answer |
|---|---|
| Privacy policy | `https://gnomefarmersmarket.com/privacy` |
| Ads | **No ads** — no ad SDK in `expo/package.json` |
| App access | Restricted — credentials required (§7.2) |
| Content ratings | §6 |
| Target audience and content | 13+; not appealing to children; no Designed for Families |
| News app | No |
| COVID-19 contact tracing | No |
| Data safety | §4 |
| Government app | No |
| **Financial features** | **"My app doesn't provide any financial features."** Gnome does not process, transfer, or hold funds. It opens the seller's own peer-payment app via a deep link and records nothing (`expo/lib/marketops.ts:168-192`). The Sales Notebook is the seller's own private ledger of sales that happened elsewhere. **Flagged deliberately** — an auditor could look at "Pay seller" and ask; the answer above is the accurate one |
| Health apps | No |
| **Photo and video permissions** | Declaration should not be required if the final AAB confirms no `READ_MEDIA_IMAGES` / broad storage permissions are retained. Verify F2 in the built manifest first. |
| **Location permissions** | Declaration required — `ACCESS_FINE_LOCATION` is requested. Justification: "Sorting and filtering marketplace listings by distance from the user, and one-tap fill of the user's town/state/ZIP on their profile. Foreground only; no background location is requested; the app is fully usable with location denied." |

---

## 8. Graphics and screenshots

### 8.1 Required assets

| Asset | Spec | Status |
|---|---|---|
| App icon | 512 × 512, 32-bit PNG **with alpha** | `docs/release/play-icon-512.png` generated and verified |
| Feature graphic | 1024 × 500, PNG or JPEG, **no alpha** | `docs/release/play-feature-graphic.png` generated and verified |
| Phone screenshots | 2–8, PNG/JPEG, 16:9 or 9:16, 320–3840 px per side | §8.2 |
| 7" tablet screenshots | Optional | Skip — the app is phone-oriented (`supportsTablet: false` on iOS; no tablet layouts) |
| 10" tablet screenshots | Optional | Skip. Play will show a "not optimized for tablets" note on tablet devices; acceptable for 1.1.0 |
| Promo video | Optional | Skip |

### 8.2 Screenshot package

Four portrait captures from the actual phone-sized Android app are ready in
`artifacts/store/google/`. Each is 1287 × 2288, opaque, and within Play's phone
screenshot limits.

| # | File | Screen |
|---|---|---|
| 1 | `01-browse.png` | Browse feed with photo listings and filters |
| 2 | `02-map.png` | Google tiles, attribution, and 13 multi-colour listing pins |
| 3 | `03-market.png` | Customized Market with cover/profile photos, followers, hours, visit requests, and a live Drop |
| 4 | `04-market-listings.png` | The same Market's live Drop and photo inventory |

**Rules:**
- Purpose-made screenshot account. **No real names, addresses, phone numbers, or
  avatars** in any frame.
- The Map image comes from the signed release build whose certificate is
  authorized for the restricted Maps credential. The final Play-signed install
  still requires the post-upload certificate and runtime check in §9.
- Skip Upgrade and Boost; they are not part of the Play screenshot story.
- The Seed Drop card may appear in frame 1 — it now carries a "Coming soon" pill
  and opens a non-transactional modal (F5). Do not screenshot that modal as a
  feature; it is an announcement, not shipped functionality.

---

## 9. Exact remaining actions for Daniel

Ordered. **(owner)** marks anything needing a Google account or console.

### Must happen before the final Android build/upload

1. **(owner + coordinator)** **B1** — Google Maps config is present in
   `app.json`; re-verify Map tiles after the final AAB is signed with the Play
   signing SHA-1.
2. **(owner + coordinator)** **B2** — Firebase config is present in
   `app.json`/`google-services.json`; upload or confirm the FCM V1 credential in
   EAS, then prove push on a physical Android device.
3. **(coordinator)** **F1/F2** — `android.blockedPermissions` is configured for
   `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE`, and
   `WRITE_EXTERNAL_STORAGE`; verify the final merged manifest and photo picker.
4. ~~**(web lane)** **B3** — publish an account-deletion page~~ **DONE — deployed and verified 2026-08-17** (`/delete-account`, HTTP 200). Superseded text: or expand
   `/privacy` with an explicit deletion section, and capture its URL.
5. **(owner)** **§4.3b** — decide Gemini free-tier data safety: paid Gemini key,
   or declare the affected photos / AI chat content shared with Google (§4.3).
6. ~~**(coordinator)** **F6** — remove prices from the non-functional
   Upgrade/Boost surfaces~~ **DONE in working tree.** (**F5** is closed in
   production as of the 2026-08-20 direct `/seeds` and `/pricing` probes.)

### Play Console (owner)

7. **Check the developer account type first (§7.1).** If it is a personal
   account, start the 12-tester / 14-day closed test **now** — it gates
   everything else by two weeks.
8. Create the app: **Gnome: Local Farmers Market**, English (United States),
   App, Free.
9. Set up **Play App Signing** (let Play manage the app signing key; EAS
   provides the upload key).
10. Paste §3 (name, short description, full description, category, contact
    details, privacy policy URL).
11. Upload the §8 graphics — **remember the 1024×500 feature graphic.**
12. Complete **App content**: privacy policy, ads (no), app access (§7.2),
    content ratings (§6), target audience (13+), news (no), COVID (no),
    **data safety (§4)**, financial features (§7.3), location permissions
    declaration (§7.3), photo/video permissions (after F2).
13. Set country availability to **United States**.

### Build and submit

14. `cd expo && eas build --platform android --profile production`. Remote
    versioning is active; the latest remote Android versionCode observed on
    2026-08-20 was 4, so the final production build must increment beyond every
    prior upload.
15. **On that build, verify before promoting:** the Map tab renders (B1); push
    registration writes a `device_tokens` row on a physical Android device (B2);
    the merged manifest contains `POST_NOTIFICATIONS` and does **not** contain
    `SYSTEM_ALERT_WINDOW` (F1); picking a listing photo works on Android 10 and
    Android 14 (F2).
16. Upload to **Internal testing** first. Run the push loop end-to-end
    (claim → approve → message) across an Android and an iOS device.
17. Promote through closed testing (mandatory if §7.1 applies) → production.
18. `eas.json` → `submit.production` is `{}`. Configure `eas submit` with a Play
    service-account JSON, or upload the `.aab` by hand. **Do not commit the
    service-account key** — use an EAS secret. The coordinator owns `eas.json`.

---

## 10. Summary — what stands between here and a Play listing

| # | Item | Severity | Owner |
|---|---|---|---|
| B1 | Google Maps config present; Map must be re-verified after final Play-signed build | **DEVICE VERIFY** | coordinator + owner |
| B2 | Firebase config present; Android push still needs physical-device proof | **DEVICE VERIFY** | coordinator + owner |
| ~~B3~~ | ~~No account-deletion web URL~~ **RESOLVED** — `/delete-account` live, HTTP 200, re-verified 2026-08-20 | Done | — |
| §7.1 | Possible 12-tester / 14-day closed-test requirement | **SCHEDULE BLOCKER if personal account** | owner |
| ~~F1~~ | ~~`SYSTEM_ALERT_WINDOW` in the production manifest~~ **CONFIG FIXED** — verify absent in final AAB | Device/build verify | coordinator |
| F2 | Legacy storage permissions blocked in config; photo picker still needs Android 10/14 proof | Device/build verify | coordinator |
| ~~F3~~ | ~~Privacy policy names the wrong AI provider~~ **RESOLVED** — live policy names Gemini and OpenStreetMap, re-verified 2026-08-20 | Done | — |
| F4 | Buyer address sent to OpenStreetMap; changes the Data safety answers | Medium | coordinator/web |
| ~~F5~~ | ~~Seed Drop paid web copy~~ **RESOLVED** — live `/seeds` is Coming Soon only, re-verified 2026-08-20 | Done | — |
| ~~F6~~ | ~~"Coming soon" priced buttons~~ **RESOLVED in working tree** | Done | — |
| — | **Account deletion (in-app)** | **Done — verified** | — |
| — | Target API 36, min 24 | Done | — |
| — | No ads, no IAP, no tracking SDKs | Done | — |
