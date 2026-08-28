-- Forward repair for the growth-system public projection.
--
-- Hosted default privileges can grant new public views more than SELECT even
-- when the view is not writable. Keep this projection deliberately read-only.

revoke all on public.public_active_market_boosts from public, anon, authenticated;
grant select on public.public_active_market_boosts to anon, authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.public_active_market_boosts', 'insert')
     or has_table_privilege('anon', 'public.public_active_market_boosts', 'update')
     or has_table_privilege('anon', 'public.public_active_market_boosts', 'delete')
     or has_table_privilege('authenticated', 'public.public_active_market_boosts', 'insert')
     or has_table_privilege('authenticated', 'public.public_active_market_boosts', 'update')
     or has_table_privilege('authenticated', 'public.public_active_market_boosts', 'delete') then
    raise exception 'GROWTH_PUBLIC_VIEW_GRANTS_TOO_BROAD';
  end if;
end $$;

notify pgrst, 'reload schema';
