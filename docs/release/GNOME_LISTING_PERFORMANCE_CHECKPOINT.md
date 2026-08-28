# GNOME LISTING PERFORMANCE CHECKPOINT

Date: August 24, 2026
Scope: Customer Expo app and proposed Supabase migration only
Store submission: Not performed

## EXPIRED LISTINGS

- View Stats: Implemented. Owner listing taps and the explicit action open the owner-only Listing Performance screen.
- Repost: Preserved. The existing post-form duplication behavior remains available.
- Delete: Implemented as `archive_listing`; no seller-facing hard delete remains.
- confirmation: Implemented. Active listings explain immediate buyer removal; all confirmations explain that connected sales and accounting records remain.
- soft delete: Implemented with `listings.archived_at` plus `status = 'removed'`. Archived rows leave the normal Market Listings query and are not public.

## PERFORMANCE

- views: Signed-in, non-owner listing-detail opens; deduplicated per viewer/listing for 30 minutes.
- unique viewers: Distinct signed-in viewers only. Anonymous visitors are not fingerprinted and are omitted.
- requests: Count of claims/requests created from the listing.
- reservations: Approved or completed claims tied to the listing.
- completed sales: Completed `seller_transactions` tied to the listing.
- quantity sold: Sum of completed seller-ledger quantities.
- revenue: Sum of completed ledger gross less recorded discounts. Reserved/requested value is excluded.
- promotion spend: Seller-paid `listing_promotions.price_cents` only when every paid promotion has an attributable amount. Included credits count separately as $0 seller cash spend. Unattributed historical paid credits show Not available.
- net after promotion: Recorded revenue less known seller-paid Gnome promotion spend. The UI explicitly says this is not business profit.
- conversion: Completed requests divided by unique signed-in viewers. Hidden until at least five unique viewers.
- days active: The current architecture has no complete pause/resume timeline. The screen therefore reports the honest `Days listed` interval instead of fabricating active time.
- repost history: Existing Repost creates an unlinked new listing, so historical repost count is shown as Not available. Same-record renewals are counted from `listing_publish_events`.

## DATA QUALITY

- historical tracking: Finished listings that predate trustworthy view tracking retain `analytics_started_at = null`.
- unknown vs zero: Historical untracked views and unique viewers return null and render as Not available. Tracked listings with no events render 0.
- owner view filtering: Enforced in both the Expo client and the database trigger. Admin and service/internal view events are also discarded.

## LEDGER

- reconciliation: Listing revenue is aggregated directly from completed `seller_transactions`; void rows are excluded.
- manual sales: Reported separately from request-linked sales and included once in total recorded revenue.
- off-platform payments: Payment-method totals are shown as seller-recorded off-platform payments. The screen does not imply Gnome processed them.

## PRIVACY

- buyer identities: Never returned. The owner RPC returns aggregate counts and payment categories only.
- RLS: `my_listing_performance` verifies `auth.uid()` is the listing owner. Anonymous execution is revoked. A non-owner test receives `NOT_YOUR_LISTING`.
- deleted record retention: Claims, ledger rows, promotions, moderation/compliance relationships, and events remain attached after archive.

## ACTIVE LISTINGS

- live stats: Implemented on the same owner-only screen.
- actions: View details, edit, promote when eligible, share, mark sold out/complete, and delete/archive. Existing compliance-paused behavior is unchanged.

## ZORDY READY DATA

- analytics availability: The owner RPC provides a stable aggregate record for future Zordy tools. No new AI tools or claims were added in this pass.

## TESTS

- Expo: `npm --prefix expo run typecheck` passed. `npm --prefix expo run lint` passed with 0 errors and 15 pre-existing warnings after the touched-file duplicate import was removed.
- SQL: Dedicated Homebrew PostgreSQL 17.11 migration contract test passed.
- RLS: Owner-only aggregate, non-owner denial, archived-row public hiding, and hard-delete revocation passed.
- lifecycle: Archive changes the listing to removed/archived and preserves claim and seller-ledger rows.
- analytics: 16/16 focused checks passed, including dedupe, owner exclusion, historical nulls, revenue, promotion spend, conversion, and identity non-disclosure.

## ISSUES

1. Full clean-room migration replay is blocked before this feature by `0076_complimentary_grants.sql`, which contains only a summary while `0078_security_hardening.sql` references the objects it should create. The feature migration itself was executed and tested against a focused PG17 contract fixture.
2. Docker Desktop is not installed, so `supabase db reset --local --no-seed` could not be run.
3. No physical-device or emulator UI regression was run. Expo compile/lint verification is not a substitute for device proof.
4. Historical purchased promotion credits do not always carry a provable per-listing cash allocation. Those rows intentionally render spend and net as Not available.
5. Anonymous unique viewers are intentionally omitted; Gnome does not create a fingerprinting identifier for this feature.

## FINAL VERDICT

**FIX FIRST**

The focused listing-performance implementation and PG17 behavioral suite pass. Launch approval remains blocked until the repository migration-history gap is repaired, a full Supabase PG17 reset succeeds, and the owner/public flows receive device QA. No production migration was applied, payments remain disabled, Maps was untouched, and neither store was submitted.
