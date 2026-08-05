-- Gnome — per-user daily caps for the AI features (cost control).
--
-- The draft-listing and garden-planner edge functions call
-- ai_usage_increment() with the service role before every model call; a user
-- over the day's cap gets a friendly 429 instead of burning Anthropic tokens.
-- Service-role only: RLS is enabled with no policies, and EXECUTE is revoked
-- from client roles (PostgREST would otherwise expose the function as an RPC).

create table if not exists public.ai_usage (
  user_id  uuid not null,
  day      date not null default (now() at time zone 'utc')::date,
  feature  text not null,
  count    integer not null default 0,
  primary key (user_id, day, feature)
);

alter table public.ai_usage enable row level security;
-- No policies on purpose — clients can never read or write usage rows.

create or replace function public.ai_usage_increment(
  p_user uuid, p_feature text, p_cap int
) returns boolean
language plpgsql
security definer set search_path = public
as $$
declare new_count int;
begin
  insert into public.ai_usage (user_id, day, feature, count)
  values (p_user, (now() at time zone 'utc')::date, p_feature, 1)
  on conflict (user_id, day, feature)
  do update set count = ai_usage.count + 1
  returning count into new_count;
  return new_count <= p_cap;
end;
$$;

revoke execute on function public.ai_usage_increment(uuid, text, int)
  from public, anon, authenticated;
