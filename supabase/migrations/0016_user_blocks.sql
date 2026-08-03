-- Gnome — Block user (safety, spec §12). Run after 0015.
-- A block is one-directional in data (blocker → blocked) but enforcement is
-- mutual: neither side can open a claim or send a chat message to the other.
-- Feed hiding is client-side (the app filters out owners the viewer blocked);
-- the DB is the hard barrier for interactions.

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

-- Only the blocker sees / manages their own blocks. The blocked person never
-- learns they were blocked via the API.
drop policy if exists "user_blocks_select_own" on public.user_blocks;
create policy "user_blocks_select_own" on public.user_blocks
  for select using (auth.uid() = blocker_id);

drop policy if exists "user_blocks_insert_own" on public.user_blocks;
create policy "user_blocks_insert_own" on public.user_blocks
  for insert with check (auth.uid() = blocker_id);

drop policy if exists "user_blocks_delete_own" on public.user_blocks;
create policy "user_blocks_delete_own" on public.user_blocks
  for delete using (auth.uid() = blocker_id);

-- ---------------------------------------------------------------------------
-- Enforcement triggers. SECURITY DEFINER because the inserting user can't see
-- the other party's block rows through RLS (and must not be able to).
-- ---------------------------------------------------------------------------
create or replace function public.blocked_pair(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

-- CRITICAL: this is SECURITY DEFINER and reads user_blocks bypassing RLS. New
-- functions grant EXECUTE to PUBLIC by default, which PostgREST would expose as
-- POST /rpc/blocked_pair — letting anyone probe the whole block graph and defeat
-- the "nobody learns they were blocked" guarantee. Lock it to the definer only;
-- the two triggers below call it as the definer, so they're unaffected.
revoke execute on function public.blocked_pair(uuid, uuid) from public, anon, authenticated;

create or replace function public.check_claim_not_blocked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select l.owner_id into v_owner from public.listings l where l.id = new.listing_id;
  if v_owner is not null and public.blocked_pair(v_owner, new.claimer_id) then
    raise exception 'BLOCKED_USER';
  end if;
  return new;
end;
$$;

drop trigger if exists check_claim_not_blocked on public.claims;
create trigger check_claim_not_blocked
  before insert on public.claims
  for each row execute function public.check_claim_not_blocked();

create or replace function public.check_message_not_blocked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid;
  v_claimer uuid;
begin
  select l.owner_id, c.claimer_id into v_owner, v_claimer
    from public.claims c join public.listings l on l.id = c.listing_id
    where c.id = new.claim_id;
  if v_owner is not null and public.blocked_pair(v_owner, v_claimer) then
    raise exception 'BLOCKED_USER';
  end if;
  return new;
end;
$$;

drop trigger if exists check_message_not_blocked on public.claim_messages;
create trigger check_message_not_blocked
  before insert on public.claim_messages
  for each row execute function public.check_message_not_blocked();

notify pgrst, 'reload schema';
