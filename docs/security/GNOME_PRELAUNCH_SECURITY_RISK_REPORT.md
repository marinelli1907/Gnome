# Gnome Prelaunch Security Risk Report

Checked: 2026-08-24
Scan context: Codex Security standard scan started as `4ae54592-2b2d-4f25-b21a-e42a300b731f`. TAC access could not be verified because the Codex Security Access connector was not connected. This document records source-backed prelaunch risk review; it is not a penetration test.

## Security Verdict

**Launch posture: guarded beta only.** The architecture shows unusually good instincts for a prelaunch marketplace: RLS is used, exact location is intentionally hidden, credentials are private, and AI actions are server-mediated. The most serious launch risks are incomplete identity verification, policy acceptance/versioning gaps, compliance rule coverage, possible admin breadth, AI/provider privacy posture, and the need for runtime tests.

## Findings

| Severity | Finding | Evidence | Recommendation |
|---|---|---|---|
| Critical | Mandatory verified phone is not implemented | `user_private_contact.phone_e164` stores phone; `save_onboarding_contact` strips/validates digits but does not OTP-verify | Add phone verification table/status via trusted provider, rate limits, duplicate policy, secure change flow |
| Critical | Email verification is not proven as a gate | Release docs note production `mailer_autoconfirm: true` in prior audit; current code allows account use through auth session | Require verified email before account actions; verify Supabase dashboard redirect/confirm settings |
| High | Terms/Privacy/Rules affirmative acceptance not implemented as versioned account record | Terms/Privacy pages exist, but no cited `policy_acceptances` table found in inspected migrations | Add versioned acceptance table with timestamps and re-acceptance flow |
| High | Current Privacy Policy conflicts with owner identity decision | `web/app/privacy/page.tsx:43` says phone is optional and never required | Update only after owner approves implementation plan and counsel review |
| High | Compliance gate exists but rule data coverage remains incomplete | Rules/data-driven engine exists, but Ohio matrix still has many review-required categories | Fail closed for high-risk categories and audit `compliance_rules` before launch |
| High | AI free-tier privacy posture may conflict with user expectations | Privacy page discloses Gemini free service tier; report/source confirms free tier data-use posture differs from paid | Consider paid Gemini tier before public launch; keep PII redaction and no sensitive AI prompts |
| Medium | Legacy AI functions decode JWT payload claims directly | `ask-gnome`, `draft-listing`, and `garden-planner` parse `sub` from the bearer token instead of using `auth.getUser`; this is mitigated only if `verify_jwt` remains enabled | Replace manual JWT parsing with Supabase `auth.getUser` in every service-role function; verify deployed `verify_jwt` flags |
| Medium | Seller credential scope can change during stale admin review | Sellers may insert taxonomy scope while credential is `PENDING`; admin approval does not re-read/freeze the exact reviewed scope set | On approval, re-read scope transactionally, freeze approved scope snapshot, or restrict scope edits after submission |
| Medium | Admin app can perform powerful moderation/compliance actions | Admin code calls RPCs for listing status, compliance clearances, billing health | Review admin roles, RPC grants, audit logs, destructive operations before launch |
| Medium | Pickup privacy must be runtime-tested | 0093 revokes market exact fields; listing exact coords hidden by earlier migrations | Run buyer/seller/anon API probes for listings, markets, claims, pickup locations, delivery addresses |
| Medium | Payment handles are sensitive-ish personal data | Seller Venmo/Cash App/PayPal/Zelle handles may be visible as intended; no bank credentials should exist | Treat handles as seller-published contact/payment info; never store bank credentials |
| Medium | Storage upload hardening needs runtime proof | Compliance docs bucket is private; listing photos public; image helper strips metadata per Privacy | Verify file type/size limits, signed URL duration, EXIF stripping, malicious upload controls |
| Medium | Webhook race remains documented before live | `STRIPE_LIVE_ACTIVATION.md` lists in-flight replay race and alerting as pre-live items | Do not enable payments until resolved or explicitly accepted by owner/counsel |
| Low | Debug exception details are reflected to clients | `draft-listing` and `garden-planner` return `detail: String(e)`; some admin/billing functions return truncated exception text | Return stable public error codes; log details server-side only |
| Low | AI chat content has no explicit retention bound | `gnome-assistant` stores user/assistant messages; table cascades on account deletion but has no TTL | Define retention period and purge job for AI conversations |
| Low | AI usage counters survive account deletion | Prior privacy doc already notes daily counters are retained against old account id | Add FK cascade or deletion cleanup for AI counters |
| Low | Assistant sends county-level profile location to AI provider | `gnome-assistant` adds city/county/state context to model prompt | Coarsen to city/state or state only unless county materially improves answer |

## Positive Controls

- Private contact details separated from world-readable profiles and owner-only RLS.
- Compliance docs bucket is private and path-scoped to owner/admin.
- Credential approvals are scoped to taxonomy nodes.
- Publication gate is server-side trigger, not client-only UI.
- Market exact lat/lng/zip/contact/pickup fields removed from public grants.
- AI listing photo analysis validates JSON and matches taxonomy against server data.
- AI market actions require owner-scoped RPCs; renewal/bulk actions use pending confirmation.
- Stripe checkout derives identity/market/listing from JWT and server DB, not request body.
- Live payments are blocked by `billing_config.payments_live_enabled = false`.
- Pickup privacy and compliance-document storage had no source-backed finding in the read-only security sidecar: exact pickup address is gated to owner/confirmed buyer states, and compliance docs are private owner/admin storage.

## Required Security Tests Before Public Launch

1. Anonymous REST probes for public listings/markets/profiles: confirm no email, phone, exact lat/lng, pickup instructions.
2. Authenticated user A/B tests for listings, claims, messages, pickup data, seller credentials, AI chat messages.
3. Storage policy tests for `compliance-docs`, listing images, grow-log docs.
4. Admin RPC grant review: confirm only admin users can call admin functions.
5. Auth settings dashboard audit: email confirmation, redirect URLs, OTP rate limits, OAuth provider settings.
6. Phone verification abuse tests once implemented: rate limits, duplicate numbers, recycling/change flow.
7. AI prompt-injection tests: model must not claim legal authority, reveal other users, execute actions without confirmation, or bypass compliance.
8. Android physical push proof and notification privacy review.
9. Map regression if any map/provider/marker work changes.
10. Stripe webhook replay/race tests before live payments.

## Security Scan Coverage

Reviewed locally:

- `supabase/migrations/0042`, `0043`, `0044`, `0086`, `0093`, `0095`, `0104`, `0116`, `0124`, `0126`.
- `supabase/functions/ask-gnome`, `gnome-assistant`, `analyze-listing-photo`, `billing-checkout`, `stripe-webhook`.
- `web/app/terms`, `web/app/privacy`, admin compliance and taxonomy clients.
- Read-only sidecar reviewed legacy AI functions, credential approval/scope flow, delete-account retention, pickup privacy, compliance docs, payments, and admin client service-role exposure.

Not verified in this pass:

- Live Supabase dashboard settings.
- Production RLS with real user sessions.
- Runtime storage signed URLs.
- Mobile build/device behavior.
- Full formal pentest.
