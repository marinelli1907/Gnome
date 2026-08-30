-- Keep the buyer-facing Market Drops projection strictly read-only.
--
-- Supabase's hosted default privileges granted client roles every relation
-- privilege when this view was recreated. The view exposes the intended public
-- columns, but anon/authenticated must never be able to write through it.

begin;

do $$
begin
  if exists (
    select 1
    from public.billing_config
    where payments_live_enabled is true
  ) then
    raise exception 'market drops grant repair refuses to apply while payments_live_enabled=true';
  end if;
end $$;

revoke all on public.public_market_drops from public, anon, authenticated;
grant select on public.public_market_drops to anon, authenticated;

do $$
declare
  bad_grants text;
  actual_columns text;
begin
  select string_agg(grantee || ':' || privilege_type, ', ' order by grantee, privilege_type)
    into bad_grants
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name = 'public_market_drops'
     and (
       (grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT')
       or grantee = 'PUBLIC'
     );

  if bad_grants is not null then
    raise exception 'public_market_drops still has unsafe client grants: %', bad_grants;
  end if;

  if not has_table_privilege('anon', 'public.public_market_drops', 'SELECT')
     or not has_table_privilege('authenticated', 'public.public_market_drops', 'SELECT') then
    raise exception 'public_market_drops lost required client SELECT access';
  end if;

  select string_agg(column_name, ',' order by ordinal_position)
    into actual_columns
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'public_market_drops';

  if actual_columns is distinct from
     'id,market_id,title,description,starts_at,ends_at,timezone,phase,available_items' then
    raise exception 'public_market_drops public column allowlist changed: %', actual_columns;
  end if;

  if exists (
    select 1
    from public.billing_config
    where payments_live_enabled is true
  ) then
    raise exception 'market drops grant repair changed payments_live_enabled';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
