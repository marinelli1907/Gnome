-- Gnome — repairs that make the 0106 admin promo surface actually callable.
--
-- Two defects, both found by exercising the RPCs exactly as the admin app calls them, both
-- invisible to review because each looks correct in isolation.
--
-- THE SAME TRAP, THIRD SIGHTING. REVOKE ... FROM PUBLIC strips the default EXECUTE grant that
-- `authenticated` inherits, and 0106 revoked its three admin RPCs from public+anon without
-- re-granting authenticated. Verified on a clean build to 0108:
--
--   admin_promo_campaigns      authenticated can execute = false
--   admin_promo_redemptions    authenticated can execute = false
--   admin_upsert_promo_campaign authenticated can execute = false
--
-- The admin app signs in as an ordinary authenticated user, so every one of them answered 42501 —
-- the promo console was unreachable by the very app it was written for. 0108 hit the identical bug
-- and fixed itself pre-commit; 0106 was already accepted, so this is a follow-up migration rather
-- than an edit to applied-to-nothing-but-accepted history.
--
-- is_admin() INSIDE each function remains the actual gate, exactly as every other admin_* RPC
-- works: a non-admin authenticated caller reaches the function and is refused by it.
--
-- Run after 0108. Idempotent.

-- ---------------------------------------------------------------------------
-- 1. The audit insert used an actor_type the table refuses
-- ---------------------------------------------------------------------------
-- admin_audit_log_actor_type_check allows OWNER / ADMIN / AI_AGENT / SYSTEM — verified against
-- production, uppercase. 0106 wrote 'admin', so EVERY campaign upsert failed at runtime on its
-- own audit trail: the console could never have created or edited a single campaign. Only the
-- audit line changes; everything else is 0106's definition verbatim.
create or replace function public.admin_upsert_promo_campaign(p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_code text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = 'P0001'; end if;
  v_code := upper(btrim(p_payload->>'code'));
  v_id   := nullif(p_payload->>'id','')::uuid;

  insert into public.promotion_campaigns (
    id, code, campaign_name, active, applicable_plans, discount_type,
    discount_percent, discount_amount_cents, duration, duration_in_months,
    starts_at, expires_at, max_redemptions, max_redemptions_per_user,
    new_customers_only, internal_notes, created_by
  ) values (
    coalesce(v_id, gen_random_uuid()), v_code,
    p_payload->>'campaign_name',
    coalesce((p_payload->>'active')::boolean, true),
    coalesce((select array_agg(x::public.market_plan)
                from jsonb_array_elements_text(coalesce(p_payload->'applicable_plans','[]'::jsonb)) x), '{}'),
    p_payload->>'discount_type',
    nullif(p_payload->>'discount_percent','')::numeric,
    nullif(p_payload->>'discount_amount_cents','')::int,
    p_payload->>'duration',
    nullif(p_payload->>'duration_in_months','')::int,
    nullif(p_payload->>'starts_at','')::timestamptz,
    nullif(p_payload->>'expires_at','')::timestamptz,
    nullif(p_payload->>'max_redemptions','')::int,
    coalesce(nullif(p_payload->>'max_redemptions_per_user','')::int, 1),
    coalesce((p_payload->>'new_customers_only')::boolean, false),
    p_payload->>'internal_notes',
    auth.uid()
  )
  on conflict (id) do update set
    code = excluded.code, campaign_name = excluded.campaign_name, active = excluded.active,
    applicable_plans = excluded.applicable_plans, discount_type = excluded.discount_type,
    discount_percent = excluded.discount_percent,
    discount_amount_cents = excluded.discount_amount_cents,
    duration = excluded.duration, duration_in_months = excluded.duration_in_months,
    starts_at = excluded.starts_at, expires_at = excluded.expires_at,
    max_redemptions = excluded.max_redemptions,
    max_redemptions_per_user = excluded.max_redemptions_per_user,
    new_customers_only = excluded.new_customers_only,
    internal_notes = excluded.internal_notes, updated_at = now()
  returning id into v_id;

  insert into public.admin_audit_log (actor_id, actor_type, action, resource_type, resource_id, new_state)
  values (auth.uid(), 'ADMIN', 'promo_campaign_upsert', 'promotion_campaign', v_id::text, p_payload);

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The grants REVOKE FROM PUBLIC silently stripped
-- ---------------------------------------------------------------------------
grant execute on function public.admin_promo_campaigns()            to authenticated;
grant execute on function public.admin_promo_redemptions(uuid)      to authenticated;
grant execute on function public.admin_upsert_promo_campaign(jsonb) to authenticated;

do $$
begin
  -- The three must now be reachable…
  if not has_function_privilege('authenticated', 'public.admin_promo_campaigns()', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_promo_redemptions(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_upsert_promo_campaign(jsonb)', 'execute') then
    raise exception '0109: an admin promo RPC is still not executable by authenticated.';
  end if;
  -- …anon must still be shut out…
  if has_function_privilege('anon', 'public.admin_promo_campaigns()', 'execute')
     or has_function_privilege('anon', 'public.admin_promo_redemptions(uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_upsert_promo_campaign(jsonb)', 'execute') then
    raise exception '0109: anon can execute an admin promo RPC.';
  end if;
  -- …and the deliberate lockdowns nearby must not have loosened. promo_validate stays
  -- unreachable by clients (it is a code-enumeration oracle otherwise), and
  -- market_allowance_usage stays revoked (it takes a market id, so it reads ANY seller).
  if has_function_privilege('authenticated', 'public.promo_validate(text, public.market_plan, uuid)', 'execute') then
    raise exception '0109: promo_validate became client-callable — that is a brute-force oracle.';
  end if;
  if has_function_privilege('authenticated', 'public.market_allowance_usage(uuid)', 'execute') then
    raise exception '0109: market_allowance_usage(uuid) became client-callable again.';
  end if;
end $$;

notify pgrst, 'reload schema';
