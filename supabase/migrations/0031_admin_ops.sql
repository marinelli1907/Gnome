-- Admin operations: substitutions (backend-eligible only), order cancellation,
-- customer email lookup. All admin-gated server-side; all audited.

create or replace function public.admin_user_email(p_user uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare e text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select email into e from auth.users where id = p_user;
  return e;
end $$;

-- Eligible replacements for one order item: SAME hard filters as the engine,
-- driven by the order's frozen snapshot, excluding crops already in the box.
create or replace function public.admin_seed_substitutes(p_item uuid)
returns table (
  product_id uuid, crop text, variety text, category text,
  lot_id uuid, internal_lot_number text, germ numeric, why text
)
language plpgsql security definer set search_path = public
as $$
declare
  it record; o record; prof jsonb;
  zone int; month0 int; shift int; sun text; exper text; small boolean;
  prefs text[]; excl text[]; sizes text[]; size text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into it from seed_order_items where id = p_item;
  if not found then raise exception 'item not found'; end if;
  select * into o from seed_orders where id = it.order_id;
  prof  := o.profile_snapshot;
  zone  := coalesce((prof->>'zone')::int, 6);
  sun   := coalesce(prof->>'sun', 'unsure');
  size  := coalesce(prof->>'garden_size', 'unsure');
  exper := coalesce(prof->>'experience', 'beginner');
  prefs := coalesce((select array_agg(lower(x)) from jsonb_array_elements_text(prof->'preferences') x), '{}');
  excl  := coalesce((select array_agg(lower(x)) from jsonb_array_elements_text(prof->'exclusions') x), '{}');
  sizes := coalesce((select array_agg(x) from jsonb_array_elements_text(prof->'garden_sizes') x), array[size]);
  small := coalesce(array_length(sizes,1),0) > 0 and sizes <@ array['windowsill','containers'];
  shift  := case when zone >= 8 then 1 when zone <= 4 then -1 else 0 end;
  month0 := ((extract(month from now())::int - 1 - shift) % 12 + 12) % 12 + 1;

  return query
    with taken as (
      select p.crop from seed_order_items i2
      join seed_products p on p.id = i2.seed_product_id
      where i2.order_id = it.order_id and i2.id <> p_item and i2.status <> 'released'
    ),
    cand as (
      select p.id as pid, p.crop as pcrop, p.variety as pvar, p.category as pcat,
             l.id as lid, l.internal_lot_number as lno,
             coalesce(l.germination_pct, 85) as pgerm,
             row_number() over (partition by p.id order by l.received_date asc) as lot_rank,
             (lower(p.crop) = any(prefs) or lower(p.category) = any(prefs)) as preferred
      from seed_products p
      join seed_lots l on l.seed_product_id = p.id
      where p.active
        and public.seed_lot_eligible(l)
        and p.sow_months @> array[month0]
        and not (lower(p.crop) = any(excl))
        and not (lower(p.category) = any(excl))
        and (sun = 'unsure' or p.preferred_sun = 'any' or p.preferred_sun = sun
             or (sun = 'full' and p.preferred_sun = 'partial'))
        and (not small or p.container_friendly)
        and (exper not in ('first_time') or p.beginner_friendly)
        and p.crop not in (select crop from taken)
        and p.id <> it.seed_product_id
    )
    select pid, pcrop, pvar, pcat, lid, lno, pgerm,
           ('in-season, suits profile, ' || pgerm || '% germ' ||
            case when preferred then ', matches preferences' else '' end)
    from cand where lot_rank = 1
    order by preferred desc, pgerm desc
    limit 10;
end $$;

create or replace function public.admin_substitute_seed_item(
  p_item uuid, p_product uuid, p_reason text
) returns void
language plpgsql security definer set search_path = public
as $$
declare it record; old_product uuid; new_lot uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into it from seed_order_items where id = p_item for update;
  if not found or it.status <> 'reserved' then
    raise exception 'item not substitutable (status %)', coalesce(it.status,'missing');
  end if;
  old_product := it.seed_product_id;

  -- Reserve the oldest eligible lot of the replacement (race-safe).
  select l.id into new_lot
  from seed_lots l
  where l.seed_product_id = p_product and public.seed_lot_eligible(l)
  order by l.received_date asc limit 1;
  if new_lot is null then raise exception 'NO_ELIGIBLE_LOT'; end if;

  update seed_lots set current_qty = current_qty - 1, updated_at = now(),
    status = case when current_qty - 1 <= 0 then 'depleted' else status end
  where id = new_lot and current_qty >= 1;
  if not found then raise exception 'NO_ELIGIBLE_LOT'; end if;

  -- Release the old reservation.
  update seed_lots set current_qty = current_qty + it.qty_packets,
    status = case when status = 'depleted' then 'active' else status end,
    updated_at = now()
  where id = it.lot_id;
  insert into seed_inventory_log (lot_id, delta, reason, order_id, actor)
  values (it.lot_id, it.qty_packets, 'substitution released', it.order_id, auth.uid()),
         (new_lot, -1, 'substitution reserved', it.order_id, auth.uid());

  update seed_order_items
     set seed_product_id = p_product, lot_id = new_lot,
         substituted_from = old_product, substitution_reason = p_reason,
         updated_at = now()
   where id = p_item;

  insert into admin_actions (admin_id, action, target_type, target_id, note)
  values (auth.uid(), 'seed_substituted', 'seed_order_item', p_item, p_reason);
end $$;

create or replace function public.admin_cancel_seed_order(p_order uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare o record;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into o from seed_orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  if o.status in ('shipped','cancelled','refunded') then
    raise exception 'order is % — not cancellable', o.status;
  end if;
  perform public.release_seed_drop_items(p_order, 'order cancelled');
  update seed_orders
     set status = 'cancelled', updated_at = now(),
         notes = coalesce(notes || E'\n', '') || 'CANCELLED: ' || coalesce(p_reason,'(no reason)')
   where id = p_order;
  insert into admin_actions (admin_id, action, target_type, target_id, note)
  values (auth.uid(), 'seed_drop_cancelled', 'seed_order', p_order, p_reason);
end $$;

revoke execute on function public.admin_user_email(uuid) from public, anon;
revoke execute on function public.admin_seed_substitutes(uuid) from public, anon;
revoke execute on function public.admin_substitute_seed_item(uuid, uuid, text) from public, anon;
revoke execute on function public.admin_cancel_seed_order(uuid, text) from public, anon;