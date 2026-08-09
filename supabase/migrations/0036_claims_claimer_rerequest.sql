-- 0036: let a declined neighbour ask again.
--
-- claims has UNIQUE (listing_id, claimer_id), so once a request is declined the
-- claimer can never INSERT another one — the retry died on a raw 23505 and the
-- UI showed a Postgres constraint string. 0035 had scoped the claimer to
-- 'cancelled' only, which closed the re-request path entirely.
--
-- Allowing the claimer to move their OWN claim back to 'pending' grants no
-- privilege they didn't already have via INSERT (a first request is always
-- theirs to make), and the listing owner still decides the outcome. The app
-- re-opens the existing row instead of inserting a duplicate.

drop policy if exists claims_update_claimer on public.claims;

create policy claims_update_claimer on public.claims
  for update to authenticated
  using (auth.uid() = claimer_id)
  with check (
    auth.uid() = claimer_id
    and status = any (array['cancelled','pending']::claim_status[])
  );
