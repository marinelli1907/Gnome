# Gnome Launch Risk Register

Checked: 2026-08-24

## Top 25 Risks

| # | Severity | Risk | Likelihood | Impact | Mitigation | Owner | Blocker |
|---:|---|---|---|---|---|---|---|
| 1 | Critical | Verified phone not implemented | High | High | Add OTP verification/rate limits/gating | Daniel/Eng | Yes |
| 2 | Critical | Email verification not enforced/proven | Medium | High | Dashboard audit and gated flow | Daniel/Eng | Yes |
| 3 | Critical | Terms/Privacy/Rules acceptance not versioned | High | High | Add policy acceptance table/UI | Eng/Attorney | Yes |
| 4 | Critical | Ohio regulated categories not fully validated | High | High | Restricted beta category list | Daniel/Reg expert | Yes |
| 5 | Critical | Insurance absent/inadequate | Medium | High | Broker review before launch | Daniel | Yes |
| 6 | High | Android push not physically proven | High | Medium | Device test from final build | Daniel/Eng | Yes for Play |
| 7 | High | Map credential/signing failure whites out app | Medium | High | Internal-test map regression | Eng | Yes for Play |
| 8 | High | Gemini data-safety/privacy posture unresolved | Medium | High | Owner decision: paid tier or disclosure | Daniel | Yes |
| 9 | High | Empty marketplace / low inventory density | High | High | Recruit anchor sellers first | Daniel | Yes for public |
| 10 | High | Coop gains seller mindshare first | High | Medium | Local seller concierge strategy | Daniel | No |
| 11 | High | Marketplace facilitator tax exposure misunderstood | Medium | High | CPA/attorney review | CPA/Attorney | Yes before payments |
| 12 | High | Off-platform payment fraud harms trust | Medium | Medium | Rules, reporting, safety copy | Ops | No |
| 13 | High | Product injury/allergen claim names Gnome | Medium | High | Insurance, disclaimers, category gates | Attorney/Broker | Yes |
| 14 | High | Credential review creates false assurance | Medium | High | Careful wording and audit notes | Attorney/Ops | Yes |
| 15 | High | Admin action breadth causes accidental damage | Medium | High | Role/RPC audit, dual confirms | Eng | No |
| 16 | Medium | Legacy AI functions trust decoded JWT payload claims if deployment JWT verification drifts | Medium | High | Use `auth.getUser` everywhere; verify `verify_jwt` flags | Eng | No |
| 17 | Medium | Credential scope stale-review race | Medium | High | Freeze/re-read approved scope transactionally | Eng/Ops | No |
| 18 | Medium | AI hallucinated legal/food-safety advice | Medium | Medium | Prompt constraints, disclaimers, monitoring | Eng/Ops | No |
| 19 | Medium | Phone marketing consent mishandled | Medium | High | Separate optional consent | Attorney/Eng | Yes if marketing |
| 20 | Medium | App-store IAP/payment policy rejection | Medium | Medium | Keep Android digital purchases gated; iOS risk disclosure | Eng | Yes for stores |
| 21 | Medium | Seller private phone/address leaks | Low/Med | High | RLS tests, privacy probes | Eng | Yes |
| 22 | Medium | Storage file abuse/malware | Medium | Medium | File type/size checks, signed URLs | Eng | No |
| 23 | Medium | Raw milk/meat/dairy listing slips through | Medium | High | Fail closed high-risk categories | Ops/Eng | Yes |
| 24 | Medium | Local health district differs by county | Medium | Medium | County review for launch pockets | Reg expert | No |
| 25 | Medium | Support/moderation overload | Medium | Medium | Invite beta, simple SLA | Daniel | No |

## Top 10 Launch Blockers

1. Verified phone implementation and gating.
2. Email verification proof/gating.
3. Versioned Terms/Privacy/Marketplace Rules acceptance.
4. Ohio restricted-category launch list approved.
5. Attorney review of Terms/Privacy/Rules/seller risk language.
6. Insurance broker quote and binding decision.
7. Android physical push proof.
8. Google Play internal-test map regression after signing.
9. Gemini data-safety decision.
10. Real seller inventory in launch pocket.
