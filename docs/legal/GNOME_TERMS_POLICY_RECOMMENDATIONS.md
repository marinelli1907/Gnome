# Gnome Terms and Policy Recommendations

Checked: 2026-08-24
Status: Draft recommendations for attorney review. Do not deploy policy changes without owner/counsel approval.

## Required Policy Stack

Every usable account should affirmatively accept:

- Terms of Use.
- Privacy Policy.
- Marketplace Rules.

Acceptance should not use prechecked boxes. Store:

- User ID.
- Terms version.
- Privacy version.
- Marketplace Rules version.
- Timestamp.
- IP/device metadata only if counsel approves retention.

Material updates should trigger re-acceptance before account actions.

## Identity Requirement

Daniel's decision: every Gnome account must have email and phone, both verified, before it becomes fully usable.

Recommended flow:

1. Create account/sign in.
2. Verify email.
3. Verify phone via SMS OTP or equivalent.
4. Accept Terms/Privacy/Marketplace Rules.
5. Use account actions.

Anonymous browsing may remain. Gate at minimum:

- Posting.
- Selling.
- Reserving/buying.
- Messaging.
- Following Markets.
- Zordy AI.
- Market ownership.
- Seller tools.
- Credential submission.
- Pickup information.
- Payment handles.

Phone number is private account data. Do not expose it in public listings/Markets by default. Phone verification is not marketing consent.

## Marketing Consent

Transactional SMS for verification/account security is different from marketing texts. Do not bundle SMS marketing consent into Terms acceptance.

Recommended controls:

- Separate optional marketing checkbox.
- Clear disclosure of message type/frequency where required.
- Record consent timestamp/source/text/version.
- Easy opt-out in any marketing SMS.
- Honor opt-out in any reasonable manner.

Sources checked:

- FCC consumer robocall/text guide: <https://www.fcc.gov/consumers/guides/stop-unwanted-robocalls-and-texts>
- FCC revocation rule effective date: <https://www.fcc.gov/document/tcpa-rules-revoking-consent-unwanted-robocallsrobotexts>
- FCC removal of one-to-one consent rule after court decision: <https://www.fcc.gov/document/fcc-removes-one-one-consent-rule-nullified-court-decision>
- Ohio Telephone Solicitation Sales Act, ORC Chapter 4719: <https://codes.ohio.gov/ohio-revised-code/chapter-4719>
- Ohio AG telemarketing guide: <https://www.ohioattorneygeneral.gov/Business/Services-for-Business/Business-Guide/Telemarketing-and-Do-Not-Call-Registry>

Professional review required: yes.

## Marketplace Risk Language

Use the owner-approved concept, with attorney review:

> Gnome connects local buyers and sellers. Products are offered by independent sellers, not by Gnome. Unless specifically stated otherwise, Gnome does not manufacture, inspect, certify, guarantee, or insure products listed by sellers. Buyers should review listing details, seller information, pickup conditions, product condition, allergens, ingredients, handling instructions, and other relevant information before purchasing or using an item. Purchases and payments made directly between users are at the users' own discretion and risk, subject to rights and protections that cannot legally be waived. Gnome does not process or hold off-platform payments made through cash, Venmo, Cash App, PayPal, Zelle, or similar services.

Additions to consider:

- Gnome's compliance gates are platform rules, not government approval.
- Seller credential review is not a warranty that a product is safe or lawful.
- Users cannot waive non-waivable consumer/product/food-safety rights.
- Gnome may remove listings/accounts to reduce risk but has no duty to pre-screen all content.

## Seller Responsibilities

Terms/Marketplace Rules should say sellers are responsible for:

- Legal authority to sell.
- Licenses, permits, registrations, inspections.
- Labeling, ingredients, allergens.
- Safe preparation, storage, transportation, pickup.
- Accurate listings and truthful claims.
- Recall/stop-sale compliance.
- Product condition.
- Pickup fulfillment.
- Taxes.
- Applicable federal, state, county, municipal laws.

## Buyer Responsibilities

Buyer section should cover:

- Inspect listings and ask questions.
- Evaluate allergens/ingredients.
- Handle/store food appropriately.
- Choose external payment method at their own discretion.
- Use pickup locations safely.
- Understand rights are not fully waived.

## Marketplace Rules

Create a separate Marketplace Rules page with:

- Allowed listing types.
- Prohibited items.
- Regulated categories.
- Food safety basics.
- Pickup safety.
- Payment safety.
- Reporting/blocking.
- Enforcement and appeal process.

## Removal/Suspension Framework

Actions:

- Content removal.
- Warning.
- Posting restriction.
- Temporary suspension.
- Permanent removal.

Causes:

- Fraud: fake listing, fake identity, fake credential, impersonation, fake review/transaction/activity, misleading claim.
- Regulatory evasion: unlicensed regulated sale, credential forgery, miscategorization, compliance-gate bypass.
- Safety: knowingly unsafe product, allergen deception, recalled/prohibited goods, dangerous handling.
- Illegal/prohibited products.
- Harassment, threats, stalking, discriminatory abuse, repeated unwanted contact.
- Privacy: doxxing, pickup/address/phone/email exposure.
- Platform abuse: spam, scams, bots, scraping, security bypass, referral/ratings manipulation, account farming.
- Payment abuse: false payment claims, off-platform fraud.

Appeals:

- User can appeal from account email/in-app form.
- Store evidence, user statement, listing/message refs, admin notes.
- Status: received, under review, upheld, modified, reversed.
- Keep enforcement evidence unless retention policy requires deletion.

## Legal/Corporate Review List

Attorney:

- Terms, Privacy, Marketplace Rules, seller agreement.
- Limitation of liability, arbitration/class waiver decision.
- Food-safety disclaimers and non-waivable liability.
- Minor users/age gate.
- DMCA/content policy.
- Data retention, incident response, law-enforcement requests.
- Trademark filing for Gnome name/logo.

CPA:

- Marketplace facilitator exposure.
- Sales-tax obligations.
- 1099 posture if Gnome later processes payments.
- Ohio CAT/commercial activity questions.

Insurance broker:

- Product liability exposure even as a platform.
- Tech E&O/cyber/privacy.
- GL/products-completed operations.

Regulatory expert:

- Ohio ODA/ODH/local health district category matrix.
- 50-state expansion model.
