# Gnome Prelaunch Security Report

Checked: 2026-08-24
Scope: Repo-level prelaunch security review of auth, RLS, pickup privacy, credentials, AI, payments, admin, logs, and launch gates.
Status: Static/source-backed review. No production probing, destructive testing, or secret inspection.

## Executive Security Verdict

**Launch with conditions.** No critical or high findings were validated in the reviewed surfaces, but two medium findings should be fixed before a public launch or explicitly accepted by Daniel with compensating controls.

Prior Codex Security scan:

- Scan ID: `4ae54592-2b2d-4f25-b21a-e42a300b731f`
- Result: 2 medium findings.
- Report: `/private/var/folders/cj/y8spm4l15svf7dvhp_ccxjcw0000gn/T/codex-security-scans-tcMguw/Gnome/21a734aa14f65feed4e848311f74926eaa45e276_20260824T192527Z_xmqiewi9/report.md`
- Warning: worktree changed while scan ran because diligence docs were being added; scan was anchored to the original snapshot and reviewed cited files.

## Critical Findings

None validated in reviewed surfaces.

## High Findings

None validated in reviewed surfaces.

## Medium Findings

| Finding | Evidence | Impact | Required fix |
|---|---|---|---|
| Legacy AI functions trust decoded JWT payload claims before service-role reads | `supabase/functions/ask-gnome/index.ts:26`, `draft-listing/index.ts:26`, `garden-planner/index.ts:20` | If deployed JWT verification drifts, forged `sub` could read another user's context or consume quota | Replace local JWT decode with `auth.getUser(token)`, verify deployed `verify_jwt`, retire unused legacy endpoints |
| Credential approval can race against mutable taxonomy scope | `supabase/migrations/0042_compliance_core.sql:117`, `web/app/admin/ComplianceClient.tsx:100`, `supabase/migrations/0046_compliance_ui_support.sql:383` | Seller could alter pending scope after reviewer loads approval screen | Make scope immutable at review, or approve against a transactional re-read/hash/snapshot |

## Other Launch Security Gaps

| Area | Status | Launch implication |
|---|---|---|
| Verified email | Exists through Supabase auth, but launch gating/dashboard posture still needs proof | P0 |
| Verified phone | Phone stored and format-validated, not OTP-verified | P0 |
| Terms/Privacy/Rules acceptance | Policy pages exist; versioned acceptance table/gate not found in audited source | P0 |
| AI retention | AI chat rows exist without a documented TTL | P1 |
| Account deletion | Deletes many private artifacts; AI counters may survive account deletion | P1 |
| Debug error details | Some Edge Functions reflect truncated exception details | P1 |
| Admin MFA | Recommended but not proven/enforced in source | P0/P1 depending launch access |
| Storage uploads | Compliance docs private; listing images public; file/MIME/EXIF posture needs final test | P1 |

## Positive Controls

- Private contact details are separated from public profile data.
- Public market/listing views use approximate location boundaries.
- Compliance documents use private storage.
- Seller credentials require admin approval; sellers cannot self-approve.
- Stripe live payments remain gated and must stay disabled.
- Import/photo/listing AI outputs are schema-validated and taxonomy is server-resolved.
- Market import treats source material as untrusted data, not instructions.
- Account deletion purges credential document folders.

## Required P0 Security Tests

1. Direct API attempts to publish regulated categories without credentials.
2. Direct API attempts to publish after Terms/phone/email gates are introduced.
3. Direct API attempts to call Zordy beyond plan quota.
4. Direct API attempts to read exact pickup fields before approved reservation/order.
5. Credential-scope race regression test.
6. Forged JWT tests against every deployed AI Edge Function.
7. Android final build map/push regression on real hardware.
8. Admin least-privilege and MFA checklist.

## Security Recommendation

Do not public-launch until verified email, verified phone, versioned policy acceptance, the two medium findings, and server-side compliance bypass tests are complete. These are ordinary launch hardening items, not reasons to abandon the product.
