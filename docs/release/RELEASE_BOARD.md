# Gnome 1.1.0 — Android release board

The single place that says what is done, what is holding, and who is holding it.
Updated 2026-08-20 against `727abba` plus the current working tree.

Companion docs: `GOOGLE_PLAY_PACKAGE.md` (the standing audit — evidence for every
claim), `PLAY_STORE_LISTING.md` (store presentation), `../billing/STRIPE_LIVE_ACTIVATION.md`
(the conditions for ever taking real money), and `../ops/SELLER_CONCIERGE.md`
(claim state, disposable QA retention, and approval-gated cleanup).

---

## Board

| Blocker | Status | Owner | Next action |
|---|---|---|---|
| **B1** Google Maps | **CLOSED — re-verified 2026-08-19** | — | Re-verify after first upload with the Play signing SHA-1 (§3) |
| **B2** FCM push | **CONFIGURED / NOT PROVEN** | Daniel + Claude | Physical Android run (§2) |
| **B3** Deletion URL + contact | **CLOSED** | — | — |
| **B4** Purchase posture | **DECIDED — D1** | — | Gate shipped (`ffb2d28`); Android copy leaks fixed in working tree, see §9 |
| **§4.3b** Gemini data safety | **OWNER ACTION** | **Daniel** | See `GEMINI_DATA_SAFETY_DECISION.md`: paid Gemini key, or declare Shared = Yes |
| Website ↔ app parity | **CLOSED** (3 fixes, `90b7c36`) | — | Live web re-probed 2026-08-20; two owner items in §8 |
| `/pricing` test-mode redirect | **DEPLOYED / VERIFIED** (`9945b24`) | — | Live `/pricing` re-probed 2026-08-20 |
| **App icon + feature graphic** | **FIXED IN WORKING TREE** | — | §10 — generated + mechanically verified |
| **D1 copy leaks** | **FIXED IN WORKING TREE** | — | §9.1 — gated copy + focused tests |
| Reviewer notes (Play + iOS) | **FIXED IN WORKING TREE** | — | §9.2 — Play/iOS notes match code; iOS overage ships with explicit 3.1.1 risk disclosure |
| iOS priced dead-end purchase copy | **FIXED IN WORKING TREE** | — | `/upgrade` is informational; no priced "coming soon" promotion/plan buttons |
| Store assets | **DRAFTED** (`8714ca4`) | Claude + Daniel | Screenshots from the final RC |
| **Final AAB** | **READY AFTER REVIEW** | Claude | Cut from this working tree once committed; B2 still needs physical proof after build |
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

1. **Gating the $0.99 surface on Android did not by itself close B4.** The app
   opens `gnomefarmersmarket.com/terms`, `/privacy` and `/trust`
   (`expo/app/settings.tsx:173,181,189` and `expo/app/sign-in.tsx:371,375`), and
   every one of those live pages carries a nav link to `/pricing`, whose
   old upgrade buttons used to run `billing-checkout` straight into Stripe. That
   path is now handled by D1 plus the `/pricing` test-mode fix and Android-safe
   copy in §9.1.
2. **`/pricing` was silently sending real visitors into a test-mode Stripe
   page.** Fixed in `9945b24` — see §8. This was live on production, and is a
   defect rather than a policy question.

**Rule for the remaining HOLD:** build the final AAB once, from the reviewed
commit that carries the D1 copy fixes, 0126 pricing cleanup, reviewer-note fixes
and identity-v4 assets. A rebuild after upload costs a versionCode and a review
cycle.

---

## 1. The build path, and the gap in the current artifacts

Android identity is settled and verified in the merged manifest of a real build:

| Item | Value |
|---|---|
| Package | `app.boonesystems.gnome` |
| Version | `1.1.0` |
| versionCode | remote + autoIncrement (last: vc4) |
| Signing | EAS-managed upload keystore; Play App Signing at upload |
| Maps key | `EXPO_ANDROID_GOOGLE_MAPS_API_KEY` injects `android.config.googleMaps.apiKey` at build time. **Restricted 2026-08-20** to Android apps / `app.boonesystems.gnome` with BOTH the EAS upload SHA-1 `DA:F1:79:50:…:0C:13` and the Play App Signing SHA-1 `3F:2D:F0:FF:…:02:67`. Until that date this row claimed a restriction that did not exist — Application restrictions were `None` and the table was empty, while the key shipped inside the AAB |
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
1. `eas build:view <id>` → `gitCommitHash` is the reviewed final launch commit
2. versionCode is higher than every prior upload
3. The AAB's merged manifest contains `com.google.android.geo.API_KEY` and
   `ExpoFirebaseMessagingService` (unzip the AAB or install the paired APK)

Local tooling status as of 2026-08-20:

- `cd expo && npx expo-doctor` passes all 18 checks after lockfile-only Expo SDK
  54 patch updates.
- `npm audit --omit=dev --audit-level=high` still reports Expo/Metro tooling
  advisories whose automated fix requires a forced Expo 57 upgrade. That is not
  a launch-RC fix because the customer app is pinned to SDK 54 and the admin app
  is the separate SDK 57 surface.
- EAS CLI is installed and authenticated, and the remote Android versionCode is
  currently 4. The final AAB should still be cut only from the reviewed commit,
  not from this dirty working tree.

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

1. **§4.3b decision** — Gemini tier / data-safety declaration (paid Gemini key,
   or declare Shared = Yes)
2. **B2 physical run** — §2 above; needs an Android phone
3. **Rebuilt-device checks** — launcher icon, splash, Browse badge, and Map
   regression after the final AAB/APK is cut
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

**Verified in production before planning the pre-0126 four-tier -> Free/Pro/Farm
migration** (13 markets, so this was checked exhaustively rather than sampled):

| Check | Result |
|---|---|
| `market_subscriptions` rows, ever | **0** |
| `admin_plan_grants` rows, ever | **0** |
| Markets on `farm` (= pre-0126 Max tier) | **0** |
| Markets on `sponsor` (= pre-0126 Farm tier) | **0** |
| Only non-free market | `Maria G.'s Market` on `grower`, with no subscription backing it |
| Paid publishes ever / authorizations consumed | 2 / 2 — both from §13 QA |

**No one has ever held a paid subscription on Gnome.** Removing Max therefore
migrates zero customers, and there is no production subscription state that a
tier change could damage. This is a pre-customer rename, not a data migration.

Two things that did NOT make trivial, so they stayed in scope: the **code** work
was unchanged (entitlement checks in SQL and in both clients, `plan_limits`,
pricing UI, Stripe product objects), and the pre-0126 **naming trap** meant a
plan that read the enum literally would restructure the wrong tier. Post-0126,
`farm` is customer-facing Farm and `sponsor` is retired Legacy Farm.

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
a Photos/chat question: the welcome conversation can include the neighbour's
real first and last name, and city/county/state travel with assistant and
planner requests. Working-tree hardening now redacts email/phone in onboarding
and street-address/coordinate shapes in Garden Planner location/turns, but it
does not remove user-volunteered names from arbitrary chat.

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

Repo-side mitigation landed in the working tree: Garden Planner no longer sends
street addresses or exact coordinates from its location field to Gemini, and
planner turns redact street-address/coordinate shapes before prompt assembly.
The mobile Garden Planner analytics event also drops the free-text question and
logs only `chars` and `has_photo`. This reduces the declaration to approximate
location for that surface and keeps `events` analytics-only; it does not remove
the owner decision above because free-tier Gemini still processes submitted AI
content for Google's own product-improvement purposes.

## 8. Owner items surfaced by the sprint (not blockers)

1. **Paid AI fallback disclosure.** Repo guard added in working tree:
   `_shared/providers.ts` hides OpenAI/Anthropic keys unless
   `AI_PAID_FALLBACK_DISCLOSED=true`, so flipping
   `ai_settings.allow_paid_fallback` alone can no longer falsify the public
   privacy policy's Gemini-only claim. Enabling paid fallback later still
   requires a privacy-policy update and that env flag.
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

### 9.1 D1 copy leaks — fixed in working tree

**Fixed in working tree.** `expo/lib/digitalPurchase.ts` already gated the three
*checkout* call sites correctly; this pass gates the customer-facing strings
that Android users could still see.

| File | Fix |
|---|---|
| `expo/components/UpgradePromptCard.tsx` | Imports `canBuyDigitalInApp`; Android copy starts at upgrade, not "$0.99 each". |
| `expo/components/mygnome/MyMarketCard.tsx` | Passes `{ canBuyExtras: canBuyDigitalInApp }` into allowance meters/hints. |
| `expo/app/upgrade.tsx` | Android renewal/overage plan copy no longer names the extra-purchase price. |
| `expo/app/import.tsx` + `expo/lib/importReview.ts` | Import result allowance summary can suppress extra-publish pricing on Android; web/Expo twin remains byte-identical. |
| `expo/app/(tabs)/ai.tsx` | Bundle and renewal payment-needed chat branches use Android-safe copy before the existing gated card/button. |
| `expo/app/market/bundles.tsx` | Removed the Android-visible web/Stripe workaround copy. |
| `expo/lib/taxonomy.ts` | Bare-token fallback for `PUBLISH_ALLOWANCE_EXHAUSTED` follows the same gate. |

Verification: `node web/lib/allowance.test.mjs` (31/31), `node
expo/lib/allowance.test.mjs` (34/34), `node web/lib/importReview.test.mjs`
(32/32), `npm run typecheck` in `expo/`, `npm run typecheck` in `web/`, and
`git diff --check` all pass. No Map file changed. The worktree still carries
pre-existing dirty migration/temp files; they are outside this launch-copy pass
and were not cleaned, reverted or staged.

### 9.2 Reviewer notes that misdescribe the product

**Fixed in working tree.** `docs/release/GOOGLE_PLAY_PACKAGE.md` now says
"No purchases on Android" and explains that Android shows plan comparison, not
an overage purchase, when allowance is exhausted.

The iOS pair no longer asserts "no Stripe call path." `APP_STORE_PACKAGE.md`
and `APP_STORE_PRIVACY.md` now state the actual posture: no StoreKit products or
subscriptions are configured, but `expo/lib/billing.ts` can open
`billing-checkout` for the $0.99 publish/renewal overage path on iOS/web.

What remains is not a hidden reviewer-note bug; the launch posture is to submit
with a deliberate 3.1.1 risk explanation. Current official Apple Guideline 3.1.1
still requires IAP for unlocking app functionality, while 3.1.1(a) and US
storefront rules add external-link nuance.

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

- **Delivery reviewer note fixed in working tree.** `PLAY_STORE_LISTING.md` and
  `GOOGLE_PLAY_PACKAGE.md` now describe the real gate: Free Markets can offer
  delivery up to 15 miles with one flat fee; paid plans add advanced controls.
- **Duplicate Play description fixed in working tree.** `GOOGLE_PLAY_PACKAGE.md`
  now uses the current paste-ready Play description, including "Share Free" and
  D3 tab names, instead of the pre-remodel duplicate.
- **Retired tier docs fixed in working tree.** `docs/MONETIZATION.md` now
  describes the 0126 Free/Pro/Farm ladder and Legacy Farm retirement;
  `docs/billing/STRIPE_LIVE_ACTIVATION.md` calls `GNOME_FARM_MONTHLY`
  customer-facing Farm and keeps `GNOME_SPONSOR_MONTHLY` inactive; the old
  `SUBSCRIPTION_POSTURE.md` is marked superseded for launch rather than
  silently edited as if it were freshly audited.
- **"My Gnome" user-facing strings fixed in working tree.** The five §9.4
  surfaces now say Market; the `activity` route and internal component/comment
  names are intentionally untouched for D3 compatibility.
- **Launch packet stale-status cleanup fixed in working tree.** The Play package
  now says Maps and Firebase are configured but need rebuilt/device proof, the
  Play listing checklist marks the Android D1 copy fixes complete, and the App
  Store privacy packet treats OpenStreetMap as disclosed with proxying tracked
  post-launch. `APP_STORE_PACKAGE.md` §5 is also reconciled to the App Privacy
  source of truth: marketplace order records are **Purchase History = Yes**,
  while **Payment Info = No** remains correct.
- **Support URL fixed in working tree.** `web/app/support/page.tsx` adds a
  public support page with contact, account deletion, order, safety-report, AI
  and policy guidance, linked from the footer, mobile menu and sitemap. App
  Store metadata now uses
  `https://gnomefarmersmarket.com/support`; deploy the web change before pasting
  that Support URL.
- **Legal audit stale-status cleanup fixed in working tree.** G9/G10 now point
  at the current privacy policy disclosures for Expo push, Stripe, Google and
  OpenStreetMap; G7 now matches the iOS overage risk posture in
  `APP_STORE_PACKAGE.md` §6 instead of preserving the old no-mobile-purchase
  assumption.
- **Legacy launch runbook stale-status cleanup fixed in working tree.**
  `docs/LAUNCH.md` is marked superseded for the 1.1.0 store launch and no longer
  says Google/Apple providers are disabled. A 2026-08-20 app-shaped
  `/auth/v1/settings` probe (with the public Supabase anon header, not printed)
  returned Google `true`, Apple `true`, `mailer_autoconfirm=true`, and
  `disable_signup=false`.
- **Final stale-artifact pass fixed in working tree.** `APP_STORE_PACKAGE.md`
  and `GOOGLE_PLAY_PACKAGE.md` no longer say Android has never been built; they
  distinguish older Android `versionCode` 4 artifacts from the missing final
  reviewed Play-bound AAB. `docs/LAUNCH.md` no longer preserves the old Payment
  Link switch-on runbook as current instructions. The AI tab also has a
  defensive Android guard before `purchaseOverage`, and the web Ask Gnome prompt
  says paid checkout is Stripe-managed only when checkout is enabled.

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

Additional local verification on 2026-08-20:

- Re-run after the final stale-artifact pass: `npm run typecheck` in `expo` and
  `web`; `node expo/lib/allowance.test.mjs` 34/34; `node web/lib/allowance.test.mjs`
  31/31; `node web/lib/importReview.test.mjs` 32/32; `node expo/lib/billing.test.mjs`
  11/11; `node supabase/scripts/stripe_setup.test.mjs` 24/24; `node
  supabase/tests/ai_privacy.test.mjs` 19/19; `supabase/tests/run_edge_typecheck.sh`
  6 passed, 5 skipped, 3 known-failing, 0 new failures.
- Garden Planner privacy hardening re-run: `node --test
  supabase/tests/garden_planner_privacy.test.mjs` 9/9; `npm run typecheck` in
  `expo`; `node supabase/tests/ai_privacy.test.mjs` 19/19;
  `supabase/tests/run_edge_typecheck.sh` still 6 passed, 5 skipped, 3
  known-failing, 0 new failures. Direct `deno check
  supabase/functions/garden-planner/index.ts` is not usable locally because
  `providers.ts` is bundled at deploy and absent from the function directory.
- AI provider disclosure guard: `node --test
  supabase/tests/ai_provider_disclosure.test.mjs` 3/3 and `npm run typecheck`
  in `web` pass. `_shared/providers.ts` now requires
  `AI_PAID_FALLBACK_DISCLOSED=true` before OpenAI/Anthropic keys are exposed to
  any AI edge function.
- Current dirty-tree package gates: `npm run build` in `web` passed; `npm run
  lint` in `expo` exits 0 after the Garden Planner copy escape fix, with 19
  pre-existing warnings still reported; `npm run typecheck` in `expo` passed.
- Support route verification: `npm run build` in `web` passed and listed
  `/support` as a static route; re-run `npm run typecheck` in `web` passed after
  the build completed. Standalone local smoke (`PORT=3038 HOSTNAME=127.0.0.1
  node .next/standalone/server.js`) returned HTTP 200 for `/support` and
  confirmed `/support`, `/delete-account`, `/privacy` and `/terms` in
  `/sitemap.xml`.
- `node expo/lib/billing.test.mjs` — 11/11 passed.
- `node web/lib/marketQr.test.mjs` — 5/5 passed.
- `node supabase/tests/ai_privacy.test.mjs` — 19/19 passed.
- `node supabase/tests/listing_draft_schema.test.mjs` — 26/26 passed.
- `node supabase/tests/market_actions.test.mjs` — 58/58 passed.
- `node supabase/tests/market_import_schema.test.mjs` — 27/27 passed.
- `supabase/tests/run_edge_typecheck.sh` — 6 passed, 5 skipped for deploy-time
  bundled `providers.ts`, 3 known-failing, 0 new failures.
- AGENTS money suites: `payment_hardening` 34/34, `renew_window` 24/24,
  `listing_allowance` 38/38, `lifecycle_guard` 9/9, `seed_drop_off` all passed.

---

## 10. Store and launcher art — fixed in working tree

This was the critical path; it is now a working-tree fix. The old
dark-green/cream raster set has been replaced with an identity-v4 interim mark
that uses a red-hat Gnome mascot, white canvas, charcoal outline and the five
semantic hues in the basket. Final commissioned character art can fast-follow,
but Play no longer lacks required graphics.

Generated / updated:
- `expo/assets/images/gnome-mark.svg` — source mark.
- `expo/assets/images/icon.png` — 1024 × 1024 RGBA.
- `expo/assets/images/adaptive-icon.png` — 1024 × 1024 RGBA, padded foreground.
- `expo/assets/images/splash-icon.png` — 512 × 512 RGBA.
- `expo/assets/images/badge.png` — 192 × 192 RGBA.
- `expo/assets/images/favicon.png` — 16 × 16 RGBA.
- `docs/release/play-icon-512.png` — 512 × 512 RGBA, 57 KB.
- `docs/release/play-feature-graphic.png` — 1024 × 500 RGB/no alpha, 49 KB.

`app.json` now sets both `android.adaptiveIcon.backgroundColor` and
`splash.backgroundColor` to `#FFFFFF`.

Verification: `sips` confirmed dimensions and alpha/no-alpha state; `file`
confirmed PNG color model; visual inspection was done for app icon, adaptive
foreground and feature graphic. A rebuilt-device launcher/splash check and Map
regression still need to happen with the final AAB because `app.json` changed.

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
