-- Boon/Zordy may prepare entitlement and promo proposals, but conversation
-- never executes them. The existing hash-bound action queue, risk-3 owner
-- review, separate execution tap, admin permissions, and AI write kill switch
-- remain mandatory. Complimentary access never mutates Stripe.

create or replace function public.ai_file_action_request(
  p_agent text,p_action text,p_params jsonb,p_summary text,p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  allowed jsonb := '{
    "gnome_hq":["pause_listing","restore_listing","adjust_inventory","quarantine_lot","end_promotion","grant_promo_credits","grant_comp_plan","create_promo_campaign","cancel_seed_order","resolve_report"],
    "boon":["grant_comp_plan","create_promo_campaign"],
    "operations":["pause_listing","restore_listing","cancel_seed_order","resolve_report"],
    "inventory":["adjust_inventory","quarantine_lot"],
    "seeds":["cancel_seed_order","quarantine_lot"],
    "marketplace":["pause_listing","restore_listing","resolve_report"],
    "support":["resolve_report"],
    "finance":["grant_promo_credits","grant_comp_plan"],
    "growth":["grant_promo_credits"],
    "compliance":["pause_listing"],
    "security":["pause_listing"]
  }'::jsonb;
  risk int; rid uuid; days int; dtype text; duration text;
begin
  if auth.uid() is not null then raise exception 'SERVICE_ONLY' using errcode='P0001'; end if;
  if not exists(select 1 from public.ai_agents a where a.id=p_agent and a.status<>'disabled'
      and 'create_owner_approval_request'=any(a.permissions)) then
    raise exception 'AGENT_NOT_PERMITTED: %',p_agent using errcode='P0001';
  end if;
  if not (allowed ? p_agent) or not (allowed->p_agent ? p_action) then
    raise exception 'ACTION_OUT_OF_SCOPE: % for %',p_action,p_agent using errcode='P0001';
  end if;
  if jsonb_typeof(coalesce(p_params,'{}'))<>'object' then raise exception 'INVALID_ACTION_PARAMETERS'; end if;

  if p_action='grant_comp_plan' then
    if ((coalesce(p_params->>'market_id','') ~ '^[0-9a-fA-F-]{36}$') =
        (coalesce(p_params->>'case_id','') ~ '^[0-9a-fA-F-]{36}$'))
       or coalesce(p_params->>'plan','') not in ('grower','farm') then
      raise exception 'INVALID_GRANT_PARAMETERS';
    end if;
    days:=nullif(p_params->>'days','')::int;
    if days is not null and (days<1 or days>3650) then raise exception 'INVALID_GRANT_DURATION'; end if;
    if coalesce(p_params->>'reason_code','') not in ('FOUNDING_SELLER','SUPPORT_RESOLUTION','INTERNAL_QA','PARTNER','PROMOTION','INFLUENCER_CREATOR','COMMUNITY_PARTNER','OTHER') then
      raise exception 'INVALID_GRANT_REASON';
    end if;
    if p_params->>'reason_code'='OTHER' and nullif(btrim(coalesce(p_params->>'reason_explanation','')),'') is null then
      raise exception 'OTHER_EXPLANATION_REQUIRED';
    end if;
    if coalesce(p_params->>'overlap_action','CANCEL_NEW') not in ('CANCEL_NEW','EXTEND_CURRENT','REPLACE_CURRENT') then
      raise exception 'INVALID_OVERLAP_ACTION';
    end if;
  elsif p_action='create_promo_campaign' then
    if coalesce(p_params->>'code','') !~ '^[A-Za-z0-9_-]{3,40}$'
       or nullif(btrim(coalesce(p_params->>'campaign_name','')),'') is null then
      raise exception 'INVALID_PROMO_IDENTITY';
    end if;
    dtype:=p_params->>'discount_type'; duration:=p_params->>'duration';
    if dtype not in ('percent','amount') or duration not in ('once','repeating','forever') then raise exception 'INVALID_PROMO_BENEFIT'; end if;
    if dtype='percent' and (nullif(p_params->>'discount_percent','')::numeric not between 0.01 and 100) then raise exception 'INVALID_PROMO_DISCOUNT'; end if;
    if dtype='amount' and coalesce(nullif(p_params->>'discount_amount_cents','')::int,0)<=0 then raise exception 'INVALID_PROMO_DISCOUNT'; end if;
    if duration='repeating' and coalesce(nullif(p_params->>'duration_in_months','')::int,0)<=0 then raise exception 'INVALID_PROMO_DURATION'; end if;
    if coalesce(nullif(p_params->>'max_redemptions_per_user','')::int,1)<1 then raise exception 'INVALID_PROMO_LIMIT'; end if;
  end if;

  risk:=case when p_action in ('grant_comp_plan','create_promo_campaign') then 3 else 2 end;
  insert into public.ai_action_requests(agent_id,requested_action,resource_type,resource_id,parameters,
    payload_hash,human_summary,reason,risk_level,status,dry_run,expires_at)
  values(p_agent,p_action,split_part(p_action,'_',2),null,coalesce(p_params,'{}'),
    encode(extensions.digest(p_action||'|'||coalesce(p_params,'{}')::text,'sha256'),'hex'),
    left(coalesce(p_summary,p_action),200),left(coalesce(p_reason,''),300),risk,'PENDING',false,now()+interval '7 days')
  returning id into rid;
  perform public.admin_audit('AI_ACTION_PROPOSED','ai_action_request',rid::text,null,
    jsonb_build_object('agent',p_agent,'action',p_action,'params',p_params),p_reason,'AI_AGENT');
  return rid;
end $$;

revoke execute on function public.ai_file_action_request(text,text,jsonb,text,text) from public,anon,authenticated;

create or replace function public.admin_execute_ai_action(p_request uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  r public.ai_action_requests; expected_hash text; result jsonb:='{}'; paused boolean;
  grant_result jsonb; promo_id uuid; source_name text;
begin
  if not public.admin_has_perm('ai.approve_actions') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  select writes_paused into paused from public.ai_settings limit 1;
  select * into r from public.ai_action_requests where id=p_request for update;
  if r is null then raise exception 'REQUEST_NOT_FOUND' using errcode='P0001'; end if;
  if r.status<>'APPROVED' then raise exception 'NOT_APPROVED: %',r.status using errcode='P0001'; end if;
  if r.expires_at<=now() then
    update public.ai_action_requests set status='EXPIRED' where id=p_request;
    raise exception 'REQUEST_EXPIRED' using errcode='P0001';
  end if;
  expected_hash:=encode(extensions.digest(r.requested_action||'|'||r.parameters::text,'sha256'),'hex');
  if expected_hash<>r.payload_hash then
    update public.ai_action_requests set status='FAILED',execution_result=jsonb_build_object('error','PAYLOAD_HASH_MISMATCH') where id=p_request;
    raise exception 'PAYLOAD_CHANGED_AFTER_APPROVAL' using errcode='P0001';
  end if;
  if paused and not r.dry_run then raise exception 'AI_WRITES_PAUSED' using errcode='P0001'; end if;

  if r.dry_run then
    result:=jsonb_build_object('dry_run',true,'would_execute',r.requested_action,'parameters',r.parameters);
  else
    case r.requested_action
      when 'pause_listing' then
        update public.listings set status='paused' where id=(r.parameters->>'listing_id')::uuid and status='active';
        result:=jsonb_build_object('paused',found);
      when 'restore_listing' then
        update public.listings set status='active' where id=(r.parameters->>'listing_id')::uuid and status='paused';
        result:=jsonb_build_object('restored',found);
      when 'adjust_inventory' then
        result:=jsonb_build_object('new_qty',public.admin_adjust_lot((r.parameters->>'lot_id')::uuid,
          (r.parameters->>'delta')::numeric,coalesce(r.parameters->>'reason','AI-proposed adjustment (owner approved)')));
      when 'quarantine_lot' then
        perform public.admin_set_lot_status((r.parameters->>'lot_id')::uuid,'quarantined',
          coalesce(r.parameters->>'reason','AI-proposed quarantine (owner approved)'));
        result:=jsonb_build_object('quarantined',true);
      when 'end_promotion' then
        perform public.admin_end_promotion((r.parameters->>'promotion_id')::uuid,
          coalesce(r.parameters->>'reason','AI-proposed (owner approved)'),
          coalesce((r.parameters->>'restore_credit')::boolean,false));
        result:=jsonb_build_object('ended',true);
      when 'grant_promo_credits' then
        perform public.admin_grant_promo_credits((r.parameters->>'market_id')::uuid,
          (r.parameters->>'qty')::int,coalesce(r.parameters->>'reason','AI-proposed (owner approved)'));
        result:=jsonb_build_object('granted',(r.parameters->>'qty')::int);
      when 'grant_comp_plan' then
        source_name:=case r.agent_id when 'boon' then 'BOON' when 'gnome_hq' then 'ZORDY' else 'ADMIN' end;
        if nullif(r.parameters->>'case_id','') is not null then
          grant_result:=public.admin_prepare_concierge_entitlement((r.parameters->>'case_id')::uuid,
            (r.parameters->>'plan')::public.market_plan,nullif(r.parameters->>'days','')::int,
            r.parameters->>'reason_code',r.parameters->>'reason_explanation',r.parameters->>'note',
            p_request::text,source_name);
        else
          grant_result:=public.admin_grant_plan_v2((r.parameters->>'market_id')::uuid,
            (r.parameters->>'plan')::public.market_plan,
            case when nullif(r.parameters->>'days','') is null then null else now()+((r.parameters->>'days')::int||' days')::interval end,
            r.parameters->>'reason_code',r.parameters->>'reason_explanation',r.parameters->>'note',
            p_request::text,source_name,coalesce(r.parameters->>'overlap_action','CANCEL_NEW'));
          if grant_result->>'outcome'='OVERLAP' then raise exception 'OVERLAP_REQUIRES_DECISION' using hint=grant_result::text; end if;
        end if;
        result:=grant_result||jsonb_build_object('approval_request',p_request,'stripe_changed',false);
      when 'create_promo_campaign' then
        promo_id:=public.admin_upsert_promo_campaign(r.parameters||jsonb_build_object(
          'internal_notes',coalesce(r.parameters->>'internal_notes','')||case when coalesce(r.parameters->>'internal_notes','')='' then '' else E'\n' end||
            'Created from approved '||r.agent_id||' proposal '||p_request::text));
        result:=jsonb_build_object('campaign_id',promo_id,'code',upper(r.parameters->>'code'),
          'stripe_configured',false,'payments_live_enabled',false,'approval_request',p_request);
      when 'cancel_seed_order' then
        perform public.admin_cancel_seed_order((r.parameters->>'order_id')::uuid,
          coalesce(r.parameters->>'reason','AI-proposed cancellation (owner approved)'));
        result:=jsonb_build_object('cancelled',true);
      when 'resolve_report' then
        result:=jsonb_build_object('resolved',public.admin_resolve_report((r.parameters->>'report_id')::uuid,
          coalesce(r.parameters->>'note','Resolved via AI proposal (owner approved)')));
      else raise exception 'UNSUPPORTED_ACTION: %',r.requested_action using errcode='P0001';
    end case;
  end if;

  update public.ai_action_requests set status='EXECUTED',executed_at=now(),execution_result=result where id=p_request;
  perform public.admin_audit('AI_ACTION_EXECUTED',coalesce(r.resource_type,'ai_action'),
    coalesce(r.resource_id,p_request::text),null,result,null,'ADMIN',p_request);
  return result;
end $$;

revoke execute on function public.admin_execute_ai_action(uuid) from public,anon;
grant execute on function public.admin_execute_ai_action(uuid) to authenticated;

update public.ai_agents set permissions=array_append(permissions,'create_owner_approval_request')
where id='boon' and not ('create_owner_approval_request'=any(permissions));

do $$ begin
  if exists(select 1 from public.billing_config where payments_live_enabled) then
    raise exception 'SAFETY: payments_live_enabled must remain false';
  end if;
end $$;

notify pgrst,'reload schema';
