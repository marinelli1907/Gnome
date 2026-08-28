# Boone Systems — Gnome Master Launch Report

Checked: 2026-08-24
Repo: `/Users/danielmarinelli/BooneSystems/Gnome`
Branch: `codex/gnome-launch-finish-20260819`
HEAD: `21a734aa14f65feed4e848311f74926eaa45e276`
Verdict: **Launch with conditions**

## Executive Verdict

Gnome is not a toy prototype. It has real mobile, web, admin, Supabase, RLS, AI, compliance, credential, pickup, marketplace, and pricing infrastructure. It should not launch as a broad national marketplace yet. It can move toward a constrained Northeast Ohio beta after the P0 items below are fixed or formally owner-accepted with documented compensating controls.

Do not enable live payments. Do not public-submit stores. Do not apply broad production compliance enforcement without an existing-listing impact audit.

## P0 — Must Fix Before Public Launch

1. Verified phone OTP and account-feature gate.
2. Verified email gate and Supabase dashboard proof.
3. Versioned Terms, Privacy, and Marketplace Rules acceptance.
4. Marketplace Rules page/content and risk notice in account flow.
5. Ohio product matrix approved for beta categories.
6. Server-side compliance gate tested for app, web, AI, import, renew, repost, duplicate, admin activate.
7. Attorney review of policies, seller agreement, Ohio category wording, AI disclaimers, and marketplace facilitator exposure.
8. Insurance broker review and bind/decline decision.
9. Android physical push proof and signed-build Map regression.
10. Fix or owner-accept the two medium security findings.
11. Decide age gate for beta.
12. Recruit enough launch sellers/inventory to avoid an empty marketplace.

## P1 — First 30 Days

- Add credential-scope approval snapshot/hash.
- Replace legacy AI JWT parsing with `auth.getUser`.
- Add AI chat retention policy.
- Add moderation/enforcement appeal UI and runbook.
- Add seller help copy for Ohio category conditions.
- Run RLS/privacy tests against pickup, credentials, market contact, and AI usage.
- Start broker/counsel/CPA review loop.

## P2 — First 90 Days

- Complete Northeast Ohio county/local rule review.
- Improve Zordy compliance assistant against machine-readable rule data.
- Add state expansion workflow.
- Add stronger upload/MIME/EXIF tests.
- Add support/moderation metrics.
- Reassess paid AI tier for privacy and reliability.

## P3 — Future

- State-by-state regulated category expansion.
- Integrated payments only after tax/legal/insurance review.
- D&O/EPLI/workers comp when company structure requires.
- Deeper analytics and marketing tools only after implemented.
- Strategic partnerships and white-label only after Ohio operating model works.

## Account Trust

| Item | Status | Evidence / action |
|---|---|---|
| Verified email | Partial | Supabase email auth exists; launch gate and dashboard posture need proof. |
| Verified phone | Not launch-ready | Phone is stored/format-validated, but not OTP-verified; app/web copy still says optional. |
| Terms | Not launch-ready | Terms page exists; versioned acceptance gate not found in audited paths. |
| Privacy | Not launch-ready | Privacy page exists; must be versioned/accepted and updated after phone-OTP decision. |
| Marketplace Rules | Not launch-ready | Rules need account-flow acceptance and seller/buyer enforcement language. |
| Age gate | Owner/legal decision needed | Recommend 18+ at launch unless counsel approves a narrower model. |

## Compliance

### Ohio

- Ready: whole fresh fruits, whole fresh vegetables, ordinary uncut garden herbs, non-regulated crafts.
- Allow with conditions: cottage foods that do not require refrigeration, plain honey, maple/sorghum, some vegetable/herb starts, sealed commercial seed packets after review.
- Verification required: eggs, home bakery, nursery stock, seller-labeled seed, pet food/treats/feed, meat, poultry, dairy, cultivated mushrooms, high-risk processed foods.
- Prohibited / blocked for beta: raw milk, wild mushrooms, unverified canned/acidified foods, unlicensed refrigerated prepared foods, shellfish/high-risk seafood, illegal/recalled products.
- Research required: county/local edge cases, low-risk MRFE application to specific seller workflows, bait, cosmetics/skin-contact makers, seed resale details.

See `docs/compliance/GNOME_OHIO_PRODUCT_MATRIX.md`.

### Server Gate

| Path | Status |
|---|---|
| App manual publish | Server compliance trigger exists; test required. |
| Web publish | Server compliance trigger exists; test required. |
| AI draft | AI draft schema is advisory; publication must remain server-gated. |
| Import | Import creates drafts and resolves taxonomy server-side; publish tests required. |
| Renew/repost | Lifecycle/renew guards exist; test against restricted categories. |
| Admin activate | Admin bypass exists; policy/process required so admin does not override prohibited categories accidentally. |

## Seller Experience

- Normal produce friction: should be very low.
- Exemption questionnaire: required for eggs, cottage food, honey, starts, and seeds.
- Credential UX: exists; needs copy/status alignment with directive and scope-race fix.
- Zordy compliance assistance: should explain rules using compliance data; must never invent legal advice or bypass gate.

## Buyer Safety

- Marketplace notice: use approved independent-seller notice.
- Product disclosure: require ingredients/allergens/handling where relevant.
- Pickup privacy: public approximate only; exact details after approved reservation/order.
- External payments: always say Gnome does not process or hold off-platform money.

## Security

| Area | Status |
|---|---|
| Auth | Email partial; phone OTP missing; legacy AI JWT parsing medium finding. |
| RLS | Substantial RLS exists; targeted tests still required. |
| Pickup privacy | Strong design; runtime tests required. |
| Credential storage | Private bucket; scope approval race remains. |
| Admin | Internal app exists; MFA/least-privilege process required. |
| AI | Schema validation and quota work exist; retention/privacy issues remain. |
| Logging | Needs final pass to remove debug details from client-visible errors. |

Critical findings: none validated.
High findings: none validated.
Medium findings: 2.

## Insurance

Recommended coverages:

- CGL with products-completed operations.
- Tech E&O.
- Cyber/privacy.
- Media/advertising injury.
- Umbrella/excess later.

Expected range: **$2,000-$15,000 first year** depending limits/exclusions.

Brokers to contact:

- Oswald Companies: <https://www.oswaldcompanies.com/>
- Hylant: <https://hylant.com/solutions/business-insurance/coverage/cyber>
- CBIZ Insurance: <https://www.cbiz.com/services/insurance>
- Embroker: <https://www.embroker.com/coverage/tech-errors-omissions/>
- Coalition: <https://www.coalitioninc.com/technology-errors-and-omissions-insurance>
- At-Bay: <https://www.at-bay.com/insurance/tech-eo/>
- Vouch: <https://www.vouch.us/>
- FLIP as seller-side benchmark: <https://www.fliprogram.com/>

## Attorneys

Counsel to contact:

- Calfee: <https://www.calfee.com/capabilities-practices-IT-Law>
- Benesch / Michael D. Stovsky: <https://www.beneschlaw.com/people/michael-d-stovsky/>
- BakerHostetler: <https://www.bakerlaw.com/services/digital-assets-and-data-management/>
- Tucker Ellis: <https://www.tuckerellis.com/services/privacy-data-security/>
- Thompson Hine: <https://www.thompsonhine.com/services/emerging-technologies/>
- BECE agricultural counsel: <https://ohiocounsel.com/>
- Stebelton agricultural/environmental: <https://www.stebelton.com/agricultural-environmental-law/>
- Axiom privacy/cyber fractional: <https://www.axiomlaw.com/practice-areas/data-privacy-cybersecurity/ohio/cleveland>
- Outside GC: <https://outsidegc.com/>
- Scale LLP: <https://scalefirm.com/services/general-counsel-services/>

## Competition

Coop is live on iOS and Android and publicly positions as a neighborhood marketplace for handmade/homegrown local goods. It appears to have app-store social proof and payment/order convenience that Gnome does not yet have.

Gnome advantages:

1. Zordy horticulture AI.
2. AI listing/photo assistance.
3. Compliance credential center.
4. Server-side compliance gates.
5. Privacy-safe location posture.
6. Seller Market storefronts.
7. Inventory/reservation tools.
8. Pickup scheduling/privacy design.
9. Garden Planner and grower identity.
10. Off-platform payment flexibility with no payment custody.

Gnome weaknesses:

1. Not live in app stores.
2. Phone verification missing.
3. Legal/policy acceptance missing.
4. Compliance rules incomplete.
5. Lower checkout convenience.
6. No public social proof.
7. Marketplace density not proven.
8. Insurance/counsel not bound.
9. Zordy privacy/data posture unresolved.
10. Operational burden higher than generic classifieds.

## Expenses

- One-time launch: $4,350-$28,000 practical planning range.
- Lean monthly: $750-$2,500.
- Normal monthly: $2,500-$8,000.
- Growth monthly: $8,000-$25,000.
- Year-1 estimate: $35,000-$120,000 before founder salary.

## Business Plan

- Target market: Northeast Ohio small sellers and buyers.
- GTM: seller-first, anchor sellers before buyer push.
- Seller density target: 20-40 active sellers and 150-300 active listings inside each launch pocket.
- Revenue model: Free, Pro $9.99/mo, Farm $29.99/mo; no live payments yet.
- Break-even: roughly 250-500 paid sellers depending plan mix and support/compliance load.
- 12-month plan: prove Ohio pocket density and operational compliance.
- 24-month plan: repeatable state expansion only after state matrices are researched.

## Top 20 Red Flags

| Severity | Problem | Impact | Likelihood | Mitigation | Blocker |
|---|---|---|---|---|---|
| Critical | Phone OTP missing | Account abuse and trust gap | High | Implement OTP/rate limits/gate | Yes |
| Critical | Policy acceptance missing | Legal enforceability gap | High | Versioned acceptance | Yes |
| Critical | Ohio matrix incomplete | Illegal/high-risk listings | High | Restrict beta categories | Yes |
| High | Insurance not bound | Defense/indemnity risk | Medium | Broker review | Yes |
| High | Attorney/CPA review incomplete | Legal/tax exposure | High | Engage counsel/CPA | Yes |
| High | Marketplace facilitator uncertainty | Unexpected tax obligations | Medium | CPA/tax counsel | Yes before payments |
| High | Android push unproven | Store/release risk | High | Hardware test | Yes for Play |
| High | Map signed-build risk | App whiteout | Medium | Device regression | Yes for Play |
| Medium | Legacy AI JWT parsing | Cross-user risk if config drifts | Medium | `auth.getUser` | No, but fix |
| Medium | Credential scope race | Overbroad approvals | Medium | Scope snapshot | No, but fix |
| Medium | AI retention undefined | Privacy/compliance risk | Medium | TTL policy | No |
| Medium | Debug errors exposed | Information leakage | Medium | Generic client errors | No |
| Medium | Empty marketplace | Launch failure | High | Anchor sellers | Yes for public |
| Medium | Coop momentum | Competitive pressure | High | Local concierge launch | No |
| Medium | Off-platform payment scams | Trust damage | Medium | Rules/reporting | No |
| Medium | Seller false claims | Liability/trust | Medium | Rules/moderation | No |
| Medium | Local county rule variation | Compliance surprises | Medium | County review | No |
| Medium | Admin override misuse | Prohibited listing risk | Low/Med | Admin SOP/audit | No |
| Medium | Upload abuse | Malware/privacy risk | Medium | MIME/size scans | No |
| Medium | Support overload | Founder drag | Medium | Invite beta | No |

## Top 20 Gnome Wins

1. Real mobile app.
2. Real web app.
3. Separate admin surface.
4. Mature Supabase schema and RLS posture.
5. Private compliance document storage.
6. Server-side compliance trigger exists.
7. Seller credential center exists.
8. Public approximate/private exact location design.
9. Stripe live gate protects against accidental live payments.
10. Current three-tier pricing model is clear.
11. Zordy has actual product identity.
12. AI drafts/photo/import are schema-limited.
13. Market storefronts exist.
14. QR/local stand use case exists.
15. Pickup/reservation model exists.
16. Seller ledger exists.
17. Garden Planner differentiates beyond commerce.
18. Website and app branding are moving toward parity.
19. Northeast Ohio launch focus is realistic.
20. The product has a credible compliance moat if completed.

## Daniel's Owner Decisions

1. Is launch invite-only Northeast Ohio beta?
2. Is 18+ required for all accounts at launch?
3. Which phone OTP vendor will Boone use?
4. Which lawyer gets first review?
5. Which broker gets first insurance call?
6. Is paid AI required before launch for privacy posture?
7. Which Ohio categories are enabled on day one?
8. Are all regulated categories paid-plan-only, credential-only, or both?
9. How much launch spend is authorized?
10. What seller-density threshold unlocks public promotion?

## Final Recommendation

Launch a Northeast Ohio invite-only beta with whole produce, ordinary herbs, and very limited condition-based items. Block or draft-hold raw milk, wild mushrooms, high-risk canned/acidified foods, unlicensed refrigerated prepared foods, shellfish/high-risk seafood, and any unresearched regulated categories.

Verify email, phone, Terms/Privacy/Rules acceptance, Ohio matrix, insurance, counsel, Android push, signed-build maps, and the two medium security findings before public launch. Keep live payments disabled.
