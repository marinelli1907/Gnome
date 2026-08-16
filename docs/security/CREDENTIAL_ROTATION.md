# Credential rotation register

Credentials known to have been exposed, and their status. No secret values appear in this file, and
none should ever be added to it.

## OPEN — Stripe LIVE secret key (`sk_live_51U0Dg…`)

**Status: requires immediate rotation. Highest severity item here.**

**Exposed:** 2026-08-16, pasted in plaintext into an assistant chat transcript, in response to a
request for the *test* key. The prefix is `sk_live_`, not `sk_test_`.

**Scope.** A live secret key is unrestricted access to the production Stripe account: create and
capture charges, issue refunds, read full customer records including payment methods and billing
addresses, create and cancel subscriptions, and modify products and prices. It is the most damaging
credential in this project — worse than the database password, because it moves real money and the
loss is not recoverable by restoring a backup.

**It was not used.** No object was created with it, and it was never written to disk. The setup
script refuses any key beginning `sk_live_`/`rk_live_` unless `ALLOW_LIVE=1`, so an accidental run
would have failed closed. That guard is not the mitigation, though — the exposure happened at the
paste, not at the use.

**Rotate:** https://dashboard.stripe.com/apikeys → Secret key (live) → Roll key. Use a zero-second
grace window unless something in production is mid-request. Then update the Supabase edge-function
secret `STRIPE_SECRET_KEY_LIVE`.

**Afterwards**, check Stripe's dashboard for activity that is not yours: Developers → Logs shows
every API call with its key, and Payments shows charges. The account is `acct_1U0Dg…` (Boone Systems
LLC). Real revenue to date is $0, so any charge at all is worth investigating.

**Prevention.** Nothing in this project needs a live key during development. Test keys touch no real
money and can be rolled freely. Consider a restricted key (`rk_test_`) scoped to Products, Prices and
Coupons for setup scripts, so even the test credential cannot read customer data.

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
