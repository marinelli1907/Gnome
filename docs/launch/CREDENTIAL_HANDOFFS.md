# Credential handoffs — Apple / Google / Push / App Store readiness

Audited 2026-08-10 on branch `release/compliance-ui-launch-hardening`. Every claim
below is grounded in the file cited next to it. Repo facts used throughout:

- **iOS bundle id / Android package:** `app.boonesystems.gnome` (`expo/app.json` → `ios.bundleIdentifier`, `android.package`)
- **URL scheme:** `gnome` (`expo/app.json` → `scheme`)
- **EAS projectId:** `b84fe5e3-5446-45dd-b078-9db076159143`, owner `marinelli1907` (`expo/app.json` → `extra.eas.projectId`, `owner`; `updates.url` points at the same project)
- **Supabase project:** `fgybyghwcjlstqxkclch` → auth callback `https://fgybyghwcjlstqxkclch.supabase.co/auth/v1/callback`
- **EAS builds exist, but not the final reviewed launch artifacts.** Older iOS
  builds and Android vc4 artifacts exist; `expo/eas.json` is still the source
  of truth for the next build config. The final AAB/IPA must be cut from the
  reviewed launch commit and inspected before submission.

> **Cross-cutting build config — resolved:** `expo/eas.json` now defines
> `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in every build
> profile. A cloud EAS build has the public Supabase client config baked in;
> still inspect the built app before submission, but the old unconfigured-binary
> blocker is closed.

---

## Section 1 — Sign in with Apple: CONFIG READY / REAL ROUND-TRIP PENDING

### Already in the repo (verified)
- [x] `expo-apple-authentication` `~8.0.8` in `expo/package.json` dependencies.
- [x] Config plugin listed: `"expo-apple-authentication"` in `expo/app.json` → `plugins`.
- [x] Capability flag: `expo/app.json` → `ios.usesAppleSignIn: true` (EAS will add the `com.apple.developer.applesignin` entitlement at build).
- [x] Auth wiring: `expo/providers/AuthProvider.tsx` → `signInWithApple()` — **native idToken flow**: `Crypto.randomUUID()` raw nonce → SHA-256 hash into `AppleAuthentication.signInAsync()` → `supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce: rawNonce })`. Also persists Apple's first-authorization full name to `profiles` (Apple only sends it once).
- [x] UI: `expo/app/sign-in.tsx` renders `AppleAuthentication.AppleAuthenticationButton` (iOS-only, gated on `isAvailableAsync()`), error path swallows `ERR_REQUEST_CANCELED`.
- [x] `expo/app/sign-in.tsx` no longer hardcodes provider visibility. It fetches
  `/auth/v1/settings`, renders Apple only when Supabase reports
  `"apple": true` and the native Apple sheet is available, and renders Google
  only when Supabase reports `"google": true`. The dashboard state still needs
  an owner verification before shipping, but a disabled provider no longer
  leaves a visible dead button in front of a reviewer.

### Which flow is wired
The app uses the **native `signInWithIdToken` flow**. For this flow the token's
audience is the **app bundle id** (`app.boonesystems.gnome`) — **no Services ID
and no .p8 secret key are required**. A Services ID + .p8 key are only needed for
the **web OAuth flow** (e.g. if gnomefarmersmarket.com ever adds an Apple button).
Note: `docs/BETA_PREP.md` §1 says "Services ID + key" — that guidance is for the
OAuth flow and is **not** what the current code needs; follow this doc instead.

### Apple Developer portal (owner, with the Apple Developer account)
1. developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → App ID `app.boonesystems.gnome` (create it if `eas build` hasn't yet) → check **Sign In with Apple** capability → Save. (If EAS manages provisioning, `eas build` will sync the capability from `usesAppleSignIn`, but checking it manually is harmless and unblocks the Supabase test order.)
2. Services ID: **skip** for now (native flow only). Create one later only if the web app adds Apple sign-in; that is also when a .p8 Sign in with Apple key would be generated (Keys → create → Sign in with Apple) and uploaded **directly into the Supabase dashboard, never into chat or the repo**.

### Supabase dashboard
Authentication → Providers → Apple:
- **Enable Sign in with Apple**: ON
- **Client IDs**: `app.boonesystems.gnome`  ← the bundle id; this is the field the native idToken flow validates against. (Comma-separate a Services ID here later if web Apple login is added.)
- **Secret Key (for OAuth)**: leave **empty** — only the web OAuth flow needs it.

### Code changes needed
None. `expo/providers/AuthProvider.tsx` and `expo/app/sign-in.tsx` are complete
for the native flow. (Optional hardening: replace the hardcoded `OAUTH_READY`
constant in `expo/app/sign-in.tsx` with a runtime check or config flag.)

### Test on a physical iPhone (must be a real build — Expo Go's bundle id `host.exp.Exponent` breaks the token audience)
1. `cd expo && eas build --profile preview --platform ios` → install via TestFlight/internal distribution on a physical iPhone.
2. Open the app → any signed-out surface → Sign in → confirm the black **Continue with Apple** button renders (it only renders when `isAvailableAsync()` is true, i.e. a real device build).
3. Tap it → Face ID sheet → choose "Share My Email" first time → confirm you land back signed in (modal dismisses via `router.back()`).
4. Verify a `profiles` row exists with your Apple name (first authorization only).
5. Sign out → sign in with Apple again → confirm it works with "Hide My Email" relay addresses too.
6. Failure modes: `Unacceptable audience in id_token` = Client IDs field ≠ bundle id; instant `Apple sign-in failed` alert with a server message = provider disabled in Supabase.

---

## Section 2 — Google Sign-In: CONFIG READY / REAL ROUND-TRIP PENDING

### Already in the repo (verified)
- [x] Flow: `expo/providers/AuthProvider.tsx` → `signInWithGoogle()` — **browser PKCE flow**, not a native SDK: `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } })` → `WebBrowser.openAuthSessionAsync(url, redirectTo)` → parse `?code=` → `supabase.auth.exchangeCodeForSession(code)`. `redirectTo = Linking.createURL('auth-callback')` → **`gnome://auth-callback`** in a standalone build.
- [x] PKCE enabled client-wide: `expo/lib/supabase.ts` → `flowType: 'pkce'`, `detectSessionInUrl: false`.
- [x] UI: custom "Continue with Google" button in `expo/app/sign-in.tsx` (gated on the same hardcoded `OAUTH_READY = true` — same caveat as Apple: confirm the provider is actually enabled).
- [x] **No native Google library is installed** — `@react-native-google-signin/google-signin` is NOT in `expo/package.json`. That is fine for the browser flow and means **no iOS OAuth client / reversed-client-id URL scheme is required**. Only document/install one if you later switch to the native one-tap SDK.

### Google Cloud Console (project "Gnome Farmers Market" per the code comment — verify it exists)
1. APIs & Services → OAuth consent screen: External, app name Gnome, support email, domain `gnomefarmersmarket.com`, publish (out of Testing mode, or Google limits to test users and shows the "unverified" screen).
2. APIs & Services → Credentials → Create Credentials → OAuth client ID → **Web application**:
   - Authorized redirect URI: `https://fgybyghwcjlstqxkclch.supabase.co/auth/v1/callback`
   - Copy the **Client ID** and **Client secret**.
3. iOS client ID: **not needed** for the current browser flow. (Required only for the native SDK, where it would carry bundle id `app.boonesystems.gnome`.)

### Supabase dashboard
- Authentication → Providers → Google: enable, paste the **web** Client ID + Client secret.
- Authentication → URL Configuration → **Redirect URLs**: add `gnome://auth-callback` (per `docs/BETA_PREP.md` §1 — without it the post-consent redirect is rejected and `openAuthSessionAsync` never resolves with a code). For dev-client testing also add the `exp+gnome://` / dev-server URL Expo prints, or just test on a preview build.

### App config changes
None required. The `gnome` scheme is already in `expo/app.json`; the browser flow
needs no `CFBundleURLTypes` additions beyond what Expo generates from `scheme`.

### Test on a physical iPhone (real build, same reason as Apple — `gnome://` doesn't resolve in Expo Go)
1. Install the preview build → Sign in → **Continue with Google**.
2. System auth session (ASWebAuthenticationSession sheet) opens → pick a Google account → confirm the sheet closes and you land back signed in.
3. Verify a `profiles` row + default market were created (the `on_auth_user_created` trigger path, same as email signup — comment in `AuthProvider.signInWithGoogle`).
4. Cancel path: dismiss the sheet → no error alert (code treats dismissal as non-error).
5. Failure modes: `redirect_uri_mismatch` page = Google client missing the Supabase callback URI; sheet closes but "Google sign-in did not return a code." = `gnome://auth-callback` missing from Supabase Redirect URLs.

**Status: do not claim verified.** No EAS build has ever run, so neither provider
has completed a real round-trip on a device.

---

## Section 3 — Physical iPhone push: CONFIG READY / DELIVERY VERIFIED PENDING

### Audit (all verified in-repo)
- [x] **Token registration:** `expo/lib/notifications.ts` → `registerForPushNotifications(userId)` — permission request → `getExpoPushTokenAsync({ projectId })` → upsert into `device_tokens` (`supabase/migrations/0002_push.sql`, RLS self-scoped). No-ops on web / simulator / unconfigured Supabase. Called from `expo/app/(tabs)/_layout.tsx` whenever `userId` is set.
- [x] **Logout unbinding:** `unregisterPushToken()` deletes the token row **before** `signOut({ scope: 'local' })` (`expo/providers/AuthProvider.tsx` → `signOut`) — required because the delete policy is scoped to `auth.uid()`.
- [x] **Account-switch rebinding:** the upsert uses `{ onConflict: 'token' }`, so the same device token re-points to whoever signs in next (`expo/lib/notifications.ts` comment documents this intent).
- [x] **Deep-link routing:** `expo/lib/useNotificationRouting.ts` (wired in `expo/app/_layout.tsx`, gated on fonts-loaded so cold-start taps aren't dropped). Payload → route map:
  - `{ event: 'approved', claimId }` → `/chat/[claimId]`
  - `{ event: 'message', claimId }` → `/chat/[claimId]`
  - `{ event: 'claim' }` → `/activity` (owner reviews the request there)
  - `{ event: 'wanted_matched', offerId }` → `/listing/[offerId]`
  All four target routes exist (`expo/app/chat/[claimId].tsx`, `expo/app/(tabs)/activity.tsx`, `expo/app/listing/[id].tsx`).
- [x] **Backend send path:** `supabase/functions/notify/index.ts` handles `claim` (push listing owner), `approved` (push claimer), `message` (push the other claim party — sender identity taken from the JWT, party membership enforced), `offer_created` (match active Wanted posts within 10 mi / 30 days, skip blocked pairs, log `wanted_matched` events, push wanted owners). Sends via `https://exp.host/--/api/v2/push/send`; recipient tokens read with the service role.
- [x] **EAS projectId configured:** `expo/app.json` → `extra.eas.projectId: "b84fe5e3-5446-45dd-b078-9db076159143"` — so `getExpoPushTokenAsync` will work in a build (both call sites pass it via `Constants`).
- [ ] **APNs credentials: nothing in-repo to verify (expected).** EAS manages them: the first `eas build` (or `eas credentials --platform ios`) prompts to generate/upload the APNs key against the owner's Apple Developer account. Push cannot be tested until that build exists.
- [i] Minor gaps (non-blocking): `notify` never checks Expo push **receipts**, so dead tokens are never pruned; and the `claim`/`approved` branch doesn't verify the caller is a party to the claim (any authenticated user could trigger a push for an arbitrary claimId — `verify_jwt` limits this to signed-in users; tighten later like the `message` branch).

### Physical-device test script (two iPhones or one iPhone + simulator for B; A must be physical)
1. Install a fresh EAS build (preview profile) on physical iPhone A.
2. Log in as User A.
3. Accept the notification permission prompt (fires on first signed-in tab mount).
4. As User B (second device or web), claim one of A's listings.
5. A receives the "New claim 🍅" push.
6. Tap it → app opens on **My Gnome / Activity** (`/activity`) showing the request.
7. Approve the request as A.
8. B receives the "Claim approved ✅" push (tap → pickup chat).
9. Send a chat message from B.
10. A receives the "New message about your Gnome pickup" push with the body preview; tap → `/chat/[claimId]`.
11. Log out of A on the physical iPhone (this must delete the `device_tokens` row — verify the table).
12. Log in as User C on the same iPhone (token rebinds to C via the onConflict upsert).
13. Trigger another event for A (e.g. B messages A's claim) → confirm the physical iPhone gets **no** push for A; C's events do arrive.

---

## Section 4 — iOS App Store readiness blocker audit

| Requirement | Status | Evidence |
|---|---|---|
| Account deletion (5.1.1(v)) | PRESENT | `supabase/functions/delete-account/index.ts` (JWT-authenticated, full cascade incl. storage buckets + `auth.admin.deleteUser`); exposed in `expo/app/settings.tsx` — "Delete my account" with two-step destructive confirm |
| Password reset | PRESENT, **round-trip unverified on device** | `expo/app/sign-in.tsx` `forgot`/`reset` modes; `AuthProvider.requestPasswordReset` sends `redirectTo: gnome://auth-callback`. `expo/providers/AuthProvider.tsx` now consumes both cold-start `getInitialURL()` and warm `url` events, parses `?code=`, and calls `supabase.auth.exchangeCodeForSession(code)`, which should fire `PASSWORD_RECOVERY` and show "Set a new password." Device-test the full email round trip before submission. |
| Terms / Privacy links | PRESENT | `expo/app/settings.tsx` (Terms, Privacy, Trust & Safety → gnomefarmersmarket.com/{terms,privacy,trust}); `expo/app/sign-in.tsx` legal row ("By continuing you agree…") |
| Support contact | PRESENT | Settings has in-app feedback (`settings.tsx` → `useSendFeedback` → `feedback` table, `supabase/migrations/0017_feedback.sql`) and a `mailto:daniel@boonesystems.com?subject=Gnome%20support` support link. The web Privacy, Terms, and Delete Account pages use the same deliverable address. App Store Connect still needs a **Support URL** at submission — use `https://gnomefarmersmarket.com` unless a dedicated `/support` page is added. |
| Permission strings | COMPLETE for what the app uses | `expo/app.json` `ios.infoPlist`: `NSLocationWhenInUseUsageDescription`, `NSPhotoLibraryUsageDescription`, `ITSAppUsesNonExemptEncryption: false`. Camera is never invoked; all photo paths use the library picker. iOS needs no usage string for notifications. Nothing missing. |
| UGC moderation (1.2) | PRESENT | Report: `expo/lib/db.ts` `useReport` → `reports` table (`0013_trust_layer.sql`), surfaced in `expo/app/listing/[id].tsx`, `expo/app/market/[id].tsx`, `expo/app/chat/[claimId].tsx`. Block: `useBlockUser` (listing + market pages), unblock management in `settings.tsx`; blocks also silence match pushes (`notify/index.ts`). Admin side: `0024_admin_moderation.sql`, `web/app/admin`. |
| Demo-content labeling | PRESENT | `is_demo` (`0023_demo_labeling.sql`): "Preview" tag on `expo/components/ListingCard.tsx:86`; full "Preview listing — sample content…" note on `expo/app/listing/[id].tsx:193` |
| Broken routes | NONE FOUND | Every `router.push`/`replace` target in `expo/app` + `expo/components` maps to an existing route (`/sign-in`, `/post`, `/listing/[id]`, `/activity`, `/chat/[claimId]`, `/promote/[listingId]`, `/market/[id]`, `/market/edit/[id]`, `/upgrade`, `/garden`, `/profile/edit`, `/request/[listingId]`, `/settings`, `/edit-listing/[id]`); `+not-found.tsx` exists |
| Leftover dev strings | CLEAN | Across `expo/{app,components,lib,providers,constants,types,scripts}`: `TODO`/`FIXME`: **0**; `console.log`: **0** (one intentional `console.warn` in `lib/notifications.ts:48`); `localhost`: **0**; "placeholder" hits are benign (Supabase fallback URL in `lib/supabase.ts`, a skeleton-component comment, `placeholderTextColor` props) |
| Subscriptions / IAP (3.1.1) | NO PLAN-PURCHASE CONFLICT TODAY — iOS overage disclosed | The app contains no plan-subscription purchase button and no external link to `/pricing` or Stripe. `expo/app/upgrade.tsx` is now a "Your plan" information screen with no plan prices; `UpgradePromptCard` opens that screen with "See plans"; `expo/app/promote/[listingId].tsx` redeems included or previously granted promotion credits and otherwise states that extra promotions are not sold in the app. iOS can still open Stripe checkout for the $0.99 publish/renewal overage path; `APP_STORE_PACKAGE.md` §6 records the deliberate 3.1.1 risk posture and Review Notes disclosure. |

### REMAINING BLOCKERS (must be resolved before App Store submission)
1. **Confirm Apple + Google providers are actually enabled in Supabase** — `expo/app/sign-in.tsx` now hides disabled providers based on `/auth/v1/settings`, but reviewer coverage still requires the owner to verify Apple and Google are enabled before shipping.
2. **Add `gnome://auth-callback` to Supabase Auth → URL Configuration → Redirect URLs** — Google sign-in and the password-reset email both redirect there.
3. **Password-reset deep link round trip** — code now consumes `gnome://auth-callback`, but the email-link flow still needs a device test after the Supabase redirect allowlist is confirmed.
4. **Run the final reviewed EAS build and confirm APNs credentials**
   (`eas credentials` / `eas build --platform ios` as needed), then execute the
   13-step push script (Section 3) and both OAuth round-trips (Sections 1–2) on
   a physical iPhone. Nothing push- or OAuth-related has been proven on a final
   reviewed device build.
5. **App Store Connect metadata** — Support URL (`https://gnomefarmersmarket.com`), Privacy Policy URL (`/privacy`), App Privacy questionnaire (collects: email, name, coarse location of listings, user content, device push tokens), age rating. Metadata-only; no code.

### NON-BLOCKERS (fine as-is)
1. Camera remains unused and omitted from the generated permission surface.
2. `notify` doesn't check Expo push receipts / prune dead tokens — cleanup, not launch-gating.
3. `notify` `claim`/`approved` branch trusts any authenticated caller's `claimId` (push-spam vector, gated by `verify_jwt`) — tighten post-launch like the `message` branch.
4. Single intentional `console.warn` in `expo/lib/notifications.ts`.
5. Demo-content labeling, UGC moderation, account deletion, support contact, Terms/Privacy links — all present and correctly wired.
