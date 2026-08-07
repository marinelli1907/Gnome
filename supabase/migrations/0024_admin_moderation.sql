-- Gnome — minimal admin/moderation layer. Run after 0023.
--
-- Design: authorization lives in the DATABASE (an admins table + RLS
-- policies), not in the web UI. The /admin page is just a window; every
-- power it exposes is enforced by a policy that checks is_admin(), so a
-- non-admin calling the API directly gets nothing. Admin membership can
-- only be changed via service role / SQL — there is deliberately no
-- client-side path to grant admin.
--
-- Reversible: drop the policies/table/columns listed at the bottom.

-- ---------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

drop policy if exists admins_select_self on public.admins;
create policy admins_select_self on public.admins
  for select using (auth.uid() = user_id);
-- No insert/update/delete policies on purpose: SQL/service-role only.

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

insert into public.admins (user_id)
values ('3e64f6d5-9c3e-436a-b48d-be96edfba39a')  -- Daniel (site owner)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Suspension: a suspended profile cannot create listings or claims.
-- Enforced by recreating the INSERT policies — unbypassable via direct API.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists suspended boolean not null default false;

drop policy if exists listings_insert_owner on public.listings;
create policy listings_insert_owner on public.listings
  for insert with check (
    auth.uid() = owner_id
    and not coalesce((select suspended from public.profiles where id = auth.uid()), false)
  );

drop policy if exists claims_insert_claimer on public.claims;
create policy claims_insert_claimer on public.claims
  for insert with check (
    auth.uid() = claimer_id
    and auth.uid() <> (select owner_id from public.listings l where l.id = listing_id)
    and not coalesce((select suspended from public.profiles where id = auth.uid()), false)
  );

-- ---------------------------------------------------------------------------
-- Reports become reviewable
-- ---------------------------------------------------------------------------
alter table public.reports
  add column if not exists status text not null default 'open'
    check (status in ('open','reviewed','actioned','dismissed')),
  add column if not exists admin_notes text,
  add column if not exists resolved_by uuid references public.profiles (id),
  add column if not exists resolved_at timestamptz;

drop policy if exists reports_admin_select on public.reports;
create policy reports_admin_select on public.reports
  for select using (public.is_admin());
drop policy if exists reports_admin_update on public.reports;
create policy reports_admin_update on public.reports
  for update using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Admin powers: read any listing (incl. removed), moderate listings/markets/
-- profiles, read claims when reviewing claim reports.
-- ---------------------------------------------------------------------------
drop policy if exists listings_admin_select on public.listings;
create policy listings_admin_select on public.listings
  for select using (public.is_admin());
drop policy if exists listings_admin_update on public.listings;
create policy listings_admin_update on public.listings
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists markets_admin_update on public.markets;
create policy markets_admin_update on public.markets
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists claims_admin_select on public.claims;
create policy claims_admin_select on public.claims
  for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Audit log — every sensitive admin action gets a row (the web UI writes it,
-- and only admins can; sensitive truth still lives in the moderated tables).
-- ---------------------------------------------------------------------------
create table if not exists public.admin_actions (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references public.profiles (id),
  action      text not null,
  target_type text not null,
  target_id   uuid,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists admin_actions_created_idx on public.admin_actions (created_at desc);
alter table public.admin_actions enable row level security;

drop policy if exists admin_actions_admin_select on public.admin_actions;
create policy admin_actions_admin_select on public.admin_actions
  for select using (public.is_admin());
drop policy if exists admin_actions_admin_insert on public.admin_actions;
create policy admin_actions_admin_insert on public.admin_actions
  for insert with check (public.is_admin() and admin_id = auth.uid());

-- Rollback sketch: drop policies *_admin_*; drop table admin_actions; drop
-- reports moderation columns; restore 0001/0007-era insert policies; drop
-- profiles.suspended; drop function is_admin(); drop table admins.
