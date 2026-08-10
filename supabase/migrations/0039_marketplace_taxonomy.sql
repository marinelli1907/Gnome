-- 0039: hierarchical marketplace taxonomy (Category > Subcategory > Product Type > Variety).
--
-- Additive: listings.category (flat text) is untouched and remains the fallback
-- for any client that has not adopted the taxonomy; listings.taxonomy_node_id is
-- the new, richer pointer. Nodes are ADMIN-MANAGED DATA, so the tree can change
-- without shipping an app release — nothing here is hardcoded in the clients.

create type public.compliance_classification as enum (
  'GENERALLY_UNRESTRICTED', 'CONDITIONAL', 'REGULATED', 'PROHIBITED', 'REVIEW_REQUIRED'
);

create table if not exists public.marketplace_taxonomy_nodes (
  id            uuid primary key default gen_random_uuid(),
  -- restrict: a node with children can never be deleted out from under them
  parent_id     uuid references public.marketplace_taxonomy_nodes(id) on delete restrict,
  name          text not null,
  slug          text not null,
  path          text not null unique,    -- 'vegetables/tomatoes/roma'
  depth         int  not null default 0, -- 0 category, 1 subcategory, 2 product type, 3 variety
  display_order int  not null default 0,
  active        boolean not null default true,
  archived_at   timestamptz,
  search_synonyms text[] not null default '{}',
  icon          text,
  -- compliance attributes; the rules themselves live in compliance_rules
  requires_compliance_review boolean not null default false,
  compliance_classification  public.compliance_classification not null default 'GENERALLY_UNRESTRICTED',
  minimum_plan_tier public.market_plan not null default 'free',
  local_pickup_only boolean not null default false,
  shipping_policy   text,
  prohibited        boolean not null default false,
  required_listing_fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parent_id, slug)
);

create index if not exists tax_nodes_parent_idx on public.marketplace_taxonomy_nodes(parent_id);
create index if not exists tax_nodes_active_idx on public.marketplace_taxonomy_nodes(active) where active;
create index if not exists tax_nodes_path_idx   on public.marketplace_taxonomy_nodes(path text_pattern_ops);
create index if not exists tax_nodes_syn_idx    on public.marketplace_taxonomy_nodes using gin(search_synonyms);

alter table public.marketplace_taxonomy_nodes enable row level security;

-- Everyone (incl. anon) may read the live tree; only admins may write.
create policy tax_nodes_select_active on public.marketplace_taxonomy_nodes
  for select to anon, authenticated
  using (active or public.is_admin());
create policy tax_nodes_admin_write on public.marketplace_taxonomy_nodes
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.marketplace_taxonomy_nodes to anon, authenticated;

alter table public.listings
  add column if not exists taxonomy_node_id uuid
  references public.marketplace_taxonomy_nodes(id) on delete restrict;
create index if not exists listings_taxonomy_idx on public.listings(taxonomy_node_id);
-- listings uses COLUMN-LEVEL grants; a new column inherits none.
grant select (taxonomy_node_id) on public.listings to anon, authenticated;

-- Never hard-delete a node that listings point at: archive it instead.
create or replace function public.taxonomy_block_delete_in_use()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.listings l where l.taxonomy_node_id = old.id) then
    raise exception 'TAXONOMY_NODE_IN_USE: archive this node instead of deleting it'
      using errcode = 'P0001';
  end if;
  return old;
end $$;

drop trigger if exists taxonomy_no_delete_in_use on public.marketplace_taxonomy_nodes;
create trigger taxonomy_no_delete_in_use
  before delete on public.marketplace_taxonomy_nodes
  for each row execute function public.taxonomy_block_delete_in_use();

-- Archiving a node deactivates its whole subtree, so children can't outlive it.
create or replace function public.taxonomy_archive_cascade()
returns trigger language plpgsql as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    new.active := false;
    update public.marketplace_taxonomy_nodes
       set archived_at = new.archived_at, active = false
     where path like new.path || '/%' and archived_at is null;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists taxonomy_archive_cascade_trg on public.marketplace_taxonomy_nodes;
create trigger taxonomy_archive_cascade_trg
  before update on public.marketplace_taxonomy_nodes
  for each row execute function public.taxonomy_archive_cascade();
