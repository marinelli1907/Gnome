begin;

alter table public.seller_concierge_cases
  add column if not exists is_qa boolean not null default false,
  add column if not exists qa_tombstoned_at timestamptz,
  add column if not exists historical_claimed_user_id uuid,
  add column if not exists historical_claimed_market_id uuid,
  add column if not exists historical_market_name text;

comment on column public.seller_concierge_cases.is_qa is
  'Explicit disposable-test marker. QA cases are excluded from acquisition and agent metrics.';
comment on column public.seller_concierge_cases.historical_claimed_user_id is
  'Immutable identifier snapshot retained when an approved QA tombstone releases the live profile FK.';
comment on column public.seller_concierge_cases.historical_claimed_market_id is
  'Immutable identifier snapshot retained when an approved QA tombstone releases the live Market FK.';
comment on column public.seller_concierge_cases.historical_market_name is
  'Minimal display snapshot retained so QA audit history remains understandable after Market deletion.';

-- A consumed token resolves to a non-actionable CLAIMED state. This lets the
-- client show a stable single-use result without exposing the token after the
-- successful claim or allowing it to perform verification again.
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
      and invitation.status = 'OPENED'
      and invitation.expires_at > now()
  );

  return query
  select
    concierge_case.id,
    concierge_case.business_name,
    case when invitation.status = 'CLAIMED' then 'CLAIMED' else concierge_case.status end,
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
    and not concierge_case.is_qa
    and (
      (invitation.status in ('SENT', 'OPENED') and invitation.expires_at > now())
      or invitation.status = 'CLAIMED'
    )
  group by concierge_case.id, invitation.status, invitation.expires_at;
end;
$$;

revoke all on function public.concierge_claim_preview(text) from public;
grant execute on function public.concierge_claim_preview(text) to anon, authenticated;

-- Funnel numbers are operating metrics, not an audit view.
create or replace function public.admin_seller_concierge_funnel()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.admin_has_perm('markets.view') then null else jsonb_build_object(
    'prepared',count(*),'invited',count(*) filter(where invited_at is not null),
    'invite_opened',count(*) filter(where invite_opened_at is not null),
    'claimed',count(*) filter(where claimed_at is not null),
    'account_ready',count(*) filter(where account_ready_at is not null),
    'market_reviewed',count(*) filter(where market_reviewed_at is not null),
    'first_listing_published',count(*) filter(where first_listing_published_at is not null),
    'active_seller',count(*) filter(where active_seller_at is not null),
    'median_hours_to_claim',percentile_cont(.5) within group(order by extract(epoch from(claimed_at-created_at))/3600) filter(where claimed_at is not null),
    'median_hours_to_first_listing',percentile_cont(.5) within group(order by extract(epoch from(first_listing_published_at-created_at))/3600) filter(where first_listing_published_at is not null)
  ) end
  from public.seller_concierge_cases
  where not is_qa;
$$;

-- The operations list retains tombstones for audit review, but labels them so
-- they cannot be mistaken for acquisition traction.
drop function public.admin_concierge_cases();
create function public.admin_concierge_cases()
returns table(
  id uuid,
  business_name text,
  seller_name text,
  invited_email text,
  status text,
  is_qa boolean,
  market_model text,
  location_mode text,
  total_drafts bigint,
  ready bigint,
  needs_info bigint,
  needs_compliance bigint,
  invited_at timestamptz,
  claimed_at timestamptz,
  claimed_market_id uuid,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,c.business_name,c.seller_name,c.invited_email,c.status,c.is_qa,c.market_model,c.location_mode,
    count(d.*),count(*) filter(where d.status='READY'),count(*) filter(where d.status='NEEDS_INFO'),
    count(*) filter(where d.status='NEEDS_COMPLIANCE'),c.invited_at,c.claimed_at,c.claimed_market_id,c.updated_at
  from public.seller_concierge_cases c
  left join public.seller_concierge_drafts d on d.case_id=c.id
  where public.admin_has_perm('markets.view')
  group by c.id
  order by c.is_qa, c.updated_at desc;
$$;

revoke all on function public.admin_concierge_cases() from public, anon;
grant execute on function public.admin_concierge_cases() to authenticated;

create or replace function public.admin_tombstone_concierge_qa_case(
  p_case uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.seller_concierge_cases;
  v_user uuid;
  v_market uuid;
  v_market_name text;
  v_synthetic_email text;
  v_deleted_drafts integer := 0;
  v_cancelled_entitlements integer := 0;
begin
  if not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'QA_TOMBSTONE_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_case
  from public.seller_concierge_cases
  where id = p_case
  for update;
  if v_case is null then
    raise exception 'CONCIERGE_CASE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_case.qa_tombstoned_at is not null then
    return jsonb_build_object('outcome','ALREADY_TOMBSTONED','case_id',v_case.id,'is_qa',true);
  end if;

  v_user := v_case.claimed_by;
  v_market := v_case.claimed_market_id;
  v_synthetic_email := 'qa-tombstone-' || replace(v_case.id::text, '-', '') || '@invalid.example';

  if v_market is not null then
    select name into v_market_name from public.markets where id = v_market for update;
    if v_market_name is null then
      raise exception 'QA_MARKET_NOT_FOUND' using errcode = 'P0001';
    end if;
    if exists(select 1 from public.public_markets where id = v_market)
       or exists(select 1 from public.listings where market_id = v_market)
       or exists(select 1 from public.market_orders where market_id = v_market)
       or exists(select 1 from public.seller_transactions where market_id = v_market)
       or exists(select 1 from public.seller_expenses where market_id = v_market)
       or exists(select 1 from public.listing_promotions where market_id = v_market)
       or exists(select 1 from public.market_subscriptions where market_id = v_market)
       or exists(select 1 from public.admin_plan_grants where market_id = v_market)
       or exists(select 1 from public.promotion_redemptions where market_id = v_market)
       or exists(select 1 from public.market_assistance_actions where market_id = v_market)
       or exists(select 1 from public.market_assistance_authorizations where market_id = v_market) then
      raise exception 'QA_MARKET_HAS_LINKED_BUSINESS_DATA' using errcode = 'P0001';
    end if;
    update public.markets set status = 'paused' where id = v_market;
  end if;

  if v_user is not null then
    if exists(select 1 from public.claims where claimer_id = v_user)
       or exists(select 1 from public.claim_messages where sender_id = v_user)
       or exists(select 1 from public.market_orders where buyer_id = v_user)
       or exists(select 1 from public.seller_credentials where seller_id = v_user)
       or exists(select 1 from public.promotion_redemptions where user_id = v_user)
       or exists(select 1 from public.admin_plan_grants where user_id = v_user) then
      raise exception 'QA_USER_HAS_LINKED_BUSINESS_DATA' using errcode = 'P0001';
    end if;
    update public.profiles set suspended = true where id = v_user;
  end if;

  if exists (
    select 1 from public.seller_concierge_prepared_entitlements
    where case_id = v_case.id and status = 'ACTIVATED'
  ) then
    raise exception 'QA_CASE_HAS_ACTIVATED_ENTITLEMENT' using errcode = 'P0001';
  end if;

  delete from public.listing_drafts
  where concierge_case_id = v_case.id
    and (v_user is null or owner_id = v_user);
  get diagnostics v_deleted_drafts = row_count;

  update public.seller_concierge_prepared_entitlements
  set invited_email = v_synthetic_email,
      status = case when status = 'APPROVED' then 'CANCELLED' else status end,
      cancelled_by = case when status = 'APPROVED' then auth.uid() else cancelled_by end,
      cancelled_at = case when status = 'APPROVED' then now() else cancelled_at end,
      cancel_reason = case when status = 'APPROVED' then 'Disposable QA case tombstoned' else cancel_reason end,
      updated_at = now()
  where case_id = v_case.id;
  get diagnostics v_cancelled_entitlements = row_count;

  update public.seller_concierge_invites
  set email = v_synthetic_email,
      token_hash = encode(extensions.digest('qa-tombstone:' || id::text, 'sha256'), 'hex'),
      status = case when status in ('SENT','OPENED') then 'REVOKED' else status end,
      revoked_at = case when status in ('SENT','OPENED') then now() else revoked_at end
  where case_id = v_case.id;

  update public.seller_concierge_cases
  set is_qa = true,
      qa_tombstoned_at = now(),
      historical_claimed_user_id = coalesce(historical_claimed_user_id, v_user),
      historical_claimed_market_id = coalesce(historical_claimed_market_id, v_market),
      historical_market_name = coalesce(historical_market_name, v_market_name, business_name),
      seller_name = null,
      invited_email = null,
      market_profile = '{}'::jsonb,
      claimed_by = null,
      claimed_market_id = null,
      status = 'EXPIRED',
      expires_at = now(),
      updated_at = now()
  where id = v_case.id;

  perform public.admin_audit(
    'CONCIERGE_QA_TOMBSTONED',
    'seller_concierge_case',
    v_case.id::text,
    jsonb_build_object(
      'status',v_case.status,
      'claimed_user_id',v_user,
      'claimed_market_id',v_market,
      'is_qa',v_case.is_qa
    ),
    jsonb_build_object(
      'status','EXPIRED',
      'is_qa',true,
      'historical_claimed_user_id',v_user,
      'historical_claimed_market_id',v_market,
      'historical_market_name',coalesce(v_market_name,v_case.business_name),
      'listing_drafts_deleted',v_deleted_drafts,
      'prepared_entitlements_touched',v_cancelled_entitlements,
      'pii_scrubbed',true
    ),
    btrim(p_reason)
  );

  return jsonb_build_object(
    'outcome','QA_TOMBSTONED',
    'case_id',v_case.id,
    'historical_claimed_user_id',v_user,
    'historical_claimed_market_id',v_market,
    'listing_drafts_deleted',v_deleted_drafts,
    'audit_preserved',true,
    'ready_for_account_deletion',v_user is not null
  );
end;
$$;

revoke all on function public.admin_tombstone_concierge_qa_case(uuid,text) from public, anon;
grant execute on function public.admin_tombstone_concierge_qa_case(uuid,text) to authenticated;

do $$
begin
  if exists(select 1 from public.billing_config where payments_live_enabled is true) then
    raise exception 'seller Concierge closeout self-check: payments_live_enabled must stay false';
  end if;
  if has_function_privilege('anon','public.admin_tombstone_concierge_qa_case(uuid,text)','execute') then
    raise exception 'seller Concierge closeout self-check: anonymous QA tombstone access';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
