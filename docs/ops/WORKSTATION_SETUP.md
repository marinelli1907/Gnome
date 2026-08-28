# Gnome workstation setup audit

Date: 2026-08-23

This is the current environment inventory for Daniel's Mac as the Gnome
development host. It records capability and command paths only; it intentionally
does not include secrets.

## Repository

- Path: `/Users/danielmarinelli/BooneSystems/Gnome`
- Remote: `https://github.com/marinelli1907/Gnome.git`
- Default branch: `main`
- Current branch during audit: `codex/gnome-launch-finish-20260819`
- Current HEAD during audit: `21a734aa14f65feed4e848311f74926eaa45e276`
- Current branch state during audit: ahead of origin by 3 commits
- Tags observed: `rc-predemo-inventory-2026-08-22`, `rc-preidentity-patch-2026-08-20`, `rc-preorange-2026-08-19`, `rc-prerebrand-2026-08-18`, `compliance-ui-baseline-ff33d06`, `taxonomy-compliance-baseline-d5c4fc3`, `rc-baseline-7599844`

Pre-existing dirty/untracked state observed before setup edits:

- Modified: `.DS_Store`
- Modified: `supabase/.temp/cli-latest`
- Modified: `supabase/migrations/0030_seed_multi_size.sql`
- Modified: `supabase/migrations/0031_admin_ops.sql`
- Modified: `supabase/migrations/0032_seller_storefront.sql`
- Modified: `supabase/migrations/0033_storefront_views.sql`
- Untracked Supabase temp/link files under `supabase/.temp/`

Do not reset, clean, overwrite, or remove those paths unless Daniel explicitly
asks.

## Project Surfaces

- `expo/`: customer mobile app, Expo SDK 54, iOS and Android.
- `admin/`: internal admin app, separate Expo SDK 57 surface; see `admin/AGENTS.md`.
- `web/`: public Next.js website.
- `supabase/`: Postgres schema, migrations, SQL tests, Edge Functions.
- `docs/release/RELEASE_BOARD.md`: release status source of truth.
- `docs/design/GNOME_IDENTITY.md`: visual/product identity source of truth.

## Canonical Commands

Install:

```bash
cd expo && npm ci
cd web && npm ci
cd admin && npm ci
```

Expo customer app:

```bash
cd expo && npm run typecheck
cd expo && npm run lint
cd expo && npm start
cd expo && npm run android
cd expo && npm run ios
cd expo && eas build --platform android --profile production
cd expo && eas build --platform ios --profile production
cd expo && eas submit --platform android --profile production
cd expo && eas submit --platform ios --profile production
```

Store submit commands cross the owner boundary; prepare them, but do not perform
final public submission without Daniel.

Web:

```bash
cd web && npm run typecheck
cd web && npm run build
cd web/deploy && VPS_HOST=root@147.79.75.242 ./deploy.sh
```

Web deployment is the existing Hostinger VPS + nginx + PM2 path. Do not migrate
Gnome to Vercel just because Vercel is available.

Supabase:

```bash
supabase projects list
supabase functions list --project-ref fgybyghwcjlstqxkclch
supabase migration list --linked
supabase db query --linked '<read-only SQL>'
supabase/tests/migration_audit.sh
supabase/tests/run_edge_typecheck.sh
```

Production SQL is read-only. Schema work must be migration-first and verified in
a clean room.

Focused local SQL suites include:

```bash
supabase/tests/run_payment_hardening_tests.sh
supabase/tests/run_renew_window_tests.sh
supabase/tests/run_listing_allowance_tests.sh
supabase/tests/run_lifecycle_guard_tests.sh
supabase/tests/run_seed_drop_off_tests.sh
```

These suites are destructive against local databases only and refuse non-local
hosts.

## Workstation Checks

Run:

```bash
scripts/gnome-doctor.sh
```

The doctor sets safe defaults for this machine while it runs:

- `JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home`
- `ANDROID_HOME=$HOME/Library/Android/sdk`
- Postgres 17 binaries from `/opt/homebrew/opt/postgresql@17/bin`

It checks secret-bearing configuration by presence only and does not print
secret values.

## Current Capability Snapshot

Verified:

- `git` works.
- GitHub CLI is authenticated as `marinelli1907`; repo permission is `ADMIN`.
- Node, npm, npx are installed.
- Expo CLI works in `expo/`.
- EAS CLI is authenticated for `@marinelli1907/gnome`.
- EAS production env contains `EXPO_ANDROID_GOOGLE_MAPS_API_KEY` by presence.
- EAS remote versions during audit: Android versionCode 12, iOS buildNumber 10.
- Android SDK exists at `$HOME/Library/Android/sdk`.
- AVD `gnome_rc` exists.
- `adb` works when Android SDK platform-tools are on PATH.
- An Android emulator was connected during audit.
- Xcode 26.4 is installed.
- iOS simulator `iPhone 16` was booted during audit.
- A paired physical `iPhone 16 Pro` was visible through `xcrun devicectl`.
- Apple development and distribution signing identities are present in Keychain.
- Supabase CLI and Supabase MCP are authenticated.
- Supabase project `fgybyghwcjlstqxkclch` is active and healthy on Postgres 17.
- Supabase Edge Functions are listable and active.
- Docker CLI, Buildx, Compose, and Colima are installed.
- Colima is running with Docker context `colima`.
- Gnome production website is reachable over HTTPS.
- VPS SSH to `root@147.79.75.242` works non-interactively.
- Remote PM2 process `gnome-web` is online on `/var/www/gnome-web`.
- GitHub connector sees `marinelli1907/Gnome` with admin/push permissions.
- Linear connector is available. Workspace has team `Boonesystems`; no product
  projects were present during audit. Existing starter issues observed:
  `BOO-3 Import your data`, `BOO-4 Set up your teams`.
- Notion connector is available. Workspace/teamspace observed:
  `Boonesystems's HQ`.
- Figma connector is available.
- Stripe connector is available and has Boone Systems LLC in live mode. Treat as
  read-only until an explicit payment directive crosses the owner boundary.
- HubSpot connector is available with read/write access to standard objects such
  as contacts, companies, deals, calls, and emails.
- Lovable tools are available, but no Gnome architecture change should be made
  through Lovable during setup.

Needs setup or caution:

- Shell `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and Android tool PATH are not set by
  default in the interactive shell.
- Default `java` is JDK 26; local Android Gradle needs JDK 17.
- `supabase start` was not run in this pass; the local Supabase stack is not
  currently running.
- Disk is tight. After cleanup and Colima setup, the data volume had only a few
  GiB free. Avoid large local image pulls/build artifacts until disk space is
  reclaimed.
- Homebrew Postgres 17 is installed, but the default `psql`/`initdb` are
  Postgres 16 unless PATH is adjusted.
- Local Android generated `release` variant is debug-signed unless secure
  release signing is intentionally configured; it is not a Play artifact path.
- `eas credentials` is interactive in the installed CLI and was not inventoried
  non-interactively.
- Browser-console authenticated sessions were not proven from Chrome in this
  pass. The supported Chrome-control setup failed with `Cannot redefine
  property: process`; CLI and connector authentication were proven where
  available.
- Slack connector/CLI was not exposed in this Codex session.
- Vercel CLI was not installed, and Gnome's production web path is the existing
  Hostinger VPS. Do not migrate to Vercel without an explicit directive.
- Remote PM2 process inspection exposed at least one unrelated secret in process
  environment output. Do not reproduce it; rotate/move that secret after this
  setup pass.

## Dry Run Results

Passed:

```bash
cd expo && npm run typecheck
cd web && npm run build
cd web && npm run typecheck
node --test supabase/tests/*.test.mjs supabase/scripts/*.test.mjs
supabase/tests/migration_audit.sh
supabase/tests/run_edge_typecheck.sh
cd expo/android && \
  JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
  ANDROID_HOME=$HOME/Library/Android/sdk \
  ./gradlew tasks --all
xcodebuild -workspace ios/Gnome.xcworkspace -scheme Gnome \
  -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  CODE_SIGNING_ALLOWED=NO build
```

Warnings or known issues:

- `cd expo && npm run lint` passes with 19 warnings and 0 errors.
- `scripts/gnome-doctor.sh` reports 44 pass, 3 warnings, 0 failures after
  Docker/Colima setup.
- `cd expo && npx expo-doctor` reports 17/18 checks, with one dynamic
  `app.config.js`/`app.json` warning.
- `supabase/tests/run_edge_typecheck.sh` reports 6 pass, 5 deploy-layout skips,
  3 known-failing functions, and 0 new failures.
- Initial `cd web && npm run typecheck` can fail before `.next/types` exists;
  run `npm run build` first, then `npm run typecheck`.

## Owner Boundaries

Stop for Daniel before:

- Final Google Play submission.
- Final App Store submission.
- Public production rollout.
- Live payments or any change to `payments_live_enabled`.
- Destructive production database changes.
- Credential weakening, unrestricted cloud credentials, MFA/passkeys, legal
  agreements, billing purchases, or anything that charges money.
