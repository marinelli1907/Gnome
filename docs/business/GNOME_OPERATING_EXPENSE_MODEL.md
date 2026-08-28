# Gnome Operating Expense Model

Checked: 2026-08-24
Status: Planning model, not accounting advice. External pricing should be rechecked before purchase.

## Current Known/Expected Software Costs

| Item | Current source | Monthly planning |
|---|---|---:|
| Supabase | Official Pro starts at $25/mo, includes compute credits | $25-$100 |
| Expo/EAS | Official pricing checked 2026-08-24: Free includes limited monthly builds; Starter has $45 build credit then usage pricing; Production has $225 build credit then usage pricing | $0-$225+ |
| Apple Developer | $99/year | $8.25 |
| Google Play | $25 one-time | $0-$25 one-time |
| Google Maps | Official pricing checked 2026-08-24: Dynamic Maps has 10,000 free monthly calls then starts at $7 per 1,000 on the first paid tier; subscription option starts at $100/mo for 50,000 monthly calls | $0-$100 early |
| Gemini API | Free tier initially; paid varies by model/tokens | $0-$250 early |
| Stripe | No monthly for standard processing; 2.9% + 30c typical online card | Variable |
| SMS verification | Twilio Verify checked 2026-08-24: $0.05 per successful verification + U.S. SMS cost starting around $0.0083/message | $10-$300 early |
| Domain/DNS/email | Provider unknown from repo | Quote/current bills required |
| VPS/hosting | Web deploy specifics present, exact bill not verified | Quote/current bills required |
| Monitoring/errors | Not verified | $0-$100 |
| Support tooling | Not verified | $0-$100 |
| GitHub/Codex/Figma/Notion/Linear/HubSpot | Company-use decision needed | Owner bills required |

Sources:

- Supabase pricing: <https://supabase.com/pricing>
- Expo pricing: <https://expo.dev/pricing>
- Expo billing docs: <https://docs.expo.dev/billing/plans/>
- Google Maps pricing: <https://developers.google.com/maps/billing-and-pricing/pricing>
- Google Maps subscription pricing: <https://mapsplatform.google.com/pricing/>
- Gemini pricing: <https://ai.google.dev/gemini-api/docs/pricing>
- Apple Developer: <https://developer.apple.com/programs/enroll/>
- Google Play fee: <https://support.google.com/googleplay/android-developer/answer/6112435>
- Stripe pricing: <https://stripe.com/pricing>
- Twilio Verify: <https://www.twilio.com/en-us/verify/pricing>

## New Security/Compliance Costs

| Item | Low | Expected | High |
|---|---:|---:|---:|
| Attorney Terms/Privacy/marketplace review | $1,500 | $4,000 | $12,000 |
| Ohio food/ag regulatory consult | $500 | $2,500 | $7,500 |
| CPA sales-tax/facilitator review | $500 | $1,500 | $4,000 |
| Insurance first year | $2,000 | $5,000 | $15,000 |
| Trademark filing/counsel | $350 | $1,500 | $3,500 |
| SMS verification setup/usage | $50 | $300 | $1,500 |
| Security review/pentest later | $0 | $5,000 | $25,000 |
| Credential review labor | founder | $500/mo | $3,000/mo |
| Support/moderation labor | founder | $500/mo | $4,000/mo |

## Launch Marketing Budgets

Bootstrap: $500-$1,500

- QR stickers/cards: $100-$300.
- Flyers: $100-$250.
- Local travel/events: $100-$400.
- Shirts/table basics: $100-$300.
- Small giveaways/referrals: $100-$250.

Lean: $3,000-$8,000

- Local seller onboarding materials.
- Farmers market/community garden visits.
- Micro social ads.
- Local photographer/content help.
- Seller referral credits.
- Local press/event booth fees.

Aggressive: $15,000-$40,000

- Multi-county seller acquisition.
- Paid content/social.
- Local event sponsorship.
- Larger referral program.
- Dedicated part-time ops/support.

## One-Time Launch Cost

| Category | Lean | Normal | Higher-risk/growth |
|---|---:|---:|---:|
| Legal review | $1,500 | $4,000-$8,000 | $12,000+ |
| CPA/tax marketplace facilitator review | $500 | $1,500-$3,000 | $5,000+ |
| Insurance bind/down payment | $1,500 | $3,000-$7,500 | $15,000+ |
| SMS verification setup/testing | $100 | $300-$1,000 | $2,500+ |
| Launch materials | $500 | $2,500-$6,000 | $15,000+ |
| Security review | Founder/static | $2,500-$7,500 | $20,000+ |
| App store/release incident buffer | $250 | $1,000 | $3,000 |

**Planning one-time launch range:** $4,350-$28,000 before optional paid ads or founder salary.

## Monthly Models

| Period | Fixed | Variable | Optional growth | Expected monthly |
|---|---:|---:|---:|---:|
| Month 1 | $200-$700 | $50-$300 | $500-$8,000 | $1,000-$9,000 |
| Months 2-3 | $300-$1,200 | $100-$800 | $500-$5,000 | $1,500-$7,000 |
| Months 4-6 | $500-$2,000 | $300-$2,000 | $1,000-$8,000 | $2,500-$12,000 |
| Months 7-12 | $1,000-$4,000 | $1,000-$6,000 | $2,000-$15,000 | $5,000-$25,000 |

| Model | Monthly range | Assumptions |
|---|---:|---|
| Lean monthly | $750-$2,500 | Founder support, low SMS volume, Supabase Pro, minimal paid marketing, insurance in force |
| Normal monthly | $2,500-$8,000 | Paid SMS verification, normal support/compliance time, modest launch marketing, broker/counsel check-ins |
| Growth monthly | $8,000-$25,000 | Multi-pocket launch, paid acquisition, part-time support/compliance labor, higher AI/maps/SMS volume |

Year 1 expected lean spend: **$35,000-$120,000**, before founder salary. Bootstrap founder-led could stay under $25,000 if legal/insurance scope is narrow, but that increases launch risk.

## Marketplace Facilitator Tax Budget Note

Do not budget as though "off-platform payments" eliminates tax exposure. Ohio Revised Code 5741.01 defines marketplace facilitator broadly as a person that owns, operates, or controls a physical or electronic marketplace through which retail sales or delivery network services are facilitated on behalf of marketplace sellers. Ohio tax counsel or a CPA should review Gnome before live payments, seller subscription monetization, delivery, or any flow that looks like order taking.

Sources:

- Ohio marketplace facilitator definition: <https://codes.ohio.gov/ohio-revised-code/section-5741.01>
- Ohio marketplace facilitator waiver section: <https://codes.ohio.gov/ohio-revised-code/section-5741.071>
- Ohio Department of Taxation sales/use tax: <https://tax.ohio.gov/business/sales-and-use-tax>
