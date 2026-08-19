# Google Play store listing — Gnome 1.1.0 (Android, first release)

**Scope.** Everything Play asks for on the *Main store listing* and *Store
settings* pages, plus the graphics inventory and a shot list for capture. This
is the presentation layer only. The configuration audit, blockers, Data safety
answers, and the reviewer-notes text live in
[`GOOGLE_PLAY_PACKAGE.md`](./GOOGLE_PLAY_PACKAGE.md) and are **not** repeated
here — where this file touches them it says which section it is reconciling
with and what changed.

**Verified against the REMODELED build** at `a2a914f` (branch
`feat/ai-market-import`), reading `expo/app/**`, `expo/components/**`,
`expo/lib/**`, `expo/constants/colors.ts` and `expo/app.json`; against the
identity spec `../design/GNOME_IDENTITY.md`; against production
`fgybyghwcjlstqxkclch` (SELECT only, measured 2026-08-18); and against Play's
current published rules, re-fetched live 2026-08-18 (sources at the bottom).
Every character count below was computed programmatically, not estimated.

**Nothing here is submitted.** No console field was filled, no asset uploaded.

---

## 0. What the remodel invalidated

This document was written against the **pre-remodel** app. The remodel (identity
v4, three tiers, six tabs with shortened labels, owner decisions D1–D5) changed
the store package in eight places. Rows marked **INVALID** are things that would
have shipped wrong.

| # | What this doc used to say | The remodelled build | Status |
|---|---|---|---|
| 1 | §3: the 512 × 512 icon is a "pure transform of an existing asset", confidence *Certain* | `assets/images/icon.png` is still the **pre-remodel dark-green-on-cream artwork** (sampled: `#17210B`/`#18220B` figure on `#FFF0D1` ground). The remodel brief exists specifically to move *away from* dark-green/cream. `app.json` still sets `adaptiveIcon.backgroundColor` and `splash.backgroundColor` to Parchment `#F6F2E9` — the only two dead-palette hexes left anywhere in the repo | **INVALID — now a blocker.** See §3.2 |
| 2 | §3.1 specs the feature graphic in Parchment `#F6F2E9` / Moss `#618049` / Ink `#152820` / Terracotta `#AE5832` / Teal `#38728A`, built on `badge.png` | None of those colors exist in `constants/colors.ts` any more, and `badge.png` is the same dead-identity art as the icon | **INVALID — respec'd in §3.3** |
| 3 | §4.1 and §4.4: pad captures onto a **Parchment** canvas | The app canvas is now `background: '#FFFFFF'` | **INVALID** — pad on `#FFFFFF`. Happy side effect: white pad reads as bleed, not as a frame |
| 4 | §4.3 shot list assumes the old tab bar | D3: six tabs, labels **Browse · Map · Post · Ask AI · Market · Profile**. Routes unchanged (`index`, `map`, `post`, `ai`, `activity`, `profile`) | **STALE — updated in §4.4.** The tab bar is legible in every screenshot, so the labels have to be right |
| 5 | §2 and §5.2: "In-app purchases — **Blocked on the B4 decision**" | **D1 decides it.** `expo/lib/digitalPurchase.ts` exports `canBuyDigitalInApp = Platform.OS !== 'android'`, wired at all three purchase call sites (`app/(tabs)/post.tsx`, `app/(tabs)/ai.tsx`, `app/listing/[id].tsx`). Android v1.1 presents no in-app digital purchase | **RESOLVED** — In-app purchases = **No**; IARC digital-goods = **No**. Two leaks to close first: §2.1 |
| 6 | §1.3 footnote: "customer-facing names are **Pro / Max / Farm**" | Migration 0126 retired Max. Production `plan_limits.display_name` = Free / Pro / Farm / *Legacy Farm* (comp-only, retired) | **INVALID** — never write "Max" |
| 7 | §1.3 bolt-on **PLANS** paragraph ("…one more listing for $0.99"), inserted if B4 → (b)/(c) | D1 chose the equivalent of (a); D4 defers annual; D5 bars "priority support"/"advanced analytics" | **DELETED.** The Android listing carries **no pricing copy at all** — see §1.3 |
| 8 | §4.1: pad 1080 × 2400 captures to 1080 × 2160 (exactly 2:1), "recommended" | 2:1 is publishable but is **not** 9:16, and Play's promotion-eligibility spec asks for *"9:16 for portrait screenshots (minimum 1080x1920px)"* | **SUPERSEDED** — better remedy, with zero resampling, in §4.2 |

**What the remodel did *not* invalidate**, checked line by line: the app name,
the short description, the full description's claims (two small edits in §1.3,
for the renamed tabs), the release notes, the category and contact fields, and
the whole of §4.3's data problem — which is, if anything, worse than recorded.

---

## 1. Text fields — exact strings and counts

Counts are Unicode code points including spaces and newlines, computed on the
exact strings below (`scratchpad/count.py`; every character verified BMP, so
Python's `len()` and Play's counter agree). Play counts full-width and
half-width characters identically.

### 1.1 App name — 30 char limit

```
Gnome: Local Farmers Market
```

**27 / 30**, verified. Unchanged by the remodel and still the right call: Play
has no keyword field, so the name and short description carry all the search
weight, and "Farmers Market" is the query a person actually types. "Gnome" alone
would be unfindable and collides with the GNOME desktop project.

Alternative if "Local" tests badly: `Gnome: Farmers Market Nearby` (**28 / 30**).

### 1.2 Short description — 80 char limit

```
Buy, sell, trade and share homegrown produce with neighbors nearby.
```

**67 / 80**, verified. It names four of the five listing types in the first four
words, which is exactly what the Play search snippet needs. The fifth type
(Offer a Plot) has no room and is covered in the full description.

Alternative that adds "food" — broader than "produce", since baked goods, eggs
and preserves are all real categories: `Buy, sell, trade, and share homegrown
food with the neighbors closest to you.` (**77 / 80**).

### 1.3 Full description — 4000 char limit

**3,822 / 4,000**, verified. 178 characters of headroom.

Two sentences changed from the pre-remodel draft, both to match D3's renamed
tabs — a reviewer navigates by the tab bar, so the copy has to name what the
tab bar says:

| Was | Now | Why |
|---|---|---|
| "Photograph what you have and Gnome AI drafts a title…" | "**In the Ask AI tab,** photograph what you have and Gnome AI drafts a title…" | The tab is labelled *Ask AI*; the screen heading is still *Gnome AI* (see §1.5) |
| "Every seller gets a Market**: one page holding** your listings…" | "Every seller gets a Market **— its own tab —** holding your listings…" | The Market tab is where it lives now |

```
Gnome is a farmers market in your pocket.

Whatever you grow, bake, or make, there are neighbors nearby who want it — and whatever you're looking for, someone within a few miles probably has too much of it. Gnome connects the two, without a middleman.

BROWSE WHAT'S GROWING NEARBY
See what neighbors are offering right now, sorted by distance. Filter by category, or by how you want it: for sale, free to a good home, open to a trade, wanted, or a garden plot you can grow in. Set your search radius from one mile to the whole country. Search covers titles, descriptions, and category names and their synonyms.

MAP THE MARKET AROUND YOU
Switch to the Map tab and see what's nearby as color-coded pins on a real map, filtered by type and distance. Tap a pin and that listing opens right there. Pins sit at an approximate location — never anyone's exact address.

FIVE WAYS TO POST
• Sell — set your price and your unit
• Share Free — surplus zucchini finds a home
• Trade — your basil for their tomatoes
• Wanted — ask for what you're after, and let neighbors offer it
• Offer a Plot — share space in your garden with someone who has none

GNOME AI
In the Ask AI tab, photograph what you have and Gnome AI drafts a title, description, category, unit, and a suggested price — one draft per photo, several at once. Nothing is published automatically: every draft waits for you to publish, edit, or discard it. Ask it what's worth selling this week, which listings expire soon, or to mark your cucumbers sold out — it proposes, you confirm, and only then does anything change. Already selling elsewhere? Hand it screenshots of your existing shop and it turns them into drafts. And the Garden Planner will tell you what to plant, and when, for where you live.

YOUR OWN MARKET
Every seller gets a Market — its own tab — holding your listings, your pickup spots and hours, your story, and the payment handles you already use. Neighbors can follow it. Run a Market Drop — a time-boxed "Saturday Harvest, 8AM–1PM" collection of what you have ready. Or build a Gift Basket that sells several of your items as one offer.

PICKUP, DELIVERY, AND PRIVATE CHAT
Buyers order from your Market and choose a pickup window you set — or, if you offer it, a local delivery inside the radius you choose, for the fee you set. Someone claiming a single listing sends a request instead; approve it and a private thread opens to sort out time and place. Payment happens between the two of you, in whatever app you already use. Gnome takes no cut of your sale and never handles the money.

A SALES NOTEBOOK THAT MATCHES YOUR SEASON
Record the sales you make off the app — at the roadside stand, at the co-op, to the neighbor who knocked — alongside your Gnome sales, plus your seed, soil, and mileage expenses. One ledger for the whole season, with a monthly summary.

GROW LOG FOR PLOTS
Growing on someone else's plot? Log each stage with photos so the plot owner can follow along. When it's ready to harvest, one tap starts the listing.

BUILT FOR A REAL NEIGHBORHOOD
• Your exact address is never shown. Listings appear at an approximate location, and photos are stripped of their metadata — GPS included — before upload.
• Report and block are one tap away on every listing, Market, and conversation, and reports reach a staffed queue.
• Listings in regulated categories are screened before they go live, and sellers can upload the permits those categories require.
• Location is optional and foreground-only. The app works without it — you just can't sort by distance.
• Delete your account, and everything in it, from Settings.

Gnome works anywhere in the United States. Sellers are responsible for following their own state and local food laws. Gnome is not a party to any sale between neighbors and does not process payments between them.
```

#### Where every claim comes from

Unchanged from the pre-remodel audit except where noted — the remodel was a
re-skin and a pricing simplification, so the *functional* claims survived intact.

| Claim | Grounded in |
|---|---|
| Sorted by distance; radius 1 mile → whole country | `lib/location.ts` — `BrowseRadius = number \| 'anywhere'`, `MAX_BROWSE_RADIUS = 500`, `RADIUS_DETENTS` 1…250, `radiusLabel()` renders "Anywhere" |
| Filter by category / by type | `app/(tabs)/index.tsx` — `TYPE_FILTERS` chips + `TaxonomyPicker` |
| Search covers synonyms | `app/(tabs)/index.tsx` `visible` memo → `matchNodes` / `nodeInAnySubtree` from `lib/taxonomy.ts` |
| Map: color-coded pins, tap to open, approximate | `components/MapListings.native.tsx` — `pinColor={TYPE_COLOR[type]}`, `onPress={() => onSelect?.(l)}`, coordinates read from `approx_lat`/`approx_lng` only |
| Five listing types, those exact names | `lib/listingType.ts` — `LISTING_TYPE_LABEL` = Sell / Share Free / Trade / Wanted / Offer a Plot (re-verified at `a2a914f`) |
| "the Ask AI tab" | `app/(tabs)/_layout.tsx:78` — `title: 'Ask AI'` |
| "a Market — its own tab" | `app/(tabs)/_layout.tsx:90` — `title: 'Market'` on route `activity` |
| Photo → draft, one per photo, several at once | `app/(tabs)/ai.tsx` header contract |
| Nothing published automatically | Same file: drafts render as review cards with Publish / Edit / Discard; publishing goes through `publish_listing_draft` |
| "what's worth selling this week", "which listings expire soon", "mark my cucumbers sold out" | The `STARTERS` array in `app/(tabs)/ai.tsx`, verbatim |
| It proposes, you confirm | `Proposal` type + `ai_confirm_action` |
| Import from screenshots of an existing shop | `app/import.tsx` → `create_import_drafts` |
| Garden Planner | `app/garden.tsx` → `askGardenPlanner` |
| Market page: listings, pickup spots, hours, story, payment handles | `app/market/[id].tsx`, `app/market/pickup-settings.tsx`, `app/market/payment-settings.tsx` |
| Follow a Market | `app/following.tsx`, `useToggleFollow`, table `market_follows` |
| Market Drop, time-boxed | `app/market/drops.tsx` → `create_market_drop`, table `market_drops` |
| Gift Basket = several items as one offer | `app/market/bundles.tsx` → `create_market_bundle`; ≥2 components, one price |
| Order with a pickup window, or seller delivery with a radius and fee | `app/market/order/[marketId].tsx`, `lib/marketops.ts` `usePickupSlots`, `lib/delivery.ts` `useDeliveryQuote`. **Note the tier gate** — see the caveat below |
| Claim → request → private thread | `app/request/[listingId].tsx` → `app/chat/[claimId].tsx` |
| Gnome takes no cut and never handles the money | `lib/marketops.ts` `paymentLink()` / `openPaymentLink()`; `app/(tabs)/post.tsx` `NOTE` copy |
| Sales Notebook: off-app sales, expenses, monthly summary | `app/notebook.tsx` → `record_sale` / `void_sale` (tables `seller_transactions`, `seller_expenses`) |
| Grow Log stages with photos, one tap to list the harvest | `app/growlog/[claimId].tsx` — `STAGES`, FRUITING/HARVESTING → prefilled create-listing |
| Approximate location, metadata stripped including GPS | `lib/images.ts` (`exif: undefined` / `exif: false`); `0009_map_privacy.sql` |
| Report and block everywhere; staffed queue | `useReport`, `useBlockUser`, `app/settings.tsx`, `0024_admin_moderation.sql` |
| Regulated categories screened before going live | `0095_prohibited_content.sql` + `lib/screening.ts` |
| Permits and licenses | `app/compliance/index.tsx`, `app/compliance/upload.tsx` |
| Location optional, foreground only | `getCoordsIfGranted()`; `app.json` requests only `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` |
| Delete your account from Settings | `app/settings.tsx` — "Delete my account" (Profile → Settings; unmoved by D3) |
| United States only | `countrycodes=us` on the geocoder, US state table in `lib/location.ts`, USD throughout |

**One caveat on the delivery sentence.** Production `plan_limits` has
`delivery_eligible = false` for Free **and for Pro**, and `true` only for Farm
($29.99). The description's wording is conditional — *"or, **if you offer it**, a
local delivery…"* — so it stays true, and it is the only honest way to phrase a
tier-gated capability without putting pricing in the listing. But a reviewer
signed in on a Free test account **will not find a delivery setting**, so the
reviewer notes must say where it lives and which tier exposes it. Flagged to
whoever owns `GOOGLE_PLAY_PACKAGE.md` §7.2.

#### What is deliberately *not* claimed

- **Any pricing at all.** No tier names, no $9.99/$29.99, no $0.99, no annual.
  D1 means the Android app sells nothing digital in-app; D4 defers annual; D5
  bars invented benefits. A listing that advertises a price the Android app
  cannot charge is the discrepancy that draws policy attention. The
  pre-remodel **PLANS** bolt-on paragraph is deleted, not parked.
- **Seed Drop.** Absent entirely. It ships as an announcement:
  `SeedDropComingSoon.tsx` has no price, date, waitlist or reservation, and
  `supabase/functions/billing-checkout/index.ts` refuses every seed key —
  `SEED_DROP_KEYS` plus any key containing `SEED` returns
  `403 SEED_DROP_COMING_SOON`. It must not appear in the description, the
  screenshots, or the release notes.
- **Push notifications / "get alerted when a Market posts".** B2 is configured
  but delivery is **unproven** — `lib/notifications.ts` guards registration with
  `!Device.isDevice`, so no emulator has ever completed a registration. The
  description says "Neighbors can follow it", never "and get notified". Do not
  add a notification claim until a physical Android device has received one.
- **Listing promotion / Boost.** `app/promote/[listingId].tsx` can spend an
  included plan credit, but `buySingle()` is still an alert reading *"Promotion
  checkout is almost ready"*. F6 stands. Not mentioned, not screenshotted.
- **Plan upgrades in-app.** `app/upgrade.tsx` is informational;
  `UpgradePromptCard`'s CTA is an alert reading *"Coming soon"*.
- **Any metric, testimonial, award, rating, or user count.** There are none, and
  Play's own metadata rules bar them regardless.

### 1.4 Release notes ("What's new") — 500 char limit

**492 / 500**, verified.

```
Gnome's first Android release.

Browse what neighbors are growing, sorted by distance — or see it all as pins on the map. Post something to sell, share free, trade, request, or offer a garden plot. Run your own Market with pickup spots, hours, Market Drops and Gift Baskets. Buyers pick a pickup window; a private thread opens once you approve. Gnome AI turns a photo into a listing draft that waits for you. Sellers get a Sales Notebook and a Grow Log.

Settings -> Send feedback reaches us.
```

Unaffected by the remodel — it names no tab, no price and no tier. Deliberate
choices: it reads as an introduction rather than a changelog, because for every
Play user this *is* version one; the `1.1.0` number is an artifact of the iOS
track. The arrow is ASCII `->` because Play's release-notes field has
historically mangled some typographic characters (`→` also fits, at 490).

**One judgement call, newly surfaced.** Play's release-notes page says verbatim:
*"Do not use release notes for promotional purposes or to solicit user actions."*
The closing line asks the user to do something. It is a support pointer rather
than a promotion and the risk is low, but if you want it airtight, drop that
line — the notes then read **453 / 500** and gain 47 characters of headroom
(the current version has only 8, which is not enough for any late edit).

### 1.5 One copy inconsistency the remodel left behind

Not mine to fix, and it will be visible in screenshot #6 and #4:

- `app/(tabs)/activity.tsx:82` still renders `<Text style={styles.h1}>My Gnome</Text>`
  while its tab now reads **Market**. D3 renamed the tab label only. A frame
  showing a tab called "Market" above a page headed "My Gnome" reads as a bug.
  **Resolve before capture** — it is a one-word change in a file I do not own.
- `app/(tabs)/ai.tsx:548` renders the heading **Gnome AI** under a tab labelled
  **Ask AI**. This one is defensible — *Gnome AI* is the product name, *Ask AI*
  is the action — and the full description now uses both, so no change needed
  unless the owner prefers consistency.

---

## 2. Store settings — category, tags, contact

| Field | Value | Note |
|---|---|---|
| App or game | **App** | |
| Category | **Shopping** | Gnome is a marketplace first. "Food & Drink" is the plausible alternative but is dominated by recipe and restaurant apps and would bury a peer-to-peer marketplace |
| Tags | Up to **5**, from Play's fixed list in Store settings → App category → Manage tags | Play's tag vocabulary is a closed list that changes; pick the closest available matches to **marketplace / classifieds / grocery / local / food** and confirm the exact strings in the console. Do not invent tag names |
| Contains ads | **No** | No ad, analytics or attribution SDK in `expo/package.json` |
| In-app purchases | **No** — resolved by D1 | Was "blocked on B4". See §2.1 for the two leaks that must close first |
| Free or paid | **Free** | |
| Countries | **United States only** | |
| Email | **daniel@boonesystems.com** | B3 closed; MX verified deliverable |
| Website | **https://gnomefarmersmarket.com** | |
| Phone | Leave blank | Optional, and a personal number becomes public on the listing |
| Privacy policy | **https://gnomefarmersmarket.com/privacy** | |
| Account deletion URL | **https://gnomefarmersmarket.com/delete-account** | Entered under App content → Data safety → Data deletion, not on the listing page. D3 did **not** move the in-app control: still Profile → Settings → Delete my account, exactly as both stores' submission text says |

**Content rating.** Do not re-derive; `GOOGLE_PLAY_PACKAGE.md` §6 has the full
IARC questionnaire. Carry those answers over verbatim. Exactly one answer is now
determinate rather than conditional:

> **"Does the app allow users to purchase digital goods?"** — §6 answered *"No
> if B4 is gated off; otherwise Yes."* **D1 gates it off.** `canBuyDigitalInApp`
> is `false` on Android at every purchase call site, so the Android build
> presents no digital purchase. The answer is **No**, and Store settings →
> In-app purchases is **No**.

Expected outcome unchanged: ESRB **Teen** / PEGI **12** / USK **12**, with
"Users Interact" and "Shares Location" descriptors — driven by messaging and
approximate location sharing, not by depicted content.

### 2.1 Two leaks that must close before "In-app purchases: No" is truthful

D1 is correctly implemented at the three *checkout* call sites. It is not
implemented in two *copy* surfaces, and Play review reads strings:

| Where | What it says on Android today | Why it matters |
|---|---|---|
| `expo/app/market/bundles.tsx:62` | On `PUBLISH_ALLOWANCE_EXHAUSTED`: *"…grab a $0.99 extra publish **from My Market on the web**, or upgrade your plan."* | This is an explicit instruction to buy a digital item outside the app. `digitalPurchase.ts`'s own header says a link-out "would be the same violation wearing a coat". The file imports neither `Platform` nor `canBuyDigitalInApp` |
| `expo/app/upgrade.tsx:27,39,40` | Renders *"renewals $0.99 each"*, *"Extra Sell listings and renewals: $0.99 each."* on all platforms | Prices a digital item on a screen the Android user can open. Less severe than the link-out — it states a price without offering a route — but it contradicts a "No" declaration |

Neither file is mine. Both are small, contained changes: route the bundles
message through `OVERAGE_UNAVAILABLE_BODY`, and suppress the `$0.99` fragments
when `!canBuyDigitalInApp`. **Until they land, answer the IARC and Store-settings
questions as if the purchase exists, or fix them first — do not declare "No"
over copy that says otherwise.**

Separately, and outside this file's scope but noted because it bears on the same
declaration: `RELEASE_BOARD.md` records that the app opens
`gnomefarmersmarket.com/terms`, `/privacy` and `/trust` from
`app/settings.tsx` and `app/sign-in.tsx`, and every one of those live pages
carries a nav link to `/pricing`. I re-checked `/pricing` live today: three
tiers, monthly only, no annual, no "priority support", no "advanced
analytics" — D4 and D5 hold — **but it still carries "Upgrade to Pro" /
"Upgrade to Farm" buttons and the text "Extra Sell listing: $0.99"**. That is
an owner decision (release board §8 item 2), not a listing decision, and it is
recorded here only so the "No" answer is made with full knowledge.

---

## 3. Graphics — required assets

Play's current specs, re-fetched live 2026-08-18:

| Asset | Spec | Where it stands |
|---|---|---|
| **App icon** | 512 × 512, **32-bit PNG with alpha**, max **1024 KB** | **BLOCKED on art, not on tooling** — the source is off-identity. See §3.2 |
| **Feature graphic** | 1024 × 500, **JPEG or 24-bit PNG, no alpha** | **Does not exist. Play will not let you publish without it.** Respec'd for identity v4 in §3.3 |
| **Phone screenshots** | 2 minimum across device types to publish; up to **8 per device type**. JPEG or 24-bit PNG, no alpha, 320–3840 px per side, and *"The maximum dimension of your screenshot can't be more than twice as long as the minimum dimension."* For **promotion eligibility**: *"you must provide at least four screenshots with minimum 1080px resolution… 9:16 for portrait screenshots (minimum 1080x1920px)"* | See §4. Target 8 |
| 7"/10" tablet screenshots | Optional, 4 each if supplied | **Skip.** No tablet layouts; `supportsTablet: false` on iOS. Play will show a "not optimized for tablets" note. Acceptable for 1.1.0 |
| Promo video | Optional, a YouTube URL | **Skip** |

### 3.1 Play's rules on what may appear in a screenshot

Re-fetched today because the pre-remodel draft did not record them, and one of
them constrains §4.5:

- *"Add taglines only if necessary to convey the key characteristics of the app
  or game. **Taglines should not take up more than 20% of the image.**"*
- *"Do not include any content that reflects or suggests Google Play performance,
  ranking, accolades or awards, user testimonials, or price and promotional
  information."* — **note "price"**: with D1 in force this is a second, independent
  reason no frame may show a price *badge*. In-app prices on listing cards are
  part of the interface and are fine; a caption saying "from $0.99" is not.
- *"Avoid adding any form of call-to-action, for example, 'Download now,'
  'Install now,' 'Play now,' or 'Try now.'"*
- *"Edit excess elements in the notification bar before submitting. Do not show
  service providers or notifications."*
- The absolute prohibition on device frames and on "additional text, graphics,
  or backgrounds that are not part of the interface of the app" is stated on
  this page **for Wear OS and Wear OS watch faces only**. It does not bind phone
  screenshots — which is why the tagline allowance above exists at all. Worth
  knowing precisely, because it is the rule most often misquoted as a blanket ban.

### 3.2 App icon — the blocker the remodel created

`expo/assets/images/icon.png` is 1024 × 1024 RGBA, 1.76 MB. Sampled dominant
colors: figure `#17210B`–`#18220B` (near-black green) on ground `#FFF0D1`
(cream). `adaptive-icon.png` is byte-identical; `splash-icon.png` and
`badge.png` are the same artwork.

Identity v4 contains no cream and no dark green. `constants/colors.ts` sets
`background: '#FFFFFF'`, `primary: '#E32C27'`, and the brief that produced it
says the point is to move *away from dark-green/cream, too close to a
competitor*. So the launcher icon, the Play Store icon, the splash screen and
the badge all still carry the identity the remodel exists to replace — while
every one of the ~70 in-app surfaces re-skinned.

Two consequences, and they are different in kind:

1. **Store-facing.** The 512 × 512 icon is the most-seen asset in the whole
   package — search results, the listing header, the install card, the home
   screen. Downscaling the existing PNG is still *technically* trivial and I can
   do it in a minute, but it ships the rejected identity. §5.1's "Certain"
   confidence was about the transform; the transform is not the problem.
2. **In-app.** `app.json` still sets `android.adaptiveIcon.backgroundColor` and
   `splash.backgroundColor` to Parchment `#F6F2E9`. These are the **only two
   dead-palette hexes remaining in the repository** — I grepped
   `F6F2E9|152820|618049|AE5832|38728A|556D63` across `app/`, `components/`,
   `constants/`, `lib/` and `app.json` and they were the sole hits. A user
   launching the app sees a cream splash resolve into a white app.

**This is an owner decision, not something to automate.** Redrawing the gnome
mark in identity v4 is illustration work. The honest options:

- **(a) Ship the existing mark, change only the backgrounds** to `#FFFFFF` in
  `app.json` — a two-line edit, removes the cream/white flash, but leaves a
  dark-green figure as the brand mark. Cheapest; visually inconsistent with a
  red-brand app.
- **(b) Recolor the existing mark** to identity v4 (Gnome Red `#E53935` hat on
  white). Mechanical if the mark is flat-shaded — I would need to see whether it
  is, before promising it.
- **(c) Commission the icon with the five gnomes** (`GNOME_IDENTITY.md` §2, the
  Red gnome owns "Logo, onboarding, Sell, brand moments"). Correct answer,
  half-day to a day of illustration, and it is the same artist pass the feature
  graphic wants.

**`app.json` caution:** the two `backgroundColor` keys are unrelated to
`android.config.googleMaps`, and nothing in this section proposes touching it —
B1 stays untouched. Whoever edits `app.json` should still rebuild and confirm the
Map tab renders before the AAB is cut, because that file is the one place where a
mistake whites out the entire app.

### 3.3 Feature graphic — respec'd for identity v4

**1024 × 500, no alpha.** Banner at the top of the store page and the tile in
Play's editorial surfaces. Some placements crop the edges, so keep everything
load-bearing inside a centered ~924 × 400 safe area and never put text in the
outer 50 px.

The pre-remodel spec here is void — it was written in Parchment/Moss/Ink. The
identity-v4 replacement:

- **Ground:** white `#FFFFFF`, the app canvas. Optionally a soft Light Gray
  `#F1F5F9` wash to one edge for depth. No cream, anywhere.
- **Center-left:** the Gnome mark. **Pending §3.2** — if the icon is redrawn,
  this uses the new mark; if not, this graphic should not use `badge.png`, which
  would reintroduce dark-green-on-cream into the one asset most likely to be
  seen beside the icon.
- **Wordmark:** "Gnome" in Fraunces 900 Black
  (`node_modules/@expo-google-fonts/fraunces/900Black/Fraunces_900Black.ttf`,
  confirmed loaded at `app/_layout.tsx:51` and mapped as `displayBlack` in
  `constants/theme.ts`) in Charcoal `#222222` — 15.9:1 on white.
- **Tagline:** the app's own line, verbatim from the Browse header —
  **"Fresh from the garden next door."** — confirmed still present at
  `app/(tabs)/index.tsx:125`. Set in Inter, Slate `#6B7280` (4.83:1 on white).
  The store banner should not invent a different line.
- **Right third:** a cluster echoing the five gnome hues and the map pins —
  Gnome Red `#E53935` (sell), Garden Green `#43B649` (free), Trade Blue
  `#1E88E5` (trade), with AI Purple `#8E44AD` and Harvest Yellow `#FFC107`
  available as accents. Use the **brand** cut, not the interactive cut: these are
  fills and art, not text. This rhymes visually with screenshot #2.
- **No** device frames, **no** feature bullets, **no** "#1"/"best"/star ratings,
  **no** price, **no** call to action — all four are Play metadata violations.

**Can it be produced automatically?** Partly, and honestly so. I can composite
exactly the above with PIL — real identity-v4 hexes, the real Fraunces and Inter
TTFs already in `node_modules` — and hand back a spec-compliant 1024 × 500
24-bit PNG plus a JPEG. That gets a *correct, on-brand, typographically clean*
banner. It will not have illustration: the produce cluster would be flat shapes.
**And it cannot include the gnome mark until §3.2 resolves.** Recommendation:
treat the icon and the feature graphic as one illustration commission, and let
me generate a typographic interim so nothing is blocked.

---

## 4. Phone screenshots

### 4.1 What the emulator produces, and why it is rejected

Measured from `~/.android/avd/gnome_rc.avd/config.ini`:

```
hw.lcd.width  = 1080
hw.lcd.height = 2400
hw.lcd.density = 420
```

That is **2.2222 : 1**. A raw `adb exec-out screencap -p` is 1080 × 2400, and
`2400 > 2 × 1080`, so **Play rejects it outright**. This part of the
pre-remodel doc was right.

What it got wrong is the fix. Padding to 1080 × 2160 satisfies the ≤2:1
publishing rule but produces a 2.000 : 1 image, which is **not 9:16**, so it
does not meet the spec Play states for promotion eligibility
(*"9:16 for portrait screenshots (minimum 1080x1920px)"*). Since promotion
eligibility is the only reason to shoot more than two screenshots at all, the
target should be exact 9:16.

### 4.2 The remedy, with the arithmetic

**Recommended — crop the status bar, then pillarbox. Zero resampling.**

| Step | Operation | Result |
|---|---|---|
| 1 | `adb exec-out screencap -p` | 1080 × 2400 |
| 2 | Crop **64 rows off the top** (status bar = 24 dp × 420/160 = 63 px) | 1080 × 2336 |
| 3 | Pad width to **1314** on `#FFFFFF` — 117 px each side | **1314 × 2336** |

`2336 × 9 / 16 = 1314` **exactly**. Verified: ratio 1.7778, short side 1314 ≥
1080, long side 2336 ≤ 3840, `2336 ≤ 2 × 1314`. Publishable **and**
promotion-eligible, at native pixel resolution with no scaling artifacts, and
step 2 also satisfies Play's *"edit excess elements in the notification bar"*
guidance for free. The pad color is the app's own `background` token, so it
reads as bleed rather than as a frame.

**If captions are wanted** — canvas **1539 × 2736**: a 400 px caption band on
top, the native 1080 × 2336 capture centered below, 230 px white each side.
Ratio exactly 9:16; the band is **14.6 %** of the image, inside Play's 20 % cap.
Band in Parchment is dead — use white `#FFFFFF` or Light Gray `#F1F5F9` with
Fraunces 900 Black in Charcoal `#222222`.

**Alternative — re-cut the AVD natively 9:16.** `1440 × 2560 @ 560 dpi` is a real
phone geometry, gives 411 × 731 dp logically, and needs no post-processing at
all. `1080 × 1920 @ 420 dpi` also works. Both cost you ~20 % of vertical content
versus the current 411 × 914 dp panel — 9:16 is simply shorter than 2.22:1, and
that is unavoidable at any resolution. **Recommendation: keep `gnome_rc` and
post-process.** The tall panel shows more listing cards per frame, which is worth
more than skipping one deterministic image operation. Do not touch the AVD
mid-capture — a resolution change alters layout and invalidates frames already shot.

The app is portrait-locked (`android:screenOrientation="portrait"`,
`"orientation": "portrait"` in `app.json`), so there is no landscape set to make.

### 4.3 The data problem — re-measured, and worse than recorded

Production is not sparse, it is **empty**. Measured on `fgybyghwcjlstqxkclch`,
2026-08-18, SELECT only:

| | count |
|---|---|
| Listings, all statuses | 28 |
| Active | 6 |
| Active and **not** `is_demo` | **1** |
| Active **Sell** listings | **0** |
| Active **Free** listings | **0** |
| Active **Trade** listings | **0** |
| Active Wanted / Plot | 5 / 1 |
| Listings with **any photo**, at any status | **0** |
| Markets | 13 (12 free, 1 Pro) |
| Market Drops | **0** |
| Gift Baskets (`listings.is_bundle`) | **0** |
| Market pickup locations | **0** |
| Market follows | **0** |
| Sales ledger rows (`seller_transactions`) | **0** |
| Seller expenses | **0** |

The bottom six rows were not in the pre-remodel measurement. They are the
important ones: **shots 6, 7 and 8 have literally zero backing data**, not thin
data. There is no Market Drop, no Gift Basket, no pickup location, no follower,
no sale and no expense anywhere in production.

Three consequences carry over unchanged:

1. **Every demo listing renders a "Preview" pill and no distance** —
   `components/ListingCard.tsx:48,89` (`listing.distance_miles != null &&
   !listing.is_demo`, and `listing.is_demo ? … Preview`). A store screenshot
   showing "Preview" chips and no distances advertises an empty app.
2. **No listing anywhere has a photo.** Browse, listing detail, Market page and
   Gift Basket are all photo-led surfaces. Without photos they photograph as
   text cards.
3. **Zero Sell, Free and Trade listings** — three of the five types the
   description leads with cannot be shown at all.

Two legitimate routes to fix it:

- **(A) Daniel's own real Market.** One Market, genuine listings, photographs of
  produce he actually has. Everything on screen is then true, and the reputation
  counts in shot 6 are real derived numbers.
- **(B) A purpose-made screenshot account in a staging project**, seeded via
  `supabase/seed/seed_listings.mjs` extended to attach photos, with `is_demo`
  **false** so the Preview pill and distance suppression do not fire. **Never
  seed this into production** — and production is SELECT-only from here by rule.

Either way the photographs have to come from somewhere with a clean licence. I
will not download stock imagery on an assumed licence — that is Daniel's call
(shoot them, or buy a small licensed set).

Screenshot hygiene: purpose-made account, **no real names, addresses, phone
numbers or avatars** in any frame, no Seed Drop modal, no price badges in
captions, and no notification-bar clutter (step 2 of §4.2 removes the bar entirely).

### 4.4 Shot list — 8 shots, updated for the remodel

Order matters more than count: Play shows the first 2–3 in the search-result
carousel before anyone taps through, so the first three must answer "what is
this and why do I care" without a caption.

**Every frame shows the tab bar**, so every frame must show
**Browse · Map · Post · Ask AI · Market · Profile** — the D3 labels. A frame
captured from a pre-remodel build is identifiable by "My Gnome" or "Gnome AI" in
the tab bar and must be re-shot. The whole set must also be captured *after* the
identity v4 build is installed: mixing a parchment frame into a white set is
obvious at thumbnail size.

| # | Screen | Route | What must be on screen | Caption | Why it earns the slot |
|---|---|---|---|---|---|
| 1 | **Browse feed** | `app/(tabs)/index.tsx` | Gnome badge + "Fresh from the garden next door." header; 3–4 photo cards with **real distances** ("0.4 mi", "1.2 mi") and mixed type badges (For Sale / Free / Trade); type chip row; distance control reading "Within 10 mi". **Not** filtered, **no** Preview pills, search box empty | *"See what's growing a few streets away"* | The whole proposition in one frame. If a person sees only one screenshot, this is it |
| 2 | **Map tab** | `app/(tabs)/map.tsx` | "Markets Near You" title, real Google tiles with recognizable streets, **6+ color-coded pins** spread across the view, one pin tapped so the `ListingCard` preview sheet is up, type + radius chips visible. **Location must be enabled** or the header shows the hardcoded fallback *"Showing the Richmond Heights area…"* (`map.tsx:78`) | *"The whole neighborhood, on one map"* | The most persuasive proof this is local. Un-shootable until B1 closed |
| 3 | **Post composer** | `app/(tabs)/post.tsx` | Five-type chooser row with all five labels visible (Sell / Share Free / Trade / Wanted / Offer a Plot — `lib/listingType.ts`), Sell selected, a photo already attached, price and unit filled | *"Sell it, share it, trade it, or ask"* | Converts a browser into a seller; the only frame showing all five types at once |
| 4 | **Ask AI — draft review** | `app/(tabs)/ai.tsx` | One or two draft review cards from a real photo — title, suggested price, unit, category — with **Publish / Edit / Discard** clearly visible. Tab bar reads **Ask AI** | *"A photo becomes a listing you approve"* | The differentiator, and the review controls are the honest part: nothing auto-publishes |
| 5 | **Ask AI — assistant reply with a confirm card** | `app/(tabs)/ai.tsx` | A conversation: *"What should I sell right now, and why?"* or *"Mark my cucumbers sold out"*, assistant replies, and a **proposal card with a Confirm button** is on screen with its item list | *"Ask your market anything — you confirm, it acts"* | No competitor screenshot looks like this. Pre-empts "does an AI post for me?" |
| 6 | **Market page** | `app/market/[id].tsx` | Market name, avatar, story, derived reputation block (Shared / Sold / Traded + "Member since"), **2 pickup locations with hours**, a **live Market Drop** card with its window, 3+ listing cards. Reached from the **Market** tab | *"Your own Market, followed by neighbors"* | Shows a seller this is a storefront, not a classifieds post. **Only shoot with real derived counts** — never edit them to look bigger |
| 7 | **Pickup order** | `app/market/order/[marketId].tsx` | Cart lines with quantities, subtotal, pickup-window picker with real slots. (Fallback: `app/chat/[claimId].tsx`, a two-sided handoff thread with the pay-methods row) | *"Pick a window, sort the rest privately"* | Answers "how do I actually get the tomatoes". Prefer the order screen — the chat needs a second account to look real |
| 8 | **Sales Notebook** | `app/notebook.tsx` | Monthly summary with real totals, 8–10 ledger entries mixing Gnome and off-app sales, 2–3 expense rows | *"One ledger for the whole season"* | The retention feature, and the reason a serious seller stays |

**Shots considered and cut:**

- **Grow Log** (`app/growlog/[claimId].tsx`) — charming, but plot-claims only,
  needs three staged photos plus a second account, and would displace something
  that sells the app to everyone. Hold for a later listing refresh.
- **Upgrade / plans** (`app/upgrade.tsx`) — informational only, no purchase. With
  D1 this is now doubly excluded: it shows prices, Play's metadata rules bar
  price information in screenshots, and §2.1 notes it currently prints "$0.99"
  on Android.
- **Promote / Boost** (`app/promote/[listingId].tsx`) — F6: `buySingle()` is an
  alert saying checkout is "almost ready". Never screenshot a priced button that
  does nothing.
- **Seed Drop modal** — announcement only; screenshotting it advertises
  something the backend refuses to sell.
- **Onboarding / sign-in** — nobody downloads an app to see its login screen.

### 4.5 What must be TRUE IN THE DATABASE for each shot

This is the table that turns the capture session into a checklist. Every row is
a precondition on the **screenshot account's** data in whichever project you
shoot against (staging, or Daniel's real account). Production values are given
so the gap is explicit; production today satisfies **none** of these.

| # | Screen | Required state | Prod today | How to create it |
|---|---|---|---|---|
| 1 | Browse | ≥6 listings `status='active'`, `is_demo=false`, with ≥1 photo each, mixed across `sale`/`free`/`trade`, all with `approx_lat`/`approx_lng` inside the browse radius of the device's mocked position, and `expires_at` in the future | 0 non-demo active with photos | Seed + `adb emu geo fix` to the same metro. `is_demo=false` is mandatory or every card shows "Preview" and no distance |
| 2 | Map | ≥6 **active** listings with **non-null `approx_lat`/`approx_lng`** clustered within one visible viewport, spanning ≥3 `listing_type` values so the pins differ in color; device location permission **granted** | 5 active rows have coords, but 4 are demo and all are `wanted` — one pin color, and the fallback location banner shows | Same seed as #1. Verify: `select listing_type, count(*) from listings where status='active' and approx_lat is not null group by 1` returns ≥3 rows |
| 3 | Post | No DB state needed. One local photo in the emulator gallery | — | `adb push` a photo to `/sdcard/Pictures`, then Media Scanner |
| 4 | Ask AI | No pre-existing rows; needs one **live Gemini call** against a real photo, and the account must have publish allowance left (`free` = 3/month) | — | Shoot before exhausting the allowance, or the wall copy appears instead of drafts |
| 5 | Ask AI confirm | The account owns a Market with **≥3 active listings** whose titles make the proposal legible (e.g. cucumbers, for "mark my cucumbers sold out"), at least one nearing `expires_at` for the "expiring soon" starter | 0 | Seed listings under the screenshot account's `market_id`, with deliberate titles |
| 6 | Market page | One `markets` row owned by the account with `story` + avatar set; **≥2 `market_pickup_locations`** with `market_pickup_hours`; **1 `market_drops` row live now** (`now() between starts_at and ends_at`) with ≥2 `market_drop_items`; ≥3 active listings; ≥1 `market_follows` row so "followed by neighbors" is not zero. Reputation counts are **derived** — they need real completed claims, not edited numbers | drops 0 · pickup_locations 0 · follows 0 · bundles 0 | Drive the real in-app flows (pickup-settings, drops, bundles) on the emulator against staging — produced the way a user produces them |
| 7 | Pickup order | A **second** account as buyer; the seller Market has ≥2 active `sale` listings with `inventory_count > 0`, pickup locations with hours generating **future** slots via `usePickupSlots`, and a cart with ≥2 lines. If shooting the delivery variant instead: the seller must be on **Farm** — `plan_limits.delivery_eligible` is `false` for Free *and* Pro | 0 sale listings, 0 pickup locations | Two accounts, seller configured first. Slots are computed from hours + exceptions, so the hours must cover a day still ahead |
| 8 | Sales Notebook | **8–10 `seller_transactions` rows** via `record_sale` (mix `p_source` on-app and off-app, varied `p_payment_method`, realistic `p_gross_cents`) **dated in the current month**, plus **2–3 `seller_expenses`** rows also this month, or the monthly summary renders $0 | transactions 0 · expenses 0 | `record_sale(p_market, p_listing, p_claim, p_quantity, p_gross_cents, p_discount_cents, p_fee_cents, p_payment_method, p_buyer_label, p_notes, p_source)` — drive it in-app, or call the RPC as the owning user against staging |

**Ordering that saves a re-shoot:** capture **4 before 1**. Shot 4 needs unspent
publish allowance (Free = 3 publishes/month), and shots 1/5/6 need listings
already live — so publish the seeded inventory under an account that is *not* the
one used for shot 4, or shoot 4 first on a fresh account. Capture **6 before 7**:
shot 7's pickup slots only exist once shot 6's pickup locations and hours do.

### 4.6 Captions

Play permits taglines *"only if necessary"*, capped at **20 % of the image**, and
bars price information, rankings and calls to action. The captions in §4.4 clear
all three. The geometry is in §4.2: a 400 px band on a 1539 × 2736 canvas is
14.6 %.

**Fallback: plain, unadorned device captures are perfectly acceptable** and
cannot look cheap the way a bad overlay can. They still need the §4.2 treatment
to reach 9:16 — the 1314 × 2336 pillarbox, which is the simpler pipeline anyway.
Given that the identity is brand new and the caption band would be the first
place a half-finished type treatment shows, **plain captures are the recommendation**.

---

## 5. What I can produce automatically vs. what needs Daniel

### 5.1 I can do these end to end, today

| Deliverable | How | Confidence |
|---|---|---|
| **Boot, install and drive the emulator** | `~/Library/Android/sdk/emulator/emulator -avd gnome_rc`, install the RC APK, `adb emu geo fix` to place the device in the seeded metro, navigate every screen | High — the AVD exists and B1 is verified on it |
| **Capture every frame** | `adb exec-out screencap -p` per screen | Certain |
| **Make captures Play-legal** | §4.2 exactly: crop 64 rows, pad to 1314 × 2336 on `#FFFFFF`, strip alpha, emit 24-bit PNG | Certain — pure integer geometry, no resampling |
| **Verify every asset against the live spec** | Programmatic check of dimensions, exact 9:16, the ≤2× rule, 320–3840 bounds, bit depth, alpha and file size before anything is handed over | Certain |
| **512 × 512 icon, mechanically** | Downscale `icon.png`, preserve alpha, verify 32-bit PNG < 1024 KB | Certain **as a transform** — but see §3.2: it would ship the pre-remodel identity |
| **1024 × 500 feature graphic, typographic interim** | PIL composite in identity-v4 hexes, real Fraunces/Inter TTFs, flattened, no alpha, PNG + JPEG | High for *correct and on-brand*; reads as clean typography, not illustration; **cannot include the gnome mark until §3.2 resolves** |
| **Extend the seeding script** | Add photo attachment and `is_demo=false` to `supabase/seed/seed_listings.mjs`, pointed at **staging** — never production, where I am SELECT-only by rule | High, once the photos exist |
| **Fill the Market / Drop / Basket / order / notebook fixtures** | Drive the real in-app flows on the emulator against staging, so the data is produced the way a user would produce it | High |
| **Character-count verification** | Already done — 27 / 67 / 3822 / 492, computed not estimated | Certain |

### 5.2 These genuinely need Daniel (or design)

| Item | Why it cannot be automated | Blocking? |
|---|---|---|
| **The app icon in identity v4** | §3.2. Every store surface leads with it and the current mark is the rejected identity. Options (a)/(b)/(c) are an owner call; (c) needs an illustrator | **Yes — blocks the icon, and constrains the feature graphic** |
| **Produce photographs** | Every photo-led screenshot needs real images; production has zero. I will not download stock on an assumed licence | **Yes — blocks shots 1, 2, 3, 4, 6, 8** |
| **Fixing the two D1 copy leaks** | `market/bundles.tsx:62` and `upgrade.tsx:27,39,40` — §2.1. Not my files. They decide whether "In-app purchases: No" is truthful | **Yes — blocks §2 and the IARC answer** |
| **Fixing `GOOGLE_PLAY_PACKAGE.md` §7.2** | The reviewer note still says "NO PURCHASES / This version sells nothing". D1 makes that *nearly* true on Android but the wording is still wrong — see §7 | **Yes — do not submit as written** |
| **The "My Gnome" heading under the "Market" tab** | §1.5. One word, in a file I do not own, visible in shot 6 | **Yes — blocks shot 6** |
| **`app.json` splash / adaptive-icon backgrounds** | §3.2. Two `#F6F2E9` values. Needs an owner edit and a Map regression check on the rebuilt app | Not for the listing; yes for the build |
| **Play Console data entry** | Every field above, the IARC questionnaire, category and tags, App access reviewer credentials. No console access from here | Yes |
| **Reviewer test account** | Created by hand and entered in App content → App access. Credentials must not be committed. Note the Free-tier gaps a reviewer will hit: no delivery settings, 3 publishes | Yes |
| **Personal vs organization developer account** | Determines whether the 12-testers-for-14-days closed-testing requirement applies. Invisible from the repo, and the biggest schedule risk on Android | Yes, for scheduling |
| **Illustration for the feature graphic** | I can make it correct; making it *charming* is an illustrator's half-day — the same pass as the icon | No — fast-follow |
| **Whether captions go on the screenshots** | A taste call. §4.6 recommends plain captures | No |

### 5.3 Honest expectation about emulator screenshot quality

Good enough, with two caveats. Google Maps tiles render correctly on the AVD (B1
verified), the 420 dpi panel is sharp, `adb exec-out screencap` is lossless, and
the §4.2 pipeline adds no resampling at all. The real quality ceiling is
**content, not capture** — a technically perfect screenshot of an empty feed
sells nothing. Get the photos and the seed data right and these will look like a
real app; skip that and no amount of post-processing rescues them.

The second caveat is new: the identity is one commit old and has never been seen
on a device. Boot the emulator and look at all six tabs **before** planning a
capture session — the token flip re-skinned ~70 files through one import, which
is exactly the change most likely to leave one screen with unreadable contrast.
§1a of `GNOME_IDENTITY.md` lists the three combinations that would ship
unreadable; confirm none of them survived.

---

## 6. Pre-submission checklist for the listing page

**Art and identity**
- [ ] §3.2 decided: app icon redrawn, recolored, or shipped as-is
- [ ] `app.json` `splash.backgroundColor` and `adaptiveIcon.backgroundColor` off Parchment; Map regression re-run on the rebuilt app
- [ ] 512 × 512 icon generated and verified (32-bit PNG with alpha, < 1024 KB)
- [ ] 1024 × 500 feature graphic generated and verified (24-bit PNG or JPEG, no alpha)

**Code corrections that gate the declarations**
- [ ] `market/bundles.tsx:62` no longer directs Android sellers to buy on the web
- [ ] `upgrade.tsx` suppresses "$0.99" when `!canBuyDigitalInApp`
- [ ] `activity.tsx:82` heading reconciled with the "Market" tab label
- [ ] `GOOGLE_PLAY_PACKAGE.md` §7.2 "NO PURCHASES" paragraph rewritten (§7)

**Data, before any capture**
- [ ] Photos sourced and licence settled
- [ ] Staging seeded per §4.5: ≥6 non-demo active listings with photos across ≥3 types, one metro, inside one radius, `approx_lat`/`approx_lng` set
- [ ] Market fixture: story, avatar, 2 pickup locations with hours, 1 live Market Drop, 1 Gift Basket, ≥1 follower
- [ ] Notebook fixture: 8–10 `seller_transactions` + 2–3 `seller_expenses` dated this month
- [ ] Second account for shot 7

**Capture**
- [ ] Identity-v4 build installed; all six tabs eyeballed for contrast
- [ ] Shot 4 captured before the publish allowance is spent
- [ ] Shot 6 captured before shot 7
- [ ] 8 screenshots captured, cropped 64 rows, padded to 1314 × 2336, alpha stripped
- [ ] Every frame's tab bar reads Browse · Map · Post · Ask AI · Market · Profile
- [ ] Every frame checked for real names, addresses, phone numbers, avatars, Preview pills, price captions, and Seed Drop

**Console**
- [ ] App name / short / full / release notes pasted; console counters confirm **27 / 67 / 3822 / 492**
- [ ] Category Shopping; 5 tags picked from the console's own list
- [ ] In-app purchases **No**; IARC digital-goods **No**
- [ ] Contact email, website, privacy URL, deletion URL entered

---

## 7. The correction that must land before submission

`GOOGLE_PLAY_PACKAGE.md` §7.2's reviewer note contains:

> **NO PURCHASES**
> This version sells nothing. There is no Google Play Billing integration and no
> payment processing inside the app.

D1 makes the *substance* of this nearly right on Android and the *wording* still
wrong: "this version sells nothing" is a statement about the product, and the
product does sell a $0.99 overage — on web and on iOS, from the same backend,
with the machinery intact and proven. What is true is narrower and should be said
narrowly. **D1 selects the (a) variant:**

```
NO PURCHASES ON ANDROID
This version sells nothing on Android. There is no Google Play Billing
integration and no payment processing inside the Android app. Sellers who
exhaust their monthly publishing allowance are shown the plan comparison, not a
purchase. When a buyer and seller settle up for goods, the app can open the
seller's own Venmo / PayPal / Cash App / Zelle handle; the payment happens
entirely in that app and Gnome never sees or records it. A disclaimer saying so
is shown every time.
```

Two additions the reviewer notes should also carry, both surfaced by this audit:

1. **Where delivery lives and why a Free reviewer cannot see it** —
   `plan_limits.delivery_eligible` is true only for Farm. Without this, a
   reviewer testing the description's delivery sentence concludes the feature
   does not exist.
2. **That the account-deletion control did not move.** D3 renamed two tab labels;
   Profile → Settings → Delete my account is unchanged, and both stores'
   submission text names that path verbatim.

I do not own that file; this is the text for whoever does.

---

## 8. Sources for the Play rules quoted above

Re-fetched live 2026-08-18 rather than recalled, because Play's asset and policy
pages change:

- [Add preview assets to showcase your app](https://support.google.com/googleplay/android-developer/answer/9866151) — icon 512 × 512 32-bit PNG with alpha, max 1024 KB; feature graphic 1024 × 500 JPEG or 24-bit PNG with no alpha; screenshots JPEG or 24-bit PNG, 320–3840 px per side, minimum two across device types to publish, *"up to 8 screenshots for each supported device type"*; *"The maximum dimension of your screenshot can't be more than twice as long as the minimum dimension."*; promotion eligibility — *"you must provide at least four screenshots with minimum 1080px resolution. These should be 16:9 for landscape (minimum 1920x1080px) screenshots and 9:16 for portrait screenshots (minimum 1080x1920px)."*; *"Taglines should not take up more than 20% of the image."*; the no-frames/no-added-text rule is stated **for Wear OS and Wear OS watch faces**, not for phone screenshots
- [Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152) — app name 30, short description 80, full description 4000
- [Prepare and roll out a release](https://support.google.com/googleplay/android-developer/answer/9859348) — *"You can enter release notes using up to 500 Unicode characters per language."*; *"Do not use release notes for promotional purposes or to solicit user actions."*
- [Best practices for your store listing](https://support.google.com/googleplay/android-developer/answer/13393723) — *"Use taglines in your screenshots if absolutely necessary… But keep text to a minimum."*
- [Choose a category and tags for your app or game](https://support.google.com/googleplay/android-developer/answer/9859673) — up to 5 tags, chosen from Play's own list under Store settings → App category → Manage tags

Repository and database evidence for this revision: `expo/constants/colors.ts`,
`expo/app/(tabs)/_layout.tsx`, `expo/lib/digitalPurchase.ts`,
`expo/lib/listingType.ts`, `expo/app.json`, `expo/assets/images/*.png`,
`~/.android/avd/gnome_rc.avd/config.ini`, and SELECT-only queries against
`fgybyghwcjlstqxkclch` (`listings`, `markets`, `plan_limits`, `market_drops`,
`market_pickup_locations`, `market_follows`, `seller_transactions`,
`seller_expenses`).
