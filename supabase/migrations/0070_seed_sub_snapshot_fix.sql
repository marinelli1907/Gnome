-- Gnome — subscription snapshot fix (found by the Part-36 acceptance run).
--
-- A subscriber with NO seed_profiles row crashed order generation:
-- `select * into prof` with no match leaves a record of NULL fields, and
-- to_jsonb() of that yields {"garden_sizes": null, ...} — a PRESENT null key.
-- generate_seed_drop tolerates a MISSING key (webhook path uses `prof ?? {}`)
-- but not a null one: jsonb_array_elements_text(null-scalar) throws.
-- jsonb_strip_nulls() makes the no-profile snapshot degrade to the same
-- missing-key shape the engine already handles.

create or replace function public.generate_seed_subscription_order(
  p_sub uuid,
  p_paid boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s public.seed_drop_subscriptions;
  prof public.seed_profiles;
  v_order uuid;
  v_reserved int;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select * into s from public.seed_drop_subscriptions where id = p_sub for update;
  if s is null then raise exception 'SUB_NOT_FOUND' using errcode = 'P0001'; end if;
  if s.status not in ('active') and p_paid then
    raise exception 'SUB_NOT_ACTIVE: %', s.status using errcode = 'P0001';
  end if;

  select * into prof from public.seed_profiles where user_id = s.user_id;

  insert into public.seed_orders
    (user_id, product, packet_count, status, profile_snapshot, notes)
  values
    (s.user_id, 'subscription', s.packet_count,
     case when p_paid then 'paid' else 'pending_payment' end,
     coalesce(jsonb_strip_nulls(to_jsonb(prof)), '{}'::jsonb)
       || jsonb_build_object('subscription_id', s.id, 'cadence', s.cadence,
                             'preferences', s.preferences, 'exclusions', s.exclusions,
                             'ship', jsonb_build_object(
                               'name', s.ship_name, 'address', s.ship_address_line,
                               'city', s.ship_city, 'state', s.ship_state,
                               'postal_code', s.ship_postal_code)),
     'subscription ' || s.id)
  returning id into v_order;

  if p_paid then
    select public.generate_seed_drop(v_order) into v_reserved;
    update public.seed_drop_subscriptions
       set next_order_date = coalesce(s.next_order_date, current_date)
             + case when s.cadence = 'monthly' then interval '1 month' else interval '3 months' end,
           updated_at = now()
     where id = p_sub;
  end if;

  return v_order;
end $$;

revoke execute on function public.generate_seed_subscription_order(uuid, boolean) from public, anon, authenticated;
