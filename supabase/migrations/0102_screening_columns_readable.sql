-- The seller cannot see why their own listing is held.
--
-- `listings` uses per-COLUMN grants (0010 revoked table-level SELECT so lat/lng
-- stay private), which means a column added later starts with NO grant at all.
-- 0095 added five screening columns and granted none of them. This is the third
-- time this exact trap has been sprung - 0085 did it with request_options and
-- broke Browse for months, 0092 repaired that - so the rule is worth restating:
--
--   ON A COLUMN-GRANTED TABLE, A NEW COLUMN IS INVISIBLE UNTIL YOU GRANT IT.
--
-- It is worse than invisible. PostgREST asks for every column in the client's
-- select list, so ONE ungranted column in that list returns 42501 for the whole
-- query. Adding screening_status to the app's LISTING_FIELDS without this grant
-- would have taken Browse down again.
--
-- Before granting, two things had to stop writing non-public text into a column
-- that is about to become world-readable.

-- 1. The trigger stamped an internal note on rows it auto-cleared. Those rows are
--    'active' and therefore readable by everyone. screening_reason is the SELLER'S
--    message; it should be null when there is nothing to tell them. The fact of an
--    auto-clear is still derivable (screening_category set + CLEAR) and the grant
--    decision itself is in admin_audit_log.
update public.listings
   set screening_reason = null
 where screening_status = 'CLEAR'
   and screening_reason = 'auto-cleared: seller holds a current clearance';

create or replace function public.listings_screen_content() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare hit record; blob text; cfg public.content_screening_config; made int;
        v_class text; cls public.compliance_classes; v_state text;
        oldest timestamptz; wait_min int;
begin
  select * into cfg from public.content_screening_config where id;

  if tg_op = 'INSERT' and cfg.max_listings_per_hour is not null
     and not public.is_admin() then
    select count(*), min(created_at) into made, oldest from public.listings
     where owner_id = new.owner_id and created_at > now() - interval '1 hour';
    if made >= cfg.max_listings_per_hour then
      wait_min := greatest(1, ceil(extract(epoch from (oldest + interval '1 hour' - now())) / 60))::int;
      raise exception
        'RATE_LIMITED: You have posted % listings in the last hour, which is the most we allow. You can post again in about % minute%.',
        made, wait_min, case when wait_min = 1 then '' else 's' end
        using errcode = 'P0001';
    end if;
  end if;

  if not coalesce(cfg.screening_enabled, true) then
    return new;   -- owner-only kill switch
  end if;

  blob := coalesce(new.title,'') || ' ' || coalesce(new.description,'') || ' '
       || coalesce(new.trade_for,'');

  select * into hit from public.screen_listing_text(blob)
   where action = 'BLOCK' limit 1;

  v_state := public.normalize_state(new.state);
  if v_state is null then
    select public.normalize_state(pr.state) into v_state
      from public.profiles pr where pr.id = new.owner_id;
  end if;
  if new.state is not null and public.normalize_state(new.state) is not null then
    new.state := public.normalize_state(new.state);
  end if;

  if hit.term is null and coalesce(new.kind,'offer') <> 'wanted' then
    select n.compliance_class into v_class
      from public.marketplace_taxonomy_nodes n
     where n.id = new.taxonomy_node_id and n.compliance_class is not null;

    if v_class is null then
      select * into hit from public.screen_listing_text(
               public.strip_want_clauses(
                 coalesce(new.title,'') || ' ' || coalesce(new.description,'')))
       where action = 'REVIEW' limit 1;
      v_class := hit.category;
    end if;
  end if;

  if hit.action = 'BLOCK' then
    raise exception 'PROHIBITED_ITEM: Gnome can''t carry this one. "%" falls under % , which we don''t allow. If you think that''s wrong, edit the wording or contact support.',
      hit.term, replace(hit.category,'-',' ')
      using errcode = 'P0001';
  elsif v_class is not null then
    select * into cls from public.compliance_classes
     where compliance_class = v_class and active;

    if cls.compliance_class is null or not cls.requires_clearance
       or public.seller_is_cleared(new.owner_id, v_class, v_state) then
      new.screening_status   := 'CLEAR';
      new.screening_term     := null;
      new.screening_category := v_class;
      new.screening_reason   := null;   -- nothing to tell the seller; see note above
      new.screened_at        := now();
    else
      new.screening_status   := 'REVIEW';
      new.screening_term     := hit.term;
      new.screening_category := v_class;
      new.screening_reason   := coalesce(cls.customer_message, hit.rationale);
      new.screened_at        := now();
      if new.status = 'active' then new.status := 'paused'; end if;
    end if;
  else
    new.screening_status   := 'CLEAR';
    new.screening_term     := null;
    new.screening_category := null;
    new.screening_reason   := null;
    new.screened_at        := now();
  end if;

  if new.taxonomy_node_id is not null
     and exists (select 1 from public.marketplace_taxonomy_nodes n
                  where n.id = new.taxonomy_node_id and n.prohibited) then
    raise exception 'PROHIBITED_CATEGORY: Gnome can''t carry items in that category.'
      using errcode = 'P0001';
  end if;

  return new;
end $$;

-- 2. Approving a held listing wrote the MODERATOR'S reason into screening_reason
--    and set the listing active - publishing an internal note to the whole
--    marketplace. The decision and its reason belong in the audit log, which
--    already receives them. Clear the seller-facing column on resolve.
create or replace function public.admin_resolve_screening(
  p_listing uuid, p_approve boolean, p_reason text default null,
  p_suspend_seller boolean default false
) returns public.listings
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_old jsonb; v_row public.listings; v_owner uuid;
begin
  if not (public.admin_has_perm('listings.moderate') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select to_jsonb(t), t.owner_id into v_old, v_owner from public.listings t where t.id = p_listing;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  update public.listings
     set screening_status = case when p_approve then 'APPROVED' else 'BLOCKED' end,
         status = (case when p_approve then 'active' else 'removed' end)::listing_status,
         screening_reason = null
   where id = p_listing returning * into v_row;

  perform public.admin_audit(
    case when p_approve then 'listing.screening.approve' else 'listing.screening.reject' end,
    'listings', p_listing::text, v_old, to_jsonb(v_row), p_reason, 'ADMIN', null);

  if p_suspend_seller and v_owner is not null then
    perform public.admin_set_suspended(v_owner, true);
  end if;
  return v_row;
end $$;
revoke all on function public.admin_resolve_screening(uuid,boolean,text,boolean) from public, anon;
grant execute on function public.admin_resolve_screening(uuid,boolean,text,boolean) to authenticated;

-- Now the grant. Only these two: a seller needs to know THAT their listing is
-- held and WHAT to do about it.
--   screening_term     stays revoked - it is the matched keyword, and publishing
--                      it teaches people how to word around the filter.
--   screening_category stays revoked - internal classification.
--   screened_at        stays revoked - nothing renders it.
-- A held listing is status='paused', and listings_select_active_or_owner means
-- only its owner (or an admin, or a claimer) can read the row at all, so the
-- reason is not visible to neighbours even now that the column is granted.
grant select (screening_status, screening_reason) on public.listings to authenticated, anon;

-- Add the credential id to the moderation payload. Without it the console cannot
-- attach a clearance to the credential it depends on, so a grant could never
-- expire with the licence that justified it.
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
    'credentials', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', c.id,
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

-- Guard: if anyone adds another column to listings without granting it, and the
-- clients ask for it, Browse dies. Assert the two the clients now select.
do $$
begin
  if not has_column_privilege('authenticated','public.listings','screening_status','SELECT')
  or not has_column_privilege('authenticated','public.listings','screening_reason','SELECT') then
    raise exception 'the screening columns the clients select are still not readable';
  end if;
  if has_column_privilege('anon','public.listings','screening_term','SELECT')
  or has_column_privilege('authenticated','public.listings','screening_term','SELECT') then
    raise exception 'screening_term must never be client-readable';
  end if;
end $$;

notify pgrst, 'reload schema';
