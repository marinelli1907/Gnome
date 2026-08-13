drop policy if exists seed_inventory_log_admin_insert on public.seed_inventory_log;
create policy seed_inventory_log_admin_insert on public.seed_inventory_log
  for insert with check (public.is_admin() and actor = auth.uid());