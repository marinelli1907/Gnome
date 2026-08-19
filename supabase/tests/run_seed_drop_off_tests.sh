#!/usr/bin/env bash
# Prove that no Seed Drop payment can be created while Coming Soon is on.
#
# Two halves, one verdict:
#   ARTIFACT  parses the shipped billing-checkout source and exercises its real
#             refusal predicate against adversarially shaped product keys, then
#             checks the web Seed Drop surface for purchase-path markers.
#   DATABASE  builds a throwaway local database and asserts that no seed
#             billing_products row is simultaneously active and price-configured.
#
# By default the database half reads the observed production snapshot embedded
# in seed_drop_off_suite.sql. Set GNOME_BILLING_SNAPSHOT_URL to a READ-ONLY
# Postgres connection string to test today's rows instead; the script only ever
# SELECTs through it.
#
# Nothing here touches a hosted project's schema: it refuses any non-local
# PGHOST and creates/drops its own database.
#
#   supabase/tests/run_seed_drop_off_tests.sh
set -uo pipefail

DB="${GNOME_SEED_OFF_TEST_DB:-gnome_seed_drop_off_test}"
HOST="${PGHOST:-/tmp}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

artifact_rc=0
db_rc=0

# ---------------------------------------------------------------- ARTIFACT
echo "=== ARTIFACT: the shipped checkout refuses every Seed Drop key ==="
GNOME_ROOT="$root" node <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.env.GNOME_ROOT;

const CHECKOUT = path.join(root, 'supabase/functions/billing-checkout/index.ts');
const GATE = path.join(root, 'supabase/functions/_shared/seed_drop_gate.ts');
// The complete purchasable set: three plan subscriptions, the boost, the pickup
// add-on, and the two $0.99 overage keys (0106). Anything else — above all any
// seed key — must be refused by the checkout allowlist.
// GNOME_SPONSOR_MONTHLY left this list in 0126: the sponsor tier retired from
// sale, so the gate BLOCKING it is now the correct behavior, not drift.
const MARKETPLACE = ['GNOME_FARM_MONTHLY', 'GNOME_GROWER_MONTHLY',
                     'GNOME_LISTING_PROMOTION', 'GNOME_PICKUP_LOCATION_ADDON',
                     'GNOME_LISTING_PUBLISH', 'GNOME_LISTING_RENEWAL'];

const results = [];
const check = (label, pass, detail) => results.push({ label, pass: !!pass, detail });

const checkout = fs.readFileSync(CHECKOUT, 'utf8');
const gate = fs.existsSync(GATE) ? fs.readFileSync(GATE, 'utf8') : null;

// Pull the literal array that follows an identifier, wherever it is declared:
// `new Set([...])` and `: readonly string[] = [...]` both land on the same
// bracket. Reading the real declaration is the point — a suite that restated
// the key list would pass against a file that no longer contains it. Scanning
// from the `=` skips the empty brackets in a `string[]` type annotation.
function listAfter(src, ident) {
  const at = src.indexOf(ident);
  if (at < 0) return null;
  const eq = src.indexOf('=', at);
  if (eq < 0) return null;
  const open = src.indexOf('[', eq);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']' && --depth === 0) {
      return [...src.slice(open, i + 1).matchAll(/'([^']*)'/g)].map((m) => m[1]);
    }
  }
  return null;
}
const same = (a, b) =>
  a && b && a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

const allow = listAfter(checkout, 'CHECKOUT_ALLOWED_KEYS');
const seedKeys = listAfter(checkout, 'SEED_DROP_KEYS');

check('A-01 billing-checkout declares a checkout allowlist', Array.isArray(allow),
      allow ? allow.join(', ') : 'CHECKOUT_ALLOWED_KEYS not found — cannot prove anything');
check('A-02 the allowlist contains no seed key',
      Array.isArray(allow) && !allow.some((k) => /SEED/i.test(k)),
      Array.isArray(allow) ? (allow.filter((k) => /SEED/i.test(k)).join(', ') || 'none') : 'unparsed');
check('A-03 the allowlist is exactly the marketplace keys', same(allow, MARKETPLACE),
      Array.isArray(allow) ? allow.join(', ') : 'unparsed');
check('A-04 the seed denylist names all five seed product keys',
      same(seedKeys, ['GNOME_SEED_DROP_SEASONAL', 'GNOME_SEED_DROP_ONE_TIME',
                      'GNOME_SEED_DROP_SUBSCRIPTION', 'GNOME_GROWER_SEED_BUNDLE',
                      'GNOME_FARM_SEED_BUNDLE']),
      Array.isArray(seedKeys) ? seedKeys.join(', ') : 'SEED_DROP_KEYS not found');

const comingSoon = /const\s+SEED_DROP_COMING_SOON\s*=\s*true\b/.test(checkout);
check('A-05 Coming Soon mode is on', comingSoon,
      comingSoon ? 'SEED_DROP_COMING_SOON = true' : 'flag is absent or not true');

// Ordering is the difference between a gate and a comment: the refusal has to
// happen before the product row is read and before a Stripe client exists.
const iRefuse = checkout.indexOf('SEED_DROP_COMING_SOON &&');
const iProduct = checkout.indexOf("from('billing_products')");
const iStripe = checkout.indexOf('new Stripe(');
check('A-06 the refusal runs before the billing_products read',
      iRefuse >= 0 && iProduct > iRefuse, `refuse@${iRefuse} product@${iProduct}`);
check('A-07 the refusal runs before any Stripe client is constructed',
      iRefuse >= 0 && iStripe > iRefuse, `refuse@${iRefuse} stripe@${iStripe}`);

const normalizes = /String\(body\.product_key[^)]*\)\s*\.trim\(\)\s*\.toUpperCase\(\)/.test(checkout);
check('A-08 the product key is normalized before it is judged', normalizes,
      normalizes ? 'String(...).trim().toUpperCase()' : 'no normalization found');

const seedBranch = /seed_drop_subscriptions|seedseason_/.test(checkout);
check('A-09 no Seed Drop checkout branch survives in billing-checkout', !seedBranch,
      seedBranch ? 'still resolves a seed subscription' : 'no seed branch');

// Behavioural: run the SHIPPED predicate, not a restatement of it.
const arrow = checkout.match(/const\s+isSeedDropKey\s*=\s*\(([^)]*)\)\s*=>\s*([^;]+);/);
let refusedBy = null;
if (arrow && Array.isArray(seedKeys)) {
  // Drop the TypeScript annotation off the parameter and back the Set by the
  // parsed array; everything else is the source as written.
  const param = arrow[1].split(':')[0].trim();
  const body = arrow[2].replace(/SEED_DROP_KEYS\.has\(/g, 'SEED_DROP_KEYS.includes(');
  const fn = new Function('SEED_DROP_KEYS', param, `return (${body});`);
  refusedBy = (k) => fn(seedKeys, k);
}
check('A-10 the shipped refusal predicate is executable', typeof refusedBy === 'function',
      refusedBy ? 'isSeedDropKey extracted and evaluated' : 'could not extract isSeedDropKey');

if (refusedBy && Array.isArray(allow)) {
  const norm = (v) => String(v ?? '').trim().toUpperCase();
  const gateOf = (raw) => {
    const k = norm(raw);
    if (comingSoon && refusedBy(k)) return 'SEED_DROP_COMING_SOON';
    return allow.includes(k) ? 'ALLOWED' : 'UNKNOWN_PRODUCT';
  };
  const mustRefuse = [
    'GNOME_SEED_DROP_SEASONAL', 'GNOME_SEED_DROP_ONE_TIME', 'GNOME_SEED_DROP_SUBSCRIPTION',
    'GNOME_GROWER_SEED_BUNDLE', 'GNOME_FARM_SEED_BUNDLE',
    ' gnome_seed_drop_seasonal ', 'Gnome_Seed_Drop_Seasonal', '\tGNOME_SEED_DROP_SEASONAL\n',
    ['GNOME_SEED_DROP_SEASONAL'], 'GNOME_SOME_FUTURE_SEED_THING',
  ];
  const leaked = mustRefuse.filter((k) => gateOf(k) !== 'SEED_DROP_COMING_SOON');
  check('A-11 every seed key shape is refused as Coming Soon', leaked.length === 0,
        leaked.length ? `leaked: ${leaked.map(String).join(' | ')}` : `${mustRefuse.length} shapes refused`);

  const junk = [undefined, null, '', {}, [], 'GNOME_GROWER_MONTHLY; DROP TABLE'];
  const wrong = junk.filter((k) => gateOf(k) === 'ALLOWED');
  check('A-12 malformed keys reach nothing', wrong.length === 0,
        wrong.length ? `allowed: ${wrong.map(String).join(' | ')}` : 'all rejected');

  const blocked = MARKETPLACE.filter((k) => gateOf(k) !== 'ALLOWED');
  check('A-13 the marketplace keys still pass the gate', blocked.length === 0,
        blocked.length ? `blocked: ${blocked.join(', ')}` : 'all allowed');
}

// The inline copy is authoritative for the deployed single-file function; this
// is what stops it drifting from the shared module other surfaces will import.
if (gate === null) {
  check('A-14 _shared/seed_drop_gate.ts agrees with the inline copy', false, 'shared module missing');
} else {
  const gAllow = listAfter(gate, 'CHECKOUT_ALLOWED_KEYS');
  const gSeed = listAfter(gate, 'SEED_DROP_KEYS');
  const gSoon = /export\s+const\s+SEED_DROP_COMING_SOON\s*=\s*true\b/.test(gate);
  check('A-14 _shared/seed_drop_gate.ts agrees with the inline copy',
        same(gAllow, allow) && same(gSeed, seedKeys) && gSoon === comingSoon,
        `allow=${same(gAllow, allow)} seed=${same(gSeed, seedKeys)} comingSoon=${gSoon === comingSoon}`);
}

// The web Seed Drop page is another surface entirely; these are the markers
// that turn it back into a checkout. Comments are stripped first — a header
// explaining that the payment links were removed names them, and flagging that
// as a purchase path would train people to ignore this test.
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const seedsDir = path.join(root, 'web/app/seeds');
const web = fs.existsSync(seedsDir)
  ? fs.readdirSync(seedsDir).filter((f) => /\.(tsx?|jsx?)$/.test(f))
      .map((f) => [f, decomment(fs.readFileSync(path.join(seedsDir, f), 'utf8'))])
  : [];
const marker = (re) => web.filter(([, s]) => re.test(s)).map(([f]) => f);

const links = marker(/NEXT_PUBLIC_SEED_LINK_|buy\.stripe\.com|client_reference_id=seed_/);
check('A-15 the web Seed Drop page has no payment link or checkout hand-off', links.length === 0,
      links.length ? `purchase markers in: ${links.join(', ')}` : `${web.length} file(s) clean`);

const prices = marker(/\$\d/);
check('A-16 the web Seed Drop page shows no price', prices.length === 0,
      prices.length ? `price copy in: ${prices.join(', ')}` : `${web.length} file(s) clean`);

let n = 0;
for (const r of results) {
  console.log(` ${String(++n).padStart(2)} ${r.pass ? 'PASS' : 'FAIL'}  ${r.label} — ${r.detail}`);
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} artifact cases pass`);
console.log(`SEED DROP OFF (artifact): ${passed === results.length ? 'ALL TESTS PASSED' : 'FAILURES PRESENT'}`);
process.exit(passed === results.length ? 0 : 1);
NODE
artifact_rc=$?

# ---------------------------------------------------------------- DATABASE
echo
echo "=== DATABASE: no seed billing row is armed ==="

case "$HOST" in
  /*|localhost|127.0.0.1) ;;
  *) echo "Refusing to run destructive tests against non-local host '$HOST'." >&2; exit 2 ;;
esac
pg_isready -h "$HOST" >/dev/null 2>&1 || { echo "No local Postgres on ${HOST}." >&2; exit 2; }

rows="$work/rows.sql"
: > "$rows"
if [ -n "${GNOME_BILLING_SNAPSHOT_URL:-}" ]; then
  # Read-only. Price ids are reduced to a presence marker so no Stripe
  # identifier is ever written to disk by this suite.
  if psql "$GNOME_BILLING_SNAPSHOT_URL" -Atq -F $'\t' -c "
      select key, kind, coalesce(unit_amount_cents::text,''), active,
             stripe_price_id_test is not null, stripe_price_id_live is not null,
             stripe_price_id is not null
        from public.billing_products order by key" > "$work/rows.tsv" 2>"$work/snap.err"; then
    while IFS=$'\t' read -r k kind amt act pt pl pleg; do
      [ -n "$k" ] || continue
      q() { [ "$1" = "t" ] && echo "'present'" || echo "null"; }
      printf "insert into public.billing_products (key,kind,description,unit_amount_cents,active,stripe_price_id_test,stripe_price_id_live,stripe_price_id) values ('%s','%s','snapshot',%s,%s,%s,%s,%s);\n" \
        "$k" "$kind" "${amt:-null}" "$act" "$(q "$pt")" "$(q "$pl")" "$(q "$pleg")" >> "$rows"
    done < "$work/rows.tsv"
    live=$(psql "$GNOME_BILLING_SNAPSHOT_URL" -Atq -c "select payments_live_enabled from public.billing_config limit 1" 2>/dev/null)
    [ -n "$live" ] && printf "insert into public.billing_config (id,payments_live_enabled) values (true,%s);\n" "$live" >> "$rows"
    echo "rows: LIVE snapshot from GNOME_BILLING_SNAPSHOT_URL ($(wc -l < "$rows" | tr -d ' ') statements)"
  else
    echo "rows: snapshot read FAILED — $(head -1 "$work/snap.err")" >&2
    : > "$rows"
  fi
fi
[ -s "$rows" ] || echo "rows: embedded snapshot in seed_drop_off_suite.sql (observed 2026-08-13)"

dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true
createdb -h "$HOST" "$DB" || { echo "createdb failed" >&2; exit 2; }
trap 'dropdb -h "$HOST" --if-exists "$DB" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

psql -h "$HOST" -d "$DB" -v ON_ERROR_STOP=1 -P pager=off \
     -v "rows_file=$rows" -f "$here/seed_drop_off_suite.sql" \
  | grep -vE '^(CREATE|GRANT|DO|SET|INSERT|UPDATE)'
db_rc=${PIPESTATUS[0]}

echo
if [ "$artifact_rc" -eq 0 ] && [ "$db_rc" -eq 0 ] \
   && ! psql -h "$HOST" -d "$DB" -Atq -c "select bool_and(pass) from t" 2>/dev/null | grep -q '^f$'; then
  echo "SEED DROP OFF: ALL TESTS PASSED"
  exit 0
fi
echo "SEED DROP OFF: FAILURES PRESENT"
exit 1
