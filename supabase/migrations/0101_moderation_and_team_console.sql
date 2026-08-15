-- Server support for the moderation and team consoles.
--
-- Everything the console needs comes from here, so no authorization decision has
-- to be re-made in client code. The rule throughout: a caller without the
-- permission gets NOTHING back - no rows, or a null jsonb - never an error that
-- would confirm a resource exists.
--
-- Two things this deliberately does NOT return:
--   * seller_credentials.credential_number and .document_path. A moderator needs
--     to know a credential is APPROVED, for which state, and when it expires.
--     The licence number itself is a private identifier and adds nothing to the
--     decision, so it never leaves the database.
--   * listings.screening_term. That is the internal keyword that matched. The
--     class label is what a human should reason about; the keyword is an
--     implementation detail and leaking it teaches people how to word around it.

-- ---------------------------------------------------------------------------
-- Invitation expiry. 0094 had none: an invitation emailed to the wrong address,
-- or to someone who left before accepting, stayed claimable forever.
-- ---------------------------------------------------------------------------

alter table public.admin_users
  add column if not exists invite_expires_at timestamptz;

update public.admin_users
   set invite_expires_at = coalesce(invite_expires_at, created_at + interval '7 days')
 where status = 'invited' and user_id is null and invite_expires_at is null;

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

  -- An unexpired invitation or an active member: re-inviting is a no-op so a
  -- double tap cannot mint a second row. An EXPIRED invitation is different -
  -- re-inviting should genuinely refresh it, which is the natural way to resend.
  select * into v_row from public.admin_users
   where lower(coalesce(invited_email,'')) = v_email
     and status <> 'revoked'
     and (status <> 'invited' or coalesce(invite_expires_at, 'infinity') > now())
   limit 1;
  if v_row.id is not null then return v_row; end if;

  update public.admin_users
     set role = p_role,
         invited_name = coalesce(nullif(btrim(coalesce(p_name,'')),''), invited_name),
         invite_expires_at = now() + interval '7 days',
         created_by = auth.uid(), created_at = now()
   where lower(coalesce(invited_email,'')) = v_email
     and status = 'invited' and user_id is null
  returning * into v_row;
  if v_row.id is not null then
    perform public.admin_audit('admin.team.invite', 'admin_users', v_row.id::text,
                               null, to_jsonb(v_row), 'reissued '||v_email, 'ADMIN', null);
    return v_row;
  end if;

  insert into public.admin_users (status, role, invited_name, invited_email,
                                  created_by, invite_expires_at)
  values ('invited', p_role, nullif(btrim(coalesce(p_name,'')),''), v_email,
          auth.uid(), now() + interval '7 days')
  returning * into v_row;
  perform public.admin_audit('admin.team.invite', 'admin_users', v_row.id::text,
                             null, to_jsonb(v_row), 'invited '||v_email, 'ADMIN', null);
  return v_row;
end $$;
revoke all on function public.admin_invite_teammate(text,text,text) from public, anon;
grant execute on function public.admin_invite_teammate(text,text,text) to authenticated;

create or replace function public.admin_accept_invite()
returns public.admin_users
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_email text; v_row public.admin_users; v_exp timestamptz;
begin
  if uid is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select lower(email) into v_email from auth.users where id = uid;
  if v_email is null then raise exception 'NO_EMAIL_ON_ACCOUNT' using errcode = 'P0001'; end if;

  -- Look before updating so an expired invitation gets its own error instead of
  -- the generic "no invitation", which would send someone hunting for a typo in
  -- an email address that was in fact correct.
  select invite_expires_at into v_exp from public.admin_users
   where lower(coalesce(invited_email,'')) = v_email
     and user_id is null and status = 'invited'
   limit 1;
  if v_exp is not null and v_exp <= now() then
    raise exception 'INVITE_EXPIRED: That invitation has expired. Ask an owner to send a new one.'
      using errcode = 'P0001';
  end if;

  update public.admin_users
     set user_id = uid, status = 'active'
   where lower(coalesce(invited_email,'')) = v_email
     and user_id is null and status = 'invited'
     and coalesce(invite_expires_at, 'infinity') > now()
  returning * into v_row;
  if v_row.id is null then raise exception 'NO_PENDING_INVITE' using errcode = 'P0001'; end if;

  perform public.admin_audit('admin.team.accept', 'admin_users', v_row.id::text,
                             null, to_jsonb(v_row), 'invite accepted', 'ADMIN', null);
  return v_row;
end $$;
revoke all on function public.admin_accept_invite() from public, anon;
grant execute on function public.admin_accept_invite() to authenticated;

-- ---------------------------------------------------------------------------
-- Team console reads
-- ---------------------------------------------------------------------------

create or replace function public.admin_team_roles()
returns table(role text, label text)
language sql stable security definer set search_path = public as $$
  select r.role, r.label
    from (values
      ('OWNER','Owner — full control, including billing and AI authority'),
      ('SUPER_ADMIN','Super admin — everything except owner-only controls'),
      ('OPERATIONS_ADMIN','Operations — fulfillment, inventory, logistics'),
      ('COMPLIANCE_ADMIN','Compliance — credentials, clearances, screening rules'),
      ('INVENTORY_FULFILLMENT','Inventory & fulfillment'),
      ('SUPPORT_MODERATOR','Support & moderation — listing review, user reports'),
      ('ACCOUNTING_FINANCE','Accounting & finance'),
      ('MARKETING_GROWTH','Marketing & growth'),
      ('READ_ONLY','Read only')
    ) as r(role, label)
   where public.admin_can_manage_team() or public.admin_is_owner();
$$;
revoke all on function public.admin_team_roles() from public, anon;
grant execute on function public.admin_team_roles() to authenticated;

create or replace function public.admin_team_roster()
returns table(
  id uuid, user_id uuid, display_name text, email text, role text, status text,
  invite_state text, created_at timestamptz, invite_expires_at timestamptz,
  revoked_at timestamptz, is_last_owner boolean
)
language sql stable security definer set search_path = public as $$
  select a.id, a.user_id,
         coalesce(p.name, a.invited_name, split_part(coalesce(a.invited_email,''),'@',1)),
         coalesce(u.email, a.invited_email),
         a.role, a.status,
         case
           when a.status = 'revoked' then 'revoked'
           when a.status = 'invited' and coalesce(a.invite_expires_at,'infinity') <= now() then 'expired'
           when a.status = 'invited' then 'pending'
           else 'active'
         end,
         a.created_at, a.invite_expires_at, a.revoked_at,
         (a.role = 'OWNER' and a.status = 'active' and public.admin_owner_count(a.id) = 0)
    from public.admin_users a
    left join public.profiles p on p.id = a.user_id
    left join auth.users   u on u.id = a.user_id
   where public.admin_can_manage_team() or public.admin_is_owner()
   order by (a.status = 'active') desc, a.role = 'OWNER' desc, a.created_at;
$$;
revoke all on function public.admin_team_roster() from public, anon;
grant execute on function public.admin_team_roster() to authenticated;

create or replace function public.admin_team_audit(p_limit int default 50)
returns table(action text, reason text, actor_type text, at timestamptz, target text)
language sql stable security definer set search_path = public as $$
  select l.action, l.reason, l.actor_type, l.created_at,
         coalesce(t.invited_name, t.invited_email, l.resource_id)
    from public.admin_audit_log l
    left join public.admin_users t
           on l.resource_type = 'admin_users' and t.id::text = l.resource_id
   where l.action like 'admin.team.%'
     and (public.admin_can_manage_team() or public.admin_is_owner())
   order by l.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;
revoke all on function public.admin_team_audit(int) from public, anon;
grant execute on function public.admin_team_audit(int) to authenticated;

-- ---------------------------------------------------------------------------
-- Moderation console reads
-- ---------------------------------------------------------------------------

-- The resolved_today subquery has to sit behind the same gate as the counts it
-- accompanies, otherwise a caller with no moderation permission still learns how
-- much moderating happened today. Gate once, at the top, and return zeros.
create or replace function public.admin_screening_counts()
returns table(pending int, held_today int, resolved_today int)
language sql stable security definer set search_path = public as $$
  select
    case when ok then (select count(*)::int from public.listings
                        where screening_status = 'REVIEW') else 0 end,
    case when ok then (select count(*)::int from public.listings
                        where screening_status = 'REVIEW'
                          and screened_at >= date_trunc('day', now())) else 0 end,
    case when ok then (select count(*)::int from public.admin_audit_log
                        where action in ('listing.screening.approve','listing.screening.reject')
                          and created_at >= date_trunc('day', now())) else 0 end
    from (select (public.admin_has_perm('listings.moderate')
                  or public.admin_is_owner()) as ok) g;
$$;
revoke all on function public.admin_screening_counts() from public, anon;
grant execute on function public.admin_screening_counts() to authenticated;

-- Replace the parameterless 0095 version outright. Leaving both would make an
-- unqualified admin_screening_queue() call ambiguous, since every parameter here
-- has a default.
drop function if exists public.admin_screening_queue();

create or replace function public.admin_screening_queue(
  p_class text default null, p_state text default null,
  p_seller uuid default null, p_since timestamptz default null
) returns table(
  listing_id uuid, title text, description text, listing_status text,
  seller_id uuid, seller_name text, seller_suspended boolean,
  matched_term text, matched_category text, reason text,
  city text, state text, created_at timestamptz, screened_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select l.id, l.title, l.description, l.status::text,
         l.owner_id, p.name, p.suspended,
         null::text,                      -- matched keyword stays server-side
         l.screening_category, l.screening_reason,
         l.city, l.state, l.created_at, l.screened_at
    from public.listings l
    left join public.profiles p on p.id = l.owner_id
   where l.screening_status = 'REVIEW'
     and (public.admin_has_perm('listings.moderate') or public.admin_is_owner())
     and (p_class  is null or l.screening_category = p_class)
     and (p_state  is null or public.normalize_state(l.state) = public.normalize_state(p_state))
     and (p_seller is null or l.owner_id = p_seller)
     and (p_since  is null or l.created_at >= p_since)
   order by l.created_at;
$$;
revoke all on function public.admin_screening_queue(text,text,uuid,timestamptz) from public, anon;
grant execute on function public.admin_screening_queue(text,text,uuid,timestamptz) to authenticated;

create or replace function public.admin_moderation_detail(p_listing uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not (public.admin_has_perm('listings.moderate') or public.admin_is_owner())
              then null
              else jsonb_build_object(
    'listing', (select jsonb_build_object(
                  'id', l.id, 'title', l.title, 'description', l.description,
                  'status', l.status::text, 'state', l.state, 'city', l.city,
                  'photos', coalesce(to_jsonb(l.photos), '[]'::jsonb),
                  'created_at', l.created_at, 'screening_status', l.screening_status,
                  'screening_category', l.screening_category,
                  'screening_reason', l.screening_reason)
                  from public.listings l where l.id = p_listing),
    'seller',  (select jsonb_build_object(
                  'id', p.id, 'name', p.name, 'suspended', p.suspended, 'state', p.state)
                  from public.listings l join public.profiles p on p.id = l.owner_id
                 where l.id = p_listing),
    -- Credential NUMBER and document path are deliberately absent.
    'credentials', (select coalesce(jsonb_agg(jsonb_build_object(
                      'credential_type', c.credential_type, 'status', c.status::text,
                      'state', c.state, 'expiration_date', c.expiration_date)
                      order by c.expiration_date desc nulls last), '[]'::jsonb)
                      from public.seller_credentials c
                      join public.listings l on l.owner_id = c.seller_id
                     where l.id = p_listing),
    'clearances', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', k.id, 'compliance_class', k.compliance_class, 'state', k.state,
                      'rule_version', k.rule_version, 'status', k.status,
                      'granted_at', k.granted_at,
                      'credential_expiration', sc.expiration_date)
                      order by k.granted_at desc), '[]'::jsonb)
                      from public.seller_compliance_clearances k
                      join public.listings l on l.owner_id = k.seller_id
                      left join public.seller_credentials sc on sc.id = k.credential_id
                     where l.id = p_listing),
    'class',   (select jsonb_build_object(
                  'compliance_class', cc.compliance_class, 'label', cc.label,
                  'rule_version', cc.rule_version, 'requires_clearance', cc.requires_clearance,
                  'customer_message', cc.customer_message)
                  from public.listings l
                  join public.compliance_classes cc on cc.compliance_class = l.screening_category
                 where l.id = p_listing),
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
                  'action', a.action, 'reason', a.reason,
                  'actor_type', a.actor_type, 'at', a.created_at)
                  order by a.created_at desc), '[]'::jsonb)
                  from public.admin_audit_log a
                 where a.resource_type = 'listings' and a.resource_id = p_listing::text)
  ) end;
$$;
revoke all on function public.admin_moderation_detail(uuid) from public, anon;
grant execute on function public.admin_moderation_detail(uuid) to authenticated;

create or replace function public.admin_screening_settings()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not (public.admin_has_perm('listings.moderate')
                     or public.admin_has_perm('compliance.rules_manage')
                     or public.admin_is_owner())
              then null
              else jsonb_build_object(
    'screening_enabled',     (select screening_enabled     from public.content_screening_config),
    'max_listings_per_hour', (select max_listings_per_hour from public.content_screening_config),
    'disabled_reason',       (select disabled_reason       from public.content_screening_config),
    'updated_at',            (select updated_at            from public.content_screening_config),
    'can_toggle',            public.admin_is_owner(),
    'classes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'compliance_class', c.compliance_class, 'label', c.label,
                  'rule_version', c.rule_version, 'active', c.active,
                  'requires_clearance', c.requires_clearance)
                  order by c.label), '[]'::jsonb)
                  from public.compliance_classes c)
  ) end;
$$;
revoke all on function public.admin_screening_settings() from public, anon;
grant execute on function public.admin_screening_settings() to authenticated;

notify pgrst, 'reload schema';
