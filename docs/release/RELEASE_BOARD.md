# Gnome 1.1.0 — Android release board

The single place that says what is done, what is holding, and who is holding it.
Updated 2026-08-19 against `7d3be90`.

Companion docs: `GOOGLE_PLAY_PACKAGE.md` (the standing audit — evidence for every
claim), `PLAY_STORE_LISTING.md` (store presentation), `../billing/STRIPE_LIVE_ACTIVATION.md`
(the conditions for ever taking real money).

---

## Board

| Blocker | Status | Owner | Next action |
|---|---|---|---|
| **B1** Google Maps | **CLOSED — re-verified 2026-08-19** | — | Re-verify after first upload with the Play signing SHA-1 (§3) |
| **B2** FCM push | **CONFIGURED / NOT PROVEN** | Daniel + Claude | Physical Android run (§2) |
| **B3** Deletion URL + contact | **CLOSED** | — | — |
| **B4** Purchase posture | **DECIDED — D1** | — | Gate shipped (`ffb2d28`); copy leaks open, see §9 |
| **§4.3b** Gemini data safety | **DECISION REQUIRED** | **Daniel** | §7 — decision drives the Data safety answers |
| Website ↔ app parity | **CLOSED** (3 fixes, `90b7c36`) | — | Deploy web; two owner items in §8 |
| `/pricing` test-mode redirect | **FIXED** (`9945b24`) | — | Deploy web |
| **App icon + feature graphic** | **BLOCKER — art does not exist** | **Daniel** | §10 — now the critical path |
| **D1 copy leaks** | **BLOCKER — 7 surfaces, not 2** | Claude | §9 — pure code fix |
| Reviewer notes (Play + iOS) | **BLOCKER — misstate the product** | Claude | §9 — text already drafted |
| Store assets | **DRAFTED** (`8714ca4`) | Claude + Daniel | Screenshots from the final RC |
| **Final AAB** | **HOLD** | Claude | Blocked on §9 + §10, not on B4 |
| **Play upload** | **HOLD** | Daniel | Blocked on final AAB |

### Remodel sprint — landed 2026-08-18/19

| Item | Status | Where |
|---|---|---|
| 0126 three-tier pricing (Max retired by re-point) | **APPLIED to production** (`20260819014212`) + all allowlist copies | `d4af632`, `31f502b` |
| Web /pricing three tiers | **DEPLOYED** — live page shows Pro $9.99 / Farm $29.99, zero "Max" | verified live |
| Identity v4 token flip (white canvas + gnome hues) | **COMMITTED** `18e64cf` — all ~70 importers re-skin via one file | emulator proof pending |
| billing-checkout v11 / billing-admin v13 | **DEPLOYED** — sponsor SKU out of every allowlist + reseed path | verified |
| Money suites post-0126 | seed_drop_off ALL PASS · payment_hardening 34/34 · renew_window 24/24 | PG17 clean room |

**Owner decisions D1–D5 — ALL DECIDED 2026-08-19.** Recorded in
`../design/GNOME_IDENTITY.md`. D1 Android ships with no in-app digital purchase
UI (gate `expo/lib/digitalPurchase.ts`); D2 active-slot semantics not in the RC;
D3 six tabs with short labels; D4 annual post-launch; D5 no claims for features
that do not ship. The list below is kept for the reasoning behind each.

**Remodel decisions as they stood before D1–D5 (historical):**
1. **Android launch posture for the $0.99** — the billing lane's verified finding:
   store billing is *cheaper* than Stripe at this price point (~$0.15 vs ~$0.33
   per sale) and Apple requires IAP parity eventually, but Play Billing is 4–6
   engineering weeks and cannot ship in v1.1.0. Recommended: ship v1.1.0 with no
   Android purchase surface (an explanatory wall; $0 revenue cost — verified
   zero live prices exist), land Play Billing as v1.2.0. This KEEPS the $0.99 —
   on web now, in-app via store billing next release.
2. **"3 ACTIVE Sell listings" semantics** — the Free card's slot model vs the
   current publishes-per-month metering. Real engine change with a concurrency
   design; first draft had a cap-bypass the adversarial pass caught. Ships
   separately, not tonight.
3. **Five tabs vs six** — the nav lane measured it: dropping Profile only moves
   the truncation break from 1.02× to 1.26× font scale, while shortening the
   labels ("Home", "Ask AI") fixes it at any tab count to ~1.9×. The mockup
   shows five tabs; the data says the label is the problem. Pick: mockup-faithful
   five, five + short labels, or six + short labels.
4. **Annual Pro $99 / Farm $299** — no annual machinery exists anywhere; needs
   two owner-created Stripe products plus a billing_interval column. Post-launch.
5. **Farm card copy** — "priority support" (no SLA exists) and "advanced
   analytics" (verify what ships) are commitments, not features.
6. **Gnome character art** — the app ships zero in-app illustration today; the
   55 EmptyState call sites take an emoji prop, which is the natural insertion
   point. Real illustration work; emoji interim is honest.

### What the sprint changed about the shape of the problem

Two lanes were adversarially re-derived, and both had a load-bearing claim fail.
Recorded here because the corrections change what has to be done, not just what
is known:

1. **Gating the $0.99 surface on Android does not by itself close B4.** The app
   opens `gnomefarmersmarket.com/terms`, `/privacy` and `/trust`
   (`expo/app/settings.tsx:173,181,189` and `expo/app/sign-in.tsx:371,375`), and
   every one of those live pages carries a nav link to `/pricing`, whose
   "Upgrade to Pro/Max/Farm" buttons run `billing-checkout` straight into
   Stripe. That is two taps from inside the app — one of them from the sign-in
   flow, which Play's Payments policy §4 names explicitly. Any B4 remedy has to
   account for the outbound legal links, not just the in-app checkout.
2. **`/pricing` was silently sending real visitors into a test-mode Stripe
   page.** Fixed in `9945b24` — see §8. This was live on production, and is a
   defect rather than a policy question.

**Rule for the two HOLDs:** the final AAB is built once, from the commit that
carries the B4 decision. Building before that decision guarantees a rebuild, and
a rebuild after upload costs a versionCode and a review cycle.

---

## 1. The build path, and the gap in the current artifacts

Android identity is settled and verified in the merged manifest of a real build:

| Item | Value |
|---|---|
| Package | `app.boonesystems.gnome` |
| Version | `1.1.0` |
| versionCode | remote + autoIncrement (last: vc4) |
| Signing | EAS-managed upload keystore; Play App Signing at upload |
| Maps key | `android.config.googleMaps.apiKey` — restricted to the package + upload SHA-1 |
| Firebase | `android.googleServicesFile: ./google-services.json`, project `gnome-farmers-market-70414` |
| Blocked perms | `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` |

**The existing AAB is not shippable, for a reason worth stating precisely.**

| Artifact | Built from | Carries Firebase |
|---|---|---|
| APK vc4 (`fb126697`) | `0705f34` | **yes** — this is the build push plumbing was verified on |
| AAB vc4 (`e9ecc210`) | `be8bb2e` | **no** — predates the Firebase commit |

The Play-bound artifact was cut before `google-services.json` landed. Uploading
it would ship an Android app whose push can never work, and the failure is
silent — no crash, no error, just notifications that never arrive. The final AAB
must be built from a commit at or after `0705f34`.

```bash
cd expo && eas build --platform android --profile production --non-interactive
```

Verify before upload — all three, on the artifact itself:
1. `eas build:view <id>` → `gitCommitHash` is the B4 decision commit
2. versionCode is higher than every prior upload
3. The AAB's merged manifest contains `com.google.android.geo.API_KEY` and
   `ExpoFirebaseMessagingService` (unzip the AAB or install the paired APK)

---

## 2. B2 — the physical Android procedure

**Why an emulator cannot close this.** `expo/lib/notifications.ts:22` guards
registration with `!Device.isDevice`, which `expo-device` reports false on
emulators, so the app returns before requesting permission or fetching a token.
Measured on vc4: no permission prompt, `granted=false`, no `device_tokens` row.
That guard is correct for shipping — every real user is on a real device — so it
stays. **Do not weaken it to manufacture emulator coverage:** a green result from
a modified build proves something the shipped build does not do.

What is already proven, so the remaining test is genuinely the last mile:
`ExpoFirebaseMessagingService` is bound to `com.google.firebase.MESSAGING_EVENT`
in vc4 (no earlier Android build had it), `google-services.json` matches the
package, and the FCM V1 service-account key is registered to the Expo project.

**The run** (any Android 13+ phone, ~5 minutes):

1. Install the APK — `adb install gnome-vc4.apk`, or download it on the device
   from its EAS build URL
2. Sign in (email code is fine)
3. **Accept the notification permission prompt** — it must appear; on Android 13+
   its absence is itself the finding
4. Confirm the token reached the server:
   ```sql
   select platform, left(token, 22), created_at
     from public.device_tokens d
     join auth.users u on u.id = d.user_id
    where u.email = '<the test account>';
   ```
   Expect one row, `platform='android'`, token starting `ExponentPushToken[`
5. Send a push to that token from https://expo.dev/notifications
6. **Confirm it displays on the device** — this is the assertion that matters;
   a 200 from the push API is not delivery
7. Tap it and confirm it routes (`expo/lib/useNotificationRouting.ts`)
8. Background the app and repeat 5–7; then kill the app and repeat

**If the notification never arrives**, read the Expo push receipt rather than
guessing — `InvalidCredentials` means the FCM V1 key is wrong or not attached,
`DeviceNotRegistered` means the token is stale. Note that
`supabase/functions/notify/index.ts` currently discards the ticket array, so
server logs will not tell you; check the receipt directly.

**Only after step 6 passes** may B2 be recorded as proven, and only for the build
that was actually installed.

---

## 3. After the first Play upload — the Maps re-verification

Play App Signing re-signs the app with a key that is **not** the upload key, so
Store installs present a SHA-1 the Maps credential does not yet list. Maps then
fails **in production only** — the hardest place to notice and the worst place to
find out.

1. Play Console → your app → **Setup → App signing**
2. Copy the **App signing key certificate** SHA-1
3. Google Cloud Console → project `Gnome Farmers Market` → **APIs & Services →
   Credentials** → the Android Maps key → **add** that SHA-1 alongside the
   existing upload fingerprint (`DA:F1:79:50:49:38:5F:41:DA:E0:37:C4:EB:06:D4:B1:20:75:0C:13`).
   Both entries coexist: the upload key covers internal builds and local QA, the
   Play key covers real installs
4. Install the app **from the Play internal-test track** (not the sideloaded APK)
5. Open the Map tab: tiles render, market pins plot, Google attribution shows
6. Confirm no `API key not found` and no ReactInstance teardown:
   ```bash
   adb logcat -d | grep -cE "API key not found|getOrCreateDestroyTask"   # expect 0
   ```

Step 6 matters because a missing key does not degrade the Map tab — it throws
inside `FabricUIManager` and destroys the entire React instance, whiting out the
whole app until force-stop, including tabs the user never opened.

---

## 4. Owner actions outstanding

1. **B4 decision** — purchase posture (Agent 1's options)
2. **§4.3b decision** — Gemini tier / data-safety declaration (Agent 2's options)
3. **B2 physical run** — §2 above; needs an Android phone
4. **Play Console** — create the app, upload the final AAB, complete Data safety
5. **Post-upload** — §3 Maps SHA-1
6. Housekeeping: delete the Firebase service-account JSON from `~/Downloads`
   (already uploaded to Expo; it grants full Firebase admin)

## 5. Standing constraints

- `payments_live_enabled` stays **FALSE**. Stripe is TEST-only; production has
  never taken a live payment. Going live has its own gate list in
  `../billing/STRIPE_LIVE_ACTIVATION.md`.
- Seed Drop ships as an announcement. Every seed product key is refused at
  checkout — no store copy or screenshot may imply it is purchasable.
- Android is not published. Nothing on the website or in listing copy may claim
  Play availability until it is.

---

## 5b. Pre-remodel checkpoint, and the fact that de-risks the tier change

**Recoverable checkpoint:** tag `rc-prerebrand-2026-08-18` at `5299627` on
`feat/ai-market-import`, pushed. It records the working RC: APK vc4 `fb126697`
(from `0705f34`, carries Firebase), AAB vc4 `e9ecc210` (from `be8bb2e`, does
NOT), Maps closed, Firebase configured, B2 unproven, payments off. If the
remodel goes wrong, that is the commit to return to.

**Verified in production before planning the Free/Pro/Max/Farm -> Free/Pro/Farm
migration** (13 markets, so this was checked exhaustively rather than sampled):

| Check | Result |
|---|---|
| `market_subscriptions` rows, ever | **0** |
| `admin_plan_grants` rows, ever | **0** |
| Markets on `farm` (= customer-facing "Max") | **0** |
| Markets on `sponsor` (= customer-facing "Farm") | **0** |
| Only non-free market | `Maria G.'s Market` on `grower`, with no subscription backing it |
| Paid publishes ever / authorizations consumed | 2 / 2 — both from §13 QA |

**No one has ever held a paid subscription on Gnome.** Removing Max therefore
migrates zero customers, and there is no production subscription state that a
tier change could damage. This is a pre-customer rename, not a data migration.

Two things that does NOT make trivial, so they stay in scope: the **code** work
is unchanged (entitlement checks in SQL and in both clients, `plan_limits`,
pricing UI, Stripe product objects), and the **naming trap** is unchanged — the
enum value `farm` is customer-facing "Max" while `sponsor` is customer-facing
"Farm", so a plan that reads the enum literally will restructure the wrong tier.

---

## 6. B4 — purchase posture (Daniel decides)

**The finding.** The $0.99 publish/renewal overage buys something delivered
entirely inside Gnome: a listing row flips to `active` and becomes visible in
the app's feed for 7 days. Gnome ships nothing and takes no cut of the produce
sale — buyer↔seller money is entirely off-platform. Under Google's actual
wording that is "app functionality or content," i.e. Play Billing territory.
The marketplace/physical-goods defence rests on observed practice at eBay and
Etsy, not on any written exemption, and both of those avoid the question by not
selling listing credits inside their apps. The literal text does not resolve in
Gnome's favour.

**Scale, so the decision is made on real numbers.** Free = 3 publishes/month,
**0** included renewals; Sell listings live 7 days; publish and renewal draw
separate pools. So a free seller hits the publish overage on their 4th listing
*and* the renewal wall on day 8 — roughly $8.91/month to keep 3 listings alive.
A Pro seller with 10 active listings pays about $36.63/month in renewals on top
of $9.99. This is not an edge case; it is the dominant mechanic below `sponsor`.

**Nothing is at risk today.** `payments_live_enabled = false` and not one
`billing_products` row has a live Stripe price, so every SKU is unpurchasable
for real money on every platform. The immediate revenue cost of any option here
is **$0** — which is exactly why it should be decided now rather than after
launch.

**The options.** All three are legitimate; the third was dropped by the first
lane and restored by adversarial review because its economics are the best:

| | What it is | Cost of a $0.99 sale | Ships when |
|---|---|---|---|
| **A. Gate off on Android** | Remove the purchase surface for `Platform.OS === 'android'`; sellers hit an explanatory wall | — (no sale) | Immediately |
| **B. External content links** | Enroll in Google's US link-out programme, keep Stripe | ~$0.33 Stripe **+ ~10% Google from 2026-10-01** ≈ $0.43 | After Google-side onboarding |
| **C. Play Billing** | Integrate Play's billing library for the digital SKUs | ~$0.15 (15% under $1M/yr) | After native integration |

Option C is the cheapest per transaction and the only one with no US-injunction
dependency. Options B and C both require work that cannot be scheduled from this
repo alone.

**Whichever is chosen, it must also cover the web-pricing path described above.**

## 7. §4.3b — Gemini data safety (Daniel decides)

**The finding, verified against Google's current terms.** Every AI surface runs
on the Gemini Developer API **unpaid tier**, whose terms state Google uses
submitted content "to provide, improve, and develop Google products," that human
reviewers may read it, and verbatim: *"Do not submit sensitive, confidential, or
personal information to the Unpaid Services."* Play's service-provider exclusion
requires processing *on the developer's behalf and instructions*; free-tier
Google processes for its own purposes, so the exclusion does not apply and
everything reaching Gemini must be declared **Shared**.

**Broader than the standing audit said.** Five functions send photos, not four
(`garden-planner` was missed). Five of eight AI surfaces are reachable by FREE
users and three of those send photos — AI is not a paid perk. And it is not only
a Photos/chat question: the welcome conversation sends the neighbour's real
first and last name, and city/county/state travel with assistant and planner
requests. Exactly one PII redactor exists and it is wired to one of the eight
functions.

**Two options:**
- **Move `GEMINI_API_KEY` to a billed (paid-tier) key.** Google's paid tier
  states content is *not* used for product improvement, which restores the
  service-provider position and lets Photos, Name and Approximate location stay
  "collected, not shared". Cheapest path to a clean declaration.
- **Declare Shared = Yes** on Photos, Messages/AI-content, Name and Approximate
  location, recipient Google. Accurate and free, but it is a materially heavier
  Data safety card for the user to read.

Declaring not-shared while on the free tier is an inaccurate Data safety
declaration, which is itself a Play violation. That option does not exist.

## 8. Owner items surfaced by the sprint (not blockers)

1. **The privacy policy says "Google is the only AI provider Gnome uses."**
   True today — `ai_settings.allow_paid_fallback` is false — but it is an
   absolute backed by a runtime flag, and `ai_usage_log` records one real
   Anthropic call (`claude-haiku-4-5`, 2026-08-11). Flipping that flag silently
   falsifies a published privacy commitment. Either couple the flag to the
   disclosure or soften the wording; both are Daniel's call.
2. **Should `/pricing` offer upgrade CTAs at all while payments are off?** The
   silent-redirect defect is fixed, but the page still advertises plans nobody
   can actually buy. Product call.
3. **Two inert SKUs** — `GNOME_PROMOTION_PACK_3` and `GNOME_PROMOTION_PACK_10`
   are packs of digital promotion credits, the clearest Play-Billing-side items
   in the catalogue. Both are `active=false` with no price today; they need the
   same B4 answer before they ever ship.

---

## 9. Store readiness — what the audit found, and what I verified myself

Agent E audited the submission text against 0126 and D1–D5 on 2026-08-19. I
re-checked every load-bearing claim below against the code rather than taking
the report at its word, because a wrong blocker costs more than a missed one.
**Verified** means I reproduced it; where my reading differs from the report's,
that is stated.

### 9.1 The real blocker — D1 leaks into copy in seven surfaces, not two

**Verified.** `expo/lib/digitalPurchase.ts` gates the three *checkout* call
sites correctly. It does not gate the *strings*. These five carry `$0.99` and do
not import the gate at all:

| File | What an Android user reads |
|---|---|
| `expo/components/UpgradePromptCard.tsx:65` | "Publish more for $0.99 each, or upgrade to … — $9.99/mo." under a CTA reading **Upgrade** |
| `expo/lib/taxonomy.ts:295` | "Publish this one for $0.99, or upgrade for more each month." |
| `expo/lib/allowance.ts:190` | "Additional listing: $0.99" (also `:149`, `:195`) |
| `expo/app/(tabs)/ai.tsx:176` | "publishing this basket needs a $0.99 extra publish" — this file *does* import the gate elsewhere, but this branch is ungated |
| `expo/lib/importReview.ts:165` | "publish extras for $0.99 each." |

`UpgradePromptCard` is the sharp one. It renders from
`expo/components/mygnome/MyMarketCard.tsx:98`, which renders from
`expo/app/(tabs)/activity.tsx:84` — **the Market tab**. An Android reviewer who
exhausts the free allowance is shown in-app pricing for a digital good on a
first-level tab, while the store declaration says In-app purchases: No.

This is the item that decides the submission date. It is a pure code fix with no
schema, no migration and no product decision attached.

### 9.2 Reviewer notes that misdescribe the product

**Verified.** `docs/release/GOOGLE_PLAY_PACKAGE.md:704-709` tells Google "This
version sells nothing." D1 preserved the $0.99 in product and backend; it is
live on web and iOS from the same `billing-checkout`. The corrected text is
already drafted at `PLAY_STORE_LISTING.md:733-741` and simply never moved into
the file that gets pasted into the console.

The iOS pair is worse. `APP_STORE_PACKAGE.md:457-461` and
`APP_STORE_PRIVACY.md:726` both assert there is no Stripe call path in the
binary. There is: `expo/lib/billing.ts:63` invokes `billing-checkout`, and
`purchaseOverage` is called from `post.tsx:253`, `ai.tsx:286`, `ai.tsx:422` and
`listing/[id].tsx:127` — all four **live on iOS**, since the gate is
`Platform.OS !== 'android'`. This also reopens the 3.1.1 analysis at
`APP_STORE_PACKAGE.md:474-512`, which was written assuming nothing is buyable.

### 9.3 The link-out path — real, open, but not the date-driver

Agent E called this the blocker that determines the submission date. **I do not
agree, and the difference is worth recording.**

The path is real and I verified every hop: `expo/app/settings.tsx:173,181,189`
opens the public legal pages, `web/app/layout.tsx:92` puts a global **Pricing**
link on every one of them, and `web/app/pricing/PricingCTA.tsx:60` invokes
`billing-checkout`.

Three facts move it off the critical path:

1. It is `Linking.openURL` — the **external browser**, not an in-app webview.
   That is the distinction Play's Payments policy actually turns on, and it is
   the same property every app has that links to its own homepage.
2. `billing_config.payments_live_enabled` is **false** (verified by SELECT on
   production, 2026-08-19). No live price exists on any platform. The checkout
   cannot complete a real purchase today.
3. §8.2 already records the open product question of whether `/pricing` should
   advertise plans nobody can buy — this is the same question, and it is
   Daniel's.

So: a path to close before live payments are ever enabled, not a reason to hold
the upload. Tracked, not blocking.

### 9.4 Verified corrections to stale text

- **`delivery_eligible` is dead.** `PLAY_STORE_LISTING.md:175-182` tells the
  reviewer a Free account "will not find a delivery setting." I grepped the
  whole repo: the column appears only in `0005_markets.sql:128,132`, two
  baseline dumps, and `expo/types/index.ts:101`. **Nothing reads it.** The real
  gate is `enforce_delivery_plan` (`0063_market_delivery_settings.sql:88-97`),
  which lets a free market deliver 15 miles for a flat fee. The note would send
  a reviewer looking in the wrong place.
- **Two competing full descriptions.** `GOOGLE_PLAY_PACKAGE.md:452-509` is
  pre-remodel, names a listing type the app does not ship ("Give away" — the
  shipped labels are in `expo/lib/listingType.ts:41-45`), and carries no
  superseded marker. Whoever fills the console can paste the wrong one.
- **Retired tier names survive** in `SUBSCRIPTION_POSTURE.md:39-42,444-448`
  ("Neighbor", "Grower"), `docs/MONETIZATION.md:11-12,71` (still a four-tier
  table with **MAX**, and it declares itself source-of-truth), and
  `docs/billing/STRIPE_LIVE_ACTIVATION.md:21` (calls the $29.99 SKU "Max" — the
  runbook Daniel would follow when creating the live Stripe product, so the
  wrong name would land on receipts).
- **"My Gnome" survives in five in-app strings** after D3:
  `(tabs)/activity.tsx:82`, `(tabs)/profile.tsx:82`, `(tabs)/post.tsx:350`,
  `listing/[id].tsx:403`, `lib/screening.ts:54`.

### 9.5 What the audit checked and found correct

`PLAY_STORE_LISTING.md` §1.1–§1.4 (name, short and full description, release
notes) — no tier name, no price, no annual, correct D3 tab labels, correct
listing-type labels. D5 is clean everywhere customer-facing: repo-wide, every
hit for "priority support" and "advanced analytics" is a doc *prohibiting* the
phrase. D4 is clean — no annual price in any customer surface.
`web/app/pricing/page.tsx` resolves from live `plan_limits` and matches 0126.
The account-deletion path is stated identically and correctly in all three
store docs. Migration 0126 asserts its own success, including a guard that
fails loudly if `display_name = 'Max'` survives.

---

## 10. The art is now the critical path

This was already recorded as a blocker in `PLAY_STORE_LISTING.md` §3.2. The
emulator run on 2026-08-19 turned it from a sampled-hex argument into something
you can look at, and added a second defect that recolouring alone would not fix.

**The identity flip could not reach the raster assets.** `constants/colors.ts`
re-skinned ~70 importers through one file, but `expo/assets/images/` was last
touched at `123b362`, long before `18e64cf`. So `icon.png`, `adaptive-icon.png`,
`splash-icon.png` and `badge.png` are all still the olive-green/cream artwork —
the exact identity the remodel exists to leave behind. `badge.png` is the
wordmark in the Browse header; `icon.png` is what the Play Store shows first.

**Three separate problems, and only one of them is colour:**

1. **Off-identity.** Dark-green figure on cream, with an olive field. The
   competitor-proximity problem that started the remodel.
2. **Mechanically wrong as an adaptive icon.** `adaptive-icon.png` is
   byte-identical to `icon.png` (md5 `7a1d3c50…`) — a full-bleed 1024×1024
   illustration used as an adaptive *foreground*. Android masks the foreground
   to its safe zone, so the gnome's hat is clipped and the banner is cut at both
   edges. On the emulator launcher it is the **only icon on the screen that is
   not a clean circle**; it sits among Gmail, Chrome and Maps looking broken
   rather than merely different. Recolouring the same art would not fix this —
   an adaptive foreground needs its subject inside the safe zone.
3. **Illegible at size.** "GNOME" is barely readable at launcher scale and
   "FARMERS MARKET" is unreadable mush. A detailed vegetable illustration cannot
   survive 48dp.

`app.json` also still sets `adaptiveIcon.backgroundColor` and
`splash.backgroundColor` to Parchment `#F6F2E9` — the last two dead-palette
hexes in the repo. `splash-icon.png` is on transparent ground, so it would sit
correctly on white once the artwork is replaced.

**And the feature graphic does not exist at all.** 1024 × 500, no alpha,
required — Play will not let you publish without it. A repo-wide search finds no
such asset.

**Why this changes the plan:** the icon, the adaptive foreground and the feature
graphic are all art, and the mascot direction is on hold pending Daniel's pick.
That makes the character decision the critical path to launch rather than a
parallel nicety — and it argues for treating the hero gnome, the icon and the
feature graphic as **one commission**, so the store, the launcher and the app
tell the same story.

### 10.1 Also found, not blocking — the map is blank for the first ~90 seconds on a cold device

On a cold-booted emulator the Map tab renders an empty grey box. It is not B1:
zero `API key not found`, zero authorization failures, the React instance alive
on the same PID throughout. `MapsInitializer` fell back to the **LEGACY**
renderer and Play services was still compiling `MapsDynamite.apk` 52 seconds
*after* the capture; once warm, tiles, pins and Google attribution all render
correctly.

The cause is that `components/MapListings.native.tsx` has no loading state — no
`onMapReady`, no placeholder, just `<MapView>` inside a `flex: 1` view, so the
container's background shows through until tiles paint. This matters because a
Play reviewer runs exactly this scenario: fresh install, cold device, first
open. Fix is an `onMapReady` overlay; it is additive and touches no MapView
prop, no provider and no marker. **Deliberately not done yet** — Map edits are
the highest-risk edits in this codebase, the AAB is held on art anyway, and
queuing it lets one Map regression cover both.
