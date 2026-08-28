-- Multi-select "Where will these grow?" — a gardener can have containers AND
-- a bed. The engine only applies container-only constraints when EVERY
-- selected space is small.
alter table public.seed_profiles
  add column if not exists garden_sizes text[] not null default '{}';

create or replace function public.generate_seed_drop(p_order uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  o        record;
  prof     jsonb;
  zone     int;
  month0   int;
  shift    int;
  sun      text;
  size     text;
  sizes    text[];
  exper    text;
  prefs    text[];
  excl     text[];
  pick     record;
  reserved int := 0;
  small    boolean;
begin
  select * into o from seed_orders where id = p_order for update;
  if not found then raise exception 'order % not found', p_order; end if;
  if o.status not in ('paid','needs_review') then
    raise exception 'order % is %, not selectable', p_order, o.status;
  end if;

  perform public.release_seed_drop_items(p_order, 'reselect');

  prof  := o.profile_snapshot;
  zone  := coalesce((prof->>'zone')::int, 6);
  sun   := coalesce(prof->>'sun', 'unsure');
  size  := coalesce(prof->>'garden_size', 'unsure');
  exper := coalesce(prof->>'experience', 'beginner');
  prefs := coalesce((select array_agg(lower(x)) from jsonb_array_elements_text(prof->'preferences') x), '{}');
  excl  := coalesce((select array_agg(lower(x)) from jsonb_array_elements_text(prof->'exclusions') x), '{}');

  -- Multi-select spaces (fall back to the legacy single value). Container
  -- constraints apply only when every selected space is windowsill/containers.
  sizes := coalesce(
    (select array_agg(x) from jsonb_array_elements_text(prof->'garden_sizes') x),
    array[size]
  );
  small := coalesce(array_length(sizes, 1), 0) > 0
       and sizes <@ array['windowsill','containers'];

  shift  := case when zone >= 8 then 1 when zone <= 4 then -1 else 0 end;
  month0 := ((extract(month from now())::int - 1 - shift) % 12 + 12) % 12 + 1;

  for pick in
    with candidates as (
      select
        p.id as product_id,
        p.crop, p.category,
        l.id as lot_id,
        l.received_date,
        coalesce(l.germination_pct, 85) as germ,
        row_number() over (partition by p.id order by l.received_date asc) as lot_rank,
        (lower(p.crop) = any(prefs) or lower(p.category) = any(prefs)
          or exists (select 1 from unnest(p.tags) t where lower(t) = any(prefs))) as preferred
      from seed_products p
      join seed_lots l on l.seed_product_id = p.id
      where p.active
        and public.seed_lot_eligible(l)
        and p.sow_months @> array[month0]
        and not (lower(p.crop) = any(excl))
        and not (lower(p.category) = any(excl))
        and (sun = 'unsure' or p.preferred_sun = 'any'
             or p.preferred_sun = sun
             or (sun = 'full' and p.preferred_sun = 'partial'))
        and (not small or p.container_friendly)
        and (exper not in ('first_time') or p.beginner_friendly)
    ),
    best_lot as (
      select * from candidates where lot_rank = 1
    ),
    scored as (
      select *,
        (case when preferred then 3.0 else 0 end)
        + (germ / 100.0)
        + least(2.0, extract(day from now() - received_date::timestamptz) / 180.0)
        as score,
        row_number() over (partition by crop order by
          (case when preferred then 3.0 else 0 end) + (germ / 100.0) desc) as crop_rank
      from best_lot
    )
    select * from scored
    where crop_rank = 1
    order by score desc, crop
    limit o.packet_count
  loop
    update seed_lots
       set current_qty = current_qty - 1, updated_at = now(),
           status = case when current_qty - 1 <= 0 then 'depleted' else status end
     where id = pick.lot_id and current_qty >= 1;
    if found then
      insert into seed_order_items (order_id, seed_product_id, lot_id)
      values (p_order, pick.product_id, pick.lot_id);
      insert into seed_inventory_log (lot_id, delta, reason, order_id)
      values (pick.lot_id, -1, 'reserved', p_order);
      reserved := reserved + 1;
    end if;
  end loop;

  update seed_orders
     set status = case when reserved >= packet_count then 'selected' else 'needs_review' end,
         updated_at = now()
   where id = p_order;

  return reserved;
end;
$$;

revoke execute on function public.generate_seed_drop(uuid) from public, anon, authenticated;
grant execute on function public.generate_seed_drop(uuid) to service_role;