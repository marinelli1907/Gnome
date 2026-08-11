-- Gnome — auto-file legacy-category listings into the taxonomy tree.
--
-- The web sell form (and any older client) inserts listings with only the flat
-- legacy `category` and no taxonomy_node_id. The 0041 backfill was a one-time
-- UPDATE, so every listing posted since — and every future one — carried NULL
-- and silently vanished from the new taxonomy-based category filters on web
-- Browse (which drop NULL-node rows) and from alias-aware search.
--
-- Fix at the source of truth: a BEFORE INSERT trigger resolves category →
-- node via the already-shipped legacy_category_map, then a one-time re-run of
-- the backfill catches rows inserted since 0041. Explicit node choices from
-- the app are untouched (trigger only fills when taxonomy_node_id is NULL).

create or replace function public.listings_fill_taxonomy()
returns trigger
language plpgsql
as $$
begin
  if new.taxonomy_node_id is null and new.category is not null then
    select n.id into new.taxonomy_node_id
    from public.legacy_category_map m
    join public.marketplace_taxonomy_nodes n on n.path = m.taxonomy_path
    where m.legacy_category = new.category
      and n.active;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_fill_taxonomy on public.listings;
create trigger listings_fill_taxonomy
  before insert on public.listings
  for each row execute function public.listings_fill_taxonomy();

-- Catch anything inserted between the 0041 backfill and this trigger.
update public.listings l
set taxonomy_node_id = n.id
from public.legacy_category_map m
join public.marketplace_taxonomy_nodes n on n.path = m.taxonomy_path
where l.taxonomy_node_id is null
  and l.category = m.legacy_category
  and n.active;
