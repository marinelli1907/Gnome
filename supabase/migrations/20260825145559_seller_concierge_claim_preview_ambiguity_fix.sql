begin;

-- The preview function returns a column named status. In PL/pgSQL that output
-- name is also a variable, so the original unqualified UPDATE predicate failed
-- at runtime with "column reference status is ambiguous".
create or replace function public.concierge_claim_preview(p_token text)
returns table(
  case_id uuid,
  business_name text,
  status text,
  total_drafts bigint,
  ready bigint,
  needs_info bigint,
  needs_compliance bigint,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 256 then
    return;
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  update public.seller_concierge_invites as invitation
  set status = 'OPENED',
      opened_at = coalesce(invitation.opened_at, now())
  where invitation.token_hash = v_hash
    and invitation.status = 'SENT'
    and invitation.expires_at > now();

  update public.seller_concierge_cases as concierge_case
  set invite_opened_at = coalesce(concierge_case.invite_opened_at, now()),
      updated_at = now()
  where exists (
    select 1
    from public.seller_concierge_invites as invitation
    where invitation.case_id = concierge_case.id
      and invitation.token_hash = v_hash
      and invitation.status in ('OPENED', 'CLAIMED')
      and invitation.expires_at > now()
  );

  return query
  select
    concierge_case.id,
    concierge_case.business_name,
    concierge_case.status,
    count(draft.*),
    count(*) filter (where draft.status = 'READY'),
    count(*) filter (where draft.status = 'NEEDS_INFO'),
    count(*) filter (where draft.status = 'NEEDS_COMPLIANCE'),
    invitation.expires_at
  from public.seller_concierge_invites as invitation
  join public.seller_concierge_cases as concierge_case
    on concierge_case.id = invitation.case_id
  left join public.seller_concierge_drafts as draft
    on draft.case_id = concierge_case.id
  where invitation.token_hash = v_hash
    and invitation.status in ('SENT', 'OPENED')
    and invitation.expires_at > now()
  group by concierge_case.id, invitation.expires_at;
end;
$$;

revoke all on function public.concierge_claim_preview(text) from public;
grant execute on function public.concierge_claim_preview(text) to anon, authenticated;

do $$
begin
  if exists (
    select 1
    from public.billing_config
    where payments_live_enabled is true
  ) then
    raise exception 'claim preview repair self-check: payments_live_enabled must stay false';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
