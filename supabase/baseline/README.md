# Schema baseline

`public_schema.sql` is a complete, verified dump of the `public` schema as it exists in production
(project `fgybyghwcjlstqxkclch`), captured 2026-08-17 from Postgres 17.6 — after the
0104-0125 monetization, Drops, Bundles, lifecycle-guard and payment-hardening rounds.

## Why this exists

Four repo "migrations" are prose summaries rather than SQL — `0056_seed_multiselect_and_recs`,
`0057_handmade_taxonomy`, `0058_revoke_zip_column` and `0076_complimentary_grants`. They were applied
through the Supabase SQL editor, so unlike the eight files recovered earlier there is **no recorded
statement text to retrieve**: `supabase_migrations.schema_migrations` has no row for them. Their
absence cascades — eighteen later migrations fail on a fresh build because objects they depend on
were never created.

The practical consequence was that **the migration folder alone could not rebuild a database**. This
file closes that gap. It is not a reconstruction of those four migrations; it is the actual current
schema, which is strictly better for the purpose.

## What it contains

90 tables, 248 functions, 155 RLS policies, 5 views — and, importantly, **261 column-level
grants** among 1,093 GRANT statements. Those grants are load-bearing in this schema, not incidental: `public.listings` uses
per-column grants, and one ungranted column anywhere in a PostgREST select list returns 42501 for the
entire query. A dump taken with `--no-privileges` would look complete and rebuild a subtly broken
database, so do not regenerate this file that way.

## Rebuilding from it

```bash
createdb gnome_local
psql -d gnome_local -f supabase/tests/supabase_shim.sql      # auth/storage/cron stand-ins
psql -d gnome_local -f supabase/baseline/public_schema.sql
```

**Use a Postgres 17 target.** Restoring onto Postgres 16 produces ~61 errors, all of them
`unrecognized privilege type "maintain"` — `MAINTAIN` is a privilege Postgres 17 introduced and 16
does not parse. They are harmless in the sense that every object still builds, but the resulting
database is missing those grants. Verified 2026-08-16: on a 16.13 server the restore yields exactly
those 61 and nothing else.

## Regenerating

Needs the database password (Supabase dashboard → Settings → Database) and Postgres **17** client
tools — `pg_dump` refuses to dump a server newer than itself.

```bash
brew install postgresql@17
PGPASSWORD='...' /opt/homebrew/opt/postgresql@17/bin/pg_dump \
  -h aws-1-us-east-2.pooler.supabase.com -p 5432 \
  -U postgres.fgybyghwcjlstqxkclch -d postgres \
  --schema-only --schema=public --no-owner \
  -f supabase/baseline/public_schema.sql
```

Note the host: the direct `db.<ref>.supabase.co` endpoint is IPv6-only and will not resolve from most
networks. `aws-0-us-east-2` does not know this tenant — it must be `aws-1`.

## Relationship to the migration files

The numbered migrations remain the history and the review surface; this is the rebuild path. When
`0056`/`0057`/`0058`/`0076` are one day replaced with real SQL, this file stays useful as the
verified snapshot to diff against.
