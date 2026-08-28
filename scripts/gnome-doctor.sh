#!/usr/bin/env bash
# Safe workstation check for Gnome development. This script reports secret
# presence only; it never prints secret values.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPO_DIR="$ROOT/expo"
WEB_DIR="$ROOT/web"
ADMIN_DIR="$ROOT/admin"
SUPABASE_DIR="$ROOT/supabase"

PASS=0
WARN=0
FAIL=0

say() { printf '%s\n' "$*"; }
pass() { PASS=$((PASS + 1)); say "PASS  $*"; }
warn() { WARN=$((WARN + 1)); say "WARN  $*"; }
fail() { FAIL=$((FAIL + 1)); say "FAIL  $*"; }

have() { command -v "$1" >/dev/null 2>&1; }
require_cmd() {
  if have "$1"; then pass "$1: $($1 --version 2>/dev/null | head -1 || command -v "$1")"; else fail "$1 not found"; fi
}
optional_cmd() {
  if have "$1"; then pass "$1: $($1 --version 2>/dev/null | head -1 || command -v "$1")"; else warn "$1 not found"; fi
}

check_file_has_name() {
  local file="$1"
  local name="$2"
  if [ -f "$file" ] && grep -q "^${name}=" "$file"; then
    pass "$(basename "$file") contains $name"
  else
    warn "$(basename "$file") missing $name"
  fi
}

secret_present() {
  local name="$1"
  if [ -n "${!name:-}" ]; then pass "$name present in shell"; else warn "$name missing from shell"; fi
}

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
if [ -d /Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home ]; then
  export JAVA_HOME="${JAVA_HOME:-/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home}"
fi
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:/opt/homebrew/opt/postgresql@17/bin:$PATH"

say "Gnome doctor"
say "Root: $ROOT"
say

say "Git / GitHub"
require_cmd git
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  pass "repo: $(git -C "$ROOT" rev-parse --show-toplevel)"
  pass "branch: $(git -C "$ROOT" branch --show-current)"
  pass "HEAD: $(git -C "$ROOT" rev-parse --short HEAD)"
  dirty="$(git -C "$ROOT" status --short | wc -l | tr -d ' ')"
  if [ "$dirty" = "0" ]; then pass "git status clean"; else warn "git status has $dirty dirty/untracked path(s); preserve owner work"; fi
else
  fail "not inside a git repo"
fi
optional_cmd gh
if have gh && gh auth status >/dev/null 2>&1; then pass "GitHub CLI authenticated"; else warn "GitHub CLI not authenticated"; fi

say
say "Node / Packages"
require_cmd node
require_cmd npm
require_cmd npx
for dir in "$EXPO_DIR" "$WEB_DIR" "$ADMIN_DIR"; do
  if [ -f "$dir/package-lock.json" ]; then pass "$(basename "$dir") uses npm/package-lock"; else warn "$(basename "$dir") package-lock missing"; fi
  if [ -d "$dir/node_modules" ]; then pass "$(basename "$dir") node_modules present"; else warn "$(basename "$dir") node_modules missing; run npm ci"; fi
done

say
say "Expo / EAS"
if [ -d "$EXPO_DIR" ]; then
  if (cd "$EXPO_DIR" && npx expo --version >/dev/null 2>&1); then pass "Expo CLI available in expo/"; else fail "Expo CLI unavailable in expo/"; fi
  optional_cmd eas
  if have eas && (cd "$EXPO_DIR" && eas whoami >/dev/null 2>&1); then pass "EAS authenticated"; else warn "EAS not authenticated"; fi
  if have eas; then
    eas_env="$(cd "$EXPO_DIR" && eas env:list production --format short 2>/dev/null || true)"
    for name in EXPO_ANDROID_GOOGLE_MAPS_API_KEY EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY; do
      if printf '%s\n' "$eas_env" | grep -q "^${name}="; then pass "EAS production env has $name"; else warn "EAS production env missing $name"; fi
    done
  fi
fi
check_file_has_name "$EXPO_DIR/.env" EXPO_PUBLIC_SUPABASE_URL
check_file_has_name "$EXPO_DIR/.env" EXPO_PUBLIC_SUPABASE_ANON_KEY
secret_present EXPO_ANDROID_GOOGLE_MAPS_API_KEY

say
say "Android"
if [ -d "$ANDROID_HOME" ]; then pass "ANDROID_HOME path exists: $ANDROID_HOME"; else fail "ANDROID_HOME path missing: $ANDROID_HOME"; fi
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then pass "JAVA_HOME: $JAVA_HOME"; else warn "JAVA_HOME not set to a usable JDK"; fi
optional_cmd adb
optional_cmd emulator
if have adb; then adb devices -l | sed 's/^/      /'; fi
if have emulator; then
  avds="$(emulator -list-avds 2>/dev/null || true)"
  if [ -n "$avds" ]; then pass "Android AVDs: $(printf '%s' "$avds" | tr '\n' ' ')"; else warn "no Android AVDs found"; fi
fi
if [ -x "$EXPO_DIR/android/gradlew" ]; then
  if (cd "$EXPO_DIR/android" && ./gradlew --version >/dev/null 2>&1); then pass "Gradle wrapper starts"; else warn "Gradle wrapper needs JAVA_HOME/ANDROID_HOME check"; fi
fi

say
say "iOS / Xcode"
if have xcodebuild; then
  pass "xcodebuild found at $(command -v xcodebuild)"
  pass "$(xcodebuild -version | tr '\n' ' ')"
else
  warn "xcodebuild not found"
fi
if have xcrun && xcrun simctl list devices available >/dev/null 2>&1; then pass "simctl available"; else warn "simctl unavailable"; fi
if have xcrun && xcrun devicectl list devices >/dev/null 2>&1; then pass "devicectl available"; else warn "devicectl unavailable or no device provider"; fi
if security find-identity -v -p codesigning >/dev/null 2>&1; then pass "codesigning identities query works"; else warn "codesigning identities unavailable"; fi

say
say "Supabase / Postgres"
optional_cmd supabase
if have supabase && supabase projects list -o json >/dev/null 2>&1; then pass "Supabase CLI authenticated"; else warn "Supabase CLI not authenticated"; fi
if have supabase && supabase status --workdir "$SUPABASE_DIR" >/dev/null 2>&1; then pass "Supabase local stack running"; else warn "Supabase local stack not running or Docker unavailable"; fi
if have psql; then pass "$(psql --version)"; else warn "psql not found"; fi
if [ -x /opt/homebrew/opt/postgresql@17/bin/initdb ]; then pass "Postgres 17 initdb available"; else warn "Postgres 17 initdb not found"; fi
optional_cmd docker
optional_cmd deno

say
say "Web / Production"
check_file_has_name "$WEB_DIR/.env.local" NEXT_PUBLIC_SUPABASE_URL
check_file_has_name "$WEB_DIR/.env.local" NEXT_PUBLIC_SUPABASE_ANON_KEY
if curl -fsSI --max-time 20 https://gnomefarmersmarket.com >/dev/null 2>&1; then pass "production website reachable"; else fail "production website unreachable"; fi
if ssh -o BatchMode=yes -o ConnectTimeout=5 root@147.79.75.242 true >/dev/null 2>&1; then pass "VPS SSH reachable"; else warn "VPS SSH unavailable"; fi

say
say "Summary: $PASS pass, $WARN warn, $FAIL fail"
if [ "$FAIL" -gt 0 ]; then exit 1; fi
exit 0
