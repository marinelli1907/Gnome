# Seller Concierge operations

This runbook covers seller preparation, invitation, claim, private review, and
disposable QA retention. It does not authorize production database writes.

## Production claim contract

The authoritative state is `seller_concierge_cases`, not the invitation token
or browser history.

1. An operator prepares private Concierge drafts.
2. An invitation is sent to the approved mailbox.
3. Server-issued mailbox proof and account readiness are required to claim.
4. A successful claim consumes the invitation once, links the seller and
   Market, and creates private `listing_drafts`.
5. The seller reviews, edits, publishes, or discards each draft. Nothing is
   public merely because the claim succeeded.

After claim, `/claim-market` loads the seller-owned claimed case under RLS.
Successful claim URLs use `?claimed=<case-id>` and never retain the invitation
token. Refresh, reopen, and browser-back flows therefore recover from persisted
state. The review action opens `/my/import?case=<case-id>`, which reads only the
authenticated seller's drafts under existing RLS.

A consumed invitation remains single-use. The proposed closeout migration makes
an old consumed link return the non-actionable `CLAIMED` state instead of an
invalid-invitation error; it cannot claim again or create duplicate drafts.

## Disposable QA policy

Disposable Seller Concierge records must be marked `is_qa` before account
deletion. QA cases are excluded from seller-funnel, business, growth, marketing,
conversion, and launch-readiness totals. They remain visible to authorized
operations users with a clear `QA` label.

Cleanup preserves the minimum immutable evidence needed to explain what was
tested:

- case UUID and immutable admin audit event;
- historical QA user UUID and Market UUID;
- historical Market name and tombstone timestamp;
- non-PII reason identifying the controlled QA closeout.

Cleanup removes or severs live product state:

- private `listing_drafts` linked to the exact QA case are deleted;
- pending prepared entitlements are cancelled and identifying email is scrubbed;
- the invitation is revoked, its token hash is rotated, and email is scrubbed;
- the Market is paused and the profile is suspended before account deletion;
- live claimed-user and claimed-Market foreign keys are cleared only after their
  UUIDs have been copied into historical fields.

The tombstone routine refuses cleanup if it finds public listings, claims,
reservations, messages, ledger/payment activity, subscriptions, grants,
redemptions, credentials, assistance actions, or an activated prepared
entitlement. That refusal is a safety control, not an override request.

## Production closeout

Migration
`20260825151517_seller_concierge_qa_tombstone_and_claim_state.sql` was applied
on 2026-08-25 as production ledger version `20260825154606`. The reviewed file
checksum is SHA-256
`f0fd9273600a3fca1b383305ebab9b98f20e94c87456ce81b867d62e848c92d3`.
`boardroom` version 11 was deployed with JWT verification enabled and bundle
hash `bc5a857203ac73e1709457974fa498988f3e96499161c879bb41d7321f1fe538`.

The approved closeout tombstoned cases
`3195e6ac-e614-4717-86d2-475d52f743fb` and
`6a24d16f-af9f-42a0-9a54-0e8d769cf5e3`, then deleted only these disposable
records:

- user `4d8c4333-c318-4615-942d-8c6808083152`, Market
  `6fc2b1a0-eb3b-48b6-bbb8-7fc9b67e2675`;
- user `8c563b61-0ba9-485a-a199-7b186d06e7ce`, Market
  `37a7c092-c72d-485b-a6bd-8657e2860f17`.

Post-cleanup production contains 13 profiles, 13 Markets, and 41 listings with
the unchanged status distribution: 17 active, 2 claimed, 20 expired, and 2
removed. The two QA tombstones and two immutable audit events remain; invitation
PII is scrubbed; three private listing drafts were deleted; no QA account,
Market, public listing, grant, subscription, redemption, or GMV row remains.
`payments_live_enabled` remains `false`.

Do not delete or modify another account or Market. Do not change Auth, phone
authentication, Stripe mode, payment activation, or store submission state as
part of this procedure.

## Verified evidence

On 2026-08-25 the controlled production claim proved PREPARED -> INVITED ->
EMAIL/MAGIC-LINK VERIFIED -> CLAIMED -> ACCOUNT READY -> PRIVATE REVIEW. The
claimed Market remained paused, all three products remained private drafts, and
no public listing or paid subscription was created.

The deployed web closeout was then verified with the claimed QA seller session:

- token-free refresh/reopen rendered `Market claimed` from persisted state;
- the review action opened all three private drafts;
- Edit, Publish, and Discard controls rendered for each draft;
- browser back plus reload restored the authoritative claimed state;
- no draft was published or discarded during closeout verification.

After cleanup, a transaction-scoped production regression exercised PREPARED ->
INVITED -> VERIFIED -> ACCOUNT READY -> CLAIMED -> MARKET REVIEW -> PRIVATE
DRAFTS -> REFRESH -> OLD INVITE and rolled back completely. The old consumed
link returned `CLAIMED`, a second claim returned `INVALID_OR_EXPIRED_INVITE`,
the wrong account returned `INVITE_EMAIL_MISMATCH`, and auto-confirm without a
server mailbox proof remained not ready.
