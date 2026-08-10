-- 0045: 'paused' listing status (compliance pause — distinct from removed/expired
-- so nothing is deleted and reactivation is a pure status flip).
-- Applied to production 2026-08-10 as 'listing_status_paused'.
-- A new enum label cannot be used inside the transaction that adds it, which is
-- why this is its own migration.
alter type public.listing_status add value if not exists 'paused';
