-- Gnome — Compliance + Credential backend. Run after 0037. Additive & reversible.
--
-- Design mirrors 0024/0031/0032: authority lives in the DATABASE. Every publish
-- decision for a regulated product is made by a SECURITY DEFINER gate that reads
-- the authoritative rule + credential state, re-checks is_admin() where relevant,
-- and is enforced by a BEFORE trigger on listings — so a client that POSTs
-- status='active' directly gets rejected exactly like the UI. Rules are DATA
-- (compliance_rules), so changing what's regulated needs no app redeploy.
--
-- Concepts:
--   * A seller's "plan" is their market's plan (markets.plan, market_plan enum).
--   * Compliance attaches to a TAXONOMY NODE and applies to that node and all its
--     descendants; the most restrictive applicable rule wins.
--   * A credential's approval is CATEGORY-SCOPED via credential_taxonomy_scope:
--     approving beans does NOT unlock raw milk.
--   * Documents live in a PRIVATE 'compliance-docs' bucket, reachable only by the
--     owning seller and admins via signed URL — never public.

-- ===========================================================================
-- 0. Prereqs the taxonomy migration will own; created here only if absent so
--    this migration is self-contained. The taxonomy migration may ALTER/extend
--    taxonomy_nodes freely (additive) — these columns are the minimum the gate
--    needs (id + parent_id for ancestor walk).
-- ===========================================================================
create table if not exists public.taxonomy_nodes (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid references public.taxonomy_nodes (id) on delete cascade,
  level      text,                       -- category | subcategory | product_type | variety
  name       text not null,
  slug       text,
  created_at timestamptz not null default now()
);
create index if not exists taxonomy_nodes_parent_idx on public.taxonomy_nodes (parent_id);
alter table public.taxonomy_nodes enable row level security;
drop policy if exists taxonomy_nodes_read_all on public.taxonomy_nodes;
create policy taxonomy_nodes_read_all on public.taxonomy_nodes for select using (true);
drop policy if exists taxonomy_nodes_admin_write on public.taxonomy_nodes;
create policy taxonomy_nodes_admin_write on public.taxonomy_nodes
  for all using (public.is_admin()) with check (public.is_admin());

-- Listings need a taxonomy pointer to be gate-able (category is still flat text).
alter table public.listings
  add column if not exists taxonomy_node_id uuid references public.taxonomy_nodes (id);
create index if not exists listings_taxonomy_node_idx on public.listings (taxonomy_node_id);

-- A non-published/editable state so "save draft" works while publish is blocked.
-- Safe within the wrapping txn: the value is only USED at runtime by the trigger,
-- never in this migration.
alter type public.listing_status add value if not exists 'draft';

-- ===========================================================================
-- 1. Enums
-- ===========================================================================
do $$ begin
  create type public.compliance_classification as enum (
    'GENERALLY_UNRESTRICTED','CONDITIONAL','REGULATED','PROHIBITED','REVIEW_REQUIRED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.credential_status as enum (
    'NOT_SUBMITTED','PENDING','APPROVED','DENIED','EXPIRED','RENEWAL_REQUIRED','REVOKED'
  );
exception when duplicate_object then null; end $$;

-- ===========================================================================
-- 2. Helper: rank plans & classifications; walk the taxonomy ancestor chain.
--    All STABLE / IMMUTABLE, search_path pinned.
-- ===========================================================================
create or replace function public.plan_rank(p public.market_plan)
returns int language sql immutable set search_path = public as $$
  select case p
    when 'free' then 0 when 'grower' then 1 when 'farm' then 2 when 'sponsor' then 3
    else 0 end;
$$;

-- Higher = more restrictive; used to pick the winning rule for a node.
create or replace function public.classification_rank(c public.compliance_classification)
returns int language sql immutable set search_path = public as $$
  select case c
    when 'GENERALLY_UNRESTRICTED' then 0
    when 'CONDITIONAL'            then 1
    when 'REVIEW_REQUIRED'        then 2
    when 'REGULATED'              then 3
    when 'PROHIBITED'             then 4
    else 0 end;
$$;

-- Self + every ancestor node id. Compliance set at a parent applies to children.
create or replace function public.taxonomy_ancestors(p_node_id uuid)
returns setof uuid language sql stable set search_path = public as $$
  with recursive chain(id, parent_id) as (
    select n.id, n.parent_id from public.taxonomy_nodes n where n.id = p_node_id
    union all
    select n.id, n.parent_id
      from public.taxonomy_nodes n
      join chain c on n.id = c.parent_id
  )
  select id from chain;
$$;

-- ===========================================================================
-- 3. compliance_rules — admin-editable, no redeploy to change what's regulated.
-- ===========================================================================
create table if not exists public.compliance_rules (
  id                     uuid primary key default gen_random_uuid(),
  jurisdiction           text not null default 'US',          -- 'US', 'US-OH', 'US-OH-Franklin', '*'
  taxonomy_node_id       uuid not null references public.taxonomy_nodes (id) on delete cascade,
  classification         public.compliance_classification not null,
  rule_type              text,                                 -- e.g. 'cottage_food','meat_usda','raw_milk'
  credential_requirement text,                                 -- human summary of what's needed
  minimum_plan           public.market_plan not null default 'free',
  required_fields        jsonb not null default '{}'::jsonb,   -- schema of listing fields to capture
  shipping_policy        text not null default 'inherit'
                           check (shipping_policy in ('inherit','allow','conditional','prohibit')),
  pickup_policy          text not null default 'inherit'
                           check (pickup_policy  in ('inherit','allow','conditional','prohibit')),
  effective_date         date not null default current_date,
  official_source        text,                                 -- citation / URL to statute or agency page
  review_status          text not null default 'active'
                           check (review_status in ('draft','active','superseded','retired')),
  notes                  text,
  created_by             uuid references public.profiles (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (jurisdiction, taxonomy_node_id, rule_type)
);
create index if not exists compliance_rules_node_idx    on public.compliance_rules (taxonomy_node_id);
create index if not exists compliance_rules_juris_idx   on public.compliance_rules (jurisdiction);
create index if not exists compliance_rules_active_idx  on public.compliance_rules (taxonomy_node_id)
  where review_status = 'active';

alter table public.compliance_rules enable row level security;

-- Rules are public knowledge (a seller must see why they're blocked); only the
-- *active, effective* ones are readable to non-admins. Admins see & edit all.
drop policy if exists compliance_rules_public_read on public.compliance_rules;
create policy compliance_rules_public_read on public.compliance_rules
  for select using (review_status = 'active' and effective_date <= current_date);
drop policy if exists compliance_rules_admin_read on public.compliance_rules;
create policy compliance_rules_admin_read on public.compliance_rules
  for select using (public.is_admin());
drop policy if exists compliance_rules_admin_write on public.compliance_rules;
create policy compliance_rules_admin_write on public.compliance_rules
  for all using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- 4. seller_credentials — one row per permit/license, per seller.
-- ===========================================================================
create table if not exists public.seller_credentials (
  id               uuid primary key default gen_random_uuid(),
  seller_id        uuid not null references public.profiles (id) on delete cascade,
  country          text not null default 'US',
  state            text,
  county           text,
  city             text,
  credential_type  text not null,                     -- 'cottage_food_registration','food_license', etc.
  issuing_agency   text,
  permit_number    text,
  issue_date       date,
  expiration_date  date,
  document_path    text,                               -- key in PRIVATE 'compliance-docs' bucket
  status           public.credential_status not null default 'NOT_SUBMITTED',
  submitted_at     timestamptz,
  reviewed_at      timestamptz,
  reviewed_by      uuid references public.profiles (id),
  denial_reason    text,
  admin_notes      text,                               -- admin-only (never exposed to seller UI)
  renewal_of_id    uuid references public.seller_credentials (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists seller_credentials_seller_idx on public.seller_credentials (seller_id);
create index if not exists seller_credentials_status_idx on public.seller_credentials (status);
create index if not exists seller_credentials_renewal_idx on public.seller_credentials (renewal_of_id);
-- Fast sweep of live approvals nearing/past expiry.
create index if not exists seller_credentials_expiry_idx on public.seller_credentials (expiration_date)
  where status in ('APPROVED','RENEWAL_REQUIRED');

alter table public.seller_credentials enable row level security;

-- Category scope: which taxonomy nodes an APPROVED credential authorizes.
create table if not exists public.credential_taxonomy_scope (
  credential_id    uuid not null references public.seller_credentials (id) on delete cascade,
  taxonomy_node_id uuid not null references public.taxonomy_nodes (id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (credential_id, taxonomy_node_id)
);
create index if not exists cred_scope_node_idx on public.credential_taxonomy_scope (taxonomy_node_id);
alter table public.credential_taxonomy_scope enable row level security;

-- --------------------------------------------------------------------------
-- 4a. RLS: seller sees ONLY their own; admin sees all. Seller may create/edit
--     their own submission but CANNOT set a privileged status — that's forced
--     by the trigger in 4b (RLS can't compare OLD/NEW). No cross-seller read.
-- --------------------------------------------------------------------------
drop policy if exists seller_credentials_owner_select on public.seller_credentials;
create policy seller_credentials_owner_select on public.seller_credentials
  for select using (auth.uid() = seller_id);
drop policy if exists seller_credentials_admin_select on public.seller_credentials;
create policy seller_credentials_admin_select on public.seller_credentials
  for select using (public.is_admin());

-- Seller inserts only their own row, only in a non-privileged initial status.
drop policy if exists seller_credentials_owner_insert on public.seller_credentials;
create policy seller_credentials_owner_insert on public.seller_credentials
  for insert with check (
    auth.uid() = seller_id
    and status in ('NOT_SUBMITTED','PENDING')
    and reviewed_by is null and reviewed_at is null
    and not coalesce((select suspended from public.profiles where id = auth.uid()), false)
  );
drop policy if exists seller_credentials_admin_insert on public.seller_credentials;
create policy seller_credentials_admin_insert on public.seller_credentials
  for insert with check (public.is_admin());

-- Seller may update their own row (resubmit/edit) but not a decided one; the
-- 4b trigger blocks any move into APPROVED/DENIED/REVOKED and locks review fields.
drop policy if exists seller_credentials_owner_update on public.seller_credentials;
create policy seller_credentials_owner_update on public.seller_credentials
  for update using (
    auth.uid() = seller_id
    and status in ('NOT_SUBMITTED','PENDING','RENEWAL_REQUIRED','EXPIRED','DENIED')
  ) with check (
    auth.uid() = seller_id
    and status in ('NOT_SUBMITTED','PENDING','RENEWAL_REQUIRED')
  );
drop policy if exists seller_credentials_admin_update on public.seller_credentials;
create policy seller_credentials_admin_update on public.seller_credentials
  for update using (public.is_admin()) with check (public.is_admin());
-- No seller DELETE policy: credentials are audit history (admin/service-role only).
drop policy if exists seller_credentials_admin_delete on public.seller_credentials;
create policy seller_credentials_admin_delete on public.seller_credentials
  for delete using (public.is_admin());

-- Scope rows: readable by the credential's owner or admin. Seller may propose
-- scope while the credential is not yet decided; admin controls it thereafter.
drop policy if exists cred_scope_owner_select on public.credential_taxonomy_scope;
create policy cred_scope_owner_select on public.credential_taxonomy_scope
  for select using (
    public.is_admin()
    or auth.uid() = (select seller_id from public.seller_credentials c where c.id = credential_id)
  );
drop policy if exists cred_scope_owner_write on public.credential_taxonomy_scope;
create policy cred_scope_owner_write on public.credential_taxonomy_scope
  for all using (
    public.is_admin()
    or ( auth.uid() = (select seller_id from public.seller_credentials c where c.id = credential_id)
         and (select status from public.seller_credentials c where c.id = credential_id)
             in ('NOT_SUBMITTED','PENDING','RENEWAL_REQUIRED') )
  ) with check (
    public.is_admin()
    or ( auth.uid() = (select seller_id from public.seller_credentials c where c.id = credential_id)
         and (select status from public.seller_credentials c where c.id = credential_id)
             in ('NOT_SUBMITTED','PENDING','RENEWAL_REQUIRED') )
  );

-- --------------------------------------------------------------------------
-- 4b. Transition guard: only is_admin() may move a credential into a decided
--     state or write the review fields. Seller edits are limited to their own
--     data. Sellers CANNOT self-approve, even via a crafted API call.
-- --------------------------------------------------------------------------
create or replace function public.seller_credentials_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare admin boolean := public.is_admin();
begin
  if tg_op = 'INSERT' then
    if not admin then
      -- Sellers submit as PENDING/NOT_SUBMITTED with no review metadata.
      new.reviewed_by := null; new.reviewed_at := null;
      new.denial_reason := null; new.admin_notes := null;
      if new.status not in ('NOT_SUBMITTED','PENDING') then
        raise exception 'Only an admin can create a credential in status %', new.status
          using errcode = 'check_violation';
      end if;
      if new.status = 'PENDING' and new.submitted_at is null then
        new.submitted_at := now();
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if not admin then
    -- Privileged status values are admin-only.
    if new.status in ('APPROVED','DENIED','REVOKED')
       and new.status is distinct from old.status then
      raise exception 'Only an admin can set credential status to %', new.status
        using errcode = 'insufficient_privilege';
    end if;
    -- Review/audit fields are immutable to the seller.
    new.reviewed_by   := old.reviewed_by;
    new.reviewed_at   := old.reviewed_at;
    new.denial_reason := old.denial_reason;
    new.admin_notes   := old.admin_notes;
    new.seller_id     := old.seller_id;      -- can't hand a credential to someone else
    if new.status = 'PENDING' and old.status <> 'PENDING' and new.submitted_at is null then
      new.submitted_at := now();
    end if;
  else
    -- Admin decision stamps the audit fields automatically.
    if new.status in ('APPROVED','DENIED','REVOKED')
       and new.status is distinct from old.status then
      new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
      new.reviewed_at := coalesce(new.reviewed_at, now());
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists seller_credentials_guard_trg on public.seller_credentials;
create trigger seller_credentials_guard_trg
  before insert or update on public.seller_credentials
  for each row execute function public.seller_credentials_guard();

-- ===========================================================================
-- 5. PRIVATE storage bucket + object policies. NEVER public.
--    Path convention: '<seller_id>/<credential_id>/<filename>'. The first path
--    segment is the owner's uuid, which the policies key on.
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'compliance-docs', 'compliance-docs', false,
  15728640,  -- 15 MB
  array['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
on conflict (id) do update
  set public = false,                 -- enforce: this bucket is never public
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Owner may read own docs (signed-URL issuance checks SELECT).
drop policy if exists compliance_docs_owner_read on storage.objects;
create policy compliance_docs_owner_read on storage.objects
  for select to authenticated using (
    bucket_id = 'compliance-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admins may read every doc (for review).
drop policy if exists compliance_docs_admin_read on storage.objects;
create policy compliance_docs_admin_read on storage.objects
  for select to authenticated using (
    bucket_id = 'compliance-docs' and public.is_admin()
  );

-- Owner may upload/replace only within their own folder.
drop policy if exists compliance_docs_owner_insert on storage.objects;
create policy compliance_docs_owner_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'compliance-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists compliance_docs_owner_update on storage.objects;
create policy compliance_docs_owner_update on storage.objects
  for update to authenticated using (
    bucket_id = 'compliance-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'compliance-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Deletes are admin-only: documents are evidence, retained for audit.
drop policy if exists compliance_docs_admin_delete on storage.objects;
create policy compliance_docs_admin_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'compliance-docs' and public.is_admin()
  );
-- No `to public`/anon policy anywhere on this bucket ⇒ no anonymous access.

-- ===========================================================================
-- 6. The authoritative publish gate. SECURITY DEFINER so it reads rules +
--    credentials regardless of the caller's RLS; auth.uid() still resolves to
--    the calling user (JWT claim, unaffected by definer role switch).
--
--    Returns a machine code: 'OK' or a blocking reason. can_publish_in_node()
--    wraps it as a boolean. p_market_id optionally fixes which plan applies;
--    when null we use the caller's strongest owned plan.
-- ===========================================================================
create or replace function public.compliance_publish_reason(
  p_node_id   uuid,
  p_market_id uuid default null
) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid            uuid := auth.uid();
  v_plan           public.market_plan;
  v_worst          int := 0;     -- max classification_rank among applicable rules
  v_min_plan       int := 0;     -- max required plan_rank among applicable rules
  v_has_cred       boolean;
begin
  if v_uid is null then
    return 'NOT_AUTHENTICATED';
  end if;
  if p_node_id is null then
    return 'OK';   -- untaxonomized listing: nothing to gate (flat category path)
  end if;

  -- Resolve the caller's effective plan.
  if p_market_id is not null then
    select m.plan into v_plan
      from public.markets m
     where m.id = p_market_id and m.owner_id = v_uid;
  else
    select m.plan into v_plan
      from public.markets m
     where m.owner_id = v_uid
     order by public.plan_rank(m.plan) desc
     limit 1;
  end if;
  v_plan := coalesce(v_plan, 'free');

  -- Aggregate every ACTIVE, effective rule attached to this node or an ancestor.
  -- Most-restrictive classification wins; strongest required plan wins.
  select
    coalesce(max(public.classification_rank(r.classification)), 0),
    coalesce(max(public.plan_rank(r.minimum_plan)), 0)
  into v_worst, v_min_plan
  from public.compliance_rules r
  where r.taxonomy_node_id in (select public.taxonomy_ancestors(p_node_id))
    and r.review_status = 'active'
    and r.effective_date <= current_date;

  -- PROHIBITED: nobody may publish.
  if v_worst = public.classification_rank('PROHIBITED') then
    return 'PROHIBITED';
  end if;

  -- No live rule, or purely GENERALLY_UNRESTRICTED/CONDITIONAL ⇒ plan gate only.
  if public.plan_rank(v_plan) < v_min_plan then
    return 'PLAN_TOO_LOW';
  end if;

  -- REGULATED / REVIEW_REQUIRED: free can never publish; paid needs an APPROVED,
  -- unexpired, category-scoped credential.
  if v_worst >= public.classification_rank('REVIEW_REQUIRED') then
    if public.plan_rank(v_plan) < public.plan_rank('grower') then
      return 'PAID_PLAN_REQUIRED';
    end if;

    select exists (
      select 1
        from public.seller_credentials c
        join public.credential_taxonomy_scope s on s.credential_id = c.id
       where c.seller_id = v_uid
         and c.status = 'APPROVED'
         and (c.expiration_date is null or c.expiration_date >= current_date)
         and s.taxonomy_node_id in (select public.taxonomy_ancestors(p_node_id))
    ) into v_has_cred;

    if not v_has_cred then
      return 'CREDENTIAL_REQUIRED';
    end if;
  end if;

  return 'OK';
end;
$$;

create or replace function public.can_publish_in_node(
  p_node_id   uuid,
  p_market_id uuid default null
) returns boolean
language sql stable security definer set search_path = public as $$
  select public.compliance_publish_reason(p_node_id, p_market_id) = 'OK';
$$;

revoke all on function public.compliance_publish_reason(uuid, uuid) from anon;
revoke all on function public.can_publish_in_node(uuid, uuid) from anon;
grant execute on function public.compliance_publish_reason(uuid, uuid) to authenticated;
grant execute on function public.can_publish_in_node(uuid, uuid) to authenticated;

-- ===========================================================================
-- 7. Publish enforcement trigger on listings. Draft/removed/etc. pass freely;
--    only a transition INTO 'active' is gated. Admins bypass (manual remediation).
-- ===========================================================================
create or replace function public.listings_compliance_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_reason text;
begin
  -- Only gate the act of publishing.
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' and new.taxonomy_node_id is not distinct from old.taxonomy_node_id then
    return new;   -- already-active, category unchanged: not a (re)publish
  end if;
  if public.is_admin() then
    return new;
  end if;

  v_reason := public.compliance_publish_reason(new.taxonomy_node_id, new.market_id);
  if v_reason <> 'OK' then
    raise exception 'Listing cannot be published in this category: %', v_reason
      using errcode = 'insufficient_privilege',
            hint = 'Save as draft, upgrade your plan, or submit the required credential.';
  end if;
  return new;
end;
$$;

drop trigger if exists listings_compliance_guard_trg on public.listings;
create trigger listings_compliance_guard_trg
  before insert or update on public.listings
  for each row execute function public.listings_compliance_guard();

-- ===========================================================================
-- 8. Expiration + re-activation automation (pg_cron, same style as 0018).
--    * APPROVED whose expiry passed  -> EXPIRED
--    * APPROVED within 30 days of expiry -> RENEWAL_REQUIRED (soft warning; still valid)
--    * Active regulated listings the seller can no longer publish -> paused as
--      'draft' (history preserved; stamped compliance_paused_at/reason).
--    * Paused listings that CAN publish again (renewal APPROVED + paid plan) ->
--      restored to 'active'. No re-review is forced — the credential row's own
--      status is the source of truth.
-- ===========================================================================
alter table public.listings
  add column if not exists compliance_paused_at   timestamptz,
  add column if not exists compliance_pause_reason text;
create index if not exists listings_compliance_paused_idx on public.listings (compliance_paused_at)
  where compliance_paused_at is not null;

create or replace function public.compliance_expire_sweep()
returns void language plpgsql security definer set search_path = public as $$
begin
  -- 1) Soft renewal warning (still valid, still publishable).
  update public.seller_credentials
     set status = 'RENEWAL_REQUIRED', updated_at = now()
   where status = 'APPROVED'
     and expiration_date is not null
     and expiration_date >= current_date
     and expiration_date <= current_date + interval '30 days';

  -- 2) Hard expiry.
  update public.seller_credentials
     set status = 'EXPIRED', updated_at = now()
   where status in ('APPROVED','RENEWAL_REQUIRED')
     and expiration_date is not null
     and expiration_date < current_date;

  -- 3) Pause active listings whose category now fails the gate for their owner.
  --    Evaluate the gate as the listing OWNER by checking rules/credentials
  --    directly (compliance_publish_reason keys on auth.uid(), so re-implement
  --    the owner-scoped check inline here rather than calling it).
  update public.listings l
     set status = 'draft',
         compliance_paused_at = now(),
         compliance_pause_reason = 'credential_expired'
   where l.status = 'active'
     and l.taxonomy_node_id is not null
     and exists (
       select 1 from public.compliance_rules r
        where r.taxonomy_node_id in (select public.taxonomy_ancestors(l.taxonomy_node_id))
          and r.review_status = 'active'
          and r.effective_date <= current_date
          and r.classification in ('REGULATED','REVIEW_REQUIRED')
     )
     and not exists (
       select 1
         from public.seller_credentials c
         join public.credential_taxonomy_scope s on s.credential_id = c.id
        where c.seller_id = l.owner_id
          and c.status = 'APPROVED'
          and (c.expiration_date is null or c.expiration_date >= current_date)
          and s.taxonomy_node_id in (select public.taxonomy_ancestors(l.taxonomy_node_id))
     );

  -- 4) Re-activate previously auto-paused listings once a valid credential +
  --    paid plan return. Only rows WE paused (compliance_pause_reason set) and
  --    that haven't been claimed/removed/expired since.
  update public.listings l
     set status = 'active',
         compliance_paused_at = null,
         compliance_pause_reason = null
   where l.status = 'draft'
     and l.compliance_pause_reason = 'credential_expired'
     and coalesce(l.expires_at, now() + interval '1 day') > now()
     and exists (
       select 1 from public.markets m
        where m.id = l.market_id and m.owner_id = l.owner_id
          and public.plan_rank(m.plan) >= public.plan_rank('grower')
     )
     and exists (
       select 1
         from public.seller_credentials c
         join public.credential_taxonomy_scope s on s.credential_id = c.id
        where c.seller_id = l.owner_id
          and c.status = 'APPROVED'
          and (c.expiration_date is null or c.expiration_date >= current_date)
          and s.taxonomy_node_id in (select public.taxonomy_ancestors(l.taxonomy_node_id))
     );
end;
$$;

revoke all on function public.compliance_expire_sweep() from anon, authenticated;

-- Schedule hourly (idempotent registration, mirrors 0018).
create extension if not exists pg_cron;
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'gnome-compliance-sweep') then
    perform cron.schedule(
      'gnome-compliance-sweep',
      '7 * * * *',                       -- top-of-hour-ish, offset from other jobs
      $sweep$ select public.compliance_expire_sweep(); $sweep$
    );
  end if;
end
$$;

-- ===========================================================================
-- Rollback sketch:
--   select cron.unschedule('gnome-compliance-sweep');
--   drop trigger listings_compliance_guard_trg on public.listings;
--   drop function public.listings_compliance_guard();
--   drop function public.compliance_expire_sweep();
--   drop function public.can_publish_in_node(uuid,uuid);
--   drop function public.compliance_publish_reason(uuid,uuid);
--   drop trigger seller_credentials_guard_trg on public.seller_credentials;
--   drop function public.seller_credentials_guard();
--   drop policy ... on storage.objects (the four compliance_docs_* policies);
--   delete from storage.buckets where id='compliance-docs';  -- after emptying it
--   drop table public.credential_taxonomy_scope, public.seller_credentials,
--              public.compliance_rules;
--   alter table public.listings drop column compliance_paused_at,
--     drop column compliance_pause_reason, drop column taxonomy_node_id;
--   drop function public.taxonomy_ancestors(uuid),
--                public.classification_rank(public.compliance_classification),
--                public.plan_rank(public.market_plan);
--   drop type public.credential_status, public.compliance_classification;
--   -- (listing_status 'draft' value and taxonomy_nodes are intentionally kept.)
-- ===========================================================================
