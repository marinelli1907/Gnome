#!/usr/bin/env bash
# Adversarial tests for the vision-output contract (_shared/listing_draft_schema.ts).
#
# Transpiles the REAL edge-function module to JS, then runs the suite under node
# so we are testing shipped code rather than a hand-copied duplicate.
#
#   supabase/tests/run_schema_tests.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
out="$here/.build"

rm -rf "$out"; mkdir -p "$out"

# TypeScript ships with the Expo app's devDependencies.
"$root/expo/node_modules/.bin/tsc" \
  "$root/supabase/functions/_shared/listing_draft_schema.ts" \
  --outDir "$out" --target es2022 --module es2022 --moduleResolution bundler \
  --strict --skipLibCheck >/dev/null

node "$here/listing_draft_schema.test.mjs"
