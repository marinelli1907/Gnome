# Credential rotation register

Credentials known to have been exposed, and their status. No secret values appear in this file, and
none should ever be added to it.

## OPEN — Supabase database password (project `fgybyghwcjlstqxkclch`)

**Status: requires rotation. Currently live and in use.**

**Exposed:** 2026-08-16, pasted in plaintext into an assistant chat transcript. Two values were
exposed that day — an older one that turned out to be invalid (already rotated or never the DB
password), and the replacement generated from the dashboard, which **is the credential in force**.

**Scope of the exposure.** This is the `postgres` superuser password for the project database,
reachable from any network via `aws-1-us-east-2.pooler.supabase.com:5432` as
`postgres.fgybyghwcjlstqxkclch`. It grants full read/write on every table, bypassing RLS entirely —
RLS constrains `anon` and `authenticated`, not `postgres`. Treat it as total database compromise if
the transcript is ever shared, synced, backed up, or included in a support bundle.

**What it does NOT affect.** Edge functions authenticate with the service-role key and the apps with
the anon key; neither is derived from this password, so neither needs reissuing. The Stripe keys are
unrelated and were never exposed.

**Rotate:** Supabase dashboard → Project Settings → Database → Reset database password.

**Before rotating**, check for anything holding a full Postgres connection string — the VPS
(`147.79.75.242`) keep-alive cron is the likely candidate. Application traffic is unaffected.

**After rotating**, do not paste the new value into a chat transcript. Put it in the local
environment or config that needs it and let tooling read it from there.

## Guidance

Anything pasted into a chat transcript should be considered public and rotated, regardless of how
the conversation ends. Transcripts get synced, exported and attached to bug reports.

For local tooling, keep secrets in `.env` files that are already gitignored and have the tool read
them from the environment. Scripts in this repo take secrets from environment variables only and
must never accept them as command-line arguments, where they would land in shell history and in
`ps` output for every other user on the machine.
