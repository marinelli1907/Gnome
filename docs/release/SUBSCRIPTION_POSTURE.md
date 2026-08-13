# Paid-subscription launch posture — iOS

**Decision owner:** Daniel · **Prepared:** 2026-08-13 · **Repo state:** `main`, migrations
through `0092` applied (`supabase/migrations/APPLIED.tsv` tail), `0089`/`0090`/`0091`
declared unapplied (`supabase/migrations/UNAPPLIED.txt`).

**Recommendation: A — launch iOS free, with paid subscriptions not available for
purchase in the app.** Reasoning in §5. Exact copy in §6. Findings in §8.

---

## 0. Method, and what "verified" means in this document

Everything in §§1–3 was established by reading the repository: migration SQL, the
Expo app source, the Next.js web app, and the Stripe webhook. Everything in §4 was
established by fetching Apple's live guideline text on 2026-08-13.

**I did not run the app, build an iOS binary, or query the production database.**
Where a claim depends on runtime or on production data, it is marked as such in §9.
Plan numbers below are the values the migration files write; they are what production
holds *if* nobody has hand-edited `plan_limits` through the SQL editor. That has not
been confirmed against the live table.

Two facts were supplied by the coordinator and are treated as established:
`payments_live_enabled = false`, and no live Stripe price id exists for any product.
Both are consistent with what the code shows — nothing in the repo contains a price id.

---

## 1. The commercial model as the code defines it

### 1.1 Public tier names

Two different public names are in use for the same tier, which is itself a finding
(§8, S-5):

| DB value | Name on web + plan screen | Name in the nudge card and post error |
|---|---|---|
| `free` | **Neighbor** (`web/app/pricing/page.tsx:55`, `expo/app/upgrade.tsx:16`) | **Free** (`expo/components/UpgradePromptCard.tsx:18`, `expo/app/(tabs)/post.tsx:327`) |
| `grower` | **Grower** | Grower |
| `farm` | **Farm** | Farm |
| `sponsor` | *not shown on the pricing page at all* | **Sponsor** (`UpgradePromptCard.tsx:21`) |

### 1.2 Entitlement limits — current values

`plan_limits` is created in `supabase/migrations/0005_markets.sql:122-138` and then
amended by `0011`, `0052`, `0062` and `0081`. Net current state:

| Column | free | grower | farm | sponsor | Last written by |
|---|---|---|---|---|---|
| `max_active_listings` | 5 | **25** | `null` (unlimited) | `null` | `0062:29-33`, then `0081:15` set grower 50 → 25 |
| `max_pickup_locations` | 1 | 2 | 5 | 10 | `0052:3-5`, then `0062:30-32` |
| `extra_location_fee_cents` | — | 500 | `null` | `null` | `0062:31` |
| `included_boost_credits` | 0 | 3 | 10 | 10 | `0011:41-44`, then `0081:15-19` |
| `ai_listing_assistant` | false | true | true | true | `0081:24-25` |
| `advanced_delivery` | false | true | true | true | `0081:24-25` |
| `max_photos` | 5 | 10 | 10 | 10 | `0005:132-138` (never amended) |
| `price_cents` | 0 | 999 | 2999 | 9900 | `0005:132-138` (never amended) |

`null` in `max_active_listings` means unlimited — `enforce_plan_limit()` returns early
on a null cap (`0008_plan_limits.sql:44-46`).

The resolved read is `my_plan_entitlements()`, redefined at
`0081_commercial_model.sql:276-328`. It joins `market_effective_plan()` (which lets an
admin complimentary grant outrank the base plan) to `plan_limits`, and returns
`entitlement_source` ∈ `free | stripe | complimentary | sponsor`
(`expo/app/upgrade.tsx:23`). **This matters for posture:** a market can legitimately be
on Grower or Farm *today* through a comp grant, with no payment involved.

### 1.3 Features that a paid plan unlocks inside the iOS app

This list is the crux of the Apple analysis (§4.2), so it is exact:

| Gated capability | Where it is gated in the app |
|---|---|
| Active listing cap (5 → 25 → unlimited) | DB trigger `0008:60-63`; surfaced at `expo/app/(tabs)/post.tsx:324-334` |
| Pickup locations (1 → 2 → 5, +$5/mo extras on Grower only) | `market_pickup_location_allowance()` `0062:35-48` |
| AI Listing Assistant | `expo/app/ai-listing.tsx:130-141` — hard gate, renders a lock state |
| Advanced delivery (distance fees, same/next-day cutoffs, weekly schedules) | `expo/app/market/delivery-settings.tsx:231-241` |
| Listing promotions (3/mo Grower, 10/mo Farm) | `expo/app/promote/[listingId].tsx:131-162` |
| Selling regulated categories | `expo/components/ComplianceGate.tsx:103-121` (`PLAN_REQUIRED`) |

All six are consumed **inside the app**.

### 1.4 Billing periods and intended prices

| Product key | Intended price | Period | Active? | Source |
|---|---|---|---|---|
| `GNOME_GROWER_MONTHLY` | $9.99 | monthly | true | `0083:224-232` |
| `GNOME_FARM_MONTHLY` | $29.99 | monthly | true | `0083:224-232` |
| `GNOME_PICKUP_LOCATION_ADDON` | $5.00 per location | monthly | true | `0083:224-232` |
| `GNOME_LISTING_PROMOTION` | $3.99 | one-time, 7 days | true | `0081:651-659` |
| `GNOME_PROMOTION_PACK_3` / `_10` | $9.99 / $29.99 | one-time | **false** | `0081:653-654` |
| `GNOME_SEED_DROP_SEASONAL` | $24.99 | per season | true (but Seed Drop ships Coming Soon) | `0081:655` |
| `GNOME_GROWER_SEED_BUNDLE` | $199.00 | annual | **false** | `0083:230` |
| `GNOME_FARM_SEED_BUNDLE` | $429.00 | annual | **false** | `0083:231` |
| Sponsor ($99.00) | $99.00 | implied monthly | **no product row exists at all** | `plan_limits` only |

Two structural notes. First, **there is no server-side field that says "monthly."**
`plan_limits` carries `price_cents` with no interval column; `billing_products` carries
`kind = 'subscription'` with no interval either. The word "/month" exists only in UI
strings and in Stripe price configuration that does not exist yet (§8, S-10). Second,
`stripe_price_id_live` is null for every row — `billing_price_id(key,'live')`
(`0083:31-36`) returns null, so the live path cannot resolve a price even if the gate
were flipped.

---

## 2. Does the iOS app contain any purchase affordance? — grep results

**No. Not one.** All greps run over `expo/` excluding `node_modules`.

| What I searched for | Hits |
|---|---|
| `StoreKit`, `react-native-iap`, `expo-in-app-purchases`, `InAppPurchase`, `RevenueCat`, `react-native-purchases` (case-insensitive, across `*.ts` `*.tsx` `*.js` `*.json`) | **zero** |
| Same terms in `expo/package.json` dependencies | **zero** |
| `checkout` / `Checkout` | one hit, and it is a string inside an alert: `expo/app/promote/[listingId].tsx:119` |
| `billing-checkout` (the edge function) | **zero callers anywhere in the repo** |
| `stripe` (case-insensitive) | one hit: the string literal `'stripe'` as an `entitlement_source` union member, `expo/app/upgrade.tsx:23` |
| `/pricing` | **zero** |
| `checkout.stripe.com` / `billing.stripe.com` | **zero** |
| `gnomefarmersmarket.com` | four hits, all non-commercial: `/terms`, `/privacy`, `/trust` (`expo/app/settings.tsx:173,181,189`), `LEGAL_BASE` (`expo/app/sign-in.tsx:20`), `WEB_BASE` (`expo/lib/links.ts:8`) |
| iOS entitlements / plugins in `expo/app.json` | `expo-router`, `expo-font`, `expo-web-browser`, `expo-location`, `expo-image-picker` — no StoreKit, no purchase entitlement |

### 2.1 What the app shows instead — every priced surface, exactly

These are the strings a reviewer will see. Every one of them names a price for
something the app cannot sell:

| File:line | Current behaviour |
|---|---|
| `expo/app/upgrade.tsx:119` | Tier rows render `` · ${formatPrice(l.price_cents)}/mo`` → "Grower · 25 active listings · … · $9.99/mo", "Farm · … · $29.99/mo" |
| `expo/app/upgrade.tsx:93-97` | "Additional locations $5.00/mo each — billing setup coming soon." |
| `expo/components/UpgradePromptCard.tsx:63-67` | "Upgrade to Grower for 25 active listings — $9.99/mo." |
| `expo/components/UpgradePromptCard.tsx:69-71` | A styled **"Upgrade"** button |
| `expo/components/UpgradePromptCard.tsx:46-52` | Tapping it fires `Alert.alert('Coming soon', 'Grower plans arrive soon — we'll let you know the moment you can upgrade.')` |
| `expo/app/promote/[listingId].tsx:155` | Button labelled "Feature for 7 days · $3.99" |
| `expo/app/promote/[listingId].tsx:115-121` | Tapping it fires `Alert.alert('Buy a promotion · $3.99', 'Promotion checkout is almost ready. Until then, Grower ($9.99/mo) includes 3 promotions a month and Farm includes 10.')` — a hardcoded price, not read from `plan_limits` |
| `expo/app/(tabs)/post.tsx:325-334` | On hitting the cap: "Free Markets can have up to **10** active listings. Upgrade to Grower for more." — the real free cap is **5** (`0062:29`) |
| `expo/app/_layout.tsx:104-107` | The modal route is titled **"Upgrade"** |

The Seed Drop surface is clean by comparison and is the model to copy:
`expo/components/SeedDropComingSoon.tsx:93-96` says nothing is for sale, there is no
pricing, and there is no way to order or subscribe — with no numbers anywhere.

### 2.2 Outbound purchase-adjacent links

The only ones are for **physical goods**, and they are correct as-is:
`paymentLink()` / `openPaymentLink()` at `expo/lib/marketops.ts:168-199` open a
seller's Venmo / PayPal / Cash App handle for an in-person produce handoff. The
comment at `marketops.ts:164-167` records the rule the code follows: opening a link
never marks anything paid. This is Guideline 3.1.3(e) territory, not 3.1.1 (§4.2).

---

## 3. Restore, cancellation, and entitlement synchronisation

**Restore purchases: does not exist, and is not required.** Grep for
`restore purchase` / `restorePurchase` across `expo/` returns nothing. Guideline
3.1.1's restore requirement attaches to restorable in-app purchases; there are none.
If iOS IAP is ever added, this becomes mandatory the same day.

**Cancellation: does not exist anywhere, on any platform.** Grep for `billing_portal`
/ `billingPortal` / "manage subscription" across `web/` and `expo/` returns nothing.
The Stripe webhook *handles* `customer.subscription.updated` and
`customer.subscription.deleted` (`supabase/functions/stripe-webhook/index.ts:241-248`,
mapping to `cancelled` / `payment_failed` / `paused`), so a cancellation initiated
from Stripe's side is processed correctly — but no Gnome surface can initiate one.
Meanwhile `web/app/pricing/page.tsx:171-177` promises in print that plans "can be
cancelled anytime." That promise currently has no implementation (§8, S-9). It is not
an App Review problem while nothing is sold; it is a hard prerequisite for the first
live charge.

**Entitlement synchronisation: sound, and the reason option A is cheap.** The chain is
one-directional and already built:

```
Stripe event → stripe-webhook (service role) → markets.plan / market_subscriptions
            → market_effective_plan() → plan_limits → my_plan_entitlements()
            → enforcement triggers + every gate in §1.3
```

The client is physically unable to write plan state (`0068` header, "ENTITLEMENT SOURCE
OF TRUTH"), and `my_plan_entitlements()` is the single resolved read the app makes
(`expo/app/upgrade.tsx:37-48`, plain `useQuery` with no `staleTime`, so it refetches on
mount). `usePlanLimits()` caches for one hour (`expo/lib/db.ts:648-661`). If a
subscription is ever purchased on the web, an iOS user's entitlements light up on the
next fetch with no client work at all.

This is exactly why option B is expensive: StoreKit would introduce a **second writer**
of plan state with no path into this chain. Nothing in `stripe-webhook` or the RPC
layer knows how to consume an App Store Server Notification.

---

## 4. Apple's current rules — checked 2026-08-13, not from memory

Source: <https://developer.apple.com/app-store/review/guidelines/>, fetched
2026-08-13. Guideline numbering below is the numbering live on that page today.

### 4.1 What changed recently, and what did not

- **1 May 2025** — Apple updated Guidelines 3.1.1, 3.1.1(a), 3.1.3 and 3.1.3(a) for
  compliance with a US court decision about buttons, external links and other calls to
  action ([news id `9txfddzf`](https://developer.apple.com/news/?id=9txfddzf)). That
  change is **still in the live guideline text today** — this is the single most
  important thing to have re-checked rather than remembered.
- **6 Feb 2026** and **8 Jun 2026** — the two most recent guideline revisions. Neither
  touched the 3.1.x payment rules; they covered UGC/anonymous chat, developer identity,
  Sensitive Content Analysis, kid/teen safety and Live Activities.

### 4.2 The provisions that decide this question

**3.1.1 In-App Purchase.** If you unlock features or functionality *within* the app —
subscriptions and premium content are its own examples — you must use in-app purchase,
and you may not use your own unlock mechanism. Every one of the six gates in §1.3 is
"features or functionality within the app." **This is the rule that drives the
recommendation.**

**3.1.1(a) Link to Other Purchase Methods.** Entitlements exist for linking out to a
developer-owned site to buy digital content. Critically, the current text states those
entitlements are *not required* for buttons, external links or other calls to action in
**United States storefront** apps, and the general prohibition on such links applies in
all storefronts *except* the US one.

**3.1.3 (preamble) Other Purchase Methods.** Apps in 3.1.3 may not encourage users
in-app toward a non-IAP purchase method — with an explicit carve-out for the US
storefront and for 3.1.1(a)/3.1.3(a).

**3.1.3(b) Multiplatform Services.** Apps that work across platforms may let users
access content, subscriptions or features acquired on other platforms or on the
developer's website — **conditioned on those same items also being available as in-app
purchases within the app.** That proviso is in the live text and is easy to miss. It is
the reason "web-only forever" is not the risk-free position it is often assumed to be.

**3.1.3(e) Goods and Services Outside of the App.** Physical goods and services
consumed outside the app *must not* use IAP. This covers Gnome's produce, homemade
goods and seed packets, and the peer-to-peer payment handles in §2.2.
*Note the number:* this is **3.1.3(e)** in the current guidelines. `3.1.5` is now
**Cryptocurrencies** — `docs/release/APP_STORE_PACKAGE.md` §6.2 cites the old
`3.1.5(a)` and should be corrected (§8, S-8).

**3.1.2(a) Subscriptions — permissible uses.** An auto-renewable subscription must
deliver ongoing value, run at least seven days, and **work on all of the user's devices
where the app is available.**

**2.1(a) / 2.1(b) App Completeness.** Submissions must be final; placeholder and
temporary content is to be removed before submission. If IAPs are offered they must be
complete, current, functional and visible to the reviewer.

**2.3.1(a) Accurate Metadata.** Marketing the app in a misleading way — the guideline
names promoting a false price, inside or outside the App Store — is grounds for
removal.

**5.1.1(v)** account deletion is satisfied already: in-app entry at
`expo/app/settings.tsx:160-164` → `supabase/functions/delete-account` (deployed v6).

---

## 5. Recommendation

### 5.1 How live is this question for *this* build?

Partly not live at all, and partly very live — and the two halves are usually confused.

**Not live: the commercial half.** No live Stripe price id exists for any product;
`payments_live_enabled` is false; `billing_price_id(key,'live')` returns null; the web
pricing CTA degrades to a disabled "Coming soon" button whenever its payment-link env
var is unset (`web/app/pricing/PricingCTA.tsx:30-32`). Nobody can buy a subscription on
**any** surface today — not iOS, not web. Choosing between "IAP" and "web-only" is
choosing between two things that both currently sell nothing.

**Very live: the review half.** App Review responds to what the binary *displays*, not
to whether money can move behind it. The app today shows "$9.99/mo", "$29.99/mo",
"$3.99", "$5.00/mo each" and a button labelled "Upgrade" that opens an alert saying the
thing is not available. That is placeholder commerce under 2.1(a) and a promoted price
for a product that cannot be bought under 2.3.1(a) — independent of any 3.1.1 argument.
**The copy is the deliverable of this workstream; the billing architecture is not.**

### 5.2 The decision

> **A. Launch iOS free. Paid subscriptions are not available for purchase in the app,
> and the app says so plainly, with no prices anywhere.**

**The Apple rule that drives it: Guideline 3.1.1.** The six capabilities in §1.3 are
unlocked inside the app. Under 3.1.1, if Gnome sells them in the app at all, it must
sell them through IAP. Gnome cannot ship IAP responsibly right now (§5.3). Therefore
Gnome must not sell them in the app — which is already what the binary does, and the
only remaining work is to stop *saying* otherwise (2.1(a), 2.3.1(a)).

The seller-tools argument — that these are tools facilitating the sale of physical
goods, and so ride along with 3.1.3(e) — is a real argument, and it is why the produce
side of the app is unambiguously fine. But it is an argument about *seller software*,
which Apple has applied inconsistently to marketplace apps, and it is not needed to
ship this build. Do not spend it on a submission that has nothing to gain from winning
it.

### 5.3 Why not B — configure App Store subscription products before launch

B fails on four independent grounds, any one of which is sufficient:

1. **2.1(b) would reject it.** Configured IAPs must be complete and functional in the
   binary the reviewer runs. There is no StoreKit code, no product identifiers, no
   purchase flow and no receipt handling in `expo/`.
2. **There is no second writer of entitlements.** §3 shows the only path into
   `markets.plan` is `stripe-webhook` holding the service role. A StoreKit purchase
   would produce an App Store transaction that nothing in this system consumes. The
   user would pay and receive nothing.
3. **3.1.1 requires a restore mechanism** for restorable purchases, and **3.1.2(a)
   requires the subscription to work across all the user's devices.** Gnome's
   cross-device story is the Supabase account, not StoreKit — bridging the two is a
   project, not a pre-launch task.
4. **There is no cancellation path today** (§3). Apple handles cancellation for IAP,
   which conveniently hides that gap on iOS while leaving it wide open on web and
   creating two different cancellation experiences for the same product.

B is also the option that permanently takes 15–30% and splits the billing system in
two, for a product with **$0 in real revenue** and zero subscribers. It is the most
expensive possible answer to a question nobody is asking yet.

### 5.4 Why not C — web-only paid subscriptions, iOS shows entitlements but no purchase link

C is *nearly* what I am recommending, and the difference is worth being precise about,
because it is easy to pick C by accident.

C's problems are that it decides too much, too early, and slightly misstates the rules:

- **C is a permanent commercial commitment made at the worst possible moment.**
  "Web-only paid subscriptions" is a strategy. Today there are no paid subscriptions on
  the web either. Committing to a permanent distribution model for a product with no
  live price is a decision made on no information.
- **C leans on 3.1.3(b), and 3.1.3(b) does not say what C assumes.** The multiplatform
  allowance is conditioned on the same items also being available as in-app purchases
  within the app. An app that *only* honours web-purchased entitlements, forever, is
  reading past that condition. In practice many apps do exactly this and are not
  challenged — but "many apps get away with it" is not a launch posture, and
  `APP_STORE_PACKAGE.md` §6.2 currently calls 3.1.3(b) "the safe path" without noting
  the proviso.
- **C forecloses the option the May 2025 change opened.** Under the current 3.1.1(a)
  and 3.1.3 text, a **US storefront** app may include an external purchase link without
  any entitlement. Gnome is a US-only product. That is a genuinely available third road
  — worth keeping open and evaluating deliberately later, not ruling out now by
  declaring the model web-only.

A and C produce an **identical binary** for this submission. A produces a better
decision, because it keeps the commercial question open and dates it honestly.

### 5.5 What A commits Gnome to

- This submission ships with nothing purchasable and no price strings.
- App Store Connect: **no** in-app purchases, **no** subscription group, no Paid Apps
  agreement needed, no StoreKit configuration, no restore control.
- The `/upgrade` route survives as a **plan information** screen — it already renders
  live entitlements from `my_plan_entitlements()`, which is genuinely useful to the
  markets holding complimentary Grower/Farm grants (§1.2).
- Before any plan is ever sold, someone re-reads the then-current 3.1.1, 3.1.1(a),
  3.1.3 and 3.1.3(b) and picks one of {IAP, US external link, web-only} on purpose.
  This document's §4 is a snapshot dated 2026-08-13, not a standing answer.

---

## 6. Exact copy the iOS app should show

**Three global rules for this build.** (1) No dollar amount appears anywhere in the app
in connection with a plan, promotion or add-on. (2) No control uses a purchase verb —
no "Buy", no "Upgrade to X", no "Get". (3) No link to `/pricing`, to Stripe, or to any
external page that describes a price.

The coordinator applies all of the below; I edited no app code.

### 6.1 Plan screen — `expo/app/upgrade.tsx` and its route

| Where | Current | Replace with |
|---|---|---|
| `expo/app/_layout.tsx:106` route title | `Upgrade` | `Your plan` |
| `upgrade.tsx:63` heading | `Grow your Market` | `Your plan` |
| `upgrade.tsx:64-67` subheading | "More listings, pickup locations, and delivery tools as you grow — every limit below comes straight from the plan the platform enforces." | **"What your Market can do today, and what each plan includes. Plans are not sold in the app — nothing on this screen charges you."** |
| `upgrade.tsx:93-97` add-on hint | "Additional locations $5.00/mo each — billing setup coming soon." | **"Additional pickup locations aren't available yet."** |
| `upgrade.tsx:119` price segment | `` · ${formatPrice(l.price_cents)}/mo`` / `' · free'` | **Delete the whole price segment**, both branches |
| `upgrade.tsx:101` | `<UpgradePromptCard plan={plan} reason="limit" />` | **Remove from this screen** — it is the priced CTA, and the screen already states the position |
| New line, after the tier list | — | **"Grower and Farm aren't available to buy in the app. If your Market is already on a paid or complimentary plan, the limits above are live right now."** |

### 6.2 Nudge card — `expo/components/UpgradePromptCard.tsx`

| Where | Current | Replace with |
|---|---|---|
| `:18` label map | `free: 'Free'` | `free: 'Neighbor'` (match web and the plan screen) |
| `:61` title | "You've hit your Free limit" / "You're close to your Free limit" | **"You've reached your Neighbor listing limit"** / **"You're close to your Neighbor listing limit"** |
| `:63-67` body | "Upgrade to Grower for 25 active listings — $9.99/mo." | **"Pause or remove a listing to post a new one. Larger seller plans are coming — they aren't sold in the app."** |
| `:70` chip | `Upgrade` | `See plans` |
| `:46-52` `onUpgrade` | `Alert.alert('Coming soon', …)` | **`router.push('/upgrade')`** — keep the `upgrade_prompt_tapped` event, drop the alert |
| `:11-16` `NEXT` map | `farm: 'sponsor'` | **`farm: null`** — Sponsor is on no pricing page and has no product row (§8, S-6) |

### 6.3 Promotions — `expo/app/promote/[listingId].tsx`

Delete `buySingle` (`:115-121`) entirely, along with the hardcoded `$9.99` string, and
replace the no-credits branch (`:153-161`) with an informational state carrying **no
button**:

- When the market has an included allowance but has used it:
  **"You've used your 3 included promotions this month — they're back Sep 1. Extra promotions aren't sold in the app."**
- When the market is on Neighbor (allowance 0):
  **"Promotions are included with Grower and Farm. They aren't sold in the app."**

Keep the credit box (`:131-139`) and both redemption buttons (`:141-152`) exactly as
they are — redeeming an included or previously-granted credit involves no payment and
is correct behaviour.

Also rename the route title at `expo/app/_layout.tsx:111` from `Boost listing` to
`Feature listing`, to match the screen's own language (§8, S-14).

### 6.4 Listing cap — `expo/app/(tabs)/post.tsx:325-334`

The number is wrong today (10 vs the real 5). Do not hardcode the corrected number
either — read it from the entitlements the screen can already reach:

- Title: **"You've reached your listing limit"**
- Body: **"Your Neighbor plan allows {max_active_listings} active listings. Pause or remove one, then post this listing."**
- Buttons: `Not now` · **`See plans`** (unchanged target, `/upgrade`)

### 6.5 Feature gates — copy that must not send users on a dead errand

| File | Replace with |
|---|---|
| `expo/app/ai-listing.tsx:136` | Keep as written — "included with Grower and Farm plans" is accurate, carries no price and no purchase verb. Button stays `See plans`. |
| `expo/app/market/delivery-settings.tsx:234-237` | **"Distance surcharges, same-day and next-day cutoffs, and weekly delivery days are included with Grower and Farm."** Button stays `See plans`. |
| `expo/components/ComplianceGate.tsx:106-121` | Body: **"Selling in this category needs a paid Gnome seller plan plus any verification the category requires. Paid plans aren't available yet, so this category can't be listed right now. You can save a draft below."** Button label: **"What plans include"** (→ `/upgrade`). The current "Upgrade to sell this category" points at an action that cannot be completed on any platform. |

### 6.6 App Store Connect

- **In-App Purchases: none.** Do not create a subscription group, a product, or a
  StoreKit configuration file. Answer **No** wherever in-app purchase is asked about.
- **Account deletion: Yes** — `expo/app/settings.tsx:160-164`.
- Paid Applications Agreement is not required for this build.

### 6.7 Reviewer note — subscription paragraph

Add to the App Review Information notes, alongside the existing text in
`APP_STORE_PACKAGE.md` §8.2:

```
SUBSCRIPTIONS AND PURCHASES
This build contains no in-app purchases and no subscription products. Seller
plans (Neighbor, Grower, Farm) appear as information only: the "Your plan"
screen shows the seller's current limits and what each tier includes, and
states that plans are not sold in the app. There is no purchase button, no
external purchase link, no price shown for any plan, and no payment sheet
anywhere in the app.

Where the app shows a seller's own Venmo, PayPal, Cash App or Zelle handle,
that is a person-to-person payment for physical produce that two neighbors
hand over in person. Gnome never processes, receives or records that payment,
and a disclaimer to that effect is shown every time (Guideline 3.1.3(e)).
```

---

## 7. If the posture is revisited later

The three roads, so the next decision starts from facts rather than from scratch:

| Road | What it costs | What has to be true first |
|---|---|---|
| **IAP for plans** | 15–30%; a second entitlement writer; restore control; cross-device parity under 3.1.2(a) | An App Store Server Notification consumer that writes `markets.plan` the way `stripe-webhook` does, and a reconciliation story for a market that holds both a Stripe subscription and a StoreKit one |
| **US external purchase link** | Currently no entitlement required for the US storefront under 3.1.1(a) | Re-read 3.1.1(a) and 3.1.3 on the day, confirm US-only distribution, and confirm the then-current commission and disclosure terms. Do not build this from this document — §4 is a dated snapshot |
| **Web-only** | Simplest; no App Store revenue share | Accept the 3.1.3(b) proviso risk knowingly, and ship a real cancellation path first (§8, S-9) |

All three require live Stripe prices, `payments_live_enabled = true`, and a working
cancellation path — none of which exist today.

---

## 8. Findings

**BLOCKER: none.** Nothing in the subscription surface breaks production or harms a
user today, because nothing in it can transact.

### FIX BEFORE APP REVIEW

**S-1 · Priced, non-purchasable commerce surfaces in the iOS binary.**
Nine strings across five files (enumerated in §2.1) show prices for plans, promotions
and add-ons that cannot be bought on any platform, behind controls labelled "Upgrade"
and "Buy a promotion" that resolve to alerts. Guideline **2.1(a)** (placeholder and
temporary content must be scrubbed before submission) and **2.3.1(a)** (promoting a
false price is grounds for removal). Replacement copy: §6.1–§6.5.
*This is the same defect as R1 in `APP_STORE_PACKAGE.md:125`; this document supplies
the line-level inventory and the exact replacement strings.*

**S-2 · `expo/app/(tabs)/post.tsx:327` states the wrong free-tier cap.**
"Free Markets can have up to 10 active listings." The real cap is **5**
(`0062_subscription_remodel.sql:29`). The alert fires at the exact moment the user hits
5, so the app contradicts itself in the same breath. Guideline 2.3.1(a). Fix: §6.4.

**S-3 · `ComplianceGate` sends users to an upgrade that does not exist.**
`expo/components/ComplianceGate.tsx:117` renders "Upgrade to sell this category" for
`PLAN_REQUIRED`. No paid plan is obtainable on iOS *or* web today, so regulated
categories are unsellable and the button leads nowhere. A reviewer testing a regulated
category will land here. Fix: §6.5.

**S-4 · App Store Connect answers.** Answer **No** to in-app purchases; create no
subscription group or product; add the §6.7 reviewer paragraph. Not a code defect — a
submission step that must not be improvised at the form.

### FIX BEFORE PUBLIC RELEASE

**S-5 · The free tier has two public names.** "Neighbor" on the web pricing page and
the plan screen (`web/app/pricing/page.tsx:55`, `expo/app/upgrade.tsx:16`) versus
"Free" in the nudge card and the post error (`UpgradePromptCard.tsx:18`,
`post.tsx:327`). Pick Neighbor; it is the name in every marketing surface.

**S-6 · A Farm seller is offered an undefined $99/mo "Sponsor" tier.**
`UpgradePromptCard.tsx:14` maps `farm → 'sponsor'`, and lines 63-67 would render
"Upgrade to Sponsor … $99.00/mo". Sponsor appears on no pricing page and has **no
`billing_products` row at all** (§1.4) — it exists only as a `plan_limits` row from
`0005:137`. Reachable today: an admin complimentary Farm grant puts a market on `farm`,
after which this card renders. Fix: `farm: null` (§6.2).

**S-7 · The route is titled "Upgrade" for a screen that cannot upgrade anything**
(`expo/app/_layout.tsx:106`). Rename to "Your plan" (§6.1).

### FIX WITHIN 72 HOURS

**S-8 · `docs/release/APP_STORE_PACKAGE.md` §6.2 cites two guidelines incorrectly.**
It cites **3.1.5(a)** for "Goods and Services Outside of the App"; in the current
guidelines that is **3.1.3(e)**, and 3.1.5 is now Cryptocurrencies. It also calls
**3.1.3(b)** "the safe path for plans" without noting that the multiplatform allowance
is conditioned on the same items also being available as in-app purchases in the app
(§4.2). That document is the submission playbook; both errors point a future reader at
a wrong conclusion. Correction belongs to whoever owns that file.

### BACKLOG

**S-9 · No cancellation path exists anywhere, while the web promises one in print.**
`web/app/pricing/page.tsx:171-177` states plans are billed monthly and can be cancelled
anytime, and closes with "cancel first, ask second." No billing-portal link exists in
`web/` or `expo/`; the webhook consumes `customer.subscription.deleted`
(`stripe-webhook/index.ts:241-248`) but nothing in Gnome can trigger it. **Hard
prerequisite before the first live charge**, on consumer-protection grounds
independent of Apple.

**S-10 · No server-side billing interval.** `plan_limits` has `price_cents` with no
period; `billing_products` has `kind` with no interval. "/month" lives only in UI
strings. Any future price change or annual plan has no single source of truth to change.

**S-11 · Farm cannot buy extra pickup locations, Grower can.**
`extra_location_fee_cents` is 500 for `grower` and NULL for `farm`
(`0062:30-32`), and `market_pickup_location_allowance()` (`0062:41-47`) only adds
purchased slots where the fee is non-null. So a Farm seller is hard-capped at 5
locations while a cheaper plan can buy up to 20. Probably unintended.

**S-12 · `0091_founding_members.sql` (unapplied) depends on live paid subscriptions.**
Awards require a live-mode Stripe payment, and no live price id exists. Whatever
posture is eventually chosen determines whether an iOS-originated signup can ever
qualify.

**S-13 · Annual bundle products are seeded inactive** — `GNOME_GROWER_SEED_BUNDLE`
$199 and `GNOME_FARM_SEED_BUNDLE` $429 (`0083:230-231`, `active = false`). No UI
references them. Leave inactive; the webhook has a live bundle branch
(`stripe-webhook/index.ts:118`, `:211-215`) that would fire if a price were ever
attached.

**S-14 · Route title "Boost listing" vs screen copy "Feature"**
(`expo/app/_layout.tsx:111` against `promote/[listingId].tsx:125`). Cosmetic.

---

## 9. What this document could not verify

- **Live `plan_limits` row values.** §1.2 reports what the migrations write. Nobody
  read the production table. `0057_handmade_taxonomy.sql` is precedent that objects have
  reached production through the SQL editor without a ledger row, so a hand-edit is
  possible in principle.
- **Production environment variables.** `NEXT_PUBLIC_STRIPE_LINK_GROWER` and
  `NEXT_PUBLIC_STRIPE_LINK_FARM` (`web/app/pricing/page.tsx:11-12`) are read at build
  time on the deployed web app. The repo cannot show whether they are set. If either
  *is* set to a live Payment Link, the web could sell today and would bypass the
  `payments_live_enabled` gate entirely — that gate lives in `billing-checkout`
  (`0083`), and a dashboard Payment Link never touches it. **Worth one direct check of
  the deployed web env before relying on "nobody can pay."**
- **Runtime behaviour.** No iOS build was produced and no screen was rendered. Every
  claim about what a reviewer sees is read from source, not observed.
- **How App Review would actually treat Gnome's seller tools** under 3.1.1 versus
  3.1.3(e). §5.2 deliberately avoids needing an answer.
- **Whether the US external-purchase-link relief will still stand when Gnome wants it.**
  §4 is dated 2026-08-13. It is a snapshot of live text, not a prediction.
