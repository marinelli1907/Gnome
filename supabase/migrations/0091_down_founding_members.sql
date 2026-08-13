-- Rollback for 0091_founding_members.sql.
--
-- 0091 is purely additive, so this reversal is clean — but it DESTROYS the
-- roster, and a founding number is a promise that was displayed on somebody's
-- profile. So this script refuses to run while any founder exists unless the
-- operator says so out loud:
--
--   set gnome.founding_force_rollback = 'true';
--   \i supabase/migrations/0091_down_founding_members.sql
--
-- Before forcing it, export the roster — the awards are also in
-- admin_audit_log (action FOUNDING_MEMBER_AWARDED), which this script does not
-- touch, so the numbers can be reconstructed.

do $$
declare n int;
begin
  if to_regclass('public.founding_members') is null then
    return;
  end if;
  execute 'select count(*) from public.founding_members' into n;
  if n > 0 and coalesce(current_setting('gnome.founding_force_rollback', true), '') <> 'true' then
    raise exception
      'FOUNDING_ROLLBACK_REFUSED: % founding member row(s) exist. Set gnome.founding_force_rollback to ''true'' to proceed.', n
      using errcode = 'P0001';
  end if;
end $$;

drop view if exists public.founding_badges;

drop trigger if exists founding_members_guard_trg on public.founding_members;

drop function if exists public.admin_founding_renumber(uuid,int,text,text);
drop function if exists public.admin_founding_revoke(uuid,text);
drop function if exists public.admin_founding_set_program(jsonb);
drop function if exists public.founding_market_boost_active(uuid);
drop function if exists public.founding_activate_my_market(uuid);
drop function if exists public.founding_market_eligible(uuid,uuid);
drop function if exists public.founding_relink_subscription(text,text,text);
drop function if exists public.founding_revoke_for_refund(text,text);
drop function if exists public.founding_sweep_lapses();
drop function if exists public.founding_lapse_member(text,text);
drop function if exists public.founding_mark_payment_recovered(text);
drop function if exists public.founding_mark_payment_failed(text);
drop function if exists public.founding_award_member(uuid,text,text,text,text,boolean,int,text,uuid);
drop function if exists public.my_founding_membership();
drop function if exists public.founding_program_status();
drop function if exists public.founding_capacity_remaining();
drop function if exists public.founding_members_guard();

drop table if exists public.founding_members;
drop table if exists public.founding_program_config;

-- Dropped last: the display helper and the result builder are referenced by
-- everything above.
drop function if exists public.founding_result(boolean,text,int,text);
drop function if exists public.founding_number_display(int);

notify pgrst, 'reload schema';
