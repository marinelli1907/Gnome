-- Gnome Admin — identity, granular permissions, immutable audit (2026-08-10).
--
-- admin_users replaces the flat 0024 `admins` membership as the authority.
-- is_admin() now reads ACTIVE admin_users rows, so every existing admin-gated
-- policy/RPC inherits revocation for free (revoke → next backend call fails).
-- Roles are convenience presets; authorization is the granular permission set:
--    effective = preset(role) ∪ extra_permissions − denied_permissions
-- OWNER/SUPER_ADMIN carry the '*' wildcard. Owner-protected operations check
-- admin_is_owner(). No client writes anywhere in this file — memberships and
-- permissions change only through the audited RPCs (0075b) or service role.

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active','suspended','revoked')),
  role text not null default 'READ_ONLY' check (role in
    ('OWNER','SUPER_ADMIN','OPERATIONS_ADMIN','COMPLIANCE_ADMIN','INVENTORY_FULFILLMENT',
     'SUPPORT_MODERATOR','ACCOUNTING_FINANCE','MARKETING_GROWTH','READ_ONLY')),
  extra_permissions text[] not null default '{}',
  denied_permissions text[] not null default '{}',
  invited_name text,
  invited_email text,
  created_by uuid,
  created_at timestamptz not null default now(),
  suspended_at timestamptz,
  revoked_at timestamptz
);

alter table public.admin_users enable row level security;
drop policy if exists admin_users_select_self on public.admin_users;
create policy admin_users_select_self on public.admin_users
  for select using (user_id = auth.uid());
-- no insert/update/delete policies: RPC/service-role only
revoke insert, update, delete on public.admin_users from anon, authenticated;
grant select on public.admin_users to authenticated;

-- Seed: the existing owner membership carries over.
insert into public.admin_users (user_id, role, status, invited_name)
select user_id, 'OWNER', 'active', 'Daniel Marinelli' from public.admins
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Role presets → permissions. Data lives in code (one place), read via fn.
-- ---------------------------------------------------------------------------
create or replace function public.admin_role_permissions(p_role text)
returns text[]
language sql immutable
as $$
  select case p_role
    when 'OWNER'        then array['*']
    when 'SUPER_ADMIN'  then array['*']
    when 'OPERATIONS_ADMIN' then array[
      'users.view','markets.view','markets.edit','markets.pause','markets.restore','markets.feature',
      'listings.view','listings.moderate','listings.pause','listings.restore',
      'orders.view','orders.manage','orders.cancel','orders.complete',
      'pickups.view','pickups.manage','delivery.view','delivery.manage',
      'inventory.view','seed_drop.view','plots.view','support.view','taxonomy.view',
      'subscriptions.view','system.view','ai.view']
    when 'COMPLIANCE_ADMIN' then array[
      'users.view','markets.view','listings.view','listings.moderate','listings.pause','listings.restore',
      'compliance.view','compliance.view_documents','compliance.review','compliance.approve',
      'compliance.deny','compliance.revoke','compliance.rules_manage','taxonomy.view','system.view','ai.view']
    when 'INVENTORY_FULFILLMENT' then array[
      'inventory.view','inventory.adjust','inventory.receive','inventory.quarantine','inventory.reconcile',
      'seed_drop.view','seed_drop.generate','seed_drop.fulfill','seed_drop.ship','system.view']
    when 'SUPPORT_MODERATOR' then array[
      'users.view','markets.view','listings.view','listings.moderate',
      'support.view','support.respond','support.resolve','orders.view','system.view']
    when 'ACCOUNTING_FINANCE' then array[
      'finance.view_summary','finance.view_transactions','finance.export',
      'subscriptions.view','system.view']
    when 'MARKETING_GROWTH' then array[
      'marketing.view','marketing.draft','users.view','markets.view','listings.view','system.view']
    when 'READ_ONLY' then array[
      'users.view','markets.view','listings.view','orders.view','pickups.view','delivery.view',
      'compliance.view','inventory.view','seed_drop.view','plots.view','support.view',
      'taxonomy.view','subscriptions.view','finance.view_summary','system.view','ai.view']
    else array[]::text[]
  end;
$$;

-- ---------------------------------------------------------------------------
-- The two questions everything asks.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admin_users
                  where user_id = auth.uid() and status = 'active');
$$;

create or replace function public.admin_has_perm(p_perm text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admin_users a
     where a.user_id = auth.uid()
       and a.status = 'active'
       and (
         (('*' = any(public.admin_role_permissions(a.role)) or '*' = any(a.extra_permissions))
           and not (p_perm = any(a.denied_permissions)))
         or (p_perm = any(public.admin_role_permissions(a.role) || a.extra_permissions)
           and not (p_perm = any(a.denied_permissions)))
       )
  );
$$;

create or replace function public.admin_is_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admin_users
                  where user_id = auth.uid() and status = 'active'
                    and role in ('OWNER','SUPER_ADMIN'));
$$;

revoke execute on function public.admin_role_permissions(text) from public, anon;
grant execute on function public.admin_has_perm(text) to authenticated;
grant execute on function public.admin_is_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- Immutable admin audit log. Rows appear only through admin_audit() (called
-- inside audited definer RPCs) or the service role. No update/delete grants
-- exist for anyone below service role — including admins.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_type text not null default 'ADMIN' check (actor_type in ('OWNER','ADMIN','AI_AGENT','SYSTEM')),
  action text not null,
  resource_type text,
  resource_id text,
  old_state jsonb,
  new_state jsonb,
  reason text,
  approval_request_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_actor_idx on public.admin_audit_log (actor_id, created_at desc);
create index if not exists admin_audit_resource_idx on public.admin_audit_log (resource_type, resource_id);

alter table public.admin_audit_log enable row level security;
drop policy if exists admin_audit_read on public.admin_audit_log;
create policy admin_audit_read on public.admin_audit_log
  for select using (public.is_admin());
revoke insert, update, delete on public.admin_audit_log from anon, authenticated;
grant select on public.admin_audit_log to authenticated;

create or replace function public.admin_audit(
  p_action text, p_resource_type text, p_resource_id text,
  p_old jsonb default null, p_new jsonb default null,
  p_reason text default null, p_actor_type text default 'ADMIN',
  p_approval uuid default null
) returns void
language sql security definer set search_path = public
as $$
  insert into public.admin_audit_log
    (actor_id, actor_type, action, resource_type, resource_id, old_state, new_state, reason, approval_request_id)
  values (auth.uid(),
          case when public.admin_is_owner() and p_actor_type = 'ADMIN' then 'OWNER' else p_actor_type end,
          p_action, p_resource_type, p_resource_id, p_old, p_new, p_reason, p_approval);
$$;
revoke execute on function public.admin_audit(text,text,text,jsonb,jsonb,text,text,uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
