-- 0046: everything the seller/admin compliance UI needs, all additive.
--
-- (a) seller_jurisdiction()          — profile state drives jurisdiction (fallback US-OH)
-- (b) can_publish_in_node            — + CREDENTIAL_DENIED branch; REVIEW_REQUIRED now
--                                      blocks with its own neutral reason (more
--                                      conservative than before, never less)
-- (c) publish_eligibility()          — one client-facing RPC: verdict + rule metadata,
--                                      jurisdiction derived server-side
-- (d) compliance_audit_log           — every credential submission/decision, trigger-written
-- (e) admin_review_credential()      — the ONLY sanctioned review path; reasons required
-- (f) listing_has_verified_credential() — public boolean badge, no metadata leak
-- (g) seller_transactions claim idempotency (Complete Exchange double-tap safety)
-- (h) daily compliance expiry cron

-- ---------------------------------------------------------------------------
-- (a) Jurisdiction from the seller's own profile. Conservative fallback: if we
-- can't tell where the seller is, Ohio's rules apply rather than none.
create or replace function public.seller_jurisdiction(p_user uuid)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select 'US-' || upper(p.state)
       from public.profiles p
      where p.id = p_user and upper(coalesce(p.state, '')) ~ '^[A-Z]{2}$'),
    'US-OH');
$$;
revoke all on function public.seller_jurisdiction(uuid) from public, anon;
grant execute on function public.seller_jurisdiction(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (b) Gate v2: adds a DENIED/REVOKED branch (was folded into CREDENTIAL_REQUIRED,
-- which hid the admin's reason from the seller) and gives REVIEW_REQUIRED its
-- own terminal state — while Gnome is still reviewing what a category legally
-- needs, nobody publishes in it, and we don't imply the seller did anything wrong.
create or replace function public.can_publish_in_node(
  p_node_id uuid,
  p_user uuid default auth.uid(),
  p_jurisdiction text default 'US-OH'
) returns table(allowed boolean, reason text, message text)
language plpgsql stable security definer set search_path = public as $$
declare
  r public.compliance_rules;
  node public.marketplace_taxonomy_nodes;
  cred_count int;
begin
  if p_user is null then
    return query select false, 'NOT_SIGNED_IN', 'Sign in to publish a listing.'; return;
  end if;
  select * into node from public.marketplace_taxonomy_nodes where id = p_node_id;
  if node is null then
    return query select true, 'NO_NODE', 'No category selected.'; return;
  end if;
  if node.prohibited then
    return query select false, 'PROHIBITED', 'This product is not allowed on Gnome.'; return;
  end if;

  select * into r from public.effective_compliance_rule(p_node_id, p_jurisdiction);

  if r is null or r.classification = 'GENERALLY_UNRESTRICTED' then
    return query select true, 'UNRESTRICTED', null::text; return;
  end if;

  if r.classification = 'PROHIBITED' then
    return query select false, 'PROHIBITED',
      coalesce(r.notes, 'This product is not allowed on Gnome.'); return;
  end if;

  if r.classification = 'CONDITIONAL' then
    return query select true, 'CONDITIONAL', r.seller_attestation; return;
  end if;

  -- Gnome hasn't finished reviewing what this category requires: hold
  -- publishing for everyone. Not a statement about legality or the seller.
  if r.classification = 'REVIEW_REQUIRED' then
    return query select false, 'REVIEW_REQUIRED',
      'This category is not currently available for publishing while Gnome reviews applicable requirements.';
    return;
  end if;

  if r.minimum_plan <> 'free' and not public.user_has_paid_plan(p_user) then
    return query select false, 'PLAN_REQUIRED',
      'Selling this type of product requires a paid Gnome seller plan and regulatory verification.';
    return;
  end if;

  select count(*) into cred_count
    from public.seller_credentials c
    join public.credential_taxonomy_scope s on s.credential_id = c.id
    join public.marketplace_taxonomy_nodes sn on sn.id = s.taxonomy_node_id
   where c.seller_id = p_user
     and c.status = 'APPROVED'
     and (c.expiration_date is null or c.expiration_date >= current_date)
     and (node.path = sn.path or node.path like sn.path || '/%');

  if cred_count > 0 then
    return query select true, 'CREDENTIAL_OK', null::text; return;
  end if;

  if exists (
    select 1 from public.seller_credentials c
    join public.credential_taxonomy_scope s on s.credential_id = c.id
    join public.marketplace_taxonomy_nodes sn on sn.id = s.taxonomy_node_id
    where c.seller_id = p_user and c.status = 'PENDING'
      and (node.path = sn.path or node.path like sn.path || '/%')
  ) then
    return query select false, 'CREDENTIAL_PENDING',
      'Your documentation for this category is being reviewed. You can save a draft, but it cannot be published yet.';
    return;
  end if;

  if exists (
    select 1 from public.seller_credentials c
    join public.credential_taxonomy_scope s on s.credential_id = c.id
    join public.marketplace_taxonomy_nodes sn on sn.id = s.taxonomy_node_id
    where c.seller_id = p_user and c.status in ('EXPIRED','RENEWAL_REQUIRED')
      and (node.path = sn.path or node.path like sn.path || '/%')
  ) then
    return query select false, 'CREDENTIAL_EXPIRED',
      'Your credential for this category expired. Renew it to reactivate these listings.';
    return;
  end if;

  -- Denied/revoked AFTER the live/pending/expired checks: a seller with one old
  -- denial and a newer approved credential must not read as denied.
  if exists (
    select 1 from public.seller_credentials c
    join public.credential_taxonomy_scope s on s.credential_id = c.id
    join public.marketplace_taxonomy_nodes sn on sn.id = s.taxonomy_node_id
    where c.seller_id = p_user and c.status in ('DENIED','REVOKED')
      and (node.path = sn.path or node.path like sn.path || '/%')
  ) then
    return query select false, 'CREDENTIAL_DENIED',
      'Your verification for this category was not approved. Review the reason and resubmit your documentation.';
    return;
  end if;

  return query select false, 'CREDENTIAL_REQUIRED',
    coalesce('This product requires additional verification' ||
             case when r.credential_requirement is not null
                  then ' (' || r.credential_requirement || ')' else '' end || '.',
             'This product requires additional verification.');
end $$;

-- Enforcement paths now derive jurisdiction from the seller's profile instead
-- of assuming Ohio for everyone (fallback stays US-OH — conservative).
create or replace function public.listings_enforce_compliance()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  verdict record;
begin
  if new.taxonomy_node_id is null then return new; end if;
  if new.status is distinct from 'active'::public.listing_status then return new; end if;
  if tg_op = 'UPDATE'
     and old.status = 'active'::public.listing_status
     and old.taxonomy_node_id is not distinct from new.taxonomy_node_id then
    return new;
  end if;
  if public.is_admin() then return new; end if;

  select * into verdict from public.can_publish_in_node(
    new.taxonomy_node_id, new.owner_id, public.seller_jurisdiction(new.owner_id));
  if verdict.allowed then return new; end if;

  raise exception 'COMPLIANCE_BLOCKED:%:%', verdict.reason, coalesce(verdict.message, '')
    using errcode = 'P0001';
end $$;

create or replace function public.compliance_run_expiry()
returns table(expired_credentials integer, paused_listings integer)
language plpgsql security definer set search_path = public as $$
declare exp_count int := 0; paused int := 0;
begin
  with expiring as (
    update public.seller_credentials
       set status = 'EXPIRED', updated_at = now()
     where status = 'APPROVED'
       and expiration_date is not null
       and expiration_date < current_date
    returning id
  )
  select count(*) into exp_count from expiring;

  with candidates as (
    select l.id
      from public.listings l
     where l.status = 'active'
       and l.taxonomy_node_id is not null
       and exists (
         select 1 from public.compliance_rules r
         join public.marketplace_taxonomy_nodes rn on rn.id = r.taxonomy_node_id
         join public.marketplace_taxonomy_nodes ln on ln.id = l.taxonomy_node_id
         where r.classification in ('REGULATED','REVIEW_REQUIRED')
           and (ln.path = rn.path or ln.path like rn.path || '/%')
       )
       and not (select allowed from public.can_publish_in_node(
                  l.taxonomy_node_id, l.owner_id, public.seller_jurisdiction(l.owner_id)))
  ), paused_rows as (
    update public.listings l
       set status = 'paused'::public.listing_status
      from candidates c
     where l.id = c.id
    returning l.id
  )
  select count(*) into paused from paused_rows;

  return query select exp_count, paused;
end $$;

create or replace function public.compliance_reactivate_for_seller(p_seller uuid default auth.uid())
returns integer
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if p_seller is null or (p_seller <> auth.uid() and not public.is_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  with resumable as (
    select l.id from public.listings l
     where l.owner_id = p_seller
       and l.status = 'paused'
       and l.taxonomy_node_id is not null
       and (select allowed from public.can_publish_in_node(
              l.taxonomy_node_id, p_seller, public.seller_jurisdiction(p_seller)))
  ), done as (
    update public.listings l set status = 'active'::public.listing_status
      from resumable r where l.id = r.id returning l.id
  )
  select count(*) into n from done;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- (c) The one call the mobile app makes when a seller picks a category.
-- Jurisdiction is derived HERE, server-side, so the client can't shop for a
-- friendlier state; jurisdiction_source tells the UI whether we actually knew
-- the seller's state ('profile') or fell back ('default' → ask them to set
-- their location before treating the verdict as final).
create or replace function public.publish_eligibility(p_node_id uuid)
returns table(
  allowed boolean,
  reason text,
  message text,
  jurisdiction text,
  jurisdiction_source text,
  classification text,
  credential_requirement text,
  issuing_agency text,
  official_source text,
  minimum_plan text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_jur text;
  v_src text;
  r public.compliance_rules;
  verdict record;
begin
  if v_user is null then
    return query select false, 'NOT_SIGNED_IN', 'Sign in to publish a listing.',
      null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  if exists (select 1 from public.profiles p
              where p.id = v_user and upper(coalesce(p.state,'')) ~ '^[A-Z]{2}$') then
    v_src := 'profile';
  else
    v_src := 'default';
  end if;
  v_jur := public.seller_jurisdiction(v_user);

  select * into verdict from public.can_publish_in_node(p_node_id, v_user, v_jur);
  select * into r from public.effective_compliance_rule(p_node_id, v_jur);

  return query select
    verdict.allowed, verdict.reason, verdict.message,
    v_jur, v_src,
    (r.classification)::text, r.credential_requirement, r.issuing_agency,
    r.official_source, (r.minimum_plan)::text;
end $$;
revoke all on function public.publish_eligibility(uuid) from public, anon;
grant execute on function public.publish_eligibility(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (d) Audit: every submission and every decision, written by trigger so no
-- path — RPC, direct table update, cron expiry — can change a credential
-- silently. No write grants; rows only appear via the trigger.
create table if not exists public.compliance_audit_log (
  id bigint generated always as identity primary key,
  credential_id uuid not null references public.seller_credentials(id) on delete cascade,
  seller_id uuid not null,
  actor_id uuid,                       -- null = system (cron)
  actor_role text not null,            -- 'seller' | 'admin' | 'system'
  action text not null,                -- SUBMITTED | RESUBMITTED | APPROVED | DENIED |
                                       -- RESUBMISSION_REQUESTED | REVOKED | EXPIRED | STATUS_CHANGED
  old_status public.credential_status,
  new_status public.credential_status,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists compliance_audit_credential_idx on public.compliance_audit_log(credential_id);
create index if not exists compliance_audit_seller_idx on public.compliance_audit_log(seller_id);

alter table public.compliance_audit_log enable row level security;
create policy compliance_audit_select on public.compliance_audit_log
  for select to authenticated
  using (public.is_admin() or seller_id = auth.uid());
grant select on public.compliance_audit_log to authenticated;

create or replace function public.seller_credentials_audit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_action text;
  v_reason text := null;
begin
  if v_actor is null then v_role := 'system';
  elsif public.is_admin() and v_actor <> new.seller_id then v_role := 'admin';
  else v_role := 'seller';
  end if;

  if tg_op = 'INSERT' then
    v_action := 'SUBMITTED';
  elsif old.status is not distinct from new.status then
    return new;  -- metadata-only edit; decisions are what we audit
  elsif new.status = 'PENDING' and old.status in ('DENIED','RENEWAL_REQUIRED','EXPIRED','REVOKED') then
    v_action := 'RESUBMITTED';
  elsif new.status = 'APPROVED' then v_action := 'APPROVED';
  elsif new.status = 'DENIED' then v_action := 'DENIED'; v_reason := new.denial_reason;
  elsif new.status = 'RENEWAL_REQUIRED' then v_action := 'RESUBMISSION_REQUESTED'; v_reason := new.denial_reason;
  elsif new.status = 'REVOKED' then v_action := 'REVOKED'; v_reason := new.denial_reason;
  elsif new.status = 'EXPIRED' then v_action := 'EXPIRED';
  else v_action := 'STATUS_CHANGED';
  end if;

  insert into public.compliance_audit_log
    (credential_id, seller_id, actor_id, actor_role, action, old_status, new_status, reason)
  values
    (new.id, new.seller_id, v_actor, v_role, v_action,
     case when tg_op = 'UPDATE' then old.status else null end, new.status, v_reason);
  return new;
end $$;

drop trigger if exists seller_credentials_audit_trg on public.seller_credentials;
create trigger seller_credentials_audit_trg
  after insert or update on public.seller_credentials
  for each row execute function public.seller_credentials_audit();

-- ---------------------------------------------------------------------------
-- (e) The only sanctioned admin review path. Reasons are mandatory for every
-- adverse action; approval auto-reactivates the seller's paused listings that
-- now pass the gate, revocation immediately re-pauses what no longer does.
create or replace function public.admin_review_credential(
  p_credential uuid,
  p_action text,
  p_reason text default null
) returns public.seller_credentials
language plpgsql security definer set search_path = public as $$
declare
  c public.seller_credentials;
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_action not in ('APPROVE','DENY','REQUEST_RESUBMISSION','REVOKE') then
    raise exception 'INVALID_ACTION: %', p_action using errcode = 'P0001';
  end if;
  if p_action in ('DENY','REQUEST_RESUBMISSION','REVOKE')
     and coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: % needs an explanation the seller will see', p_action
      using errcode = 'P0001';
  end if;

  select * into c from public.seller_credentials where id = p_credential for update;
  if c is null then
    raise exception 'CREDENTIAL_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_action = 'APPROVE' then
    if c.expiration_date is not null and c.expiration_date < current_date then
      raise exception 'CANNOT_APPROVE_EXPIRED: expiration date is in the past'
        using errcode = 'P0001';
    end if;
    update public.seller_credentials
       set status = 'APPROVED', reviewed_at = now(), reviewed_by = auth.uid(),
           denial_reason = null, updated_at = now()
     where id = p_credential;
    perform public.compliance_reactivate_for_seller(c.seller_id);
  elsif p_action = 'DENY' then
    update public.seller_credentials
       set status = 'DENIED', reviewed_at = now(), reviewed_by = auth.uid(),
           denial_reason = btrim(p_reason), updated_at = now()
     where id = p_credential;
  elsif p_action = 'REQUEST_RESUBMISSION' then
    update public.seller_credentials
       set status = 'RENEWAL_REQUIRED', reviewed_at = now(), reviewed_by = auth.uid(),
           denial_reason = btrim(p_reason), updated_at = now()
     where id = p_credential;
  else -- REVOKE
    update public.seller_credentials
       set status = 'REVOKED', reviewed_at = now(), reviewed_by = auth.uid(),
           denial_reason = btrim(p_reason), updated_at = now()
     where id = p_credential;
    perform public.compliance_run_expiry();
  end if;

  select * into c from public.seller_credentials where id = p_credential;
  return c;
end $$;
revoke all on function public.admin_review_credential(uuid, text, text) from public, anon;
grant execute on function public.admin_review_credential(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- (f) Public badge: TRUE only when the listing's node is actually REGULATED in
-- the seller's jurisdiction AND the seller holds a live approved credential
-- scoped to it. A boolean and nothing else — no permit numbers, no agencies.
create or replace function public.listing_has_verified_credential(p_listing uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  l record;
  r public.compliance_rules;
begin
  select id, owner_id, taxonomy_node_id into l
    from public.listings where id = p_listing;
  if l is null or l.taxonomy_node_id is null then return false; end if;

  select * into r from public.effective_compliance_rule(
    l.taxonomy_node_id, public.seller_jurisdiction(l.owner_id));
  if r is null or r.classification <> 'REGULATED' then return false; end if;

  return exists (
    select 1
      from public.seller_credentials c
      join public.credential_taxonomy_scope s on s.credential_id = c.id
      join public.marketplace_taxonomy_nodes sn on sn.id = s.taxonomy_node_id
      join public.marketplace_taxonomy_nodes ln on ln.id = l.taxonomy_node_id
     where c.seller_id = l.owner_id
       and c.status = 'APPROVED'
       and (c.expiration_date is null or c.expiration_date >= current_date)
       and (ln.path = sn.path or ln.path like sn.path || '/%'));
end $$;
grant execute on function public.listing_has_verified_credential(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- (g) Complete Exchange idempotency: one completed ledger row per claim, ever.
-- A double-tap 23505s instead of double-counting; voiding frees the slot for a
-- corrected re-record. (seller_transactions is empty in production today.)
create unique index if not exists seller_transactions_claim_completed_uniq
  on public.seller_transactions(claim_id)
  where claim_id is not null and status = 'completed';

-- ---------------------------------------------------------------------------
-- (h) Actually run the expiry sweep. Daily at 05:30 UTC (00:30/01:30 Ohio).
select cron.schedule('gnome-compliance-expiry', '30 5 * * *',
  $$select public.compliance_run_expiry();$$);
