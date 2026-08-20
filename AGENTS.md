# Gnome — instructions for coding agents

Gnome is a local farmers-market marketplace. Neighbours sell, share, trade and
request produce; sellers run a "Market"; an AI assistant helps them list and
manage it. It is a real product with real users and a pending Google Play
release, not a sandbox.

## The four surfaces

| Path | What it is | Expo SDK |
|---|---|---|
| `expo/` | the customer app (iOS + Android), expo-router, new architecture | **~54.0.27** |
| `admin/` | a separate internal admin app, iOS only — no `android` block, no `eas.json` | **~57.0.12** |
| `web/` | the Next.js marketing + pricing site | — |
| `supabase/` | Postgres 17 schema, RLS, edge functions (Deno) | — |

**The two Expo apps are on different SDK versions.** Do not carry an API from
one into the other without checking. `admin/AGENTS.md` is correct about this and
still applies inside `admin/`.

## Hard rules — do not break these

1. **`billing_config.payments_live_enabled` must stay `false`.** Stripe is in
   TEST mode. Never flip this, never write a migration that flips it, never
   add a code path that bypasses it.
2. **Never commit or print secrets.** No API keys, signing keys, service-account
   JSON, or database passwords in code, logs, commit messages, or docs. If you
   need one, say so and stop — do not ask for it to be pasted into a chat.
3. **Production database is read-only to you.** `SELECT` to answer questions.
   Never `INSERT`/`UPDATE`/`DELETE`/DDL against production. Schema changes go
   through a migration file, reviewed before it is applied.
4. **No force pushes. No destructive git.** Do not `reset --hard`, `checkout --`,
   `clean`, or `stash` work you did not create. The tree usually carries
   pre-existing dirty and untracked files that belong to the owner — preserve
   them.
5. **Do not weaken `Device.isDevice`** in `expo/lib/notifications.ts` to make
   push appear to work on an emulator. Push must be proven on real hardware.
6. **Do not claim something works because it compiled.** Run it, or say you
   did not.

## The Map is the most dangerous file in the repo

`expo/components/MapListings.native.tsx`. A mistake here does not degrade the
map — it **destroys the React instance and whites out the entire app**. This has
happened before and is tracked as B1.

Any change touching that file, its props, its `provider`, or its markers
requires a full Map regression on a device or emulator afterwards: tiles render,
pins plot, Google attribution visible, and `adb logcat` clean of
`API key not found`, `getOrCreateDestroyTask`, and `Unhandled SoftException`.
Batch Map changes together so one regression covers them all.

Known and unfixed: the map has no `onMapReady` or loading state, so on a
cold-booted device the tab shows an empty grey box for up to ~90s while Play
services compiles its renderer.

## The pricing enum trap

Customer-facing tier names and Postgres enum values **do not match**. Read
`supabase/migrations/0126_three_tier_pricing.sql` before touching anything
tier-related.

| enum value | customer-facing name |
|---|---|
| `free` | Free — $0 |
| `grower` | **Pro** — $9.99/mo |
| `farm` | **Farm** — $29.99/mo |
| `sponsor` | **Legacy Farm** — retired, SKU deactivated, not sellable |

"Max" no longer exists as a customer-facing name anywhere. 0126 asserts this at
apply time and fails loudly if it reappears.

## Database discipline

- Migrations live in `supabase/migrations/`, numbered, and every applied one is
  recorded in `supabase/migrations/APPLIED.tsv`. Adding a file is not applying
  it; the ledger is the record of what production actually has.
- Test suites are in `supabase/tests/*.sql` and run against a local PG17 clean
  room, not production. On this Mac `initdb` needs `LC_ALL=C`.
- Money-touching changes must keep these green: `payment_hardening`,
  `renew_window`, `listing_allowance`, `lifecycle_guard`, `seed_drop_off`.

## Owner decisions currently in force

- **D1** — Android ships **no in-app digital purchase UI**. The gate is
  `expo/lib/digitalPurchase.ts` (`canBuyDigitalInApp = Platform.OS !== 'android'`).
  The $0.99 extra listing still exists in product and backend and is live on
  iOS and web. Do not add an Android purchase surface or a link-out to Stripe.
  Note the gate covers checkout call sites but **not** every `$0.99` string —
  several copy surfaces still leak on Android and are a known open defect.
- **D2** — "3 active Sell listings" is the target model but does **not** ship.
  Current enforcement is publishes-per-calendar-month.
- **D3** — six tabs: Browse · Map · Post · Ask AI · Market · Profile. The Market
  tab's **route is still `activity`** — only its title changed. Do not rename
  the route; deep links, notifications and both store submissions depend on it.
  Account deletion must stay at Profile → Settings → Delete my account.
- **D4** — annual pricing is post-launch. Monthly only.
- **D5** — never claim a feature that does not ship. "Priority support" and
  "advanced analytics" are banned words; so is any Rewards or Creator
  functionality, which exists as brand direction only.

## Visual identity

`docs/design/GNOME_IDENTITY.md` is authoritative. White canvas, charcoal type,
saturated colour. All colour flows from `expo/constants/colors.ts` — change the
token, not the call site.

Orange is the brand (`#F4700A` for fills and art, `#C2410C` where white text
sits on it). The five semantic hues sit underneath it: red = Market/Sell,
green = Garden/Grow, purple = Gnome AI, blue = Trade/Community,
yellow = Discovery. Colour is **never** the only signal — every listing-type
marker also carries a word.

Contrast is measured, not asserted. AA body is 4.5:1. Yellow never takes a white
label (1.63:1); it uses charcoal.

## Where the truth lives

- `docs/release/RELEASE_BOARD.md` — what is done, what is blocked, who owns it
- `docs/design/GNOME_IDENTITY.md` — the visual spec and owner decisions
- `docs/release/PLAY_STORE_LISTING.md` — store copy and submission answers
- `docs/MONETIZATION.md` — **stale**, still describes the pre-0126 four-tier
  model. Trust the migration over this file.

## Working style

State what you verified and how. If you could not verify something, say
"unverified" rather than asserting it. A confidently wrong claim costs more here
than a missing one — several have already reached production docs and had to be
walked back.
