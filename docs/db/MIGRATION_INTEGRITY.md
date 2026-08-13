# Migration integrity — the 0084 gap, what it exposed, and the guard

2026-08-13. Written while recovering the missing `0084` migration before Seed
Drop Phase 0 numbering begins.

## What was asked, and what was found

The task was to recover one migration: production ran `billing_webhook_helpers`
(the Stripe webhook's transactional helpers, including
`billing_pay_seed_seasonal`) on 2026-08-12, and no `0084_*.sql` existed in the
repository. Recovering it surfaced a larger condition, documented here in full.

## Recovery method (and why it is trustworthy)

Supabase records the **exact text it executed** in
`supabase_migrations.schema_migrations.statements`. So recovery is not a
reconstruction from the live schema — it is retrieval of the original file
content. Fidelity is provable:

```sql
select md5(statements[1]) from supabase_migrations.schema_migrations
 where version = '20260812014536';
```

`0084_billing_webhook_helpers.sql` hashes to `d65a0d563c55c8d9d2b00c6e36fe44f1`
— identical to production's record. The same method and the same proof were
applied to every file recovered below.

## Recovered in this pass (all md5-identical to production)

| File | Applied as | Applied at | md5 |
|---|---|---|---|
| `0029_seed_log_admin_insert.sql` | `0029_seed_log_admin_insert` | 2026-08-08 | `2290041395…` |
| `0052_pickup_locations.sql` | `pickup_locations` | 2026-08-10 | `772940c575…` |
| `0053_pickup_locations_scheduling.sql` | `pickup_locations_scheduling` | 2026-08-10 | `8404f281b7…` |
| `0054_pickup_location_address_privacy.sql` | `pickup_location_address_privacy` | 2026-08-10 | `9a5eea6e4f…` |
| `0055_admin_pickup_location_overview.sql` | `admin_pickup_location_overview` | 2026-08-10 | `2dee8c5b5b…` |
| `0059_revoke_zip_column_properly.sql` | `revoke_zip_column_properly` | 2026-08-11 | `6b27d91eb9…` |
| `0084_billing_webhook_helpers.sql` | `billing_webhook_helpers` | 2026-08-12 | `d65a0d563c…` |
| `0088_public_listings_request_options.sql` | `public_listings_request_options` | 2026-08-12 | `de71a4cea1…` |

Numbering is now contiguous `0001…0088` with no holes. **Every one of these was
already live in production; none was applied or re-applied by this work.**

`0088` carries a later number than its applied position (it ran between `0085`
and `0086`). That is safe because it is a single `create or replace view` whose
only dependency, `listings.request_options`, is created by `0085`. Replaying
`0001…0088` therefore produces the correct final view. **Seed Drop Phase 0
starts at `0089`.**

## Why the gap happened

Migrations were applied straight to production through the Supabase dashboard
and the MCP `apply_migration` tool during fast build rounds. Production recorded
them; the repository sometimes did not get the file. Three distinct shapes:

1. **No file at all** — the eight recovered above.
2. **A prose summary instead of the SQL.** Eleven files describe what was
   applied and point at "Supabase migration history" for the real statements:
   `0021`, `0030`, `0031`, `0032`, `0033`, `0034`, `0047`, `0056`, `0057`,
   `0058`, `0076`. They are documentation, not migrations — they cannot rebuild
   anything.
3. **Applied outside the ledger.** `0057_handmade_taxonomy` was run through the
   SQL editor, so production has the objects (verified: 3 handmade taxonomy
   nodes live) but **no** `schema_migrations` row. It is declared in
   `UNAPPLIED.txt` rather than back-dated, per "do not alter production merely
   to make migration bookkeeping look cleaner."

## Consequence: the repo cannot yet rebuild the database from scratch

`supabase/tests/run_migration_tests.sh 0084` replays `0001…0084` on a throwaway
local Postgres. It still fails, and the failures are honest:

- **Category 1 — environment, not defect.** `pg_cron`, the `supabase_realtime`
  publication, and `auth.users.email_confirmed_at` do not exist on a plain
  server. `supabase/tests/supabase_shim.sql` covers the rest (three PostgREST
  roles, `auth.uid()/jwt()/role()`, `storage`, `extensions.digest`, a cron
  shim).
- **Category 2 — the summary files.** `0032` is prose, so `listings.market_position`,
  `markets.tagline`, and `seller_transactions` are never created, and every
  later migration touching them fails. `0076` is prose, so `market_effective_plan`
  and `admin_plan_grants` are missing, which fails `0078` and `0081`. This is
  the dominant cause.
- **Category 3 — environment-specific seed data.** `0024_admin_moderation`
  inserts a specific admin uuid that has no `profiles` row in an empty
  database.

`0084` itself is **not** at fault: its only local failure is
`price_from_sub(s public.seed_drop_subscriptions)` failing to resolve
`s.price_cents` — because `0032`'s absence means the column never exists
locally. In production, where the column exists, it applied cleanly.

## Finishing the repair (needs a credential this session does not hold)

The eleven summary files should be replaced with their applied SQL. Do not
hand-transcribe them — the Supabase CLI (installed, 2.98.2) does it exactly:

```bash
cd ~/BooneSystems/Gnome && supabase link --project-ref fgybyghwcjlstqxkclch
```

```bash
cd ~/BooneSystems/Gnome && supabase db pull --schema public
```

`supabase link` prompts for the database password, which only Daniel holds — so
this step is his, not an agent's. Afterwards, re-run
`supabase/tests/migration_audit.sh` (check 5 should report zero) and
`supabase/tests/run_migration_tests.sh 0088`.

## The guard that stops this recurring

`supabase/tests/migration_audit.sh` — offline, CI-able, exits non-zero on a real
break:

1. every applied migration has a repository file (via `APPLIED.tsv`);
2. every repository migration is applied **or** declared in `UNAPPLIED.txt`
   with a reason;
3. migration numbering is contiguous — a hole means a lost migration, which is
   exactly the 0084 signature;
4. drift report: file text vs the text production actually ran;
5. summary-only detection: flags prose masquerading as a migration.

`supabase/migrations/APPLIED.tsv` is the checked-in snapshot of production's
ledger (92 rows; roster hash verified equal to production's
`122d7f176c8d3569afa765de5e74742a`). Refresh it with:

```sql
select version, name, md5(array_to_string(statements, E'\n')) from supabase_migrations.schema_migrations order by version;
```

**Rule going forward:** a migration is written to a file first, applied second,
and the audit runs before push. Anything applied through the dashboard gets its
file and its `APPLIED.tsv` row in the same session.
