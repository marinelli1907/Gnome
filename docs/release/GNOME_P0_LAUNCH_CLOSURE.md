# BOONE SYSTEMS — GNOME P0 LAUNCH CLOSURE

Date: 2026-08-24

## Technical Status

Implemented a proposed local migration: `supabase/migrations/20260824204821_p0_account_readiness_gates.sql`.

It adds server-owned account readiness checks for verified email, verified phone, 18+ confirmation, current Terms, current Privacy Policy, and current Marketplace Rules. It gates listings, Markets, claims, claim messages, follows, seller credentials, Market payment methods, pickup settings, pickup details, and Market orders.

No payment-live switch was changed. The migration contains a self-check that fails if `billing_config.payments_live_enabled` is true.

## Account Trust

Added `/account-ready` on web and `expo/app/account-ready.tsx` on mobile. Both support:

- email verification resend
- phone-change OTP request and verification through Supabase Auth
- verified Auth phone sync into `user_private_contact`
- current policy acceptance and 18+ confirmation
- readiness checklist driven by `my_account_readiness()`

Updated profile/onboarding copy so phone is no longer described as optional for launch access.

## Ohio Compliance

Existing Ohio regulated-category compliance gates remain in force through `publish_eligibility`, listing compliance triggers, `seller_credentials`, `seller_compliance_clearances`, and category scope checks. The P0 migration adds an account-readiness gate before seller credential writes and freezes approved credential scope rows to prevent post-approval category expansion.

## Security

Closed the two Medium findings in code:

- Legacy AI functions no longer derive identity from locally decoded JWT claims before service-role reads. `ask-gnome`, `draft-listing`, and `garden-planner` now verify the caller with Supabase Auth `auth.getUser`.
- Approved credential taxonomy scope is locked from non-admin mutation, and admin approval snapshots the exact approved scope under row locks.

Added `supabase/tests/legacy_ai_auth_static.test.mjs` to prevent the JWT-decoding pattern from returning.

## Android

No signed Android Maps proof was produced in this pass.

No Android push proof was produced in this pass.

These remain P0 verification items requiring a signed Android build on real hardware or approved emulator/device path with the production-intended Maps credential and push configuration.

## Production Impact

The migration is not applied to production. It is intentionally proposed/local until Daniel approves rollout.

Expected impact when applied:

- Existing incomplete accounts will be blocked from posting, Market setup/updates, requests, messages, follows, credential uploads, pickup settings, pickup details, and Market orders until readiness is complete.
- Existing data is not deleted.
- Existing listings are not mass-paused by the migration, but updates to gated rows will require account readiness.
- Direct service/admin maintenance paths should be reviewed before production rollout because the trigger gate is intentionally fail-closed.

## External Owner Items

Still owner-held and not faked:

- attorney signoff on Terms, Privacy, Marketplace Rules, liability posture, Ohio food/category language, and minor/18+ policy
- CPA/SALT review for Ohio sales/use tax and marketplace facilitator posture
- insurance broker review for marketplace/platform liability, E&O/cyber, product-liability exposure, and seller coverage requirements
- seller density and launch-market operational readiness

## Tests

Passed:

- `node supabase/tests/legacy_ai_auth_static.test.mjs`
- `npm --prefix web run typecheck`
- `npm --prefix web run build`
- `npm --prefix expo run typecheck`
- `npm --prefix expo run lint` with 0 errors and 19 pre-existing warnings

Blocked:

- `supabase db reset --local --no-seed` because Docker is not running.

Attempted fallback:

- Homebrew PostgreSQL 16 throwaway replay reached Supabase-hosted dependency stubs (`storage`, `supabase_realtime`, `pg_cron`) and then stopped on a seed/profile mismatch in old migration `0024_admin_moderation.sql`. This is not a faithful PG17 Supabase clean-room substitute and does not count as migration approval.

## P0 Remaining

- Run Supabase PG17 clean-room reset with Docker/Supabase local and apply the new migration.
- Run focused SQL tests for account readiness gates, policy acceptance, phone verification sync, credential scope locking, and pickup-details gating.
- Produce signed Android Maps proof.
- Produce Android push proof.
- Obtain legal/CPA/insurance signoff before public launch.

## P1

- Replace route casts after Expo Router regenerates typed routes for `account-ready`.
- Add richer in-app guidance for exactly which readiness steps are missing.
- Add admin reporting for accounts blocked by readiness gate.

## Final Verdict

FIX FIRST.

The code paths for account trust, server-side gating, and the two Medium findings are implemented and pass static/app verification, but P0 is not closed until the PG17 Supabase clean-room migration suite, signed Android Maps proof, Android push proof, and external professional signoffs are complete.
