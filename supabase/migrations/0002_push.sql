-- Gnome — push notification device tokens (P1).
-- Run after 0001_init.sql.

create table if not exists public.device_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  platform    text,
  created_at  timestamptz not null default now()
);

create index if not exists device_tokens_user_idx on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

-- A user manages only their own device tokens. The `notify` Edge Function reads
-- tokens with the service role, which bypasses RLS, so recipients' tokens are
-- never exposed to other clients.
drop policy if exists "device_tokens_select_self" on public.device_tokens;
create policy "device_tokens_select_self" on public.device_tokens
  for select using (auth.uid() = user_id);

drop policy if exists "device_tokens_upsert_self" on public.device_tokens;
create policy "device_tokens_upsert_self" on public.device_tokens
  for insert with check (auth.uid() = user_id);

drop policy if exists "device_tokens_update_self" on public.device_tokens;
create policy "device_tokens_update_self" on public.device_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "device_tokens_delete_self" on public.device_tokens;
create policy "device_tokens_delete_self" on public.device_tokens
  for delete using (auth.uid() = user_id);
