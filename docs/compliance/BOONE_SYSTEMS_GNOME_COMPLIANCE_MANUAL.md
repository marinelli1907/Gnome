# Boone Systems — Gnome Compliance Manual

Checked: 2026-08-24
Audience: Daniel, Meghan, future staff, Codex, support, counsel, insurance broker, seller-verification reviewers.
Status: Plain-English operating manual. Not legal advice.

## 1. What Gnome Is

Gnome is a local marketplace and seller operating system for small local sellers: backyard growers, gardeners, farm stands, micro-farms, beekeepers, egg sellers, cottage-food sellers, plant sellers, makers where supported, and local buyers.

## 2. What Gnome Is Not

Gnome is not a free-for-all classifieds site. Gnome is not the manufacturer, inspector, certifier, insurer, or guarantor of independent sellers' products unless Boone Systems separately and explicitly says so.

## 3. Account Requirements

Full marketplace accounts should require:

- Verified email.
- Verified phone number through OTP/SMS or equivalent.
- Current Terms of Use acceptance.
- Current Privacy Policy acceptance.
- Current Marketplace Rules acceptance.
- Age gate, with 18+ recommended for launch unless counsel approves a narrower model.

Anonymous browsing may remain. Marketplace actions should be gated before posting, selling, creating a Market, reserving/buying, messaging, following Markets, using Zordy, viewing private pickup information, submitting credentials, or configuring external payment identifiers.

## 4. Buyer Rules

Buyers must review listing details, seller information, pickup conditions, product condition, allergens, ingredients, handling instructions, and other relevant information before purchasing or using an item. Buyers choose whether to use external payment methods at their own discretion, subject to rights that cannot legally be waived.

## 5. Seller Rules

Sellers are responsible for accurate listings, lawful right to sell, licenses/permits/registrations where required, product safety, ingredients, allergens, labeling, storage/handling, honest certification claims, taxes, fulfilling reservations, communicating cancellations, and following federal/state/local law.

## 6. What Can Be Sold

At Ohio beta launch, low-friction categories should be limited to researched low-risk products such as whole fresh fruits, whole fresh vegetables, ordinary garden herbs, and non-regulated crafts.

## 7. What Needs Conditions

Some products may be listable with label/disclosure/handling conditions, such as qualifying cottage foods, plain honey, maple syrup, vegetable/herb starts, and sealed commercial seed packets after review.

## 8. What Needs Verification

Products that require Gnome credential review before publication include home bakery products, regulated nursery stock, seller-labeled seed, pet food/treats, meat, poultry, dairy, certain processed foods, and qualifying egg sellers where licenses or local health approvals apply.

## 9. What Cannot Be Sold

Raw milk, wild mushrooms, high-risk canned/acidified foods without verified path, unlicensed refrigerated prepared foods, shellfish/high-risk seafood, clearly prohibited products, and categories still legally uncertain must be blocked or saved as drafts pending research.

## 10. How Gnome Decides

Gnome should resolve each product/jurisdiction combination to one of five outcomes:

- Ready to list.
- Ready with conditions.
- Verification required.
- Not allowed on Gnome.
- Research required.

High-risk research-required categories fail closed.

## 11. Seller Credentials

Credential statuses:

- Not required.
- Required.
- Not provided.
- Under review.
- Verified.
- Rejected.
- Expiring soon.
- Expired.

Seller documents are private. Use private storage and signed access. Sellers never self-verify.

## 12. Admin Review

Admin review should show seller, Market, state, category, requirement, uploaded document, issuing agency, credential number if appropriate, expiration, supporting law/source, and review status.

Allowed actions:

- Verify.
- Reject.
- Request information.
- Mark expired.

## 13. Food Safety

Ordinary whole produce should stay low friction. Cut, canned, acidified, refrigerated, prepared, meat, dairy, seafood, and wild-foraged foods require stronger review. Zordy must not invent food-safety rules.

## 14. Plants / Nursery

Vegetable/herb starts may be lower friction than regulated nursery stock. Nursery stock, trees, shrubs, hardy perennials, bulbs, cuttings, grafts, and buds require Ohio nursery-law review.

## 15. Seeds

Distinguish sealed commercial seed packets from seller-labeled or repackaged seed. Seller-labeled seed requires seed-law review and likely verification.

## 16. Pet Food

Pet food, pet treats, and animal feed are not ordinary craft goods. Treat as verification required until ODA/feed review is complete.

## 17. Eggs

Ask simple questions: own birds, number of laying birds, pickup location, packaging/refrigeration, and licenses. Do not launch egg listings broadly until Ohio small-egg/local health/MRFE requirements are confirmed for launch pockets.

## 18. Honey

Plain honey from the seller's own hives may be lower friction with labeling conditions. Infused/flavored honey needs review.

## 19. Cottage Food

Cottage foods must be non-TCS/shelf-stable and labeled. Home bakery products are different and require ODA license/inspection.

## 20. Meat / Poultry / Dairy

Fail closed for beta unless a verified inspected/legal path exists. Raw milk is blocked.

## 21. Pickup Privacy

Before approval: coarse location only. After approved reservation/order: private pickup instructions/location may be shown only to authorized buyer/seller. Never expose exact pickup address in public APIs/pages.

## 22. Payments

Gnome does not hold or process off-platform payments. Payment can occur directly through cash, Venmo, Cash App, PayPal, Zelle, or similar services only where allowed by policy. Always state: "Payment is handled directly between you and the seller. Gnome does not process or hold your money."

## 23. Zordy

Zordy is the assistant identity. Gnome AI is the underlying technology. Zordy must use actual compliance data, never bypass gates, never fabricate legal requirements, and never advise evasion.

Plan limits:

- Free: 5 successful requests/day.
- Pro: 25 successful requests/day.
- Farm: 100 successful requests/day.

## 24. Account Removal

Deletion must remove private contact, credentials/documents, tokens, and user-owned private artifacts where required. Preserve moderation/audit history only as legally and operationally justified.

## 25. Appeals

Provide appeal/review for enforcement actions. Do not permanently erase moderation history. Track reason, evidence, admin, timestamp, enforcement level, duration, and appeal status.

## 26. Data / Privacy

Phone verification does not equal SMS marketing consent. Email verification does not equal marketing-email consent. Marketing consent must be separate, optional, recorded, and revocable.

## 27. Security

Protect RLS, private pickup data, seller credentials, AI context, admin tools, and logs. Do not log raw images/base64, API keys, tokens, credentials, passwords, unnecessary phone/email, pickup addresses, or sensitive documents.

## 28. Incident Response

For product injury, data breach, credential fraud, prohibited listing, or payment scam:

1. Preserve evidence.
2. Restrict listing/account if needed.
3. Notify Daniel.
4. Determine legal/insurance notification obligations.
5. Document actions.
6. Review whether rules/gates need updates.

## 29. State Expansion

Ohio first. Expand regulated-product capability state by state. Unknown high-risk categories fail closed.

## 30. When Professional Review Is Required

Use attorney/CPA/broker/regulatory/security review for:

- Terms, Privacy, Marketplace Rules, seller agreement.
- Marketplace facilitator tax.
- Insurance coverage.
- Regulated food/agriculture categories.
- Minors/age gate.
- Phone/SMS marketing consent.
- Breach notification and retention.
- Public launch of high-risk categories.

## 31. Version / Review History

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-08-24 | Initial master launch directive compliance manual. |

## Primary References

- Ohio cottage food: <https://agri.ohio.gov/divisions/food-safety/resources/cottage-food>
- Ohio home bakery: <https://agri.ohio.gov/divisions/food-safety/resources/home-bakery>
- Ohio small egg production: <https://agri.ohio.gov/divisions/food-safety/resources/small-egg-production/>
- Ohio nursery law: <https://codes.ohio.gov/ohio-revised-code/chapter-927>
- Ohio seed law: <https://codes.ohio.gov/ohio-revised-code/chapter-907>
- Ohio marketplace facilitator definition: <https://codes.ohio.gov/ohio-revised-code/section-5741.01>
