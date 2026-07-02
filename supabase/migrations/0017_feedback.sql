-- Gnome — In-app feedback (beta, spec §23). Run after 0016.
-- Write-only from the client, like reports (0013): users submit, nobody reads
-- feedback via the API — review happens server-side (SQL / dashboard).

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles (id) on delete set null,
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists feedback_created_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own" on public.feedback
  for insert with check (auth.uid() = user_id);
-- (no SELECT policy: feedback is reviewed server-side only)

notify pgrst, 'reload schema';
