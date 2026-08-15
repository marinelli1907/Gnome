-- 0094 was written against a test fixture that invented its own admin vocabulary.
-- Production disagrees on both axes, and the check constraints caught it:
--
--   status  production allows active / suspended / revoked. There is no
--           'invited', so a pending invitation could not be stored at all.
--   role    production uses SUPER_ADMIN, OPERATIONS_ADMIN, COMPLIANCE_ADMIN,
--           INVENTORY_FULFILLMENT, SUPPORT_MODERATOR, ACCOUNTING_FINANCE,
--           MARKETING_GROWTH, READ_ONLY. 0094 invented ADMIN / SUPPORT /
--           COMPLIANCE / FINANCE.
--
-- Production's vocabulary wins. It is the one the console, the permission
-- catalogue and the existing owner records already speak. Adding 'invited' to
-- status is the only schema change; the rest is teaching 0094's functions the
-- right words.

alter table public.admin_users drop constraint if exists admin_users_status_check;
alter table public.admin_users add constraint admin_users_status_check
  check (status in ('active','suspended','revoked','invited'));

-- Roles are validated in one place now, so the next role added to the table
-- constraint does not have to be remembered in two functions as well.
create or replace function public.admin_role_is_valid(p_role text)
returns boolean language sql immutable set search_path = public as $$
  select p_role in ('OWNER','SUPER_ADMIN','OPERATIONS_ADMIN','COMPLIANCE_ADMIN',
                    'INVENTORY_FULFILLMENT','SUPPORT_MODERATOR','ACCOUNTING_FINANCE',
                    'MARKETING_GROWTH','READ_ONLY');
$$;

create or replace function public.admin_invite_teammate(
  p_email text, p_name text default null, p_role text default 'SUPPORT_MODERATOR'
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
  if not public.admin_role_is_valid(p_role) then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;
  if p_role = 'OWNER' and not public.admin_is_owner() then
    raise exception 'ONLY_OWNER_CAN_INVITE_OWNER' using errcode = 'P0001';
  end if;
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

create or replace function public.admin_set_teammate_role(
  p_admin uuid, p_role text, p_reason text default null
) returns public.admin_users
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_row public.admin_users;
begin
  if not public.admin_can_manage_team() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if not public.admin_role_is_valid(p_role) then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;
  if p_role = 'OWNER' and not public.admin_is_owner() then
    raise exception 'ONLY_OWNER_CAN_PROMOTE_OWNER' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.admin_users t where t.id = p_admin;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
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

notify pgrst, 'reload schema';
