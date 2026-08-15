-- 0094 — two things the admin console could not do: manage its own team, and
-- express who reports to whom in AI HQ.
--
-- NOT APPLIED. Declared in migrations/UNAPPLIED.txt.
--
-- Part 1 needs no new tables: admin_users already carries status, role,
-- invited_name, invited_email, created_by and revoked_at (0075). Only the RPCs
-- were missing, so the only way to add an admin was direct database access.
--
-- Part 2 adds the org chart. Nothing about it grants an agent new power on its
-- own — authority_level ships at RECOMMEND for every agent, which is exactly
-- what they can do today.

-- ===========================================================================
-- 1. Team management
-- ===========================================================================
-- An invite is a row with an email and no user_id yet. It becomes a real
-- membership when that person signs in and claims it, which is what keeps an
-- invite from being a back door: the claimer must control the mailbox AND
-- authenticate. An email is never trusted from the client at claim time — it
-- comes from auth.users for the caller's own id.

create index if not exists admin_users_invited_email_idx
  on public.admin_users (lower(invited_email)) where user_id is null;

-- Only an owner may change the shape of the team. `admin.manage` exists so a
-- non-owner can be delegated it later without handing over everything.
create or replace function public.admin_can_manage_team() returns boolean
language sql stable security definer set search_path = public as $$
  select public.admin_is_owner() or public.admin_has_perm('admin.manage');
$$;

-- How many owners are left if this row stopped counting. Used to refuse the
-- change that locks everyone out — the failure mode you cannot undo from the UI.
create or replace function public.admin_owner_count(p_excluding uuid default null)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.admin_users
   where role = 'OWNER' and status = 'active'
     and (p_excluding is null or id <> p_excluding);
$$;

create or replace function public.admin_invite_teammate(
  p_email text, p_name text default null, p_role text default 'SUPPORT'
) returns public.admin_users
language plpgsql security definer set search_path = public as $$
declare v_email text; v_row public.admin_users;
begin
  if not public.admin_can_manage_team() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;
  if p_role not in ('OWNER','ADMIN','SUPPORT','COMPLIANCE','FINANCE','READ_ONLY') then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;
  -- Only an owner may mint another owner. Otherwise `admin.manage` would be a
  -- one-step path to full control.
  if p_role = 'OWNER' and not public.admin_is_owner() then
    raise exception 'ONLY_OWNER_CAN_INVITE_OWNER' using errcode = 'P0001';
  end if;

  -- Re-inviting someone who is already on the team is a no-op, not a duplicate.
  select * into v_row from public.admin_users
   where lower(coalesce(invited_email,'')) = v_email and status <> 'revoked' limit 1;
  if v_row.id is not null then return v_row; end if;

  insert into public.admin_users (status, role, invited_name, invited_email, created_by)
  values ('invited', p_role, nullif(btrim(coalesce(p_name,'')),''), v_email, auth.uid())
  returning * into v_row;

  perform public.admin_audit('admin.team.invite', 'admin_users', v_row.id::text,
                             null, to_jsonb(v_row), 'invited '||v_email, 'admin', null);
  return v_row;
end $$;
revoke all on function public.admin_invite_teammate(text,text,text) from public, anon;
grant execute on function public.admin_invite_teammate(text,text,text) to authenticated;

-- Claimed by the invited person themselves. Deliberately NOT gated on being an
-- admin already — that is the whole point — so the email match is the gate.
create or replace function public.admin_accept_invite()
returns public.admin_users
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_email text; v_row public.admin_users;
begin
  if uid is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select lower(email) into v_email from auth.users where id = uid;
  if v_email is null then raise exception 'NO_EMAIL_ON_ACCOUNT' using errcode = 'P0001'; end if;

  update public.admin_users
     set user_id = uid, status = 'active'
   where lower(coalesce(invited_email,'')) = v_email
     and user_id is null and status = 'invited'
  returning * into v_row;

  if v_row.id is null then raise exception 'NO_PENDING_INVITE' using errcode = 'P0001'; end if;
  perform public.admin_audit('admin.team.accept', 'admin_users', v_row.id::text,
                             null, to_jsonb(v_row), 'invite accepted', 'admin', null);
  return v_row;
end $$;
revoke all on function public.admin_accept_invite() from public, anon;
grant execute on function public.admin_accept_invite() to authenticated;

create or replace function public.admin_remove_teammate(p_admin uuid, p_reason text default null)
returns public.admin_users
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_row public.admin_users;
begin
  if not public.admin_can_manage_team() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.admin_users t where t.id = p_admin;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  -- Removing the last owner would leave a console nobody can administer.
  if (v_old->>'role') = 'OWNER' and (v_old->>'status') = 'active'
     and public.admin_owner_count(p_admin) = 0 then
    raise exception 'LAST_OWNER' using errcode = 'P0001';
  end if;

  update public.admin_users
     set status = 'revoked', revoked_at = now()
   where id = p_admin returning * into v_row;

  perform public.admin_audit('admin.team.remove', 'admin_users', p_admin::text,
                             v_old, to_jsonb(v_row), p_reason, 'admin', null);
  return v_row;
end $$;
revoke all on function public.admin_remove_teammate(uuid,text) from public, anon;
grant execute on function public.admin_remove_teammate(uuid,text) to authenticated;

create or replace function public.admin_set_teammate_role(
  p_admin uuid, p_role text, p_reason text default null
) returns public.admin_users
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_row public.admin_users;
begin
  if not public.admin_can_manage_team() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_role not in ('OWNER','ADMIN','SUPPORT','COMPLIANCE','FINANCE','READ_ONLY') then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;
  if p_role = 'OWNER' and not public.admin_is_owner() then
    raise exception 'ONLY_OWNER_CAN_PROMOTE_OWNER' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.admin_users t where t.id = p_admin;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  -- Demoting the last owner is the same lockout as removing them.
  if (v_old->>'role') = 'OWNER' and p_role <> 'OWNER'
     and public.admin_owner_count(p_admin) = 0 then
    raise exception 'LAST_OWNER' using errcode = 'P0001';
  end if;

  update public.admin_users set role = p_role where id = p_admin returning * into v_row;
  perform public.admin_audit('admin.team.role', 'admin_users', p_admin::text,
                             v_old, to_jsonb(v_row), p_reason, 'admin', null);
  return v_row;
end $$;
revoke all on function public.admin_set_teammate_role(uuid,text,text) from public, anon;
grant execute on function public.admin_set_teammate_role(uuid,text,text) to authenticated;

-- ===========================================================================
-- 2. AI org chart
-- ===========================================================================
alter table public.ai_agents
  add column if not exists title            text,
  add column if not exists department       text not null default 'GENERAL',
  add column if not exists reports_to       uuid references public.ai_agents(id) on delete set null,
  add column if not exists authority_level  text not null default 'RECOMMEND',
  add column if not exists charter          text;

do $$ begin
  alter table public.ai_agents add constraint ai_agents_department_chk
    check (department in ('EXEC','FINANCE','OPERATIONS','MARKETING','TECHNOLOGY','GENERAL'));
exception when duplicate_object then null; end $$;
do $$ begin
  -- RECOMMEND  — reads numbers, writes reviews. What every agent can do today.
  -- PROPOSE    — may file an action request; a human still approves it.
  -- DELEGATED  — may execute a narrow allowlist under a cap, without a human.
  alter table public.ai_agents add constraint ai_agents_authority_chk
    check (authority_level in ('RECOMMEND','PROPOSE','DELEGATED'));
exception when duplicate_object then null; end $$;

-- An officer cannot report to itself, and the chart must stay a tree.
create or replace function public.ai_agents_no_cycle() returns trigger
language plpgsql as $$
declare hop uuid; depth int := 0;
begin
  if new.reports_to is null then return new; end if;
  if new.reports_to = new.id then raise exception 'AGENT_REPORTS_TO_SELF'; end if;
  hop := new.reports_to;
  while hop is not null and depth < 10 loop
    if hop = new.id then raise exception 'AGENT_REPORTING_CYCLE'; end if;
    select reports_to into hop from public.ai_agents where id = hop;
    depth := depth + 1;
  end loop;
  return new;
end $$;
drop trigger if exists ai_agents_no_cycle_trg on public.ai_agents;
create trigger ai_agents_no_cycle_trg before insert or update of reports_to
  on public.ai_agents for each row execute function public.ai_agents_no_cycle();

-- Promote five existing agents into officers rather than inventing new ones:
-- the boardroom presets reference these names, and a duplicate "CFO" alongside
-- "Finance Agent" would be two things claiming the same job.
update public.ai_agents set title = 'CEO', department = 'EXEC',
  charter = 'Reads the whole business and gives Daniel one clear read: what is working, what is not, and the single next move.'
  where name = 'Gnome HQ';
update public.ai_agents set title = 'CFO', department = 'FINANCE',
  charter = 'Revenue, subscriptions, comp grants, promotion spend and unit economics. Says plainly when a number is zero and why.'
  where name = 'Finance Agent';
update public.ai_agents set title = 'COO', department = 'OPERATIONS',
  charter = 'Fulfillment, inventory, support load and anything that has to physically happen on time.'
  where name = 'Operations Agent';
update public.ai_agents set title = 'CMO', department = 'MARKETING',
  charter = 'Signups, activation, which towns are alive, and where the next neighbor comes from.'
  where name = 'Marketing Agent';
update public.ai_agents set title = 'CTO', department = 'TECHNOLOGY',
  charter = 'Reliability, security posture, permission errors and compliance gates.'
  where name = 'Security Agent';

-- Wire the rest under the right officer.
update public.ai_agents a set reports_to = o.id, department = o.department
  from public.ai_agents o
 where o.title = 'CFO' and a.name in ('Marketplace Agent');
update public.ai_agents a set reports_to = o.id, department = o.department
  from public.ai_agents o
 where o.title = 'COO' and a.name in ('Inventory Agent','Seed Agent','Support Agent','Plot Agent');
update public.ai_agents a set reports_to = o.id, department = o.department
  from public.ai_agents o
 where o.title = 'CMO' and a.name in ('Growth Agent');
update public.ai_agents a set reports_to = o.id, department = o.department
  from public.ai_agents o
 where o.title = 'CTO' and a.name in ('Compliance Agent');
-- The four officers report to the CEO.
update public.ai_agents a set reports_to = o.id
  from public.ai_agents o
 where o.title = 'CEO' and a.title in ('CFO','COO','CMO','CTO');

-- Read-only org chart for the console.
create or replace function public.admin_ai_org()
returns table(
  id uuid, name text, title text, department text, status text,
  authority_level text, model text, charter text,
  reports_to uuid, reports_to_name text, direct_reports int
)
language sql stable security definer set search_path = public as $$
  select a.id, a.name, a.title, a.department, a.status, a.authority_level,
         a.model, a.charter, a.reports_to, m.name,
         (select count(*)::int from public.ai_agents c where c.reports_to = a.id)
    from public.ai_agents a
    left join public.ai_agents m on m.id = a.reports_to
   where public.admin_has_perm('ai.view') or public.admin_is_owner()
   order by case a.department when 'EXEC' then 0 when 'FINANCE' then 1
                              when 'OPERATIONS' then 2 when 'MARKETING' then 3
                              when 'TECHNOLOGY' then 4 else 5 end,
            (a.title is null), a.name;
$$;
revoke all on function public.admin_ai_org() from public, anon;
grant execute on function public.admin_ai_org() to authenticated;

-- Authority is owner-only and audited. Raising an agent above RECOMMEND is the
-- decision that lets software act without Daniel, so it is deliberately not
-- delegable through admin.manage.
create or replace function public.admin_set_agent_authority(
  p_agent uuid, p_level text, p_reason text default null
) returns public.ai_agents
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_row public.ai_agents;
begin
  if not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  if p_level not in ('RECOMMEND','PROPOSE','DELEGATED') then
    raise exception 'INVALID_AUTHORITY' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.ai_agents t where t.id = p_agent;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  update public.ai_agents set authority_level = p_level, updated_at = now()
   where id = p_agent returning * into v_row;
  perform public.admin_audit('ai.agent.authority', 'ai_agents', p_agent::text,
                             v_old, to_jsonb(v_row), p_reason, 'admin', null);
  return v_row;
end $$;
revoke all on function public.admin_set_agent_authority(uuid,text,text) from public, anon;
grant execute on function public.admin_set_agent_authority(uuid,text,text) to authenticated;

do $$
declare bad text;
begin
  select string_agg(distinct table_name||':'||grantee||':'||privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('admin_users','ai_agents')
     and grantee in ('anon','authenticated') and privilege_type <> 'SELECT';
  if bad is not null then
    raise exception 'admin tables must not be client-writable: %', bad;
  end if;
end $$;

notify pgrst, 'reload schema';
