-- admin_audit_log.actor_type is constrained to OWNER / ADMIN / AI_AGENT / SYSTEM.
-- 0094 and 0095 both pass the string 'admin' in lower case, so every audited
-- admin action raised a check-constraint violation instead of writing its record.
--
-- That is worse than it sounds for 0095, which is already live: the audit call is
-- the LAST statement in admin_resolve_screening, admin_grant_compliance_clearance
-- and friends. The moderation decision is written first, so an admin approving a
-- held listing would have seen the whole call blow up AFTER the row changed, and
-- the transaction would roll the decision back. Moderation simply would not work.
-- The earlier production suite missed it because it only tested that a NON-admin
-- is refused, which never reaches the audit line.
--
-- Eleven functions across two migrations pass the bad value. Rather than reissue
-- all eleven, fix the contract where it is interpreted: actor_type is
-- case-insensitive on the way in, canonical upper case on the way out. Callers
-- that already pass 'ADMIN' are unaffected, and the owner promotion below keeps
-- working exactly as before.

create or replace function public.admin_audit(
  p_action text, p_resource_type text, p_resource_id text,
  p_old jsonb default null, p_new jsonb default null, p_reason text default null,
  p_actor_type text default 'ADMIN', p_approval uuid default null
) returns void
language sql security definer set search_path to 'public' as $$
  insert into public.admin_audit_log
    (actor_id, actor_type, action, resource_type, resource_id,
     old_state, new_state, reason, approval_request_id)
  values (auth.uid(),
          case when public.admin_is_owner()
                and upper(coalesce(p_actor_type,'ADMIN')) = 'ADMIN'
               then 'OWNER'
               else upper(coalesce(p_actor_type,'ADMIN')) end,
          p_action, p_resource_type, p_resource_id, p_old, p_new, p_reason, p_approval);
$$;

notify pgrst, 'reload schema';
