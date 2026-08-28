# GNOME FINAL P0 PROOF

Checked: 2026-08-24
Production project: `fgybyghwcjlstqxkclch`
Proposed migration: `supabase/migrations/20260824204821_p0_account_readiness_gates.sql`
Production writes performed: **none**
Store submissions performed: **none**

Status terms in this report:

- **PASS**: directly exercised and observed.
- **STRUCTURAL PASS**: source, schema, or packaged artifact was verified, but a live external flow was not completed.
- **UNPROVEN**: the required environment or account was unavailable. This is not a pass.
- **FAIL**: the required behavior was exercised and did not meet the gate.

## SUPABASE

- **Docker/Colima:** PASS. Colima was safely started with a new/default 4 CPU, 8 GiB, 40 GiB Docker profile. Docker Server 29.5.2 is running. No prune, reset, or volume deletion was performed.
- **PG17 clean-room:** PASS on PostgreSQL 17.11. The repeatable runner restores the canonical production baseline, restores non-public Storage policy objects omitted by the public schema dump, seeds required reference data, then applies 0126, 0127, claim reservations, Zordy quota, restricted-draft verification, harvest date, and P0 in order.
- **Migration:** PASS locally. The P0 migration applies without missing dependencies and is now explicitly wrapped in `BEGIN`/`COMMIT` so a failed apply is atomic.
- **Historical migration repair:** local `0076_complimentary_grants.sql` contained prose instead of SQL. Its exact applied body was recovered read-only from `supabase_migrations.schema_migrations`. No production object was changed.
- **RLS:** PASS for the P0 scope. Own-only policy acceptance, private pickup, seller credential, compliance admin, and private Storage cases passed.
- **Grants:** PASS for the P0 scope. Anonymous access to private acceptance and pickup RPCs is denied; authenticated users cannot call cross-user readiness helpers or reserve Zordy quota directly; required service-role paths remain callable.
- **Payments:** PASS. `billing_config.payments_live_enabled` is `false` in both clean-room and production observation.

### Regression Suites

| Suite | Result |
|---|---|
| P0 account readiness and privacy | PASS |
| Claim reservations | 7/7 PASS |
| Legacy AI auth static | PASS |
| Payment hardening | 34/34 PASS |
| Renew window | 24/24 PASS |
| Listing allowance | 38/38 PASS |
| Lifecycle guard | 9/9 PASS |
| Seed Drop off | 16/16 artifact and 6/6 DB PASS |
| Account readiness web/native static UI | PASS |
| Web production build | PASS |
| Expo typecheck and lint | PASS, with 15 pre-existing warnings and 0 errors |

### Residual Advisor Snapshot

The production Supabase security advisor currently reports 296 notices: 7 ERROR, 278 WARN, and 11 INFO. The original two-Medium Codex Security assessment is addressed below, but this larger advisor set was not exhaustively triaged in this closure. One ERROR is the heuristic `auth_users_exposed` warning for `public_markets`; read-only inspection showed that view exposes only a computed `verified_email` boolean from `auth.users`, not an email address. Five ERROR notices concern security-definer views and require separate intentionality review before public launch.

## ACCOUNT READINESS

- **Email:** SQL matrix PASS. Production configuration has `mailer_autoconfirm=true`, so email/password signup is marked confirmed without proving mailbox control. This does not satisfy a strict real-world verified-email claim and is a launch blocker until owner configuration is corrected and retested.
- **Email/password signup:** STRUCTURAL PASS for the client flow, FAIL for mailbox-verification posture. The app calls Supabase `signUp`; with current production configuration it receives an automatically confirmed account/session.
- **Verified email:** The readiness authority checks `auth.users.email_confirmed_at` or `confirmed_at`; it does not trust a client-supplied flag. Production has 10 email-provider users and all 10 are marked confirmed, but current auto-confirm means that timestamp alone is not evidence of mailbox control.
- **Google sign-in:** Provider is enabled and the app uses Supabase `signInWithOAuth`. Readiness still requires Supabase's authoritative confirmed timestamp. No production Google identity exists in the aggregate snapshot, so the exact live row state is UNPROVEN.
- **Apple sign-in:** Provider is enabled and native uses Apple identity token -> Supabase `signInWithIdToken`. No production Apple identity exists in the aggregate snapshot, so the exact live row state is UNPROVEN.
- **Phone:** SQL readiness matrix PASS. Live Supabase/Twilio verification is UNPROVEN.
- **Age:** PASS. Missing confirmation is not ready; all-current confirmation is ready.
- **Terms:** PASS. Missing or stale version is not ready.
- **Privacy:** PASS. Missing or stale version is not ready.
- **Marketplace Rules:** PASS. Missing or stale version is not ready.
- **Matrix A-H:** PASS for all required combinations.
- **Bypass tests:** PASS. A non-ready account is denied direct publish, reservation, message, Market follow, Zordy, credential submission, private pickup access, and external payment configuration.
- **Ready-account regression:** PASS. A ready account can publish an allowed listing, reserve, message, follow, use Zordy, manage its Market/payment method, submit credentials, and access authorized pickup details.
- **Defects found and fixed in proposed migration:** Zordy previously omitted readiness enforcement. First profile creation could deadlock because automatic Market creation was gated before policy acceptance could exist. The migration now gates Zordy and permits only the narrow nested Market bootstrap insert while retaining direct insert/update enforcement.

## TERMS / AGE UI QA

- **Web:** STRUCTURAL PASS and production-build PASS. All four confirmations default false; Terms, Privacy, and Marketplace Rules links target built routes; acceptance is disabled until every box is checked.
- **Native:** STRUCTURAL PASS and typecheck/lint PASS. The same four confirmations default false; all three legal links are present; 18+ is visible; acceptance is disabled until every switch is checked.
- **Account state update:** PASS at the SQL/RPC authority. Acceptance records the current versions and readiness refresh becomes ready. Logged-in end-to-end UI observation is UNPROVEN because no production test user was created or modified.
- **`ACCOUNT_NOT_READY` handling:** STRUCTURAL PASS. Post, request, edit listing, Zordy, and web screening paths show readable setup guidance and route to account readiness.

## PHONE OTP

- **Production configuration observed:** Twilio is named as SMS provider; `phone_autoconfirm=false`; public Auth settings report phone sign-up disabled. This does not prove Twilio billing, destination permissions, or phone-change delivery.
- **Live send:** UNPROVEN. No controlled disposable E.164 destination or test OTP mapping was available, so no SMS was sent.
- **Resend:** STRUCTURAL PASS. Web and native enforce a 60-second client cooldown. Server enforcement remains authoritative and live behavior is UNPROVEN.
- **Expiry:** STRUCTURAL PASS for Supabase `phone_change` flow; live expiry behavior is UNPROVEN.
- **Wrong code:** UNPROVEN live.
- **Correct code:** UNPROVEN live.
- **Number change:** STRUCTURAL PASS. Both clients call `updateUser({ phone })`, then `verifyOtp(..., type: 'phone_change')`, then sync only the verified Auth phone into private contact data.
- **Duplicate handling:** UNPROVEN live.
- **Rate limiting:** STRUCTURAL PASS at the provider/API design and client cooldown; live 429 behavior is UNPROVEN.
- **Billing/provider blocker:** Owner must confirm Twilio billing/geo permissions and provide a controlled disposable destination or configure an expiring Supabase test OTP. Secrets must be configured in the provider/dashboard, not pasted into chat.

## PICKUP PRIVACY

- **Anonymous:** PASS. Cannot execute pickup-details RPC.
- **Unrelated signed-in user:** PASS. Receives no private pickup details.
- **Non-ready approved buyer:** PASS. Denied with `ACCOUNT_NOT_READY:pickup_details`.
- **Ready buyer without approved reservation:** PASS. Receives no details.
- **Approved ready buyer:** PASS. Receives details.
- **Seller:** PASS. Receives details for own order.

## CREDENTIAL PRIVACY

- **Storage:** PASS. `compliance-docs` is private.
- **RLS:** PASS. Seller sees own credential/object; unrelated user sees neither; authorized compliance admin sees both.
- **Public payload:** PASS. Public listing views contain no credential document fields or document URLs.
- **Signed URLs:** STRUCTURAL PASS. Seller/admin document views request 300-second URLs; upload preview requests 60 seconds. Runtime expiration after TTL was not exercised and remains UNPROVEN.

## AI AUTH

- **ask-gnome:** PASS. Current source uses Bearer token -> `auth.getUser(token)` and rejects before service-role construction. Deployed function has `verify_jwt=true`.
- **draft-listing:** PASS. Same authoritative verification and deployed gateway setting.
- **garden-planner:** PASS. Same authoritative verification and deployed gateway setting.
- **Forged token:** PASS. An unsigned `alg:none` token returned HTTP 401 from all three deployed functions.

## ANDROID

- **Signed APK:** PASS. Current source built successfully with JDK 17 and the release upload configuration. Artifact: `expo/android/app/build/outputs/apk/release/app-release.apk` (42,040,773 bytes).
- **Package:** PASS, `app.boonesystems.gnome`.
- **SHA-1:** PASS, `DA:F1:79:50:49:38:5F:41:DA:E0:37:C4:EB:06:D4:B1:20:75:0C:13`.
- **Signature scheme:** PASS, APK Signature Scheme v2, one signer. The Gradle release target refuses to build when release credentials are missing and cannot silently use debug signing.
- **Maps metadata:** PASS. `com.google.android.geo.API_KEY` occurs exactly once in the packaged manifest and has a non-empty value.
- **Signed install/launch:** PASS on `gnome_rc`; the process stayed alive and Browse rendered.
- **Maps:** FAIL. The app reached its controlled "Couldn't load the map" state before `MapView` mounted.
- **Root cause:** The signed current source queries `listings.harvest_date`; production currently ends at migration 0127 and returns PostgreSQL `42703: column listings.harvest_date does not exist`. This blocks the data query before Maps SDK credential, tiles, pins, marker interaction, pan, zoom, or attribution can be tested.
- **Screenshot proof:** [signed launch](./gnome-rc-launch.png), [Map failure at 90 seconds](./gnome-rc-map-90s.png). Intermediate 10/30/60-second screenshots are stored beside them.
- **Log proof:** App PID remained alive. Log scan found no `API key not found`, `getOrCreateDestroyTask`, `Unhandled SoftException`, authorization failure, or fatal exception. That clean scan does not make Maps pass because the native map never mounted.
- **Push:** UNPROVEN. Only an emulator is connected and `Device.isDevice` correctly prevents claiming hardware push proof.
- **Push proof:** No permission/token/server-delivery/tap/background/killed-app proof was fabricated. A release-signed physical Android device and disposable test session are required.

## SECURITY

- **Medium 1 - legacy AI JWT decoding:** **FIXED** in current source. All three functions use authoritative `auth.getUser`, static regression passes, deployed gateway JWT verification is enabled, and forged unsigned tokens return 401.
- **Medium 2 - mutable credential scope race:** **FIXED IN PROPOSED MIGRATION, NOT YET IN PRODUCTION**. Review now transactionally locks and snapshots scope/hash; approved scope becomes immutable; regression passes. Production remains exposed until the reviewed migration is applied.
- **Owner acceptance needed:** No acceptance is needed if Medium 2 is deployed before launch. Launching before deployment would require explicit acceptance of a seller changing pending scope between reviewer inspection and approval, potentially producing an approval broader or different from what the reviewer saw. Likelihood is medium-low, impact is incorrect compliance authorization, and the proposed lock/snapshot is the mitigation.

## PRODUCTION IMPACT

Read-only counts only; no PII was returned.

- **Auth users:** 13.
- **Profiles:** 13.
- **Phone unverified/missing:** 13.
- **Email unverified:** 3.
- **Missing age/current Terms/Privacy/Marketplace acceptance:** 13 because the acceptance table is not yet deployed and begins empty.
- **Users initially not ready:** 13 of 13.
- **Active, unexpired listings:** 17 across 4 owners.
- **Listings owned by phone-unverified users:** 17.
- **Listings owned by email-unverified users:** 16.
- **Existing listing effect:** The migration does not pause, delete, or rewrite an existing listing. All 17 remain readable/active at apply time. Any subsequent owner update, renewal, or other readiness-gated action is denied until the owner completes readiness.

## MIGRATION ROLLBACK

### Apply order

Production currently ends at 0127. Review and apply in this order:

1. `20260824131202_claim_reservations.sql`
2. `20260824145211_zordy_daily_allowance.sql`
3. `20260824192500_block_unverified_restricted_listing_drafts.sql`
4. `20260824200500_listing_harvest_date.sql`
5. `20260824204821_p0_account_readiness_gates.sql`

`20260824210401_listing_performance_and_archive.sql` follows P0 for current-source parity but is not a prerequisite of the P0 clean-room gate.

### Locks and downtime

- P0 creates two small tables, policies, functions, and triggers, and adds nullable snapshot/hash columns to `seller_credentials`.
- Table DDL and trigger changes take short catalog/table locks and can briefly block concurrent writes.
- No existing-user acceptance backfill, active-listing rewrite, or large-table data update occurs.
- Apply during a low-write window, monitor lock waits and PostgREST errors, then perform ready/non-ready smoke calls before releasing clients.

### Failure and rollback

- A failure before `COMMIT` rolls back the entire P0 file.
- Readiness is fail closed: missing/invalid Auth state or stale/missing acceptance returns not ready and gated writes raise `ACCOUNT_NOT_READY`.
- Payments remain fail closed and disabled.
- If unexpected denials occur after commit, use a reviewed forward rollback migration that first removes the P0 gate triggers, then restores the prior Zordy/pickup/admin-review function definitions. Preserve acceptance and review snapshot data for audit rather than dropping it during an incident.
- There is no P0 feature flag. Do not improvise production DDL in the dashboard; use a reviewed migration and record it in `APPLIED.tsv`.

## REQUIRED FIXES BEFORE RE-RUN

1. Disable email auto-confirm and prove email/password confirmation end to end. Confirm Google and Apple `auth.users` timestamp behavior with controlled accounts.
2. Provide a controlled disposable phone/test OTP path and prove send, cooldown, expiry, wrong/correct code, number change, duplicate handling, and server rate limiting.
3. Resolve current-source/production schema drift in an approved staging or production-safe sequence, then rerun the exact signed APK Map gate for tiles, attribution, pins, interaction, pan, zoom, and clean logcat.
4. Run push on release-signed physical Android hardware, including foreground/background/tap route and killed-app behavior where feasible.
5. Complete logged-in web/native acceptance UI observation and live signed-URL expiry proof.
6. Triage the residual production Supabase security-advisor ERROR notices before public launch.

# FINAL TECHNICAL VERDICT

## FIX FIRST

The proposed P0 database migration is locally clean-room verified, atomic, and materially stronger after closing the Zordy bypass, Market bootstrap deadlock, and credential-scope race. The full directive cannot honestly pass yet: production email auto-confirm does not prove mailbox ownership; live phone OTP is unproven; the signed app is blocked by production schema drift before Maps mounts; physical-device push is unproven; and required live UI/storage observations remain incomplete.

Do not apply the production P0 migration or submit either store on this report alone.
