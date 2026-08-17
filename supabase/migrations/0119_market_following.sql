-- 0119: Market Following becomes a cross-platform buyer feature (CTO directive).
--
-- The follow relationship itself already exists (0005 market_follows, self-scoped
-- RLS: a user inserts/reads/deletes only their own rows) and this migration
-- deliberately does NOT touch it — no second follow system, no RLS widening.
--
-- What sellers get is exactly ONE new aggregate: their own follower COUNT.
-- market_follows RLS has no owner-read policy on purpose (a seller must never
-- enumerate who follows them), so the count has to come from a definer function
-- pinned to auth.uid(). No parameters — a caller cannot ask about any market
-- but their own, and nothing but an integer ever leaves the function.

create or replace function public.my_market_follower_count()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int
    from public.market_follows f
    join public.markets m on m.id = f.market_id
   where m.owner_id = auth.uid();
$$;

revoke execute on function public.my_market_follower_count() from public, anon;
grant execute on function public.my_market_follower_count() to authenticated;

-- Self-check: the function must exist, be SECURITY DEFINER, and take no
-- arguments (a parameterized version would be an enumeration surface).
do $$
declare
  ok boolean;
begin
  select p.prosecdef and p.pronargs = 0 into ok
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_market_follower_count';
  if not coalesce(ok, false) then
    raise exception '0119 self-check: my_market_follower_count is missing, not definer, or parameterized';
  end if;
end $$;

notify pgrst, 'reload schema';
