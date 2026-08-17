#!/usr/bin/env bash
# Deno type-check the edge functions.
#
#   supabase/tests/run_edge_typecheck.sh            # everything checkable
#   supabase/tests/run_edge_typecheck.sh billing-checkout stripe-webhook
#
# WHY THIS EXISTS
# esbuild was being used as a stand-in, and it only strips types — it parses TypeScript without
# checking it, so it reports success on code that does not typecheck at all. That is worse than no
# check, because it reads like one. `deno check` is what the functions actually run under.
#
# WHY SOME FUNCTIONS ARE SKIPPED, NOT FAILED
# The AI functions import a sibling ./providers.ts that does not exist in the repo: the shared
# adapter at _shared/providers.ts is copied in at deploy time. Checking them standalone therefore
# reports TS2307 for a file that will exist when it matters. Those are reported as SKIP so a real
# regression elsewhere is not lost in a wall of expected noise.
#
# Requires deno (brew install deno).
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FN="$here/../functions"

command -v deno >/dev/null 2>&1 || {
  echo "deno not installed — brew install deno" >&2; exit 2; }

# Functions that ALREADY fail type-checking, from before this check existed. They are listed so a
# NEW regression fails the run while these do not — a check that is permanently red gets ignored,
# which is the same as having no check. Each needs its own fix; none is a blocker for the billing
# work, and none should be "fixed" by changing runtime behavior:
#
#   billing-admin     stripe.accounts.retrieve() with no arguments. Valid at runtime — it retrieves
#                     the account behind the key — but stripe@22's types require 1-3. Type-only.
#   boardroom         TS2345, a SupabaseClient generic mismatch.
#   gnome-assistant   TS2307, a missing module that is NOT providers.ts.
#
# Delete a name from this list the moment its function is fixed, or the baseline rots into a
# permanent excuse.
KNOWN_FAILING="billing-admin boardroom gnome-assistant"

# deno colourises even when piped; the escapes end up embedded in the summary line otherwise.
strip_ansi() { sed $'s/\033\\[[0-9;]*[a-zA-Z]//g'; }

targets=()
if [ "$#" -gt 0 ]; then
  targets=("$@")
else
  while IFS= read -r d; do targets+=("$(basename "$d")"); done \
    < <(find "$FN" -mindepth 1 -maxdepth 1 -type d ! -name '_*' | sort)
fi

pass=0; fail=0; skip=0; known=0; failed_names=()

for name in "${targets[@]}"; do
  entry="$FN/$name/index.ts"
  [ -f "$entry" ] || continue

  out="$(deno check --no-lock "$entry" 2>&1 | strip_ansi)"
  if [ $? -eq 0 ] && ! printf '%s' "$out" | grep -q 'TS[0-9]'; then
    printf '  PASS  %s\n' "$name"; pass=$((pass + 1)); continue
  fi

  # A missing sibling providers.ts is the deploy-time bundling artifact, not a defect. Only treat
  # it as SKIP when that is the ONLY error — a function with a real error as well must still fail.
  real="$(printf '%s' "$out" | grep -E 'TS[0-9]+' | grep -v "Cannot find module .*providers\.ts" || true)"
  if [ -z "$real" ] && printf '%s' "$out" | grep -q "providers\.ts"; then
    printf '  SKIP  %-26s providers.ts is bundled at deploy\n' "$name"; skip=$((skip + 1)); continue
  fi

  # Functions that import OTHER _shared siblings (market-import pulls in the extraction schema,
  # which pulls in the draft schema) get the real treatment instead of a wider blind spot: stage
  # the deploy layout — index.ts beside copies of every _shared file — and check THAT. Taken when
  # every unresolved module is one _shared actually provides; other errors may be cascade noise
  # from the missing imports, and the STAGED result is what decides — a genuine type error still
  # fails there, in the exact layout the function deploys with.
  unresolved="$(printf '%s' "$real" | grep -oE "Cannot find module 'file://[^']*/([a-z_]+\.ts)'" | grep -oE '[a-z_]+\.ts' | sort -u || true)"
  if [ -n "$unresolved" ]; then
    all_shared=1
    while IFS= read -r m; do
      [ -f "$FN/_shared/$m" ] || { all_shared=0; break; }
    done <<< "$unresolved"
    if [ "$all_shared" -eq 1 ]; then
      stage="$(mktemp -d)"
      cp "$entry" "$stage/index.ts"
      cp "$FN/_shared/"*.ts "$stage/" 2>/dev/null
      out2="$(deno check --no-lock "$stage/index.ts" 2>&1 | strip_ansi)"
      rc2=$?
      rm -rf "$stage"
      if [ $rc2 -eq 0 ] && ! printf '%s' "$out2" | grep -q 'TS[0-9]'; then
        printf '  PASS  %-26s (staged with _shared siblings)\n' "$name"; pass=$((pass + 1)); continue
      fi
      real="$(printf '%s' "$out2" | grep -E 'TS[0-9]+' || true)"
    fi
  fi

  detail="$(printf '%s' "$real" | head -1 | tr -d '\r' | cut -c1-70)"
  case " $KNOWN_FAILING " in
    *" $name "*)
      printf '  known %-26s %s\n' "$name" "$detail"; known=$((known + 1)) ;;
    *)
      printf '  FAIL  %-26s %s\n' "$name" "$detail"
      fail=$((fail + 1)); failed_names+=("$name") ;;
  esac
done

echo
echo "edge typecheck: ${pass} passed, ${skip} skipped, ${known} known-failing, ${fail} new failures"
if [ "$fail" -gt 0 ]; then
  printf 'NEW failures: %s\n' "${failed_names[*]}"
  exit 1
fi
# A name on the baseline that now passes is good news the list should stop hiding.
for n in $KNOWN_FAILING; do
  case " ${targets[*]} " in *" $n "*) ;; *) continue ;; esac
  if deno check --no-lock "$FN/$n/index.ts" >/dev/null 2>&1; then
    echo "NOTE: ${n} now type-checks — remove it from KNOWN_FAILING."
  fi
done
