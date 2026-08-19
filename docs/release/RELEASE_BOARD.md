# Gnome 1.1.0 — Android release board

The single place that says what is done, what is holding, and who is holding it.
Updated 2026-08-18 against `cdf1f58`.

Companion docs: `GOOGLE_PLAY_PACKAGE.md` (the standing audit — evidence for every
claim), `PLAY_STORE_LISTING.md` (store presentation), `../billing/STRIPE_LIVE_ACTIVATION.md`
(the conditions for ever taking real money).

---

## Board

| Blocker | Status | Owner | Next action |
|---|---|---|---|
| **B1** Google Maps | **CLOSED** | — | Re-verify after first upload with the Play signing SHA-1 (§3) |
| **B2** FCM push | **CONFIGURED / NOT PROVEN** | Daniel + Claude | Physical Android run (§2) |
| **B3** Deletion URL + contact | **CLOSED** | — | — |
| **B4** Purchase posture | Agent 1 reported | **Daniel decides** | Decision → code → final AAB |
| **§4.3b** Gemini data safety | Agent 2 reported | **Daniel decides** | Decision → Data safety form answers |
| Website ↔ app parity | Agent 3 | Claude reviews | Merge factual fixes; owner items to Daniel |
| Store assets | Agent 4 | Claude + Daniel | Capture screenshots from final RC |
| **Final AAB** | **HOLD** | Claude | Blocked on B4 — see §1 |
| **Play upload** | **HOLD** | Daniel | Blocked on final AAB |

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
