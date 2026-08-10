-- 0038: owner-only full-profile reader.
--
-- Runs as SECURITY DEFINER so the caller can read their OWN private columns
-- (zip_code) even after those are revoked from anon/authenticated. One user can
-- never read another's row: the WHERE is pinned to auth.uid().
create or replace function public.my_profile()
returns setof public.profiles
language sql security definer set search_path = public stable as $$
  select * from public.profiles where id = auth.uid();
$$;

revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;
