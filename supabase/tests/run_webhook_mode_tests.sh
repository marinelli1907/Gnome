#!/usr/bin/env bash
# §13 crossover matrix for stripe-webhook — drives the REAL handler over HTTP.
#
#   supabase/tests/run_webhook_mode_tests.sh
#
# No real Stripe key and no real Supabase are involved: the API keys are
# prefix-valid fakes, events are signed with signing secrets the test owns
# (constructEventAsync is an HMAC over body+signing secret; the API key plays no
# part), SUPABASE_URL points at an in-process mock PostgREST that records every
# write, and the spawned handler's network permission is restricted to
# localhost, so a code path that gets past the guard and tries a real API call
# fails locally instead of reaching stripe.com.
#
# What it proves (14 checks):
#   - a LIVE event is never served by a TEST key, in any configuration —
#     including a live-prefixed key misfiled in the TEST variable, and the
#     legacy single key unless its prefix proves the mode; and vice versa;
#   - the missing-key refusal is scoped to the ONE branch that asks Stripe a
#     question: every payload-only branch keeps processing with no key at all;
#   - the refusal deletes its stripe_events dedupe row and answers 503, so
#     Stripe retries and a resend after the key is configured processes once;
#   - an event whose livemode contradicts the mode-specific signing secret that
#     verified it is refused 400 before anything is written.
#
# Requires deno. Ports 8000 (handler) and 18272 (mock) must be free.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v deno >/dev/null 2>&1 || { echo "deno not installed — brew install deno" >&2; exit 2; }
exec deno run --allow-net --allow-env --allow-run "$here/webhook_mode/mode_matrix.ts"
