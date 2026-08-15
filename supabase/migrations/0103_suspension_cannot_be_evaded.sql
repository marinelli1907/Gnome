-- Suspension stopped new listings and stopped new claims. It did not stop a
-- suspended seller from publishing. Two holes, found by testing the evasion
-- paths rather than reading the policy:
--
--   1. listings_update_owner's WITH CHECK is only `auth.uid() = owner_id`. A
--      suspended seller could take any old paused or expired listing and flip
--      status back to 'active'. Suspension blocked the front door and left the
--      back one open.
--
--   2. publish_listing_draft is SECURITY DEFINER, so it runs as the table owner
--      and ROW LEVEL SECURITY DOES NOT APPLY TO IT AT ALL. The suspension check
--      lives in an RLS WITH CHECK, so the AI-draft path never consulted it. A
--      suspended seller could publish through the AI tab all day.
--
-- This is why the fix is a TRIGGER and not another policy. RLS cannot defend a
-- SECURITY DEFINER function, and there will be more such functions. A BEFORE
-- trigger runs for every writer on every path — RLS or not, definer or not,
-- PostgREST or SQL — so there is one place to state the rule and one place to
-- check it.

create or replace function public.listings_block_suspended() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_susp boolean;
begin
  -- Only publication matters. A suspended seller may still pause, complete or
  -- remove their own listings; trapping them with rows they cannot take down
  -- would be its own bug.
  if new.status is distinct from 'active'::public.listing_status then
    return new;
  end if;

  -- An admin approving a held listing, or restoring one deliberately, is an act
  -- of moderation and must not be caught by the seller's own suspension.
  if public.is_admin() then
    return new;
  end if;

  select coalesce(suspended, false) into v_susp
    from public.profiles where id = new.owner_id;

  if v_susp then
    raise exception
      'ACCOUNT_SUSPENDED: Your account is under review, so listings can''t go live right now. Existing listings stay put and you can still take them down. Contact support if you think this is a mistake.'
      using errcode = 'P0001';
  end if;

  return new;
end $$;

-- Fires before the screening trigger (alphabetical order at the same timing),
-- which is the right way round: there is no point screening a listing that is
-- not allowed to publish in the first place.
drop trigger if exists listings_block_suspended_trg on public.listings;
create trigger listings_block_suspended_trg
  before insert or update on public.listings
  for each row execute function public.listings_block_suspended();

notify pgrst, 'reload schema';
