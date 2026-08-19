# Google Play store listing — Gnome 1.1.0 (Android, first release)

**Scope.** Everything Play asks for on the *Main store listing* and *Store
settings* pages, plus the graphics inventory and a shot list for capture. This
is the presentation layer only. The configuration audit, blockers, Data safety
answers, and the reviewer-notes text live in
[`GOOGLE_PLAY_PACKAGE.md`](./GOOGLE_PLAY_PACKAGE.md) and are **not** repeated
here — where this file touches them it says which section it is reconciling
with and what changed.

**Verified against** the working tree at `cdf1f58` (branch
`feat/ai-market-import`), reading `expo/app/**`, `expo/components/**`,
`expo/lib/**`, and `expo/app.json`; against production `plan_limits` and
`listings` (SELECT only); and against Play's current published rules, fetched
live 2026-08-18 (sources at the bottom).

**Nothing here is submitted.** No console field was filled, no asset uploaded.

---

## 0. What changed since `GOOGLE_PLAY_PACKAGE.md` §3 and §8

The standing doc's listing copy was drafted against an older commit. Five things
in the RC are materially different from what it describes, and the text below
reflects the RC, not the draft:

| # | The standing doc says | The RC actually does | Effect on the listing |
|---|---|---|---|
| 1 | §3.1 describes Gnome AI as "photograph → draft" only | `expo/app/(tabs)/ai.tsx` is a full assistant: multi-photo batch drafts **plus** confirm-gated market actions (`renew`, `restock`, `mark_sold_bulk`, `set_price_bulk`, `create_drop`, `create_bundle`) via `ai_confirm_action`, plus the Garden Planner (`app/garden.tsx`) and shop import from screenshots (`app/import.tsx`) | The AI paragraph is rewritten and is now the strongest differentiator in the description |
| 2 | §3.1 has no Market-ordering story | `app/market/order/[marketId].tsx` is a real cart → pickup-window or delivery order flow, with `app/orders.tsx` and `app/order/[id].tsx`. Market Drops (`app/market/drops.tsx`) and Gift Baskets (`app/market/bundles.tsx`) both ship | A new "PICKUP, DELIVERY, AND PRIVATE CHAT" section, and Drops/Baskets named in "YOUR OWN MARKET" |
| 3 | §3.1 says "without a delivery fleet" | Delivery exists, but it is **seller-run**: the seller sets radius, flat fee, and (paid tiers) surcharges and cutoffs (`app/market/delivery-settings.tsx`, `lib/delivery.ts`). No Gnome fleet | Reworded to "a local delivery inside the radius you choose, for the fee you set" — true, and it stops a reviewer reading "no delivery" then finding a delivery screen |
| 4 | §8.2 says "do not capture the Map tab" | B1 is closed. `components/MapListings.native.tsx` renders a real `MapView` with color-coded per-type `Marker`s at **approximate** coordinates, and tapping a pin opens a `ListingCard` preview sheet | Map is now shot #2, and gets its own paragraph in the description |
| 5 | §7.2 reviewer notes still read "**NO PURCHASES** — This version sells nothing" | False since the $0.99 overage checkout was proven end-to-end on Android with a real Stripe TEST payment | **Blocking correction — see §7 below.** Submitting that paragraph as written would be a false statement to review |

Everything else in §3, §4, §6 and §7 stands.

---

## 1. Text fields — exact strings and counts

Counts are Unicode characters including spaces and newlines, computed on the
exact strings below. Play counts full-width and half-width characters
identically, so these are the numbers the console will show.

### 1.1 App name — 30 char limit

```
Gnome: Local Farmers Market
```

**27 / 30.** Unchanged from `GOOGLE_PLAY_PACKAGE.md` §3 and still the right
call: Play has no keyword field, so the name and short description carry all of
the search weight, and "Farmers Market" is the query a person actually types.
"Gnome" alone would be unfindable and collides with the GNOME desktop project.

Alternative if "Local" tests badly: `Gnome: Farmers Market Nearby` (28/30).

### 1.2 Short description — 80 char limit

```
Buy, sell, trade and share homegrown produce with neighbors nearby.
```

**67 / 80.** Unchanged from §3. It names four of the five listing types in the
first four words, which is exactly what the Play search snippet needs. The
fifth type (Offer a Plot) has no room and is covered in the full description.

Alternative that adds "food" (broader than "produce" — baked goods, eggs, and
preserves are all real categories): `Buy, sell, trade, and share homegrown food
with the neighbors closest to you.` (77/80).

### 1.3 Full description — 4000 char limit

**3,797 / 4,000.** 203 characters of headroom, deliberately — Play's counter
includes every newline, and a late edit that adds a bullet should not push it
over.

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
Photograph what you have and Gnome AI drafts a title, description, category, unit, and a suggested price — one draft per photo, several at once. Nothing is published automatically: every draft waits for you to publish, edit, or discard it. Ask it what's worth selling this week, which listings expire soon, or to mark your cucumbers sold out — it proposes, you confirm, and only then does anything change. Already selling elsewhere? Hand it screenshots of your existing shop and it turns them into drafts. And the Garden Planner will tell you what to plant, and when, for where you live.

YOUR OWN MARKET
Every seller gets a Market: one page holding your listings, your pickup spots and hours, your story, and the payment handles you already use. Neighbors can follow it. Run a Market Drop — a time-boxed "Saturday Harvest, 8AM–1PM" collection of what you have ready. Or build a Gift Basket that sells several of your items as one offer.

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

| Claim | Grounded in |
|---|---|
| Sorted by distance; radius 1 mile → whole country | `lib/location.ts` — `BrowseRadius = number \| 'anywhere'`, `MAX_BROWSE_RADIUS = 500`, `RADIUS_DETENTS` 1…250, `radiusLabel()` renders "Anywhere" |
| Filter by category / by type | `app/(tabs)/index.tsx` — `TYPE_FILTERS` chips + `TaxonomyPicker` |
| Search covers synonyms | `app/(tabs)/index.tsx` `visible` memo → `matchNodes` / `nodeInAnySubtree` from `lib/taxonomy.ts`; the in-app placeholder is literally `Search — try "hamburger" or "worms"` |
| Map: color-coded pins, tap to open, approximate | `components/MapListings.native.tsx` — `pinColor={TYPE_COLOR[type]}`, `onPress={() => onSelect?.(l)}`, coordinates read from `approx_lat`/`approx_lng` only |
| Five listing types, those exact names | `lib/listingType.ts` — `LISTING_TYPE_LABEL` = Sell / Share Free / Trade / Wanted / Offer a Plot |
| Photo → draft, one per photo, several at once | `app/(tabs)/ai.tsx` header contract: "several photos in one go become several separate drafts" |
| Nothing published automatically | Same file: drafts render as review cards with Publish / Edit / Discard; publishing goes through `publish_listing_draft` |
| "what's worth selling this week", "which listings expire soon", "mark my cucumbers sold out" | The `STARTERS` array in `app/(tabs)/ai.tsx`, verbatim capabilities |
| It proposes, you confirm | `Proposal` type + `ai_confirm_action`; the file's own comment: "A proposal executes ONLY when the seller taps Confirm" |
| Import from screenshots of an existing shop | `app/import.tsx` → `create_import_drafts` |
| Garden Planner | `app/garden.tsx` → `askGardenPlanner` |
| Market page: listings, pickup spots, hours, story, payment handles | `app/market/[id].tsx`, `app/market/pickup-settings.tsx`, `app/market/payment-settings.tsx` |
| Follow a Market | `app/following.tsx`, `useToggleFollow` |
| Market Drop, time-boxed | `app/market/drops.tsx` → `create_market_drop`; the file explicitly distinguishes it from Seed Drop |
| Gift Basket = several items as one offer | `app/market/bundles.tsx` → `create_market_bundle`; requires ≥2 component listings and one price |
| Order with a pickup window, or seller delivery with a radius and fee | `app/market/order/[marketId].tsx`, `lib/marketops.ts` `usePickupSlots`, `lib/delivery.ts` `useDeliveryQuote` |
| Claim → request → private thread | `app/request/[listingId].tsx` → `app/chat/[claimId].tsx` |
| Gnome takes no cut and never handles the money | `lib/marketops.ts` `paymentLink()` / `openPaymentLink()` — opens the seller's own Venmo/PayPal/Cash App link and records nothing; the file's own comment: "Opening an app/URL NEVER marks anything paid". Also `app/(tabs)/post.tsx` `NOTE` copy shown at post time |
| Sales Notebook: off-app sales, expenses, monthly summary | `app/notebook.tsx` → `record_sale` / `void_sale`, `useSellerExpenses` |
| Grow Log stages with photos, one tap to list the harvest | `app/growlog/[claimId].tsx` — `STAGES`, and the FRUITING/HARVESTING → prefilled create-listing path |
| Approximate location, metadata stripped including GPS | `lib/images.ts` — re-encode through `ImageManipulator` with `exif: undefined` / `exif: false`; `0009_map_privacy.sql` |
| Report and block everywhere; staffed queue | `useReport`, `useBlockUser`, blocked list in `app/settings.tsx`, `0024_admin_moderation.sql` |
| Regulated categories screened before going live | `0095_prohibited_content.sql` + `lib/screening.ts` — prohibited goods blocked, ambiguous ones saved unpublished for review |
| Permits and licenses | `app/compliance/index.tsx`, `app/compliance/upload.tsx` |
| Location optional, foreground only | `getCoordsIfGranted()`; `app.json` requests only `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION`, no background permission |
| Delete your account from Settings | `app/settings.tsx` — "Delete my account" |
| United States only | `countrycodes=us` on the geocoder, US state table in `lib/location.ts`, USD throughout |

#### What is deliberately *not* claimed

- **Seed Drop.** Absent entirely. It ships as an announcement: `SeedDropComingSoon.tsx` has no price, date, waitlist, or reservation, and `supabase/functions/billing-checkout/index.ts` refuses every seed key — `SEED_DROP_KEYS` plus any key containing `SEED` returns `403 SEED_DROP_COMING_SOON`. It must not appear in the description, the screenshots, or the release notes.
- **Push notifications / "get alerted when a Market posts".** B2 is configured but delivery is **unproven** — `lib/notifications.ts` guards registration with `!Device.isDevice`, so no emulator has ever completed a registration. The description says "Neighbors can follow it", never "and get notified". Do not add a notification claim until a physical Android device has received one.
- **Listing promotion / Boost.** `app/promote/[listingId].tsx` can spend an included plan credit or a previously purchased credit, but `buySingle()` is still an alert reading *"Promotion checkout is almost ready"*. F6 stands. Not mentioned, not screenshotted.
- **Plan upgrades in-app.** `app/upgrade.tsx` is informational; `UpgradePromptCard`'s CTA is an alert reading *"Coming soon"*. No upgrade claim.
- **Any metric, testimonial, award, rating, or user count.** There are none, and production currently holds 6 active listings.

#### Bolt-on paragraph, required only if B4 resolves to (b) or (c)

If the $0.99 overage stays reachable on Android, Play expects the paid nature to
be disclosed in the listing. Insert this immediately above the closing
paragraph. **243 characters**, which with its surrounding blank lines takes the
total to 4,042 — over the limit. So if you use it, drop the " Search covers
titles, descriptions, and category names and their synonyms." sentence (75
chars with its leading space) and the " When it's ready to harvest, one tap
starts the listing." sentence (56 chars with its leading space), landing at
**3,911 / 4,000**.

```
PLANS
A free account publishes 3 new Sell listings a month. Paid plans raise that, add included renewals and listing promotions, and unlock scheduled delivery. Sellers who go past their monthly allowance can publish one more listing for $0.99.
```

Grounded in production `plan_limits`: free = 3 publishes/mo, 0 included
renewals, 5 active max. Note the naming trap — the internal enum is
`grower`/`farm`/`sponsor` but the customer-facing names are **Pro / Max /
Farm**, and `planDisplay()` in `lib/allowance.ts` does that translation. Never
write "grower" or "farm" in store copy.

### 1.4 Release notes ("What's new") — 500 char limit

**492 / 500.**

```
Gnome's first Android release.

Browse what neighbors are growing, sorted by distance — or see it all as pins on the map. Post something to sell, share free, trade, request, or offer a garden plot. Run your own Market with pickup spots, hours, Market Drops and Gift Baskets. Buyers pick a pickup window; a private thread opens once you approve. Gnome AI turns a photo into a listing draft that waits for you. Sellers get a Sales Notebook and a Grow Log.

Settings -> Send feedback reaches us.
```

Deliberate choices: it reads as an introduction rather than a changelog,
because for every Play user this *is* version one — the `1.1.0` number is an
artifact of the iOS track. "Send feedback" is real (`useSendFeedback` in
`app/settings.tsx`). The arrow is ASCII `->` because Play's release-notes field
has historically mangled some typographic characters; `→` also fits if you
prefer it (490 chars).

---

## 2. Store settings — category, tags, contact

| Field | Value | Note |
|---|---|---|
| App or game | **App** | |
| Category | **Shopping** | Gnome is a marketplace first. "Food & Drink" is the plausible alternative, but that category is dominated by recipe and restaurant apps and would bury a peer-to-peer marketplace. Unchanged from §3 |
| Tags | Up to **5**, chosen from Play's fixed list in Store settings → App category → Manage tags | Play's tag vocabulary is a closed list that changes; pick the closest available matches to **marketplace / classifieds / grocery / local / food** and confirm the exact strings in the console. Do not invent tag names — the console will only accept its own |
| Contains ads | **No** | No ad, analytics, or attribution SDK in `expo/package.json` (§4) |
| In-app purchases | **Blocked on the B4 decision** — see §7 | |
| Free or paid | **Free** | |
| Countries | **United States only** | |
| Email | **daniel@boonesystems.com** | B3 closed; MX verified deliverable |
| Website | **https://gnomefarmersmarket.com** | |
| Phone | Leave blank | Optional, and a personal number becomes public on the listing |
| Privacy policy | **https://gnomefarmersmarket.com/privacy** | |
| Account deletion URL | **https://gnomefarmersmarket.com/delete-account** | Entered under App content → Data safety → Data deletion, not on the listing page |

**Content rating.** Do not re-derive; `GOOGLE_PLAY_PACKAGE.md` §6 has the full
IARC questionnaire with reasoning. Carry those answers over verbatim. Exactly
one answer needs updating:

> **"Does the app allow users to purchase digital goods?"** — §6 answers *"No if
> B4 is gated off; otherwise Yes."* Since §6 was written, the $0.99 overage
> checkout has been **proven working end-to-end on Android** (Stripe TEST:
> authorization pending → paid → consumed exactly once, listing published). So
> unless the overage is gated off on Android before the build ships, the honest
> answer is **Yes**, and the same flips Store settings → In-app purchases to
> **Yes** with a `$0.99` price range.

Expected outcome is unchanged by that flip: ESRB **Teen** / PEGI **12** / USK
**12**, with "Users Interact" and "Shares Location" descriptors, driven by
messaging and approximate location sharing rather than by depicted content.

---

## 3. Graphics — required assets

Play's current specs, fetched live 2026-08-18:

| Asset | Spec | Where it stands |
|---|---|---|
| **App icon** | 512 × 512, **32-bit PNG with alpha**, max **1024 KB** | Derivable. `expo/assets/images/icon.png` is 1024 × 1024 RGBA at 1.76 MB. Downscale to 512 and re-encode — roughly a quarter of the pixels, comfortably under the 1024 KB cap. Fully automatic |
| **Feature graphic** | 1024 × 500, **JPEG or 24-bit PNG, no alpha** | **Does not exist. Play will not let you publish without it.** See §3.1 |
| **Phone screenshots** | 2 minimum to publish; **4 at ≥1080 px** to be eligible for Play promotion; up to 8. JPEG or 24-bit PNG, no alpha, 320–3840 px per side, and the long side may be **at most twice** the short side (Play's words: *"The maximum dimension of your screenshot can't be more than twice as long as the minimum dimension."*). A per-file size cap of 8 MB is widely reported but is **not** stated on Play's own page — confirm in the console if a frame gets large; nothing here will come close | See §4. Target 8 |
| 7"/10" tablet screenshots | Optional, 4 each if supplied | **Skip.** No tablet layouts; `supportsTablet: false` on iOS. Play will show a "not optimized for tablets" note. Acceptable for 1.1.0 |
| Promo video | Optional, a YouTube URL | **Skip** |

### 3.1 Feature graphic — what it should be

**1024 × 500, no alpha.** It is the banner at the top of the store page and the
tile in Play's editorial surfaces. Some placements crop the edges, so keep
everything load-bearing inside a centered ~924 × 400 safe area, and never put
text in the outer 50 px.

**What it should depict.** Not a screenshot collage — at the width this renders
on a phone, UI text is illegible. The brand already has everything needed:

- **Ground:** Parchment `#F6F2E9` (which is also `android.adaptiveIcon.backgroundColor`), with a soft Moss `#618049` wash toward one edge.
- **Left third:** the gnome badge from `expo/assets/images/badge.png`, scaled up.
- **Center:** "Gnome" set in Fraunces 900 Black (`node_modules/@expo-google-fonts/fraunces/900Black/Fraunces_900Black.ttf`) in Ink `#152820`.
- **Under it:** the app's own tagline, verbatim from the Browse header — **"Fresh from the garden next door."** — in Inter, Muted `#556D63`. It is already the product's line; the store banner should not invent a different one.
- **Right third:** a small color-coded cluster echoing the map pins — Moss `#517439` (free), Terracotta `#AE5832` (sell), Teal `#38728A` (trade) — as simple produce silhouettes or plain dots. This visually rhymes with screenshot #2.
- **No** device frames, **no** feature bullets, **no** "#1"/"best"/star ratings, **no** price. Play rejects feature graphics that imply a rating or an award.

**Can it be produced automatically?** **Partly, and honestly so.** I can
composite exactly the above with PIL — brand hexes, the real badge PNG, the real
Fraunces and Inter TTFs already in `node_modules` — and hand back a
spec-compliant 1024 × 500 24-bit PNG plus a JPEG. That gets a *correct,
on-brand, typographically clean* banner. What it will not have is illustration:
the produce cluster would be flat shapes, not drawn art. If the banner matters
for launch impression, this is the one asset genuinely worth an
illustrator — a half-day of design work. My recommendation: let me generate it
now so nothing is blocking, and treat commissioning art as a fast-follow that
does not gate submission.

---

## 4. Phone screenshots

### 4.1 Play's requirements, and the trap in this repo's emulator

- 2 minimum to publish; **4 at ≥1080 px is the real floor** if you want Play promotion eligibility; 8 maximum. Supply **8**.
- Portrait 9:16, JPEG or 24-bit PNG, **no alpha**.
- **The long side may be at most twice the short side.**

That last rule is the trap. The RC emulator `gnome_rc` is configured
`hw.lcd.width = 1080`, `hw.lcd.height = 2400` — a **2.222 : 1** panel. A raw
`adb exec-out screencap` from it is **1080 × 2400 and Play will reject it.**

Two fixes, either fine:

1. **Post-process (recommended).** Capture natively at 1080 × 2400, then place the capture on a 1080 × 2160 Parchment canvas — exactly 2:1, short side exactly 1080. With a caption band this falls out naturally: 1080 × 2160 canvas, top ~360 px caption band in Parchment with Fraunces text, capture scaled to ~800 × 1778 and centered below it. Keeps the real modern phone viewport.
2. **Re-cut the AVD** at `hw.lcd.width = 1080` / `hw.lcd.height = 1920` so captures are natively 9:16 and need no processing. Costs you a slightly unusual layout that no real modern phone has.

The app is portrait-locked (`android:screenOrientation="portrait"`,
`"orientation": "portrait"` in `app.json`), so there is no landscape set to make.

### 4.2 The data problem — read this before capturing anything

Production is effectively empty, and screenshots taken against it would be
worse than no screenshots. Measured on `fgybyghwcjlstqxkclch`, 2026-08-18:

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
| Markets | 13 |

Three consequences:

1. **Every demo listing renders a "Preview" pill and no distance** (`components/ListingCard.tsx` — `listing.is_demo ? <Text>Preview</Text>`, and `distance_miles != null && !listing.is_demo`). A store screenshot showing "Preview" chips and no distances advertises an empty app.
2. **No listing anywhere has a photo.** The Browse feed, the listing detail, the Market page, and the Gift Basket are all photo-led surfaces. Without photos they photograph as text cards.
3. There are **zero** Sell, Free, or Trade listings, i.e. three of the five types the description leads with cannot be shown at all.

**So: seeded, non-demo data with real photos is a hard prerequisite for shots
1, 2, 3, 6 and 8.** Two legitimate routes:

- **(A) Daniel's own real Market.** He creates one Market with genuine listings and photographs of produce he actually has. Everything on screen is then true, and the reputation counts in shot 6 are real derived numbers.
- **(B) A purpose-made screenshot account in a staging project**, seeded via `supabase/seed/seed_listings.mjs` extended to attach photos, with `is_demo` **false** so the Preview pill and the distance suppression do not fire. Never seed this into production.

Either way the photographs themselves have to come from somewhere with a clean
licence. I will not download stock imagery on an assumed licence — that is a
decision for Daniel (shoot them, or buy them).

Screenshot hygiene, unchanged from §8.2: purpose-made account, **no real names,
addresses, phone numbers, or avatars** in any frame, and no Seed Drop modal in
any frame.

### 4.3 Shot list — 8 shots, in the order they should appear

Order matters more than count: Play shows the first 2–3 in the search-result
carousel before anyone taps through, so the first three have to answer "what is
this and why do I care" without a caption.

| # | Screen | Route | What must be on screen | Caption | Why it earns the slot |
|---|---|---|---|---|---|
| 1 | **Browse feed** | `app/(tabs)/index.tsx` | The Gnome badge + "Fresh from the garden next door." header; 3–4 photo cards visible with **real distances** ("0.4 mi", "1.2 mi") and mixed type badges (For Sale / Free / Trade); the type chip row; the distance control reading "Within 10 mi". **Not** filtered, **no** Preview pills, search box empty | *"See what's growing a few streets away"* | The whole proposition in one frame: real food, real prices, real distances. If a person only sees one screenshot, this is it |
| 2 | **Map tab** | `app/(tabs)/map.tsx` | "Markets Near You" title, real Google tiles with recognizable streets, **6+ color-coded pins** spread over the visible area, one pin tapped so the `ListingCard` preview sheet is up at the bottom, type + radius chips visible | *"The whole neighborhood, on one map"* | The single most persuasive proof that this is local. It was un-shootable until B1 closed — capture it. Needs ≥6 seeded listings with `approx_lat`/`approx_lng` inside one radius, or the map reads as empty |
| 3 | **Post composer** | `app/(tabs)/post.tsx` | The five-type chooser row visible with all five emoji + labels (Sell 🏷️ / Share Free 🧺 / Trade 🔄 / Wanted 🔎 / Offer a Plot 🌾), Sell selected, heading "List something for sale", a photo already attached, price and unit filled | *"Sell it, share it, trade it, or ask"* | Converts a browser into a seller, and it is the only frame that shows all five types at once. Needs no seeded data beyond one photo |
| 4 | **Gnome AI draft review** | `app/(tabs)/ai.tsx` | One or two draft review cards from a real photo — title, suggested price, unit, category — with the **Publish / Edit / Discard** controls clearly visible | *"A photo becomes a listing you approve"* | The differentiator, and the review controls are the honest part: they show nothing auto-publishes. Requires one live AI call against a real photo |
| 5 | **Gnome AI assistant reply with a confirm card** | `app/(tabs)/ai.tsx` | A conversation: user asks *"What should I sell right now, and why?"* or *"Mark my cucumbers sold out"*, assistant replies, and a **proposal card with a Confirm button** is on screen with its item list | *"Ask your market anything — you confirm, it acts"* | No competitor screenshot looks like this. Also pre-empts the "does an AI post for me?" objection by showing the confirm gate. Needs a seeded Market with several live listings |
| 6 | **Market page** | `app/market/[id].tsx` | Market name, avatar, story, the derived reputation block (Shared / Sold / Traded + "Member since"), **2 pickup locations with hours**, a **live Market Drop** card showing its window, and 3+ listing cards below | *"Your own Market, followed by neighbors"* | Shows a seller this is a storefront, not a classifieds post. **Only shoot this with real derived counts** — the numbers are computed, never edit them to look bigger |
| 7 | **Pickup order / chat** | `app/market/order/[marketId].tsx` **or** `app/chat/[claimId].tsx` | *Order:* cart lines with quantities, subtotal, and the pickup window picker with real slots. *Chat:* a short two-sided thread arranging a handoff, with the pay-methods row visible | *"Pick a window, sort the rest privately"* | Answers "how do I actually get the tomatoes". Prefer the **order** screen — it shows pickup windows and delivery, which the chat cannot. The chat needs a second account to look real |
| 8 | **Sales Notebook** | `app/notebook.tsx` | The monthly summary with real totals, a ledger of 8–10 sales mixing Gnome and off-app entries, and 2–3 expense rows | *"One ledger for the whole season"* | The retention feature, and the reason a serious seller stays. Needs ~10 seeded `record_sale` rows + expenses dated in the current month, or the summary reads $0 |

**Shots that were considered and cut:**

- **Grow Log** (`app/growlog/[claimId].tsx`) — genuinely charming, but it only applies to plot claims, needs three staged photos plus a second account, and would displace something that sells the app to everyone. Hold it for a later listing refresh.
- **Upgrade / plans** (`app/upgrade.tsx`) — informational only, no purchase; showing a price list with no way to buy invites a policy question.
- **Promote / Boost** (`app/promote/[listingId].tsx`) — F6: `buySingle()` is an alert saying checkout is "almost ready". Never screenshot a priced button that does nothing.
- **Seed Drop modal** — announcement only; screenshotting it would advertise something the backend refuses to sell.
- **Onboarding / sign-in** — nobody downloads an app to see its login screen.

### 4.4 Captions

The table gives caption text for the overlay treatment (band above each frame,
Fraunces 900 Black in Ink `#152820` on Parchment). Captions are worth it:
Play's listing shows screenshots small, and an unlabeled Map tile is ambiguous.

Fallback if the caption treatment is not ready: **plain, unadorned device
captures are perfectly acceptable** and cannot look cheap the way a bad overlay
can. They still need the 2:1 fix from §4.1 — pad to 1080 × 2160 on Parchment.

---

## 5. What I can produce automatically vs. what needs Daniel

### 5.1 I can do these end to end, today

| Deliverable | How | Confidence |
|---|---|---|
| **512 × 512 app icon** | Downscale `expo/assets/images/icon.png` (1024 × 1024 RGBA), preserve alpha, verify 32-bit PNG and <1024 KB | Certain — pure transform of an existing asset |
| **1024 × 500 feature graphic** | PIL composite: Parchment ground, `badge.png`, Fraunces 900 Black wordmark, Inter tagline, three pin-colored marks; flattened, no alpha; PNG + JPEG variants; verified against the spec | High for *correct and on-brand*; it will read as clean typography, not illustration |
| **Boot, install, and drive the emulator** | `~/Library/Android/sdk/emulator/emulator -avd gnome_rc`, install the vc4 APK, `adb emu geo fix` to place the device in the seeded metro, navigate every screen | High — the AVD exists and B1 is verified working on it |
| **Capture every frame** | `adb exec-out screencap -p` per screen | Certain |
| **Make captures Play-legal** | Pad/scale each 1080 × 2400 capture to 1080 × 2160 (exactly 2:1) on Parchment, optional caption band, strip alpha, verify ≥1080 px on the short side and correct format | Certain |
| **Verify every asset against the live spec** | Programmatic check of dimensions, aspect ratio against the 2:1 rule, bit depth, alpha, and file size before anything is handed over | Certain |
| **Extend the seeding script** | Add photo attachment and `is_demo = false` to `supabase/seed/seed_listings.mjs`, pointed at a **staging** project — never production, where I am SELECT-only by rule | High, once the photos exist |
| **Fill the Sales Notebook / Market Drop / Gift Basket / order fixtures** | Drive the real in-app flows on the emulator against staging, so the data is produced the way a user would produce it | High |

### 5.2 These genuinely need Daniel (or design)

| Item | Why it cannot be automated | Blocking? |
|---|---|---|
| **Produce photographs** | Every photo-led screenshot needs real images, and production has zero. I will not download stock on an assumed licence. Shoot them, or buy a small licensed set | **Yes — blocks shots 1, 2, 3, 4, 6, 8** |
| **The B4 decision** | Gate the $0.99 overage off on Android for 1.1.0, integrate Play Billing, or use the US external-offers programme. It sets In-app purchases, the IARC digital-goods answer, and whether the PLANS paragraph goes in | **Yes — blocks §2 and §6** |
| **Fixing `GOOGLE_PLAY_PACKAGE.md` §7.2** | The reviewer note still says "NO PURCHASES / This version sells nothing", which is now false. Someone has to rewrite it — see §7 | **Yes — do not submit as written** |
| **Play Console data entry** | Every field above, the IARC questionnaire, category and tags, the App access reviewer credentials. No console access from here | Yes |
| **Reviewer test account** | Created by hand and entered in App content → App access. Credentials must not be committed | Yes |
| **Personal vs organization developer account** | Determines whether the 12-testers-for-14-days closed-testing requirement applies. Invisible from the repo, and it is the biggest schedule risk on Android (§7.1) | Yes, for scheduling |
| **Illustration for the feature graphic** | I can make it correct; making it *charming* is an illustrator's half-day | No — fast-follow |
| **Whether captions go on the screenshots** | A taste call, and plain captures are a legitimate answer | No |
| **Second human-feeling account for the chat shot** | I can drive two accounts, but shot 7 should prefer the order screen anyway | No |

### 5.3 Honest expectation about emulator screenshot quality

Good enough, with two caveats. Google Maps tiles render correctly on the AVD
(B1 verified), fonts and the 420 dpi panel are sharp, and `adb exec-out
screencap` is lossless. The real quality ceiling is **content, not capture** —
a technically perfect screenshot of an empty feed still sells nothing. Get the
photos and the seed data right and these will look like a real app; skip that
and no amount of post-processing rescues them.

---

## 6. Pre-submission checklist for the listing page

- [ ] Photos sourced and licence settled
- [ ] Staging seeded: ≥10 non-demo listings with photos across Sell/Free/Trade/Wanted/Plot, in one metro, all inside a 10-mile radius, with `approx_lat`/`approx_lng` set
- [ ] Market fixture: story, avatar, 2 pickup locations with hours, delivery on, 1 live Market Drop, 1 Gift Basket
- [ ] Notebook fixture: ~10 sales + 3 expenses dated in the current month
- [ ] B4 decided; §2 In-app purchases and the §6 digital-goods answer set to match
- [ ] `GOOGLE_PLAY_PACKAGE.md` §7.2 "NO PURCHASES" paragraph rewritten (§7 below)
- [ ] 512 × 512 icon generated and verified
- [ ] 1024 × 500 feature graphic generated and verified
- [ ] 8 screenshots captured, padded to 1080 × 2160, alpha stripped
- [ ] Every frame checked for real names, addresses, phone numbers, avatars, Preview pills, and Seed Drop
- [ ] App name / short / full / release notes pasted and the console's own counters confirm 27 / 67 / 3797 / 492
- [ ] Category Shopping; 5 tags picked from the console's own list
- [ ] Contact email, website, privacy URL, deletion URL entered

---

## 7. One correction that must land before submission

`GOOGLE_PLAY_PACKAGE.md` §7.2's reviewer note contains:

> **NO PURCHASES**
> This version sells nothing. There is no Google Play Billing integration and no
> payment processing inside the app.

The first sentence is no longer true. The $0.99 publish/renewal overage
(`expo/lib/billing.ts` → `billing-checkout` → Stripe hosted checkout →
`my_overage_required` reconciliation) has been **proven working end to end on
Android**. It is reachable by any Free seller on their 4th Sell listing of the
month or their first renewal. Telling review that the app "sells nothing" while
shipping a working purchase is the kind of discrepancy that produces a
suspension, not a rejection.

I do not own that file, so here is the replacement text for whoever does. Pick
the variant matching the B4 decision.

**If B4 → (a), the overage is gated off on Android for 1.1.0:**

```
NO PURCHASES ON ANDROID
This version sells nothing on Android. There is no Google Play Billing
integration and no payment processing inside the Android app. Sellers who
exhaust their monthly publishing allowance are told the paid option is not
available on Android yet. When a buyer and seller settle up for goods, the app
can open the seller's own Venmo / PayPal / Cash App / Zelle handle; the payment
happens entirely in that app and Gnome never sees or records it. A disclaimer
saying so is shown every time.
```

**If B4 → (b) or (c), the overage ships:**

```
PURCHASES
Goods sold between neighbors are never paid for inside Gnome. The app can open
the seller's own Venmo / PayPal / Cash App / Zelle handle; the payment happens
entirely in that app and Gnome never sees or records it, and a disclaimer
saying so is shown every time.

There is one digital purchase, and it is seller-facing only: a seller who has
used their monthly publishing allowance may pay $0.99 to publish one additional
listing or renew one expiring listing. Buyers never encounter it. [State here
the billing route B4 selected — Play Billing, or the US external-offers
programme with its required disclosures.]
```

---

## 8. Sources for the Play rules quoted above

Fetched live 2026-08-18 rather than recalled, because Play's asset and policy
pages change:

- [Add preview assets to showcase your app](https://support.google.com/googleplay/android-developer/answer/9866151) — icon 512 × 512 32-bit PNG with alpha, max 1024 KB; feature graphic 1024 × 500 JPEG or 24-bit PNG with no alpha; screenshots JPEG or 24-bit PNG, 320–3840 px per side, 2 minimum to publish, up to 8 per device type; *"The maximum dimension of your screenshot can't be more than twice as long as the minimum dimension."*
- [Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152) — app name 30, short description 80, full description 4000; limits apply identically to full-width and half-width characters
- [Prepare and roll out a release](https://support.google.com/googleplay/android-developer/answer/9859348) — *"up to 500 Unicode characters per language"* for release notes
- [Choose a category and tags for your app or game](https://support.google.com/googleplay/android-developer/answer/9859673) — up to 5 tags, chosen from Play's own list under Store settings → App category → Manage tags
- [Google Play screenshot sizes 2026](https://appradar.com/blog/android-app-screenshot-sizes-and-guidelines-for-google-play) — secondary source for the 4-screenshots-at-1080px promotion-eligibility threshold and the commonly cited 8 MB per-file cap; treat both as guidance, not as quoted policy
