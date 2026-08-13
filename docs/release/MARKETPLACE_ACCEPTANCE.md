# Marketplace acceptance audit — static + API half

Audited 2026-08-13 against working tree at `main` HEAD `54e141e` **plus the
uncommitted changes present in the tree at audit time** (see "Working tree is
in flight" below), and against live production
(`https://gnomefarmersmarket.com`, Supabase `fgybyghwcjlstqxkclch`).

## What "verified" means in this document

Three different confidence levels appear, and they are never mixed:

- **PROBED** — an actual HTTP request was made against production and the
  status code and response body are recorded here. This is the only class of
  claim in this document that is empirical.
- **CODE** — the implementing code was read and the file:line is cited. This
  proves the code exists and what it intends. It does **not** prove the feature
  works on a device.
- **CANNOT VERIFY WITHOUT A SESSION** — requires signing in, which this audit
  could not do. These are the items in the manual test script at the end.

Anything marked CODE has *not* been executed. A feature can be present, well
written, and still broken at runtime.

## Working tree is in flight

`git status` at audit time was **not clean** — sibling agents in this same
round were mid-edit. The audit reflects the tree as it stood, and the
distinction matters for the Seed Drop findings below:

```
 M expo/app/(tabs)/index.tsx                       (Seed Drop banner → in-app preview)
 M supabase/functions/billing-checkout/index.ts
 M supabase/functions/stripe-webhook/index.ts
 M web/app/pricing/page.tsx                        (Seed Drop pricing → Coming soon)
 M web/app/seeds/SeedProfileClient.tsx             (checkout removed)
 M web/app/seeds/page.tsx                          (priced product → Coming soon)
?? expo/components/SeedDropComingSoon.tsx
?? supabase/functions/_shared/seed_drop_gate.ts
?? supabase/migrations/0090_phone_validation_fix.sql
?? supabase/migrations/0091_founding_members.sql
```

None of that is committed, and **none of it is deployed**.

---

# BLOCKERS

## BLOCKER 1 — production is selling Seed Drop right now, with prices

**Status: PROBED. This is live on the public internet at the time of writing.**

`https://gnomefarmersmarket.com/seeds` returned HTTP 200 and rendered a
purchase page. Extracted visible text (verbatim):

> Pick your drop — 🌱 **Starter Pack $12** one-time · start here … **Build my
> box** … 📦 **Season Box $29** per season · 4 boxes a year … 🗓️ **Year-Round
> Grower $9** per month … Ships within the U.S., usually within a week of your
> order. **Subscriptions are managed through Stripe — change or cancel
> anytime.**

`https://gnomefarmersmarket.com/pricing` returned HTTP 200 and rendered:

> Grow with Gnome — **Seasonal Seed Drop — $24.99 per season** … Skip or cancel
> anytime. Build your garden profile → … **Grower + Seed Drop (~$199/yr)** and
> **Farm + Seed Drop (~$429/yr)** bundles are coming

The deployed page `<title>` is
`The Gnome Seed Drop — seeds picked for your zone, shipped to your door | Gnome`.
The repository's `web/app/seeds/page.tsx:14` sets
`title: 'The Gnome Seed Drop — coming soon'`. **The titles do not match, which
is conclusive proof the production web deploy is stale relative to the repo.**

This violates the launch constraint directly ("Seed Drop must ship as Coming
Soon only. No price, no date, no purchase"), and it advertises a subscription
for a product that has:

- no live Stripe price IDs (test prices only),
- `billing_config.payments_live_enabled = false`,
- no applied fulfilment schema (`0089_seed_drop_compliance_foundation.sql` is
  deliberately unapplied — confirmed against the live migration ledger, which
  ends at `profiles_public_projection` / 0087–0088),
- no supplier, no packet stock, and no shipping operation.

The fix is already written in the working tree by a sibling lane. **The
remaining blocker is entirely a deployment action, not a code action.**

**Required before launch:** commit the in-flight `web/app/seeds/*` and
`web/app/pricing/page.tsx` changes and run `web/deploy/deploy.sh` against the
Hostinger VPS. Then re-probe: `/seeds` must contain no `$` figure and no
"Build my box"; `/pricing` must contain no "$24.99". Until that deploy lands,
a customer can read a price and a Stripe promise on a product Gnome cannot
ship.

**Related, same root cause:** at HEAD, the mobile Seed Drop banner
(`expo/app/(tabs)/index.tsx`, pre-edit) called
`Linking.openURL('https://gnomefarmersmarket.com/seeds')` — i.e. the shipped
app would send an App Review reviewer straight to the priced page. The
in-flight change replaces this with an in-app `SeedDropComingSoon` modal. That
change must be in the submitted binary.

## Store-requirement checks — both PASS, neither is a blocker

The directive asked these to be flagged hard. Both were searched exhaustively
across `expo/` and `web/`. **Neither is missing.**

### ACCOUNT DELETION — IMPLEMENTED (App Store 5.1.1(v))

| Piece | Location | Confidence |
|---|---|---|
| In-app entry point | `expo/app/settings.tsx:155-169` ("Delete my account") | CODE |
| Two-step destructive confirm | `expo/app/settings.tsx:33-54` | CODE |
| Invocation | `expo/app/settings.tsx:59` → `supabase.functions.invoke('delete-account')` | CODE |
| Server implementation | `supabase/functions/delete-account/index.ts` | CODE |
| Identity from JWT, never request body | `supabase/functions/delete-account/index.ts:51-54` | CODE |
| Storage purge (grow-log, compliance-docs, listing-images) | `.../index.ts:71-73, 110-111` | CODE |
| Auth row deletion | `.../index.ts:119` | CODE |
| **Deployed to production** | edge function `delete-account`, status `ACTIVE`, version 6, `verify_jwt: true` | **PROBED** (Supabase management API) |
| Disclosed in privacy policy | `https://gnomefarmersmarket.com/privacy` — "delete your account from the app's Settings (or by emailing us)" | **PROBED** |

The function is deployed and the JWT is verified server-side, so one user
cannot delete another. Not a blocker.

### PASSWORD RESET — IMPLEMENTED on both platforms

| Piece | Location | Confidence |
|---|---|---|
| Mobile: request reset | `expo/providers/AuthProvider.tsx:122-126` (`resetPasswordForEmail`) | CODE |
| Mobile: deep-link redirect | `expo/providers/AuthProvider.tsx:123` — `Linking.createURL('auth-callback')` | CODE |
| Mobile: recovery session detection | `expo/providers/AuthProvider.tsx:68` (`PASSWORD_RECOVERY`) | CODE |
| Mobile: cold + warm deep-link handler | `expo/providers/AuthProvider.tsx:83-98` | CODE |
| Mobile: set new password | `expo/providers/AuthProvider.tsx:128-131` | CODE |
| Mobile: UI (forgot / reset modes) | `expo/app/sign-in.tsx:139-188`, entry at `:320-324` | CODE |
| Anti-enumeration (identical copy either way) | `expo/app/sign-in.tsx:151-162` | CODE |
| Web: request + set | `web/app/login/LoginClient.tsx:244`, `:256`; UI at `:307`, `:343` | CODE |

Not a blocker. **But see FIX BEFORE SUBMISSION 1** — there is a live
configuration risk that would make the mobile half of this fail, and it cannot
be verified without a session.

---

# FIX BEFORE SUBMISSION

## 1. `gnome://auth-callback` must be in Supabase's redirect allowlist

**CANNOT VERIFY WITHOUT A SESSION / dashboard access.** `/auth/v1/settings`
does not expose the redirect allowlist, and probing it would require sending a
real reset email.

`expo/providers/AuthProvider.tsx:123` sends `redirectTo = gnome://auth-callback`.
If that URL is not in **Auth → URL Configuration → Additional redirect URLs**,
Supabase silently falls back to Site URL and the reset link opens the
*website* instead of the app. The mobile password-reset acceptance item then
fails end-to-end even though every line of code is correct.

`docs/LAUNCH.md` records the intended additional redirect URLs as
`https://gnomefarmersmarket.com/**` only — with no `gnome://` entry. Treat as
unconfigured until Daniel confirms in the dashboard. Step 6 of the manual
script tests this directly.

## 2. "Get the app" links point at the bare App Store homepage

**PROBED.** The deployed `/seeds` HTML contains `href="https://apps.apple.com/"`.
`NEXT_PUBLIC_IOS_APP_URL` is unset in production, so every store CTA
(`web/app/layout.tsx:23`, `web/app/page.tsx:203` and `:295`,
`web/app/category/[category]/page.tsx:45`, `web/app/near/[city]/page.tsx:78`,
`web/app/listing/[slugId]/page.tsx:47`, `web/app/components/OpenInApp.tsx:5`,
`web/app/components/AppLink.tsx:6`) falls back to the App Store front page.

Naturally sequenced — the real URL does not exist until the app is approved —
but it must be set in the production env and redeployed on approval day, or
every "Get the app" button on the website is dead on arrival.

## 3. `docs/LAUNCH.md` is stale on auth providers

**PROBED.** `GET /auth/v1/settings` returned `"google": true, "apple": true`.
`docs/LAUNCH.md` still lists both as disabled blockers. Also live:
`mailer_autoconfirm: true` (email confirmation OFF — signup returns a session
immediately, which is good for App Review but means addresses are unverified)
and `disable_signup: false`.

Not a product defect; a stale runbook that will waste reviewer and owner time.

---

# FIX BEFORE PUBLICATION

## 4. Production has no real inventory — the marketplace is empty

**PROBED**, anonymously, against the REST API:

```
GET /rest/v1/public_listings?select=id   → 200, content-range: 0-5/6
GET /rest/v1/public_markets?select=id    → 200, content-range: 0-10/11
GET /rest/v1/public_profiles?select=id   → 200, content-range: 0-10/11
```

Six public listings exist. Their actual shape:

| Title | Type | is_demo |
|---|---|---|
| Sunny 3×6 bed — herbs or salad greens | plot | true |
| Seed swap — saving fall seeds? | wanted | true |
| extra pumpkins for the kids | wanted | true |
| Looking for local honey near Mentor | wanted | true |
| canning tomatoes (bulk) | wanted | true |
| Basil | wanted | false |

**There is not a single `free`, `sale`, or `trade` listing in production.** Five
of six are seeded demo rows; the sixth is a QA artefact. A reviewer or a first
real user opening Browse sees five "wanted" asks and one demo plot.

Of the 11 markets, 8 are demo/QA — including three named
`marinelli1907's Market`, `marinelli1907+gnometest1's Market`, and
`marinelli1907+pwtest1's Market`. Those default names are derived from the
email local part, so **the owner's email local part (including `+tag` test
addresses) is publicly readable by anyone with the anon key.** Mild PII leak,
and it reads as unfinished.

This is a launch-quality decision for Daniel, not a code defect: either seed
credible real inventory before publication, or accept that the empty-area
experience (which is well built — `expo/app/(tabs)/index.tsx:327-374`) is what
every early user sees. At minimum, rename or remove the three
`marinelli1907*` markets and the `Basil` QA listing.

---

# FIX WITHIN 72 HOURS

## 5. Follow / unfollow does not exist in the mobile app

**CODE.** Exhaustive grep across `expo/app`, `expo/lib`, `expo/components`,
`expo/providers` for `market_follows`, `Follow`, `unfollow`, `Following`
returned **zero matches**. The feature is web-only:
`web/app/components/FollowButton.tsx:17,29,32` and
`web/app/following/FollowingClient.tsx:30`.

Consequence: acceptance items "follow/unfollow" and "followed-market browse"
**cannot pass on iOS at all**. Mark them MISSING (mobile) / IMPLEMENTED (web).

## 6. Reorder and feature/unfeature do not exist in the mobile app

**CODE.** `market_position` and `market_featured` appear only in
`web/app/my/MyMarketClient.tsx:343-357` (reorder) and `:364-367`
(feature/unfeature, capped at 4). No mobile equivalent exists. The mobile
market editor (`expo/app/market/edit/[id].tsx`) covers name, description and
avatar only.

## 7. Mobile "record sale" is missing the external-card method

**CODE.** `expo/components/RecordSaleSheet.tsx:34-40` offers cash, venmo,
zelle, cashapp, check, other. The web sheet
(`web/app/my/MyMarketClient.tsx:60-61`) additionally offers
`external_card` ("Card (external)"). The type union
(`expo/lib/db.ts:1426`) and the server RPC
(`supabase/migrations/0048_market_ops.sql:577`) both accept `external_card` —
only the mobile picker omits it. One-line gap; a seller who took a Square
payment cannot categorise it on their phone.

---

# BACKLOG

## 8. Base `markets` table is anon-readable, including columns no UI writes yet

**PROBED.** `web/lib/gnome.ts:1-3` states the site "Reads ONLY the public_*
views (never base tables), so private fields are unreachable." That is true of
the *site*, but not of the *database*:

```
GET /rest/v1/markets?select=*  → 200, 11 rows, full row incl.
   lat, lng, zip, contact_email, contact_phone, approximate_location
```

Every value is currently `null`, so nothing leaks today, and RLS
(`0005_markets.sql:267-269`) correctly limits rows to `status='active'`. But
the grant is row-wide, so the moment any UI starts writing
`markets.contact_phone` or `markets.lat`, it becomes anonymously readable.
Today those fields are written nowhere — contact details go to
`user_private_contact` via `save_onboarding_contact`
(`expo/app/profile/edit.tsx:79`). Column-level revoke would close the door
before someone opens it.

## 9. Universal Links are not configured

**PROBED / CODE.** `web/public/` contains only `og.png` and `badge.png` — no
`.well-known/apple-app-site-association`. `expo/app.json:17-27` has no
`associatedDomains`, and the Android block has no https `intentFilters`. Deep
linking works via the custom scheme only (`expo/app.json:5` → `gnome://`,
consumed by `web/app/components/OpenInApp.tsx:29`). Functional, but Safari
shows a confirmation interstitial and a shared `gnomefarmersmarket.com/listing/…`
URL will never open the app directly.

---

# Acceptance matrix

The directive's 60 items are listed below expanded to **71 discrete checks**,
because several directive items name multiple variants (four listing types,
six payment methods, five credential states). Nothing was dropped.

Platform column: **M** = Expo mobile app, **W** = web.

## Account and identity

| # | Item | Status | Where | Confidence |
|---|---|---|---|---|
| 1 | Create account (email + password) | IMPLEMENTED M+W | `expo/providers/AuthProvider.tsx:100-109`; `expo/app/sign-in.tsx:201-205`; `web/app/login/LoginClient.tsx` | CODE |
| 2 | Create account (email code, no password) | IMPLEMENTED M+W | `expo/providers/AuthProvider.tsx:133-144`; `expo/app/sign-in.tsx:103-137` | CODE |
| 3 | Sign in with Google / Apple | IMPLEMENTED M | `expo/providers/AuthProvider.tsx:146-204`; buttons gated on live `/auth/v1/settings` at `expo/app/sign-in.tsx:52-69` | CODE + PROBED (both providers live) |
| 4 | Onboarding conversational flow | IMPLEMENTED M | `expo/app/onboarding.tsx:44-62` → edge fn `gnome-onboarding` (ACTIVE, v1) | CODE + PROBED (deployed) |
| 5 | Onboarding fallback form when AI is down | IMPLEMENTED M | `expo/app/onboarding.tsx:78-101, 164-179` — writes the same validated RPC | CODE |
| 6 | Onboarding skip | IMPLEMENTED M | `expo/app/onboarding.tsx:103-106, 117-119` → `skip_onboarding` | CODE |
| 7 | Onboarding resume | PARTIAL M | Routed back while incomplete: `expo/app/(tabs)/_layout.tsx:29-31`. **Skip is permanent** — `skip_onboarding` sets `onboarding_completed_at = now()` (`0086:235-236`), so a skipped user is never re-prompted. Deliberate, but "resume" only means "resume an unfinished conversation", never "resume after skipping". | CODE |
| 8 | Profile edit | IMPLEMENTED M+W | `expo/app/profile/edit.tsx:60,79` (`my_onboarding_state`, `save_onboarding_contact`); `web/app/login/LoginClient.tsx:49` | CODE |
| 9 | Public display name is "First L." only | IMPLEMENTED | `public_profiles` returns `name: "Tom R."`, `"Daniel M."` — no full names, no emails | **PROBED** |
| 10 | Logout / login | IMPLEMENTED M | `expo/providers/AuthProvider.tsx:206-215` — unregisters push *before* signout, `scope: 'local'` so other devices survive | CODE |
| 11 | Account deletion | IMPLEMENTED M | See blocker section — deployed and JWT-verified | CODE + PROBED |
| 12 | Password reset | IMPLEMENTED M+W | See blocker section; **redirect allowlist unverified** | CODE |

## Market

| # | Item | Status | Where | Confidence |
|---|---|---|---|---|
| 13 | Create Market | IMPLEMENTED (implicit) | Auto-created by the `on_auth_user_created` trigger — `0001_init.sql:145`, `0051_market_not_garden.sql:21`. There is no explicit "create a Market" step; every account has one. | CODE |
| 14 | Rename Market | IMPLEMENTED M+W | `expo/app/market/edit/[id].tsx:104`; `web/app/my/MyMarketClient.tsx:280` | CODE |
| 15 | Customise Market (photo, blurb) | IMPLEMENTED M+W | `expo/app/market/edit/[id].tsx:96-110` (avatar + description) | CODE |
| 16 | Customise Market (tagline, theme) | MISSING M / IMPLEMENTED W | `web/app/my/MyMarketClient.tsx:636,643-644`. No mobile equivalent. | CODE |
| 17 | Follow a Market | **MISSING M** / IMPLEMENTED W | `web/app/components/FollowButton.tsx:32` | CODE |
| 18 | Unfollow a Market | **MISSING M** / IMPLEMENTED W | `web/app/components/FollowButton.tsx:29` | CODE |
| 19 | Followed-market browse | **MISSING M** / IMPLEMENTED W | `web/app/following/FollowingClient.tsx:30`; `/following` returned 200 | CODE + PROBED |

## Listings

| # | Item | Status | Where | Confidence |
|---|---|---|---|---|
| 20 | Create Free listing | IMPLEMENTED M | `expo/app/(tabs)/post.tsx:76-78, 287`; `expo/lib/db.ts:293` | CODE |
| 21 | Create Sale listing | IMPLEMENTED M | `expo/app/(tabs)/post.tsx:190, 250, 443` | CODE |
| 22 | Create Trade listing | IMPLEMENTED M | `expo/app/(tabs)/post.tsx:272, 457` | CODE |
| 23 | Create Wanted listing | IMPLEMENTED M | `expo/app/(tabs)/post.tsx:156, 585` | CODE |
| 24 | Create Plot listing (bonus) | IMPLEMENTED M | `expo/app/(tabs)/post.tsx:250, 585` | CODE |
| 25 | Reorder listings | **MISSING M** / IMPLEMENTED W | `web/app/my/MyMarketClient.tsx:343-357` | CODE |
| 26 | Feature listing | **MISSING M** / IMPLEMENTED W | `web/app/my/MyMarketClient.tsx:364-367` (max 4) | CODE |
| 27 | Unfeature listing | **MISSING M** / IMPLEMENTED W | same | CODE |
| 28 | Edit listing | IMPLEMENTED M | `expo/app/edit-listing/[id].tsx`; `expo/lib/db.ts:504` | CODE |
| 29 | Plan cap enforced | IMPLEMENTED (server-side) | `0008_plan_limits.sql:44-49` raises `PLAN_LIMIT_REACHED`; free=5, grower=25, farm=unlimited per live `plan_limits` | CODE + PROBED (`plan_limits` read anonymously, grower `max_active_listings: 25`) |

## Browse, map, discovery

| # | Item | Status | Where | Confidence |
|---|---|---|---|---|
| 30 | Browse by distance | IMPLEMENTED M | `expo/app/(tabs)/index.tsx:53, 264-289`; `expo/components/DistancePicker.tsx` | CODE |
| 31 | Browse by type | IMPLEMENTED M | `expo/app/(tabs)/index.tsx:97` (`listingType`) | CODE |
| 32 | Browse by category | IMPLEMENTED M | `expo/app/(tabs)/index.tsx:235-247`; `expo/components/TaxonomyPicker.tsx` | CODE |
| 33 | Browse renders (web) | IMPLEMENTED W | `/browse` → 200, 24932 bytes, `<title>Browse fresh listings near you \| Gnome</title>`. Listing cards are client-rendered, so the SSR HTML contains no `/listing/` hrefs — this is expected, not a defect; the market page SSR does emit them. | **PROBED** |
| 34 | Empty-area experience | IMPLEMENTED M | `expo/app/(tabs)/index.tsx:327-374` — three distinct empty states with actions | CODE |
| 35 | Map privacy | IMPLEMENTED | `0009_map_privacy.sql:18-21` — `approx_lat/lng` are generated columns rounded to 2 dp (~0.7 mi); `:32` grants only those to anon. Map screen reads `useListings` only (`expo/app/(tabs)/map.tsx:13,50`). | **PROBED**: `GET /listings?select=lat,lng` → **401 permission denied**; `GET /listings?select=approx_lat,approx_lng` → **200** `[{"approx_lat":41.54,"approx_lng":-81.49}]`; `public_listings.lat` → **400 column does not exist** |
| 36 | Listing page renders (web) | IMPLEMENTED W | `/listing/sunny-3-6-bed-herbs-or-salad-greens-50ba0aac-…` → 200, title `Plot: Sunny 3×6 bed — herbs or salad greens near Richmond Heights, OH \| Gnome`. A malformed slug returns 200 with `Listing unavailable` rather than a crash. | **PROBED** |
| 37 | Market page renders (web) | IMPLEMENTED W | `/market/maria-g-s-garden-61f738bc` → 200, title `Maria G.'s Market \| Local Market on Gnome \| Gnome`, emits `/listing/…` hrefs | **PROBED** |

## Exchange

| # | Item | Status | Where | Confidence |
|---|---|---|---|---|
| 38 | Claim a listing | IMPLEMENTED M | `expo/lib/db.ts:377`; `expo/app/request/[listingId].tsx` | CODE |
| 39 | Approve a claim | IMPLEMENTED M | `expo/components/mygnome/ClaimsToReview.tsx:45,100`; `expo/lib/db.ts:429` | CODE |
| 40 | Reject a claim | IMPLEMENTED M | `expo/components/mygnome/ClaimsToReview.tsx:45,104` (`declined`) | CODE |
| 41 | Message in claim thread | IMPLEMENTED M | `expo/lib/db.ts:1024`; realtime at `:999`; UI `expo/app/chat/[claimId].tsx` | CODE |
| 42 | Pickup coordination | IMPLEMENTED M+W | `expo/lib/marketops.ts:510-517` (`confirm_market_order`, `propose_order_time`, `mark_order_ready`); `:606` buyer-on-the-way; web `web/app/my/PickupOrdersManager.tsx:144-193` | CODE |
| 43 | Complete exchange | IMPLEMENTED M | `expo/components/mygnome/MyListingsView.tsx:108-114`; order path `expo/lib/marketops.ts:517` | CODE |

## Money — Sales Notebook

| # | Item | Status | Where | Confidence |
|---|---|---|---|---|
| 44 | Record payment after completing an exchange | IMPLEMENTED M | Bridge at `expo/components/mygnome/MyListingsView.tsx:43-63`; idempotent server-side per claim | CODE |
| 45 | Record cash sale | IMPLEMENTED M+W | `expo/components/RecordSaleSheet.tsx:35` | CODE |
| 46 | Record Venmo sale | IMPLEMENTED M+W | `expo/components/RecordSaleSheet.tsx:36` | CODE |
| 47 | Record Zelle sale | IMPLEMENTED M+W | `expo/components/RecordSaleSheet.tsx:37` | CODE |
| 48 | Record Cash App sale | IMPLEMENTED M+W | `expo/components/RecordSaleSheet.tsx:38` | CODE |
| 49 | Record check sale | IMPLEMENTED M+W | `expo/components/RecordSaleSheet.tsx:39` | CODE |
| 50 | Record external card sale | **MISSING M** / IMPLEMENTED W | Web `web/app/my/MyMarketClient.tsx:61`. Mobile picker omits it although `expo/lib/db.ts:1426` and `0048_market_ops.sql:577` both accept it. | CODE |
| 51 | Quick sale without a listing | IMPLEMENTED M+W | `expo/app/notebook.tsx` "Record sale" opens the sheet with `salePrefill = null` | CODE |
| 52 | Inventory decrement | IMPLEMENTED (server-side) | `0048_market_ops.sql:395, 455` decrement on confirm/complete; `:484` restores on cancel; `:177` guards double-count | CODE |
| 53 | Void transaction | IMPLEMENTED M+W | `expo/lib/db.ts:1474` → `void_sale`; UI `expo/app/notebook.tsx:95-109` (reason required); web `web/app/my/MyMarketClient.tsx:324` | CODE |
| 54 | Record expense | IMPLEMENTED M+W | `expo/lib/db.ts:1491`; 8 categories at `expo/app/notebook.tsx:33` | CODE |
| 55 | Sales Notebook summary | IMPLEMENTED M+W | `expo/app/notebook.tsx:58+` monthly gross / count / items / expenses / by-method breakdown. CSV export is deliberately web-only (`expo/app/notebook.tsx:268`). | CODE |

## Safety and compliance

| # | Item | Status | Where | Confidence |
|---|---|---|---|---|
| 56 | Block a neighbor | IMPLEMENTED M | `expo/lib/db.ts:717`; entry points `expo/app/listing/[id].tsx:296`, `expo/app/market/[id].tsx:104`; unblock in `expo/app/settings.tsx:94-99` | CODE |
| 57 | Report a listing / market | IMPLEMENTED M | `expo/lib/db.ts:681`; `expo/app/listing/[id].tsx:100-108, 293` | CODE |
| 58 | Regulated listing without credentials | IMPLEMENTED M | `expo/components/ComplianceGate.tsx:125-137` (`CREDENTIAL_REQUIRED`) + server BEFORE-trigger re-check (`0044_compliance_trigger_automation.sql`) | CODE |
| 59 | CREDENTIAL_REQUIRED state | IMPLEMENTED M | `expo/components/ComplianceGate.tsx:125-137` | CODE |
| 60 | CREDENTIAL_PENDING state | IMPLEMENTED M | `expo/components/ComplianceGate.tsx:139-156` | CODE |
| 61 | CREDENTIAL_DENIED state | IMPLEMENTED M | `expo/components/ComplianceGate.tsx:158-173` — surfaces the admin's reason | CODE |
| 62 | CREDENTIAL_EXPIRED state | IMPLEMENTED M | `expo/components/ComplianceGate.tsx:175-186` | CODE |
| 63 | PROHIBITED state | IMPLEMENTED M | `expo/components/ComplianceGate.tsx:199-207` | CODE |
| 64 | REVIEW_REQUIRED state | IMPLEMENTED M | `expo/components/ComplianceGate.tsx:188-197` | CODE |
| 65 | PLAN_REQUIRED state (bonus) | IMPLEMENTED M | `expo/components/ComplianceGate.tsx:103-123` | CODE |
| 66 | Unknown-jurisdiction guard (bonus) | IMPLEMENTED M | `expo/components/ComplianceGate.tsx:32-49` — refuses to present a default verdict as final | CODE |
| 67 | Admin credential review | IMPLEMENTED W | `web/app/admin/ComplianceClient.tsx:272` → `admin_review_credential` RPC; reason mandatory on deny/resubmit/revoke (`:269`); `/admin` returned 200 | CODE + PROBED |

## Gnome AI

| # | Item | Status | Where | Confidence |
|---|---|---|---|---|
| 68 | Gnome AI guidance | IMPLEMENTED M | `expo/app/(tabs)/ai.tsx`; edge fns `gnome-assistant` (v3), `ask-gnome` (v9), `garden-planner` (v13) all ACTIVE | CODE + PROBED (deployed) |
| 69 | Multi-photo drafts, one per photo | IMPLEMENTED M | `expo/app/(tabs)/ai.tsx:7-11`; `draft-listing` edge fn v15 ACTIVE; strict schema `supabase/functions/_shared/listing_draft_schema.ts:3` ("RECOVERY MAY FIX SYNTAX, NEVER MEANING") | CODE + PROBED (deployed) |
| 70 | Junk photo skipped, never guessed | IMPLEMENTED M | `expo/app/(tabs)/ai.tsx:120-129` — counts `skipped`, tells the user "I left them out rather than guess" | CODE |
| 71 | Edit draft | IMPLEMENTED M | `expo/app/(tabs)/ai.tsx:56, 165-171` | CODE |
| 72 | Publish draft | IMPLEMENTED M | `expo/app/(tabs)/ai.tsx:147-149` → `publish_listing_draft` (runs the same triggers as a hand-written post) | CODE |
| 73 | Plan cap surfaced on publish | IMPLEMENTED M | `expo/app/(tabs)/ai.tsx:156-159` — `PLAN_LIMIT_REACHED` → "Upgrade or pause a listing" | CODE |
| 74 | Publish All excludes regulated | IMPLEMENTED M | `expo/app/(tabs)/ai.tsx:193-196` — `if (d.compliance_attention) continue` | CODE |
| 75 | AI provider actually answers | **CANNOT VERIFY WITHOUT A SESSION** | `supabase/functions/_shared/providers.ts:61-63` — Gemini / OpenAI / Anthropic chain with Gemini free-tier fallback. Every AI edge fn has `verify_jwt: true`, so no anonymous probe is possible. Memory records the provider as previously blocked on credits. **Step 12 of the manual script.** | — |

## Resilience, store, legal

| # | Item | Status | Where | Confidence |
|---|---|---|---|---|
| 76 | Network failure / retry | IMPLEMENTED M | `expo/app/_layout.tsx:34-36` (`retry: 1`); `expo/components/ui.tsx` `ErrorState` always renders a "Try again" button when `onRetry` is passed | CODE |
| 77 | Offline | IMPLEMENTED M | `expo/components/OfflineBanner.tsx` — NetInfo-driven persistent banner, cached react-query data stays visible underneath; mounted app-wide at `expo/app/_layout.tsx:69` | CODE |
| 78 | Cold start | **CANNOT VERIFY WITHOUT A DEVICE** | `expo/app/_layout.tsx:26,57-61` splash held until fonts load; `expo/providers/AuthProvider.tsx:58-62` never strands on the splash (`.catch(() => {})`) | CODE |
| 79 | Deep link | PARTIAL | Custom scheme only — `expo/app.json:5` `gnome://`; cold + warm handled at `expo/providers/AuthProvider.tsx:83-98`; push routing `expo/lib/useNotificationRouting.ts:24-50`. **No Universal Links** (backlog item 9). | CODE |
| 80 | Push notifications | **CANNOT VERIFY WITHOUT A DEVICE** | `expo/lib/notifications.ts:20-45` registration; `notify` edge fn v13 ACTIVE; routing `expo/lib/useNotificationRouting.ts` | CODE + PROBED (fn deployed) |
| 81 | Terms reachable | IMPLEMENTED | `/terms` → **200**, 29828 bytes. Linked from `expo/app/sign-in.tsx:371` and `expo/app/settings.tsx:173`. | **PROBED** |
| 82 | Privacy reachable | IMPLEMENTED | `/privacy` → **200**, 27998 bytes. Covers deletion rights and gives `hello@gnomefarmersmarket.com`. Linked from `expo/app/sign-in.tsx:375`, `expo/app/settings.tsx:181`. | **PROBED** |
| 83 | Trust & Safety reachable | IMPLEMENTED | `/trust` → **200**, 36055 bytes. Linked from `expo/app/settings.tsx:189`. | **PROBED** |
| 84 | Seed Drop shows "Coming Soon" only | **FAILS IN PRODUCTION** | See BLOCKER 1. Fix written but undeployed. Mobile fix (`expo/components/SeedDropComingSoon.tsx`) uncommitted. | **PROBED** |
| 85 | No purchase route to Seed Drop | **FAILS IN PRODUCTION** | Live `/seeds` has "Build my box" CTAs and a Stripe subscription promise. See BLOCKER 1. | **PROBED** |

---

# Anonymous privacy sweep — full results

Every table in the schema was requested with the production anon key
(`GET /rest/v1/<table>?select=*&limit=2`). **No private data was returned by
any of them.** Two outcomes, both correct:

**HTTP 401 — no table-level grant to `anon`:**
`profiles`, `listings`, `market_orders`, `buyer_delivery_addresses`,
`market_pickup_locations`, `stripe_events`, `seed_drop_subscriptions`

**HTTP 200 with `[]` — grant exists, RLS returns zero rows:**
`user_private_contact`, `claims`, `claim_messages`, `market_order_items`,
`seller_credentials`, `device_tokens`, `reports`, `claim_reports`,
`user_blocks`, `feedback`, `events`, `market_pickup_private`,
`market_payment_methods`, `market_subscriptions`, `billing_config`,
`billing_events`, `admin_users`, `admins`, `admin_audit_log`, `seed_profiles`,
`seed_orders`, `listing_drafts`, `ai_chat_messages`, `ai_rooms`,
`ai_room_messages`, `compliance_audit_log`

**HTTP 200 with rows — public by design:**
`markets` (11 rows, all geo/contact columns null — see backlog 8),
`plan_limits` (pricing data), and the `public_*` views.

Targeted column probes:

| Probe | Result |
|---|---|
| `listings?select=lat,lng` | **401** permission denied |
| `listings?select=approx_lat,approx_lng` | **200** `[{"approx_lat":41.54,"approx_lng":-81.49}]` — 2 dp, ~0.7 mi |
| `profiles?select=zip_code` | **401** permission denied |
| `public_listings?select=lat` | **400** column does not exist |
| `public_profiles?select=*` | **200** — id, name ("Tom R."), avatar_url, city, county, state, user_type, business_account, business_category, created_at. No email, no phone, no full name, no admin flags. |

**Verdict: the anonymous attack surface is clean.** Migration 0087
(`profiles_public_projection`) is confirmed applied in production — the live
migration ledger ends at it, and `profiles` is no longer anon-readable, which
is exactly what 0087 was written to do. `docs/security/PROFILE_VISIBILITY.md`
still says "NOT applied to production" and should be corrected.

## Public page HTTP sweep

All returned **200**:

| Path | Bytes | Path | Bytes |
|---|---|---|---|
| `/` | 82343 | `/plots` | 39593 |
| `/browse` | 24932 | `/garden` | 28605 |
| `/terms` | 29828 | `/following` | 24896 |
| `/privacy` | 27998 | `/my` | 24151 |
| `/trust` | 36055 | `/admin` | 23291 |
| `/pricing` | 34856 | `/near/cleveland` | 41535 |
| `/login` | 25399 | `/category/vegetables` | 24953 |
| `/sell` | 26051 | `/robots.txt` | 116 |
| `/seeds` | 35066 | `/sitemap.xml` | 5165 |

`/my` and `/admin` return 200 to anonymous visitors because they are client
components that render a sign-in card — no data crosses the wire, confirmed by
the table sweep above.

---

# Manual test script

Everything below requires a signed-in session and could not be run by this
audit. Designed for **under an hour**. Use a fresh throwaway email —
`mailer_autoconfirm` is ON, so no inbox confirmation is needed to get in.

**Do not create these on production if you intend to leave them there.** Delete
the account at step 22, which cleans up everything it made.

## Part A — Account, onboarding, profile (mobile, ~10 min)

| # | Step | Expected result |
|---|---|---|
| 1 | Cold-launch the app with no session. | Splash holds until fonts load, then Browse. No infinite spinner. |
| 2 | Tap into sign-in. Note which buttons appear. | Google **and** Apple buttons both render (both providers confirmed live). If either is missing, `/auth/v1/settings` disagrees with the client. |
| 3 | Create an account with a new email + password. | Signed in immediately — no "confirm your email" wall. |
| 4 | Onboarding chat appears. Answer two questions, then force-quit the app and reopen. | You are routed **back into onboarding**, not the tabs. Prior answers are stored. |
| 5 | Finish onboarding (or tap "Skip for now"). | Lands on Browse. **Then force-quit and reopen: onboarding must NOT appear again** — skip is permanent by design. |
| 6 | **Password reset (the risky one).** Sign out. Sign-in screen → "Already have an account? Sign in" → "Forgot your password?" → enter your email. Open the email **on the device**. | The link must **open the Gnome app** and show "Set a new password". **If it opens the website instead, `gnome://auth-callback` is missing from Supabase → Auth → URL Configuration → Additional redirect URLs.** This is FIX BEFORE SUBMISSION 1. |
| 7 | Set a new password, then sign in with it. | Signed in. |
| 8 | Profile → edit. Set first name, last name, city, state. Save. | Saves without error. |
| 9 | Open your own listing from another account (or check `/market/<your-slug>` on the web). | Your public name shows as **"First L."** only — never your full name or email. |

## Part B — Market and listings (mobile, ~10 min)

| # | Step | Expected result |
|---|---|---|
| 10 | My Market → edit. Rename it, add a photo and a description. | Saves; the name appears on your Market page. |
| 11 | Post one listing of **each** type: Free, Sale (with a price), Trade (with "trade for"), Wanted. | All four publish. Sale requires a price; Trade requires a trade-for value. |
| 12 | **AI tab** → add 3 photos, one of which is deliberate junk (a blank wall or a screenshot). | You get **2 drafts, not 3**, and Gnome says one photo "didn't come through cleanly — I left it out rather than guess." **If the AI tab errors instead, the provider has no credits — this is the one AI item that could not be verified at all.** |
| 13 | Edit one draft's title, then Publish it. | Publishes as a normal listing with your edit. |
| 14 | Keep posting until you hit 5 active listings on the free plan, then post a 6th. | Blocked with "You're at your plan's active listing limit." (server-enforced, not a UI guess). |
| 15 | Try to post something regulated (eggs, dairy, canned goods) with no credential on file. | A "Seller verification needed" card appears with an **Upload credential** button, and the listing can still be saved as a draft. |
| 16 | On the AI tab with a mix of drafts, tap **Publish all**. | Anything flagged regulated is **skipped**, not published. |

## Part C — Browse, map, exchange (mobile, ~10 min)

| # | Step | Expected result |
|---|---|---|
| 17 | Browse: change the distance filter, the type filter, and the category filter. | Each narrows the feed. With distance set and no location granted, a hint offers to use current location. |
| 18 | Set distance to 1 mile in an area with nothing nearby. | A useful empty state with an action — not a blank screen. |
| 19 | Open the Map tab. Tap a pin and compare it with the listing's real address. | The pin is **coarse** (~0.7 mi grid), never the exact address. Already proven at the API layer; this confirms the UI honours it. |
| 20 | From a second account, claim one of your listings. Approve it. Send messages both ways. | Claim appears under Requests to review; approval opens a chat; messages arrive live. |
| 21 | Repeat with a second claim and **Reject** it. | Claim moves to declined; the claimant is notified. |
| 22 | Complete the exchange from the owner side. | "Mark complete" prompts to log the payment. |

## Part D — Money (mobile, ~10 min)

| # | Step | Expected result |
|---|---|---|
| 23 | Accept the "Record the payment?" prompt from step 22. | Sale sheet opens pre-filled with the listing and buyer. |
| 24 | Record it as **Cash**. Then tap Record sale again for the same claim. | Second attempt reports "already recorded" — **it must not double-count**. |
| 25 | Sales notebook → Record sale (no listing). Enter an amount, pick **Venmo**. | Quick sale recorded with no listing attached. |
| 26 | Repeat for **Zelle**, **Cash App**, **Check**. | All four recorded and visible in the by-method summary. |
| 27 | Look for a **Card (external)** option. | **It is absent on mobile** — expected gap, FIX WITHIN 72 HOURS 7. Confirm it is present on the web notebook. |
| 28 | Sell an item that has an inventory count set. | Inventory decrements by the quantity sold. |
| 29 | Void one transaction with a reason. | Row stays visible marked void; the monthly gross drops accordingly. |
| 30 | Record an expense (seeds, $12). | Appears in the monthly summary as an expense. |
| 31 | Check the monthly summary card. | Gross, sale count, item count, expenses, and a per-method breakdown all reconcile with what you entered. |

## Part E — Safety, resilience, store surfaces (mobile, ~8 min)

| # | Step | Expected result |
|---|---|---|
| 32 | From a listing, tap **Report**. Then tap **Block**. | Report is silent and stored privately; block hides that seller's listings. |
| 33 | Settings → Blocked neighbors → Unblock. | Seller reappears in Browse. |
| 34 | Turn on Airplane Mode while Browse is open. | Persistent "You're offline. Showing the latest saved listings." banner; cached listings remain readable. |
| 35 | Still offline, pull to refresh. | An error state with a **Try again** button — never a silent failure or a crash. |
| 36 | Restore the network and tap Try again. | Feed reloads. |
| 37 | Settings → tap Terms, Privacy, Trust & Safety. | All three open in the browser at gnomefarmersmarket.com. (Already PROBED as 200; this confirms the links.) |
| 38 | Browse tab → tap the **Seed Drop** banner. | **Must open an in-app "Coming soon" preview with no price, no date, and no way to buy or join a waitlist.** If it opens the website, the in-flight mobile change is not in this build. |
| 39 | Send yourself a push (have the second account message you). Background the app first. Tap the notification. | App opens directly to the pickup chat. |
| 40 | Force-quit, then tap another notification from a fully closed state. | Cold-start routing lands on the right screen. |
| 41 | **Settings → Delete my account.** Confirm both prompts. | Account, Market, listings and messages are gone; you are signed out and returned to Browse. Try signing in with the same credentials — it must fail. |

## Part F — Web (browser, ~7 min)

| # | Step | Expected result |
|---|---|---|
| 42 | Sign in at `/login` with a code. | Signed in. |
| 43 | `/my` → customise your Market: tagline and theme. | Both save and appear on your public Market page. |
| 44 | `/my` → drag to reorder your listings; star up to 4 as featured; try starring a 5th. | Order persists on the public page; the 5th star is refused with "Up to 4 featured listings". |
| 45 | Visit another Market page and click **Follow**, then `/following`. | Market appears in the followed feed. Click Unfollow — it disappears. |
| 46 | `/my` notebook → record a sale as **Card (external)**. | Recorded. (Mobile cannot do this — that is the known gap.) |
| 47 | **Re-probe `/seeds` and `/pricing` after the web deploy.** | `/seeds` contains **no** `$` price and **no** "Build my box". `/pricing` contains **no** "$24.99". **Until this passes, BLOCKER 1 is open.** |

---

# Classification summary

| Severity | Item |
|---|---|
| **BLOCKER** | 1. Production `/seeds` and `/pricing` sell Seed Drop with prices and a Stripe subscription promise. Fix is written but **undeployed**. Verify by re-probing both URLs after deploy. |
| **FIX BEFORE SUBMISSION** | 1. `gnome://auth-callback` redirect allowlist unconfirmed — would break mobile password reset (script step 6). |
| | 2. `NEXT_PUBLIC_IOS_APP_URL` unset → every "Get the app" CTA lands on the App Store homepage. |
| | 3. `docs/LAUNCH.md` stale — Google/Apple are live, not disabled. |
| **FIX BEFORE PUBLICATION** | 4. Zero real inventory: 6 listings (5 demo, 1 QA), no free/sale/trade at all; 8 of 11 markets are demo/QA, three exposing the owner's email local part as a public market name. |
| **FIX WITHIN 72 HOURS** | 5. Follow/unfollow absent from mobile (web-only). |
| | 6. Reorder and feature/unfeature absent from mobile (web-only). |
| | 7. `external_card` payment method absent from the mobile record-sale sheet. |
| **BACKLOG** | 8. Base `markets` table anon-readable including `lat/lng/contact_*` — null today, a leak the day any UI writes them. |
| | 9. No Universal Links (`apple-app-site-association`, `associatedDomains`). |
| | 10. `docs/security/PROFILE_VISIBILITY.md` says 0087 is unapplied; production says otherwise. |

## What this audit could not determine

Stated plainly, because a green checkmark on unexecuted code is a lie:

- **Nothing in the mobile app was run.** Every mobile row marked IMPLEMENTED
  rests on reading the source, not on a device.
- **The AI provider may still be out of credits.** Every AI edge function sets
  `verify_jwt: true`, so no anonymous probe reaches it. If the provider is
  dead, items 68–74 (guidance, multi-photo drafts, junk-skip, edit, publish,
  Publish All) all fail together at runtime despite correct code. This is the
  single highest-value item in the manual script (step 12).
- **The password-reset redirect allowlist** could only have been tested by
  sending a real reset email, which would have hit production auth rate limits
  and a real inbox. Step 6 tests it.
- **Push delivery, cold start, deep-link handling, and offline behaviour** all
  require a physical device.
- **Whether the in-flight sibling changes land as written** — they were
  uncommitted at audit time and the coordinator commits them.
