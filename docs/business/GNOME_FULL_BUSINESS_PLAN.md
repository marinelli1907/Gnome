# Gnome Full Business Plan

Checked: 2026-08-24
Owner: Daniel / Boone Systems LLC
Repo: `/Users/danielmarinelli/BooneSystems/Gnome`
Branch: `codex/gnome-launch-finish-20260819`
HEAD: `21a734aa14f65feed4e848311f74926eaa45e276`
Working tree: dirty before this review; pre-existing modified/untracked files were preserved.

This is business-planning diligence, not legal advice, tax advice, insurance advice, or a launch authorization.

## Executive Verdict

**Launch with conditions**, not "fully launch ready."

Gnome is technically much more mature than a typical pre-launch marketplace: mobile, web, admin, Supabase RLS, private credential storage, server-side compliance gates, AI drafts, reservation/request flows, Market storefronts, and Stripe test-mode plumbing all exist. The biggest launch blockers are not "build the app." They are identity verification, policy acceptance/versioning, regulatory rule coverage, insurance/legal review, physical Android push proof, and first-market inventory density.

Gnome should launch only as a tightly scoped Northeast Ohio beta with restricted categories enabled, prohibited/high-risk categories fail-closed, live payments still off, and a human review loop for any regulated product. The database history and PostgreSQL 17 clean-room proof are complete; real-device QA, counsel, insurance, and production-change approval remain launch gates.

## Current Gnome Reality

| Surface | Current reality | Status |
|---|---|---|
| Customer app | Expo SDK `~54.0.27`, expo-router, React Native 0.81, new architecture enabled, iOS/Android package `app.boonesystems.gnome` | Implemented |
| Admin app | Separate Expo SDK `~57.0.12`, iOS-oriented internal app, no Android release posture | Implemented/partial |
| Web | Next.js 15 marketing, browse/map/pricing/login/my pages, Supabase browser client | Implemented/partial |
| Supabase | Postgres schema, RLS, Edge Functions, storage buckets, migrations ledger | Implemented |
| Auth | Supabase email/password, OTP/magic, Apple, Google, password reset, email verification resend, and phone OTP UI. Proposed server gates require verified email, verified phone, age confirmation, and current policy acceptance. | Implemented locally; production approval/device QA pending |
| Storage | Listing photos public bucket; compliance documents private `compliance-docs`; grow-log docs private | Implemented |
| Maps | React Native Maps in app; Leaflet/OpenStreetMap on web; exact coords are intended private, public coords approximate | Implemented, high-risk |
| Firebase/push | Android Firebase configured in repo; release board says physical Android push is not proven | Partial |
| Zordy/Gemini | Gemini-first AI assistant, garden/listing/photo flows, usage logging, daily allowance migration present | Implemented/partial |
| Subscriptions | Free, Pro (`grower`), Farm (`farm`), Legacy Farm (`sponsor` retired); live payments disabled | Implemented test mode only |
| Stripe | Checkout and webhook functions hardened for test/live separation; live activation checklist exists; `payments_live_enabled` must remain false | Test-mode implemented |
| Listings | Sell/free/trade/wanted/plot types, publish allowance, requests/reservations, AI drafts | Implemented |
| Markets | Storefronts, pickup settings, payment handles, follows partly web-only, QR tools | Partial |
| Reservation/pickup | Claims/orders/pickup messaging and privacy model exist. PostgreSQL 17 reservation, privacy, seller-ledger, and two-session oversell proofs pass. | Implemented locally; device QA pending |
| Seller ledger/accounting | Sales notebook / admin reporting surfaces exist; not an accounting system | Partial |
| Compliance center | Rules, credentials, private docs, admin review, server-side publish gate | Implemented, rule coverage incomplete |
| Credentials center | Seller credentials with statuses, scope, audit, private docs | Implemented |
| Prohibited products | Screening and prohibited category gates exist; rule data must be validated | Partial |
| Location/privacy | Public approximate location, private exact coords/pickup/contact fields, market grant hardening in 0093 | Implemented, needs tests |

Key local evidence:

- Private contact table and owner-only RLS: `supabase/migrations/0086_onboarding_and_ai_drafts.sql:25`.
- Phone is formatting-validated only: `supabase/migrations/0086_onboarding_and_ai_drafts.sql:156`.
- Seller credentials and rule model: `supabase/migrations/0042_compliance_core.sql:9`.
- Private compliance document bucket: `supabase/migrations/0043_compliance_storage_and_gate.sql:9`.
- Server-side compliance publish trigger: `supabase/migrations/0044_compliance_trigger_automation.sql:5`.
- Market exact contact/location columns removed from public grants: `supabase/migrations/0093_market_privacy.sql:18`.
- Current Privacy Policy still says phone is optional and never required: `web/app/privacy/page.tsx:43`.

## Business Summary

Gnome is a local marketplace for homegrown, homemade, and homestead goods. The wedge is not "another classifieds app." It is seller-first tooling for gardeners, micro-farms, farm stands, beekeepers, egg sellers, cottage-food producers, and plant sellers who need local discovery, inventory, pickup coordination, and low-friction listing creation.

The best initial market is Northeast Ohio, with seller density by 10-mile clusters rather than a broad national app-store launch. A healthy launch cluster should target:

- 20 to 40 active sellers within 10 miles.
- 150 to 300 active listings.
- At least 30 percent inventory refreshed weekly.
- At least 5 visibly credible "anchor" sellers: farm stand, beekeeper, egg seller, cottage-food seller, plant/nursery seller.
- At least 10 new buyer/seller interactions per week in each launch pocket.

## Target Customers

| Segment | Problem | Gnome offer |
|---|---|---|
| Backyard growers | Surplus goes unused; Facebook posts disappear | Quick Sell/Free/Trade listings, map, pickup coordination |
| Serious gardeners | Seasonal gluts, seed/plant swaps | Market storefront, AI listing help, local radius |
| Micro-farms/farm stands | Need direct local demand without full e-commerce overhead | Market, hours, inventory, QR, reservations |
| Beekeepers/egg sellers | Local recurring demand, trust, rules | Listings, credentials, pickup scheduling |
| Cottage-food producers | Discovery and repeat local buyers | Market storefront, category/rule guidance |
| Plant sellers | Regulated category, seasonal discovery | Credential gate, taxonomy, local pickup |
| Buyers | Find real local goods nearby | Browse/map, following, wanted posts, reservations |

## Current Monetization

Do not rely on stale docs. Current code truth is the 0126 pricing model:

| Plan | Enum | Customer price | Current posture |
|---|---|---:|---|
| Free | `free` | $0 | 3 Sell publishes/month, one Market, limited Wanted intros |
| Pro | `grower` | $9.99/mo | Unlimited Sell publishes/renewals, paid seller tools |
| Farm | `farm` | $29.99/mo | Larger farm/business tier |
| Legacy Farm | `sponsor` | retired | Internal comp rung only |

Live payments are off by owner rule and by code. The live activation path is documented in `docs/billing/STRIPE_LIVE_ACTIVATION.md` and must not be bypassed.

## Revenue Model

Base subscription assumptions:

| Scenario | Users | Active users | Sellers | Paid sellers | MRR |
|---|---:|---:|---:|---:|---:|
| Conservative 1k | 1,000 | 250 | 50 | 5 Pro, 1 Farm | ~$80 |
| Base 5k | 5,000 | 1,250 | 250 | 35 Pro, 8 Farm | ~$590 |
| Strong 10k | 10,000 | 3,000 | 700 | 120 Pro, 30 Farm | ~$2,100 |
| Strong 25k | 25,000 | 7,500 | 1,800 | 330 Pro, 90 Farm | ~$5,990 |
| Breakout 50k | 50,000 | 17,500 | 4,500 | 900 Pro, 250 Farm | ~$16,490 |
| Breakout 100k | 100,000 | 40,000 | 10,000 | 2,000 Pro, 700 Farm | ~$40,970 |

Break-even depends more on support/compliance/insurance than hosting. A lean, insured, counsel-reviewed Gnome likely needs about $1,500 to $4,500/month before founder compensation and about $4,000 to $10,000/month once compliance review/support becomes real work. A practical subscription break-even target is **250 to 500 paid sellers**, depending on plan mix and support load.

## Zordy Cost Model

Current source posture uses Gemini free tier first. Google says Gemini API free-tier data may be used to improve products, while paid tier has different data-use posture; pricing varies by model and changed in 2026. Source: [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), checked 2026-08-24.

Model usage should assume not every user hits max quota. Planning assumptions:

| Tier | Daily cap | Expected actual use | Risk |
|---|---:|---:|---|
| Free | 5/day | 0.1 to 0.7 requests/day active user | Support/abuse spikes |
| Pro | 25/day | 1 to 5 requests/day paid seller | Listing-photo use can spike |
| Farm | 100/day | 3 to 15 requests/day paid seller | Farm sellers may use batch workflows |

Paid AI becomes necessary when either privacy posture requires it, free quota becomes unreliable, or monthly request volume exceeds operational tolerance. Treat paid AI as a launch-quality expense, not a surprise.

## Go-To-Market

Launch seller-first, not buyer-first. Buyers only return when inventory changes.

Recommended first 30 days:

- Pick 2 to 3 Northeast Ohio launch pockets.
- Recruit 20 anchor sellers manually before broad promotion.
- Offer concierge onboarding: Daniel builds first Market/listings with seller approval.
- Print QR cards/stickers for farm stands and porches.
- Seed local Facebook gardening, homesteading, beekeeping, backyard chicken, and farmers market groups carefully without spam.
- Direct outreach to community gardens, nurseries, roadside stands, beekeepers, cottage bakers, egg sellers.
- Use local press only after at least one pocket has real inventory.

## 12-24 Month Plan

0-30 days:

- Finish identity and Terms acceptance design.
- Lock Ohio category launch list.
- Get attorney/CPA/broker review.
- Prove Android push and internal-test maps.
- Recruit launch sellers and real inventory.

30-90 days:

- Northeast Ohio beta.
- Measure listing freshness, seller retention, buyer requests, and compliance workload.
- Keep payments live disabled unless legal/tax/insurance preconditions are complete.

3-6 months:

- Expand to adjacent Ohio pockets.
- Add operations playbooks for support, moderation, credential review, incident response.
- Decide if Android/iOS purchase posture changes.

6-12 months:

- Add more states only under explicit state coverage status.
- Improve seller analytics only if genuinely implemented.
- Add paid AI posture if privacy/cost requires it.

12-24 months:

- Repeatable state launch framework.
- Consider strategic partnerships with farm bureaus, local food nonprofits, extension-adjacent groups, or co-ops.
- Explore licensing/white-label only after marketplace operations are proven.

## Financial Plan

The plan should be managed as a range, not a single-point forecast. The primary economic driver is paid-seller density; infrastructure is secondary to legal, insurance, moderation, credential review, and local seller acquisition.

| Planning horizon | Paid-seller target | Subscription revenue range | Cash operating range | Operating posture |
|---|---:|---:|---:|---|
| Year 1 | 75-200 exit run rate | $10,000-$35,000 | $35,000-$120,000 | Founder-led Ohio beta; deliberate legal/insurance spend |
| Year 2 | 300-700 | $45,000-$130,000 | $75,000-$180,000 | Repeatable Ohio clusters; part-time support/compliance |
| Year 3 | 900-1,800 | $160,000-$390,000 | $160,000-$400,000 | Select state expansion; dedicated marketplace operations |

These ranges are planning assumptions, not a promise of performance. They exclude founder compensation, financing costs, taxes, and any revenue source not currently shipped. The operating model should be refreshed monthly using actual conversion, churn, support time, AI/SMS usage, and seller-acquisition cost.

Initial funding priority:

1. Counsel, Ohio regulatory review, CPA review, and insurance binding.
2. Real-device QA, security remediation, monitoring, and incident readiness.
3. Seller concierge onboarding and launch-pocket inventory density.
4. SMS verification, maps, AI, and Supabase capacity tied to measured usage.
5. A contingency reserve for moderation, claims, and release incidents.

## Operating Model

Recommended Boone Systems model:

- Founder-led, seller-concierge beta.
- Human moderation and compliance review at launch.
- Counsel-reviewed Terms, Privacy, Marketplace Rules, seller agreement.
- Broker-placed GL/products-completed operations, Tech E&O, and cyber/privacy.
- CPA review before any real paid marketplace facilitation or tax collection.
- No final public app-store submission until owner launch decisions are resolved.

## Decisions Required

1. Which Ohio categories are allowed at beta launch?
2. Whether phone verification gates all account actions or only posting/reserving/messaging at first.
3. Whether to require Terms/Privacy/Marketplace Rules acceptance before or after verification.
4. Whether to ship as invite-only Northeast Ohio beta.
5. Whether to buy insurance before beta, and which limits.
6. Whether to keep all off-platform neighbor payments only for v1.
7. Whether to pay for Gemini/AI tier before launch to improve privacy posture.
8. Whether regulated listings require paid plan, credential verification, or both.
9. Whether Gnome will allow users under 18 to buy/reserve but not sell.
10. Whether to delay live payments until after 30-90 days of marketplace operation.

## Sources

- Supabase pricing: <https://supabase.com/pricing>
- Expo pricing: <https://expo.dev/pricing>
- Google Maps Platform pricing: <https://mapsplatform.google.com/pricing/>
- Gemini API pricing: <https://ai.google.dev/gemini-api/docs/pricing>
- Apple Developer Program fee: <https://developer.apple.com/programs/enroll/>
- Google Play registration fee: <https://support.google.com/googleplay/android-developer/answer/6112435>
- Stripe pricing: <https://stripe.com/pricing>
- Twilio Verify pricing: <https://www.twilio.com/en-us/verify/pricing>
