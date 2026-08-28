-- Reconcile production drift from the intended 0041 legacy taxonomy map.
-- Production inspection found 16/16 taxonomy paths valid, so the foreign key
-- can be added without deleting or rewriting data.

begin;

alter table public.legacy_category_map enable row level security;

drop policy if exists legacy_map_select on public.legacy_category_map;
create policy legacy_map_select on public.legacy_category_map
  for select to anon, authenticated using (true);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.legacy_category_map'::regclass
      and conname = 'legacy_category_map_taxonomy_path_fkey'
  ) then
    alter table public.legacy_category_map
      add constraint legacy_category_map_taxonomy_path_fkey
      foreign key (taxonomy_path)
      references public.marketplace_taxonomy_nodes(path);
  end if;
end;
$$;

commit;
