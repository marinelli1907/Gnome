-- Provider-verified subscription reconciliation is an internal server action.
-- It must be able to update the denormalized Market plan even when the owner
-- has not completed the separate marketplace account-readiness flow.
--
-- The exception is deliberately narrow: the request must carry the
-- service_role JWT, reconcile_market_paid_plan() must set a transaction-local
-- marker, and the update must actually change the plan. All ordinary Market
-- inserts and updates remain subject to the readiness gate.

begin;

create or replace function public.p0_gate_market_account_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.plan is distinct from old.plan
     and (auth.jwt() ->> 'role') = 'service_role'
     and current_setting('app.gnome_subscription_reconcile', true) = 'on' then
    return new;
  end if;

  if public.is_admin() then return new; end if;
  -- handle_new_profile() creates the user's initial Market from the profile
  -- trigger. Policy acceptances cannot exist before that profile because they
  -- reference profiles(id), so allow only this nested bootstrap insert. Direct
  -- Market inserts and every later update still require full readiness.
  if tg_op = 'INSERT' and pg_trigger_depth() > 1
     and exists (select 1 from public.profiles p where p.id = new.owner_id) then
    return new;
  end if;
  perform public.require_account_ready(new.owner_id, 'market');
  return new;
end;
$$;

create or replace function public.reconcile_market_paid_plan(p_market uuid)
returns public.market_plan
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.market_plan;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  select s.plan into v_plan
    from public.market_subscriptions s
   where s.market_id = p_market
     and s.kind = 'plan'
     and s.status in ('active','trialing','grace_period','canceled','cancelled')
     and (s.expires_at is null or s.expires_at > now())
   order by public.plan_rank(s.plan) desc,
            s.expires_at desc nulls first,
            s.updated_at desc
   limit 1;

  v_plan := coalesce(v_plan, 'free'::public.market_plan);

  perform set_config('app.gnome_subscription_reconcile', 'on', true);
  update public.markets
     set plan = v_plan
   where id = p_market
     and plan is distinct from v_plan;
  perform set_config('app.gnome_subscription_reconcile', 'off', true);

  return v_plan;
end;
$$;

revoke execute on function public.reconcile_market_paid_plan(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_market_paid_plan(uuid) to service_role;

do $$
begin
  if coalesce((select payments_live_enabled from public.billing_config where id), false) then
    raise exception 'verified subscription readiness fix refuses to apply while payments_live_enabled=true';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
