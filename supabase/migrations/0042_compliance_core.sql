-- 0042: compliance rule engine + seller credentials (category-scoped).

create type public.credential_status as enum (
  'NOT_SUBMITTED','PENDING','APPROVED','DENIED','EXPIRED','RENEWAL_REQUIRED','REVOKED'
);

-- Rules are DATA, not code: an admin can retune Ohio, or add a state, without
-- an app release. Nothing about a jurisdiction is hardcoded in the clients.
create table if not exists public.compliance_rules (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null default 'US-OH',
  taxonomy_node_id uuid not null references public.marketplace_taxonomy_nodes(id) on delete restrict,
  classification public.compliance_classification not null,
  rule_type text,                  -- permit | license | registration | inspection | labeling | attestation | prohibition
  credential_requirement text,     -- human name of the credential; null when none
  issuing_agency text,
  minimum_plan public.market_plan not null default 'free',
  required_fields jsonb not null default '[]'::jsonb,
  shipping_policy text,            -- 'no_shipping' | 'pickup_only' | 'unrestricted'
  pickup_policy text,
  seller_attestation text,         -- text the seller must affirm, where that is the control
  notes text,
  effective_date date not null default current_date,
  official_source text,            -- ORC/OAC cite or agency URL
  review_status text not null default 'DRAFT',  -- DRAFT | ACTIVE | NEEDS_LEGAL_REVIEW | SUPERSEDED
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (jurisdiction, taxonomy_node_id)
);
create index if not exists compliance_rules_node_idx on public.compliance_rules(taxonomy_node_id);

alter table public.compliance_rules enable row level security;
-- Rules are public knowledge: a seller must be able to see WHY they're blocked.
create policy compliance_rules_select_all on public.compliance_rules
  for select to anon, authenticated using (true);
create policy compliance_rules_admin_write on public.compliance_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.compliance_rules to anon, authenticated;

-- Seller credentials. Documents live in a PRIVATE bucket; only the key is here.
create table if not exists public.seller_credentials (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  market_id uuid references public.markets(id) on delete set null,
  country text not null default 'US',
  state text not null,
  county text,
  city text,
  credential_type text not null,
  issuing_agency text,
  credential_number text,
  issue_date date,
  expiration_date date,
  document_path text,
  status public.credential_status not null default 'PENDING',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  denial_reason text,
  admin_notes text,
  seller_notes text,
  renewal_of_id uuid references public.seller_credentials(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists seller_credentials_seller_idx on public.seller_credentials(seller_id);
create index if not exists seller_credentials_status_idx on public.seller_credentials(status);
create index if not exists seller_credentials_exp_idx on public.seller_credentials(expiration_date);

-- Approval is SCOPED to taxonomy nodes. Being cleared for live bait must never
-- unlock meat. A credential covers a node and everything beneath it.
create table if not exists public.credential_taxonomy_scope (
  credential_id uuid not null references public.seller_credentials(id) on delete cascade,
  taxonomy_node_id uuid not null references public.marketplace_taxonomy_nodes(id) on delete restrict,
  primary key (credential_id, taxonomy_node_id)
);
create index if not exists cred_scope_node_idx on public.credential_taxonomy_scope(taxonomy_node_id);

alter table public.seller_credentials enable row level security;
alter table public.credential_taxonomy_scope enable row level security;

-- A seller sees only their own; admins see all. No cross-seller reads, ever.
create policy seller_credentials_select_own on public.seller_credentials
  for select to authenticated
  using (auth.uid() = seller_id or public.is_admin());

-- A seller may SUBMIT, never self-issue an approval.
create policy seller_credentials_insert_own on public.seller_credentials
  for insert to authenticated
  with check (
    auth.uid() = seller_id
    and status = 'PENDING'::public.credential_status
    and reviewed_at is null and reviewed_by is null
  );

-- They may amend their own submission only while it is undecided, and can never
-- move it into an approved/decided state themselves.
create policy seller_credentials_update_own_pending on public.seller_credentials
  for update to authenticated
  using (auth.uid() = seller_id and status in ('PENDING','DENIED','RENEWAL_REQUIRED','EXPIRED'))
  with check (
    auth.uid() = seller_id
    and status in ('PENDING','RENEWAL_REQUIRED')
    and reviewed_by is null
  );

create policy seller_credentials_admin_all on public.seller_credentials
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy cred_scope_select on public.credential_taxonomy_scope
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.seller_credentials c
                where c.id = credential_id and c.seller_id = auth.uid())
  );
create policy cred_scope_insert_own on public.credential_taxonomy_scope
  for insert to authenticated
  with check (
    public.is_admin()
    or exists (select 1 from public.seller_credentials c
                where c.id = credential_id and c.seller_id = auth.uid() and c.status = 'PENDING')
  );
create policy cred_scope_admin_all on public.credential_taxonomy_scope
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.seller_credentials to authenticated;
grant select, insert on public.credential_taxonomy_scope to authenticated;
