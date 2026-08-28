# Gnome unified paid subscriptions

Status: backend deployed and release binaries uploaded for internal processing;
provider credentials and end-to-end sandbox billing remain incomplete. Payments
are not live and neither store has been submitted for public review.

## Verification checkpoint - 2026-08-25

- Production migration `20260825204308_unified_native_subscriptions.sql` is
  applied. `subscription-sync`, `subscription-webhook`, `billing-checkout`,
  `stripe-webhook`, and `boardroom` are deployed with the intended JWT posture.
  The PG17 clean-room suite, concurrent replay check, provider unit tests, and
  Expo TypeScript check pass.
- Android release artifact
  `artifacts/android/gnome-1.1.0-vc15-release.aab` is 33 MB with SHA-256
  `38b936e4c0ed9ef5fbc0b4eea4b427b6e8d5774c0eeadc4ce49d2d0a5e62d159`.
  It identifies as `app.boonesystems.gnome`, version `1.1.0` / versionCode 15,
  includes Google Play Billing and Maps metadata, and uses the expected upload
  certificate SHA-1 `DA:F1:79:50:49:38:5F:41:DA:E0:37:C4:EB:06:D4:B1:20:75:0C:13`.
  It is saved in the Google Play Internal Testing draft only; versionCode 14 was
  removed from that draft. No rollout was started.
- Android versionCode 15 was installed on `gnome_rc`. Browse launched and Map
  rendered tiles, pins, Google attribution, marker cards, pan, and zoom. Logcat
  contained no `API key not found`, authorization failure,
  `getOrCreateDestroyTask`, `Unhandled SoftException`, `harvest_date`, or fatal
  exception signatures.
- iOS release `1.1.0` build 17 completed under Xcode 26.6. The IPA is
  `artifacts/billing/Gnome-1.1.0-build17.ipa`, SHA-256
  `240f6f31c71aa234480388013eff9caef2463af50afa083fc870dca92b028faf`.
  Its signature and Boone Systems team identity verify, and a Release simulator
  build launched successfully. Build 17 was uploaded to App Store Connect; it
  has not been selected for review or submitted publicly.
- Google Play products `gnome.pro.monthly` and `gnome.farm.monthly` are active
  in the console with monthly base plans, and Pro has the `founding3`
  developer-determined eligibility offer. Apple products and offer configuration
  remain blocked on App Store Connect account access.
- Apple and Google provider verification credentials/notifications are not yet
  configured. Apple sandbox and Google license-test purchase lifecycle proof is
  therefore unverified. `payments_live_enabled` remains false, Stripe remains
  TEST, and no public store submission occurred.

## Commercial contract

| Public plan | Database plan | Monthly price | Apple product | Google product | Web product |
|---|---|---:|---|---|---|
| Free | `free` | $0 | - | - | - |
| Pro | `grower` | $9.99 | `gnome.pro.monthly` | `gnome.pro.monthly` | `GNOME_GROWER_MONTHLY` |
| Farm | `farm` | $29.99 | `gnome.farm.monthly` | `gnome.farm.monthly` | `GNOME_FARM_MONTHLY` |

Apple and Google must each have one monthly base plan for Pro and Farm. Do not
create a second product if either identifier already exists. `FOUNDING3` is a
provider-native three-month Pro introductory offer: StoreKit decides Apple
eligibility; Google Play must return a three-cycle zero-price monthly offer;
Stripe TEST uses the existing repeating 100 percent promotion. The confirmation
sheet is authoritative. Complimentary and referral entitlements remain separate,
require no card, create no provider subscription, and never auto-convert.

Physical marketplace payments are outside this subsystem. Reservations, pickup,
cash/external payment preferences, seller ledgers, and marketplace refund records
are unchanged.

## Entitlement authority

`market_subscriptions` is the provider-neutral verified ledger. Apple, Google,
and Stripe events are normalized to `pending`, `active`, `trialing`,
`grace_period`, `billing_retry`, `canceled`, `expired`, `revoked`, `refunded`,
or another fail-closed terminal state. The client cannot call the mutation RPC.

`record_verified_subscription` is service-role only. It claims a unique provider
event before mutation, binds a purchase to one Gnome user, rejects production
transactions while `payments_live_enabled=false`, and reconciles the Market plan.
Pending, billing-retry, paused, expired, revoked, and refunded records do not grant
access. A canceled subscription retains access only through its verified end date.

`market_effective_plan` selects the highest current verified paid plan and lets an
active complimentary grant win only when it is higher. Expiring a complimentary
grant reveals the legitimate paid entitlement beneath it. Provider history with no
current access resolves to Free, never to a stale Market plan.

## Provider operations

- Apple: StoreKit 2 purchase/restore, App Store Server API verification, signed
  App Store Server Notifications V2, Apple subscription-management and refund flow.
- Google: Play Billing purchase/restore, Android Publisher subscriptions v2,
  authenticated Pub/Sub RTDN, Google Play subscription-management and refund flow.
- Stripe: website Checkout and Customer Portal, signed Stripe webhooks, TEST mode
  until the global owner gate is approved.

The app refuses to start a second-provider checkout when it sees active paid access.
The backend independently refuses a website checkout when Apple/Google access is
active. Admin flags any historical multi-provider overlap so support can direct the
customer to the billing provider that charged them.

Admin and Boardroom count production paying subscriptions separately from trials,
sandbox/license-test subscriptions, and complimentary access. Gross monthly value
is an estimate; net revenue remains unavailable until provider settlements, taxes,
fees, and refunds are reconciled.

## Server configuration

Secret names only; values belong in the deployment secret manager:

- `APPLE_IAP_ISSUER_ID`
- `APPLE_IAP_KEY_ID`
- `APPLE_IAP_PRIVATE_KEY`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`
- `GOOGLE_PLAY_PUBSUB_AUDIENCE`
- `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT`

`subscription-sync` uses normal Supabase JWT verification. `subscription-webhook`
must be deployed without Supabase JWT enforcement because it validates Apple JWS or
Google Pub/Sub JWT itself. Apple notifications point to that function. Google RTDN
uses a dedicated Pub/Sub push service account, audience, and subscription topic.

## Deployment record

Completed within the approved deployment boundary:

1. Applied only `20260825204308_unified_native_subscriptions.sql`.
2. Deployed only `subscription-sync`, `subscription-webhook`, `billing-checkout`,
   `stripe-webhook`, and `boardroom` from the reviewed source.
3. Uploaded iOS build 17 and saved Android versionCode 15 as an Internal Testing
   draft. Neither release was submitted publicly.

Impact: additive provider tables and columns, provider-aware entitlement resolver,
native purchase UI, website duplicate-provider guard, and read-only Admin reporting.
No production charge can be created while the gate remains false.

Rollback: turn off purchase presentation by withholding the new binaries/web build;
leave verified provider history intact; redeploy the prior functions. Do not drop
subscription history. If reconciliation must be paused, keep the global gate false
and remove provider notification delivery while fixing forward.

## Required evidence before activation

- Read-only App Store Connect and Play Console audit confirms no duplicate products.
- Apple sandbox and Google license-test purchase, restore, renewal, cancel, expiry,
  grace/pending, upgrade, downgrade, account mismatch, and webhook replay pass.
- Stripe TEST purchase, portal, change, cancellation, refund, and replay pass.
- `FOUNDING3` shows `$0 today`, three months Pro, then `$9.99/month unless canceled`
  wherever the provider confirms eligibility.
- Admin displays provider, state, renewal/end date, test versus production, and
  provider-specific refund guidance without exposing tokens or credentials.
- Owner approves a later, separate activation action. Until then
  `payments_live_enabled=false`; no store submission or public billing activation.
