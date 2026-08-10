-- 0037: fix the markets UPDATE policy correlation typo.
--
-- The member branch of markets_update_owner_or_member compared
-- `mm.market_id = mm.id` (a self-comparison that is essentially never true),
-- so the intended owner-OR-member edit rule silently degraded to owner-only.
-- This was latent (unexploitable) but wrong; correct the correlation to the
-- market row being updated. market_members INSERT is owner-controlled, so a
-- membership still requires the owner's consent — this grants no new access,
-- it only restores the intended behaviour. Verified live: an unrelated user
-- editing someone else's market gets 0 rows; the owner can still edit.
drop policy if exists markets_update_owner_or_member on public.markets;

create policy markets_update_owner_or_member on public.markets
  for update to authenticated
  using (
    auth.uid() = owner_id
    or exists (
      select 1 from public.market_members mm
      where mm.market_id = markets.id and mm.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = owner_id
    or exists (
      select 1 from public.market_members mm
      where mm.market_id = markets.id and mm.user_id = auth.uid()
    )
  );
