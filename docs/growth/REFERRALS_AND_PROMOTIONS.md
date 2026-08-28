# Gnome referrals, rewards, and promo truth

Status: production growth schema and SELECT-only view-grant repair applied on
2026-08-25. Approved Edge Functions and web build are deployed. The Gnome iOS
production build and Gnome Admin internal archive completed; Android EAS did
not queue because the account's monthly Android build allowance was exhausted.

## Launch qualification

A referred account becomes a qualified seller only when all of these are true:

- referral attribution was captured before qualification;
- the referred account is account-ready with verified email, 18+ confirmation, and current policy acceptance;
- the account and Market are active and not suspended;
- the seller publishes a non-QA, non-demo, public active `sale` listing that passed screening.

Qualification is performed by a database trigger. Clients cannot mark a referral qualified or write reward ledgers.

## Launch rewards

| Milestone | Referrer | Referred seller |
|---|---|---|
| Each qualified seller | 1 Featured Listing credit | 1 Featured Listing credit |
| 3 qualified sellers | 3 additional Featured Listing credits | - |
| 5 qualified sellers | 30 days complimentary Pro and 5 Featured Listing credits | - |
| 10 qualified sellers | 90 days complimentary Pro, 10 Featured Listing credits, and 1 Featured Market Boost | - |
| 25 / 50 | tracked for analytics and owner review only | - |

Every reward has a unique idempotency key. Replayed qualification, concurrent trigger execution, and repeated delivery cannot duplicate a reward. Pro rewards queue from the end of an existing referral grant so the 30-day and 90-day benefits are not lost to overlap. They create no Stripe customer, subscription, invoice, or payment method.

A Featured Market Boost is one explicit seven-day activation. It is not silently activated. While active it appears in the public boost projection, sorts ahead in featured-Market discovery, and is labeled on app and web Market profiles.

## Buyer reward decision

Launch decision: do not issue a seller-only credit to a buyer with no legitimate Sell listing. Gnome records the earned reward as deferred. If that buyer later becomes a seller, all earned seller rewards activate exactly once.

This is the smallest useful launch behavior using existing Gnome capabilities. Gnome does not currently have a buyer wallet or non-payment buyer perk that is valuable, fraud-resistant, and independent of live billing. A future buyer reward should be approved separately rather than inventing a fake or unusable benefit now.

## Attribution and fraud controls

- One immutable referral attribution per referred user.
- Self-referral is rejected by user ID and normalized email.
- Matching normalized Auth phone numbers are rejected when both accounts have one; phone is never required or exposed.
- Referral codes are opaque random identifiers and contain no PII.
- Market QR resolves only for an active, non-suspended public Market and stores pending attribution locally until authentication.
- Seller Concierge stores only acquisition source and referral code, then issues the seller's own referral identity after secure claim.
- QA Concierge cases are marked on attribution and excluded from rewards and growth reporting.
- Private identities, attributions, and reward ledgers have no client table grants. Clients use scoped RPCs.
- Qualification and reward issuance are transactional and server-only.

Device/IP fingerprinting is deliberately not a launch dependency. It would add privacy scope and false-positive risk. Gemma reports suspicious duplicates from the durable server controls above; any additional fingerprinting needs a separate privacy review.

## FOUNDING3 audit

Read-only production audit on 2026-08-25 found:

- Benefit: 100% off Pro (`grower`).
- Duration: repeating for 3 months.
- Eligibility: Pro only; not restricted to new customers.
- Redemption cap: no campaign-wide cap; one redemption per user.
- Card requirement: yes.
- Conversion: automatic monthly Pro billing after the promotional period unless canceled.
- Renewal price: authoritative product price, currently $9.99/month.
- Stripe configuration: TEST mode is the only launch mode; production `payments_live_enabled` is false. The campaign currently has a legacy promotion-code reference and no separately confirmed test/live promotion IDs.

App and web now use the same private `billing-checkout` preview and display before activation:

> $0 today. Pro free for 3 months. Then $9.99/month unless canceled. A payment method is required.

The price comes from the selected billing product, not hard-coded promo copy. Campaigns marked `NO_AUTO_CONVERSION` are forbidden from requiring a payment method and are refused by subscription checkout, so a free offer cannot silently become paid. A dedicated no-renewal activation path must exist before such a campaign can be enabled.

## Complimentary access boundary

Admin and Seller Concierge complimentary Pro/Farm remains a separate entitlement source:

- no Stripe subscription;
- no card;
- no auto-conversion;
- expiry returns the Market to the strongest legitimate underlying entitlement.

Referral Pro rewards use the same non-Stripe entitlement resolver with `grant_source=REFERRAL` and their own immutable reward link. Promo redemptions remain in the promotion campaign/redemption subsystem.

## Operations agents

- Gemma: aggregate referral and promotion operations, qualification, reward issuance, deferrals, and control health.
- Marty: effectiveness analysis and conversion rates; distinguishes zero, unknown, and not deployed.
- Zordy: executive synthesis using the business brief plus the same aggregate growth pack.

The Boardroom receives aggregate counts only. QA is excluded. No emails, phone numbers, invite tokens, addresses, credentials, or payment records enter agent prompts. Gemini paid fallback remains disabled by Boardroom policy.

## Production deployment boundary

Exact migration:

1. `20260825160000_growth_referrals.sql` (applied; production ledger version
   `20260825162947`, migration name preserved)

Required forward repair discovered by the post-apply production grant audit:

1. `20260825163500_growth_public_view_grants.sql` (applied; production ledger
   version `20260825163855`, migration name preserved)

The repair revokes Supabase-hosted default non-SELECT view privileges from
`anon` and `authenticated`, then restores only the intended `SELECT`. It does
not change rows, RLS, Auth, Stripe, payments, or agent settings.

Deployed Edge Functions:

1. `billing-checkout` version 13, JWT verification enabled, SHA-256
   `e0df0fd0432af872cbec9f009fdf3508de275bb077ed6e8607262615278817f9`
2. `boardroom` version 12, JWT verification enabled, SHA-256
   `078458366f98709f85dc03c82b7d891f309a28e9b90c65650424c0c250c8b754`

Release surfaces:

- current web build deployed to `gnomefarmersmarket.com`;
- Gnome iOS production build `1.1.0` (`16`) completed in EAS, not submitted;
- Gnome Admin `1.1.0` (`1`) internal iOS archive completed, not submitted;
- Android production build was not created because EAS rejected the queue request
  at the monthly free-plan limit; the remote version code advanced from 12 to 13.

Do not deploy any other migration or function. Do not change Auth, phone, Stripe mode, `payments_live_enabled`, or store submission state.

Impact: additive private tables, additive promo metadata, additive Seller Concierge acquisition fields, two listing/claim hooks, private aggregate RPCs, two read-only AI agents, and a public active-Market-boost projection. Existing users, Markets, listings, subscriptions, promo redemptions, complimentary grants, and inventory are not rewritten.

Rollback: redeploy the prior `billing-checkout`, `boardroom`, web, app, and Admin builds; apply an owner-reviewed forward rollback migration that disables the two referral triggers and revokes referral RPC execution. Preserve referral and reward ledgers for audit. Do not delete issued reward/grant history or reverse credits automatically; any compensating entries require owner review.
