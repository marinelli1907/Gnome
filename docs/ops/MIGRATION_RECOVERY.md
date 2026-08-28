# Gnome Migration Recovery

**Status:** Database history repaired; ready for device QA
**Verified:** 2026-08-24
**Scope:** Repository history, PostgreSQL 17 clean-room replay, production read-only comparison, and database test evidence

## Executive Decision

The missing `0076_complimentary_grants.sql` body was not recreated from a filename or inferred from downstream code. The exact statement stored in the production Supabase migration ledger was recovered read-only and restored byte-for-byte to the repository.

The restored file is 12,075 bytes with MD5 `29d9b703cf13c37e898671f651b4793f`, matching production. A complete Supabase reset now applies all 134 forward migrations from `0001` through `20260824223000` without an error on PostgreSQL 17.6.

No production migration, schema write, ledger write, or data mutation was performed.

## Root Cause

The repository copy of migration `0076` had been replaced by a summary comment even though the production ledger recorded and executed a substantial SQL statement. Migration `0078_security_hardening.sql` then assumed `admin_plan_grants` and its policy existed. Later migrations also rely on the effective-plan functions created by `0076`.

Production inspection proved that the intended `0076` objects exist and that the ledger contains their exact creator statement. The gap was therefore repository-history loss, not a missing production deployment.

## Restored 0076 Contract

The recovered migration creates or configures:

- `public.admin_plan_grants`
- RLS policy `plan_grants_read`
- `plan_rank(market_plan)`
- `market_effective_plan(uuid)`
- `market_pickup_location_allowance(uuid)`
- effective-plan enforcement for listing and delivery gates
- `my_plan_entitlements()`
- admin grant, modify, and revoke RPCs
- the corresponding grants and revocations

`0078` directly hardens `admin_plan_grants` and replaces `plan_grants_read`. `0079`, `0081`, and `0124` consume or validate the effective-plan contract. Reapplying restored `0076` is idempotent in the disposable migration harness.

## Repair Strategy

The selected approach combines exact restoration and deterministic compatibility:

1. Restore production-proven historical SQL when the production ledger provides exact evidence (`0056`, `0058`, and especially `0076`).
2. Reconstruct the manually created AI control-plane objects and RPCs in `0077` from the production schema so a fresh database reaches the same contract before `0078`.
3. Preserve environment-specific data safely. `0024` now inserts the historical owner row only when the referenced profile exists, so an empty clean room does not fail its foreign key.
4. Keep live drift fixes in new, unapplied migrations. `20260824223000_legacy_category_map_integrity.sql` repairs the sole production schema drift without rewriting the live database.
5. Keep every rollback file out of the forward replay while retaining it in the repository audit.

Historical migrations were modified: **YES**. Each substantive restoration is backed by the production ledger or production schema; no production history row was changed.

## Files Changed

- `supabase/migrations/0024_admin_moderation.sql`
- `supabase/migrations/0048_market_ops.sql`
- `supabase/migrations/0056_seed_multiselect_and_recs.sql`
- `supabase/migrations/0057_handmade_taxonomy.sql`
- `supabase/migrations/0058_revoke_zip_column.sql`
- `supabase/migrations/0076_complimentary_grants.sql`
- `supabase/migrations/0077_inventory_fulfillment_boardroom.sql`
- `supabase/migrations/0081_commercial_model.sql`
- `supabase/migrations/APPLIED.tsv`
- `supabase/migrations/UNAPPLIED.txt`
- `supabase/migrations/20260824223000_legacy_category_map_integrity.sql`
- `supabase/tests/migration_audit.sh`
- `supabase/tests/schema_fingerprint.sql`

Related correctness fixes made while proving the chain include the production-equivalent claim-message policy expression, the compliance routine ACL, generated Auth-column-safe fixtures, and the P0 email-verification check.

## Clean-Room Evidence

Runtime:

- Docker CLI through Colima; no Docker Desktop dependency
- Supabase local stack through CLI 2.98.2
- actual container database: PostgreSQL 17.6
- independent Homebrew harness: PostgreSQL 17.11

Replay:

- forward migration files: 134
- rollback files deliberately excluded: 6
- first migration: `0001_init.sql`
- latest migration: `20260824223000_legacy_category_map_integrity.sql`
- migration failures: 0
- `payments_live_enabled`: `false`
- Stripe mode: `test`

The separate `0076` migration harness used a legacy PostgreSQL 16.13 fixture for its staged idempotency check. Its unavailable `pg_cron` extension is an environmental limitation of that fixture, not the final proof; the complete Supabase replay passed on PostgreSQL 17.6.

## Test Evidence

All 30 canonical shell runners passed, including lifecycle, listing allowance, listing performance, market following, payment hardening, renewal, RLS, seed-drop, admin, AI, promotions, and webhook-mode suites.

Additional evidence:

- listing performance/archive: 16 of 16 checks passed
- P0 account readiness: email, phone, age, Terms, Privacy, Marketplace Rules, server gates, pickup privacy, credential scope, privilege boundaries, and payment-disable assertion passed
- claim reservations: 7 of 7 checks passed
- two-session reservation race: one approval succeeded, one failed with `INSUFFICIENT_INVENTORY: 4 left`, final inventory was 4, and the losing claim remained pending
- Node tests: 37 files/tests passed; embedded schema/action cases included 26 listing-draft, 59 market-action, and 27 market-import cases
- migration audit: 129 applied rows represented, no undeclared files, `0001..0127` contiguous, and every migration executable

The live market-import evaluation remains credential-gated because `GNOME_QA_EMAIL` and `GNOME_QA_PASSWORD` were not present. Credentials must be supplied through the approved local secret mechanism, never chat or source control.

## Production Comparison

The repository ledger snapshot now matches the read-only production ledger exactly:

- applied rows: 129
- missing versions: 0
- extra versions: 0
- name mismatches: 0
- statement-hash mismatches: 0
- duplicate versions: 0

A 125-migration production-aligned replay excluded the nine explicitly unapplied proposals (`0089`, `0091`, and seven timestamped 2026-08-24 migrations). Definition-level comparison matched production for columns, enums, indexes, routines, routine grants, table grants, triggers, and views.

The only production schema drift is `legacy_category_map`: production has RLS disabled and is missing `legacy_map_select` plus `legacy_category_map_taxonomy_path_fkey`. All 16 live mapping rows reference valid taxonomy paths. The new idempotent migration repairs exactly those controls and remains unapplied pending owner review.

The full 134-migration schema additionally contains the nine proposed/unapplied feature and hardening changes. Those differences are expected and must not be applied to production as part of this recovery.

## Rollback Considerations

The repository restoration itself has no production rollback because nothing was applied to production. Do not replace `0076` with the placeholder again; doing so reintroduces the clean-room failure.

If `20260824223000_legacy_category_map_integrity.sql` is later rejected before production application, remove it only through normal review and update `UNAPPLIED.txt`. If it is approved and applied, rollback would require intentionally removing an RLS policy and a valid foreign key and is therefore not recommended except during a documented incident.

## Device QA Handoff

Use a fresh internal Android build or development build produced from the current source and pointed at the intended QA backend. The existing APK is acceptable only if it includes the account-readiness, reservation, listing-performance, and archive client changes represented by this release candidate.

Before testing:

1. Keep `payments_live_enabled=false` and Stripe in test mode.
2. Provision QA credentials through local environment/secrets, not chat.
3. Use a verified-email, verified-phone, age-confirmed account with current Terms, Privacy, and Marketplace Rules acceptances.
4. Confirm the backend has the proposed migrations under test; do not apply them to production for this QA handoff.

Exercise on real hardware:

1. Active owner listing screen and expired owner listing screen.
2. View Stats, Repost, Delete confirmation, and archive disappearance.
3. Public/non-owner listing visibility after archive.
4. Reservation overbooking with concurrent buyers and private pickup details only after approval.
5. Zordy daily allowance and concurrent quota use.
6. Bottom navigation and safe-area behavior.
7. Map tiles, pins, attribution, and clean Android logs if the build includes any Map change. No Map source was changed in this recovery.

Public store submission remains outside this checkpoint.

## Verdict

**DATABASE HISTORY REPAIRED — READY FOR DEVICE QA**
