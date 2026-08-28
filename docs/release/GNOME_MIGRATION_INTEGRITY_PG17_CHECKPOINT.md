# GNOME MIGRATION INTEGRITY + PG17 CLEAN-ROOM CHECKPOINT

**Date:** 2026-08-24
**Verdict:** DATABASE HISTORY REPAIRED — READY FOR DEVICE QA

## Root Cause

- **0076:** Repository body was a placeholder; production stored and applied 12,075 bytes of SQL.
- **Intended objects:** Complimentary plan grants, effective-plan functions, entitlement RPCs, enforcement gates, RLS, and grants.
- **0078 dependency:** Directly hardens `admin_plan_grants` and its RLS policy.
- **Production state:** Objects exist; production ledger contains the exact `0076` statement.

## Repair

- **Strategy:** Restore exact ledger-backed SQL; bootstrap schema-proven manual objects deterministically; isolate live drift in a new unapplied migration.
- **Historical migration modified:** YES, with production evidence.
- **0076 proof:** 12,075 bytes; MD5 `29d9b703cf13c37e898671f651b4793f`.
- **Production writes:** None.

## Docker And PG17

- **Runtime:** Docker CLI through Colima.
- **Supabase local:** Started successfully without Docker Desktop.
- **Database:** PostgreSQL 17.6 in the actual Supabase container.
- **Independent harness:** PostgreSQL 17.11.

## Migration Chain

- **Forward migrations:** 134.
- **Rollback files excluded:** 6.
- **Failures:** 0.
- **Latest reached:** `20260824223000_legacy_category_map_integrity.sql`.
- **Payment gate:** Disabled; Stripe test mode.

## Schema Diff

- **Production-aligned replay:** 125 forward migrations.
- **Exact categories:** columns, enums, indexes, routines, routine ACLs, table ACLs, triggers, and views.
- **Production drift:** `legacy_category_map` lacks RLS, `legacy_map_select`, and its taxonomy-path foreign key.
- **Repair status:** represented by a deterministic unapplied migration; all 16 production mappings have valid targets.
- **Expected proposed changes:** `0089`, `0091`, and seven timestamped 2026-08-24 migrations.
- **Unexpected differences:** none beyond the documented live drift.

## Ledger

- **Production rows:** 129.
- **Repository rows:** 129.
- **Missing/extra versions:** 0/0.
- **Name mismatches:** 0.
- **Statement-hash mismatches:** 0.
- **Duplicate versions:** 0.
- **Migration audit:** PASS.

## Tests

- **Canonical shell runners:** 30/30 passed.
- **Listing performance/archive:** 16/16 passed.
- **Claim reservations:** 7/7 passed.
- **P0 readiness:** full matrix and privilege/privacy assertions passed.
- **Reservation concurrency:** one winner, one inventory rejection, no oversell.
- **Node tests:** 37/37 passed.
- **Credential-gated live import evaluation:** pending approved QA credentials.

## Device QA

Use a current internal APK/build containing the release-candidate account-readiness, reservation, listing-performance, and archive client changes. Keep payments disabled, use secrets from the approved local mechanism, and verify active/expired owner screens, View Stats, Repost, deletion, archive visibility, public views, navigation, safe areas, reservations, pickup privacy, and Zordy concurrency on real hardware.

No store submission is authorized by this checkpoint.

**DATABASE HISTORY REPAIRED — READY FOR DEVICE QA**
