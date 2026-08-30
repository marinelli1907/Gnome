# Production migration handoff

This is the final database gate for the Gnome 1.1.0 release candidate. The first
five files below were applied by the owner on 2026-08-29 and verified read-only
against production. One narrow grant repair remains. It has passed an isolated
Postgres 17 regression test and has **not** been applied by the coding agent:
production writes require the owner.

`billing_config.payments_live_enabled` must remain `false` before, during, and
after this work. None of these migrations enables live payments.

## Applied and verified

1. `supabase/migrations/20260824145211_zordy_daily_allowance.sql`
2. `supabase/migrations/20260824192500_block_unverified_restricted_listing_drafts.sql`
3. `supabase/migrations/20260824223000_legacy_category_map_integrity.sql`
4. `supabase/migrations/20260828035457_fix_email_readiness_after_otp.sql`
5. `supabase/migrations/20260828045652_paid_market_storefront_visits.sql`

Production proof passed for all five files and their exact rows are recorded in
`supabase/migrations/APPLIED.tsv`.

## Remaining owner action

Run this one complete file in the Supabase production SQL editor:

6. `supabase/migrations/20260830013208_lock_public_market_drops_projection.sql`

It revokes unintended relation privileges from the buyer-facing Market Drops
view, then grants only `SELECT` to `anon` and `authenticated`. It does not alter
data, the view definition, subscriptions, billing products, or payment state.
It is transaction-wrapped and aborts if the public column allowlist differs or
if `payments_live_enabled` is true.

Stop if it reports any error; do not run only a fragment.

Do not use a broad `supabase db push` for this release. The repository contains
other deliberately deferred migrations, so a broad push would apply more than
this reviewed set.

## Preflight

Run this read-only check first. It must return `true`.

```sql
select not exists (
  select 1
  from public.billing_config
  where payments_live_enabled is true
) as payments_live_disabled;
```

## Post-apply proof

Run this read-only proof after file 6. Every column must return `true`.

```sql
select
  not exists (
    select 1
    from public.billing_config
    where payments_live_enabled is true
  ) as payments_live_disabled,
  to_regprocedure('public.my_zordy_usage()') is not null
    as zordy_allowance_present,
  exists (
    select 1
    from pg_trigger
    where tgname = 'listings_compliance_gate'
      and not tgisinternal
  ) as restricted_draft_gate_present,
  coalesce((
    select relrowsecurity
    from pg_class
    where oid = 'public.legacy_category_map'::regclass
  ), false) as legacy_map_rls_enabled,
  to_regprocedure('public.record_my_verified_email_otp()') is not null
    as email_otp_proof_present,
  to_regprocedure('public.record_my_verified_email_provider()') is not null
    as oauth_email_proof_present,
  to_regprocedure(
    'public.create_market_visit_request(uuid,timestamp with time zone,timestamp with time zone,text)'
  ) is not null as market_visit_request_present,
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'public_market_drops'
      and (
        (grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT')
        or grantee = 'PUBLIC'
      )
  ) as market_drops_projection_read_only;
```

Then run Supabase Security Advisor. The known `legacy_category_map` RLS error
must be gone. Any new error is a release stop. The reviewed enumerated public
projection views may remain advisor warnings; they must not gain new columns or
client write grants.

## Ledger closeout

After the live proof succeeds, move only file 6 from
`supabase/migrations/UNAPPLIED.txt` into `supabase/migrations/APPLIED.tsv`, using
the exact production statement hash. Re-run:

```bash
bash supabase/tests/migration_audit.sh
```

Do not fabricate migration-history rows for SQL-editor applications. The ledger
records what is live; Supabase schema migration history records what its own
migration runner applied.
