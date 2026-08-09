-- 0035: scope claim status transitions to the correct party.
--
-- SECURITY FIX (found by live probe during RC hardening).
-- `claims_update_involved` used a single predicate for USING with no WITH CHECK,
-- so Postgres reused it as the check: any *claimer* could set their own claim to
-- 'approved'. Because handle_claim_status() is SECURITY DEFINER, that self-approval
-- was treated as a genuine approval and cascaded:
--   1. the listing flipped to 'claimed' (silently pulled from Browse),
--   2. every other neighbor's pending claim on that listing was auto-declined,
--   3. claim_messages_insert_party then opened a WRITABLE private channel to the
--      grower, letting a stranger message them without consent.
-- Verified live end-to-end before this migration, and re-verified blocked after.
--
-- This migration only ever REMOVES privilege — it grants nothing new.
--   owner   -> may approve / decline / complete / expire
--   claimer -> may cancel (and nothing else)

drop policy if exists claims_update_involved on public.claims;

create policy claims_update_owner on public.claims
  for update to authenticated
  using (
    auth.uid() = (select l.owner_id from public.listings l where l.id = claims.listing_id)
  )
  with check (
    auth.uid() = (select l.owner_id from public.listings l where l.id = claims.listing_id)
    and status = any (array['approved','declined','completed','expired']::claim_status[])
  );

create policy claims_update_claimer on public.claims
  for update to authenticated
  using (auth.uid() = claimer_id)
  with check (auth.uid() = claimer_id and status = 'cancelled'::claim_status);
