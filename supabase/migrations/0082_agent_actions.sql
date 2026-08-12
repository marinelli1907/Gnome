-- 0082: agents get bounded hands — the full-business action pipeline.
--
-- DESIGN: conversation still never executes anything. A Boardroom agent may
-- FILE an ai_action_request (hash-bound parameters, risk-tiered, 7-day
-- expiry); the owner approves in AI HQ; admin_execute_ai_action runs the
-- allowlisted branch AS THE APPROVING ADMIN by delegating to the existing
-- permission-checked, audited definer RPCs — so every action inherits the
-- human approver's permission gates, the kill switch, execute-once
-- semantics, and payload-hash verification. UNSUPPORTED_ACTION stays the
-- default. A proposal filed by prompt-injected content is inert: it still
-- lands in PENDING, still shows its exact parameters, and still needs the
-- owner's tap.

-- ---- the allowlist, v2 -----------------------------------------------------
create or replace function public.admin_execute_ai_action(p_request uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.ai_action_requests;
  v_hash text;
  v_result jsonb := '{}';
  v_paused boolean;
begin
  if not public.admin_has_perm('ai.approve_actions') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select writes_paused into v_paused from public.ai_settings limit 1;
  select * into r from public.ai_action_requests where id = p_request for update;
  if r is null then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'APPROVED' then raise exception 'NOT_APPROVED: %', r.status using errcode = 'P0001'; end if;
  if r.expires_at <= now() then
    update public.ai_action_requests set status = 'EXPIRED' where id = p_request;
    raise exception 'REQUEST_EXPIRED' using errcode = 'P0001';
  end if;
  v_hash := encode(extensions.digest(r.requested_action || '|' || r.parameters::text, 'sha256'), 'hex');
  if v_hash <> r.payload_hash then
    update public.ai_action_requests set status = 'FAILED',
      execution_result = jsonb_build_object('error', 'PAYLOAD_HASH_MISMATCH') where id = p_request;
    raise exception 'PAYLOAD_CHANGED_AFTER_APPROVAL' using errcode = 'P0001';
  end if;
  if v_paused and not r.dry_run then
    raise exception 'AI_WRITES_PAUSED' using errcode = 'P0001';
  end if;

  if r.dry_run then
    v_result := jsonb_build_object('dry_run', true, 'would_execute', r.requested_action, 'parameters', r.parameters);
  else
    case r.requested_action
      when 'pause_listing' then
        update public.listings set status = 'paused'
         where id = (r.parameters->>'listing_id')::uuid and status = 'active';
        v_result := jsonb_build_object('paused', found);
      when 'restore_listing' then
        update public.listings set status = 'active'
         where id = (r.parameters->>'listing_id')::uuid and status = 'paused';
        v_result := jsonb_build_object('restored', found);
      when 'adjust_inventory' then
        v_result := jsonb_build_object('new_qty', public.admin_adjust_lot(
          (r.parameters->>'lot_id')::uuid,
          (r.parameters->>'delta')::numeric,
          coalesce(r.parameters->>'reason', 'AI-proposed adjustment (owner approved)')));
      when 'quarantine_lot' then
        perform public.admin_set_lot_status(
          (r.parameters->>'lot_id')::uuid, 'quarantined',
          coalesce(r.parameters->>'reason', 'AI-proposed quarantine (owner approved)'));
        v_result := jsonb_build_object('quarantined', true);
      when 'end_promotion' then
        perform public.admin_end_promotion(
          (r.parameters->>'promotion_id')::uuid,
          coalesce(r.parameters->>'reason', 'AI-proposed (owner approved)'),
          coalesce((r.parameters->>'restore_credit')::boolean, false));
        v_result := jsonb_build_object('ended', true);
      when 'grant_promo_credits' then
        perform public.admin_grant_promo_credits(
          (r.parameters->>'market_id')::uuid,
          (r.parameters->>'qty')::int,
          coalesce(r.parameters->>'reason', 'AI-proposed (owner approved)'));
        v_result := jsonb_build_object('granted', (r.parameters->>'qty')::int);
      when 'grant_comp_plan' then
        v_result := jsonb_build_object('grant_id', public.admin_grant_plan(
          (r.parameters->>'market_id')::uuid,
          (r.parameters->>'plan')::market_plan,
          case when r.parameters->>'days' is null then null
               else now() + ((r.parameters->>'days')::int || ' days')::interval end,
          coalesce(r.parameters->>'reason', 'AI-proposed comp (owner approved)')));
      when 'cancel_seed_order' then
        perform public.admin_cancel_seed_order(
          (r.parameters->>'order_id')::uuid,
          coalesce(r.parameters->>'reason', 'AI-proposed cancellation (owner approved)'));
        v_result := jsonb_build_object('cancelled', true);
      when 'resolve_report' then
        v_result := jsonb_build_object('resolved', public.admin_resolve_report(
          (r.parameters->>'report_id')::uuid,
          coalesce(r.parameters->>'note', 'Resolved via AI proposal (owner approved)')));
      else
        raise exception 'UNSUPPORTED_ACTION: %', r.requested_action using errcode = 'P0001';
    end case;
  end if;

  update public.ai_action_requests
     set status = 'EXECUTED', executed_at = now(), execution_result = v_result
   where id = p_request;
  perform public.admin_audit('AI_ACTION_EXECUTED', coalesce(r.resource_type, 'ai_action'),
    coalesce(r.resource_id, p_request::text), null, v_result, null, 'ADMIN', p_request);
  return v_result;
end $$;
revoke execute on function public.admin_execute_ai_action(uuid) from public, anon;
grant execute on function public.admin_execute_ai_action(uuid) to authenticated;

-- ---- report resolution (Support screen + resolve_report action) -----------
create or replace function public.admin_resolve_report(p_report uuid, p_note text default null)
returns boolean language plpgsql security definer set search_path = public
as $$
declare rep public.reports;
begin
  if not public.admin_has_perm('support.resolve') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into rep from public.reports where id = p_report for update;
  if rep is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if rep.resolved_at is not null then return false; end if;
  update public.reports set resolved_at = now(), resolved_by = auth.uid(),
    status = 'resolved', admin_notes = coalesce(p_note, admin_notes)
   where id = p_report;
  perform public.admin_audit('REPORT_RESOLVED', 'report', p_report::text,
    to_jsonb(rep), null, p_note);
  return true;
end $$;
revoke execute on function public.admin_resolve_report(uuid,text) from public, anon;
grant execute on function public.admin_resolve_report(uuid,text) to authenticated;

-- ---- listing moderation (Listings screen) ----------------------------------
create or replace function public.admin_set_listing_status(p_listing uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare l public.listings;
begin
  if p_status = 'paused' and not public.admin_has_perm('listings.pause') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_status = 'active' and not public.admin_has_perm('listings.restore') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_status not in ('paused','active') then raise exception 'BAD_STATUS' using errcode = 'P0001'; end if;
  select * into l from public.listings where id = p_listing for update;
  if l is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  update public.listings set status = p_status::listing_status where id = p_listing;
  perform public.admin_audit(case when p_status='paused' then 'LISTING_PAUSED' else 'LISTING_RESTORED' end,
    'listing', p_listing::text, jsonb_build_object('status', l.status),
    jsonb_build_object('status', p_status), p_reason);
end $$;
revoke execute on function public.admin_set_listing_status(uuid,text,text) from public, anon;
grant execute on function public.admin_set_listing_status(uuid,text,text) to authenticated;

create or replace function public.admin_listings_search(p_q text default null, p_status text default null)
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when not public.admin_has_perm('listings.view') then null else
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', l.id, 'title', l.title, 'status', l.status, 'listing_type', l.listing_type,
      'category', l.category, 'price_cents', l.price_cents, 'created_at', l.created_at,
      'expires_at', l.expires_at, 'is_featured', l.is_featured,
      'market', (select name from public.markets m where m.id = l.market_id),
      'owner', (select name from public.profiles p where p.id = l.owner_id),
      'open_reports', (select count(*) from public.reports rp
         where rp.target_type = 'listing' and rp.target_id = l.id and rp.resolved_at is null)
    ) order by l.created_at desc)
    from (select * from public.listings
           where (p_q is null or title ilike '%'||p_q||'%')
             and (p_status is null or status::text = p_status)
           order by created_at desc limit 50) l), '[]'::jsonb)
  end;
$$;
revoke execute on function public.admin_listings_search(text,text) from public, anon;
grant execute on function public.admin_listings_search(text,text) to authenticated;

create or replace function public.admin_markets_overview()
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when not public.admin_has_perm('markets.view') then null else
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'owner', (select name from public.profiles p where p.id = m.owner_id),
      'status', m.status, 'plan', ep.plan, 'source', ep.source,
      'active_listings', public.market_active_listing_count(m.id),
      'created_at', m.created_at
    ) order by m.created_at desc)
    from public.markets m cross join lateral public.market_effective_plan(m.id) ep
    limit 100), '[]'::jsonb)
  end;
$$;
revoke execute on function public.admin_markets_overview() from public, anon;
grant execute on function public.admin_markets_overview() to authenticated;

-- Reports need an admin read policy (web admin had one via 0024 is_admin —
-- keep + ensure) and compliance queue already readable via admin_all policy.
drop policy if exists reports_admin_read on public.reports;
create policy reports_admin_read on public.reports
  for select using (public.admin_has_perm('support.view') or reporter_id = auth.uid());
grant select on public.reports to authenticated;

-- ---- Boardroom proposal service --------------------------------------------
-- The orchestrator (service role) validates and files agent proposals. The
-- per-action risk and per-agent scopes live HERE, server-side — never in
-- model output. Agents without create_owner_approval_request cannot file.
create or replace function public.ai_file_action_request(
  p_agent text, p_action text, p_params jsonb, p_summary text, p_reason text
) returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_allowed jsonb := '{
    "gnome_hq":    ["pause_listing","restore_listing","adjust_inventory","quarantine_lot","end_promotion","grant_promo_credits","grant_comp_plan","cancel_seed_order","resolve_report"],
    "operations":  ["pause_listing","restore_listing","cancel_seed_order","resolve_report"],
    "inventory":   ["adjust_inventory","quarantine_lot"],
    "seeds":       ["cancel_seed_order","quarantine_lot"],
    "marketplace": ["pause_listing","restore_listing","resolve_report"],
    "support":     ["resolve_report"],
    "finance":     ["grant_promo_credits","grant_comp_plan"],
    "growth":      ["grant_promo_credits"],
    "compliance":  ["pause_listing"],
    "security":    ["pause_listing"]
  }'::jsonb;
  v_risk int;
  v_id uuid;
begin
  if auth.uid() is not null then
    raise exception 'SERVICE_ONLY' using errcode = 'P0001';  -- orchestrator path only
  end if;
  if not exists (select 1 from public.ai_agents a where a.id = p_agent
                   and a.status <> 'disabled'
                   and 'create_owner_approval_request' = any(a.permissions)) then
    raise exception 'AGENT_NOT_PERMITTED: %', p_agent using errcode = 'P0001';
  end if;
  if not (v_allowed ? p_agent) or not (v_allowed->p_agent) ? p_action then
    raise exception 'ACTION_OUT_OF_SCOPE: % for %', p_action, p_agent using errcode = 'P0001';
  end if;
  v_risk := case p_action
    when 'grant_comp_plan' then 3           -- owner-only review
    else 2                                   -- admin approval
  end;
  insert into public.ai_action_requests
    (agent_id, requested_action, resource_type, resource_id, parameters,
     payload_hash, human_summary, reason, risk_level, status, dry_run, expires_at)
  values
    (p_agent, p_action, split_part(p_action, '_', 2), null, coalesce(p_params, '{}'::jsonb),
     encode(extensions.digest(p_action || '|' || coalesce(p_params, '{}'::jsonb)::text, 'sha256'), 'hex'),
     left(coalesce(p_summary, p_action), 200), left(coalesce(p_reason, ''), 300),
     v_risk, 'PENDING', false, now() + interval '7 days')
  returning id into v_id;
  perform public.admin_audit('AI_ACTION_PROPOSED', 'ai_action_request', v_id::text,
    null, jsonb_build_object('agent', p_agent, 'action', p_action, 'params', p_params),
    p_reason, 'AI_AGENT');
  return v_id;
end $$;
revoke execute on function public.ai_file_action_request(text,text,jsonb,text,text) from public, anon, authenticated;

-- Agents that may now file proposals (adds to the original hq/ops/sec/compliance set)
update public.ai_agents set permissions = permissions || '{create_owner_approval_request}'
 where id in ('inventory','seeds','marketplace','support','finance','growth')
   and not ('create_owner_approval_request' = any(permissions));

notify pgrst, 'reload schema';
