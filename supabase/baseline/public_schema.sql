--
-- PostgreSQL database dump
--

\restrict BeDsL5NweNtYFu2ueoJICDhhkmX2FuyoA1eq6ceN9QtOHUbGngbqK9SRal8EQr1

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: claim_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.claim_status AS ENUM (
    'pending',
    'approved',
    'declined',
    'cancelled',
    'completed',
    'expired'
);


--
-- Name: compliance_classification; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.compliance_classification AS ENUM (
    'GENERALLY_UNRESTRICTED',
    'CONDITIONAL',
    'REGULATED',
    'PROHIBITED',
    'REVIEW_REQUIRED'
);


--
-- Name: credential_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.credential_status AS ENUM (
    'NOT_SUBMITTED',
    'PENDING',
    'APPROVED',
    'DENIED',
    'EXPIRED',
    'RENEWAL_REQUIRED',
    'REVOKED'
);


--
-- Name: listing_fulfillment_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.listing_fulfillment_type AS ENUM (
    'pickup',
    'meetup',
    'delivery'
);


--
-- Name: listing_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.listing_kind AS ENUM (
    'offer',
    'wanted'
);


--
-- Name: listing_payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.listing_payment_status AS ENUM (
    'none',
    'external',
    'pending',
    'paid',
    'refunded',
    'failed'
);


--
-- Name: listing_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.listing_status AS ENUM (
    'active',
    'claimed',
    'completed',
    'expired',
    'removed',
    'paused'
);


--
-- Name: listing_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.listing_type AS ENUM (
    'free',
    'trade',
    'sale',
    'wanted',
    'plot'
);


--
-- Name: market_order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.market_order_status AS ENUM (
    'REQUESTED',
    'CONFIRMED',
    'TIME_PROPOSED',
    'DECLINED',
    'READY',
    'OUT_FOR_DELIVERY',
    'COMPLETED',
    'CANCELLED'
);


--
-- Name: market_plan; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.market_plan AS ENUM (
    'free',
    'grower',
    'farm',
    'sponsor'
);


--
-- Name: market_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.market_status AS ENUM (
    'active',
    'paused',
    'suspended',
    'deleted'
);


--
-- Name: market_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.market_type AS ENUM (
    'neighbor',
    'backyard_grower',
    'farm',
    'farm_stand',
    'nursery',
    'garden_center',
    'sponsor',
    'municipality',
    'nonprofit'
);


--
-- Name: promotion_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.promotion_source AS ENUM (
    'manual',
    'plan_credit',
    'paid',
    'sponsor'
);


--
-- Name: promotion_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.promotion_status AS ENUM (
    'draft',
    'active',
    'expired',
    'cancelled'
);


--
-- Name: user_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_type AS ENUM (
    'neighbor',
    'grower',
    'farm',
    'business',
    'market',
    'municipality'
);


--
-- Name: _release_order_inventory(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._release_order_inventory(p_order uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare it record;
begin
  for it in select i.* from public.market_order_items i
             where i.order_id = p_order and i.reserved and i.listing_id is not null
            loop
    update public.listings
       set inventory_count = coalesce(inventory_count, 0) + it.quantity::int
     where id = it.listing_id and inventory_count is not null;
    update public.market_order_items set reserved = false where id = it.id;
  end loop;
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    role text DEFAULT 'READ_ONLY'::text NOT NULL,
    extra_permissions text[] DEFAULT '{}'::text[] NOT NULL,
    denied_permissions text[] DEFAULT '{}'::text[] NOT NULL,
    invited_name text,
    invited_email text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    suspended_at timestamp with time zone,
    revoked_at timestamp with time zone,
    invite_expires_at timestamp with time zone,
    CONSTRAINT admin_users_identity_chk CHECK (((user_id IS NOT NULL) OR (invited_email IS NOT NULL))),
    CONSTRAINT admin_users_role_check CHECK ((role = ANY (ARRAY['OWNER'::text, 'SUPER_ADMIN'::text, 'OPERATIONS_ADMIN'::text, 'COMPLIANCE_ADMIN'::text, 'INVENTORY_FULFILLMENT'::text, 'SUPPORT_MODERATOR'::text, 'ACCOUNTING_FINANCE'::text, 'MARKETING_GROWTH'::text, 'READ_ONLY'::text]))),
    CONSTRAINT admin_users_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'revoked'::text, 'invited'::text])))
);


--
-- Name: admin_accept_invite(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_accept_invite() RETURNS public.admin_users
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare uid uuid := auth.uid(); v_email text; v_row public.admin_users; v_exp timestamptz;
begin
  if uid is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select lower(email) into v_email from auth.users where id = uid;
  if v_email is null then raise exception 'NO_EMAIL_ON_ACCOUNT' using errcode = 'P0001'; end if;

  select invite_expires_at into v_exp from public.admin_users
   where lower(coalesce(invited_email,'')) = v_email
     and user_id is null and status = 'invited'
   limit 1;
  if v_exp is not null and v_exp <= now() then
    raise exception 'INVITE_EXPIRED: That invitation has expired. Ask an owner to send a new one.'
      using errcode = 'P0001';
  end if;

  update public.admin_users
     set user_id = uid, status = 'active'
   where lower(coalesce(invited_email,'')) = v_email
     and user_id is null and status = 'invited'
     and coalesce(invite_expires_at, 'infinity') > now()
  returning * into v_row;
  if v_row.id is null then raise exception 'NO_PENDING_INVITE' using errcode = 'P0001'; end if;

  perform public.admin_audit('admin.team.accept', 'admin_users', v_row.id::text,
                             null, to_jsonb(v_row), 'invite accepted', 'ADMIN', null);
  return v_row;
end $$;


--
-- Name: admin_adjust_lot(uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_adjust_lot(p_lot uuid, p_delta numeric, p_reason text) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare l public.seed_lots; v_new numeric;
begin
  if not public.admin_has_perm('inventory.adjust') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'REASON_REQUIRED' using errcode='P0001'; end if;
  select * into l from public.seed_lots where id = p_lot for update;
  if l is null then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
  v_new := l.current_qty + p_delta;
  if v_new < 0 then raise exception 'NEGATIVE_STOCK: only % available', l.current_qty using errcode='P0001'; end if;
  update public.seed_lots set current_qty = v_new, updated_at = now() where id = p_lot;
  insert into public.seed_inventory_log (lot_id, delta, reason, actor)
  values (p_lot, p_delta, (case when p_delta >= 0 then 'adjust_up: ' else 'adjust_down: ' end) || p_reason, auth.uid());
  perform public.admin_audit('INVENTORY_ADJUSTED','seed_lot',p_lot::text,
    jsonb_build_object('qty',l.current_qty), jsonb_build_object('qty',v_new), p_reason);
  return v_new;
end $$;


--
-- Name: admin_ai_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_ai_org() RETURNS TABLE(id text, name text, title text, department text, status text, authority_level text, model text, charter text, reports_to text, reports_to_name text, direct_reports integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select a.id, a.name, a.title, a.department, a.status, a.authority_level,
         a.model, a.charter, a.reports_to, m.name,
         (select count(*)::int from public.ai_agents c where c.reports_to = a.id)
    from public.ai_agents a
    left join public.ai_agents m on m.id = a.reports_to
   where public.admin_has_perm('ai.view') or public.admin_is_owner()
   order by case a.department when 'EXEC' then 0 when 'FINANCE' then 1
                              when 'OPERATIONS' then 2 when 'MARKETING' then 3
                              when 'TECHNOLOGY' then 4 else 5 end,
            (a.title is null), a.name;
$$;


--
-- Name: admin_ai_provider_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_ai_provider_stats() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when not public.admin_has_perm('ai.view') then null else
    coalesce((
      select jsonb_object_agg(p, s) from (
        select provider as p, jsonb_build_object(
          'last_success', max(created_at) filter (where success),
          'last_failure', max(created_at) filter (where not success),
          'calls_today', count(*) filter (where created_at >= date_trunc('day', now())),
          'fails_today', count(*) filter (where not success and created_at >= date_trunc('day', now())),
          'est_cents_today', coalesce(sum(estimated_cost_cents) filter (where created_at >= date_trunc('day', now())), 0),
          'actual_cents_today', coalesce(sum(actual_cost_cents) filter (where created_at >= date_trunc('day', now())), 0)
        ) as s
        from public.ai_usage_log where provider is not null
        group by provider) t
    ), '{}'::jsonb)
  end;
$$;


--
-- Name: admin_audit(text, text, text, jsonb, jsonb, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_audit(p_action text, p_resource_type text, p_resource_id text, p_old jsonb DEFAULT NULL::jsonb, p_new jsonb DEFAULT NULL::jsonb, p_reason text DEFAULT NULL::text, p_actor_type text DEFAULT 'ADMIN'::text, p_approval uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  insert into public.admin_audit_log
    (actor_id, actor_type, action, resource_type, resource_id,
     old_state, new_state, reason, approval_request_id)
  values (auth.uid(),
          case when public.admin_is_owner()
                and upper(coalesce(p_actor_type,'ADMIN')) = 'ADMIN'
               then 'OWNER'
               else upper(coalesce(p_actor_type,'ADMIN')) end,
          p_action, p_resource_type, p_resource_id, p_old, p_new, p_reason, p_approval);
$$;


--
-- Name: admin_billing_health(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_billing_health() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when not public.admin_has_perm('subscriptions.view') then null else
  jsonb_build_object(
    'payments_live_enabled', (select payments_live_enabled from public.billing_config where id),
    'stripe_mode', (select stripe_mode from public.billing_config where id),
    'products', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', key, 'description', description, 'unit_amount_cents', unit_amount_cents, 'active', active,
        'test_ready', stripe_price_id_test is not null,
        'live_ready', stripe_price_id_live is not null
      ) order by key), '[]'::jsonb) from public.billing_products),
    'last_event', (select jsonb_build_object('type', type, 'livemode', livemode, 'at', received_at)
       from public.stripe_events order by received_at desc limit 1),
    'last_test_payment', (select jsonb_build_object('type', type, 'amount_cents', amount_cents, 'at', created_at)
       from public.billing_events where livemode is false and amount_cents is not null order by created_at desc limit 1),
    'last_live_payment', (select jsonb_build_object('type', type, 'amount_cents', amount_cents, 'at', created_at)
       from public.billing_events where livemode is true and amount_cents is not null order by created_at desc limit 1),
    'events_test_30d', (select count(*) from public.billing_events where livemode is false and created_at > now() - interval '30 days'),
    'events_live_30d', (select count(*) from public.billing_events where livemode is true and created_at > now() - interval '30 days')
  ) end;
$$;


--
-- Name: compliance_classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_classes (
    compliance_class text NOT NULL,
    label text NOT NULL,
    rule_version integer DEFAULT 1 NOT NULL,
    requires_clearance boolean DEFAULT true NOT NULL,
    customer_message text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_bump_compliance_rule(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_bump_compliance_rule(p_class text, p_reason text) RETURNS public.compliance_classes
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare v_old jsonb; v_row public.compliance_classes;
begin
  if not (public.admin_has_perm('compliance.rules_manage') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.compliance_classes t where t.compliance_class = p_class;
  update public.compliance_classes set rule_version = rule_version + 1, updated_at = now()
   where compliance_class = p_class returning * into v_row;
  perform public.admin_audit('compliance.rule.bump', 'compliance_classes', p_class,
                             v_old, to_jsonb(v_row), p_reason, 'admin', null);
  return v_row;
end $$;


--
-- Name: admin_can_manage_team(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_can_manage_team() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.admin_is_owner() or public.admin_has_perm('admin.manage');
$$;


--
-- Name: admin_cancel_seed_order(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_cancel_seed_order(p_order uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: admin_commercial_overview(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_commercial_overview() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when not public.admin_has_perm('subscriptions.view') then null else
  jsonb_build_object(
    'plan_mix', (select jsonb_object_agg(plan, n) from (
       select ep.plan::text as plan, count(*) n from public.markets m
       cross join lateral public.market_effective_plan(m.id) ep group by 1) t),
    'source_mix', (select jsonb_object_agg(source, n) from (
       select ep.source, count(*) n from public.markets m
       cross join lateral public.market_effective_plan(m.id) ep group by 1) t),
    'mrr_cents', (select coalesce(sum(pl.price_cents), 0) from public.market_subscriptions s
       join public.plan_limits pl on pl.plan = s.plan
       where s.kind = 'plan' and s.status in ('active','trialing') and s.stripe_livemode is true),
    'active_comp_grants', (select count(*) from public.admin_plan_grants
       where status = 'ACTIVE' and (expires_at is null or expires_at > now())),
    'pickup_addons', (select coalesce(sum(extra_pickup_locations), 0) from public.markets),
    'seed_subscribers_active', (select count(*) from public.seed_drop_subscriptions where status = 'active'),
    'seed_revenue_cents_90d', (select coalesce(sum(amount_cents), 0) from public.seed_orders
       where status in ('paid','selected','packed','shipped') and stripe_livemode is true
         and created_at > now() - interval '90 days'),
    'promotions_active', (select count(*) from public.listing_promotions where status = 'active' and ends_at > now()),
    'promotions_30d', (select count(*) from public.listing_promotions where created_at > now() - interval '30 days'),
    'promo_purchases_cents_30d', (select coalesce(sum(bp.unit_amount_cents * c.delta), 0)
       from public.market_promotion_credits c
       cross join lateral (select unit_amount_cents from public.billing_products where key='GNOME_LISTING_PROMOTION') bp
       where c.source in ('PURCHASED_SINGLE','PURCHASED_PACK_3','PURCHASED_PACK_10')
         and c.stripe_livemode is true and c.created_at > now() - interval '30 days'),
    'growers_near_cap', (select count(*) from public.markets m
       cross join lateral public.market_effective_plan(m.id) ep
       where ep.plan = 'grower' and public.market_active_listing_count(m.id) >= 20),
    'test', jsonb_build_object(
      'plan_subs', (select count(*) from public.market_subscriptions where kind='plan' and status in ('active','trialing') and stripe_livemode is false),
      'seed_revenue_cents', (select coalesce(sum(amount_cents),0) from public.seed_orders where stripe_livemode is false),
      'promo_purchases', (select count(*) from public.market_promotion_credits where source like 'PURCHASED%' and stripe_livemode is false))
  ) end;
$$;


--
-- Name: admin_daily_brief(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_daily_brief() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when not public.is_admin() then null else jsonb_build_object(
    'generated_at', now(),
    'users', (select count(*) from public.profiles),
    'active_markets', (select count(*) from public.markets where status = 'active'),
    'live_listings', (select count(*) from public.listings where status = 'active' and expires_at > now()),
    'orders_today', (select count(*) from public.market_orders where created_at >= date_trunc('day', now())),
    'pickups_today', (select count(*) from public.market_orders
      where fulfillment_type = 'pickup' and status in ('CONFIRMED','READY')
        and coalesce(confirmed_start, requested_start)::date = current_date),
    'deliveries_today', (select count(*) from public.market_orders
      where fulfillment_type = 'delivery' and status in ('CONFIRMED','READY','OUT_FOR_DELIVERY')
        and coalesce(confirmed_start, requested_start)::date = current_date),
    'pending_compliance', (select count(*) from public.seller_credentials where status = 'PENDING'),
    'expiring_credentials_30d', (select count(*) from public.seller_credentials
      where status = 'APPROVED' and expiration_date is not null
        and expiration_date < current_date + 30),
    'low_inventory_lots', (select count(*) from public.seed_lots l
      left join public.seed_products p on p.id = l.seed_product_id
      where l.status in ('fresh','active')
        and l.current_qty <= coalesce(p.reorder_threshold, 5)),
    'seed_orders_needing_review', (select count(*) from public.seed_orders where status = 'needs_review'),
    'seed_orders_to_pack', (select count(*) from public.seed_orders where status in ('paid','selected')),
    'open_reports', (select count(*) from public.reports where resolved_at is null),
    'plan_mix', (select jsonb_object_agg(plan, n) from
      (select ep.plan::text as plan, count(*) as n from public.markets m
        cross join lateral public.market_effective_plan(m.id) ep group by 1) t),
    'mrr_cents', (select coalesce(sum(pl.price_cents), 0) from public.market_subscriptions s
      join public.plan_limits pl on pl.plan = s.plan
      where s.kind = 'plan' and s.status in ('active','trialing')),
    'active_comp_grants', (select count(*) from public.admin_plan_grants
      where status = 'ACTIVE' and (expires_at is null or expires_at > now())),
    'comp_expiring_30d', (select count(*) from public.admin_plan_grants
      where status = 'ACTIVE' and expires_at is not null
        and expires_at between now() and now() + interval '30 days'),
    'ai_pending_approvals', (select count(*) from public.ai_action_requests where status = 'PENDING' and expires_at > now()),
    'ai_usage_today_cents', (select coalesce(sum(estimated_cost_cents), 0) from public.ai_usage_log
      where created_at >= date_trunc('day', now())),
    'ai_writes_paused', (select writes_paused from public.ai_settings)
  ) end;
$$;


--
-- Name: admin_daily_brief_service(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_daily_brief_service() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'members', (select count(*) from public.profiles),
    'markets', (select count(*) from public.markets),
    'active_listings', (select count(*) from public.listings where status = 'active'),
    'orders_today', (select count(*) from public.market_orders where created_at >= date_trunc('day', now())),
    'seed_orders_open', (select count(*) from public.seed_orders where status in ('paid','selected','needs_review')),
    'plan_mix', (select coalesce(jsonb_object_agg(plan, n), '{}'::jsonb) from
      (select plan, count(*) as n from public.markets group by plan) t),
    'pending_reports', (select count(*) from public.reports where resolved_at is null)
  );
$$;


--
-- Name: admin_delete_seed_product(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_delete_seed_product(p_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_refs int;
begin
  if not public.admin_has_perm('inventory.delete_unused') and not public.admin_is_owner() then
    raise exception 'NOT_AUTHORIZED' using errcode='P0001';
  end if;
  select (select count(*) from public.seed_lots where seed_product_id = p_id)
       + (select count(*) from public.seed_order_items where seed_product_id = p_id) into v_refs;
  if v_refs > 0 then
    raise exception 'HAS_HISTORY: This item has fulfillment history and can''t be permanently deleted. Archive it instead.' using errcode='P0001';
  end if;
  delete from public.seed_products where id = p_id;
  perform public.admin_audit('INVENTORY_ITEM_DELETED','seed_product',p_id::text,null,null,'unused hard delete');
  return 'deleted';
end $$;


--
-- Name: admin_end_promotion(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_end_promotion(p_promo uuid, p_reason text, p_restore_credit boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare pr public.listing_promotions;
begin
  if not public.admin_has_perm('promotions.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into pr from public.listing_promotions where id = p_promo for update;
  if pr is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  update public.listing_promotions set status = 'cancelled', ends_at = least(ends_at, now())
   where id = p_promo;
  if p_restore_credit then
    if not public.admin_has_perm('promotions.refund_credit') then
      raise exception 'NOT_AUTHORIZED: promotions.refund_credit' using errcode = 'P0001';
    end if;
    insert into public.market_promotion_credits (market_id, delta, reason, source, promotion_id, created_by)
    values (pr.market_id, 1, coalesce(p_reason,'Admin restore'), 'REFUND', p_promo, auth.uid());
  end if;
  perform public.admin_audit('PROMOTION_ENDED', 'listing_promotion', p_promo::text,
    to_jsonb(pr), jsonb_build_object('restored_credit', p_restore_credit), p_reason);
end $$;


--
-- Name: admin_execute_ai_action(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_execute_ai_action(p_request uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  r public.ai_action_requests;
  v_hash text;
  v_result jsonb := '{}';
  v_paused boolean;
begin
  if not public.admin_has_perm('ai.approve_actions') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select writes_paused into v_paused from public.ai_settings limit 1;
  select * into r from public.ai_action_requests where id = p_request for update;
  if r is null then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'APPROVED' then raise exception 'NOT_APPROVED: %', r.status using errcode = 'P0001'; end if;
  if r.expires_at <= now() then
    update public.ai_action_requests set status = 'EXPIRED' where id = p_request;
    raise exception 'REQUEST_EXPIRED' using errcode = 'P0001';
  end if;
  v_hash := encode(extensions.digest(r.requested_action || '|' || r.parameters::text, 'sha256'), 'hex');
  if v_hash <> r.payload_hash then
    update public.ai_action_requests set status = 'FAILED',
      execution_result = jsonb_build_object('error', 'PAYLOAD_HASH_MISMATCH') where id = p_request;
    raise exception 'PAYLOAD_CHANGED_AFTER_APPROVAL' using errcode = 'P0001';
  end if;
  if v_paused and not r.dry_run then
    raise exception 'AI_WRITES_PAUSED' using errcode = 'P0001';
  end if;

  if r.dry_run then
    v_result := jsonb_build_object('dry_run', true, 'would_execute', r.requested_action, 'parameters', r.parameters);
  else
    case r.requested_action
      when 'pause_listing' then
        update public.listings set status = 'paused'
         where id = (r.parameters->>'listing_id')::uuid and status = 'active';
        v_result := jsonb_build_object('paused', found);
      when 'restore_listing' then
        update public.listings set status = 'active'
         where id = (r.parameters->>'listing_id')::uuid and status = 'paused';
        v_result := jsonb_build_object('restored', found);
      when 'adjust_inventory' then
        v_result := jsonb_build_object('new_qty', public.admin_adjust_lot(
          (r.parameters->>'lot_id')::uuid,
          (r.parameters->>'delta')::numeric,
          coalesce(r.parameters->>'reason', 'AI-proposed adjustment (owner approved)')));
      when 'quarantine_lot' then
        perform public.admin_set_lot_status(
          (r.parameters->>'lot_id')::uuid, 'quarantined',
          coalesce(r.parameters->>'reason', 'AI-proposed quarantine (owner approved)'));
        v_result := jsonb_build_object('quarantined', true);
      when 'end_promotion' then
        perform public.admin_end_promotion(
          (r.parameters->>'promotion_id')::uuid,
          coalesce(r.parameters->>'reason', 'AI-proposed (owner approved)'),
          coalesce((r.parameters->>'restore_credit')::boolean, false));
        v_result := jsonb_build_object('ended', true);
      when 'grant_promo_credits' then
        perform public.admin_grant_promo_credits(
          (r.parameters->>'market_id')::uuid,
          (r.parameters->>'qty')::int,
          coalesce(r.parameters->>'reason', 'AI-proposed (owner approved)'));
        v_result := jsonb_build_object('granted', (r.parameters->>'qty')::int);
      when 'grant_comp_plan' then
        v_result := jsonb_build_object('grant_id', public.admin_grant_plan(
          (r.parameters->>'market_id')::uuid,
          (r.parameters->>'plan')::market_plan,
          case when r.parameters->>'days' is null then null
               else now() + ((r.parameters->>'days')::int || ' days')::interval end,
          coalesce(r.parameters->>'reason', 'AI-proposed comp (owner approved)')));
      when 'cancel_seed_order' then
        perform public.admin_cancel_seed_order(
          (r.parameters->>'order_id')::uuid,
          coalesce(r.parameters->>'reason', 'AI-proposed cancellation (owner approved)'));
        v_result := jsonb_build_object('cancelled', true);
      when 'resolve_report' then
        v_result := jsonb_build_object('resolved', public.admin_resolve_report(
          (r.parameters->>'report_id')::uuid,
          coalesce(r.parameters->>'note', 'Resolved via AI proposal (owner approved)')));
      else
        raise exception 'UNSUPPORTED_ACTION: %', r.requested_action using errcode = 'P0001';
    end case;
  end if;

  update public.ai_action_requests
     set status = 'EXECUTED', executed_at = now(), execution_result = v_result
   where id = p_request;
  perform public.admin_audit('AI_ACTION_EXECUTED', coalesce(r.resource_type, 'ai_action'),
    coalesce(r.resource_id, p_request::text), null, v_result, null, 'ADMIN', p_request);
  return v_result;
end $$;


--
-- Name: admin_generate_seed_drop(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_generate_seed_drop(p_order uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return public.generate_seed_drop(p_order);
end $$;


--
-- Name: seller_compliance_clearances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seller_compliance_clearances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    compliance_class text NOT NULL,
    state text NOT NULL,
    rule_version integer NOT NULL,
    credential_id uuid,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    source_listing_id uuid,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text,
    revoked_by uuid,
    revoked_at timestamp with time zone,
    notes text,
    CONSTRAINT seller_compliance_clearances_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REVOKED'::text])))
);


--
-- Name: TABLE seller_compliance_clearances; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.seller_compliance_clearances IS 'A review approves a SELLER for a class in a state under a rule version. Later listings of that class clear automatically until the credential expires, the seller moves state, the class changes, or the rule version is bumped.';


--
-- Name: admin_grant_compliance_clearance(uuid, text, text, text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_grant_compliance_clearance(p_seller uuid, p_class text, p_state text, p_reason text, p_credential uuid DEFAULT NULL::uuid, p_listing uuid DEFAULT NULL::uuid) RETURNS public.seller_compliance_clearances
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare v_row public.seller_compliance_clearances; v_ver int;
begin
  if not (public.admin_has_perm('compliance.rules_manage')
          or public.admin_has_perm('listings.moderate') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select rule_version into v_ver from public.compliance_classes where compliance_class = p_class;
  if v_ver is null then raise exception 'UNKNOWN_CLASS' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason),'') = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if public.normalize_state(p_state) is null then
    raise exception 'UNKNOWN_STATE: %', p_state using errcode = 'P0001';
  end if;

  update public.seller_compliance_clearances
     set status = 'REVOKED', revoked_by = auth.uid(), revoked_at = now(),
         notes = coalesce(notes,'') || ' superseded'
   where seller_id = p_seller and compliance_class = p_class
     and public.normalize_state(state) = public.normalize_state(p_state)
     and status = 'ACTIVE';

  insert into public.seller_compliance_clearances
    (seller_id, compliance_class, state, rule_version, credential_id,
     source_listing_id, granted_by, reason)
  values (p_seller, p_class, public.normalize_state(p_state), v_ver, p_credential,
          p_listing, auth.uid(), p_reason)
  returning * into v_row;

  perform public.admin_audit('compliance.clearance.grant', 'seller_compliance_clearances',
    v_row.id::text, null, to_jsonb(v_row), p_reason, 'admin', null);
  return v_row;
end $$;


--
-- Name: admin_grant_plan(uuid, public.market_plan, timestamp with time zone, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_grant_plan(p_market uuid, p_plan public.market_plan, p_expires timestamp with time zone, p_reason text, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_owner uuid; v_old record; v_new record; v_id uuid;
begin
  if not public.admin_has_perm('subscriptions.grant_complimentary') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_plan not in ('grower','farm') and not public.admin_is_owner() then
    raise exception 'OWNER_ONLY: sponsor grants are owner-level' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from public.markets where id = p_market;
  if v_owner is null then raise exception 'MARKET_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into v_old from public.market_effective_plan(p_market);

  insert into public.admin_plan_grants
    (market_id, user_id, plan, expires_at, reason, internal_note, granted_by)
  values (p_market, v_owner, p_plan, p_expires, btrim(p_reason), p_note, auth.uid())
  returning id into v_id;

  select * into v_new from public.market_effective_plan(p_market);
  perform public.reconcile_pickup_locations(p_market);
  perform public.admin_audit('COMP_GRANTED', 'market', p_market::text,
    jsonb_build_object('effective_plan', v_old.plan, 'source', v_old.source),
    jsonb_build_object('effective_plan', v_new.plan, 'source', v_new.source,
                       'grant_id', v_id, 'plan', p_plan, 'expires_at', p_expires),
    p_reason);
  return v_id;
end $$;


--
-- Name: admin_grant_promo_credits(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_grant_promo_credits(p_market uuid, p_qty integer, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.admin_has_perm('promotions.grant') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty > 100 then raise exception 'BAD_QTY' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  insert into public.market_promotion_credits (market_id, delta, reason, source, created_by)
  values (p_market, p_qty, p_reason, 'ADMIN_COMP', auth.uid());
  perform public.admin_audit('PROMO_CREDITS_GRANTED', 'market', p_market::text,
    null, jsonb_build_object('qty', p_qty), p_reason);
end $$;


--
-- Name: admin_has_perm(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_has_perm(p_perm text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.admin_users a
     where a.user_id = auth.uid()
       and a.status = 'active'
       and (
         (('*' = any(public.admin_role_permissions(a.role)) or '*' = any(a.extra_permissions))
           and not (p_perm = any(a.denied_permissions)))
         or (p_perm = any(public.admin_role_permissions(a.role) || a.extra_permissions)
           and not (p_perm = any(a.denied_permissions)))
       )
  );
$$;


--
-- Name: admin_inventory_summary(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_inventory_summary() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when not public.admin_has_perm('inventory.view') then null
         else public.admin_inventory_summary_service() end;
$$;


--
-- Name: admin_inventory_summary_service(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_inventory_summary_service() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'skus', (select count(*) from public.seed_products where not archived),
    'low_stock_items', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
       select p.crop, p.variety,
              coalesce(sum(l.current_qty) filter (where l.status in ('fresh','active')), 0) as available,
              coalesce(p.reorder_threshold, 5) as threshold
         from public.seed_products p
         left join public.seed_lots l on l.seed_product_id = p.id
        where not p.archived
        group by p.id
       having coalesce(sum(l.current_qty) filter (where l.status in ('fresh','active')), 0)
              <= coalesce(p.reorder_threshold, 5)) t),
    'quarantined', (select count(*) from public.seed_lots where status = 'quarantined'),
    'open_orders', (select count(*) from public.seed_orders where status in ('paid','selected','needs_review','packed'))
  );
$$;


--
-- Name: admin_invite_teammate(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_invite_teammate(p_email text, p_name text DEFAULT NULL::text, p_role text DEFAULT 'SUPPORT_MODERATOR'::text) RETURNS public.admin_users
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare v_email text; v_row public.admin_users;
begin
  if not public.admin_can_manage_team() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;
  if not public.admin_role_is_valid(p_role) then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;
  if p_role = 'OWNER' and not public.admin_is_owner() then
    raise exception 'ONLY_OWNER_CAN_INVITE_OWNER' using errcode = 'P0001';
  end if;

  select * into v_row from public.admin_users
   where lower(coalesce(invited_email,'')) = v_email
     and status <> 'revoked'
     and (status <> 'invited' or coalesce(invite_expires_at, 'infinity') > now())
   limit 1;
  if v_row.id is not null then return v_row; end if;

  update public.admin_users
     set role = p_role,
         invited_name = coalesce(nullif(btrim(coalesce(p_name,'')),''), invited_name),
         invite_expires_at = now() + interval '7 days',
         created_by = auth.uid(), created_at = now()
   where lower(coalesce(invited_email,'')) = v_email
     and status = 'invited' and user_id is null
  returning * into v_row;
  if v_row.id is not null then
    perform public.admin_audit('admin.team.invite', 'admin_users', v_row.id::text,
                               null, to_jsonb(v_row), 'reissued '||v_email, 'ADMIN', null);
    return v_row;
  end if;

  insert into public.admin_users (status, role, invited_name, invited_email,
                                  created_by, invite_expires_at)
  values ('invited', p_role, nullif(btrim(coalesce(p_name,'')),''), v_email,
          auth.uid(), now() + interval '7 days')
  returning * into v_row;
  perform public.admin_audit('admin.team.invite', 'admin_users', v_row.id::text,
                             null, to_jsonb(v_row), 'invited '||v_email, 'ADMIN', null);
  return v_row;
end $_$;


--
-- Name: admin_is_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_is_owner() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.admin_users
                  where user_id = auth.uid() and status = 'active'
                    and role in ('OWNER','SUPER_ADMIN'));
$$;


--
-- Name: admin_list_team(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_team() RETURNS TABLE(id uuid, user_id uuid, name text, email text, role text, status text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select a.id, a.user_id, coalesce(a.invited_name, p.name), a.invited_email, a.role, a.status, a.created_at
    from public.admin_users a
    left join public.profiles p on p.id = a.user_id
   where public.admin_has_perm('admins.view')
   order by a.created_at;
$$;


--
-- Name: admin_listings_search(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_listings_search(p_q text DEFAULT NULL::text, p_status text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when not public.admin_has_perm('listings.view') then null else
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', l.id, 'title', l.title, 'status', l.status, 'listing_type', l.listing_type,
      'category', l.category, 'price_cents', l.price_cents, 'created_at', l.created_at,
      'expires_at', l.expires_at, 'is_featured', l.is_featured,
      'market', (select name from public.markets m where m.id = l.market_id),
      'owner', (select name from public.profiles p where p.id = l.owner_id),
      'open_reports', (select count(*) from public.reports rp
         where rp.target_type = 'listing' and rp.target_id = l.id and rp.resolved_at is null)
    ) order by l.created_at desc)
    from (select * from public.listings
           where (p_q is null or title ilike '%'||p_q||'%')
             and (p_status is null or status::text = p_status)
           order by created_at desc limit 50) l), '[]'::jsonb)
  end;
$$;


--
-- Name: admin_manage_storage(text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_manage_storage(p_name text, p_zone text DEFAULT NULL::text, p_archived boolean DEFAULT NULL::boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_id uuid;
begin
  if not public.admin_has_perm('inventory.edit') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  insert into public.storage_locations (name, zone) values (p_name, p_zone)
  on conflict (name) do update set zone = coalesce(excluded.zone, storage_locations.zone),
    archived = coalesce(p_archived, storage_locations.archived)
  returning id into v_id;
  return v_id;
end $$;


--
-- Name: markets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.markets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text DEFAULT 'My Market'::text NOT NULL,
    slug text,
    description text,
    market_type public.market_type DEFAULT 'neighbor'::public.market_type NOT NULL,
    plan public.market_plan DEFAULT 'free'::public.market_plan NOT NULL,
    status public.market_status DEFAULT 'active'::public.market_status NOT NULL,
    avatar_url text,
    banner_url text,
    city text,
    county text,
    state text,
    zip text,
    lat double precision,
    lng double precision,
    approximate_location text,
    contact_email text,
    contact_phone text,
    website_url text,
    instagram_url text,
    facebook_url text,
    accepts_free boolean DEFAULT true NOT NULL,
    accepts_trade boolean DEFAULT true NOT NULL,
    accepts_sales boolean DEFAULT true NOT NULL,
    pickup_instructions text,
    public_pickup_note text,
    verified boolean DEFAULT false NOT NULL,
    sponsor_visible boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tagline text,
    theme text DEFAULT 'garden'::text NOT NULL,
    extra_pickup_locations integer DEFAULT 0 NOT NULL,
    CONSTRAINT markets_extra_pickup_locations_check CHECK (((extra_pickup_locations >= 0) AND (extra_pickup_locations <= 20))),
    CONSTRAINT markets_tagline_check CHECK (((tagline IS NULL) OR (length(tagline) <= 120))),
    CONSTRAINT markets_theme_check CHECK ((theme = ANY (ARRAY['garden'::text, 'harvest'::text, 'herb'::text, 'farm_stand'::text, 'minimal'::text])))
);


--
-- Name: admin_market(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_market(p_market uuid) RETURNS SETOF public.markets
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select m.* from public.markets m
   where m.id = p_market and public.is_admin();
$$;


--
-- Name: admin_market_entitlements(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_market_entitlements(p_market uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when not public.admin_has_perm('subscriptions.view') then null else
    (select jsonb_build_object(
      'effective', to_jsonb(ep),
      'base_plan', (select plan from public.markets where id = p_market),
      'grants', coalesce((select jsonb_agg(to_jsonb(g) order by g.created_at desc)
                  from public.admin_plan_grants g where g.market_id = p_market), '[]'::jsonb))
      from public.market_effective_plan(p_market) ep)
  end;
$$;


--
-- Name: admin_markets_overview(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_markets_overview() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when not public.admin_has_perm('markets.view') then null else
  coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'owner', (select name from public.profiles p where p.id = m.owner_id),
      'status', m.status, 'plan', ep.plan, 'source', ep.source,
      'active_listings', public.market_active_listing_count(m.id),
      'created_at', m.created_at
    ) order by m.created_at desc)
    from public.markets m cross join lateral public.market_effective_plan(m.id) ep
    limit 100), '[]'::jsonb)
  end;
$$;


--
-- Name: admin_me(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_me() RETURNS TABLE(user_id uuid, role text, status text, permissions text[], is_owner boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select a.user_id, a.role, a.status,
         (select array_agg(distinct p) from unnest(
            public.admin_role_permissions(a.role) || a.extra_permissions) p
           where not (p = any(a.denied_permissions))),
         a.role in ('OWNER','SUPER_ADMIN')
    from public.admin_users a
   where a.user_id = auth.uid() and a.status = 'active';
$$;


--
-- Name: admin_moderation_detail(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_moderation_detail(p_listing uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when not (public.admin_has_perm('listings.moderate') or public.admin_is_owner())
              then null
              else jsonb_build_object(
    'listing', (select jsonb_build_object(
                  'id', l.id, 'title', l.title, 'description', l.description,
                  'status', l.status::text, 'state', l.state, 'city', l.city,
                  'photos', coalesce(to_jsonb(l.photos), '[]'::jsonb),
                  'created_at', l.created_at, 'screening_status', l.screening_status,
                  'screening_category', l.screening_category,
                  'screening_reason', l.screening_reason)
                  from public.listings l where l.id = p_listing),
    'seller',  (select jsonb_build_object(
                  'id', p.id, 'name', p.name, 'suspended', p.suspended, 'state', p.state)
                  from public.listings l join public.profiles p on p.id = l.owner_id
                 where l.id = p_listing),
    'credentials', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', c.id,
                      'credential_type', c.credential_type, 'status', c.status::text,
                      'state', c.state, 'expiration_date', c.expiration_date)
                      order by c.expiration_date desc nulls last), '[]'::jsonb)
                      from public.seller_credentials c
                      join public.listings l on l.owner_id = c.seller_id
                     where l.id = p_listing),
    'clearances', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', k.id, 'compliance_class', k.compliance_class, 'state', k.state,
                      'rule_version', k.rule_version, 'status', k.status,
                      'granted_at', k.granted_at,
                      'credential_expiration', sc.expiration_date)
                      order by k.granted_at desc), '[]'::jsonb)
                      from public.seller_compliance_clearances k
                      join public.listings l on l.owner_id = k.seller_id
                      left join public.seller_credentials sc on sc.id = k.credential_id
                     where l.id = p_listing),
    'class',   (select jsonb_build_object(
                  'compliance_class', cc.compliance_class, 'label', cc.label,
                  'rule_version', cc.rule_version, 'requires_clearance', cc.requires_clearance,
                  'customer_message', cc.customer_message)
                  from public.listings l
                  join public.compliance_classes cc on cc.compliance_class = l.screening_category
                 where l.id = p_listing),
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
                  'action', a.action, 'reason', a.reason,
                  'actor_type', a.actor_type, 'at', a.created_at)
                  order by a.created_at desc), '[]'::jsonb)
                  from public.admin_audit_log a
                 where a.resource_type = 'listings' and a.resource_id = p_listing::text)
  ) end;
$$;


--
-- Name: admin_modify_grant(uuid, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_modify_grant(p_grant uuid, p_expires timestamp with time zone, p_note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare g public.admin_plan_grants;
begin
  if not public.admin_has_perm('subscriptions.modify_complimentary') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into g from public.admin_plan_grants where id = p_grant for update;
  if g is null then raise exception 'GRANT_NOT_FOUND' using errcode = 'P0001'; end if;
  update public.admin_plan_grants
     set expires_at = p_expires, internal_note = coalesce(p_note, internal_note),
         modified_by = auth.uid(), modified_at = now()
   where id = p_grant;
  perform public.reconcile_pickup_locations(g.market_id);
  perform public.admin_audit('COMP_MODIFIED', 'plan_grant', p_grant::text,
    jsonb_build_object('expires_at', g.expires_at),
    jsonb_build_object('expires_at', p_expires), null);
end $$;


--
-- Name: admin_move_lot(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_move_lot(p_lot uuid, p_storage text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare l public.seed_lots;
begin
  if not public.admin_has_perm('inventory.move') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  select * into l from public.seed_lots where id = p_lot for update;
  if l is null then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
  update public.seed_lots set storage_location = p_storage, updated_at = now() where id = p_lot;
  perform public.admin_audit('INVENTORY_MOVED','seed_lot',p_lot::text,
    jsonb_build_object('storage',l.storage_location), jsonb_build_object('storage',p_storage), null);
end $$;


--
-- Name: admin_owner_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_owner_count(p_excluding uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select count(*)::int from public.admin_users
   where role = 'OWNER' and status = 'active'
     and (p_excluding is null or id <> p_excluding);
$$;


--
-- Name: admin_pack_seed_order(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_pack_seed_order(p_order uuid, p_override_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_unpicked int;
begin
  if not public.admin_has_perm('seed_drop.pack') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  select count(*) into v_unpicked from public.seed_order_items
   where order_id = p_order and status = 'reserved';
  if v_unpicked > 0 and p_override_reason is null then
    raise exception 'UNPICKED_ITEMS: % packets not yet picked', v_unpicked using errcode='P0001';
  end if;
  update public.seed_order_items set status = 'packed', updated_at = now()
   where order_id = p_order and status in ('reserved','picked');
  update public.seed_orders set status = 'packed', updated_at = now()
   where id = p_order and status in ('paid','selected','needs_review');
  perform public.admin_audit('SEED_ORDER_PACKED','seed_order',p_order::text,null,null,p_override_reason);
end $$;


--
-- Name: admin_pick_seed_item(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_pick_seed_item(p_item uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare it public.seed_order_items;
begin
  if not public.admin_has_perm('seed_drop.pick') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  select * into it from public.seed_order_items where id = p_item for update;
  if it is null then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
  if it.status <> 'reserved' then raise exception 'BAD_STATE: %', it.status using errcode='P0001'; end if;
  update public.seed_order_items set status = 'picked', updated_at = now() where id = p_item;
end $$;


--
-- Name: admin_pickup_location_overview(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_pickup_location_overview() RETURNS TABLE(market_id uuid, market_name text, plan text, allowance integer, location_id uuid, nickname text, location_type text, city text, state text, has_address boolean, public_address_visible boolean, approx_lat double precision, approx_lng double precision, active boolean, is_default boolean, plan_restricted boolean, schedule_windows integer, orders_total bigint, orders_open bigint, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return query
    select m.id, m.name, m.plan::text,
           coalesce(pl.max_pickup_locations, 1),
           l.id, l.nickname, l.location_type, l.city, l.state,
           (l.address_line is not null),
           l.public_address_visible, l.approx_lat, l.approx_lng,
           l.active, l.is_default, l.plan_restricted,
           (select count(*)::int from public.market_pickup_hours h where h.location_id = l.id),
           (select count(*) from public.market_orders o where o.pickup_location_id = l.id),
           (select count(*) from public.market_orders o
             where o.pickup_location_id = l.id
               and o.status in ('REQUESTED','CONFIRMED','READY','TIME_PROPOSED')),
           l.created_at
      from public.market_pickup_locations l
      join public.markets m on m.id = l.market_id
      left join public.plan_limits pl on pl.plan = m.plan
     order by m.name, l.is_default desc, l.created_at;
end $$;


--
-- Name: admin_receive_lot(uuid, numeric, text, text, text, text, numeric, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_receive_lot(p_product uuid, p_qty numeric, p_internal_lot text, p_supplier text DEFAULT NULL::text, p_supplier_lot text DEFAULT NULL::text, p_storage text DEFAULT NULL::text, p_germination numeric DEFAULT NULL::numeric, p_cost_cents integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_lot uuid;
begin
  if not public.admin_has_perm('inventory.receive') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'BAD_QTY' using errcode='P0001'; end if;
  insert into public.seed_lots (seed_product_id, supplier, supplier_lot_number, internal_lot_number,
    original_qty, current_qty, unit, cost_cents, germination_pct, storage_location, status)
  values (p_product, p_supplier, p_supplier_lot, p_internal_lot, p_qty, p_qty, 'packets',
    p_cost_cents, p_germination, p_storage, 'fresh')
  returning id into v_lot;
  insert into public.seed_inventory_log (lot_id, delta, reason, actor)
  values (v_lot, p_qty, 'received' || coalesce(': '||p_note,''), auth.uid());
  perform public.admin_audit('INVENTORY_RECEIVED','seed_lot',v_lot::text,null,
    jsonb_build_object('qty',p_qty,'storage',p_storage,'lot',p_internal_lot),p_note);
  return v_lot;
end $$;


--
-- Name: admin_release_seed_drop(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_release_seed_drop(p_order uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  perform public.release_seed_drop_items(p_order, 'released');
end $$;


--
-- Name: admin_remove_teammate(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_remove_teammate(p_admin uuid, p_reason text DEFAULT NULL::text) RETURNS public.admin_users
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_old jsonb; v_row public.admin_users;
begin
  if not public.admin_can_manage_team() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.admin_users t where t.id = p_admin;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if (v_old->>'role') = 'OWNER' and (v_old->>'status') = 'active'
     and public.admin_owner_count(p_admin) = 0 then
    raise exception 'LAST_OWNER' using errcode = 'P0001';
  end if;
  update public.admin_users
     set status = 'revoked', revoked_at = now()
   where id = p_admin returning * into v_row;
  perform public.admin_audit('admin.team.remove', 'admin_users', p_admin::text,
                             v_old, to_jsonb(v_row), p_reason, 'admin', null);
  return v_row;
end $$;


--
-- Name: admin_resolve_report(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_resolve_report(p_report uuid, p_note text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare rep public.reports;
begin
  if not public.admin_has_perm('support.resolve') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into rep from public.reports where id = p_report for update;
  if rep is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if rep.resolved_at is not null then return false; end if;
  update public.reports set resolved_at = now(), resolved_by = auth.uid(),
    status = 'resolved', admin_notes = coalesce(p_note, admin_notes)
   where id = p_report;
  perform public.admin_audit('REPORT_RESOLVED', 'report', p_report::text,
    to_jsonb(rep), null, p_note);
  return true;
end $$;


--
-- Name: listings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    category text NOT NULL,
    quantity text,
    weight_estimate text,
    organic_flag boolean DEFAULT false NOT NULL,
    delivery_available boolean DEFAULT false NOT NULL,
    photos text[] DEFAULT '{}'::text[] NOT NULL,
    lat double precision,
    lng double precision,
    city text,
    county text,
    state text,
    zip text,
    status public.listing_status DEFAULT 'active'::public.listing_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    kind public.listing_kind DEFAULT 'offer'::public.listing_kind NOT NULL,
    fulfilled_by_listing_id uuid,
    market_id uuid,
    listing_type public.listing_type DEFAULT 'free'::public.listing_type NOT NULL,
    price_cents integer,
    currency text DEFAULT 'USD'::text,
    trade_for text,
    unit text,
    inventory_count integer,
    allow_partial_claim boolean DEFAULT false NOT NULL,
    fulfillment_type public.listing_fulfillment_type DEFAULT 'pickup'::public.listing_fulfillment_type NOT NULL,
    payment_status public.listing_payment_status DEFAULT 'none'::public.listing_payment_status NOT NULL,
    seller_note text,
    buyer_note_required boolean DEFAULT false NOT NULL,
    is_featured boolean DEFAULT false NOT NULL,
    featured_until timestamp with time zone,
    view_count integer DEFAULT 0 NOT NULL,
    claim_count integer DEFAULT 0 NOT NULL,
    approx_lat double precision GENERATED ALWAYS AS ((round((lat)::numeric, 2))::double precision) STORED,
    approx_lng double precision GENERATED ALWAYS AS ((round((lng)::numeric, 2))::double precision) STORED,
    slug text,
    is_demo boolean DEFAULT false NOT NULL,
    market_position integer,
    market_featured boolean DEFAULT false NOT NULL,
    taxonomy_node_id uuid,
    request_options jsonb,
    allow_custom_request boolean DEFAULT true NOT NULL,
    screening_status text DEFAULT 'CLEAR'::text NOT NULL,
    screening_reason text,
    screening_term text,
    screening_category text,
    screened_at timestamp with time zone,
    CONSTRAINT listings_inventory_chk CHECK (((inventory_count IS NULL) OR (inventory_count >= 0))),
    CONSTRAINT listings_photo_limit CHECK ((COALESCE(array_length(photos, 1), 0) <= 5)),
    CONSTRAINT listings_plot_price_chk CHECK (((listing_type <> 'plot'::public.listing_type) OR ((price_cents IS NOT NULL) AND (price_cents > 0)))),
    CONSTRAINT listings_sale_price_chk CHECK (((listing_type <> 'sale'::public.listing_type) OR ((price_cents IS NOT NULL) AND (price_cents > 0)))),
    CONSTRAINT listings_screening_chk CHECK ((screening_status = ANY (ARRAY['CLEAR'::text, 'REVIEW'::text, 'BLOCKED'::text, 'APPROVED'::text]))),
    CONSTRAINT listings_trade_for_chk CHECK (((listing_type <> 'trade'::public.listing_type) OR ((trade_for IS NOT NULL) AND (length(btrim(trade_for)) > 0))))
);


--
-- Name: admin_resolve_screening(uuid, boolean, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_resolve_screening(p_listing uuid, p_approve boolean, p_reason text DEFAULT NULL::text, p_suspend_seller boolean DEFAULT false) RETURNS public.listings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare v_old jsonb; v_row public.listings; v_owner uuid;
begin
  if not (public.admin_has_perm('listings.moderate') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select to_jsonb(t), t.owner_id into v_old, v_owner from public.listings t where t.id = p_listing;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  update public.listings
     set screening_status = case when p_approve then 'APPROVED' else 'BLOCKED' end,
         status = (case when p_approve then 'active' else 'removed' end)::listing_status,
         screening_reason = null
   where id = p_listing returning * into v_row;

  perform public.admin_audit(
    case when p_approve then 'listing.screening.approve' else 'listing.screening.reject' end,
    'listings', p_listing::text, v_old, to_jsonb(v_row), p_reason, 'ADMIN', null);

  if p_suspend_seller and v_owner is not null then
    perform public.admin_set_suspended(v_owner, true);
  end if;
  return v_row;
end $$;


--
-- Name: admin_review_ai_action(uuid, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_review_ai_action(p_request uuid, p_approve boolean, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r public.ai_action_requests;
begin
  if not public.admin_has_perm('ai.approve_actions') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into r from public.ai_action_requests where id = p_request for update;
  if r is null then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'PENDING' then raise exception 'BAD_STATE: %', r.status using errcode = 'P0001'; end if;
  if r.expires_at <= now() then
    update public.ai_action_requests set status = 'EXPIRED' where id = p_request;
    raise exception 'REQUEST_EXPIRED' using errcode = 'P0001';
  end if;
  if r.risk_level >= 3 and not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  update public.ai_action_requests
     set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_request;
  perform public.admin_audit(case when p_approve then 'AI_ACTION_APPROVED' else 'AI_ACTION_REJECTED' end,
    'ai_action_request', p_request::text, to_jsonb(r), null, p_reason, 'ADMIN', p_request);
end $$;


--
-- Name: seller_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seller_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    market_id uuid,
    country text DEFAULT 'US'::text NOT NULL,
    state text NOT NULL,
    county text,
    city text,
    credential_type text NOT NULL,
    issuing_agency text,
    credential_number text,
    issue_date date,
    expiration_date date,
    document_path text,
    status public.credential_status DEFAULT 'PENDING'::public.credential_status NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    denial_reason text,
    admin_notes text,
    seller_notes text,
    renewal_of_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_review_credential(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_review_credential(p_credential uuid, p_action text, p_reason text DEFAULT NULL::text) RETURNS public.seller_credentials
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  c public.seller_credentials;
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_action not in ('APPROVE','DENY','REQUEST_RESUBMISSION','REVOKE') then
    raise exception 'INVALID_ACTION: %', p_action using errcode = 'P0001';
  end if;
  if p_action in ('DENY','REQUEST_RESUBMISSION','REVOKE')
     and coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: % needs an explanation the seller will see', p_action
      using errcode = 'P0001';
  end if;

  select * into c from public.seller_credentials where id = p_credential for update;
  if c is null then
    raise exception 'CREDENTIAL_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_action = 'APPROVE' then
    if c.expiration_date is not null and c.expiration_date < current_date then
      raise exception 'CANNOT_APPROVE_EXPIRED: expiration date is in the past'
        using errcode = 'P0001';
    end if;
    update public.seller_credentials
       set status = 'APPROVED', reviewed_at = now(), reviewed_by = auth.uid(),
           denial_reason = null, updated_at = now()
     where id = p_credential;
    perform public.compliance_reactivate_for_seller(c.seller_id);
  elsif p_action = 'DENY' then
    update public.seller_credentials
       set status = 'DENIED', reviewed_at = now(), reviewed_by = auth.uid(),
           denial_reason = btrim(p_reason), updated_at = now()
     where id = p_credential;
  elsif p_action = 'REQUEST_RESUBMISSION' then
    update public.seller_credentials
       set status = 'RENEWAL_REQUIRED', reviewed_at = now(), reviewed_by = auth.uid(),
           denial_reason = btrim(p_reason), updated_at = now()
     where id = p_credential;
  else
    update public.seller_credentials
       set status = 'REVOKED', reviewed_at = now(), reviewed_by = auth.uid(),
           denial_reason = btrim(p_reason), updated_at = now()
     where id = p_credential;
    perform public.compliance_run_expiry();
  end if;

  select * into c from public.seller_credentials where id = p_credential;
  return c;
end $$;


--
-- Name: admin_revoke_compliance_clearance(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_revoke_compliance_clearance(p_clearance uuid, p_reason text) RETURNS public.seller_compliance_clearances
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare v_old jsonb; v_row public.seller_compliance_clearances;
begin
  if not (public.admin_has_perm('compliance.rules_manage') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.seller_compliance_clearances t where t.id = p_clearance;
  update public.seller_compliance_clearances
     set status = 'REVOKED', revoked_by = auth.uid(), revoked_at = now(), notes = p_reason
   where id = p_clearance returning * into v_row;
  perform public.admin_audit('compliance.clearance.revoke', 'seller_compliance_clearances',
    p_clearance::text, v_old, to_jsonb(v_row), p_reason, 'admin', null);
  return v_row;
end $$;


--
-- Name: admin_revoke_grant(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_revoke_grant(p_grant uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare g public.admin_plan_grants; v_old record; v_new record;
begin
  if not public.admin_has_perm('subscriptions.revoke_complimentary') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into g from public.admin_plan_grants where id = p_grant for update;
  if g is null then raise exception 'GRANT_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into v_old from public.market_effective_plan(g.market_id);
  update public.admin_plan_grants
     set status = 'REVOKED', revoked_by = auth.uid(), revoked_at = now()
   where id = p_grant;
  select * into v_new from public.market_effective_plan(g.market_id);
  perform public.reconcile_pickup_locations(g.market_id);
  perform public.admin_audit('COMP_REVOKED', 'market', g.market_id::text,
    jsonb_build_object('effective_plan', v_old.plan, 'source', v_old.source),
    jsonb_build_object('effective_plan', v_new.plan, 'source', v_new.source),
    p_reason);
end $$;


--
-- Name: admin_revoke_member(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_revoke_member(p_member uuid, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_old public.admin_users;
begin
  if not public.admin_has_perm('admins.revoke') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into v_old from public.admin_users where id = p_member for update;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_old.role in ('OWNER','SUPER_ADMIN') and not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  if v_old.user_id = auth.uid() and v_old.role = 'OWNER' then
    raise exception 'CANNOT_REVOKE_SELF_OWNER' using errcode = 'P0001';
  end if;
  update public.admin_users set status = 'revoked', revoked_at = now() where id = p_member;
  perform public.admin_audit('ADMIN_MEMBER_REVOKED', 'admin_user', p_member::text,
    to_jsonb(v_old), null, p_reason);
end $$;


--
-- Name: admin_role_is_valid(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_role_is_valid(p_role text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select p_role in ('OWNER','SUPER_ADMIN','OPERATIONS_ADMIN','COMPLIANCE_ADMIN',
                    'INVENTORY_FULFILLMENT','SUPPORT_MODERATOR','ACCOUNTING_FINANCE',
                    'MARKETING_GROWTH','READ_ONLY');
$$;


--
-- Name: admin_role_permissions(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_role_permissions(p_role text) RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$
  select case p_role
    when 'OWNER'        then array['*']
    when 'SUPER_ADMIN'  then array['*']
    when 'OPERATIONS_ADMIN' then array[
      'users.view','markets.view','markets.edit','markets.pause','markets.restore','markets.feature',
      'listings.view','listings.moderate','listings.pause','listings.restore',
      'orders.view','orders.manage','orders.cancel','orders.complete',
      'pickups.view','pickups.manage','delivery.view','delivery.manage',
      'inventory.view','seed_drop.view','plots.view','support.view','taxonomy.view',
      'subscriptions.view','system.view','ai.view','ai.chat',
      'promotions.view','promotions.manage']
    when 'COMPLIANCE_ADMIN' then array[
      'users.view','markets.view','listings.view','listings.moderate','listings.pause','listings.restore',
      'compliance.view','compliance.view_documents','compliance.review','compliance.approve',
      'compliance.deny','compliance.revoke','compliance.rules_manage','taxonomy.view','system.view','ai.view']
    when 'INVENTORY_FULFILLMENT' then array[
      'inventory.view','inventory.create','inventory.edit','inventory.receive','inventory.adjust',
      'inventory.move','inventory.quarantine','inventory.archive','inventory.reconcile',
      'seed_drop.view','seed_drop.generate','seed_drop.pick','seed_drop.pack','seed_drop.ship',
      'seed_drop.fulfill','system.view','ai.view','ai.chat']
    when 'SUPPORT_MODERATOR' then array[
      'users.view','markets.view','listings.view','listings.moderate',
      'support.view','support.respond','support.resolve','orders.view','system.view',
      'promotions.view']
    when 'ACCOUNTING_FINANCE' then array[
      'finance.view_summary','finance.view_transactions','finance.export',
      'subscriptions.view','system.view','promotions.view']
    when 'MARKETING_GROWTH' then array[
      'marketing.view','marketing.draft','users.view','markets.view','listings.view','system.view',
      'promotions.view']
    when 'READ_ONLY' then array[
      'users.view','markets.view','listings.view','orders.view','pickups.view','delivery.view',
      'compliance.view','inventory.view','seed_drop.view','plots.view','support.view',
      'taxonomy.view','subscriptions.view','finance.view_summary','system.view','ai.view',
      'promotions.view']
    else array[]::text[]
  end;
$$;


--
-- Name: admin_screening_counts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_screening_counts() RETURNS TABLE(pending integer, held_today integer, resolved_today integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    case when ok then (select count(*)::int from public.listings
                        where screening_status = 'REVIEW') else 0 end,
    case when ok then (select count(*)::int from public.listings
                        where screening_status = 'REVIEW'
                          and screened_at >= date_trunc('day', now())) else 0 end,
    case when ok then (select count(*)::int from public.admin_audit_log
                        where action in ('listing.screening.approve','listing.screening.reject')
                          and created_at >= date_trunc('day', now())) else 0 end
    from (select (public.admin_has_perm('listings.moderate')
                  or public.admin_is_owner()) as ok) g;
$$;


--
-- Name: admin_screening_history(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_screening_history(p_listing uuid) RETURNS TABLE(action text, reason text, actor_id uuid, actor_type text, at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select a.action, a.reason, a.actor_id, a.actor_type, a.created_at
    from public.admin_audit_log a
   where a.resource_type = 'listings' and a.resource_id = p_listing::text
     and (public.admin_has_perm('listings.moderate') or public.admin_is_owner())
   order by a.created_at desc;
$$;


--
-- Name: admin_screening_queue(text, text, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_screening_queue(p_class text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_seller uuid DEFAULT NULL::uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(listing_id uuid, title text, description text, listing_status text, seller_id uuid, seller_name text, seller_suspended boolean, matched_term text, matched_category text, reason text, city text, state text, created_at timestamp with time zone, screened_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select l.id, l.title, l.description, l.status::text,
         l.owner_id, p.name, p.suspended,
         null::text,
         l.screening_category, l.screening_reason,
         l.city, l.state, l.created_at, l.screened_at
    from public.listings l
    left join public.profiles p on p.id = l.owner_id
   where l.screening_status = 'REVIEW'
     and (public.admin_has_perm('listings.moderate') or public.admin_is_owner())
     and (p_class  is null or l.screening_category = p_class)
     and (p_state  is null or public.normalize_state(l.state) = public.normalize_state(p_state))
     and (p_seller is null or l.owner_id = p_seller)
     and (p_since  is null or l.created_at >= p_since)
   order by l.created_at;
$$;


--
-- Name: admin_screening_settings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_screening_settings() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when not (public.admin_has_perm('listings.moderate')
                     or public.admin_has_perm('compliance.rules_manage')
                     or public.admin_is_owner())
              then null
              else jsonb_build_object(
    'screening_enabled',     (select screening_enabled     from public.content_screening_config),
    'max_listings_per_hour', (select max_listings_per_hour from public.content_screening_config),
    'disabled_reason',       (select disabled_reason       from public.content_screening_config),
    'updated_at',            (select updated_at            from public.content_screening_config),
    'can_toggle',            public.admin_is_owner(),
    'classes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'compliance_class', c.compliance_class, 'label', c.label,
                  'rule_version', c.rule_version, 'active', c.active,
                  'requires_clearance', c.requires_clearance)
                  order by c.label), '[]'::jsonb)
                  from public.compliance_classes c)
  ) end;
$$;


--
-- Name: admin_seed_economics(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_seed_economics(p_window uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when not public.admin_has_perm('finance.view_summary')
                and not public.admin_has_perm('seed_drop.view') then null else
  (with orders as (
    select o.*,
      (select coalesce(sum((l.cost_cents::numeric / nullif(l.original_qty,0)) * i.qty_packets), 0)::int
         from public.seed_order_items i join public.seed_lots l on l.id = i.lot_id
        where i.order_id = o.id and i.status <> 'released') as packet_cogs_cents
    from public.seed_orders o
    where (p_window is null or o.season_window_id = p_window)
      and o.status in ('paid','selected','needs_review','packed','shipped'))
  select jsonb_build_object(
    'orders', count(*),
    'shipped', count(*) filter (where status = 'shipped'),
    'revenue_cents', coalesce(sum(amount_cents), 0),
    'packet_cogs_cents', coalesce(sum(packet_cogs_cents), 0),
    'postage_cents', sum(postage_cents),
    'packaging_cents', sum(packaging_cents),
    'insert_cents', sum(insert_cents),
    'payment_fee_cents', sum(payment_fee_cents),
    'other_cost_cents', sum(other_cost_cents),
    'gross_profit_cents', coalesce(sum(amount_cents), 0) - coalesce(sum(packet_cogs_cents), 0)
      - coalesce(sum(postage_cents), 0) - coalesce(sum(packaging_cents), 0)
      - coalesce(sum(insert_cents), 0) - coalesce(sum(payment_fee_cents), 0)
      - coalesce(sum(other_cost_cents), 0),
    'costs_recorded_orders', count(*) filter (where postage_cents is not null)
  ) from orders) end;
$$;


--
-- Name: admin_seed_queue(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_seed_queue() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when not public.admin_has_perm('seed_drop.view') then null else
    (select coalesce(jsonb_agg(t order by t->>'created_at'), '[]'::jsonb) from (
      select to_jsonb(o) || jsonb_build_object(
        'customer', (select name from public.profiles where id = o.user_id),
        'ship', o.profile_snapshot->'ship',
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
            'id', i.id, 'status', i.status, 'qty', i.qty_packets,
            'crop', pr.crop, 'variety', pr.variety,
            'lot', l.internal_lot_number, 'bin', l.storage_location, 'lot_status', l.status)), '[]'::jsonb)
          from public.seed_order_items i
          join public.seed_lots l on l.id = i.lot_id
          join public.seed_products pr on pr.id = i.seed_product_id
          where i.order_id = o.id)) as t
      from public.seed_orders o
      where o.status in ('paid','selected','needs_review','packed','shipped')
      order by o.created_at desc limit 60) q)
  end;
$$;


--
-- Name: admin_seed_substitutes(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_seed_substitutes(p_item uuid) RETURNS TABLE(product_id uuid, crop text, variety text, category text, lot_id uuid, internal_lot_number text, germ numeric, why text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: admin_seed_wave_generate(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_seed_wave_generate(p_window uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare w public.seed_season_windows; s record; v_order uuid;
        v_created int := 0; v_skipped int := 0; v_errors jsonb := '[]'::jsonb;
begin
  if not public.admin_has_perm('seed_drop.generate') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into w from public.seed_season_windows where id = p_window for update;
  if w is null then raise exception 'WINDOW_NOT_FOUND' using errcode = 'P0001'; end if;
  for s in
    select sub.* from public.seed_drop_subscriptions sub
    where sub.status = 'active'
      and coalesce((sub.profile_snapshot->>'zone')::int,
           (select zone from public.seed_profiles sp where sp.user_id = sub.user_id), 6)
          between w.zone_min and w.zone_max
      and sub.created_at::date <= w.join_cutoff
      and not exists (select 1 from public.seed_sub_season_skips k
                       where k.subscription_id = sub.id and k.window_id = w.id)
      and not exists (select 1 from public.seed_orders o
                       where o.season_window_id = w.id and o.user_id = sub.user_id
                         and o.status not in ('cancelled','refunded'))
  loop
    begin
      v_order := public.generate_seed_subscription_order(s.id, false);
      update public.seed_orders
         set season_window_id = w.id, amount_cents = s.price_cents
       where id = v_order;
      v_created := v_created + 1;
    exception when others then
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_object('sub', s.id, 'err', sqlerrm);
    end;
  end loop;
  perform public.admin_audit('SEED_WAVE_GENERATED', 'seed_season_window', p_window::text,
    null, jsonb_build_object('created', v_created, 'skipped', v_skipped), null);
  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'errors', v_errors);
end $$;


--
-- Name: admin_seed_wave_preview(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_seed_wave_preview(p_window uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when not public.admin_has_perm('seed_drop.view') then null else
  jsonb_build_object(
    'window', (select to_jsonb(w) from public.seed_season_windows w where w.id = p_window),
    'eligible_subscribers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'subscription_id', s.id, 'user', (select name from public.profiles where id = s.user_id),
        'zone', coalesce((s.profile_snapshot->>'zone')::int, 6),
        'packet_count', s.packet_count, 'joined', s.created_at::date,
        'joined_before_cutoff', s.created_at::date <= w.join_cutoff)), '[]'::jsonb)
      from public.seed_drop_subscriptions s
      join public.seed_season_windows w on w.id = p_window
      where s.status = 'active'
        and coalesce((s.profile_snapshot->>'zone')::int,
             (select zone from public.seed_profiles sp where sp.user_id = s.user_id), 6)
            between w.zone_min and w.zone_max
        and s.created_at::date <= w.join_cutoff
        and not exists (select 1 from public.seed_sub_season_skips k
                         where k.subscription_id = s.id and k.window_id = w.id)
        and not exists (select 1 from public.seed_orders o
                         where o.season_window_id = w.id and o.user_id = s.user_id
                           and o.status not in ('cancelled','refunded'))),
    'demand_forecast', (
      select jsonb_build_object(
        'eligible_count', count(*),
        'packets_expected_min', (sum(s.packet_count) * 0.75)::int,
        'packets_expected_max', (sum(s.packet_count) * 1.10)::int,
        'packets_available_total', (select coalesce(sum(l.current_qty),0)::int
           from public.seed_lots l where l.status in ('fresh','active'))
      )
      from public.seed_drop_subscriptions s
      join public.seed_season_windows w on w.id = p_window
      where s.status = 'active'
        and coalesce((s.profile_snapshot->>'zone')::int,
             (select zone from public.seed_profiles sp where sp.user_id = s.user_id), 6)
            between w.zone_min and w.zone_max
        and s.created_at::date <= w.join_cutoff
        and not exists (select 1 from public.seed_sub_season_skips k
                         where k.subscription_id = s.id and k.window_id = w.id))
  ) end;
$$;


--
-- Name: admin_set_agent(text, text, integer, text, text, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_agent(p_agent text, p_status text DEFAULT NULL::text, p_automation integer DEFAULT NULL::integer, p_provider text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_budget integer DEFAULT NULL::integer, p_fallback_provider text DEFAULT NULL::text, p_fallback_model text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare old_row public.ai_agents;
begin
  if not public.admin_has_perm('ai.manage_agents') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if (p_automation is not null and p_automation >= 3) and not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  if p_provider is not null and p_provider not in ('gemini','openai','anthropic') then
    raise exception 'BAD_PROVIDER: %', p_provider using errcode = 'P0001';
  end if;
  if p_fallback_provider is not null and p_fallback_provider not in ('gemini','openai','anthropic','none') then
    raise exception 'BAD_PROVIDER: %', p_fallback_provider using errcode = 'P0001';
  end if;
  select * into old_row from public.ai_agents where id = p_agent for update;
  if old_row is null then raise exception 'AGENT_NOT_FOUND' using errcode = 'P0001'; end if;
  update public.ai_agents set
    status = coalesce(p_status, status),
    automation_level = coalesce(p_automation, automation_level),
    provider = coalesce(p_provider, provider),
    model = coalesce(p_model, model),
    daily_budget_cents = coalesce(p_budget, daily_budget_cents),
    fallback_provider = case when p_fallback_provider = 'none' then null
                             else coalesce(p_fallback_provider, fallback_provider) end,
    fallback_model = case when p_fallback_provider = 'none' then null
                          else coalesce(p_fallback_model, fallback_model) end,
    updated_at = now()
  where id = p_agent;
  perform public.admin_audit('AI_AGENT_UPDATED', 'ai_agent', p_agent,
    to_jsonb(old_row), (select to_jsonb(a) from public.ai_agents a where a.id = p_agent), null);
end $$;


--
-- Name: ai_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_agents (
    id text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'disabled'::text NOT NULL,
    provider text DEFAULT 'anthropic'::text NOT NULL,
    model text DEFAULT 'claude-sonnet-5'::text NOT NULL,
    fallback_provider text,
    fallback_model text,
    automation_level integer DEFAULT 1 NOT NULL,
    permissions text[] DEFAULT '{}'::text[] NOT NULL,
    daily_budget_cents integer DEFAULT 200 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    title text,
    department text DEFAULT 'GENERAL'::text NOT NULL,
    reports_to text,
    authority_level text DEFAULT 'RECOMMEND'::text NOT NULL,
    charter text,
    CONSTRAINT ai_agents_authority_chk CHECK ((authority_level = ANY (ARRAY['RECOMMEND'::text, 'PROPOSE'::text, 'DELEGATED'::text]))),
    CONSTRAINT ai_agents_automation_level_check CHECK (((automation_level >= 1) AND (automation_level <= 3))),
    CONSTRAINT ai_agents_department_chk CHECK ((department = ANY (ARRAY['EXEC'::text, 'FINANCE'::text, 'OPERATIONS'::text, 'MARKETING'::text, 'TECHNOLOGY'::text, 'GENERAL'::text]))),
    CONSTRAINT ai_agents_status_check CHECK ((status = ANY (ARRAY['enabled'::text, 'read_only'::text, 'disabled'::text])))
);


--
-- Name: admin_set_agent_authority(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_agent_authority(p_agent text, p_level text, p_reason text DEFAULT NULL::text) RETURNS public.ai_agents
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_old jsonb; v_row public.ai_agents;
begin
  if not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  if p_level not in ('RECOMMEND','PROPOSE','DELEGATED') then
    raise exception 'INVALID_AUTHORITY' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.ai_agents t where t.id = p_agent;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  update public.ai_agents set authority_level = p_level, updated_at = now()
   where id = p_agent returning * into v_row;
  perform public.admin_audit('ai.agent.authority', 'ai_agents', p_agent::text,
                             v_old, to_jsonb(v_row), p_reason, 'admin', null);
  return v_row;
end $$;


--
-- Name: admin_set_ai_paused(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_ai_paused(p_paused boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.admin_has_perm('ai.pause_actions') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  update public.ai_settings set writes_paused = p_paused, updated_by = auth.uid(), updated_at = now()
   where id = true;
  perform public.admin_audit(case when p_paused then 'AI_WRITES_PAUSED' else 'AI_WRITES_RESUMED' end,
    'ai_settings', 'singleton', null, jsonb_build_object('writes_paused', p_paused), null);
end $$;


--
-- Name: admin_set_ai_reads(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_ai_reads(p_enabled boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_old boolean;
begin
  if not public.admin_has_perm('ai.kill_switch') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select reads_enabled into v_old from public.ai_settings where id = true;
  update public.ai_settings
     set reads_enabled = p_enabled, updated_by = auth.uid(), updated_at = now()
   where id = true;
  perform public.admin_audit(
    case when p_enabled then 'AI_READS_RESUMED' else 'AI_READS_PAUSED' end,
    'ai_settings', 'singleton',
    jsonb_build_object('reads_enabled', v_old),
    jsonb_build_object('reads_enabled', p_enabled), null);
end $$;


--
-- Name: admin_set_listing_status(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_listing_status(p_listing uuid, p_status text, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare l public.listings;
begin
  if p_status = 'paused' and not public.admin_has_perm('listings.pause') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_status = 'active' and not public.admin_has_perm('listings.restore') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_status not in ('paused','active') then raise exception 'BAD_STATUS' using errcode = 'P0001'; end if;
  select * into l from public.listings where id = p_listing for update;
  if l is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  update public.listings set status = p_status::listing_status where id = p_listing;
  perform public.admin_audit(case when p_status='paused' then 'LISTING_PAUSED' else 'LISTING_RESTORED' end,
    'listing', p_listing::text, jsonb_build_object('status', l.status),
    jsonb_build_object('status', p_status), p_reason);
end $$;


--
-- Name: admin_set_lot_status(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_lot_status(p_lot uuid, p_status text, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare l public.seed_lots;
begin
  if not public.admin_has_perm('inventory.quarantine') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  if p_status not in ('fresh','active','aging','needs_test','quarantined','failed','depleted','discarded') then
    raise exception 'BAD_STATUS' using errcode='P0001';
  end if;
  select * into l from public.seed_lots where id = p_lot for update;
  if l is null then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
  update public.seed_lots set status = p_status, updated_at = now() where id = p_lot;
  insert into public.seed_inventory_log (lot_id, delta, reason, actor)
  values (p_lot, 0, 'status: ' || l.status || ' → ' || p_status || coalesce(' ('||p_reason||')',''), auth.uid());
  perform public.admin_audit('INVENTORY_STATUS','seed_lot',p_lot::text,
    jsonb_build_object('status',l.status), jsonb_build_object('status',p_status), p_reason);
end $$;


--
-- Name: admin_set_paid_fallback(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_paid_fallback(p_allow boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.admin_has_perm('ai.pause_actions') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  update public.ai_settings set allow_paid_fallback = p_allow,
    updated_by = auth.uid(), updated_at = now() where id = true;
  perform public.admin_audit(
    case when p_allow then 'AI_PAID_FALLBACK_ENABLED' else 'AI_PAID_FALLBACK_DISABLED' end,
    'ai_settings', 'singleton', null, jsonb_build_object('allow_paid_fallback', p_allow), null);
end $$;


--
-- Name: admin_set_payments_live(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_payments_live(p_enabled boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  update public.billing_config
     set payments_live_enabled = p_enabled,
         stripe_mode = case when p_enabled then 'live' else 'test' end,
         updated_by = auth.uid(), updated_at = now()
   where id = true;
  perform public.admin_audit(
    case when p_enabled then 'PAYMENTS_LIVE_ENABLED' else 'PAYMENTS_LIVE_DISABLED' end,
    'billing_config', 'singleton', null,
    jsonb_build_object('payments_live_enabled', p_enabled), null);
end $$;


--
-- Name: content_screening_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_screening_config (
    id boolean DEFAULT true NOT NULL,
    screening_enabled boolean DEFAULT true NOT NULL,
    max_listings_per_hour integer DEFAULT 20,
    disabled_reason text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_screening_config_id_check CHECK (id),
    CONSTRAINT content_screening_config_max_listings_per_hour_check CHECK (((max_listings_per_hour IS NULL) OR (max_listings_per_hour > 0)))
);


--
-- Name: admin_set_screening_config(boolean, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_screening_config(p_enabled boolean DEFAULT NULL::boolean, p_max_per_hour integer DEFAULT NULL::integer, p_reason text DEFAULT NULL::text) RETURNS public.content_screening_config
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare v_old jsonb; v_row public.content_screening_config;
begin
  if not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.content_screening_config t where t.id;
  update public.content_screening_config
     set screening_enabled = coalesce(p_enabled, screening_enabled),
         max_listings_per_hour = coalesce(p_max_per_hour, max_listings_per_hour),
         disabled_reason = case when p_enabled is false then p_reason else null end,
         updated_by = auth.uid(), updated_at = now()
   where id returning * into v_row;
  perform public.admin_audit('compliance.screening.config', 'content_screening_config',
                             'singleton', v_old, to_jsonb(v_row), p_reason, 'admin', null);
  return v_row;
end $$;


--
-- Name: admin_set_seed_order_costs(uuid, integer, integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_seed_order_costs(p_order uuid, p_postage integer DEFAULT NULL::integer, p_packaging integer DEFAULT NULL::integer, p_insert integer DEFAULT NULL::integer, p_payment_fee integer DEFAULT NULL::integer, p_other integer DEFAULT NULL::integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.admin_has_perm('seed_drop.ship') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  update public.seed_orders set
    postage_cents = coalesce(p_postage, postage_cents),
    packaging_cents = coalesce(p_packaging, packaging_cents),
    insert_cents = coalesce(p_insert, insert_cents),
    payment_fee_cents = coalesce(p_payment_fee, payment_fee_cents),
    other_cost_cents = coalesce(p_other, other_cost_cents),
    updated_at = now()
  where id = p_order;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
end $$;


--
-- Name: admin_set_suspended(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_suspended(p_user uuid, p_suspended boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_old boolean;
begin
  if not public.admin_has_perm('users.suspend') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select suspended into v_old from public.profiles where id = p_user;
  if not found then raise exception 'USER_NOT_FOUND' using errcode = 'P0001'; end if;
  update public.profiles set suspended = p_suspended where id = p_user;
  perform public.admin_audit(
    case when p_suspended then 'USER_SUSPENDED' else 'USER_UNSUSPENDED' end,
    'profile', p_user::text,
    jsonb_build_object('suspended', v_old),
    jsonb_build_object('suspended', p_suspended), null);
end $$;


--
-- Name: admin_set_teammate_role(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_teammate_role(p_admin uuid, p_role text, p_reason text DEFAULT NULL::text) RETURNS public.admin_users
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_old jsonb; v_row public.admin_users;
begin
  if not public.admin_can_manage_team() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if not public.admin_role_is_valid(p_role) then
    raise exception 'INVALID_ROLE' using errcode = 'P0001';
  end if;
  if p_role = 'OWNER' and not public.admin_is_owner() then
    raise exception 'ONLY_OWNER_CAN_PROMOTE_OWNER' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.admin_users t where t.id = p_admin;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if (v_old->>'role') = 'OWNER' and p_role <> 'OWNER'
     and public.admin_owner_count(p_admin) = 0 then
    raise exception 'LAST_OWNER' using errcode = 'P0001';
  end if;
  update public.admin_users set role = p_role where id = p_admin returning * into v_row;
  perform public.admin_audit('admin.team.role', 'admin_users', p_admin::text,
                             v_old, to_jsonb(v_row), p_reason, 'admin', null);
  return v_row;
end $$;


--
-- Name: admin_ship_seed_order(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_ship_seed_order(p_order uuid, p_carrier text, p_tracking text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare o public.seed_orders;
begin
  if not public.admin_has_perm('seed_drop.ship') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
  select * into o from public.seed_orders where id = p_order for update;
  if o is null then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
  if o.status <> 'packed' then raise exception 'BAD_STATE: % (pack first; already-shipped orders cannot ship twice)', o.status using errcode='P0001'; end if;
  update public.seed_orders set status = 'shipped',
    tracking = coalesce(p_carrier || ' ', '') || coalesce(p_tracking, ''), updated_at = now()
   where id = p_order;
  update public.seed_order_items set status = 'shipped', updated_at = now()
   where order_id = p_order and status = 'packed';
  insert into public.seed_inventory_log (lot_id, delta, reason, order_id, actor)
  select lot_id, 0, 'shipped (reservation consumed)', p_order, auth.uid()
    from public.seed_order_items where order_id = p_order;
  perform public.admin_audit('SEED_ORDER_SHIPPED','seed_order',p_order::text,null,
    jsonb_build_object('carrier',p_carrier,'tracking',p_tracking),null);
end $$;


--
-- Name: admin_substitute_seed_item(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_substitute_seed_item(p_item uuid, p_product uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: admin_team_audit(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_team_audit(p_limit integer DEFAULT 50) RETURNS TABLE(action text, reason text, actor_type text, at timestamp with time zone, target text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select l.action, l.reason, l.actor_type, l.created_at,
         coalesce(t.invited_name, t.invited_email, l.resource_id)
    from public.admin_audit_log l
    left join public.admin_users t
           on l.resource_type = 'admin_users' and t.id::text = l.resource_id
   where l.action like 'admin.team.%'
     and (public.admin_can_manage_team() or public.admin_is_owner())
   order by l.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;


--
-- Name: admin_team_roles(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_team_roles() RETURNS TABLE(role text, label text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select r.role, r.label
    from (values
      ('OWNER','Owner — full control, including billing and AI authority'),
      ('SUPER_ADMIN','Super admin — everything except owner-only controls'),
      ('OPERATIONS_ADMIN','Operations — fulfillment, inventory, logistics'),
      ('COMPLIANCE_ADMIN','Compliance — credentials, clearances, screening rules'),
      ('INVENTORY_FULFILLMENT','Inventory & fulfillment'),
      ('SUPPORT_MODERATOR','Support & moderation — listing review, user reports'),
      ('ACCOUNTING_FINANCE','Accounting & finance'),
      ('MARKETING_GROWTH','Marketing & growth'),
      ('READ_ONLY','Read only')
    ) as r(role, label)
   where public.admin_can_manage_team() or public.admin_is_owner();
$$;


--
-- Name: admin_team_roster(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_team_roster() RETURNS TABLE(id uuid, user_id uuid, display_name text, email text, role text, status text, invite_state text, created_at timestamp with time zone, invite_expires_at timestamp with time zone, revoked_at timestamp with time zone, is_last_owner boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select a.id, a.user_id,
         coalesce(p.name, a.invited_name, split_part(coalesce(a.invited_email,''),'@',1)),
         coalesce(u.email, a.invited_email),
         a.role, a.status,
         case
           when a.status = 'revoked' then 'revoked'
           when a.status = 'invited' and coalesce(a.invite_expires_at,'infinity') <= now() then 'expired'
           when a.status = 'invited' then 'pending'
           else 'active'
         end,
         a.created_at, a.invite_expires_at, a.revoked_at,
         (a.role = 'OWNER' and a.status = 'active' and public.admin_owner_count(a.id) = 0)
    from public.admin_users a
    left join public.profiles p on p.id = a.user_id
    left join auth.users   u on u.id = a.user_id
   where public.admin_can_manage_team() or public.admin_is_owner()
   order by (a.status = 'active') desc, a.role = 'OWNER' desc, a.created_at;
$$;


--
-- Name: admin_upsert_member(text, text, text, text[], text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_upsert_member(p_email text, p_name text, p_role text, p_extra text[] DEFAULT '{}'::text[], p_denied text[] DEFAULT '{}'::text[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_uid uuid; v_id uuid; v_old public.admin_users;
begin
  if not public.admin_has_perm('admins.invite') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_role in ('OWNER','SUPER_ADMIN') and not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  if not public.admin_is_owner() and exists (
    select 1 from unnest(p_extra) x where x = '*' or x like 'admins.%' or x like 'system.%'
  ) then
    raise exception 'OWNER_ONLY: wildcard/admin-team/system permissions' using errcode = 'P0001';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then
    raise exception 'USER_NOT_FOUND: they must sign up for Gnome first' using errcode = 'P0001';
  end if;
  select * into v_old from public.admin_users where user_id = v_uid;
  if v_old is not null and v_old.role in ('OWNER','SUPER_ADMIN') and not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  insert into public.admin_users (user_id, role, status, extra_permissions, denied_permissions, invited_name, invited_email, created_by)
  values (v_uid, p_role, 'active', p_extra, p_denied, p_name, lower(p_email), auth.uid())
  on conflict (user_id) do update set
    role = excluded.role, status = 'active',
    extra_permissions = excluded.extra_permissions,
    denied_permissions = excluded.denied_permissions,
    suspended_at = null, revoked_at = null
  returning id into v_id;
  perform public.admin_audit('ADMIN_MEMBER_UPSERTED', 'admin_user', v_id::text,
    to_jsonb(v_old), (select to_jsonb(a) from public.admin_users a where a.id = v_id), null);
  return v_id;
end $$;


--
-- Name: prohibited_terms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prohibited_terms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    term text NOT NULL,
    action text DEFAULT 'REVIEW'::text NOT NULL,
    category text NOT NULL,
    rationale text,
    exempt_if text[] DEFAULT '{}'::text[] NOT NULL,
    is_regex boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prohibited_terms_action_check CHECK ((action = ANY (ARRAY['BLOCK'::text, 'REVIEW'::text])))
);


--
-- Name: TABLE prohibited_terms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.prohibited_terms IS 'First-layer screening applied to listing title/description/trade_for at write time. BLOCK refuses the write; REVIEW holds the listing unpublished for a human. Not a guarantee — reports and takedown remain the backstop.';


--
-- Name: admin_upsert_prohibited_term(text, text, text, text, text[], boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_upsert_prohibited_term(p_term text, p_action text, p_category text, p_rationale text DEFAULT NULL::text, p_exempt_if text[] DEFAULT '{}'::text[], p_active boolean DEFAULT true) RETURNS public.prohibited_terms
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare v_row public.prohibited_terms; v_old jsonb;
begin
  if not (public.admin_has_perm('compliance.rules_manage') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_action not in ('BLOCK','REVIEW') then
    raise exception 'INVALID_ACTION' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.prohibited_terms t
   where t.term = lower(btrim(p_term)) and t.category = p_category;

  insert into public.prohibited_terms as t
    (term, action, category, rationale, exempt_if, active, created_by)
  values (lower(btrim(p_term)), p_action, p_category, p_rationale,
          coalesce(p_exempt_if,'{}'), p_active, auth.uid())
  on conflict (term, category) do update
    set action = excluded.action, rationale = coalesce(excluded.rationale, t.rationale),
        exempt_if = excluded.exempt_if, active = excluded.active, updated_at = now()
  returning * into v_row;

  perform public.admin_audit('compliance.term.upsert', 'prohibited_terms', v_row.id::text,
                             v_old, to_jsonb(v_row), p_rationale, 'admin', null);
  return v_row;
end $$;


--
-- Name: admin_upsert_seed_product(uuid, text, text, text, text, text, text, text, text, integer, integer, integer, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_upsert_seed_product(p_id uuid, p_crop text, p_variety text, p_category text, p_sku text DEFAULT NULL::text, p_supplier text DEFAULT NULL::text, p_supplier_code text DEFAULT NULL::text, p_packet_size text DEFAULT NULL::text, p_barcode text DEFAULT NULL::text, p_cost_cents integer DEFAULT NULL::integer, p_reorder_threshold integer DEFAULT NULL::integer, p_suggested_reorder integer DEFAULT NULL::integer, p_notes text DEFAULT NULL::text, p_archived boolean DEFAULT NULL::boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_id uuid; v_old public.seed_products;
begin
  if p_id is null then
    if not public.admin_has_perm('inventory.create') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
    insert into public.seed_products (crop, variety, category, sku, supplier, supplier_product_code,
      packet_size, barcode, cost_cents, reorder_threshold, suggested_reorder_qty, tags)
    values (p_crop, coalesce(p_variety, ''), coalesce(p_category,'vegetable'), p_sku, p_supplier, p_supplier_code,
      p_packet_size, p_barcode, p_cost_cents, p_reorder_threshold, p_suggested_reorder, '{}')
    returning id into v_id;
    perform public.admin_audit('INVENTORY_ITEM_CREATED','seed_product',v_id::text,null,
      jsonb_build_object('crop',p_crop,'variety',p_variety,'sku',p_sku),null);
  else
    if not public.admin_has_perm('inventory.edit') then raise exception 'NOT_AUTHORIZED' using errcode='P0001'; end if;
    select * into v_old from public.seed_products where id = p_id for update;
    if v_old is null then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
    update public.seed_products set
      crop = coalesce(p_crop, crop), variety = coalesce(p_variety, variety),
      category = coalesce(p_category, category), sku = coalesce(p_sku, sku),
      supplier = coalesce(p_supplier, supplier), supplier_product_code = coalesce(p_supplier_code, supplier_product_code),
      packet_size = coalesce(p_packet_size, packet_size), barcode = coalesce(p_barcode, barcode),
      cost_cents = coalesce(p_cost_cents, cost_cents),
      reorder_threshold = coalesce(p_reorder_threshold, reorder_threshold),
      suggested_reorder_qty = coalesce(p_suggested_reorder, suggested_reorder_qty),
      archived = coalesce(p_archived, archived), updated_at = now()
    where id = p_id;
    v_id := p_id;
    perform public.admin_audit('INVENTORY_ITEM_UPDATED','seed_product',p_id::text,
      to_jsonb(v_old),(select to_jsonb(x) from public.seed_products x where x.id=p_id),p_notes);
  end if;
  return v_id;
end $$;


--
-- Name: admin_user_email(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_user_email(p_user uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare e text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select email into e from auth.users where id = p_user;
  return e;
end $$;


--
-- Name: ai_agents_no_cycle(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_agents_no_cycle() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare hop text; depth int := 0;
begin
  if new.reports_to is null then return new; end if;
  if new.reports_to = new.id then raise exception 'AGENT_REPORTS_TO_SELF'; end if;
  hop := new.reports_to;
  while hop is not null and depth < 10 loop
    if hop = new.id then raise exception 'AGENT_REPORTING_CYCLE'; end if;
    select reports_to into hop from public.ai_agents where id = hop;
    depth := depth + 1;
  end loop;
  return new;
end $$;


--
-- Name: ai_file_action_request(text, text, jsonb, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_file_action_request(p_agent text, p_action text, p_params jsonb, p_summary text, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_allowed jsonb := '{
    "gnome_hq":    ["pause_listing","restore_listing","adjust_inventory","quarantine_lot","end_promotion","grant_promo_credits","grant_comp_plan","cancel_seed_order","resolve_report"],
    "operations":  ["pause_listing","restore_listing","cancel_seed_order","resolve_report"],
    "inventory":   ["adjust_inventory","quarantine_lot"],
    "seeds":       ["cancel_seed_order","quarantine_lot"],
    "marketplace": ["pause_listing","restore_listing","resolve_report"],
    "support":     ["resolve_report"],
    "finance":     ["grant_promo_credits","grant_comp_plan"],
    "growth":      ["grant_promo_credits"],
    "compliance":  ["pause_listing"],
    "security":    ["pause_listing"]
  }'::jsonb;
  v_risk int;
  v_id uuid;
begin
  if auth.uid() is not null then
    raise exception 'SERVICE_ONLY' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.ai_agents a where a.id = p_agent
                   and a.status <> 'disabled'
                   and 'create_owner_approval_request' = any(a.permissions)) then
    raise exception 'AGENT_NOT_PERMITTED: %', p_agent using errcode = 'P0001';
  end if;
  if not (v_allowed ? p_agent) or not (v_allowed->p_agent) ? p_action then
    raise exception 'ACTION_OUT_OF_SCOPE: % for %', p_action, p_agent using errcode = 'P0001';
  end if;
  v_risk := case p_action
    when 'grant_comp_plan' then 3
    else 2
  end;
  insert into public.ai_action_requests
    (agent_id, requested_action, resource_type, resource_id, parameters,
     payload_hash, human_summary, reason, risk_level, status, dry_run, expires_at)
  values
    (p_agent, p_action, split_part(p_action, '_', 2), null, coalesce(p_params, '{}'::jsonb),
     encode(extensions.digest(p_action || '|' || coalesce(p_params, '{}'::jsonb)::text, 'sha256'), 'hex'),
     left(coalesce(p_summary, p_action), 200), left(coalesce(p_reason, ''), 300),
     v_risk, 'PENDING', false, now() + interval '7 days')
  returning id into v_id;
  perform public.admin_audit('AI_ACTION_PROPOSED', 'ai_action_request', v_id::text,
    null, jsonb_build_object('agent', p_agent, 'action', p_action, 'params', p_params),
    p_reason, 'AI_AGENT');
  return v_id;
end $$;


--
-- Name: ai_reserve_slot(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_reserve_slot(p_uid uuid, p_feature text, p_cap integer) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  insert into public.ai_daily_counter (user_id, feature, day, count)
  values (p_uid, p_feature, current_date, 1)
  on conflict (user_id, feature, day)
    do update set count = ai_daily_counter.count + 1
    where ai_daily_counter.count < p_cap
  returning true;
$$;


--
-- Name: ai_usage_increment(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_usage_increment(p_user uuid, p_feature text, p_cap integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare new_count int;
begin
  insert into public.ai_usage (user_id, day, feature, count)
  values (p_user, (now() at time zone 'utc')::date, p_feature, 1)
  on conflict (user_id, day, feature)
  do update set count = ai_usage.count + 1
  returning count into new_count;
  return new_count <= p_cap;
end;
$$;


--
-- Name: billing_activate_bundle(uuid, uuid, public.market_plan, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.billing_activate_bundle(p_market uuid, p_user uuid, p_plan public.market_plan, p_sub_stripe text, p_customer text, p_livemode boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- seller plan (same table the plan path uses)
  update public.markets set plan = p_plan where id = p_market;
  insert into public.market_subscriptions (market_id, plan, kind, provider, customer_id, subscription_id, status, stripe_livemode)
  values (p_market, p_plan, 'plan', 'stripe', p_customer, p_sub_stripe, 'active', p_livemode)
  on conflict do nothing;
  -- seed access: activate (or create) the user's seasonal subscription
  update public.seed_drop_subscriptions
     set status = 'active', stripe_customer_id = p_customer, stripe_subscription_id = p_sub_stripe
   where user_id = p_user;
  if not found then
    insert into public.seed_drop_subscriptions (user_id, cadence, status, packet_count, profile_snapshot, stripe_customer_id, stripe_subscription_id)
    values (p_user, 'seasonal', 'active', 6, coalesce((select to_jsonb(sp) from public.seed_profiles sp where sp.user_id = p_user), '{}'::jsonb), p_customer, p_sub_stripe);
  end if;
  perform public.reconcile_pickup_locations(p_market);
end $$;


--
-- Name: billing_grant_promo_credit(uuid, text, boolean, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.billing_grant_promo_credit(p_market uuid, p_session text, p_livemode boolean, p_qty integer DEFAULT 1, p_source text DEFAULT 'PURCHASED_SINGLE'::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.market_promotion_credits (market_id, delta, reason, source, stripe_session_id, stripe_livemode)
  values (p_market, p_qty, 'Purchased promotion credit', p_source, p_session, p_livemode);
  return true;
exception when unique_violation then
  return false;
end $$;


--
-- Name: billing_log_event(text, text, boolean, uuid, uuid, text, integer, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.billing_log_event(p_event text, p_type text, p_livemode boolean, p_market uuid, p_user uuid, p_product text, p_amount integer, p_effect text, p_meta jsonb DEFAULT NULL::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.billing_events (stripe_event_id, type, livemode, market_id, user_id, product_key, amount_cents, effect, metadata)
  values (p_event, p_type, p_livemode, p_market, p_user, p_product, p_amount, p_effect, p_meta);
end $$;


--
-- Name: billing_pay_seed_seasonal(text, boolean, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.billing_pay_seed_seasonal(p_session text, p_livemode boolean, p_sub uuid, p_amount integer) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare s public.seed_drop_subscriptions; v_win uuid; v_order uuid;
begin
  if exists (select 1 from public.seed_orders where stripe_session_id = p_session) then
    return 'replay';
  end if;
  select * into s from public.seed_drop_subscriptions where id = p_sub for update;
  if s is null then return 'sub_not_found'; end if;

  -- current eligible window for this subscriber
  select nw.window_id into v_win from public.seed_sub_next_window(p_sub) nw;

  -- existing pending order for the window?
  select id into v_order from public.seed_orders
   where user_id = s.user_id and season_window_id = v_win
     and status = 'pending_payment' limit 1;

  if v_order is null then
    -- generate this subscriber's order now (paid path handles reservation)
    v_order := public.generate_seed_subscription_order(p_sub, true);
    update public.seed_orders set season_window_id = v_win where id = v_order;
  end if;

  update public.seed_orders
     set status = 'paid', stripe_session_id = p_session,
         stripe_livemode = p_livemode, amount_cents = coalesce(p_amount, price_from_sub(s)),
         updated_at = now()
   where id = v_order;
  return 'paid:'||v_order::text;
end $$;


--
-- Name: billing_price_id(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.billing_price_id(p_key text, p_mode text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when p_mode = 'live' then stripe_price_id_live else stripe_price_id_test end
    from public.billing_products where key = p_key;
$$;


--
-- Name: billing_purchase_and_promote(text, boolean, uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.billing_purchase_and_promote(p_session text, p_livemode boolean, p_market uuid, p_listing uuid, p_amount integer) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_owns boolean; v_promo uuid;
begin
  -- replay guard: this session already recorded a purchase → done.
  if exists (select 1 from public.market_promotion_credits where stripe_session_id = p_session) then
    return 'replay';
  end if;
  select exists (select 1 from public.listings where id = p_listing and market_id = p_market) into v_owns;
  if not v_owns then return 'listing_market_mismatch'; end if;

  -- +1 purchased credit (unique on session → replay-safe).
  insert into public.market_promotion_credits (market_id, delta, reason, source, stripe_session_id, stripe_livemode)
  values (p_market, 1, 'Purchased promotion (checkout)', 'PURCHASED_SINGLE', p_session, p_livemode);

  -- activate 7-day promotion if the listing is still promotable + not already featured
  if exists (select 1 from public.listings where id = p_listing and status = 'active' and expires_at > now())
     and not exists (select 1 from public.listing_promotions where listing_id = p_listing and status='active' and ends_at > now()) then
    insert into public.listing_promotions (listing_id, market_id, source, status, stripe_livemode)
    values (p_listing, p_market, 'paid', 'active', p_livemode) returning id into v_promo;
    insert into public.market_promotion_credits (market_id, delta, reason, source, promotion_id, stripe_livemode)
    values (p_market, -1, 'Promotion activated (checkout)', 'CONSUMED', v_promo, p_livemode);
    return 'promoted';
  end if;
  -- otherwise the credit simply sits in the ledger for later use
  return 'credit_only';
end $$;


--
-- Name: billing_refund_promo_credit(text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.billing_refund_promo_credit(p_session text, p_livemode boolean) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_market uuid; v_bal int;
begin
  select market_id into v_market from public.market_promotion_credits
   where stripe_session_id = p_session and delta > 0 limit 1;
  if v_market is null then return 'no_purchase_found'; end if;
  select public.market_purchased_promo_balance(v_market) into v_bal;
  if v_bal <= 0 then return 'already_consumed_history_preserved'; end if;
  insert into public.market_promotion_credits (market_id, delta, reason, source, stripe_livemode)
  values (v_market, -1, 'Refund: promotion purchase reversed', 'REFUND', p_livemode);
  return 'credit_clawed_back';
end $$;


--
-- Name: blocked_pair(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.blocked_pair(a uuid, b uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;


--
-- Name: can_publish_in_node(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_publish_in_node(p_node_id uuid, p_user uuid DEFAULT auth.uid(), p_jurisdiction text DEFAULT 'US-OH'::text) RETURNS TABLE(allowed boolean, reason text, message text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  r public.compliance_rules;
  node public.marketplace_taxonomy_nodes;
  cred_count int;
begin
  if p_user is null then
    return query select false, 'NOT_SIGNED_IN', 'Sign in to publish a listing.'; return;
  end if;
  select * into node from public.marketplace_taxonomy_nodes where id = p_node_id;
  if node is null then
    return query select true, 'NO_NODE', 'No category selected.'; return;
  end if;
  if node.prohibited then
    return query select false, 'PROHIBITED', 'This product is not allowed on Gnome.'; return;
  end if;

  select * into r from public.effective_compliance_rule(p_node_id, p_jurisdiction);

  if r is null or r.classification = 'GENERALLY_UNRESTRICTED' then
    return query select true, 'UNRESTRICTED', null::text; return;
  end if;

  if r.classification = 'PROHIBITED' then
    return query select false, 'PROHIBITED',
      coalesce(r.notes, 'This product is not allowed on Gnome.'); return;
  end if;

  if r.classification = 'CONDITIONAL' then
    return query select true, 'CONDITIONAL', r.seller_attestation; return;
  end if;

  if r.classification = 'REVIEW_REQUIRED' then
    return query select false, 'REVIEW_REQUIRED',
      'This category is not currently available for publishing while Gnome reviews applicable requirements.';
    return;
  end if;

  if r.minimum_plan <> 'free' and not public.user_has_paid_plan(p_user) then
    return query select false, 'PLAN_REQUIRED',
      'Selling this type of product requires a paid Gnome seller plan and regulatory verification.';
    return;
  end if;

  select count(*) into cred_count
    from public.seller_credentials c
    join public.credential_taxonomy_scope s on s.credential_id = c.id
    join public.marketplace_taxonomy_nodes sn on sn.id = s.taxonomy_node_id
   where c.seller_id = p_user
     and c.status = 'APPROVED'
     and (c.expiration_date is null or c.expiration_date >= current_date)
     and (node.path = sn.path or node.path like sn.path || '/%');

  if cred_count > 0 then
    return query select true, 'CREDENTIAL_OK', null::text; return;
  end if;

  if exists (
    select 1 from public.seller_credentials c
    join public.credential_taxonomy_scope s on s.credential_id = c.id
    join public.marketplace_taxonomy_nodes sn on sn.id = s.taxonomy_node_id
    where c.seller_id = p_user and c.status = 'PENDING'
      and (node.path = sn.path or node.path like sn.path || '/%')
  ) then
    return query select false, 'CREDENTIAL_PENDING',
      'Your documentation for this category is being reviewed. You can save a draft, but it cannot be published yet.';
    return;
  end if;

  if exists (
    select 1 from public.seller_credentials c
    join public.credential_taxonomy_scope s on s.credential_id = c.id
    join public.marketplace_taxonomy_nodes sn on sn.id = s.taxonomy_node_id
    where c.seller_id = p_user and c.status in ('EXPIRED','RENEWAL_REQUIRED')
      and (node.path = sn.path or node.path like sn.path || '/%')
  ) then
    return query select false, 'CREDENTIAL_EXPIRED',
      'Your credential for this category expired. Renew it to reactivate these listings.';
    return;
  end if;

  if exists (
    select 1 from public.seller_credentials c
    join public.credential_taxonomy_scope s on s.credential_id = c.id
    join public.marketplace_taxonomy_nodes sn on sn.id = s.taxonomy_node_id
    where c.seller_id = p_user and c.status in ('DENIED','REVOKED')
      and (node.path = sn.path or node.path like sn.path || '/%')
  ) then
    return query select false, 'CREDENTIAL_DENIED',
      'Your verification for this category was not approved. Review the reason and resubmit your documentation.';
    return;
  end if;

  return query select false, 'CREDENTIAL_REQUIRED',
    coalesce('This product requires additional verification' ||
             case when r.credential_requirement is not null
                  then ' (' || r.credential_requirement || ')' else '' end || '.',
             'This product requires additional verification.');
end $$;


--
-- Name: cancel_market_order(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_market_order(p_order uuid, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare o public.market_orders; v_is_seller boolean;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  v_is_seller := exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid());
  if o.buyer_id is distinct from auth.uid() and not v_is_seller then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if o.status in ('COMPLETED','CANCELLED','DECLINED') then
    raise exception 'BAD_STATE: order already %', o.status using errcode = 'P0001';
  end if;
  perform public._release_order_inventory(p_order);
  update public.market_orders
     set status = 'CANCELLED', decline_reason = nullif(btrim(coalesce(p_reason,'')), ''), updated_at = now()
   where id = p_order;
end $$;


--
-- Name: cart_pickup_locations(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cart_pickup_locations(p_market uuid, p_listings uuid[]) RETURNS TABLE(location_id uuid, nickname text, location_type text, approx_lat double precision, approx_lng double precision, is_default boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with live as (
    select l.* from public.market_pickup_locations l
     where l.market_id = p_market and l.active and not l.plan_restricted
  ), per_listing as (
    select li.id as listing_id,
           coalesce(
             (select array_agg(lp.location_id) from public.listing_pickup_locations lp
               where lp.listing_id = li.id),
             (select array_agg(d.id) from live d where d.is_default)
           ) as allowed
      from public.listings li
     where li.id = any(p_listings)
  )
  select v.id, v.nickname, v.location_type, v.approx_lat, v.approx_lng, v.is_default
    from live v
   where not exists (
     select 1 from per_listing p
      where p.allowed is null or not (v.id = any(p.allowed))
   )
   order by v.is_default desc, v.nickname;
$$;


--
-- Name: check_claim_not_blocked(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_claim_not_blocked() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_owner uuid;
begin
  select l.owner_id into v_owner from public.listings l where l.id = new.listing_id;
  if v_owner is not null and public.blocked_pair(v_owner, new.claimer_id) then
    raise exception 'BLOCKED_USER';
  end if;
  return new;
end;
$$;


--
-- Name: check_message_not_blocked(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_message_not_blocked() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_owner   uuid;
  v_claimer uuid;
begin
  select l.owner_id, c.claimer_id into v_owner, v_claimer
    from public.claims c join public.listings l on l.id = c.listing_id
    where c.id = new.claim_id;
  if v_owner is not null and public.blocked_pair(v_owner, v_claimer) then
    raise exception 'BLOCKED_USER';
  end if;
  return new;
end;
$$;


--
-- Name: claim_messages_kind_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_messages_kind_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.kind = 'update' then
    if auth.uid() is distinct from (
      select l.owner_id from public.claims c
      join public.listings l on l.id = c.listing_id
      where c.id = new.claim_id
    ) then
      raise exception 'UPDATES_ARE_GROWER_ONLY' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: claim_messages_rate_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_messages_rate_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  cnt integer;
begin
  select count(*) into cnt
    from public.claim_messages
    where claim_id = new.claim_id
      and sender_id = new.sender_id
      and created_at > now() - interval '1 hour';
  if cnt >= 30 then
    raise exception 'rate limit exceeded: max 30 messages per claim per hour';
  end if;
  return new;
end;
$$;


--
-- Name: claim_status_of(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_status_of(cid uuid) RETURNS public.claim_status
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select status from public.claims where id = cid;
$$;


--
-- Name: complete_market_order(uuid, boolean, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_market_order(p_order uuid, p_record_payment boolean DEFAULT false, p_method text DEFAULT 'cash'::text, p_amount_cents integer DEFAULT NULL::integer) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  o public.market_orders; v_txn uuid; v_items int; v_qty numeric;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select id into v_txn from public.seller_transactions
   where order_id = p_order and status = 'completed' limit 1;
  if o.status = 'COMPLETED' then
    if not p_record_payment or v_txn is not null then return v_txn; end if;
  elsif o.status not in ('CONFIRMED','READY','OUT_FOR_DELIVERY') then
    raise exception 'BAD_STATE: % order cannot be completed', o.status using errcode = 'P0001';
  end if;

  update public.market_orders set status = 'COMPLETED', updated_at = now()
   where id = p_order and status <> 'COMPLETED';

  if p_record_payment and v_txn is null then
    if p_method not in ('cash','venmo','zelle','cashapp','check','external_card','other','paypal') then
      raise exception 'BAD_METHOD' using errcode = 'P0001';
    end if;
    select count(*), coalesce(sum(quantity), 0) into v_items, v_qty
      from public.market_order_items where order_id = p_order;
    insert into public.seller_transactions
      (market_id, listing_id, claim_id, order_id, source, quantity,
       gross_cents, discount_cents, fee_cents, delivery_fee_cents,
       payment_method, buyer_label, notes, status)
    values
      (o.market_id, null, null, p_order, 'request', v_qty,
       coalesce(p_amount_cents, o.subtotal_cents + coalesce(o.delivery_fee_cents, 0)),
       0, 0, coalesce(o.delivery_fee_cents, 0),
       case when p_method = 'paypal' then 'other' else p_method end,
       null,
       case when o.fulfillment_type = 'delivery'
            then 'Market delivery order (' || v_items || ' items)'
            else 'Market pickup order (' || v_items || ' items)' end,
       'completed')
    returning id into v_txn;
  end if;
  return v_txn;
end $$;


--
-- Name: compliance_reactivate_for_seller(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compliance_reactivate_for_seller(p_seller uuid DEFAULT auth.uid()) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare n int := 0;
begin
  if p_seller is null or (p_seller <> auth.uid() and not public.is_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  with resumable as (
    select l.id from public.listings l
     where l.owner_id = p_seller
       and l.status = 'paused'
       and l.taxonomy_node_id is not null
       and (select allowed from public.can_publish_in_node(
              l.taxonomy_node_id, p_seller, public.seller_jurisdiction(p_seller)))
  ), done as (
    update public.listings l set status = 'active'::public.listing_status
      from resumable r where l.id = r.id returning l.id
  )
  select count(*) into n from done;
  return n;
end $$;


--
-- Name: compliance_run_expiry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compliance_run_expiry() RETURNS TABLE(expired_credentials integer, paused_listings integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare exp_count int := 0; paused int := 0;
begin
  with expiring as (
    update public.seller_credentials
       set status = 'EXPIRED', updated_at = now()
     where status = 'APPROVED'
       and expiration_date is not null
       and expiration_date < current_date
    returning id
  )
  select count(*) into exp_count from expiring;

  with candidates as (
    select l.id
      from public.listings l
     where l.status = 'active'
       and l.taxonomy_node_id is not null
       and exists (
         select 1 from public.compliance_rules r
         join public.marketplace_taxonomy_nodes rn on rn.id = r.taxonomy_node_id
         join public.marketplace_taxonomy_nodes ln on ln.id = l.taxonomy_node_id
         where r.classification in ('REGULATED','REVIEW_REQUIRED')
           and (ln.path = rn.path or ln.path like rn.path || '/%')
       )
       and not (select allowed from public.can_publish_in_node(
                  l.taxonomy_node_id, l.owner_id, public.seller_jurisdiction(l.owner_id)))
  ), paused_rows as (
    update public.listings l
       set status = 'paused'::public.listing_status
      from candidates c
     where l.id = c.id
    returning l.id
  )
  select count(*) into paused from paused_rows;

  return query select exp_count, paused;
end $$;


--
-- Name: confirm_market_order(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_market_order(p_order uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  o public.market_orders; it record;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if o.status not in ('REQUESTED','TIME_PROPOSED') then
    raise exception 'BAD_STATE: % order cannot be confirmed', o.status using errcode = 'P0001';
  end if;

  for it in select i.id as item_id, i.quantity, i.title, i.listing_id, l.inventory_count
              from public.market_order_items i
              join public.listings l on l.id = i.listing_id
             where i.order_id = p_order
             for update of l
  loop
    if it.inventory_count is not null then
      if it.inventory_count < it.quantity then
        raise exception 'INSUFFICIENT_INVENTORY: %', it.title using errcode = 'P0001';
      end if;
      update public.listings set inventory_count = inventory_count - it.quantity::int
       where id = it.listing_id;
      update public.market_order_items set reserved = true where id = it.item_id;
    end if;
  end loop;

  update public.market_orders
     set status = 'CONFIRMED',
         confirmed_start = coalesce(proposed_start, requested_start),
         confirmed_end   = coalesce(proposed_end, requested_end),
         proposed_start = null, proposed_end = null,
         updated_at = now()
   where id = p_order;
end $$;


--
-- Name: create_market_order(uuid, jsonb, timestamp with time zone, timestamp with time zone, text, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_market_order(p_market uuid, p_items jsonb, p_start timestamp with time zone, p_end timestamp with time zone, p_note text DEFAULT NULL::text, p_location uuid DEFAULT NULL::uuid, p_fulfillment text DEFAULT 'pickup'::text, p_address uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_buyer uuid := auth.uid();
  loc public.market_pickup_locations;
  addr public.buyer_delivery_addresses;
  q record; ds public.market_delivery_settings;
  v_order uuid; item jsonb; l record;
  v_qty numeric; v_subtotal int := 0; v_line int; v_ok boolean := false;
  v_ids uuid[];
  v_tz text;
begin
  if v_buyer is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  if p_fulfillment not in ('pickup','delivery') then
    raise exception 'BAD_FULFILLMENT' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.markets m where m.id = p_market and m.owner_id = v_buyer) then
    raise exception 'OWN_MARKET: you cannot order from your own Market' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = 'P0001';
  end if;

  select array_agg((value->>'listing_id')::uuid) into v_ids
    from jsonb_array_elements(p_items);

  if p_fulfillment = 'pickup' then
    if p_location is null then
      select id into p_location from public.market_pickup_locations
       where market_id = p_market and is_default and active and not plan_restricted;
    end if;
    if p_location is null then raise exception 'PICKUP_NOT_CONFIGURED' using errcode = 'P0001'; end if;

    if not exists (select 1 from public.cart_pickup_locations(p_market, v_ids) c
                    where c.location_id = p_location) then
      raise exception 'NO_COMMON_PICKUP_LOCATION: these items aren''t available for pickup at the same location'
        using errcode = 'P0001';
    end if;

    select * into loc from public.market_pickup_locations where id = p_location;

    select true into v_ok from public.location_available_slots(p_location, 21) a
     where a.slot_start = p_start and a.slot_end = p_end limit 1;
    if not coalesce(v_ok, false) then
      raise exception 'SLOT_UNAVAILABLE: pick one of the offered pickup times' using errcode = 'P0001';
    end if;

    insert into public.market_orders
      (market_id, buyer_id, requested_start, requested_end, timezone, buyer_note,
       pickup_location_id, pickup_location_name, pickup_location_type, fulfillment_type)
    values (p_market, v_buyer, p_start, p_end, loc.timezone,
            nullif(btrim(coalesce(p_note,'')), ''),
            loc.id, loc.nickname, loc.location_type, 'pickup')
    returning id into v_order;

  else
    if p_address is null then raise exception 'ADDRESS_REQUIRED' using errcode = 'P0001'; end if;
    select * into addr from public.buyer_delivery_addresses
     where id = p_address and buyer_id = v_buyer;
    if addr is null then raise exception 'ADDRESS_NOT_FOUND' using errcode = 'P0001'; end if;

    select * into q from public.delivery_quote(p_market, p_address);
    if not q.eligible then
      raise exception 'DELIVERY_INELIGIBLE: %', coalesce(q.reason, 'not available') using errcode = 'P0001';
    end if;

    select * into ds from public.market_delivery_settings where market_id = p_market;
    v_tz := coalesce(ds.tz, 'America/New_York');

    if p_start is null or p_end is null or p_end <= p_start then
      raise exception 'BAD_WINDOW' using errcode = 'P0001';
    end if;
    if (p_start at time zone v_tz)::date = (now() at time zone v_tz)::date then
      if not ds.same_day then
        raise exception 'SAME_DAY_UNAVAILABLE: this Market does not offer same-day delivery' using errcode = 'P0001';
      end if;
      if ds.same_day_cutoff is not null and (now() at time zone v_tz)::time > ds.same_day_cutoff then
        raise exception 'CUTOFF_PASSED: same-day orders close at %', to_char(ds.same_day_cutoff, 'HH12:MI AM') using errcode = 'P0001';
      end if;
    elsif (p_start at time zone v_tz)::date = (now() at time zone v_tz)::date + 1 then
      if ds.scheduled and extract(dow from p_start at time zone v_tz)::int = any(ds.delivery_dows) then
        if ds.order_by_dow is not null
           and (now() at time zone v_tz)::date >
               ((p_start at time zone v_tz)::date
                 - ((7 + extract(dow from p_start at time zone v_tz)::int - ds.order_by_dow) % 7))
           and not ds.next_day then
          raise exception 'ORDER_BY_PASSED: order by % for that delivery day',
            trim(to_char(((p_start at time zone v_tz)::date - ((7 + extract(dow from p_start at time zone v_tz)::int - ds.order_by_dow) % 7)), 'Day')) using errcode = 'P0001';
        end if;
      elsif not ds.next_day then
        raise exception 'NEXT_DAY_UNAVAILABLE: this Market does not offer next-day delivery' using errcode = 'P0001';
      end if;
      if ds.next_day and ds.next_day_cutoff is not null
         and not (ds.scheduled and extract(dow from p_start at time zone v_tz)::int = any(ds.delivery_dows))
         and (now() at time zone v_tz)::time > ds.next_day_cutoff then
        raise exception 'CUTOFF_PASSED: next-day orders close at %', to_char(ds.next_day_cutoff, 'HH12:MI AM') using errcode = 'P0001';
      end if;
    elsif ds.scheduled then
      if not (extract(dow from p_start at time zone v_tz)::int = any(ds.delivery_dows)) then
        raise exception 'NOT_A_DELIVERY_DAY: this Market delivers on scheduled days only' using errcode = 'P0001';
      end if;
      if ds.order_by_dow is not null then
        if (now() at time zone v_tz)::date >
           ((p_start at time zone v_tz)::date
             - ((7 + extract(dow from p_start at time zone v_tz)::int - ds.order_by_dow) % 7)) then
          raise exception 'ORDER_BY_PASSED: order by % for that delivery day',
            trim(to_char(((p_start at time zone v_tz)::date - ((7 + extract(dow from p_start at time zone v_tz)::int - ds.order_by_dow) % 7)), 'Day')) using errcode = 'P0001';
        end if;
      end if;
    elsif ds.same_day or ds.next_day then
      raise exception 'NOT_A_DELIVERY_DAY: this Market offers same-day or next-day delivery only' using errcode = 'P0001';
    end if;
    if p_start < now() then
      raise exception 'BAD_WINDOW: that time is in the past' using errcode = 'P0001';
    end if;

    if exists (
      select 1 from jsonb_array_elements(p_items) x
      join public.listings li on li.id = (x->>'listing_id')::uuid
      where li.taxonomy_node_id is not null
        and not public.delivery_allowed_for_node(li.taxonomy_node_id)
    ) then
      raise exception 'DELIVERY_RESTRICTED: an item in this order is pickup-only' using errcode = 'P0001';
    end if;

    insert into public.market_orders
      (market_id, buyer_id, requested_start, requested_end, timezone, buyer_note,
       fulfillment_type, delivery_address_id,
       delivery_address, delivery_city, delivery_state, delivery_postal_code, delivery_notes,
       delivery_distance_miles, delivery_base_fee_cents, delivery_surcharge_cents,
       delivery_fee_cents, delivery_rule)
    values (p_market, v_buyer, p_start, p_end, v_tz,
            nullif(btrim(coalesce(p_note,'')), ''),
            'delivery', addr.id,
            addr.address_line, addr.city, addr.state, addr.postal_code, addr.delivery_notes,
            q.distance_miles, q.base_fee_cents, q.surcharge_cents, q.total_fee_cents, q.rule)
    returning id into v_order;
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((item->>'quantity')::numeric, 1);
    if v_qty <= 0 then raise exception 'BAD_QUANTITY' using errcode = 'P0001'; end if;
    select id, title, unit, price_cents, market_id, status, taxonomy_node_id
      into l from public.listings where id = (item->>'listing_id')::uuid;
    if l is null or l.market_id is distinct from p_market then
      raise exception 'ITEM_NOT_IN_MARKET' using errcode = 'P0001';
    end if;
    if l.status <> 'active' then
      raise exception 'ITEM_UNAVAILABLE: %', l.title using errcode = 'P0001';
    end if;
    v_line := coalesce(l.price_cents, 0) * v_qty;
    v_subtotal := v_subtotal + v_line;
    insert into public.market_order_items
      (order_id, listing_id, title, unit, quantity, unit_price_cents, item_total_cents, taxonomy_node_id)
    values (v_order, l.id, l.title, l.unit, v_qty, coalesce(l.price_cents, 0), v_line, l.taxonomy_node_id);
  end loop;

  update public.market_orders set subtotal_cents = v_subtotal, updated_at = now()
   where id = v_order;
  return v_order;
end $$;


--
-- Name: decline_market_order(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decline_market_order(p_order uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare o public.market_orders;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if o.status in ('COMPLETED','CANCELLED','DECLINED') then
    raise exception 'BAD_STATE: order already %', o.status using errcode = 'P0001';
  end if;
  perform public._release_order_inventory(p_order);
  update public.market_orders
     set status = 'DECLINED', decline_reason = nullif(btrim(coalesce(p_reason,'')), ''), updated_at = now()
   where id = p_order;
end $$;


--
-- Name: delivery_allowed_for_node(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delivery_allowed_for_node(p_node uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select not exists (
    select 1
      from public.marketplace_taxonomy_nodes child
      join public.marketplace_taxonomy_nodes anc
        on child.path = anc.path or child.path like anc.path || '/%'
      join public.compliance_rules r
        on r.taxonomy_node_id = anc.id
     where child.id = p_node
       and r.review_status = 'active'
       and upper(coalesce(r.pickup_policy, '')) = 'PICKUP_ONLY'
  );
$$;


--
-- Name: delivery_quote(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delivery_quote(p_market uuid, p_address uuid) RETURNS TABLE(eligible boolean, reason text, distance_miles numeric, base_fee_cents integer, surcharge_cents integer, total_fee_cents integer, rule jsonb)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  ds public.market_delivery_settings;
  addr public.buyer_delivery_addresses;
  o record;
  d double precision;
  v_sur int := 0;
begin
  select * into addr from public.buyer_delivery_addresses
   where id = p_address and buyer_id = auth.uid();
  if addr is null then
    return query select false, 'ADDRESS_NOT_FOUND', null::numeric, null::int, null::int, null::int, null::jsonb; return;
  end if;

  select * into ds from public.market_delivery_settings where market_id = p_market;
  if ds is null or not ds.enabled then
    return query select false, 'PICKUP_ONLY: This Market currently offers pickup only', null::numeric, null::int, null::int, null::int, null::jsonb; return;
  end if;

  if addr.lat is null or addr.lng is null then
    return query select false, 'ADDRESS_NOT_LOCATED: Save the address again so we can place it on the map', null::numeric, null::int, null::int, null::int, null::jsonb; return;
  end if;

  select * into o from public.market_delivery_origin(p_market);
  if o.lat is null or o.lng is null then
    return query select false, 'NO_ORIGIN: This Market has not set a delivery starting point', null::numeric, null::int, null::int, null::int, null::jsonb; return;
  end if;

  d := public.haversine_miles(o.lat, o.lng, addr.lat, addr.lng);

  if ds.radius_miles is null or d > ds.radius_miles then
    return query select false, 'OUT_OF_RANGE: Outside this Market''s delivery area',
      null::numeric, null::int, null::int, null::int, null::jsonb; return;
  end if;

  if ds.surcharge_after_miles is not null and d > ds.surcharge_after_miles then
    v_sur := coalesce(ds.surcharge_fee_cents, 0);
  end if;

  return query select
    true, null::text,
    round(d::numeric, 1),
    ds.flat_fee_cents,
    v_sur,
    ds.flat_fee_cents + v_sur,
    jsonb_build_object(
      'radius_miles', ds.radius_miles,
      'flat_fee_cents', ds.flat_fee_cents,
      'surcharge_after_miles', ds.surcharge_after_miles,
      'surcharge_fee_cents', ds.surcharge_fee_cents,
      'same_day', ds.same_day, 'same_day_cutoff', ds.same_day_cutoff,
      'next_day', ds.next_day, 'next_day_cutoff', ds.next_day_cutoff,
      'scheduled', ds.scheduled, 'order_by_dow', ds.order_by_dow,
      'delivery_dows', ds.delivery_dows, 'tz', ds.tz,
      'version', ds.updated_at);
end $$;


--
-- Name: discard_listing_draft(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.discard_listing_draft(p_draft uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  update public.listing_drafts
     set status = 'discarded', updated_at = now()
   where id = p_draft and owner_id = uid and status = 'pending';
  if not found then raise exception 'DRAFT_NOT_FOUND'; end if;
end;
$$;


--
-- Name: compliance_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction text DEFAULT 'US-OH'::text NOT NULL,
    taxonomy_node_id uuid NOT NULL,
    classification public.compliance_classification NOT NULL,
    rule_type text,
    credential_requirement text,
    issuing_agency text,
    minimum_plan public.market_plan DEFAULT 'free'::public.market_plan NOT NULL,
    required_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    shipping_policy text,
    pickup_policy text,
    seller_attestation text,
    notes text,
    effective_date date DEFAULT CURRENT_DATE NOT NULL,
    official_source text,
    review_status text DEFAULT 'DRAFT'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: effective_compliance_rule(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.effective_compliance_rule(p_node_id uuid, p_jurisdiction text DEFAULT 'US-OH'::text) RETURNS public.compliance_rules
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with target as (select path from public.marketplace_taxonomy_nodes where id = p_node_id)
  select r.*
    from public.compliance_rules r
    join public.marketplace_taxonomy_nodes n on n.id = r.taxonomy_node_id
    join target t on t.path = n.path or t.path like n.path || '/%'
   where r.jurisdiction = p_jurisdiction
     and r.review_status <> 'SUPERSEDED'
   order by length(n.path) desc   -- most specific rule wins
   limit 1;
$$;


--
-- Name: enforce_delivery_plan(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_delivery_plan() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare pl market_plan;
begin
  select ep.plan into pl from public.market_effective_plan(new.market_id) ep;
  if pl is null or pl = 'free' then
    if new.radius_miles is not null and new.radius_miles > 15 then
      raise exception 'DELIVERY_PLAN_LIMIT:radius:Free Markets deliver up to 15 miles. Upgrade to go farther.'
        using errcode = 'P0001';
    end if;
    if new.surcharge_after_miles is not null
       or new.same_day or new.next_day or new.scheduled then
      raise exception 'DELIVERY_PLAN_LIMIT:features:Distance surcharges and delivery scheduling are Grower & Farm features.'
        using errcode = 'P0001';
    end if;
  end if;
  if not new.same_day then new.same_day_cutoff := null; end if;
  if not new.next_day then new.next_day_cutoff := null; end if;
  if not new.scheduled then new.order_by_dow := null; new.delivery_dows := '{}'; end if;
  new.updated_at := now();
  return new;
end $$;


--
-- Name: enforce_pickup_location_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_pickup_location_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  allowance int;
  live int;
begin
  if not new.active or new.plan_restricted then return new; end if;
  if tg_op = 'UPDATE' and old.active and not old.plan_restricted then return new; end if;

  allowance := public.market_pickup_location_allowance(new.market_id);
  select count(*) into live
    from public.market_pickup_locations
   where market_id = new.market_id and active and not plan_restricted
     and id <> new.id;

  if live >= allowance then
    raise exception 'PICKUP_LOCATION_LIMIT:%:%', allowance,
      'Your plan includes ' || allowance || ' active pickup location' ||
      case when allowance = 1 then '' else 's' end || '.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;


--
-- Name: enforce_plan_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_plan_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  pl market_plan; cap integer; cur integer;
begin
  if new.status <> 'active' or new.market_id is null then return new; end if;
  select ep.plan into pl from public.market_effective_plan(new.market_id) ep;
  if pl is null then return new; end if;
  select max_active_listings into cap from public.plan_limits where plan = pl;
  if cap is null then return new; end if;
  cur := public.market_active_listing_count(new.market_id);
  if cur >= cap then
    raise exception 'PLAN_LIMIT_REACHED'
      using errcode = 'P0001',
            hint = format('active listing cap of %s reached for plan %s', cap, pl);
  end if;
  return new;
end $$;


--
-- Name: enforce_plot_plan(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_plot_plan() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  pl market_plan;
begin
  if new.listing_type <> 'plot' then return new; end if;

  if new.market_id is null then
    raise exception 'PLOTS_REQUIRE_PLAN'
      using errcode = 'P0001', hint = 'plot listings must belong to a market';
  end if;

  select plan into pl from public.market_effective_plan(new.market_id);
  if pl is null or pl = 'free' then
    raise exception 'PLOTS_REQUIRE_PLAN'
      using errcode = 'P0001',
            hint = 'offering plots requires a Grower or Farm plan';
  end if;

  return new;
end;
$$;


--
-- Name: enforce_promotion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_promotion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_existing timestamptz;
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.listings l
      where l.id = new.listing_id and l.market_id = new.market_id
    ) then
      raise exception 'listing does not belong to this market';
    end if;
    if new.status = 'active' then
      if not exists (select 1 from public.listings l where l.id = new.listing_id
                       and l.status = 'active' and l.expires_at > now()) then
        raise exception 'LISTING_NOT_PROMOTABLE: only live listings can be promoted' using errcode = 'P0001';
      end if;
      select max(ends_at) into v_existing from public.listing_promotions
       where listing_id = new.listing_id and status = 'active' and ends_at > now();
      if v_existing is not null then
        raise exception 'PROMO_ALREADY_ACTIVE:%', v_existing using errcode = 'P0001';
      end if;
      new.starts_at := coalesce(new.starts_at, now());
      new.ends_at := coalesce(new.ends_at, new.starts_at + interval '7 days');
      if new.ends_at > new.starts_at + interval '31 days' then
        raise exception 'PROMO_TOO_LONG' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if new.source = 'plan_credit' and new.status = 'active'
     and (tg_op = 'INSERT' or old.status <> 'active') then
    if public.market_boost_credits_remaining(new.market_id) <= 0 then
      raise exception 'NO_BOOST_CREDITS' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status = 'active' and new.ends_at is distinct from old.ends_at
     and not public.admin_has_perm('promotions.manage') and auth.uid() is not null then
    raise exception 'PROMO_WINDOW_LOCKED' using errcode = 'P0001';
  end if;

  return new;
end $$;


--
-- Name: events_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.events_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare cnt int;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'anon' then return new; end if;
  if new.event_type is null or new.event_type not in (
    'web_zip_search','web_browse_location_set','web_reserve_started',
    'web_reserve_submitted','web_listing_published',
    'web_gnome_opened','web_gnome_quick_action','web_gnome_message',
    'web_seed_profile_started','web_seed_profile_completed','web_seed_checkout_started',
    'web_sale_recorded','web_expense_recorded','web_market_customized','web_market_reordered'
  ) then
    raise exception 'EVENT_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if length(coalesce(new.metadata::text, '')) > 512 then
    raise exception 'EVENT_METADATA_TOO_LARGE' using errcode = 'P0001';
  end if;
  new.user_id := null; new.listing_id := null;
  select count(*) into cnt from public.events
  where user_id is null and created_at > now() - interval '1 minute';
  if cnt >= 300 then raise exception 'EVENT_RATE_LIMITED' using errcode = 'P0001'; end if;
  return new;
end $$;


--
-- Name: expire_finished_promotions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_finished_promotions() RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with upd as (
    update public.listing_promotions set status = 'expired'
    where status = 'active' and ends_at <= now()
    returning 1)
  select count(*)::int from upd;
$$;


--
-- Name: generate_seed_drop(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_seed_drop(p_order uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: generate_seed_subscription_order(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_seed_subscription_order(p_sub uuid, p_paid boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: gnome_slugify(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gnome_slugify(txt text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select coalesce(
    nullif(trim(both '-' from regexp_replace(lower(coalesce(txt,'')), '[^a-z0-9]+', '-', 'g')), ''),
    'market'
  );
$$;


--
-- Name: grow_log_context(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.grow_log_context(p_claim uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v jsonb;
begin
  if not public.is_plot_party(p_claim) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
    'crops', coalesce((select jsonb_agg(jsonb_build_object(
                'name', c.name, 'variety', c.variety, 'planted_at', c.planted_at,
                'status', c.status,
                'taxonomy_path', (select n.path from public.marketplace_taxonomy_nodes n
                                   where n.id = c.taxonomy_node_id)))
              from public.plot_crops c where c.claim_id = p_claim), '[]'::jsonb),
    'current_stage', (select g.stage from public.plot_grow_logs g
                       where g.claim_id = p_claim and g.stage is not null
                       order by g.created_at desc limit 1),
    'days_since_planted', (select (current_date - min(c.planted_at))
                            from public.plot_crops c
                            where c.claim_id = p_claim and c.planted_at is not null),
    'last_update', (select max(g.created_at) from public.plot_grow_logs g
                     where g.claim_id = p_claim),
    'photo_count', (select count(*) from public.plot_grow_log_photos ph
                     join public.plot_grow_logs g on g.id = ph.log_id
                     where g.claim_id = p_claim),
    'recent_entries', coalesce((select jsonb_agg(e) from (
        select jsonb_build_object('date', g.created_at::date, 'stage', g.stage,
                                  'kind', g.kind, 'title', g.title, 'notes', g.notes) e
          from public.plot_grow_logs g
         where g.claim_id = p_claim
         order by g.created_at desc limit 5) sub), '[]'::jsonb)
  ) into v;
  return v;
end $$;


--
-- Name: handle_claim_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_claim_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  l public.listings;
begin
  select * into l from public.listings where id = new.listing_id;

  if new.status = 'approved' and old.status is distinct from 'approved' then
    if l.listing_type = 'plot' and l.inventory_count is not null then
      update public.listings
         set inventory_count = greatest(0, inventory_count - 1),
             status = case when inventory_count - 1 <= 0 then 'claimed'::listing_status else status end
       where id = new.listing_id;
      if l.inventory_count - 1 <= 0 then
        update public.claims
           set status = 'declined'
         where listing_id = new.listing_id
           and id <> new.id
           and status = 'pending';
      end if;
    else
      update public.listings set status = 'claimed' where id = new.listing_id;
      update public.claims
        set status = 'declined'
        where listing_id = new.listing_id
          and id <> new.id
          and status = 'pending';
    end if;

  elsif new.status in ('cancelled', 'declined') and old.status = 'approved' then
    if l.listing_type = 'plot' and l.inventory_count is not null then
      update public.listings
         set inventory_count = inventory_count + 1,
             status = case when status = 'claimed' then 'active'::listing_status else status end
       where id = new.listing_id;
    else
      update public.listings set status = 'active'
        where id = new.listing_id and status = 'claimed';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: handle_new_profile(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_profile() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  mid uuid := gen_random_uuid();
  nm  text := coalesce(nullif(trim(new.name), ''), 'Neighbor') || '''s Market';
begin
  insert into public.markets (id, owner_id, name, slug)
  values (mid, new.id, nm, public.gnome_slugify(nm) || '-' || substr(mid::text, 1, 8));

  insert into public.market_members (market_id, user_id, role)
  values (mid, new.id, 'owner')
  on conflict (market_id, user_id) do nothing;

  insert into public.events (event_type, user_id, metadata)
  values ('market_created', new.id, jsonb_build_object('market_id', mid));

  return new;
end;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.profiles (id, name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'Neighbor'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


--
-- Name: has_claim_on(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_claim_on(lid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.claims c
    where c.listing_id = lid and c.claimer_id = auth.uid()
  );
$$;


--
-- Name: haversine_miles(double precision, double precision, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.haversine_miles(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision) RETURNS double precision
    LANGUAGE sql IMMUTABLE
    AS $$
  select 2 * 3958.8 * asin(sqrt(
    sin(radians(b_lat - a_lat) / 2) ^ 2 +
    cos(radians(a_lat)) * cos(radians(b_lat)) * sin(radians(b_lng - a_lng) / 2) ^ 2
  ));
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.admin_users
                  where user_id = auth.uid() and status = 'active');
$$;


--
-- Name: is_claim_party(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_claim_party(cid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.claims c
    join public.listings l on l.id = c.listing_id
    where c.id = cid
      and (auth.uid() = c.claimer_id or auth.uid() = l.owner_id)
  );
$$;


--
-- Name: is_plot_party(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_plot_party(p_claim uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.claims c
    join public.listings l on l.id = c.listing_id
    where c.id = p_claim
      and (c.claimer_id = auth.uid() or l.owner_id = auth.uid())
  );
$$;


--
-- Name: listing_has_verified_credential(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.listing_has_verified_credential(p_listing uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  l record;
  r public.compliance_rules;
begin
  select id, owner_id, taxonomy_node_id into l
    from public.listings where id = p_listing;
  if l is null or l.taxonomy_node_id is null then return false; end if;

  select * into r from public.effective_compliance_rule(
    l.taxonomy_node_id, public.seller_jurisdiction(l.owner_id));
  if r is null or r.classification <> 'REGULATED' then return false; end if;

  return exists (
    select 1
      from public.seller_credentials c
      join public.credential_taxonomy_scope s on s.credential_id = c.id
      join public.marketplace_taxonomy_nodes sn on sn.id = s.taxonomy_node_id
      join public.marketplace_taxonomy_nodes ln on ln.id = l.taxonomy_node_id
     where c.seller_id = l.owner_id
       and c.status = 'APPROVED'
       and (c.expiration_date is null or c.expiration_date >= current_date)
       and (ln.path = sn.path or ln.path like sn.path || '/%'));
end $$;


--
-- Name: listings_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.listings_before_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  want record;
begin
  new.kind := case when new.listing_type = 'wanted' then 'wanted'::listing_kind
                   else 'offer'::listing_kind end;

  if tg_op = 'INSERT' and new.expires_at is null then
    new.expires_at := now() + (case
      when new.listing_type = 'wanted' then interval '30 days'
      when new.listing_type = 'plot'   then interval '45 days'
      else interval '7 days' end);
  end if;

  if new.fulfilled_by_listing_id is not null then
    select kind, owner_id into want
      from public.listings where id = new.fulfilled_by_listing_id;
    if not found then
      raise exception 'fulfilled_by_listing_id % does not exist', new.fulfilled_by_listing_id;
    end if;
    if want.kind <> 'wanted' then
      raise exception 'fulfilled_by_listing_id must reference a wanted post';
    end if;
    if want.owner_id = new.owner_id then
      raise exception 'cannot fulfill your own wanted post';
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: listings_block_suspended(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.listings_block_suspended() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare v_susp boolean;
begin
  if new.status is distinct from 'active'::public.listing_status then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  select coalesce(suspended, false) into v_susp
    from public.profiles where id = new.owner_id;

  if v_susp then
    raise exception
      'ACCOUNT_SUSPENDED: Your account is under review, so listings can''t go live right now. Existing listings stay put and you can still take them down. Contact support if you think this is a mistake.'
      using errcode = 'P0001';
  end if;

  return new;
end $$;


--
-- Name: listings_enforce_compliance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.listings_enforce_compliance() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  verdict record;
begin
  if new.taxonomy_node_id is null then return new; end if;
  if new.status is distinct from 'active'::public.listing_status then return new; end if;
  if tg_op = 'UPDATE'
     and old.status = 'active'::public.listing_status
     and old.taxonomy_node_id is not distinct from new.taxonomy_node_id then
    return new;
  end if;
  if public.is_admin() then return new; end if;

  select * into verdict from public.can_publish_in_node(
    new.taxonomy_node_id, new.owner_id, public.seller_jurisdiction(new.owner_id));
  if verdict.allowed then return new; end if;

  raise exception 'COMPLIANCE_BLOCKED:%:%', verdict.reason, coalesce(verdict.message, '')
    using errcode = 'P0001';
end $$;


--
-- Name: listings_fill_taxonomy(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.listings_fill_taxonomy() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: listings_screen_content(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.listings_screen_content() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare hit record; blob text; cfg public.content_screening_config; made int;
        v_class text; cls public.compliance_classes; v_state text;
        oldest timestamptz; wait_min int;
begin
  select * into cfg from public.content_screening_config where id;

  if tg_op = 'INSERT' and cfg.max_listings_per_hour is not null
     and not public.is_admin() then
    select count(*), min(created_at) into made, oldest from public.listings
     where owner_id = new.owner_id and created_at > now() - interval '1 hour';
    if made >= cfg.max_listings_per_hour then
      wait_min := greatest(1, ceil(extract(epoch from (oldest + interval '1 hour' - now())) / 60))::int;
      raise exception
        'RATE_LIMITED: You have posted % listings in the last hour, which is the most we allow. You can post again in about % minute%.',
        made, wait_min, case when wait_min = 1 then '' else 's' end
        using errcode = 'P0001';
    end if;
  end if;

  if not coalesce(cfg.screening_enabled, true) then
    return new;
  end if;

  blob := coalesce(new.title,'') || ' ' || coalesce(new.description,'') || ' '
       || coalesce(new.trade_for,'');

  select * into hit from public.screen_listing_text(blob)
   where action = 'BLOCK' limit 1;

  v_state := public.normalize_state(new.state);
  if v_state is null then
    select public.normalize_state(pr.state) into v_state
      from public.profiles pr where pr.id = new.owner_id;
  end if;
  if new.state is not null and public.normalize_state(new.state) is not null then
    new.state := public.normalize_state(new.state);
  end if;

  if hit.term is null and coalesce(new.kind,'offer') <> 'wanted' then
    select n.compliance_class into v_class
      from public.marketplace_taxonomy_nodes n
     where n.id = new.taxonomy_node_id and n.compliance_class is not null;

    if v_class is null then
      select * into hit from public.screen_listing_text(
               public.strip_want_clauses(
                 coalesce(new.title,'') || ' ' || coalesce(new.description,'')))
       where action = 'REVIEW' limit 1;
      v_class := hit.category;
    end if;
  end if;

  if hit.action = 'BLOCK' then
    raise exception 'PROHIBITED_ITEM: Gnome can''t carry this one. "%" falls under % , which we don''t allow. If you think that''s wrong, edit the wording or contact support.',
      hit.term, replace(hit.category,'-',' ')
      using errcode = 'P0001';
  elsif v_class is not null then
    select * into cls from public.compliance_classes
     where compliance_class = v_class and active;

    if cls.compliance_class is null or not cls.requires_clearance
       or public.seller_is_cleared(new.owner_id, v_class, v_state) then
      new.screening_status   := 'CLEAR';
      new.screening_term     := null;
      new.screening_category := v_class;
      new.screening_reason   := null;
      new.screened_at        := now();
    else
      new.screening_status   := 'REVIEW';
      new.screening_term     := hit.term;
      new.screening_category := v_class;
      new.screening_reason   := coalesce(cls.customer_message, hit.rationale);
      new.screened_at        := now();
      if new.status = 'active' then new.status := 'paused'; end if;
    end if;
  else
    new.screening_status   := 'CLEAR';
    new.screening_term     := null;
    new.screening_category := null;
    new.screening_reason   := null;
    new.screened_at        := now();
  end if;

  if new.taxonomy_node_id is not null
     and exists (select 1 from public.marketplace_taxonomy_nodes n
                  where n.id = new.taxonomy_node_id and n.prohibited) then
    raise exception 'PROHIBITED_CATEGORY: Gnome can''t carry items in that category.'
      using errcode = 'P0001';
  end if;

  return new;
end $$;


--
-- Name: location_available_slots(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.location_available_slots(p_location uuid, p_days integer DEFAULT 10) RETURNS TABLE(slot_start timestamp with time zone, slot_end timestamp with time zone, remaining integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  loc public.market_pickup_locations;
  d int; w record; local_date date; slot_min int;
  v_start timestamptz; v_end timestamptz; taken int;
  has_exceptions boolean;
begin
  select * into loc from public.market_pickup_locations where id = p_location;
  if loc is null or not loc.active or loc.plan_restricted then return; end if;
  p_days := least(greatest(p_days, 1), 21);

  for d in 0..(p_days - 1) loop
    local_date := (now() at time zone loc.timezone)::date + d;
    if exists (select 1 from public.market_pickup_exceptions e
                where e.location_id = p_location and e.date = local_date and e.closed) then
      continue;
    end if;
    select exists (select 1 from public.market_pickup_exceptions e
                    where e.location_id = p_location and e.date = local_date and not e.closed)
      into has_exceptions;

    for w in
      select * from (
        select e.start_minute, e.end_minute
          from public.market_pickup_exceptions e
         where e.location_id = p_location and e.date = local_date and not e.closed and has_exceptions
        union all
        select h.start_minute, h.end_minute
          from public.market_pickup_hours h
         where h.location_id = p_location
           and h.weekday = extract(dow from local_date)::int
           and not has_exceptions
      ) windows order by start_minute
    loop
      slot_min := w.start_minute;
      while slot_min + loc.slot_minutes <= w.end_minute loop
        v_start := (local_date::timestamp + make_interval(mins => slot_min)) at time zone loc.timezone;
        v_end   := v_start + make_interval(mins => loc.slot_minutes);
        if v_start >= now() + make_interval(mins => loc.lead_time_minutes) then
          select count(*) into taken
            from public.market_orders o
           where o.pickup_location_id = p_location
             and o.status in ('REQUESTED','CONFIRMED','READY','TIME_PROPOSED')
             and coalesce(o.confirmed_start, o.requested_start) = v_start;
          if loc.max_orders_per_slot is null or taken < loc.max_orders_per_slot then
            slot_start := v_start; slot_end := v_end;
            remaining := case when loc.max_orders_per_slot is null then null
                              else loc.max_orders_per_slot - taken end;
            return next;
          end if;
        end if;
        slot_min := slot_min + loc.slot_minutes;
      end loop;
    end loop;
  end loop;
end $$;


--
-- Name: mark_order_ready(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_order_ready(p_order uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare o public.market_orders;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if o.status <> 'CONFIRMED' then
    raise exception 'BAD_STATE: only a confirmed order can be marked ready' using errcode = 'P0001';
  end if;
  update public.market_orders set status = 'READY', updated_at = now() where id = p_order;
end $$;


--
-- Name: mark_out_for_delivery(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_out_for_delivery(p_order uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare o public.market_orders;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if o.fulfillment_type <> 'delivery' then
    raise exception 'NOT_A_DELIVERY: pickup orders cannot go out for delivery' using errcode = 'P0001';
  end if;
  if o.status not in ('CONFIRMED','READY') then
    raise exception 'BAD_STATE: % order cannot go out for delivery', o.status using errcode = 'P0001';
  end if;
  update public.market_orders set status = 'OUT_FOR_DELIVERY', updated_at = now() where id = p_order;
end $$;


--
-- Name: market_active_listing_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_active_listing_count(mid uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select count(*)::int
  from public.listings
  where market_id = mid and status = 'active';
$$;


--
-- Name: market_available_slots(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_available_slots(p_market uuid, p_days integer DEFAULT 10) RETURNS TABLE(slot_start timestamp with time zone, slot_end timestamp with time zone, remaining integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_loc uuid;
begin
  select id into v_loc from public.market_pickup_locations
   where market_id = p_market and is_default and active and not plan_restricted;
  if v_loc is null then return; end if;
  return query select * from public.location_available_slots(v_loc, p_days);
end $$;


--
-- Name: market_boost_credits_remaining(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_boost_credits_remaining(p_market_id uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select greatest(
    0,
    coalesce((select pl.included_boost_credits
              from public.market_effective_plan(p_market_id) ep
              join public.plan_limits pl on pl.plan = ep.plan), 0)
    - coalesce((select count(*)::int
                from public.listing_promotions lp
                where lp.market_id = p_market_id
                  and lp.source = 'plan_credit'
                  and date_trunc('month', lp.created_at) = date_trunc('month', now())), 0)
  );
$$;


--
-- Name: market_delivery_origin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_delivery_origin(p_market uuid) RETURNS TABLE(lat double precision, lng double precision)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(l.lat, m.lat), coalesce(l.lng, m.lng)
    from public.markets m
    left join public.market_pickup_locations l
      on l.market_id = m.id and l.is_default and l.active and not l.plan_restricted
   where m.id = p_market;
$$;


--
-- Name: market_effective_plan(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_effective_plan(p_market uuid) RETURNS TABLE(plan public.market_plan, source text, grant_id uuid, grant_expires timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with base as (
    select m.plan as base_plan from public.markets m where m.id = p_market
  ), best_grant as (
    select g.id, g.plan, g.expires_at
      from public.admin_plan_grants g
     where g.market_id = p_market and g.status = 'ACTIVE'
       and g.starts_at <= now()
       and (g.expires_at is null or g.expires_at > now())
     order by public.plan_rank(g.plan) desc, g.created_at desc
     limit 1
  )
  select
    case
      when b.base_plan = 'sponsor' then 'sponsor'::market_plan
      when bg.plan is not null and public.plan_rank(bg.plan) > public.plan_rank(b.base_plan) then bg.plan
      else b.base_plan
    end,
    case
      when b.base_plan = 'sponsor' then 'sponsor'
      when bg.plan is not null and public.plan_rank(bg.plan) > public.plan_rank(b.base_plan) then 'complimentary'
      when b.base_plan <> 'free' then 'stripe'
      else 'free'
    end,
    case when b.base_plan <> 'sponsor' and bg.plan is not null
          and public.plan_rank(bg.plan) > public.plan_rank(b.base_plan) then bg.id end,
    case when b.base_plan <> 'sponsor' and bg.plan is not null
          and public.plan_rank(bg.plan) > public.plan_rank(b.base_plan) then bg.expires_at end
  from base b left join best_grant bg on true;
$$;


--
-- Name: market_orders_event_log(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_orders_event_log() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_role text;
begin
  if v_actor is null then v_role := 'system';
  elsif new.buyer_id = v_actor then v_role := 'buyer';
  elsif exists (select 1 from public.markets m where m.id = new.market_id and m.owner_id = v_actor) then v_role := 'seller';
  elsif public.is_admin() then v_role := 'admin';
  else v_role := 'system';
  end if;
  if tg_op = 'INSERT' then
    insert into public.market_order_events (order_id, actor_id, actor_role, old_status, new_status)
    values (new.id, v_actor, v_role, null, new.status);
  elsif old.status is distinct from new.status then
    insert into public.market_order_events (order_id, actor_id, actor_role, old_status, new_status, reason)
    values (new.id, v_actor, v_role, old.status, new.status, new.decline_reason);
  end if;
  return new;
end $$;


--
-- Name: market_pickup_location_allowance(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_pickup_location_allowance(p_market uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(pl.max_pickup_locations, 1)
       + case when pl.extra_location_fee_cents is not null
              then coalesce(m.extra_pickup_locations, 0) else 0 end
    from public.markets m
    cross join lateral public.market_effective_plan(m.id) ep
    left join public.plan_limits pl on pl.plan = ep.plan
   where m.id = p_market;
$$;


--
-- Name: market_pickup_locations_default_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_pickup_locations_default_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' and not exists (
      select 1 from public.market_pickup_locations
       where market_id = new.market_id and is_default and id <> new.id) then
    new.is_default := true;
  end if;
  if new.is_default then
    new.active := true;
    new.plan_restricted := false;
    update public.market_pickup_locations
       set is_default = false, updated_at = now()
     where market_id = new.market_id and id <> new.id and is_default;
  end if;
  new.updated_at := now();
  return new;
end $$;


--
-- Name: market_promotion_performance(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_promotion_performance(p_market uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when auth.uid() <> (select owner_id from public.markets where id = p_market)
              and not public.admin_has_perm('promotions.view') then null else
  coalesce((select jsonb_agg(jsonb_build_object(
    'promotion_id', lp.id, 'listing_id', lp.listing_id,
    'listing_title', (select title from public.listings where id = lp.listing_id),
    'source', lp.source, 'status', lp.status,
    'starts_at', lp.starts_at, 'ends_at', lp.ends_at,
    'market_listing_views_during', (
       select coalesce(sum(mm.listing_views), 0) from public.market_metrics mm
        where mm.market_id = lp.market_id
          and mm.date between lp.starts_at::date and least(lp.ends_at, now())::date),
    'claims_started_during', (
       select count(*) from public.claims c
        where c.listing_id = lp.listing_id
          and c.created_at between lp.starts_at and least(lp.ends_at, now())),
    'claims_completed_during', (
       select count(*) from public.claims c
        where c.listing_id = lp.listing_id and c.status = 'completed'
          and c.created_at between lp.starts_at and least(lp.ends_at, now()))
    ) order by lp.created_at desc)
    from public.listing_promotions lp where lp.market_id = p_market), '[]'::jsonb)
  end;
$$;


--
-- Name: market_promotion_status(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_promotion_status(p_market uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when auth.uid() <> (select owner_id from public.markets where id = p_market)
              and not public.admin_has_perm('promotions.view') then null else
  jsonb_build_object(
    'included_allowance', coalesce((select pl.included_boost_credits
        from public.market_effective_plan(p_market) ep
        join public.plan_limits pl on pl.plan = ep.plan), 0),
    'included_remaining', public.market_boost_credits_remaining(p_market),
    'included_used_this_month', coalesce((select count(*)::int from public.listing_promotions
        where market_id = p_market and source = 'plan_credit'
          and date_trunc('month', created_at) = date_trunc('month', now())), 0),
    'purchased_balance', public.market_purchased_promo_balance(p_market),
    'resets_on', (date_trunc('month', now()) + interval '1 month')::date,
    'price_cents', coalesce((select unit_amount_cents from public.billing_products
        where key = 'GNOME_LISTING_PROMOTION'), 399),
    'duration_days', 7,
    'active', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', lp.id, 'listing_id', lp.listing_id, 'ends_at', lp.ends_at, 'source', lp.source)), '[]'::jsonb)
      from public.listing_promotions lp
      where lp.market_id = p_market and lp.status = 'active' and lp.ends_at > now())
  ) end;
$$;


--
-- Name: market_purchased_promo_balance(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_purchased_promo_balance(p_market uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select coalesce(sum(delta), 0)::int from public.market_promotion_credits where market_id = p_market; $$;


--
-- Name: markets_plan_change_reconcile(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.markets_plan_change_reconcile() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare allowance int; begin
  if new.plan is distinct from old.plan then
    allowance := coalesce((select max_pickup_locations from public.plan_limits where plan = new.plan), 1);
    with ranked as (
      select id, row_number() over (order by is_default desc, created_at asc) as rn
        from public.market_pickup_locations where market_id = new.id and active
    )
    update public.market_pickup_locations l
       set plan_restricted = (r.rn > allowance), updated_at = now()
      from ranked r where l.id = r.id;
  end if;
  return new;
end $$;


--
-- Name: my_market(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_market() RETURNS SETOF public.markets
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select m.* from public.markets m where m.owner_id = auth.uid();
$$;


--
-- Name: my_onboarding_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_onboarding_state() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  r   record;
  p   record;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into r from public.user_private_contact where user_id = uid;
  select onboarding_completed_at, name into p from public.profiles where id = uid;
  return jsonb_build_object(
    'completed',     p.onboarding_completed_at is not null,
    'display_name',  p.name,
    'first_name',    r.first_name,
    'last_name',     r.last_name,
    'phone',         r.phone_e164,
    'contact_email', r.contact_email,
    'missing', (
      select coalesce(jsonb_agg(k), '[]'::jsonb) from (
        select 'first_name' as k where r.first_name is null
        union all select 'last_name' where r.last_name is null
        union all select 'contact_email' where r.contact_email is null
      ) m
    )
  );
end;
$$;


--
-- Name: market_pickup_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_pickup_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    nickname text NOT NULL,
    location_type text DEFAULT 'PRIVATE_RESIDENCE'::text NOT NULL,
    address_line text,
    city text,
    state text,
    postal_code text,
    lat double precision,
    lng double precision,
    approx_lat double precision GENERATED ALWAYS AS ((round((lat)::numeric, 2))::double precision) STORED,
    approx_lng double precision GENERATED ALWAYS AS ((round((lng)::numeric, 2))::double precision) STORED,
    instructions text,
    public_address_visible boolean DEFAULT false NOT NULL,
    timezone text DEFAULT 'America/New_York'::text NOT NULL,
    slot_minutes integer DEFAULT 30 NOT NULL,
    lead_time_minutes integer DEFAULT 120 NOT NULL,
    max_orders_per_slot integer,
    active boolean DEFAULT true NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    plan_restricted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_pickup_locations_lead_time_minutes_check CHECK (((lead_time_minutes >= 0) AND (lead_time_minutes <= 10080))),
    CONSTRAINT market_pickup_locations_location_type_check CHECK ((location_type = ANY (ARRAY['PRIVATE_RESIDENCE'::text, 'PUBLIC_FARM_STAND'::text, 'PUBLIC_BUSINESS'::text, 'PUBLIC_MEETUP_POINT'::text, 'CUSTOM_PICKUP_POINT'::text]))),
    CONSTRAINT market_pickup_locations_max_orders_per_slot_check CHECK (((max_orders_per_slot IS NULL) OR (max_orders_per_slot > 0))),
    CONSTRAINT market_pickup_locations_slot_minutes_check CHECK ((slot_minutes = ANY (ARRAY[15, 30, 60])))
);


--
-- Name: my_pickup_locations(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_pickup_locations(p_market uuid) RETURNS SETOF public.market_pickup_locations
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select l.* from public.market_pickup_locations l
   where l.market_id = p_market
     and exists (select 1 from public.markets m
                  where m.id = l.market_id and m.owner_id = auth.uid())
   order by l.is_default desc, l.created_at;
$$;


--
-- Name: my_plan_entitlements(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_plan_entitlements() RETURNS TABLE(market_id uuid, plan public.market_plan, entitlement_source text, grant_expires_at timestamp with time zone, grant_reason text, plan_price_cents integer, subscription_status text, max_active_listings integer, active_listings integer, max_pickup_locations integer, extra_location_fee_cents integer, extra_pickup_locations integer, effective_pickup_locations integer, delivery_advanced boolean, ai_listing_assistant boolean, included_promotions_monthly integer, promotions_remaining integer, purchased_promotion_credits integer, promotions_reset_on date)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    m.id,
    ep.plan,
    ep.source,
    ep.grant_expires,
    (select g.reason from public.admin_plan_grants g where g.id = ep.grant_id),
    pl.price_cents,
    (select s.status from public.market_subscriptions s
      where s.market_id = m.id and s.kind = 'plan' order by s.created_at desc limit 1),
    pl.max_active_listings,
    public.market_active_listing_count(m.id),
    pl.max_pickup_locations,
    pl.extra_location_fee_cents,
    m.extra_pickup_locations,
    public.market_pickup_location_allowance(m.id),
    pl.advanced_delivery,
    pl.ai_listing_assistant,
    pl.included_boost_credits,
    public.market_boost_credits_remaining(m.id),
    public.market_purchased_promo_balance(m.id),
    (date_trunc('month', now()) + interval '1 month')::date
  from public.markets m
  cross join lateral public.market_effective_plan(m.id) ep
  join public.plan_limits pl on pl.plan = ep.plan
  where m.owner_id = auth.uid()
  limit 1;
$$;


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    name text DEFAULT 'Neighbor'::text NOT NULL,
    avatar_url text,
    zip_code text,
    city text,
    county text,
    state text,
    user_type public.user_type DEFAULT 'neighbor'::public.user_type NOT NULL,
    business_account boolean DEFAULT false NOT NULL,
    business_category text,
    can_post boolean DEFAULT true NOT NULL,
    can_claim boolean DEFAULT true NOT NULL,
    can_sponsor boolean DEFAULT false NOT NULL,
    can_create_promotions boolean DEFAULT false NOT NULL,
    can_offer_delivery boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    suspended boolean DEFAULT false NOT NULL,
    onboarding_completed_at timestamp with time zone
);


--
-- Name: my_profile(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_profile() RETURNS SETOF public.profiles
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select * from public.profiles where id = auth.uid();
$$;


--
-- Name: normalize_state(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_state(p_state text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
  select case
    when coalesce(btrim(p_state),'') = '' then null
    when upper(btrim(p_state)) ~ '^[A-Z]{2}$'
      and upper(btrim(p_state)) in (
        'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
        'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
        'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
        'PR','VI','GU','AS','MP','AA','AE','AP')
      then upper(btrim(p_state))
    else (select code from (values
      ('alabama','AL'),('alaska','AK'),('arizona','AZ'),('arkansas','AR'),('california','CA'),
      ('colorado','CO'),('connecticut','CT'),('delaware','DE'),('florida','FL'),('georgia','GA'),
      ('hawaii','HI'),('idaho','ID'),('illinois','IL'),('indiana','IN'),('iowa','IA'),
      ('kansas','KS'),('kentucky','KY'),('louisiana','LA'),('maine','ME'),('maryland','MD'),
      ('massachusetts','MA'),('michigan','MI'),('minnesota','MN'),('mississippi','MS'),
      ('missouri','MO'),('montana','MT'),('nebraska','NE'),('nevada','NV'),('new hampshire','NH'),
      ('new jersey','NJ'),('new mexico','NM'),('new york','NY'),('north carolina','NC'),
      ('north dakota','ND'),('ohio','OH'),('oklahoma','OK'),('oregon','OR'),('pennsylvania','PA'),
      ('rhode island','RI'),('south carolina','SC'),('south dakota','SD'),('tennessee','TN'),
      ('texas','TX'),('utah','UT'),('vermont','VT'),('virginia','VA'),('washington','WA'),
      ('west virginia','WV'),('wisconsin','WI'),('wyoming','WY'),('district of columbia','DC'),
      ('washington dc','DC'),('washington d.c.','DC'),('d.c.','DC'),
      ('puerto rico','PR'),('virgin islands','VI'),('u.s. virgin islands','VI'),
      ('guam','GU'),('american samoa','AS'),('northern mariana islands','MP')
    ) as m(name, code)
    where m.name = lower(regexp_replace(btrim(p_state), '\s+', ' ', 'g')))
  end;
$_$;


--
-- Name: order_delivery_details(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.order_delivery_details(p_order uuid) RETURNS TABLE(order_id uuid, fulfillment_type text, delivery_address text, delivery_city text, delivery_state text, delivery_postal_code text, delivery_notes text, delivery_distance_miles numeric, delivery_base_fee_cents integer, delivery_surcharge_cents integer, delivery_fee_cents integer, subtotal_cents integer, total_cents integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  o public.market_orders;
  v_is_buyer boolean;
  v_is_seller boolean;
  v_released boolean;
begin
  select * into o from public.market_orders where id = p_order;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  v_is_buyer := o.buyer_id = auth.uid();
  v_is_seller := exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid());
  if not (v_is_buyer or v_is_seller) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  v_released := v_is_buyer or o.status in ('CONFIRMED','READY','OUT_FOR_DELIVERY','COMPLETED');

  return query select
    o.id, o.fulfillment_type,
    case when v_released then o.delivery_address else null end,
    o.delivery_city, o.delivery_state,
    case when v_released then o.delivery_postal_code else null end,
    case when v_released then o.delivery_notes else null end,
    o.delivery_distance_miles,
    o.delivery_base_fee_cents, o.delivery_surcharge_cents, o.delivery_fee_cents,
    o.subtotal_cents,
    o.subtotal_cents + coalesce(o.delivery_fee_cents, 0);
end $$;


--
-- Name: order_pickup_details(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.order_pickup_details(p_order uuid) RETURNS TABLE(address text, instructions text, location_type text, nickname text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare o public.market_orders; v_is_owner boolean;
begin
  select * into o from public.market_orders where id = p_order;
  if o is null then return; end if;
  v_is_owner := exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid());
  if not v_is_owner and (o.buyer_id is distinct from auth.uid()
                         or o.status not in ('CONFIRMED','READY','COMPLETED')) then
    return;
  end if;
  return query
    select l.address_line, l.instructions, l.location_type,
           coalesce(o.pickup_location_name, l.nickname)
      from public.market_pickup_locations l
     where l.id = o.pickup_location_id;
end $$;


--
-- Name: owns_market(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.owns_market(mid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select exists (select 1 from public.markets m where m.id = mid and m.owner_id = auth.uid()); $$;


--
-- Name: plan_rank(public.market_plan); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.plan_rank(p public.market_plan) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select case p when 'free' then 0 when 'grower' then 1 when 'farm' then 2 when 'sponsor' then 3 end; $$;


--
-- Name: plot_grow_logs_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.plot_grow_logs_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.author_id := old.author_id;
  new.claim_id := old.claim_id;
  new.kind := old.kind;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;


--
-- Name: seed_drop_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seed_drop_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    cadence text DEFAULT 'seasonal'::text NOT NULL,
    status text DEFAULT 'incomplete'::text NOT NULL,
    packet_count integer DEFAULT 6 NOT NULL,
    next_order_date date,
    ship_name text,
    ship_address_line text,
    ship_city text,
    ship_state text,
    ship_postal_code text,
    profile_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    preferences text[] DEFAULT '{}'::text[] NOT NULL,
    exclusions text[] DEFAULT '{}'::text[] NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    billing_model text DEFAULT 'PAY_PER_SEASON'::text NOT NULL,
    price_cents integer DEFAULT 2499 NOT NULL,
    CONSTRAINT seed_drop_subscriptions_billing_model_check CHECK ((billing_model = ANY (ARRAY['PAY_PER_SEASON'::text, 'ANNUAL_PREPAID'::text]))),
    CONSTRAINT seed_drop_subscriptions_cadence_check CHECK ((cadence = ANY (ARRAY['monthly'::text, 'seasonal'::text]))),
    CONSTRAINT seed_drop_subscriptions_packet_count_check CHECK (((packet_count >= 1) AND (packet_count <= 24))),
    CONSTRAINT seed_drop_subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'cancelled'::text, 'payment_failed'::text, 'incomplete'::text])))
);


--
-- Name: price_from_sub(public.seed_drop_subscriptions); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.price_from_sub(s public.seed_drop_subscriptions) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select coalesce(s.price_cents, 2499); $$;


--
-- Name: promote_listing_purchased(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promote_listing_purchased(p_listing uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_market uuid; v_owner uuid; v_promo uuid;
begin
  select l.market_id, m.owner_id into v_market, v_owner
    from public.listings l join public.markets m on m.id = l.market_id
   where l.id = p_listing;
  if v_market is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_owner <> auth.uid() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  perform 1 from public.market_promotion_credits where market_id = v_market for update;
  if public.market_purchased_promo_balance(v_market) <= 0 then
    raise exception 'NO_PURCHASED_CREDITS' using errcode = 'P0001';
  end if;
  insert into public.listing_promotions (listing_id, market_id, source, status, created_by)
  values (p_listing, v_market, 'paid', 'active', auth.uid())
  returning id into v_promo;
  insert into public.market_promotion_credits (market_id, delta, reason, source, promotion_id, created_by)
  values (v_market, -1, 'Promotion activated', 'CONSUMED', v_promo, auth.uid());
  return v_promo;
end $$;


--
-- Name: propose_order_time(uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.propose_order_time(p_order uuid, p_start timestamp with time zone, p_end timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare o public.market_orders;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.markets m where m.id = o.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if o.status not in ('REQUESTED','CONFIRMED') then
    raise exception 'BAD_STATE: cannot propose a time on a % order', o.status using errcode = 'P0001';
  end if;
  update public.market_orders
     set status = 'TIME_PROPOSED', proposed_start = p_start, proposed_end = p_end, updated_at = now()
   where id = p_order;
end $$;


--
-- Name: public_pickup_locations(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.public_pickup_locations(p_market uuid) RETURNS TABLE(location_id uuid, nickname text, location_type text, public_address text, approx_lat double precision, approx_lng double precision, is_default boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select l.id, l.nickname, l.location_type,
         case when l.public_address_visible
                   and l.location_type in ('PUBLIC_FARM_STAND','PUBLIC_BUSINESS','PUBLIC_MEETUP_POINT')
              then l.address_line else null end,
         l.approx_lat, l.approx_lng, l.is_default
    from public.market_pickup_locations l
   where l.market_id = p_market and l.active and not l.plan_restricted
   order by l.is_default desc, l.nickname;
$$;


--
-- Name: publish_eligibility(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_eligibility(p_node_id uuid) RETURNS TABLE(allowed boolean, reason text, message text, jurisdiction text, jurisdiction_source text, classification text, credential_requirement text, issuing_agency text, official_source text, minimum_plan text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_user uuid := auth.uid();
  v_jur text;
  v_src text;
  r public.compliance_rules;
  verdict record;
begin
  if v_user is null then
    return query select false, 'NOT_SIGNED_IN', 'Sign in to publish a listing.',
      null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  if exists (select 1 from public.profiles p
              where p.id = v_user and upper(coalesce(p.state,'')) ~ '^[A-Z]{2}$') then
    v_src := 'profile';
  else
    v_src := 'default';
  end if;
  v_jur := public.seller_jurisdiction(v_user);

  select * into verdict from public.can_publish_in_node(p_node_id, v_user, v_jur);
  select * into r from public.effective_compliance_rule(p_node_id, v_jur);

  return query select
    verdict.allowed, verdict.reason, verdict.message,
    v_jur, v_src,
    (r.classification)::text, r.credential_requirement, r.issuing_agency,
    r.official_source, (r.minimum_plan)::text;
end $_$;


--
-- Name: publish_listing_draft(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_listing_draft(p_draft uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  uid    uuid := auth.uid();
  d      public.listing_drafts;
  mkt    uuid;
  new_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  select * into d from public.listing_drafts where id = p_draft;
  if d.id is null then raise exception 'DRAFT_NOT_FOUND'; end if;
  if d.owner_id <> uid then raise exception 'NOT_YOUR_DRAFT'; end if;
  if d.status <> 'pending' then raise exception 'DRAFT_NOT_PENDING'; end if;
  if coalesce(btrim(d.title), '') = '' then raise exception 'DRAFT_TITLE_REQUIRED'; end if;

  select id into mkt from public.markets where owner_id = uid limit 1;

  insert into public.listings (
    owner_id, market_id, title, description, category, taxonomy_node_id,
    listing_type, price_cents, unit, quantity, photos, status, expires_at
  ) values (
    uid, coalesce(d.market_id, mkt), btrim(d.title), d.description,
    coalesce(nullif(btrim(coalesce(d.category, '')), ''), 'produce'),
    d.taxonomy_node_id, d.listing_type,
    case when d.listing_type = 'sale' then d.price_cents else null end,
    d.unit, d.quantity, d.photos, 'active', now() + interval '30 days'
  ) returning id into new_id;

  update public.listing_drafts
     set status = 'published', published_listing_id = new_id, updated_at = now()
   where id = p_draft;

  return new_id;
end;
$$;


--
-- Name: reconcile_pickup_locations(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reconcile_pickup_locations(p_market uuid) RETURNS TABLE(kept integer, restricted integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  allowance int := public.market_pickup_location_allowance(p_market);
  v_kept int; v_restricted int;
begin
  if p_market is null then return; end if;
  if not (exists (select 1 from public.markets m
                   where m.id = p_market and m.owner_id = auth.uid())
          or public.is_admin()
          or (select auth.role()) = 'service_role') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  with ranked as (
    select id, row_number() over (order by is_default desc, created_at asc) as rn
      from public.market_pickup_locations
     where market_id = p_market and active
  ), upd as (
    update public.market_pickup_locations l
       set plan_restricted = (r.rn > allowance), updated_at = now()
      from ranked r
     where l.id = r.id and l.plan_restricted <> (r.rn > allowance)
    returning l.plan_restricted
  )
  select count(*) filter (where not plan_restricted),
         count(*) filter (where plan_restricted)
    into v_kept, v_restricted from upd;
  return query select coalesce(v_kept, 0), coalesce(v_restricted, 0);
end $$;


--
-- Name: record_sale(uuid, uuid, uuid, numeric, integer, integer, integer, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_sale(p_market uuid, p_listing uuid, p_claim uuid, p_quantity numeric, p_gross_cents integer, p_discount_cents integer, p_fee_cents integer, p_payment_method text, p_buyer_label text, p_notes text, p_source text DEFAULT 'manual'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare txn uuid; inv int;
begin
  if not public.owns_market(p_market) then raise exception 'not your market'; end if;
  if p_listing is not null then
    if not exists (select 1 from listings l where l.id = p_listing and l.market_id = p_market) then
      raise exception 'listing does not belong to this market';
    end if;
    select inventory_count into inv from listings where id = p_listing for update;
    if inv is not null then
      if inv < p_quantity then raise exception 'INSUFFICIENT_INVENTORY (% left)', inv; end if;
      update listings set inventory_count = inv - p_quantity::int where id = p_listing;
    end if;
  end if;
  insert into seller_transactions
    (market_id, listing_id, claim_id, source, quantity, gross_cents, discount_cents,
     fee_cents, payment_method, buyer_label, notes)
  values
    (p_market, p_listing, p_claim, coalesce(p_source,'manual'), p_quantity, p_gross_cents,
     coalesce(p_discount_cents,0), coalesce(p_fee_cents,0), p_payment_method,
     p_buyer_label, p_notes)
  returning id into txn;
  return txn;
end $$;


--
-- Name: release_seed_drop_items(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_seed_drop_items(p_order uuid, p_reason text DEFAULT 'released'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare it record;
begin
  for it in
    select * from seed_order_items
    where order_id = p_order and status = 'reserved'
    for update
  loop
    update seed_lots
       set current_qty = current_qty + it.qty_packets,
           status = case when status = 'depleted' then 'active' else status end,
           updated_at = now()
     where id = it.lot_id;
    insert into seed_inventory_log (lot_id, delta, reason, order_id)
    values (it.lot_id, it.qty_packets, p_reason, p_order);
    update seed_order_items set status = 'released', updated_at = now() where id = it.id;
  end loop;
end;
$$;


--
-- Name: respond_order_proposal(uuid, boolean, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.respond_order_proposal(p_order uuid, p_accept boolean, p_new_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_new_end timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare o public.market_orders; it record;
begin
  select * into o from public.market_orders where id = p_order for update;
  if o is null then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if o.buyer_id is distinct from auth.uid() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if o.status <> 'TIME_PROPOSED' then
    raise exception 'BAD_STATE: no pending time proposal' using errcode = 'P0001';
  end if;

  if p_accept then
    for it in select i.id as item_id, i.quantity, i.title, i.listing_id, l.inventory_count
                from public.market_order_items i
                join public.listings l on l.id = i.listing_id
               where i.order_id = p_order and not i.reserved
               for update of l
    loop
      if it.inventory_count is not null then
        if it.inventory_count < it.quantity then
          raise exception 'INSUFFICIENT_INVENTORY: %', it.title using errcode = 'P0001';
        end if;
        update public.listings set inventory_count = inventory_count - it.quantity::int
         where id = it.listing_id;
        update public.market_order_items set reserved = true where id = it.item_id;
      end if;
    end loop;
    update public.market_orders
       set status = 'CONFIRMED',
           confirmed_start = proposed_start, confirmed_end = proposed_end,
           proposed_start = null, proposed_end = null, updated_at = now()
     where id = p_order;
  else
    update public.market_orders
       set status = 'REQUESTED',
           requested_start = coalesce(p_new_start, requested_start),
           requested_end   = coalesce(p_new_end, requested_end),
           proposed_start = null, proposed_end = null, updated_at = now()
     where id = p_order;
  end if;
end $$;


--
-- Name: save_onboarding_contact(text, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_onboarding_contact(p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_complete boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  uid      uuid := auth.uid();
  fn       text;
  ln       text;
  ph       text;
  em       text;
  raw_ph   text;
  digits   text;
  clear_ph boolean := false;
  display  text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  fn := nullif(btrim(coalesce(p_first_name, '')), '');
  ln := nullif(btrim(coalesce(p_last_name, '')), '');
  em := lower(nullif(btrim(coalesce(p_email, '')), ''));

  if fn is not null and length(fn) > 60 then raise exception 'FIRST_NAME_TOO_LONG'; end if;
  if ln is not null and length(ln) > 60 then raise exception 'LAST_NAME_TOO_LONG'; end if;
  if em is not null and em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  -- Decide on the raw text, before any stripping, so a value that reduces to no
  -- digits is an error rather than an accidental "no phone given".
  raw_ph := btrim(coalesce(p_phone, ''));
  if p_phone is null then
    ph := null;
  elsif raw_ph = '' then
    ph := null;
    clear_ph := true;
  else
    if raw_ph !~ '^\+?[0-9 ()./-]+$' then raise exception 'INVALID_PHONE'; end if;
    digits := regexp_replace(raw_ph, '[^0-9]', '', 'g');
    if left(raw_ph, 1) = '+' then
      if length(digits) not between 7 and 15 then raise exception 'INVALID_PHONE'; end if;
      ph := '+' || digits;
    else
      if length(digits) = 11 and left(digits, 1) = '1' then digits := substr(digits, 2); end if;
      if length(digits) <> 10 then raise exception 'INVALID_PHONE'; end if;
      ph := '+1' || digits;
    end if;
  end if;

  insert into public.user_private_contact as c (user_id, first_name, last_name, phone_e164, contact_email)
  values (uid, fn, ln, ph, em)
  on conflict (user_id) do update set
    first_name    = coalesce(excluded.first_name,    c.first_name),
    last_name     = coalesce(excluded.last_name,     c.last_name),
    phone_e164    = case when clear_ph then null
                         else coalesce(excluded.phone_e164, c.phone_e164) end,
    contact_email = coalesce(excluded.contact_email, c.contact_email),
    updated_at    = now();

  -- Public display name = "First L." — never the full last name.
  select c.first_name, c.last_name into fn, ln
    from public.user_private_contact c where c.user_id = uid;
  if fn is not null then
    display := fn || case when ln is not null and ln <> '' then ' ' || upper(left(ln, 1)) || '.' else '' end;
    update public.profiles set name = display where id = uid;
  end if;

  if p_complete then
    update public.profiles set onboarding_completed_at = now()
    where id = uid and onboarding_completed_at is null;
  end if;

  return public.my_onboarding_state();
end;
$_$;


--
-- Name: screen_listing_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.screen_listing_text(p_text text) RETURNS TABLE(action text, term text, category text, rationale text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
  with cleaned as (select public.strip_address_spans(p_text) as t)
  select p.action, p.term, p.category, p.rationale
    from public.prohibited_terms p, cleaned c
   where p.active
     and not exists (
       select 1 from unnest(p.exempt_if) as ex
        where c.t ~* ('\m' || regexp_replace(ex, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\M'))
     and case
           when p.is_regex then c.t ~* p.term
           else c.t ~* (
             '\m' ||
             case when p.term ~ 'y$'
                  then regexp_replace(regexp_replace(p.term,'([.^$*+?()\[\]{}|\\])','\\\1','g'),'y$','(y|ies)')
                  else regexp_replace(p.term,'([.^$*+?()\[\]{}|\\])','\\\1','g') || '(s|es)?'
             end || '\M')
         end
   order by case p.action when 'BLOCK' then 0 else 1 end, length(p.term) desc;
$_$;


--
-- Name: seed_lots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seed_lots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seed_product_id uuid NOT NULL,
    supplier text,
    supplier_lot_number text,
    internal_lot_number text NOT NULL,
    purchase_date date,
    received_date date DEFAULT CURRENT_DATE NOT NULL,
    original_qty numeric NOT NULL,
    current_qty numeric NOT NULL,
    unit text DEFAULT 'packets'::text NOT NULL,
    seeds_per_unit numeric,
    cost_cents integer,
    germination_pct numeric,
    germination_test_date date,
    next_review_date date,
    storage_location text,
    condition_notes text,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seed_lots_current_qty_check CHECK ((current_qty >= (0)::numeric)),
    CONSTRAINT seed_lots_germination_pct_check CHECK (((germination_pct >= (0)::numeric) AND (germination_pct <= (100)::numeric))),
    CONSTRAINT seed_lots_original_qty_check CHECK ((original_qty >= (0)::numeric)),
    CONSTRAINT seed_lots_status_check CHECK ((status = ANY (ARRAY['fresh'::text, 'active'::text, 'aging'::text, 'needs_test'::text, 'quarantined'::text, 'failed'::text, 'depleted'::text, 'discarded'::text]))),
    CONSTRAINT seed_lots_unit_check CHECK ((unit = ANY (ARRAY['packets'::text, 'grams'::text, 'seeds'::text])))
);


--
-- Name: seed_lot_eligible(public.seed_lots); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_lot_eligible(l public.seed_lots) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select l.status in ('fresh','active','aging')
     and l.current_qty >= 1
     and l.unit = 'packets'
     and coalesce(l.germination_pct, 100) >= 70
     and (l.next_review_date is null or l.next_review_date >= current_date);
$$;


--
-- Name: seed_profile_matches(text, boolean, boolean, text[], text[], text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_profile_matches(p_preferred_sun text, p_beginner_friendly boolean, p_container_friendly boolean, p_suns text[], p_experiences text[], p_sizes text[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select
    -- Sun: no answer (or "unsure") means no filter. 'full' also accepts
    -- partial-sun crops, which tolerate more light than they need.
    (coalesce(array_length(p_suns, 1), 0) = 0
       or 'unsure' = any(p_suns)
       or p_preferred_sun = 'any'
       or p_preferred_sun = any(p_suns)
       or ('full' = any(p_suns) and p_preferred_sun = 'partial'))
  and
    -- Experience: only restrict to beginner-friendly when first-timer is the
    -- ONLY thing selected. Someone who is a first-timer AND experienced with
    -- something else doesn't need training wheels.
    (coalesce(array_length(p_experiences, 1), 0) = 0
       or p_experiences <> array['first_time']
       or p_beginner_friendly)
  and
    -- Space: container-only growers get container-friendly crops. A
    -- greenhouse or any in-ground bed lifts that restriction.
    (coalesce(array_length(p_sizes, 1), 0) = 0
       or not (p_sizes <@ array['windowsill','containers'])
       or p_container_friendly);
$$;


--
-- Name: seed_recommendations(integer, text[], text[], text[], text[], text[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_recommendations(p_zone integer DEFAULT 6, p_suns text[] DEFAULT '{}'::text[], p_experiences text[] DEFAULT '{}'::text[], p_sizes text[] DEFAULT '{}'::text[], p_preferences text[] DEFAULT '{}'::text[], p_exclusions text[] DEFAULT '{}'::text[], p_limit integer DEFAULT 24) RETURNS TABLE(product_id uuid, crop text, variety text, category text, description text, days_to_maturity integer, packet_seed_count integer, beginner_friendly boolean, container_friendly boolean, preferred_sun text, in_stock integer, recommended boolean, why text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare month0 int; shift int;
begin
  shift  := case when p_zone >= 8 then 1 when p_zone <= 4 then -1 else 0 end;
  month0 := ((extract(month from now())::int - 1 - shift) % 12 + 12) % 12 + 1;

  return query
  with avail as (
    select p.id, p.crop, p.variety, p.category, p.description,
           p.days_to_maturity, p.packet_seed_count, p.beginner_friendly,
           p.container_friendly, p.preferred_sun, p.tags,
           sum(l.current_qty)::int as qty,
           max(coalesce(l.germination_pct, 85)) as germ
      from public.seed_products p
      join public.seed_lots l on l.seed_product_id = p.id
     where p.active and public.seed_lot_eligible(l) and l.current_qty > 0
     group by p.id
  ), scored as (
    select a.*,
           (lower(a.crop) = any(p_preferences)
            or lower(a.category) = any(p_preferences)
            or exists (select 1 from unnest(a.tags) t where lower(t) = any(p_preferences))) as preferred,
           (a.sow_months_ok) as in_season
      from (select av.*, (select p2.sow_months @> array[month0]
                            from public.seed_products p2 where p2.id = av.id) as sow_months_ok
              from avail av) a
     where not (lower(a.crop) = any(p_exclusions))
       and not (lower(a.category) = any(p_exclusions))
       and public.seed_profile_matches(a.preferred_sun, a.beginner_friendly,
                                       a.container_friendly, p_suns, p_experiences, p_sizes)
  )
  select s.id, s.crop, s.variety, s.category, s.description,
         s.days_to_maturity, s.packet_seed_count, s.beginner_friendly,
         s.container_friendly, s.preferred_sun, s.qty,
         -- "recommended" = what Gnome would choose on its own; everything else
         -- is still offered so the buyer can overrule us.
         (s.in_season and s.qty > 0) as recommended,
         concat_ws(' · ',
           case when s.in_season then 'in season now' else 'out of season for your zone' end,
           case when s.preferred then 'matches what you picked' end,
           case when s.beginner_friendly then 'easy to grow' end,
           s.germ || '% germination')
    from scored s
   order by (s.in_season and s.qty > 0) desc, s.preferred desc, s.germ desc, s.crop
   limit greatest(1, least(p_limit, 60));
end $$;


--
-- Name: seed_sub_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_sub_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.status is distinct from old.status then
      if not (
        (old.status = 'active'    and new.status in ('paused','cancelled')) or
        (old.status = 'paused'    and new.status in ('active','cancelled')) or
        (old.status = 'incomplete' and new.status = 'cancelled')
      ) then
        raise exception 'BAD_TRANSITION: % → % is not yours to make', old.status, new.status
          using errcode = 'P0001';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;


--
-- Name: seed_sub_next_window(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_sub_next_window(p_sub uuid) RETURNS TABLE(window_id uuid, season_code text, year integer, join_cutoff date, ship_start date, ship_end date, eligible_now boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with s as (
    select sub.*, coalesce((sub.profile_snapshot->>'zone')::int,
                  (select zone from public.seed_profiles sp where sp.user_id = sub.user_id), 6) as zone
    from public.seed_drop_subscriptions sub where sub.id = p_sub
      and (auth.uid() = sub.user_id or public.admin_has_perm('seed_drop.view') or auth.uid() is null)
  )
  select w.id, w.season_code, w.year, w.join_cutoff, w.ship_start, w.ship_end,
         (current_date <= w.join_cutoff)
  from public.seed_season_windows w, s
  where w.active
    and s.zone between w.zone_min and w.zone_max
    and w.ship_end >= current_date
    and current_date <= w.join_cutoff
    and s.created_at::date <= w.join_cutoff   -- joined in time for this window
    and not exists (select 1 from public.seed_sub_season_skips k
                     where k.subscription_id = s.id and k.window_id = w.id)
    and not exists (select 1 from public.seed_orders o
                     where o.season_window_id = w.id and o.user_id = s.user_id
                       and o.status not in ('cancelled','refunded'))
  order by w.generation_date
  limit 1;
$$;


--
-- Name: seller_credentials_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seller_credentials_audit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_action text;
  v_reason text := null;
begin
  if v_actor is null then v_role := 'system';
  elsif public.is_admin() and v_actor <> new.seller_id then v_role := 'admin';
  else v_role := 'seller';
  end if;

  if tg_op = 'INSERT' then
    v_action := 'SUBMITTED';
  elsif old.status is not distinct from new.status then
    return new;
  elsif new.status = 'PENDING' and old.status in ('DENIED','RENEWAL_REQUIRED','EXPIRED','REVOKED') then
    v_action := 'RESUBMITTED';
  elsif new.status = 'APPROVED' then v_action := 'APPROVED';
  elsif new.status = 'DENIED' then v_action := 'DENIED'; v_reason := new.denial_reason;
  elsif new.status = 'RENEWAL_REQUIRED' then v_action := 'RESUBMISSION_REQUESTED'; v_reason := new.denial_reason;
  elsif new.status = 'REVOKED' then v_action := 'REVOKED'; v_reason := new.denial_reason;
  elsif new.status = 'EXPIRED' then v_action := 'EXPIRED';
  else v_action := 'STATUS_CHANGED';
  end if;

  insert into public.compliance_audit_log
    (credential_id, seller_id, actor_id, actor_role, action, old_status, new_status, reason)
  values
    (new.id, new.seller_id, v_actor, v_role, v_action,
     case when tg_op = 'UPDATE' then old.status else null end, new.status, v_reason);
  return new;
end $$;


--
-- Name: seller_is_cleared(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seller_is_cleared(p_seller uuid, p_class text, p_state text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1
      from public.seller_compliance_clearances c
      join public.compliance_classes k on k.compliance_class = c.compliance_class
      left join public.seller_credentials sc on sc.id = c.credential_id
     where c.seller_id = p_seller
       and c.compliance_class = p_class
       and public.normalize_state(c.state) is not null
       and public.normalize_state(c.state) = public.normalize_state(p_state)
       and c.status = 'ACTIVE'
       and c.rule_version = k.rule_version
       and (c.credential_id is null
            or (sc.status = 'APPROVED'
                and (sc.expiration_date is null or sc.expiration_date >= current_date)))
  );
$$;


--
-- Name: seller_jurisdiction(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seller_jurisdiction(p_user uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
  select coalesce(
    (select 'US-' || upper(p.state)
       from public.profiles p
      where p.id = p_user and upper(coalesce(p.state, '')) ~ '^[A-Z]{2}$'),
    'US-OH');
$_$;


--
-- Name: set_claim_responded_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_claim_responded_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.status in ('approved','declined') and new.responded_at is null then
    new.responded_at := now();
  end if;
  return new;
end;
$$;


--
-- Name: set_listing_slug(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_listing_slug() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.slug is null or btrim(new.slug) = '' then
    new.slug := public.gnome_slugify(new.title);
  end if;
  return new;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin new.updated_at := now(); return new; end;
$$;


--
-- Name: skip_next_seed_order(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.skip_next_seed_order(p_sub uuid) RETURNS date
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare s public.seed_drop_subscriptions;
begin
  select * into s from public.seed_drop_subscriptions
   where id = p_sub and (user_id = auth.uid() or public.is_admin())
   for update;
  if s is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if s.status <> 'active' or s.next_order_date is null then
    raise exception 'NOT_ACTIVE' using errcode = 'P0001';
  end if;
  update public.seed_drop_subscriptions
     set next_order_date = s.next_order_date
           + case when s.cadence = 'monthly' then interval '1 month' else interval '3 months' end,
         updated_at = now()
   where id = p_sub;
  return (select next_order_date from public.seed_drop_subscriptions where id = p_sub);
end $$;


--
-- Name: skip_onboarding(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.skip_onboarding() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  update public.profiles set onboarding_completed_at = now()
  where id = uid and onboarding_completed_at is null;
  return public.my_onboarding_state();
end;
$$;


--
-- Name: skip_season_window(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.skip_season_window(p_sub uuid, p_window uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare s public.seed_drop_subscriptions; w public.seed_season_windows;
begin
  select * into s from public.seed_drop_subscriptions where id = p_sub;
  if s is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if s.user_id <> auth.uid() and not public.admin_has_perm('seed_drop.manage') then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into w from public.seed_season_windows where id = p_window;
  if w is null then raise exception 'WINDOW_NOT_FOUND' using errcode = 'P0001'; end if;
  if current_date > w.generation_date then
    raise exception 'TOO_LATE_TO_SKIP: this Drop has already been generated' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.seed_orders o where o.season_window_id = p_window
              and o.user_id = s.user_id and o.status not in ('cancelled','refunded')) then
    raise exception 'ALREADY_GENERATED' using errcode = 'P0001';
  end if;
  insert into public.seed_sub_season_skips (subscription_id, window_id, source)
  values (p_sub, p_window, case when s.user_id = auth.uid() then 'user' else 'admin' end)
  on conflict do nothing;
end $$;


--
-- Name: strip_address_spans(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.strip_address_spans(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select regexp_replace(
           coalesce(p_text, ''),
           '(\m\d{1,6}\s+)?([A-Za-z''.-]+\s+){0,3}\m(st|street|rd|road|ave|avenue|blvd|boulevard|ln|lane|dr|drive|ct|court|cir|circle|way|pkwy|parkway|hwy|highway|ter|terrace|pl|place|trail|trl|route|rte)\M\.?',
           ' ', 'gi');
$$;


--
-- Name: strip_want_clauses(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.strip_want_clauses(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select case
    when coalesce(p_text,'') ~* '\m(trade|trading|swap|swapping|exchange|barter|bartering)\M'
      then regexp_replace(p_text, '\mfor\M[^.!?;]*', ' ', 'gi')
    else coalesce(p_text,'')
  end;
$$;


--
-- Name: sync_listing_featured(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_listing_featured() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.status = 'active' then
    update public.listings
      set is_featured = true, featured_until = new.ends_at
      where id = new.listing_id;
  elsif new.status in ('expired','cancelled') then
    if not exists (
      select 1 from public.listing_promotions
      where listing_id = new.listing_id and status = 'active' and id <> new.id
    ) then
      update public.listings
        set is_featured = false, featured_until = null
        where id = new.listing_id;
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: taxonomy_archive_cascade(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.taxonomy_archive_cascade() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: taxonomy_block_delete_in_use(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.taxonomy_block_delete_in_use() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if exists (select 1 from public.listings l where l.taxonomy_node_id = old.id) then
    raise exception 'TAXONOMY_NODE_IN_USE: archive this node instead of deleting it'
      using errcode = 'P0001';
  end if;
  return old;
end $$;


--
-- Name: user_has_paid_plan(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_has_paid_plan(p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.markets m
     where m.owner_id = p_user and m.plan <> 'free'::public.market_plan
  );
$$;


--
-- Name: validate_claim_option(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_claim_option() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare l public.listings; v_match boolean;
begin
  if new.selected_option_label is null and new.selected_taxonomy_node_id is null
     and not new.is_custom_option then
    return new;
  end if;
  select * into l from public.listings where id = new.listing_id;
  if l is null then return new; end if;

  if new.selected_taxonomy_node_id is not null
     and not exists (select 1 from public.marketplace_taxonomy_nodes
                     where id = new.selected_taxonomy_node_id and active) then
    raise exception 'CLAIM_TAXONOMY_INVALID' using errcode='P0001';
  end if;

  if new.is_custom_option then
    if l.request_options is not null and not coalesce(l.allow_custom_request, true) then
      raise exception 'CUSTOM_REQUEST_NOT_ALLOWED' using errcode='P0001';
    end if;
    return new;
  end if;

  if l.request_options is not null and jsonb_array_length(l.request_options) > 0 then
    select exists (
      select 1 from jsonb_array_elements(l.request_options) o
      where (new.selected_taxonomy_node_id is not null
              and (o->>'node_id')::uuid is not distinct from new.selected_taxonomy_node_id)
         or (new.selected_option_label is not null
              and lower(o->>'label') = lower(new.selected_option_label))
    ) into v_match;
    if not v_match then
      raise exception 'OPTION_NOT_OFFERED' using errcode='P0001';
    end if;
  end if;
  return new;
end $$;


--
-- Name: validate_request_options(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_request_options() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare opt jsonb; v_node uuid; v_count int := 0;
begin
  if new.request_options is null then return new; end if;
  if jsonb_typeof(new.request_options) <> 'array' then
    raise exception 'REQUEST_OPTIONS_NOT_ARRAY' using errcode='P0001';
  end if;
  if jsonb_array_length(new.request_options) > 20 then
    raise exception 'TOO_MANY_OPTIONS' using errcode='P0001';
  end if;
  for opt in select * from jsonb_array_elements(new.request_options) loop
    v_count := v_count + 1;
    if coalesce(btrim(opt->>'label'), '') = '' then
      raise exception 'OPTION_LABEL_REQUIRED' using errcode='P0001';
    end if;
    if opt->>'node_id' is not null then
      select id into v_node from public.marketplace_taxonomy_nodes
       where id = (opt->>'node_id')::uuid and active;
      if v_node is null then
        raise exception 'OPTION_TAXONOMY_INVALID: %', opt->>'node_id' using errcode='P0001';
      end if;
    end if;
  end loop;
  return new;
end $$;


--
-- Name: void_sale(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_sale(p_txn uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare t record;
begin
  select * into t from seller_transactions where id = p_txn for update;
  if not found or not public.owns_market(t.market_id) then raise exception 'not your transaction'; end if;
  if t.status = 'void' then return; end if;
  update seller_transactions
     set status = 'void', void_reason = coalesce(p_reason,'corrected'), updated_at = now()
   where id = p_txn;
  if t.listing_id is not null then
    update listings set inventory_count = coalesce(inventory_count, 0) + t.quantity::int
    where id = t.listing_id and inventory_count is not null;
  end if;
end $$;


--
-- Name: admin_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_log (
    id bigint NOT NULL,
    actor_id uuid,
    actor_type text DEFAULT 'ADMIN'::text NOT NULL,
    action text NOT NULL,
    resource_type text,
    resource_id text,
    old_state jsonb,
    new_state jsonb,
    reason text,
    approval_request_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_audit_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['OWNER'::text, 'ADMIN'::text, 'AI_AGENT'::text, 'SYSTEM'::text])))
);


--
-- Name: admin_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.admin_audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: admin_plan_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_plan_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    user_id uuid NOT NULL,
    plan public.market_plan NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    reason text NOT NULL,
    internal_note text,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    modified_by uuid,
    modified_at timestamp with time zone,
    revoked_by uuid,
    revoked_at timestamp with time zone,
    CONSTRAINT admin_plan_grants_plan_check CHECK ((plan = ANY (ARRAY['grower'::public.market_plan, 'farm'::public.market_plan, 'sponsor'::public.market_plan]))),
    CONSTRAINT admin_plan_grants_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REVOKED'::text])))
);


--
-- Name: admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admins (
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_action_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_action_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    requested_action text NOT NULL,
    resource_type text,
    resource_id text,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    payload_hash text NOT NULL,
    human_summary text NOT NULL,
    reason text,
    risk_level integer DEFAULT 2 NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    executed_at timestamp with time zone,
    execution_result jsonb,
    dry_run boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    CONSTRAINT ai_action_requests_risk_level_check CHECK (((risk_level >= 1) AND (risk_level <= 3))),
    CONSTRAINT ai_action_requests_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'EXECUTED'::text, 'FAILED'::text, 'EXPIRED'::text])))
);


--
-- Name: ai_chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);


--
-- Name: ai_daily_counter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_daily_counter (
    user_id uuid NOT NULL,
    feature text NOT NULL,
    day date NOT NULL,
    count integer DEFAULT 0 NOT NULL
);


--
-- Name: ai_room_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_room_messages (
    id bigint NOT NULL,
    room_id uuid NOT NULL,
    sender_type text NOT NULL,
    sender_admin_id uuid,
    sender_agent_id text,
    content text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_room_messages_sender_type_check CHECK ((sender_type = ANY (ARRAY['admin'::text, 'agent'::text, 'system'::text])))
);


--
-- Name: ai_room_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ai_room_messages ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ai_room_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ai_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    created_by uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    agent_ids text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_rooms_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text, 'budget_locked'::text])))
);


--
-- Name: ai_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_settings (
    id boolean DEFAULT true NOT NULL,
    writes_paused boolean DEFAULT true NOT NULL,
    reads_enabled boolean DEFAULT true NOT NULL,
    listing_daily_limit integer DEFAULT 20 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    allow_paid_fallback boolean DEFAULT false NOT NULL,
    CONSTRAINT ai_settings_id_check CHECK (id)
);


--
-- Name: ai_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage (
    user_id uuid NOT NULL,
    day date DEFAULT ((now() AT TIME ZONE 'utc'::text))::date NOT NULL,
    feature text NOT NULL,
    count integer DEFAULT 0 NOT NULL
);


--
-- Name: ai_usage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_log (
    id bigint NOT NULL,
    agent_id text,
    feature text NOT NULL,
    user_id uuid,
    market_id uuid,
    effective_plan text,
    provider text,
    model text,
    images integer DEFAULT 0 NOT NULL,
    input_tokens integer,
    output_tokens integer,
    tool_calls integer DEFAULT 0 NOT NULL,
    estimated_cost_cents numeric(10,4),
    duration_ms integer,
    success boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actual_cost_cents numeric,
    free_tier boolean,
    room_id uuid
);


--
-- Name: ai_usage_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ai_usage_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ai_usage_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: billing_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_config (
    id boolean DEFAULT true NOT NULL,
    payments_live_enabled boolean DEFAULT false NOT NULL,
    stripe_mode text DEFAULT 'test'::text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT billing_config_id_check CHECK (id),
    CONSTRAINT billing_config_stripe_mode_check CHECK ((stripe_mode = ANY (ARRAY['test'::text, 'live'::text])))
);


--
-- Name: billing_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_events (
    id bigint NOT NULL,
    stripe_event_id text,
    type text NOT NULL,
    livemode boolean,
    market_id uuid,
    user_id uuid,
    product_key text,
    amount_cents integer,
    effect text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: billing_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.billing_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.billing_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: billing_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_products (
    key text NOT NULL,
    kind text NOT NULL,
    description text NOT NULL,
    unit_amount_cents integer,
    currency text DEFAULT 'usd'::text NOT NULL,
    stripe_product_id text,
    stripe_price_id text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stripe_product_id_test text,
    stripe_price_id_test text,
    stripe_product_id_live text,
    stripe_price_id_live text,
    CONSTRAINT billing_products_kind_check CHECK ((kind = ANY (ARRAY['subscription'::text, 'one_time'::text, 'addon'::text])))
);


--
-- Name: buyer_delivery_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buyer_delivery_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_id uuid NOT NULL,
    label text DEFAULT 'Home'::text NOT NULL,
    address_line text NOT NULL,
    city text,
    state text,
    postal_code text,
    lat double precision,
    lng double precision,
    delivery_notes text,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT buyer_delivery_addresses_address_line_check CHECK (((char_length(address_line) >= 3) AND (char_length(address_line) <= 200))),
    CONSTRAINT buyer_delivery_addresses_delivery_notes_check CHECK ((char_length(delivery_notes) <= 500)),
    CONSTRAINT buyer_delivery_addresses_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 40)))
);


--
-- Name: claim_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claim_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reported_at timestamp with time zone,
    kind text DEFAULT 'message'::text NOT NULL,
    photo_url text,
    CONSTRAINT claim_messages_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 500))),
    CONSTRAINT claim_messages_kind_check CHECK ((kind = ANY (ARRAY['message'::text, 'update'::text]))),
    CONSTRAINT claim_messages_photo_url_check CHECK (((photo_url IS NULL) OR ((length(photo_url) < 500) AND (photo_url ~~ 'https://fgybyghwcjlstqxkclch.supabase.co/storage/v1/object/public/listing-images/%'::text))))
);

ALTER TABLE ONLY public.claim_messages REPLICA IDENTITY FULL;


--
-- Name: claim_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claim_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid NOT NULL,
    claimer_id uuid NOT NULL,
    status public.claim_status DEFAULT 'pending'::public.claim_status NOT NULL,
    fulfillment_method text DEFAULT 'pickup'::text NOT NULL,
    assigned_fulfiller_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claim_type text DEFAULT 'claim'::text NOT NULL,
    quantity_requested integer,
    buyer_note text,
    trade_offer_text text,
    agreed_price_cents integer,
    payment_status public.listing_payment_status DEFAULT 'none'::public.listing_payment_status NOT NULL,
    responded_at timestamp with time zone,
    selected_option_label text,
    selected_taxonomy_node_id uuid,
    is_custom_option boolean DEFAULT false NOT NULL,
    CONSTRAINT claims_claim_type_check CHECK ((claim_type = ANY (ARRAY['claim'::text, 'trade_offer'::text, 'purchase_request'::text, 'wanted_response'::text, 'plot_reservation'::text]))),
    CONSTRAINT claims_plot_reservation_chk CHECK (((claim_type <> 'plot_reservation'::text) OR ((buyer_note IS NOT NULL) AND (length(btrim(buyer_note)) > 0) AND (agreed_price_cents IS NOT NULL) AND (agreed_price_cents >= 0)))),
    CONSTRAINT claims_purchase_price_chk CHECK (((claim_type <> 'purchase_request'::text) OR ((agreed_price_cents IS NOT NULL) AND (agreed_price_cents >= 0)))),
    CONSTRAINT claims_qty_requested_chk CHECK (((quantity_requested IS NULL) OR (quantity_requested > 0))),
    CONSTRAINT claims_trade_offer_chk CHECK (((claim_type <> 'trade_offer'::text) OR ((trade_offer_text IS NOT NULL) AND (length(btrim(trade_offer_text)) > 0))))
);


--
-- Name: compliance_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_audit_log (
    id bigint NOT NULL,
    credential_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    actor_id uuid,
    actor_role text NOT NULL,
    action text NOT NULL,
    old_status public.credential_status,
    new_status public.credential_status,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: compliance_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.compliance_audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.compliance_audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: credential_taxonomy_scope; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credential_taxonomy_scope (
    credential_id uuid NOT NULL,
    taxonomy_node_id uuid NOT NULL
);


--
-- Name: device_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_tokens (
    token text NOT NULL,
    user_id uuid NOT NULL,
    platform text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    event_type text NOT NULL,
    listing_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feedback_body_check CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 2000)))
);


--
-- Name: germination_tests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.germination_tests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_id uuid NOT NULL,
    test_date date DEFAULT CURRENT_DATE NOT NULL,
    seeds_tested integer NOT NULL,
    germinated integer NOT NULL,
    pct numeric GENERATED ALWAYS AS (round((((germinated)::numeric / (seeds_tested)::numeric) * (100)::numeric), 1)) STORED,
    tester text,
    notes text,
    next_review_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT germination_tests_germinated_check CHECK ((germinated >= 0)),
    CONSTRAINT germination_tests_seeds_tested_check CHECK ((seeds_tested > 0))
);


--
-- Name: legacy_category_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legacy_category_map (
    legacy_category text NOT NULL,
    taxonomy_path text NOT NULL
);


--
-- Name: listing_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    market_id uuid,
    batch_id uuid,
    source text DEFAULT 'ai_photo'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    title text,
    description text,
    category text,
    taxonomy_node_id uuid,
    listing_type public.listing_type DEFAULT 'sale'::public.listing_type NOT NULL,
    price_cents integer,
    unit text,
    quantity text,
    photos text[] DEFAULT '{}'::text[] NOT NULL,
    ai_confidence numeric,
    ai_candidate_name text,
    ai_alternatives text[] DEFAULT '{}'::text[] NOT NULL,
    ai_seller_questions text[] DEFAULT '{}'::text[] NOT NULL,
    compliance_attention boolean DEFAULT false NOT NULL,
    published_listing_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT listing_drafts_price_cents_check CHECK (((price_cents IS NULL) OR (price_cents >= 0))),
    CONSTRAINT listing_drafts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'published'::text, 'discarded'::text])))
);


--
-- Name: TABLE listing_drafts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.listing_drafts IS 'AI-generated listing drafts awaiting owner approval. Inserted by the edge function (service role) only; publishing goes through a normal listings INSERT so all plan-limit and validation triggers still apply.';


--
-- Name: listing_pickup_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_pickup_locations (
    listing_id uuid NOT NULL,
    location_id uuid NOT NULL
);


--
-- Name: listing_promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid NOT NULL,
    market_id uuid NOT NULL,
    source public.promotion_source DEFAULT 'manual'::public.promotion_source NOT NULL,
    status public.promotion_status DEFAULT 'draft'::public.promotion_status NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    price_cents integer,
    currency text DEFAULT 'USD'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    stripe_livemode boolean
);


--
-- Name: market_delivery_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_delivery_settings (
    market_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    radius_miles numeric(5,1),
    flat_fee_cents integer DEFAULT 0 NOT NULL,
    surcharge_after_miles numeric(5,1),
    surcharge_fee_cents integer,
    same_day boolean DEFAULT false NOT NULL,
    same_day_cutoff time without time zone,
    next_day boolean DEFAULT false NOT NULL,
    next_day_cutoff time without time zone,
    scheduled boolean DEFAULT false NOT NULL,
    order_by_dow smallint,
    delivery_dows smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    tz text DEFAULT 'America/New_York'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT delivery_dows_valid CHECK ((delivery_dows <@ ARRAY[(0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint])),
    CONSTRAINT delivery_scheduled_shape CHECK (((NOT scheduled) OR ((order_by_dow IS NOT NULL) AND (cardinality(delivery_dows) > 0)))),
    CONSTRAINT delivery_surcharge_pair CHECK (((surcharge_after_miles IS NULL) = (surcharge_fee_cents IS NULL))),
    CONSTRAINT market_delivery_settings_flat_fee_cents_check CHECK ((flat_fee_cents >= 0)),
    CONSTRAINT market_delivery_settings_notes_check CHECK ((char_length(notes) <= 500)),
    CONSTRAINT market_delivery_settings_order_by_dow_check CHECK (((order_by_dow >= 0) AND (order_by_dow <= 6))),
    CONSTRAINT market_delivery_settings_radius_miles_check CHECK (((radius_miles > (0)::numeric) AND (radius_miles <= (100)::numeric))),
    CONSTRAINT market_delivery_settings_surcharge_after_miles_check CHECK ((surcharge_after_miles > (0)::numeric)),
    CONSTRAINT market_delivery_settings_surcharge_fee_cents_check CHECK ((surcharge_fee_cents >= 0))
);


--
-- Name: market_follows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_follows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    follower_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: market_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'owner'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'staff'::text])))
);


--
-- Name: market_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    date date NOT NULL,
    listing_views integer DEFAULT 0 NOT NULL,
    profile_views integer DEFAULT 0 NOT NULL,
    claims_received integer DEFAULT 0 NOT NULL,
    claims_approved integer DEFAULT 0 NOT NULL,
    messages_received integer DEFAULT 0 NOT NULL,
    followers_gained integer DEFAULT 0 NOT NULL,
    free_listings_created integer DEFAULT 0 NOT NULL,
    trade_listings_created integer DEFAULT 0 NOT NULL,
    sale_listings_created integer DEFAULT 0 NOT NULL
);


--
-- Name: market_order_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_order_events (
    id bigint NOT NULL,
    order_id uuid NOT NULL,
    actor_id uuid,
    actor_role text NOT NULL,
    old_status public.market_order_status,
    new_status public.market_order_status NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: market_order_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.market_order_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.market_order_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: market_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    listing_id uuid,
    title text NOT NULL,
    unit text,
    quantity numeric NOT NULL,
    unit_price_cents integer DEFAULT 0 NOT NULL,
    item_total_cents integer DEFAULT 0 NOT NULL,
    taxonomy_node_id uuid,
    reserved boolean DEFAULT false NOT NULL,
    CONSTRAINT market_order_items_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: market_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    status public.market_order_status DEFAULT 'REQUESTED'::public.market_order_status NOT NULL,
    requested_start timestamp with time zone NOT NULL,
    requested_end timestamp with time zone NOT NULL,
    confirmed_start timestamp with time zone,
    confirmed_end timestamp with time zone,
    proposed_start timestamp with time zone,
    proposed_end timestamp with time zone,
    timezone text NOT NULL,
    subtotal_cents integer DEFAULT 0 NOT NULL,
    buyer_note text,
    decline_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pickup_location_id uuid,
    pickup_location_name text,
    pickup_location_type text,
    fulfillment_type text DEFAULT 'pickup'::text NOT NULL,
    delivery_address_id uuid,
    delivery_address text,
    delivery_city text,
    delivery_state text,
    delivery_postal_code text,
    delivery_notes text,
    delivery_distance_miles numeric(5,1),
    delivery_base_fee_cents integer,
    delivery_surcharge_cents integer,
    delivery_fee_cents integer,
    delivery_rule jsonb,
    CONSTRAINT market_orders_fulfillment_type_check CHECK ((fulfillment_type = ANY (ARRAY['pickup'::text, 'delivery'::text])))
);


--
-- Name: market_payment_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_payment_methods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    method text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    handle text,
    label text,
    instructions text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_payment_methods_method_check CHECK ((method = ANY (ARRAY['venmo'::text, 'paypal'::text, 'cashapp'::text, 'zelle'::text, 'cash'::text, 'other'::text])))
);


--
-- Name: market_pickup_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_pickup_exceptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    date date NOT NULL,
    closed boolean DEFAULT true NOT NULL,
    start_minute integer,
    end_minute integer,
    note text,
    location_id uuid,
    CONSTRAINT market_pickup_exceptions_check CHECK ((closed OR ((start_minute IS NOT NULL) AND (end_minute IS NOT NULL) AND (start_minute < end_minute)))),
    CONSTRAINT market_pickup_exceptions_end_minute_check CHECK (((end_minute >= 1) AND (end_minute <= 1440))),
    CONSTRAINT market_pickup_exceptions_start_minute_check CHECK (((start_minute >= 0) AND (start_minute <= 1439)))
);


--
-- Name: market_pickup_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_pickup_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    weekday integer NOT NULL,
    start_minute integer NOT NULL,
    end_minute integer NOT NULL,
    location_id uuid,
    CONSTRAINT market_pickup_hours_check CHECK ((start_minute < end_minute)),
    CONSTRAINT market_pickup_hours_end_minute_check CHECK (((end_minute >= 1) AND (end_minute <= 1440))),
    CONSTRAINT market_pickup_hours_start_minute_check CHECK (((start_minute >= 0) AND (start_minute <= 1439))),
    CONSTRAINT market_pickup_hours_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


--
-- Name: market_pickup_private; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_pickup_private (
    market_id uuid NOT NULL,
    pickup_address text,
    pickup_instructions text,
    instructions_public boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: market_pickup_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_pickup_settings (
    market_id uuid NOT NULL,
    timezone text DEFAULT 'America/New_York'::text NOT NULL,
    slot_minutes integer DEFAULT 30 NOT NULL,
    lead_time_minutes integer DEFAULT 120 NOT NULL,
    max_orders_per_slot integer,
    location_type text DEFAULT 'PRIVATE_RESIDENCE'::text NOT NULL,
    public_address text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_pickup_settings_lead_time_minutes_check CHECK (((lead_time_minutes >= 0) AND (lead_time_minutes <= 10080))),
    CONSTRAINT market_pickup_settings_location_type_check CHECK ((location_type = ANY (ARRAY['PRIVATE_RESIDENCE'::text, 'PUBLIC_BUSINESS'::text, 'CUSTOM_PICKUP_POINT'::text]))),
    CONSTRAINT market_pickup_settings_max_orders_per_slot_check CHECK (((max_orders_per_slot IS NULL) OR (max_orders_per_slot > 0))),
    CONSTRAINT market_pickup_settings_slot_minutes_check CHECK ((slot_minutes = ANY (ARRAY[15, 30, 60])))
);


--
-- Name: market_promotion_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_promotion_credits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    delta integer NOT NULL,
    reason text NOT NULL,
    source text NOT NULL,
    stripe_session_id text,
    promotion_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    stripe_livemode boolean,
    CONSTRAINT market_promotion_credits_delta_check CHECK ((delta <> 0)),
    CONSTRAINT market_promotion_credits_source_check CHECK ((source = ANY (ARRAY['PURCHASED_SINGLE'::text, 'PURCHASED_PACK_3'::text, 'PURCHASED_PACK_10'::text, 'ADMIN_COMP'::text, 'REFUND'::text, 'CONSUMED'::text])))
);


--
-- Name: market_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    plan public.market_plan NOT NULL,
    provider text,
    customer_id text,
    subscription_id text,
    status text,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'plan'::text NOT NULL,
    stripe_livemode boolean,
    CONSTRAINT market_subscriptions_kind_check CHECK ((kind = ANY (ARRAY['plan'::text, 'addon'::text])))
);


--
-- Name: marketplace_taxonomy_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_taxonomy_nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_id uuid,
    name text NOT NULL,
    slug text NOT NULL,
    path text NOT NULL,
    depth integer DEFAULT 0 NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    archived_at timestamp with time zone,
    search_synonyms text[] DEFAULT '{}'::text[] NOT NULL,
    icon text,
    requires_compliance_review boolean DEFAULT false NOT NULL,
    compliance_classification public.compliance_classification DEFAULT 'GENERALLY_UNRESTRICTED'::public.compliance_classification NOT NULL,
    minimum_plan_tier public.market_plan DEFAULT 'free'::public.market_plan NOT NULL,
    local_pickup_only boolean DEFAULT false NOT NULL,
    shipping_policy text,
    prohibited boolean DEFAULT false NOT NULL,
    required_listing_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    compliance_class text
);


--
-- Name: plan_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_limits (
    plan public.market_plan NOT NULL,
    max_active_listings integer,
    max_photos integer NOT NULL,
    analytics boolean DEFAULT false NOT NULL,
    featured boolean DEFAULT false NOT NULL,
    delivery_eligible boolean DEFAULT false NOT NULL,
    price_cents integer DEFAULT 0 NOT NULL,
    included_boost_credits integer DEFAULT 0 NOT NULL,
    max_pickup_locations integer DEFAULT 1 NOT NULL,
    extra_location_fee_cents integer,
    ai_listing_assistant boolean DEFAULT false NOT NULL,
    advanced_delivery boolean DEFAULT false NOT NULL
);


--
-- Name: plot_crops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plot_crops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_id uuid NOT NULL,
    taxonomy_node_id uuid,
    name text NOT NULL,
    variety text,
    planted_at date,
    expected_harvest date,
    status text DEFAULT 'growing'::text NOT NULL,
    quantity integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plot_crops_quantity_check CHECK (((quantity IS NULL) OR (quantity > 0))),
    CONSTRAINT plot_crops_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'growing'::text, 'harvested'::text, 'finished'::text])))
);


--
-- Name: plot_grow_log_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plot_grow_log_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    log_id uuid NOT NULL,
    storage_path text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: plot_grow_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plot_grow_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_id uuid NOT NULL,
    author_id uuid NOT NULL,
    kind text DEFAULT 'entry'::text NOT NULL,
    stage text,
    title text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plot_grow_logs_kind_check CHECK ((kind = ANY (ARRAY['entry'::text, 'owner_note'::text]))),
    CONSTRAINT plot_grow_logs_stage_check CHECK (((stage IS NULL) OR (stage = ANY (ARRAY['PLOT_PREP'::text, 'PLANTED'::text, 'SPROUTED'::text, 'GROWING'::text, 'FLOWERING'::text, 'FRUITING'::text, 'HARVESTING'::text, 'FINISHED'::text]))))
);


--
-- Name: public_active_promotions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.public_active_promotions AS
 SELECT id,
    listing_id,
    market_id,
    starts_at,
    ends_at
   FROM public.listing_promotions p
  WHERE ((status = 'active'::public.promotion_status) AND (ends_at > now()));


--
-- Name: public_listings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.public_listings AS
 SELECT l.id,
    l.slug,
    l.title,
    l.description,
    l.category,
    l.listing_type,
    l.status,
    l.price_cents,
    l.currency,
    l.trade_for,
    l.quantity,
    l.unit,
    l.photos,
    l.city,
    l.county,
    l.state,
    l.fulfillment_type,
    l.market_id,
    m.name AS market_name,
    m.slug AS market_slug,
    m.avatar_url AS market_avatar_url,
    m.market_type,
    m.verified AS market_verified,
    l.created_at,
    l.expires_at,
    l.is_featured,
    l.featured_until,
    (EXISTS ( SELECT 1
           FROM public.listing_promotions p
          WHERE ((p.listing_id = l.id) AND (p.status = 'active'::public.promotion_status) AND (p.ends_at > now())))) AS has_active_promotion,
    l.approx_lat,
    l.approx_lng,
    l.is_demo,
    l.market_position,
    l.market_featured,
    l.taxonomy_node_id,
    l.inventory_count,
    l.request_options,
    l.allow_custom_request
   FROM (public.listings l
     JOIN public.markets m ON ((m.id = l.market_id)))
  WHERE ((l.status = 'active'::public.listing_status) AND (l.expires_at > now()) AND (m.status = 'active'::public.market_status));


--
-- Name: public_markets; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.public_markets AS
 SELECT m.id,
    m.slug,
    m.name,
    m.description,
    m.market_type,
    m.status,
    m.avatar_url,
    m.banner_url,
    m.city,
    m.county,
    m.state,
    m.verified,
    m.sponsor_visible,
    m.website_url,
    m.instagram_url,
    m.facebook_url,
    m.created_at,
    m.created_at AS member_since,
    ( SELECT count(*) AS count
           FROM public.listings l
          WHERE ((l.market_id = m.id) AND (l.status = 'active'::public.listing_status) AND (l.expires_at > now()))) AS active_listing_count,
    ( SELECT count(*) AS count
           FROM public.listings l
          WHERE ((l.market_id = m.id) AND (l.status = 'completed'::public.listing_status) AND (l.listing_type = 'free'::public.listing_type))) AS listings_shared,
    ( SELECT count(*) AS count
           FROM (public.claims c
             JOIN public.listings l ON ((l.id = c.listing_id)))
          WHERE ((l.market_id = m.id) AND (c.claim_type = 'purchase_request'::text) AND (c.status = 'completed'::public.claim_status))) AS listings_sold,
    ( SELECT count(*) AS count
           FROM (public.claims c
             JOIN public.listings l ON ((l.id = c.listing_id)))
          WHERE ((l.market_id = m.id) AND (c.claim_type = 'trade_offer'::text) AND (c.status = 'completed'::public.claim_status))) AS trades_completed,
    rr.response_rate,
    (EXISTS ( SELECT 1
           FROM auth.users u
          WHERE ((u.id = m.owner_id) AND (u.email_confirmed_at IS NOT NULL)))) AS verified_email,
    m.tagline,
    m.theme
   FROM (public.markets m
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN (count(*) >= 5) THEN round(((100.0 * (count(*) FILTER (WHERE ((c.responded_at IS NOT NULL) AND (c.responded_at <= (c.created_at + '48:00:00'::interval)))))::numeric) / (count(*))::numeric))
                    ELSE NULL::numeric
                END AS response_rate
           FROM (public.claims c
             JOIN public.listings l ON ((l.id = c.listing_id)))
          WHERE ((l.market_id = m.id) AND (c.status <> 'cancelled'::public.claim_status))) rr ON (true))
  WHERE (m.status = 'active'::public.market_status);


--
-- Name: public_profiles; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.public_profiles WITH (security_invoker='false', security_barrier='true') AS
 SELECT id,
    name,
    avatar_url,
    city,
    county,
    state,
    user_type,
    business_account,
    business_category,
    created_at
   FROM public.profiles p;


--
-- Name: VIEW public_profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.public_profiles IS 'The ONLY profile projection other users and anonymous visitors may read. Columns are enumerated on purpose: never use select *, so a new column on profiles is not exposed automatically. Excludes administrative flags (can_*, suspended), onboarding state, and anything from user_private_contact. Runs with the view owner''s rights (security_invoker=false) BY DESIGN — that is what lets it serve public fields while the base table stays owner/admin-only.';


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reporter_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    admin_notes text,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    CONSTRAINT reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'reviewed'::text, 'actioned'::text, 'dismissed'::text]))),
    CONSTRAINT reports_target_type_check CHECK ((target_type = ANY (ARRAY['listing'::text, 'market'::text, 'claim'::text, 'message'::text, 'user'::text])))
);


--
-- Name: seed_inventory_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seed_inventory_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_id uuid NOT NULL,
    delta numeric NOT NULL,
    reason text NOT NULL,
    order_id uuid,
    actor uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: seed_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seed_order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    seed_product_id uuid NOT NULL,
    lot_id uuid NOT NULL,
    qty_packets integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'reserved'::text NOT NULL,
    substituted_from uuid,
    substitution_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seed_order_items_status_check CHECK ((status = ANY (ARRAY['reserved'::text, 'picked'::text, 'packed'::text, 'shipped'::text, 'released'::text, 'substituted'::text])))
);


--
-- Name: seed_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seed_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    product text DEFAULT 'starter'::text NOT NULL,
    packet_count integer DEFAULT 6 NOT NULL,
    status text DEFAULT 'paid'::text NOT NULL,
    profile_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    stripe_session_id text,
    amount_cents integer,
    tracking text,
    planting_confirmed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    season_window_id uuid,
    postage_cents integer,
    packaging_cents integer,
    insert_cents integer,
    payment_fee_cents integer,
    other_cost_cents integer,
    stripe_livemode boolean,
    CONSTRAINT seed_orders_status_check CHECK ((status = ANY (ARRAY['pending_payment'::text, 'paid'::text, 'selected'::text, 'needs_review'::text, 'packed'::text, 'shipped'::text, 'cancelled'::text, 'refunded'::text])))
);


--
-- Name: seed_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seed_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    crop text NOT NULL,
    variety text NOT NULL,
    botanical_name text,
    description text,
    category text NOT NULL,
    days_to_germination integer,
    days_to_maturity integer,
    preferred_sun text DEFAULT 'full'::text NOT NULL,
    direct_sow_allowed boolean DEFAULT true NOT NULL,
    transplant_recommended boolean DEFAULT false NOT NULL,
    spacing_inches numeric,
    planting_depth_inches numeric,
    sow_months integer[] DEFAULT '{}'::integer[] NOT NULL,
    beginner_friendly boolean DEFAULT true NOT NULL,
    container_friendly boolean DEFAULT false NOT NULL,
    packet_seed_count integer DEFAULT 25 NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reorder_threshold integer,
    sku text,
    supplier text,
    supplier_product_code text,
    packet_size text,
    barcode text,
    cost_cents integer,
    suggested_reorder_qty integer,
    image_url text,
    archived boolean DEFAULT false NOT NULL,
    CONSTRAINT seed_products_category_check CHECK ((category = ANY (ARRAY['vegetable'::text, 'herb'::text, 'flower'::text, 'pollinator'::text, 'salad'::text, 'fruit'::text]))),
    CONSTRAINT seed_products_preferred_sun_check CHECK ((preferred_sun = ANY (ARRAY['full'::text, 'partial'::text, 'shade'::text, 'any'::text]))),
    CONSTRAINT seed_products_reorder_threshold_check CHECK ((reorder_threshold >= 0))
);


--
-- Name: seed_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seed_profiles (
    user_id uuid NOT NULL,
    zip text,
    zone integer,
    garden_size text,
    sun text,
    experience text,
    preferences text[] DEFAULT '{}'::text[] NOT NULL,
    exclusions text[] DEFAULT '{}'::text[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    garden_sizes text[] DEFAULT '{}'::text[] NOT NULL,
    suns text[] DEFAULT '{}'::text[] NOT NULL,
    experiences text[] DEFAULT '{}'::text[] NOT NULL,
    packet_count integer,
    CONSTRAINT seed_profiles_experience_check CHECK ((experience = ANY (ARRAY['first_time'::text, 'beginner'::text, 'some'::text, 'experienced'::text]))),
    CONSTRAINT seed_profiles_garden_size_check CHECK ((garden_size = ANY (ARRAY['windowsill'::text, 'containers'::text, 'small_bed'::text, 'medium'::text, 'large'::text, 'unsure'::text]))),
    CONSTRAINT seed_profiles_sun_check CHECK ((sun = ANY (ARRAY['full'::text, 'partial'::text, 'shade'::text, 'unsure'::text]))),
    CONSTRAINT seed_profiles_zone_check CHECK (((zone >= 2) AND (zone <= 11)))
);


--
-- Name: seed_season_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seed_season_windows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_code text NOT NULL,
    year integer NOT NULL,
    zone_min integer NOT NULL,
    zone_max integer NOT NULL,
    window_start date NOT NULL,
    join_cutoff date NOT NULL,
    generation_date date NOT NULL,
    ship_start date NOT NULL,
    ship_end date NOT NULL,
    active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seed_season_windows_check CHECK ((zone_max >= zone_min)),
    CONSTRAINT seed_season_windows_check1 CHECK ((join_cutoff >= window_start)),
    CONSTRAINT seed_season_windows_check2 CHECK ((generation_date >= join_cutoff)),
    CONSTRAINT seed_season_windows_check3 CHECK ((ship_end >= ship_start)),
    CONSTRAINT seed_season_windows_season_code_check CHECK ((season_code = ANY (ARRAY['EARLY_SEASON'::text, 'SPRING'::text, 'SUMMER'::text, 'FALL'::text]))),
    CONSTRAINT seed_season_windows_year_check CHECK (((year >= 2026) AND (year <= 2100))),
    CONSTRAINT seed_season_windows_zone_max_check CHECK (((zone_max >= 2) AND (zone_max <= 11))),
    CONSTRAINT seed_season_windows_zone_min_check CHECK (((zone_min >= 2) AND (zone_min <= 11)))
);


--
-- Name: seed_sub_season_skips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seed_sub_season_skips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    window_id uuid NOT NULL,
    source text DEFAULT 'user'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seed_sub_season_skips_source_check CHECK ((source = ANY (ARRAY['user'::text, 'admin'::text])))
);


--
-- Name: seller_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seller_expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    spent_at date DEFAULT CURRENT_DATE NOT NULL,
    category text NOT NULL,
    amount_cents integer NOT NULL,
    vendor text,
    notes text,
    status text DEFAULT 'recorded'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seller_expenses_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT seller_expenses_category_check CHECK ((category = ANY (ARRAY['seeds'::text, 'soil'::text, 'fertilizer'::text, 'packaging'::text, 'market_fees'::text, 'supplies'::text, 'mileage'::text, 'other'::text]))),
    CONSTRAINT seller_expenses_status_check CHECK ((status = ANY (ARRAY['recorded'::text, 'void'::text])))
);


--
-- Name: seller_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seller_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    listing_id uuid,
    claim_id uuid,
    source text DEFAULT 'manual'::text NOT NULL,
    quantity numeric DEFAULT 1 NOT NULL,
    gross_cents integer NOT NULL,
    discount_cents integer DEFAULT 0 NOT NULL,
    fee_cents integer DEFAULT 0 NOT NULL,
    net_cents integer GENERATED ALWAYS AS (((gross_cents - discount_cents) - fee_cents)) STORED,
    payment_method text NOT NULL,
    buyer_label text,
    notes text,
    status text DEFAULT 'completed'::text NOT NULL,
    void_reason text,
    corrected_from uuid,
    sold_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    order_id uuid,
    delivery_fee_cents integer DEFAULT 0 NOT NULL,
    CONSTRAINT seller_transactions_discount_cents_check CHECK ((discount_cents >= 0)),
    CONSTRAINT seller_transactions_fee_cents_check CHECK ((fee_cents >= 0)),
    CONSTRAINT seller_transactions_gross_cents_check CHECK ((gross_cents >= 0)),
    CONSTRAINT seller_transactions_payment_method_check CHECK ((payment_method = ANY (ARRAY['cash'::text, 'venmo'::text, 'zelle'::text, 'cashapp'::text, 'check'::text, 'external_card'::text, 'other'::text, 'gnome'::text]))),
    CONSTRAINT seller_transactions_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT seller_transactions_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'request'::text]))),
    CONSTRAINT seller_transactions_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'void'::text])))
);


--
-- Name: sponsored_placements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sponsored_placements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    placement_type text,
    city text,
    state text,
    zip text,
    start_date date,
    end_date date,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: storage_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    zone text,
    archived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stripe_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_events (
    id text NOT NULL,
    type text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    livemode boolean
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    contact text,
    website text,
    account_ref text,
    notes text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_blocks (
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_blocks_check CHECK ((blocker_id <> blocked_id))
);


--
-- Name: user_private_contact; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_private_contact (
    user_id uuid NOT NULL,
    first_name text,
    last_name text,
    phone_e164 text,
    contact_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE user_private_contact; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_private_contact IS 'Owner-only contact details. Deliberately separate from the world-readable profiles table so a real name, phone, or email is never exposed to other users.';


--
-- Name: admin_actions admin_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_pkey PRIMARY KEY (id);


--
-- Name: admin_audit_log admin_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);


--
-- Name: admin_plan_grants admin_plan_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_plan_grants
    ADD CONSTRAINT admin_plan_grants_pkey PRIMARY KEY (id);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- Name: admin_users admin_users_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_user_id_key UNIQUE (user_id);


--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (user_id);


--
-- Name: ai_action_requests ai_action_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_action_requests
    ADD CONSTRAINT ai_action_requests_pkey PRIMARY KEY (id);


--
-- Name: ai_agents ai_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agents
    ADD CONSTRAINT ai_agents_pkey PRIMARY KEY (id);


--
-- Name: ai_chat_messages ai_chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_chat_messages
    ADD CONSTRAINT ai_chat_messages_pkey PRIMARY KEY (id);


--
-- Name: ai_daily_counter ai_daily_counter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_daily_counter
    ADD CONSTRAINT ai_daily_counter_pkey PRIMARY KEY (user_id, feature, day);


--
-- Name: ai_room_messages ai_room_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_room_messages
    ADD CONSTRAINT ai_room_messages_pkey PRIMARY KEY (id);


--
-- Name: ai_rooms ai_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_rooms
    ADD CONSTRAINT ai_rooms_pkey PRIMARY KEY (id);


--
-- Name: ai_settings ai_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_settings
    ADD CONSTRAINT ai_settings_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_log ai_usage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_pkey PRIMARY KEY (id);


--
-- Name: ai_usage ai_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (user_id, day, feature);


--
-- Name: billing_config billing_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_config
    ADD CONSTRAINT billing_config_pkey PRIMARY KEY (id);


--
-- Name: billing_events billing_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events
    ADD CONSTRAINT billing_events_pkey PRIMARY KEY (id);


--
-- Name: billing_products billing_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_products
    ADD CONSTRAINT billing_products_pkey PRIMARY KEY (key);


--
-- Name: buyer_delivery_addresses buyer_delivery_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyer_delivery_addresses
    ADD CONSTRAINT buyer_delivery_addresses_pkey PRIMARY KEY (id);


--
-- Name: claim_messages claim_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_messages
    ADD CONSTRAINT claim_messages_pkey PRIMARY KEY (id);


--
-- Name: claim_reports claim_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_reports
    ADD CONSTRAINT claim_reports_pkey PRIMARY KEY (id);


--
-- Name: claims claims_listing_id_claimer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_listing_id_claimer_id_key UNIQUE (listing_id, claimer_id);


--
-- Name: claims claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_pkey PRIMARY KEY (id);


--
-- Name: compliance_audit_log compliance_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_audit_log
    ADD CONSTRAINT compliance_audit_log_pkey PRIMARY KEY (id);


--
-- Name: compliance_classes compliance_classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_classes
    ADD CONSTRAINT compliance_classes_pkey PRIMARY KEY (compliance_class);


--
-- Name: compliance_rules compliance_rules_jurisdiction_taxonomy_node_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_rules
    ADD CONSTRAINT compliance_rules_jurisdiction_taxonomy_node_id_key UNIQUE (jurisdiction, taxonomy_node_id);


--
-- Name: compliance_rules compliance_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_rules
    ADD CONSTRAINT compliance_rules_pkey PRIMARY KEY (id);


--
-- Name: content_screening_config content_screening_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_screening_config
    ADD CONSTRAINT content_screening_config_pkey PRIMARY KEY (id);


--
-- Name: credential_taxonomy_scope credential_taxonomy_scope_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credential_taxonomy_scope
    ADD CONSTRAINT credential_taxonomy_scope_pkey PRIMARY KEY (credential_id, taxonomy_node_id);


--
-- Name: device_tokens device_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (token);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: germination_tests germination_tests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.germination_tests
    ADD CONSTRAINT germination_tests_pkey PRIMARY KEY (id);


--
-- Name: legacy_category_map legacy_category_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legacy_category_map
    ADD CONSTRAINT legacy_category_map_pkey PRIMARY KEY (legacy_category);


--
-- Name: listing_drafts listing_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_drafts
    ADD CONSTRAINT listing_drafts_pkey PRIMARY KEY (id);


--
-- Name: listing_pickup_locations listing_pickup_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_pickup_locations
    ADD CONSTRAINT listing_pickup_locations_pkey PRIMARY KEY (listing_id, location_id);


--
-- Name: listing_promotions listing_promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_promotions
    ADD CONSTRAINT listing_promotions_pkey PRIMARY KEY (id);


--
-- Name: listings listings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_pkey PRIMARY KEY (id);


--
-- Name: market_delivery_settings market_delivery_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_delivery_settings
    ADD CONSTRAINT market_delivery_settings_pkey PRIMARY KEY (market_id);


--
-- Name: market_follows market_follows_market_id_follower_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_follows
    ADD CONSTRAINT market_follows_market_id_follower_id_key UNIQUE (market_id, follower_id);


--
-- Name: market_follows market_follows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_follows
    ADD CONSTRAINT market_follows_pkey PRIMARY KEY (id);


--
-- Name: market_members market_members_market_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_members
    ADD CONSTRAINT market_members_market_id_user_id_key UNIQUE (market_id, user_id);


--
-- Name: market_members market_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_members
    ADD CONSTRAINT market_members_pkey PRIMARY KEY (id);


--
-- Name: market_metrics market_metrics_market_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_metrics
    ADD CONSTRAINT market_metrics_market_id_date_key UNIQUE (market_id, date);


--
-- Name: market_metrics market_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_metrics
    ADD CONSTRAINT market_metrics_pkey PRIMARY KEY (id);


--
-- Name: market_order_events market_order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_order_events
    ADD CONSTRAINT market_order_events_pkey PRIMARY KEY (id);


--
-- Name: market_order_items market_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_order_items
    ADD CONSTRAINT market_order_items_pkey PRIMARY KEY (id);


--
-- Name: market_orders market_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_orders
    ADD CONSTRAINT market_orders_pkey PRIMARY KEY (id);


--
-- Name: market_payment_methods market_payment_methods_market_id_method_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_payment_methods
    ADD CONSTRAINT market_payment_methods_market_id_method_key UNIQUE (market_id, method);


--
-- Name: market_payment_methods market_payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_payment_methods
    ADD CONSTRAINT market_payment_methods_pkey PRIMARY KEY (id);


--
-- Name: market_pickup_exceptions market_pickup_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_pickup_exceptions
    ADD CONSTRAINT market_pickup_exceptions_pkey PRIMARY KEY (id);


--
-- Name: market_pickup_hours market_pickup_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_pickup_hours
    ADD CONSTRAINT market_pickup_hours_pkey PRIMARY KEY (id);


--
-- Name: market_pickup_locations market_pickup_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_pickup_locations
    ADD CONSTRAINT market_pickup_locations_pkey PRIMARY KEY (id);


--
-- Name: market_pickup_private market_pickup_private_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_pickup_private
    ADD CONSTRAINT market_pickup_private_pkey PRIMARY KEY (market_id);


--
-- Name: market_pickup_settings market_pickup_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_pickup_settings
    ADD CONSTRAINT market_pickup_settings_pkey PRIMARY KEY (market_id);


--
-- Name: market_promotion_credits market_promotion_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_promotion_credits
    ADD CONSTRAINT market_promotion_credits_pkey PRIMARY KEY (id);


--
-- Name: market_promotion_credits market_promotion_credits_stripe_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_promotion_credits
    ADD CONSTRAINT market_promotion_credits_stripe_session_id_key UNIQUE (stripe_session_id);


--
-- Name: market_subscriptions market_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_subscriptions
    ADD CONSTRAINT market_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: marketplace_taxonomy_nodes marketplace_taxonomy_nodes_parent_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_taxonomy_nodes
    ADD CONSTRAINT marketplace_taxonomy_nodes_parent_id_slug_key UNIQUE (parent_id, slug);


--
-- Name: marketplace_taxonomy_nodes marketplace_taxonomy_nodes_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_taxonomy_nodes
    ADD CONSTRAINT marketplace_taxonomy_nodes_path_key UNIQUE (path);


--
-- Name: marketplace_taxonomy_nodes marketplace_taxonomy_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_taxonomy_nodes
    ADD CONSTRAINT marketplace_taxonomy_nodes_pkey PRIMARY KEY (id);


--
-- Name: markets markets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.markets
    ADD CONSTRAINT markets_pkey PRIMARY KEY (id);


--
-- Name: markets markets_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.markets
    ADD CONSTRAINT markets_slug_key UNIQUE (slug);


--
-- Name: plan_limits plan_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_limits
    ADD CONSTRAINT plan_limits_pkey PRIMARY KEY (plan);


--
-- Name: plot_crops plot_crops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plot_crops
    ADD CONSTRAINT plot_crops_pkey PRIMARY KEY (id);


--
-- Name: plot_grow_log_photos plot_grow_log_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plot_grow_log_photos
    ADD CONSTRAINT plot_grow_log_photos_pkey PRIMARY KEY (id);


--
-- Name: plot_grow_logs plot_grow_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plot_grow_logs
    ADD CONSTRAINT plot_grow_logs_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: prohibited_terms prohibited_terms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prohibited_terms
    ADD CONSTRAINT prohibited_terms_pkey PRIMARY KEY (id);


--
-- Name: prohibited_terms prohibited_terms_term_category_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prohibited_terms
    ADD CONSTRAINT prohibited_terms_term_category_key UNIQUE (term, category);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: seed_drop_subscriptions seed_drop_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_drop_subscriptions
    ADD CONSTRAINT seed_drop_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: seed_drop_subscriptions seed_drop_subscriptions_stripe_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_drop_subscriptions
    ADD CONSTRAINT seed_drop_subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id);


--
-- Name: seed_inventory_log seed_inventory_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_inventory_log
    ADD CONSTRAINT seed_inventory_log_pkey PRIMARY KEY (id);


--
-- Name: seed_lots seed_lots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_lots
    ADD CONSTRAINT seed_lots_pkey PRIMARY KEY (id);


--
-- Name: seed_order_items seed_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_order_items
    ADD CONSTRAINT seed_order_items_pkey PRIMARY KEY (id);


--
-- Name: seed_orders seed_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_orders
    ADD CONSTRAINT seed_orders_pkey PRIMARY KEY (id);


--
-- Name: seed_orders seed_orders_stripe_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_orders
    ADD CONSTRAINT seed_orders_stripe_session_id_key UNIQUE (stripe_session_id);


--
-- Name: seed_products seed_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_products
    ADD CONSTRAINT seed_products_pkey PRIMARY KEY (id);


--
-- Name: seed_products seed_products_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_products
    ADD CONSTRAINT seed_products_sku_key UNIQUE (sku);


--
-- Name: seed_profiles seed_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_profiles
    ADD CONSTRAINT seed_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: seed_season_windows seed_season_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_season_windows
    ADD CONSTRAINT seed_season_windows_pkey PRIMARY KEY (id);


--
-- Name: seed_season_windows seed_season_windows_season_code_year_zone_min_zone_max_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_season_windows
    ADD CONSTRAINT seed_season_windows_season_code_year_zone_min_zone_max_key UNIQUE (season_code, year, zone_min, zone_max);


--
-- Name: seed_sub_season_skips seed_sub_season_skips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_sub_season_skips
    ADD CONSTRAINT seed_sub_season_skips_pkey PRIMARY KEY (id);


--
-- Name: seed_sub_season_skips seed_sub_season_skips_subscription_id_window_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_sub_season_skips
    ADD CONSTRAINT seed_sub_season_skips_subscription_id_window_id_key UNIQUE (subscription_id, window_id);


--
-- Name: seller_compliance_clearances seller_compliance_clearances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_compliance_clearances
    ADD CONSTRAINT seller_compliance_clearances_pkey PRIMARY KEY (id);


--
-- Name: seller_credentials seller_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_credentials
    ADD CONSTRAINT seller_credentials_pkey PRIMARY KEY (id);


--
-- Name: seller_expenses seller_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_expenses
    ADD CONSTRAINT seller_expenses_pkey PRIMARY KEY (id);


--
-- Name: seller_transactions seller_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_transactions
    ADD CONSTRAINT seller_transactions_pkey PRIMARY KEY (id);


--
-- Name: sponsored_placements sponsored_placements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sponsored_placements
    ADD CONSTRAINT sponsored_placements_pkey PRIMARY KEY (id);


--
-- Name: storage_locations storage_locations_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_name_key UNIQUE (name);


--
-- Name: storage_locations storage_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_pkey PRIMARY KEY (id);


--
-- Name: stripe_events stripe_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_events
    ADD CONSTRAINT stripe_events_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_name_key UNIQUE (name);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: user_blocks user_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (blocker_id, blocked_id);


--
-- Name: user_private_contact user_private_contact_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_private_contact
    ADD CONSTRAINT user_private_contact_pkey PRIMARY KEY (user_id);


--
-- Name: admin_actions_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_actions_created_idx ON public.admin_actions USING btree (created_at DESC);


--
-- Name: admin_audit_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_actor_idx ON public.admin_audit_log USING btree (actor_id, created_at DESC);


--
-- Name: admin_audit_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_resource_idx ON public.admin_audit_log USING btree (resource_type, resource_id);


--
-- Name: admin_users_invited_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_users_invited_email_idx ON public.admin_users USING btree (lower(invited_email)) WHERE (user_id IS NULL);


--
-- Name: admin_users_one_pending_invite; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX admin_users_one_pending_invite ON public.admin_users USING btree (lower(invited_email)) WHERE ((user_id IS NULL) AND (status = 'invited'::text));


--
-- Name: ai_chat_messages_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_chat_messages_user_idx ON public.ai_chat_messages USING btree (user_id, created_at);


--
-- Name: ai_room_msgs_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_room_msgs_idx ON public.ai_room_messages USING btree (room_id, id);


--
-- Name: ai_usage_room_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_room_idx ON public.ai_usage_log USING btree (room_id) WHERE (room_id IS NOT NULL);


--
-- Name: ai_usage_user_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_user_day_idx ON public.ai_usage_log USING btree (user_id, created_at DESC);


--
-- Name: billing_events_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_events_market_idx ON public.billing_events USING btree (market_id, created_at DESC);


--
-- Name: billing_events_mode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_events_mode_idx ON public.billing_events USING btree (livemode, created_at DESC);


--
-- Name: buyer_delivery_addresses_buyer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX buyer_delivery_addresses_buyer_idx ON public.buyer_delivery_addresses USING btree (buyer_id);


--
-- Name: buyer_delivery_addresses_default_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX buyer_delivery_addresses_default_idx ON public.buyer_delivery_addresses USING btree (buyer_id) WHERE is_default;


--
-- Name: claim_messages_sender_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX claim_messages_sender_idx ON public.claim_messages USING btree (sender_id);


--
-- Name: claim_messages_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX claim_messages_thread_idx ON public.claim_messages USING btree (claim_id, created_at);


--
-- Name: claim_reports_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX claim_reports_claim_idx ON public.claim_reports USING btree (claim_id);


--
-- Name: claims_claimer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX claims_claimer_idx ON public.claims USING btree (claimer_id);


--
-- Name: claims_listing_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX claims_listing_idx ON public.claims USING btree (listing_id);


--
-- Name: claims_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX claims_type_idx ON public.claims USING btree (claim_type);


--
-- Name: compliance_audit_credential_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_audit_credential_idx ON public.compliance_audit_log USING btree (credential_id);


--
-- Name: compliance_audit_seller_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_audit_seller_idx ON public.compliance_audit_log USING btree (seller_id);


--
-- Name: compliance_rules_node_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_rules_node_idx ON public.compliance_rules USING btree (taxonomy_node_id);


--
-- Name: cred_scope_node_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cred_scope_node_idx ON public.credential_taxonomy_scope USING btree (taxonomy_node_id);


--
-- Name: device_tokens_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_tokens_user_idx ON public.device_tokens USING btree (user_id);


--
-- Name: events_anon_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_anon_recent_idx ON public.events USING btree (created_at) WHERE (user_id IS NULL);


--
-- Name: events_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_type_idx ON public.events USING btree (event_type);


--
-- Name: events_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_user_idx ON public.events USING btree (user_id);


--
-- Name: feedback_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_created_idx ON public.feedback USING btree (created_at DESC);


--
-- Name: listing_drafts_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listing_drafts_batch_idx ON public.listing_drafts USING btree (batch_id);


--
-- Name: listing_drafts_owner_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listing_drafts_owner_status_idx ON public.listing_drafts USING btree (owner_id, status, created_at DESC);


--
-- Name: listing_promotions_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listing_promotions_active_idx ON public.listing_promotions USING btree (status, ends_at);


--
-- Name: listing_promotions_listing_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listing_promotions_listing_idx ON public.listing_promotions USING btree (listing_id);


--
-- Name: listing_promotions_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listing_promotions_market_idx ON public.listing_promotions USING btree (market_id);


--
-- Name: listings_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_created_at_idx ON public.listings USING btree (created_at DESC);


--
-- Name: listings_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_kind_idx ON public.listings USING btree (kind);


--
-- Name: listings_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_market_idx ON public.listings USING btree (market_id);


--
-- Name: listings_market_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_market_position_idx ON public.listings USING btree (market_id, market_position);


--
-- Name: listings_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_owner_idx ON public.listings USING btree (owner_id);


--
-- Name: listings_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_status_idx ON public.listings USING btree (status);


--
-- Name: listings_taxonomy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_taxonomy_idx ON public.listings USING btree (taxonomy_node_id);


--
-- Name: listings_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX listings_type_idx ON public.listings USING btree (listing_type);


--
-- Name: lpl_loc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lpl_loc_idx ON public.listing_pickup_locations USING btree (location_id);


--
-- Name: market_follows_follower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_follows_follower_idx ON public.market_follows USING btree (follower_id);


--
-- Name: market_follows_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_follows_market_idx ON public.market_follows USING btree (market_id);


--
-- Name: market_members_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_members_market_idx ON public.market_members USING btree (market_id);


--
-- Name: market_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_members_user_idx ON public.market_members USING btree (user_id);


--
-- Name: market_metrics_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_metrics_market_idx ON public.market_metrics USING btree (market_id);


--
-- Name: market_subscriptions_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_subscriptions_market_idx ON public.market_subscriptions USING btree (market_id);


--
-- Name: markets_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX markets_owner_idx ON public.markets USING btree (owner_id);


--
-- Name: markets_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX markets_slug_idx ON public.markets USING btree (slug);


--
-- Name: markets_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX markets_status_idx ON public.markets USING btree (status);


--
-- Name: mo_buyer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mo_buyer_idx ON public.market_orders USING btree (buyer_id, status);


--
-- Name: mo_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mo_market_idx ON public.market_orders USING btree (market_id, status);


--
-- Name: mo_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mo_window_idx ON public.market_orders USING btree (market_id, requested_start);


--
-- Name: moe_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX moe_order_idx ON public.market_order_events USING btree (order_id);


--
-- Name: moi_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX moi_order_idx ON public.market_order_items USING btree (order_id);


--
-- Name: mpc_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mpc_market_idx ON public.market_promotion_credits USING btree (market_id);


--
-- Name: mpe_loc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mpe_loc_idx ON public.market_pickup_exceptions USING btree (location_id, date);


--
-- Name: mpe_market_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mpe_market_date_idx ON public.market_pickup_exceptions USING btree (market_id, date);


--
-- Name: mph_loc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mph_loc_idx ON public.market_pickup_hours USING btree (location_id);


--
-- Name: mph_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mph_market_idx ON public.market_pickup_hours USING btree (market_id);


--
-- Name: mpl_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mpl_market_idx ON public.market_pickup_locations USING btree (market_id);


--
-- Name: mpl_one_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mpl_one_default ON public.market_pickup_locations USING btree (market_id) WHERE is_default;


--
-- Name: mpm_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mpm_market_idx ON public.market_payment_methods USING btree (market_id);


--
-- Name: pc_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pc_claim_idx ON public.plot_crops USING btree (claim_id);


--
-- Name: pgl_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pgl_claim_idx ON public.plot_grow_logs USING btree (claim_id, created_at);


--
-- Name: pglp_log_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pglp_log_idx ON public.plot_grow_log_photos USING btree (log_id);


--
-- Name: plan_grants_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plan_grants_market_idx ON public.admin_plan_grants USING btree (market_id) WHERE (status = 'ACTIVE'::text);


--
-- Name: prohibited_terms_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prohibited_terms_active_idx ON public.prohibited_terms USING btree (active) WHERE active;


--
-- Name: reports_reporter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_reporter_idx ON public.reports USING btree (reporter_id);


--
-- Name: reports_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_target_idx ON public.reports USING btree (target_type, target_id);


--
-- Name: scc_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX scc_one_active ON public.seller_compliance_clearances USING btree (seller_id, compliance_class, state) WHERE (status = 'ACTIVE'::text);


--
-- Name: seed_drop_subs_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seed_drop_subs_due_idx ON public.seed_drop_subscriptions USING btree (next_order_date) WHERE (status = 'active'::text);


--
-- Name: seed_drop_subs_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seed_drop_subs_user_idx ON public.seed_drop_subscriptions USING btree (user_id);


--
-- Name: seed_lots_internal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX seed_lots_internal_idx ON public.seed_lots USING btree (internal_lot_number);


--
-- Name: seed_lots_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seed_lots_product_idx ON public.seed_lots USING btree (seed_product_id);


--
-- Name: seed_order_items_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seed_order_items_order_idx ON public.seed_order_items USING btree (order_id);


--
-- Name: seed_orders_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seed_orders_user_idx ON public.seed_orders USING btree (user_id, created_at DESC);


--
-- Name: seed_orders_window_user_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX seed_orders_window_user_uq ON public.seed_orders USING btree (season_window_id, user_id) WHERE ((season_window_id IS NOT NULL) AND (status <> ALL (ARRAY['cancelled'::text, 'refunded'::text])));


--
-- Name: seed_products_crop_variety_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX seed_products_crop_variety_idx ON public.seed_products USING btree (crop, variety);


--
-- Name: seller_credentials_exp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seller_credentials_exp_idx ON public.seller_credentials USING btree (expiration_date);


--
-- Name: seller_credentials_seller_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seller_credentials_seller_idx ON public.seller_credentials USING btree (seller_id);


--
-- Name: seller_credentials_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seller_credentials_status_idx ON public.seller_credentials USING btree (status);


--
-- Name: seller_exp_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seller_exp_market_idx ON public.seller_expenses USING btree (market_id, spent_at DESC);


--
-- Name: seller_transactions_claim_completed_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX seller_transactions_claim_completed_uniq ON public.seller_transactions USING btree (claim_id) WHERE ((claim_id IS NOT NULL) AND (status = 'completed'::text));


--
-- Name: seller_transactions_order_completed_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX seller_transactions_order_completed_uniq ON public.seller_transactions USING btree (order_id) WHERE ((order_id IS NOT NULL) AND (status = 'completed'::text));


--
-- Name: seller_txn_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seller_txn_market_idx ON public.seller_transactions USING btree (market_id, sold_at DESC);


--
-- Name: sponsored_placements_market_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sponsored_placements_market_idx ON public.sponsored_placements USING btree (market_id);


--
-- Name: tax_nodes_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_nodes_active_idx ON public.marketplace_taxonomy_nodes USING btree (active) WHERE active;


--
-- Name: tax_nodes_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_nodes_parent_idx ON public.marketplace_taxonomy_nodes USING btree (parent_id);


--
-- Name: tax_nodes_path_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_nodes_path_idx ON public.marketplace_taxonomy_nodes USING btree (path text_pattern_ops);


--
-- Name: tax_nodes_syn_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_nodes_syn_idx ON public.marketplace_taxonomy_nodes USING gin (search_synonyms);


--
-- Name: user_blocks_blocked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_blocks_blocked_idx ON public.user_blocks USING btree (blocked_id);


--
-- Name: ai_agents ai_agents_no_cycle_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ai_agents_no_cycle_trg BEFORE INSERT OR UPDATE OF reports_to ON public.ai_agents FOR EACH ROW EXECUTE FUNCTION public.ai_agents_no_cycle();


--
-- Name: claims check_claim_not_blocked; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_claim_not_blocked BEFORE INSERT ON public.claims FOR EACH ROW EXECUTE FUNCTION public.check_claim_not_blocked();


--
-- Name: claim_messages check_message_not_blocked; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_message_not_blocked BEFORE INSERT ON public.claim_messages FOR EACH ROW EXECUTE FUNCTION public.check_message_not_blocked();


--
-- Name: claim_messages claim_messages_kind_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER claim_messages_kind_guard BEFORE INSERT ON public.claim_messages FOR EACH ROW EXECUTE FUNCTION public.claim_messages_kind_guard();


--
-- Name: claim_messages claim_messages_rate_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER claim_messages_rate_limit BEFORE INSERT ON public.claim_messages FOR EACH ROW EXECUTE FUNCTION public.claim_messages_rate_limit();


--
-- Name: market_delivery_settings delivery_settings_plan_gate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER delivery_settings_plan_gate BEFORE INSERT OR UPDATE ON public.market_delivery_settings FOR EACH ROW EXECUTE FUNCTION public.enforce_delivery_plan();


--
-- Name: listing_promotions enforce_promotion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_promotion BEFORE INSERT OR UPDATE ON public.listing_promotions FOR EACH ROW EXECUTE FUNCTION public.enforce_promotion();


--
-- Name: events events_before_insert_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_before_insert_guard BEFORE INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION public.events_guard();


--
-- Name: listings listings_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER listings_before_write BEFORE INSERT OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.listings_before_write();


--
-- Name: listings listings_block_suspended_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER listings_block_suspended_trg BEFORE INSERT OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.listings_block_suspended();


--
-- Name: listings listings_compliance_gate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER listings_compliance_gate BEFORE INSERT OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.listings_enforce_compliance();


--
-- Name: listings listings_enforce_plan_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER listings_enforce_plan_limit BEFORE INSERT ON public.listings FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limit();


--
-- Name: listings listings_enforce_plot_plan; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER listings_enforce_plot_plan BEFORE INSERT ON public.listings FOR EACH ROW EXECUTE FUNCTION public.enforce_plot_plan();


--
-- Name: listings listings_fill_taxonomy; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER listings_fill_taxonomy BEFORE INSERT ON public.listings FOR EACH ROW EXECUTE FUNCTION public.listings_fill_taxonomy();


--
-- Name: listings listings_screen_content_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER listings_screen_content_trg BEFORE INSERT OR UPDATE OF title, description, trade_for, taxonomy_node_id ON public.listings FOR EACH ROW EXECUTE FUNCTION public.listings_screen_content();


--
-- Name: market_orders market_orders_event_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER market_orders_event_trg AFTER INSERT OR UPDATE ON public.market_orders FOR EACH ROW EXECUTE FUNCTION public.market_orders_event_log();


--
-- Name: markets markets_plan_reconcile_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER markets_plan_reconcile_trg AFTER UPDATE ON public.markets FOR EACH ROW EXECUTE FUNCTION public.markets_plan_change_reconcile();


--
-- Name: markets markets_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER markets_set_updated_at BEFORE UPDATE ON public.markets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: market_pickup_locations mpl_default_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mpl_default_trg BEFORE INSERT OR UPDATE ON public.market_pickup_locations FOR EACH ROW EXECUTE FUNCTION public.market_pickup_locations_default_guard();


--
-- Name: market_pickup_locations mpl_limit_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mpl_limit_trg BEFORE INSERT OR UPDATE ON public.market_pickup_locations FOR EACH ROW EXECUTE FUNCTION public.enforce_pickup_location_limit();


--
-- Name: claims on_claim_status_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_claim_status_change AFTER UPDATE ON public.claims FOR EACH ROW EXECUTE FUNCTION public.handle_claim_status();


--
-- Name: profiles on_profile_created; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_profile_created AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile();


--
-- Name: plot_grow_logs plot_grow_logs_guard_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER plot_grow_logs_guard_trg BEFORE UPDATE ON public.plot_grow_logs FOR EACH ROW EXECUTE FUNCTION public.plot_grow_logs_guard();


--
-- Name: seed_drop_subscriptions seed_subs_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER seed_subs_guard BEFORE UPDATE ON public.seed_drop_subscriptions FOR EACH ROW EXECUTE FUNCTION public.seed_sub_guard();


--
-- Name: seller_credentials seller_credentials_audit_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER seller_credentials_audit_trg AFTER INSERT OR UPDATE ON public.seller_credentials FOR EACH ROW EXECUTE FUNCTION public.seller_credentials_audit();


--
-- Name: claims set_claim_responded_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_claim_responded_at BEFORE UPDATE ON public.claims FOR EACH ROW EXECUTE FUNCTION public.set_claim_responded_at();


--
-- Name: listings set_listing_slug; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_listing_slug BEFORE INSERT OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.set_listing_slug();


--
-- Name: listing_promotions sync_listing_featured; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_listing_featured AFTER INSERT OR UPDATE ON public.listing_promotions FOR EACH ROW EXECUTE FUNCTION public.sync_listing_featured();


--
-- Name: marketplace_taxonomy_nodes taxonomy_archive_cascade_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER taxonomy_archive_cascade_trg BEFORE UPDATE ON public.marketplace_taxonomy_nodes FOR EACH ROW EXECUTE FUNCTION public.taxonomy_archive_cascade();


--
-- Name: marketplace_taxonomy_nodes taxonomy_no_delete_in_use; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER taxonomy_no_delete_in_use BEFORE DELETE ON public.marketplace_taxonomy_nodes FOR EACH ROW EXECUTE FUNCTION public.taxonomy_block_delete_in_use();


--
-- Name: claims validate_claim_option; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_claim_option BEFORE INSERT OR UPDATE OF selected_option_label, selected_taxonomy_node_id, is_custom_option ON public.claims FOR EACH ROW EXECUTE FUNCTION public.validate_claim_option();


--
-- Name: listings validate_request_options; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_request_options BEFORE INSERT OR UPDATE OF request_options ON public.listings FOR EACH ROW EXECUTE FUNCTION public.validate_request_options();


--
-- Name: admin_actions admin_actions_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions
    ADD CONSTRAINT admin_actions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.profiles(id);


--
-- Name: admin_plan_grants admin_plan_grants_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_plan_grants
    ADD CONSTRAINT admin_plan_grants_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: admin_plan_grants admin_plan_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_plan_grants
    ADD CONSTRAINT admin_plan_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: admin_users admin_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: admins admins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: ai_action_requests ai_action_requests_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_action_requests
    ADD CONSTRAINT ai_action_requests_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.ai_agents(id);


--
-- Name: ai_agents ai_agents_reports_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agents
    ADD CONSTRAINT ai_agents_reports_to_fkey FOREIGN KEY (reports_to) REFERENCES public.ai_agents(id) ON DELETE SET NULL;


--
-- Name: ai_chat_messages ai_chat_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_chat_messages
    ADD CONSTRAINT ai_chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ai_room_messages ai_room_messages_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_room_messages
    ADD CONSTRAINT ai_room_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.ai_rooms(id) ON DELETE CASCADE;


--
-- Name: buyer_delivery_addresses buyer_delivery_addresses_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyer_delivery_addresses
    ADD CONSTRAINT buyer_delivery_addresses_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: claim_messages claim_messages_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_messages
    ADD CONSTRAINT claim_messages_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE CASCADE;


--
-- Name: claim_messages claim_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_messages
    ADD CONSTRAINT claim_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: claim_reports claim_reports_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_reports
    ADD CONSTRAINT claim_reports_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE CASCADE;


--
-- Name: claim_reports claim_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_reports
    ADD CONSTRAINT claim_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: claims claims_assigned_fulfiller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_assigned_fulfiller_id_fkey FOREIGN KEY (assigned_fulfiller_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: claims claims_claimer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_claimer_id_fkey FOREIGN KEY (claimer_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: claims claims_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: claims claims_selected_taxonomy_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_selected_taxonomy_node_id_fkey FOREIGN KEY (selected_taxonomy_node_id) REFERENCES public.marketplace_taxonomy_nodes(id);


--
-- Name: compliance_audit_log compliance_audit_log_credential_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_audit_log
    ADD CONSTRAINT compliance_audit_log_credential_id_fkey FOREIGN KEY (credential_id) REFERENCES public.seller_credentials(id) ON DELETE CASCADE;


--
-- Name: compliance_rules compliance_rules_taxonomy_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_rules
    ADD CONSTRAINT compliance_rules_taxonomy_node_id_fkey FOREIGN KEY (taxonomy_node_id) REFERENCES public.marketplace_taxonomy_nodes(id) ON DELETE RESTRICT;


--
-- Name: content_screening_config content_screening_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_screening_config
    ADD CONSTRAINT content_screening_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id);


--
-- Name: credential_taxonomy_scope credential_taxonomy_scope_credential_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credential_taxonomy_scope
    ADD CONSTRAINT credential_taxonomy_scope_credential_id_fkey FOREIGN KEY (credential_id) REFERENCES public.seller_credentials(id) ON DELETE CASCADE;


--
-- Name: credential_taxonomy_scope credential_taxonomy_scope_taxonomy_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credential_taxonomy_scope
    ADD CONSTRAINT credential_taxonomy_scope_taxonomy_node_id_fkey FOREIGN KEY (taxonomy_node_id) REFERENCES public.marketplace_taxonomy_nodes(id) ON DELETE RESTRICT;


--
-- Name: device_tokens device_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: events events_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE SET NULL;


--
-- Name: events events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: feedback feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: germination_tests germination_tests_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.germination_tests
    ADD CONSTRAINT germination_tests_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.seed_lots(id) ON DELETE CASCADE;


--
-- Name: listing_drafts listing_drafts_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_drafts
    ADD CONSTRAINT listing_drafts_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: listing_drafts listing_drafts_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_drafts
    ADD CONSTRAINT listing_drafts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: listing_drafts listing_drafts_published_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_drafts
    ADD CONSTRAINT listing_drafts_published_listing_id_fkey FOREIGN KEY (published_listing_id) REFERENCES public.listings(id) ON DELETE SET NULL;


--
-- Name: listing_drafts listing_drafts_taxonomy_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_drafts
    ADD CONSTRAINT listing_drafts_taxonomy_node_id_fkey FOREIGN KEY (taxonomy_node_id) REFERENCES public.marketplace_taxonomy_nodes(id);


--
-- Name: listing_pickup_locations listing_pickup_locations_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_pickup_locations
    ADD CONSTRAINT listing_pickup_locations_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: listing_pickup_locations listing_pickup_locations_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_pickup_locations
    ADD CONSTRAINT listing_pickup_locations_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.market_pickup_locations(id) ON DELETE CASCADE;


--
-- Name: listing_promotions listing_promotions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_promotions
    ADD CONSTRAINT listing_promotions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: listing_promotions listing_promotions_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_promotions
    ADD CONSTRAINT listing_promotions_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;


--
-- Name: listing_promotions listing_promotions_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_promotions
    ADD CONSTRAINT listing_promotions_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: listings listings_fulfilled_by_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_fulfilled_by_listing_id_fkey FOREIGN KEY (fulfilled_by_listing_id) REFERENCES public.listings(id) ON DELETE SET NULL;


--
-- Name: listings listings_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE SET NULL;


--
-- Name: listings listings_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: listings listings_taxonomy_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_taxonomy_node_id_fkey FOREIGN KEY (taxonomy_node_id) REFERENCES public.marketplace_taxonomy_nodes(id) ON DELETE RESTRICT;


--
-- Name: market_delivery_settings market_delivery_settings_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_delivery_settings
    ADD CONSTRAINT market_delivery_settings_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: market_follows market_follows_follower_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_follows
    ADD CONSTRAINT market_follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: market_follows market_follows_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_follows
    ADD CONSTRAINT market_follows_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: market_members market_members_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_members
    ADD CONSTRAINT market_members_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: market_members market_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_members
    ADD CONSTRAINT market_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: market_metrics market_metrics_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_metrics
    ADD CONSTRAINT market_metrics_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: market_order_events market_order_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_order_events
    ADD CONSTRAINT market_order_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.market_orders(id) ON DELETE CASCADE;


--
-- Name: market_order_items market_order_items_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_order_items
    ADD CONSTRAINT market_order_items_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE SET NULL;


--
-- Name: market_order_items market_order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_order_items
    ADD CONSTRAINT market_order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.market_orders(id) ON DELETE CASCADE;


--
-- Name: market_order_items market_order_items_taxonomy_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_order_items
    ADD CONSTRAINT market_order_items_taxonomy_node_id_fkey FOREIGN KEY (taxonomy_node_id) REFERENCES public.marketplace_taxonomy_nodes(id) ON DELETE SET NULL;


--
-- Name: market_orders market_orders_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_orders
    ADD CONSTRAINT market_orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: market_orders market_orders_delivery_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_orders
    ADD CONSTRAINT market_orders_delivery_address_id_fkey FOREIGN KEY (delivery_address_id) REFERENCES public.buyer_delivery_addresses(id) ON DELETE SET NULL;


--
-- Name: market_orders market_orders_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_orders
    ADD CONSTRAINT market_orders_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: market_orders market_orders_pickup_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_orders
    ADD CONSTRAINT market_orders_pickup_location_id_fkey FOREIGN KEY (pickup_location_id) REFERENCES public.market_pickup_locations(id) ON DELETE SET NULL;


--
-- Name: market_payment_methods market_payment_methods_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_payment_methods
    ADD CONSTRAINT market_payment_methods_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: market_pickup_exceptions market_pickup_exceptions_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_pickup_exceptions
    ADD CONSTRAINT market_pickup_exceptions_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.market_pickup_locations(id) ON DELETE CASCADE;


--
-- Name: market_pickup_exceptions market_pickup_exceptions_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_pickup_exceptions
    ADD CONSTRAINT market_pickup_exceptions_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: market_pickup_hours market_pickup_hours_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_pickup_hours
    ADD CONSTRAINT market_pickup_hours_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.market_pickup_locations(id) ON DELETE CASCADE;


--
-- Name: market_pickup_hours market_pickup_hours_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_pickup_hours
    ADD CONSTRAINT market_pickup_hours_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: market_pickup_locations market_pickup_locations_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_pickup_locations
    ADD CONSTRAINT market_pickup_locations_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: market_pickup_private market_pickup_private_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_pickup_private
    ADD CONSTRAINT market_pickup_private_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: market_pickup_settings market_pickup_settings_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_pickup_settings
    ADD CONSTRAINT market_pickup_settings_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: market_promotion_credits market_promotion_credits_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_promotion_credits
    ADD CONSTRAINT market_promotion_credits_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: market_promotion_credits market_promotion_credits_promotion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_promotion_credits
    ADD CONSTRAINT market_promotion_credits_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.listing_promotions(id);


--
-- Name: market_subscriptions market_subscriptions_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_subscriptions
    ADD CONSTRAINT market_subscriptions_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: marketplace_taxonomy_nodes marketplace_taxonomy_nodes_compliance_class_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_taxonomy_nodes
    ADD CONSTRAINT marketplace_taxonomy_nodes_compliance_class_fkey FOREIGN KEY (compliance_class) REFERENCES public.compliance_classes(compliance_class);


--
-- Name: marketplace_taxonomy_nodes marketplace_taxonomy_nodes_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_taxonomy_nodes
    ADD CONSTRAINT marketplace_taxonomy_nodes_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.marketplace_taxonomy_nodes(id) ON DELETE RESTRICT;


--
-- Name: markets markets_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.markets
    ADD CONSTRAINT markets_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: plot_crops plot_crops_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plot_crops
    ADD CONSTRAINT plot_crops_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE CASCADE;


--
-- Name: plot_crops plot_crops_taxonomy_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plot_crops
    ADD CONSTRAINT plot_crops_taxonomy_node_id_fkey FOREIGN KEY (taxonomy_node_id) REFERENCES public.marketplace_taxonomy_nodes(id) ON DELETE SET NULL;


--
-- Name: plot_grow_log_photos plot_grow_log_photos_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plot_grow_log_photos
    ADD CONSTRAINT plot_grow_log_photos_log_id_fkey FOREIGN KEY (log_id) REFERENCES public.plot_grow_logs(id) ON DELETE CASCADE;


--
-- Name: plot_grow_logs plot_grow_logs_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plot_grow_logs
    ADD CONSTRAINT plot_grow_logs_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: plot_grow_logs plot_grow_logs_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plot_grow_logs
    ADD CONSTRAINT plot_grow_logs_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: prohibited_terms prohibited_terms_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prohibited_terms
    ADD CONSTRAINT prohibited_terms_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: reports reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: reports reports_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id);


--
-- Name: seed_drop_subscriptions seed_drop_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_drop_subscriptions
    ADD CONSTRAINT seed_drop_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: seed_inventory_log seed_inventory_log_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_inventory_log
    ADD CONSTRAINT seed_inventory_log_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.seed_lots(id);


--
-- Name: seed_lots seed_lots_seed_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_lots
    ADD CONSTRAINT seed_lots_seed_product_id_fkey FOREIGN KEY (seed_product_id) REFERENCES public.seed_products(id);


--
-- Name: seed_order_items seed_order_items_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_order_items
    ADD CONSTRAINT seed_order_items_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.seed_lots(id);


--
-- Name: seed_order_items seed_order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_order_items
    ADD CONSTRAINT seed_order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.seed_orders(id) ON DELETE CASCADE;


--
-- Name: seed_order_items seed_order_items_seed_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_order_items
    ADD CONSTRAINT seed_order_items_seed_product_id_fkey FOREIGN KEY (seed_product_id) REFERENCES public.seed_products(id);


--
-- Name: seed_order_items seed_order_items_substituted_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_order_items
    ADD CONSTRAINT seed_order_items_substituted_from_fkey FOREIGN KEY (substituted_from) REFERENCES public.seed_products(id);


--
-- Name: seed_orders seed_orders_season_window_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_orders
    ADD CONSTRAINT seed_orders_season_window_id_fkey FOREIGN KEY (season_window_id) REFERENCES public.seed_season_windows(id);


--
-- Name: seed_orders seed_orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_orders
    ADD CONSTRAINT seed_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: seed_profiles seed_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_profiles
    ADD CONSTRAINT seed_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: seed_sub_season_skips seed_sub_season_skips_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_sub_season_skips
    ADD CONSTRAINT seed_sub_season_skips_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.seed_drop_subscriptions(id) ON DELETE CASCADE;


--
-- Name: seed_sub_season_skips seed_sub_season_skips_window_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_sub_season_skips
    ADD CONSTRAINT seed_sub_season_skips_window_id_fkey FOREIGN KEY (window_id) REFERENCES public.seed_season_windows(id);


--
-- Name: seller_compliance_clearances seller_compliance_clearances_compliance_class_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_compliance_clearances
    ADD CONSTRAINT seller_compliance_clearances_compliance_class_fkey FOREIGN KEY (compliance_class) REFERENCES public.compliance_classes(compliance_class);


--
-- Name: seller_compliance_clearances seller_compliance_clearances_credential_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_compliance_clearances
    ADD CONSTRAINT seller_compliance_clearances_credential_id_fkey FOREIGN KEY (credential_id) REFERENCES public.seller_credentials(id) ON DELETE SET NULL;


--
-- Name: seller_compliance_clearances seller_compliance_clearances_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_compliance_clearances
    ADD CONSTRAINT seller_compliance_clearances_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.profiles(id);


--
-- Name: seller_compliance_clearances seller_compliance_clearances_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_compliance_clearances
    ADD CONSTRAINT seller_compliance_clearances_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.profiles(id);


--
-- Name: seller_compliance_clearances seller_compliance_clearances_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_compliance_clearances
    ADD CONSTRAINT seller_compliance_clearances_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: seller_credentials seller_credentials_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_credentials
    ADD CONSTRAINT seller_credentials_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE SET NULL;


--
-- Name: seller_credentials seller_credentials_renewal_of_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_credentials
    ADD CONSTRAINT seller_credentials_renewal_of_id_fkey FOREIGN KEY (renewal_of_id) REFERENCES public.seller_credentials(id) ON DELETE SET NULL;


--
-- Name: seller_credentials seller_credentials_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_credentials
    ADD CONSTRAINT seller_credentials_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id);


--
-- Name: seller_credentials seller_credentials_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_credentials
    ADD CONSTRAINT seller_credentials_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: seller_expenses seller_expenses_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_expenses
    ADD CONSTRAINT seller_expenses_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: seller_transactions seller_transactions_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_transactions
    ADD CONSTRAINT seller_transactions_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE SET NULL;


--
-- Name: seller_transactions seller_transactions_corrected_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_transactions
    ADD CONSTRAINT seller_transactions_corrected_from_fkey FOREIGN KEY (corrected_from) REFERENCES public.seller_transactions(id);


--
-- Name: seller_transactions seller_transactions_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_transactions
    ADD CONSTRAINT seller_transactions_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE SET NULL;


--
-- Name: seller_transactions seller_transactions_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_transactions
    ADD CONSTRAINT seller_transactions_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: seller_transactions seller_transactions_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_transactions
    ADD CONSTRAINT seller_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.market_orders(id) ON DELETE SET NULL;


--
-- Name: sponsored_placements sponsored_placements_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sponsored_placements
    ADD CONSTRAINT sponsored_placements_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: user_blocks user_blocks_blocked_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_blocks user_blocks_blocker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_private_contact user_private_contact_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_private_contact
    ADD CONSTRAINT user_private_contact_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: admin_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_actions admin_actions_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_actions_admin_insert ON public.admin_actions FOR INSERT WITH CHECK ((public.is_admin() AND (admin_id = auth.uid())));


--
-- Name: admin_actions admin_actions_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_actions_admin_select ON public.admin_actions FOR SELECT USING (public.is_admin());


--
-- Name: admin_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_audit_log admin_audit_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_audit_read ON public.admin_audit_log FOR SELECT USING (public.is_admin());


--
-- Name: admin_plan_grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_plan_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_users admin_users_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_users_select_self ON public.admin_users FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: admins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

--
-- Name: admins admins_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admins_select_self ON public.admins FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: ai_action_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_action_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_agents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_agents ai_agents_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_agents_read ON public.ai_agents FOR SELECT USING (public.admin_has_perm('ai.view'::text));


--
-- Name: ai_chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_chat_messages ai_chat_messages_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_chat_messages_own ON public.ai_chat_messages USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: ai_daily_counter; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_daily_counter ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_room_messages ai_msgs_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_msgs_insert_admin ON public.ai_room_messages FOR INSERT WITH CHECK (((sender_type = 'admin'::text) AND (sender_admin_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.ai_rooms r
  WHERE ((r.id = ai_room_messages.room_id) AND (r.created_by = auth.uid()) AND public.admin_has_perm('ai.chat'::text))))));


--
-- Name: ai_room_messages ai_msgs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_msgs_read ON public.ai_room_messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.ai_rooms r
  WHERE ((r.id = ai_room_messages.room_id) AND (r.created_by = auth.uid()) AND public.admin_has_perm('ai.chat'::text)))));


--
-- Name: ai_action_requests ai_requests_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_requests_read ON public.ai_action_requests FOR SELECT USING (public.admin_has_perm('ai.view'::text));


--
-- Name: ai_room_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_room_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_rooms ai_rooms_rw; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_rooms_rw ON public.ai_rooms USING ((public.admin_has_perm('ai.chat'::text) AND (created_by = auth.uid()))) WITH CHECK ((public.admin_has_perm('ai.chat'::text) AND (created_by = auth.uid())));


--
-- Name: ai_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_settings ai_settings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_settings_read ON public.ai_settings FOR SELECT USING (public.admin_has_perm('ai.view'::text));


--
-- Name: ai_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_usage_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_usage_log ai_usage_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_usage_read ON public.ai_usage_log FOR SELECT USING (public.admin_has_perm('ai.view'::text));


--
-- Name: billing_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.billing_config ENABLE ROW LEVEL SECURITY;

--
-- Name: billing_config billing_config_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY billing_config_read ON public.billing_config FOR SELECT USING (public.admin_has_perm('subscriptions.view'::text));


--
-- Name: billing_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

--
-- Name: billing_events billing_events_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY billing_events_read ON public.billing_events FOR SELECT USING ((public.admin_has_perm('finance.view_transactions'::text) OR public.admin_has_perm('subscriptions.view'::text)));


--
-- Name: billing_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.billing_products ENABLE ROW LEVEL SECURITY;

--
-- Name: billing_products billing_products_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY billing_products_admin ON public.billing_products USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: billing_products billing_products_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY billing_products_read ON public.billing_products FOR SELECT USING (true);


--
-- Name: buyer_delivery_addresses buyer_addresses_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY buyer_addresses_own ON public.buyer_delivery_addresses USING ((buyer_id = auth.uid())) WITH CHECK ((buyer_id = auth.uid()));


--
-- Name: buyer_delivery_addresses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.buyer_delivery_addresses ENABLE ROW LEVEL SECURITY;

--
-- Name: claim_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.claim_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: claim_messages claim_messages_insert_party; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY claim_messages_insert_party ON public.claim_messages FOR INSERT WITH CHECK (((sender_id = auth.uid()) AND public.is_claim_party(claim_id) AND ((public.claim_status_of(claim_id))::text = 'approved'::text)));


--
-- Name: claim_messages claim_messages_select_party; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY claim_messages_select_party ON public.claim_messages FOR SELECT USING ((public.is_claim_party(claim_id) AND ((public.claim_status_of(claim_id))::text = ANY (ARRAY['approved'::text, 'completed'::text]))));


--
-- Name: claim_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.claim_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: claim_reports claim_reports_insert_party; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY claim_reports_insert_party ON public.claim_reports FOR INSERT WITH CHECK (((reporter_id = auth.uid()) AND public.is_claim_party(claim_id)));


--
-- Name: claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;

--
-- Name: claims claims_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY claims_admin_select ON public.claims FOR SELECT USING (public.is_admin());


--
-- Name: claims claims_insert_claimer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY claims_insert_claimer ON public.claims FOR INSERT WITH CHECK (((auth.uid() = claimer_id) AND (auth.uid() <> ( SELECT l.owner_id
   FROM public.listings l
  WHERE (l.id = claims.listing_id))) AND (NOT COALESCE(( SELECT profiles.suspended
   FROM public.profiles
  WHERE (profiles.id = auth.uid())), false))));


--
-- Name: claims claims_select_involved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY claims_select_involved ON public.claims FOR SELECT USING (((auth.uid() = claimer_id) OR (auth.uid() = ( SELECT l.owner_id
   FROM public.listings l
  WHERE (l.id = claims.listing_id)))));


--
-- Name: claims claims_update_claimer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY claims_update_claimer ON public.claims FOR UPDATE TO authenticated USING ((auth.uid() = claimer_id)) WITH CHECK (((auth.uid() = claimer_id) AND (status = ANY (ARRAY['cancelled'::public.claim_status, 'pending'::public.claim_status]))));


--
-- Name: claims claims_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY claims_update_owner ON public.claims FOR UPDATE TO authenticated USING ((auth.uid() = ( SELECT l.owner_id
   FROM public.listings l
  WHERE (l.id = claims.listing_id)))) WITH CHECK (((auth.uid() = ( SELECT l.owner_id
   FROM public.listings l
  WHERE (l.id = claims.listing_id))) AND (status = ANY (ARRAY['approved'::public.claim_status, 'declined'::public.claim_status, 'completed'::public.claim_status, 'expired'::public.claim_status]))));


--
-- Name: compliance_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_audit_log compliance_audit_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_audit_select ON public.compliance_audit_log FOR SELECT TO authenticated USING ((public.is_admin() OR (seller_id = auth.uid())));


--
-- Name: compliance_classes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_classes ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_rules compliance_rules_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_rules_admin_write ON public.compliance_rules TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: compliance_rules compliance_rules_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_rules_select_all ON public.compliance_rules FOR SELECT TO authenticated, anon USING (true);


--
-- Name: content_screening_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_screening_config ENABLE ROW LEVEL SECURITY;

--
-- Name: credential_taxonomy_scope cred_scope_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cred_scope_admin_all ON public.credential_taxonomy_scope TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: credential_taxonomy_scope cred_scope_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cred_scope_insert_own ON public.credential_taxonomy_scope FOR INSERT TO authenticated WITH CHECK ((public.is_admin() OR (EXISTS ( SELECT 1
   FROM public.seller_credentials c
  WHERE ((c.id = credential_taxonomy_scope.credential_id) AND (c.seller_id = auth.uid()) AND (c.status = 'PENDING'::public.credential_status))))));


--
-- Name: credential_taxonomy_scope cred_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cred_scope_select ON public.credential_taxonomy_scope FOR SELECT TO authenticated USING ((public.is_admin() OR (EXISTS ( SELECT 1
   FROM public.seller_credentials c
  WHERE ((c.id = credential_taxonomy_scope.credential_id) AND (c.seller_id = auth.uid()))))));


--
-- Name: credential_taxonomy_scope; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.credential_taxonomy_scope ENABLE ROW LEVEL SECURITY;

--
-- Name: market_delivery_settings delivery_settings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY delivery_settings_read ON public.market_delivery_settings FOR SELECT USING (true);


--
-- Name: market_delivery_settings delivery_settings_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY delivery_settings_write ON public.market_delivery_settings USING ((EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_delivery_settings.market_id) AND (m.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_delivery_settings.market_id) AND (m.owner_id = auth.uid())))));


--
-- Name: device_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: device_tokens device_tokens_delete_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_tokens_delete_self ON public.device_tokens FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: device_tokens device_tokens_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_tokens_select_self ON public.device_tokens FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: device_tokens device_tokens_update_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_tokens_update_self ON public.device_tokens FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: device_tokens device_tokens_upsert_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_tokens_upsert_self ON public.device_tokens FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: events events_insert_self_or_anon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_insert_self_or_anon ON public.events FOR INSERT WITH CHECK (((user_id IS NULL) OR (auth.uid() = user_id)));


--
-- Name: events events_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_select_self ON public.events FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: feedback feedback_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feedback_insert_own ON public.feedback FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: germination_tests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.germination_tests ENABLE ROW LEVEL SECURITY;

--
-- Name: germination_tests germination_tests_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY germination_tests_admin ON public.germination_tests USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: listing_drafts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listing_drafts ENABLE ROW LEVEL SECURITY;

--
-- Name: listing_drafts listing_drafts_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listing_drafts_delete_own ON public.listing_drafts FOR DELETE USING ((auth.uid() = owner_id));


--
-- Name: listing_drafts listing_drafts_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listing_drafts_select_own ON public.listing_drafts FOR SELECT USING ((auth.uid() = owner_id));


--
-- Name: listing_drafts listing_drafts_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listing_drafts_update_own ON public.listing_drafts FOR UPDATE USING ((auth.uid() = owner_id)) WITH CHECK ((auth.uid() = owner_id));


--
-- Name: listing_pickup_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listing_pickup_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: listing_promotions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listing_promotions ENABLE ROW LEVEL SECURITY;

--
-- Name: listings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

--
-- Name: listings listings_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listings_admin_select ON public.listings FOR SELECT USING (public.is_admin());


--
-- Name: listings listings_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listings_admin_update ON public.listings FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: listings listings_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listings_delete_owner ON public.listings FOR DELETE USING ((auth.uid() = owner_id));


--
-- Name: listings listings_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listings_insert_owner ON public.listings FOR INSERT WITH CHECK (((auth.uid() = owner_id) AND (NOT COALESCE(( SELECT profiles.suspended
   FROM public.profiles
  WHERE (profiles.id = auth.uid())), false))));


--
-- Name: listings listings_select_active_or_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listings_select_active_or_owner ON public.listings FOR SELECT USING (((status = 'active'::public.listing_status) OR (auth.uid() = owner_id)));


--
-- Name: listings listings_select_claimer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listings_select_claimer ON public.listings FOR SELECT USING (public.has_claim_on(id));


--
-- Name: listings listings_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY listings_update_owner ON public.listings FOR UPDATE USING ((auth.uid() = owner_id)) WITH CHECK ((auth.uid() = owner_id));


--
-- Name: listing_pickup_locations lpl_owner_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lpl_owner_write ON public.listing_pickup_locations TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_pickup_locations.listing_id) AND (l.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_pickup_locations.listing_id) AND (l.owner_id = auth.uid())))));


--
-- Name: listing_pickup_locations lpl_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lpl_select_all ON public.listing_pickup_locations FOR SELECT TO authenticated, anon USING (true);


--
-- Name: market_delivery_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_delivery_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: market_follows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_follows ENABLE ROW LEVEL SECURITY;

--
-- Name: market_follows market_follows_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY market_follows_delete_own ON public.market_follows FOR DELETE USING ((auth.uid() = follower_id));


--
-- Name: market_follows market_follows_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY market_follows_insert_own ON public.market_follows FOR INSERT WITH CHECK ((auth.uid() = follower_id));


--
-- Name: market_follows market_follows_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY market_follows_select_own ON public.market_follows FOR SELECT USING ((auth.uid() = follower_id));


--
-- Name: market_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_members ENABLE ROW LEVEL SECURITY;

--
-- Name: market_members market_members_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY market_members_delete_owner ON public.market_members FOR DELETE USING ((auth.uid() = ( SELECT m.owner_id
   FROM public.markets m
  WHERE (m.id = market_members.market_id))));


--
-- Name: market_members market_members_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY market_members_insert_owner ON public.market_members FOR INSERT WITH CHECK ((auth.uid() = ( SELECT m.owner_id
   FROM public.markets m
  WHERE (m.id = market_members.market_id))));


--
-- Name: market_members market_members_select_involved; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY market_members_select_involved ON public.market_members FOR SELECT USING (((auth.uid() = user_id) OR (auth.uid() = ( SELECT m.owner_id
   FROM public.markets m
  WHERE (m.id = market_members.market_id)))));


--
-- Name: market_members market_members_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY market_members_update_owner ON public.market_members FOR UPDATE USING ((auth.uid() = ( SELECT m.owner_id
   FROM public.markets m
  WHERE (m.id = market_members.market_id))));


--
-- Name: market_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: market_metrics market_metrics_select_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY market_metrics_select_owner ON public.market_metrics FOR SELECT USING ((auth.uid() = ( SELECT m.owner_id
   FROM public.markets m
  WHERE (m.id = market_metrics.market_id))));


--
-- Name: market_order_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_order_events ENABLE ROW LEVEL SECURITY;

--
-- Name: market_order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: market_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: market_payment_methods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_payment_methods ENABLE ROW LEVEL SECURITY;

--
-- Name: market_pickup_exceptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_pickup_exceptions ENABLE ROW LEVEL SECURITY;

--
-- Name: market_pickup_hours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_pickup_hours ENABLE ROW LEVEL SECURITY;

--
-- Name: market_pickup_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_pickup_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: market_pickup_private; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_pickup_private ENABLE ROW LEVEL SECURITY;

--
-- Name: market_pickup_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_pickup_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: market_promotion_credits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_promotion_credits ENABLE ROW LEVEL SECURITY;

--
-- Name: market_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: market_subscriptions market_subscriptions_select_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY market_subscriptions_select_owner ON public.market_subscriptions FOR SELECT USING ((auth.uid() = ( SELECT m.owner_id
   FROM public.markets m
  WHERE (m.id = market_subscriptions.market_id))));


--
-- Name: marketplace_taxonomy_nodes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_taxonomy_nodes ENABLE ROW LEVEL SECURITY;

--
-- Name: markets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;

--
-- Name: markets markets_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY markets_admin_update ON public.markets FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: markets markets_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY markets_insert_owner ON public.markets FOR INSERT WITH CHECK ((auth.uid() = owner_id));


--
-- Name: markets markets_select_active_or_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY markets_select_active_or_owner ON public.markets FOR SELECT USING (((status = 'active'::public.market_status) OR (auth.uid() = owner_id)));


--
-- Name: markets markets_update_owner_or_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY markets_update_owner_or_member ON public.markets FOR UPDATE TO authenticated USING (((auth.uid() = owner_id) OR (EXISTS ( SELECT 1
   FROM public.market_members mm
  WHERE ((mm.market_id = markets.id) AND (mm.user_id = auth.uid())))))) WITH CHECK (((auth.uid() = owner_id) OR (EXISTS ( SELECT 1
   FROM public.market_members mm
  WHERE ((mm.market_id = markets.id) AND (mm.user_id = auth.uid()))))));


--
-- Name: market_orders mo_select_parties; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mo_select_parties ON public.market_orders FOR SELECT TO authenticated USING (((buyer_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_orders.market_id) AND (m.owner_id = auth.uid())))) OR public.is_admin()));


--
-- Name: market_order_events moe_select_parties; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY moe_select_parties ON public.market_order_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.market_orders o
  WHERE ((o.id = market_order_events.order_id) AND ((o.buyer_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.markets m
          WHERE ((m.id = o.market_id) AND (m.owner_id = auth.uid())))) OR public.is_admin())))));


--
-- Name: market_order_items moi_select_parties; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY moi_select_parties ON public.market_order_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.market_orders o
  WHERE ((o.id = market_order_items.order_id) AND ((o.buyer_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.markets m
          WHERE ((m.id = o.market_id) AND (m.owner_id = auth.uid())))) OR public.is_admin())))));


--
-- Name: market_promotion_credits mpc_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mpc_owner_read ON public.market_promotion_credits FOR SELECT USING ((public.admin_has_perm('promotions.view'::text) OR (auth.uid() = ( SELECT m.owner_id
   FROM public.markets m
  WHERE (m.id = market_promotion_credits.market_id)))));


--
-- Name: market_pickup_exceptions mpe_owner_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mpe_owner_write ON public.market_pickup_exceptions TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_pickup_exceptions.market_id) AND (m.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_pickup_exceptions.market_id) AND (m.owner_id = auth.uid())))));


--
-- Name: market_pickup_exceptions mpe_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mpe_select_all ON public.market_pickup_exceptions FOR SELECT TO authenticated, anon USING (true);


--
-- Name: market_pickup_hours mph_owner_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mph_owner_write ON public.market_pickup_hours TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_pickup_hours.market_id) AND (m.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_pickup_hours.market_id) AND (m.owner_id = auth.uid())))));


--
-- Name: market_pickup_hours mph_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mph_select_all ON public.market_pickup_hours FOR SELECT TO authenticated, anon USING (true);


--
-- Name: market_pickup_locations mpl_owner_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mpl_owner_write ON public.market_pickup_locations TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_pickup_locations.market_id) AND (m.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_pickup_locations.market_id) AND (m.owner_id = auth.uid())))));


--
-- Name: market_pickup_locations mpl_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mpl_select_all ON public.market_pickup_locations FOR SELECT TO authenticated, anon USING (true);


--
-- Name: market_payment_methods mpm_owner_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mpm_owner_write ON public.market_payment_methods TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_payment_methods.market_id) AND (m.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_payment_methods.market_id) AND (m.owner_id = auth.uid())))));


--
-- Name: market_payment_methods mpm_select_enabled_or_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mpm_select_enabled_or_own ON public.market_payment_methods FOR SELECT TO authenticated, anon USING ((enabled OR (EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_payment_methods.market_id) AND (m.owner_id = auth.uid()))))));


--
-- Name: market_pickup_private mpp_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mpp_owner_all ON public.market_pickup_private TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_pickup_private.market_id) AND (m.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_pickup_private.market_id) AND (m.owner_id = auth.uid())))));


--
-- Name: market_pickup_settings mps_owner_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mps_owner_write ON public.market_pickup_settings TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_pickup_settings.market_id) AND (m.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.markets m
  WHERE ((m.id = market_pickup_settings.market_id) AND (m.owner_id = auth.uid())))));


--
-- Name: market_pickup_settings mps_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mps_select_all ON public.market_pickup_settings FOR SELECT TO authenticated, anon USING (true);


--
-- Name: plot_crops pc_grower_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pc_grower_write ON public.plot_crops TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.claims c
  WHERE ((c.id = plot_crops.claim_id) AND (c.claimer_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.claims c
  WHERE ((c.id = plot_crops.claim_id) AND (c.claimer_id = auth.uid()) AND (c.claim_type = 'plot_reservation'::text)))));


--
-- Name: plot_crops pc_select_parties; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pc_select_parties ON public.plot_crops FOR SELECT TO authenticated USING ((public.is_plot_party(claim_id) OR public.is_admin()));


--
-- Name: plot_grow_logs pgl_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pgl_delete_own ON public.plot_grow_logs FOR DELETE TO authenticated USING ((author_id = auth.uid()));


--
-- Name: plot_grow_logs pgl_insert_entry; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pgl_insert_entry ON public.plot_grow_logs FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND (((kind = 'entry'::text) AND (EXISTS ( SELECT 1
   FROM public.claims c
  WHERE ((c.id = plot_grow_logs.claim_id) AND (c.claimer_id = auth.uid()) AND (c.claim_type = 'plot_reservation'::text))))) OR ((kind = 'owner_note'::text) AND (EXISTS ( SELECT 1
   FROM (public.claims c
     JOIN public.listings l ON ((l.id = c.listing_id)))
  WHERE ((c.id = plot_grow_logs.claim_id) AND (l.owner_id = auth.uid()) AND (c.claim_type = 'plot_reservation'::text))))))));


--
-- Name: plot_grow_logs pgl_select_parties; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pgl_select_parties ON public.plot_grow_logs FOR SELECT TO authenticated USING ((public.is_plot_party(claim_id) OR public.is_admin()));


--
-- Name: plot_grow_logs pgl_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pgl_update_own ON public.plot_grow_logs FOR UPDATE TO authenticated USING ((author_id = auth.uid())) WITH CHECK ((author_id = auth.uid()));


--
-- Name: plot_grow_log_photos pglp_delete_author; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pglp_delete_author ON public.plot_grow_log_photos FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.plot_grow_logs g
  WHERE ((g.id = plot_grow_log_photos.log_id) AND (g.author_id = auth.uid())))));


--
-- Name: plot_grow_log_photos pglp_insert_author; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pglp_insert_author ON public.plot_grow_log_photos FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.plot_grow_logs g
  WHERE ((g.id = plot_grow_log_photos.log_id) AND (g.author_id = auth.uid())))));


--
-- Name: plot_grow_log_photos pglp_select_parties; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pglp_select_parties ON public.plot_grow_log_photos FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.plot_grow_logs g
  WHERE ((g.id = plot_grow_log_photos.log_id) AND (public.is_plot_party(g.claim_id) OR public.is_admin())))));


--
-- Name: admin_plan_grants plan_grants_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_grants_read ON public.admin_plan_grants FOR SELECT USING (public.admin_has_perm('subscriptions.view'::text));


--
-- Name: plan_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: plan_limits plan_limits_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_limits_select_all ON public.plan_limits FOR SELECT USING (true);


--
-- Name: plot_crops; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plot_crops ENABLE ROW LEVEL SECURITY;

--
-- Name: plot_grow_log_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plot_grow_log_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: plot_grow_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plot_grow_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_admin_update ON public.profiles FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: profiles profiles_insert_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_insert_self ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = id));


--
-- Name: profiles profiles_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_admin ON public.profiles FOR SELECT USING (public.is_admin());


--
-- Name: profiles profiles_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_own ON public.profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: profiles profiles_update_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: prohibited_terms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prohibited_terms ENABLE ROW LEVEL SECURITY;

--
-- Name: listing_promotions promotions_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promotions_admin_read ON public.listing_promotions FOR SELECT USING (public.admin_has_perm('promotions.view'::text));


--
-- Name: listing_promotions promotions_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promotions_insert_owner ON public.listing_promotions FOR INSERT WITH CHECK (((auth.uid() = ( SELECT m.owner_id
   FROM public.markets m
  WHERE (m.id = listing_promotions.market_id))) AND (source <> 'paid'::public.promotion_source)));


--
-- Name: listing_promotions promotions_select_active_or_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promotions_select_active_or_owner ON public.listing_promotions FOR SELECT USING (((status = 'active'::public.promotion_status) OR (auth.uid() = ( SELECT m.owner_id
   FROM public.markets m
  WHERE (m.id = listing_promotions.market_id)))));


--
-- Name: listing_promotions promotions_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promotions_update_owner ON public.listing_promotions FOR UPDATE USING ((auth.uid() = ( SELECT m.owner_id
   FROM public.markets m
  WHERE (m.id = listing_promotions.market_id)))) WITH CHECK (((auth.uid() = ( SELECT m.owner_id
   FROM public.markets m
  WHERE (m.id = listing_promotions.market_id))) AND (source <> 'paid'::public.promotion_source)));


--
-- Name: reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

--
-- Name: reports reports_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reports_admin_read ON public.reports FOR SELECT USING ((public.admin_has_perm('support.view'::text) OR (reporter_id = auth.uid())));


--
-- Name: reports reports_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reports_admin_select ON public.reports FOR SELECT USING (public.is_admin());


--
-- Name: reports reports_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reports_admin_update ON public.reports FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: reports reports_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reports_insert_own ON public.reports FOR INSERT WITH CHECK ((auth.uid() = reporter_id));


--
-- Name: seed_drop_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seed_drop_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: seed_inventory_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seed_inventory_log ENABLE ROW LEVEL SECURITY;

--
-- Name: seed_inventory_log seed_inventory_log_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_inventory_log_admin ON public.seed_inventory_log FOR SELECT USING (public.is_admin());


--
-- Name: seed_inventory_log seed_inventory_log_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_inventory_log_admin_insert ON public.seed_inventory_log FOR INSERT WITH CHECK ((public.is_admin() AND (actor = auth.uid())));


--
-- Name: seed_order_items seed_items_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_items_admin_read ON public.seed_order_items FOR SELECT USING ((public.admin_has_perm('seed_drop.view'::text) OR (EXISTS ( SELECT 1
   FROM public.seed_orders o
  WHERE ((o.id = seed_order_items.order_id) AND (o.user_id = auth.uid()))))));


--
-- Name: seed_inventory_log seed_log_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_log_admin_read ON public.seed_inventory_log FOR SELECT USING (public.admin_has_perm('inventory.view'::text));


--
-- Name: seed_lots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seed_lots ENABLE ROW LEVEL SECURITY;

--
-- Name: seed_lots seed_lots_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_lots_admin ON public.seed_lots USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: seed_lots seed_lots_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_lots_admin_read ON public.seed_lots FOR SELECT USING (public.admin_has_perm('inventory.view'::text));


--
-- Name: seed_order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seed_order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: seed_order_items seed_order_items_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_order_items_admin_update ON public.seed_order_items FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: seed_order_items seed_order_items_own_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_order_items_own_read ON public.seed_order_items FOR SELECT USING ((public.is_admin() OR (auth.uid() = ( SELECT o.user_id
   FROM public.seed_orders o
  WHERE (o.id = seed_order_items.order_id)))));


--
-- Name: seed_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seed_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: seed_orders seed_orders_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_orders_admin_read ON public.seed_orders FOR SELECT USING ((public.admin_has_perm('seed_drop.view'::text) OR (user_id = auth.uid())));


--
-- Name: seed_orders seed_orders_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_orders_admin_update ON public.seed_orders FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: seed_orders seed_orders_own_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_orders_own_read ON public.seed_orders FOR SELECT USING (((auth.uid() = user_id) OR public.is_admin()));


--
-- Name: seed_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seed_products ENABLE ROW LEVEL SECURITY;

--
-- Name: seed_products seed_products_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_products_admin_read ON public.seed_products FOR SELECT USING (true);


--
-- Name: seed_products seed_products_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_products_admin_write ON public.seed_products USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: seed_products seed_products_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_products_public_read ON public.seed_products FOR SELECT USING ((active OR public.is_admin()));


--
-- Name: seed_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seed_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: seed_profiles seed_profiles_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_profiles_own ON public.seed_profiles USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: seed_season_windows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seed_season_windows ENABLE ROW LEVEL SECURITY;

--
-- Name: seed_sub_season_skips; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seed_sub_season_skips ENABLE ROW LEVEL SECURITY;

--
-- Name: seed_drop_subscriptions seed_subs_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_subs_own ON public.seed_drop_subscriptions USING (((user_id = auth.uid()) OR public.is_admin())) WITH CHECK (((user_id = auth.uid()) OR public.is_admin()));


--
-- Name: seller_compliance_clearances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seller_compliance_clearances ENABLE ROW LEVEL SECURITY;

--
-- Name: seller_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seller_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: seller_credentials seller_credentials_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seller_credentials_admin_all ON public.seller_credentials TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: seller_credentials seller_credentials_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seller_credentials_insert_own ON public.seller_credentials FOR INSERT TO authenticated WITH CHECK (((auth.uid() = seller_id) AND (status = 'PENDING'::public.credential_status) AND (reviewed_at IS NULL) AND (reviewed_by IS NULL)));


--
-- Name: seller_credentials seller_credentials_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seller_credentials_select_own ON public.seller_credentials FOR SELECT TO authenticated USING (((auth.uid() = seller_id) OR public.is_admin()));


--
-- Name: seller_credentials seller_credentials_update_own_pending; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seller_credentials_update_own_pending ON public.seller_credentials FOR UPDATE TO authenticated USING (((auth.uid() = seller_id) AND (status = ANY (ARRAY['PENDING'::public.credential_status, 'DENIED'::public.credential_status, 'RENEWAL_REQUIRED'::public.credential_status, 'EXPIRED'::public.credential_status])))) WITH CHECK (((auth.uid() = seller_id) AND (status = ANY (ARRAY['PENDING'::public.credential_status, 'RENEWAL_REQUIRED'::public.credential_status])) AND (reviewed_by IS NULL)));


--
-- Name: seller_expenses seller_exp_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seller_exp_admin_read ON public.seller_expenses FOR SELECT USING (public.is_admin());


--
-- Name: seller_expenses seller_exp_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seller_exp_owner ON public.seller_expenses USING (public.owns_market(market_id)) WITH CHECK (public.owns_market(market_id));


--
-- Name: seller_expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seller_expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: seller_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seller_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: seller_transactions seller_txn_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seller_txn_admin_read ON public.seller_transactions FOR SELECT USING (public.is_admin());


--
-- Name: seller_transactions seller_txn_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seller_txn_owner ON public.seller_transactions USING (public.owns_market(market_id)) WITH CHECK (public.owns_market(market_id));


--
-- Name: seed_sub_season_skips skips_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY skips_own ON public.seed_sub_season_skips FOR SELECT USING ((public.admin_has_perm('seed_drop.view'::text) OR (auth.uid() = ( SELECT s.user_id
   FROM public.seed_drop_subscriptions s
  WHERE (s.id = seed_sub_season_skips.subscription_id)))));


--
-- Name: sponsored_placements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sponsored_placements ENABLE ROW LEVEL SECURITY;

--
-- Name: sponsored_placements sponsored_placements_select_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sponsored_placements_select_owner ON public.sponsored_placements FOR SELECT USING ((auth.uid() = ( SELECT m.owner_id
   FROM public.markets m
  WHERE (m.id = sponsored_placements.market_id))));


--
-- Name: seed_season_windows ssw_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ssw_read ON public.seed_season_windows FOR SELECT USING (true);


--
-- Name: storage_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.storage_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: storage_locations storage_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY storage_read ON public.storage_locations FOR SELECT USING (public.admin_has_perm('inventory.view'::text));


--
-- Name: stripe_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

--
-- Name: suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: suppliers suppliers_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY suppliers_read ON public.suppliers FOR SELECT USING (public.admin_has_perm('inventory.view'::text));


--
-- Name: marketplace_taxonomy_nodes tax_nodes_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tax_nodes_admin_write ON public.marketplace_taxonomy_nodes TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: marketplace_taxonomy_nodes tax_nodes_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tax_nodes_select_active ON public.marketplace_taxonomy_nodes FOR SELECT TO authenticated, anon USING ((active OR public.is_admin()));


--
-- Name: user_blocks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: user_blocks user_blocks_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_blocks_delete_own ON public.user_blocks FOR DELETE USING ((auth.uid() = blocker_id));


--
-- Name: user_blocks user_blocks_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_blocks_insert_own ON public.user_blocks FOR INSERT WITH CHECK ((auth.uid() = blocker_id));


--
-- Name: user_blocks user_blocks_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_blocks_select_own ON public.user_blocks FOR SELECT USING ((auth.uid() = blocker_id));


--
-- Name: user_private_contact; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_private_contact ENABLE ROW LEVEL SECURITY;

--
-- Name: user_private_contact user_private_contact_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_private_contact_own ON public.user_private_contact USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION _release_order_inventory(p_order uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._release_order_inventory(p_order uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public._release_order_inventory(p_order uuid) TO service_role;


--
-- Name: TABLE admin_users; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.admin_users TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.admin_users TO authenticated;
GRANT ALL ON TABLE public.admin_users TO service_role;


--
-- Name: FUNCTION admin_accept_invite(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_accept_invite() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_accept_invite() TO authenticated;
GRANT ALL ON FUNCTION public.admin_accept_invite() TO service_role;


--
-- Name: FUNCTION admin_adjust_lot(p_lot uuid, p_delta numeric, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_adjust_lot(p_lot uuid, p_delta numeric, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_adjust_lot(p_lot uuid, p_delta numeric, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_adjust_lot(p_lot uuid, p_delta numeric, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_ai_org(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_ai_org() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_ai_org() TO authenticated;
GRANT ALL ON FUNCTION public.admin_ai_org() TO service_role;


--
-- Name: FUNCTION admin_ai_provider_stats(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_ai_provider_stats() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_ai_provider_stats() TO authenticated;
GRANT ALL ON FUNCTION public.admin_ai_provider_stats() TO service_role;


--
-- Name: FUNCTION admin_audit(p_action text, p_resource_type text, p_resource_id text, p_old jsonb, p_new jsonb, p_reason text, p_actor_type text, p_approval uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_audit(p_action text, p_resource_type text, p_resource_id text, p_old jsonb, p_new jsonb, p_reason text, p_actor_type text, p_approval uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_audit(p_action text, p_resource_type text, p_resource_id text, p_old jsonb, p_new jsonb, p_reason text, p_actor_type text, p_approval uuid) TO service_role;


--
-- Name: FUNCTION admin_billing_health(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_billing_health() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_billing_health() TO authenticated;
GRANT ALL ON FUNCTION public.admin_billing_health() TO service_role;


--
-- Name: TABLE compliance_classes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.compliance_classes TO service_role;


--
-- Name: FUNCTION admin_bump_compliance_rule(p_class text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_bump_compliance_rule(p_class text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_bump_compliance_rule(p_class text, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_bump_compliance_rule(p_class text, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_can_manage_team(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_can_manage_team() TO anon;
GRANT ALL ON FUNCTION public.admin_can_manage_team() TO authenticated;
GRANT ALL ON FUNCTION public.admin_can_manage_team() TO service_role;


--
-- Name: FUNCTION admin_cancel_seed_order(p_order uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_cancel_seed_order(p_order uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_cancel_seed_order(p_order uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_cancel_seed_order(p_order uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_commercial_overview(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_commercial_overview() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_commercial_overview() TO authenticated;
GRANT ALL ON FUNCTION public.admin_commercial_overview() TO service_role;


--
-- Name: FUNCTION admin_daily_brief(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_daily_brief() TO anon;
GRANT ALL ON FUNCTION public.admin_daily_brief() TO authenticated;
GRANT ALL ON FUNCTION public.admin_daily_brief() TO service_role;


--
-- Name: FUNCTION admin_daily_brief_service(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_daily_brief_service() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_daily_brief_service() TO service_role;


--
-- Name: FUNCTION admin_delete_seed_product(p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_delete_seed_product(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_delete_seed_product(p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_delete_seed_product(p_id uuid) TO service_role;


--
-- Name: FUNCTION admin_end_promotion(p_promo uuid, p_reason text, p_restore_credit boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_end_promotion(p_promo uuid, p_reason text, p_restore_credit boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_end_promotion(p_promo uuid, p_reason text, p_restore_credit boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_end_promotion(p_promo uuid, p_reason text, p_restore_credit boolean) TO service_role;


--
-- Name: FUNCTION admin_execute_ai_action(p_request uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_execute_ai_action(p_request uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_execute_ai_action(p_request uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_execute_ai_action(p_request uuid) TO service_role;


--
-- Name: FUNCTION admin_generate_seed_drop(p_order uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_generate_seed_drop(p_order uuid) TO anon;
GRANT ALL ON FUNCTION public.admin_generate_seed_drop(p_order uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_generate_seed_drop(p_order uuid) TO service_role;


--
-- Name: TABLE seller_compliance_clearances; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.seller_compliance_clearances TO service_role;


--
-- Name: FUNCTION admin_grant_compliance_clearance(p_seller uuid, p_class text, p_state text, p_reason text, p_credential uuid, p_listing uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_grant_compliance_clearance(p_seller uuid, p_class text, p_state text, p_reason text, p_credential uuid, p_listing uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_grant_compliance_clearance(p_seller uuid, p_class text, p_state text, p_reason text, p_credential uuid, p_listing uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_grant_compliance_clearance(p_seller uuid, p_class text, p_state text, p_reason text, p_credential uuid, p_listing uuid) TO service_role;


--
-- Name: FUNCTION admin_grant_plan(p_market uuid, p_plan public.market_plan, p_expires timestamp with time zone, p_reason text, p_note text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_grant_plan(p_market uuid, p_plan public.market_plan, p_expires timestamp with time zone, p_reason text, p_note text) TO anon;
GRANT ALL ON FUNCTION public.admin_grant_plan(p_market uuid, p_plan public.market_plan, p_expires timestamp with time zone, p_reason text, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_grant_plan(p_market uuid, p_plan public.market_plan, p_expires timestamp with time zone, p_reason text, p_note text) TO service_role;


--
-- Name: FUNCTION admin_grant_promo_credits(p_market uuid, p_qty integer, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_grant_promo_credits(p_market uuid, p_qty integer, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_grant_promo_credits(p_market uuid, p_qty integer, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_grant_promo_credits(p_market uuid, p_qty integer, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_has_perm(p_perm text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_has_perm(p_perm text) TO anon;
GRANT ALL ON FUNCTION public.admin_has_perm(p_perm text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_has_perm(p_perm text) TO service_role;


--
-- Name: FUNCTION admin_inventory_summary(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_inventory_summary() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_inventory_summary() TO authenticated;
GRANT ALL ON FUNCTION public.admin_inventory_summary() TO service_role;


--
-- Name: FUNCTION admin_inventory_summary_service(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_inventory_summary_service() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_inventory_summary_service() TO service_role;


--
-- Name: FUNCTION admin_invite_teammate(p_email text, p_name text, p_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_invite_teammate(p_email text, p_name text, p_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_invite_teammate(p_email text, p_name text, p_role text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_invite_teammate(p_email text, p_name text, p_role text) TO service_role;


--
-- Name: FUNCTION admin_is_owner(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_is_owner() TO anon;
GRANT ALL ON FUNCTION public.admin_is_owner() TO authenticated;
GRANT ALL ON FUNCTION public.admin_is_owner() TO service_role;


--
-- Name: FUNCTION admin_list_team(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_list_team() TO anon;
GRANT ALL ON FUNCTION public.admin_list_team() TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_team() TO service_role;


--
-- Name: FUNCTION admin_listings_search(p_q text, p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_listings_search(p_q text, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_listings_search(p_q text, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_listings_search(p_q text, p_status text) TO service_role;


--
-- Name: FUNCTION admin_manage_storage(p_name text, p_zone text, p_archived boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_manage_storage(p_name text, p_zone text, p_archived boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_manage_storage(p_name text, p_zone text, p_archived boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_manage_storage(p_name text, p_zone text, p_archived boolean) TO service_role;


--
-- Name: TABLE markets; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,DELETE,TRIGGER,MAINTAIN ON TABLE public.markets TO anon;
GRANT REFERENCES,DELETE,TRIGGER,MAINTAIN ON TABLE public.markets TO authenticated;
GRANT ALL ON TABLE public.markets TO service_role;


--
-- Name: COLUMN markets.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.markets TO anon;
GRANT SELECT(id) ON TABLE public.markets TO authenticated;


--
-- Name: COLUMN markets.owner_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(owner_id),INSERT(owner_id) ON TABLE public.markets TO authenticated;
GRANT SELECT(owner_id) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.name; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(name),INSERT(name),UPDATE(name) ON TABLE public.markets TO authenticated;
GRANT SELECT(name) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.slug; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(slug),INSERT(slug),UPDATE(slug) ON TABLE public.markets TO authenticated;
GRANT SELECT(slug) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.description; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(description),INSERT(description),UPDATE(description) ON TABLE public.markets TO authenticated;
GRANT SELECT(description) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.market_type; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(market_type),INSERT(market_type),UPDATE(market_type) ON TABLE public.markets TO authenticated;
GRANT SELECT(market_type) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.plan; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(plan) ON TABLE public.markets TO anon;
GRANT SELECT(plan) ON TABLE public.markets TO authenticated;


--
-- Name: COLUMN markets.status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(status) ON TABLE public.markets TO anon;
GRANT SELECT(status) ON TABLE public.markets TO authenticated;


--
-- Name: COLUMN markets.avatar_url; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(avatar_url),INSERT(avatar_url),UPDATE(avatar_url) ON TABLE public.markets TO authenticated;
GRANT SELECT(avatar_url) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.banner_url; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(banner_url),INSERT(banner_url),UPDATE(banner_url) ON TABLE public.markets TO authenticated;
GRANT SELECT(banner_url) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.city; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(city),INSERT(city),UPDATE(city) ON TABLE public.markets TO authenticated;
GRANT SELECT(city) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.county; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(county),INSERT(county),UPDATE(county) ON TABLE public.markets TO authenticated;
GRANT SELECT(county) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.state; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(state),INSERT(state),UPDATE(state) ON TABLE public.markets TO authenticated;
GRANT SELECT(state) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.zip; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(zip),UPDATE(zip) ON TABLE public.markets TO authenticated;


--
-- Name: COLUMN markets.lat; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(lat),UPDATE(lat) ON TABLE public.markets TO authenticated;


--
-- Name: COLUMN markets.lng; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(lng),UPDATE(lng) ON TABLE public.markets TO authenticated;


--
-- Name: COLUMN markets.approximate_location; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(approximate_location),INSERT(approximate_location),UPDATE(approximate_location) ON TABLE public.markets TO authenticated;
GRANT SELECT(approximate_location) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.contact_email; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(contact_email),UPDATE(contact_email) ON TABLE public.markets TO authenticated;


--
-- Name: COLUMN markets.contact_phone; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(contact_phone),UPDATE(contact_phone) ON TABLE public.markets TO authenticated;


--
-- Name: COLUMN markets.website_url; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(website_url),INSERT(website_url),UPDATE(website_url) ON TABLE public.markets TO authenticated;
GRANT SELECT(website_url) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.instagram_url; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(instagram_url),INSERT(instagram_url),UPDATE(instagram_url) ON TABLE public.markets TO authenticated;
GRANT SELECT(instagram_url) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.facebook_url; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(facebook_url),INSERT(facebook_url),UPDATE(facebook_url) ON TABLE public.markets TO authenticated;
GRANT SELECT(facebook_url) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.accepts_free; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(accepts_free),INSERT(accepts_free),UPDATE(accepts_free) ON TABLE public.markets TO authenticated;
GRANT SELECT(accepts_free) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.accepts_trade; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(accepts_trade),INSERT(accepts_trade),UPDATE(accepts_trade) ON TABLE public.markets TO authenticated;
GRANT SELECT(accepts_trade) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.accepts_sales; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(accepts_sales),INSERT(accepts_sales),UPDATE(accepts_sales) ON TABLE public.markets TO authenticated;
GRANT SELECT(accepts_sales) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.pickup_instructions; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(pickup_instructions),UPDATE(pickup_instructions) ON TABLE public.markets TO authenticated;


--
-- Name: COLUMN markets.public_pickup_note; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(public_pickup_note),INSERT(public_pickup_note),UPDATE(public_pickup_note) ON TABLE public.markets TO authenticated;
GRANT SELECT(public_pickup_note) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.verified; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(verified) ON TABLE public.markets TO anon;
GRANT SELECT(verified) ON TABLE public.markets TO authenticated;


--
-- Name: COLUMN markets.sponsor_visible; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(sponsor_visible),INSERT(sponsor_visible),UPDATE(sponsor_visible) ON TABLE public.markets TO authenticated;
GRANT SELECT(sponsor_visible) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.markets TO anon;
GRANT SELECT(created_at) ON TABLE public.markets TO authenticated;


--
-- Name: COLUMN markets.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(updated_at),UPDATE(updated_at) ON TABLE public.markets TO authenticated;
GRANT SELECT(updated_at) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.tagline; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(tagline),INSERT(tagline),UPDATE(tagline) ON TABLE public.markets TO authenticated;
GRANT SELECT(tagline) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.theme; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(theme),INSERT(theme),UPDATE(theme) ON TABLE public.markets TO authenticated;
GRANT SELECT(theme) ON TABLE public.markets TO anon;


--
-- Name: COLUMN markets.extra_pickup_locations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(extra_pickup_locations) ON TABLE public.markets TO anon;
GRANT SELECT(extra_pickup_locations) ON TABLE public.markets TO authenticated;


--
-- Name: FUNCTION admin_market(p_market uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_market(p_market uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_market(p_market uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_market(p_market uuid) TO service_role;


--
-- Name: FUNCTION admin_market_entitlements(p_market uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_market_entitlements(p_market uuid) TO anon;
GRANT ALL ON FUNCTION public.admin_market_entitlements(p_market uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_market_entitlements(p_market uuid) TO service_role;


--
-- Name: FUNCTION admin_markets_overview(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_markets_overview() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_markets_overview() TO authenticated;
GRANT ALL ON FUNCTION public.admin_markets_overview() TO service_role;


--
-- Name: FUNCTION admin_me(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_me() TO anon;
GRANT ALL ON FUNCTION public.admin_me() TO authenticated;
GRANT ALL ON FUNCTION public.admin_me() TO service_role;


--
-- Name: FUNCTION admin_moderation_detail(p_listing uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_moderation_detail(p_listing uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_moderation_detail(p_listing uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_moderation_detail(p_listing uuid) TO service_role;


--
-- Name: FUNCTION admin_modify_grant(p_grant uuid, p_expires timestamp with time zone, p_note text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_modify_grant(p_grant uuid, p_expires timestamp with time zone, p_note text) TO anon;
GRANT ALL ON FUNCTION public.admin_modify_grant(p_grant uuid, p_expires timestamp with time zone, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_modify_grant(p_grant uuid, p_expires timestamp with time zone, p_note text) TO service_role;


--
-- Name: FUNCTION admin_move_lot(p_lot uuid, p_storage text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_move_lot(p_lot uuid, p_storage text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_move_lot(p_lot uuid, p_storage text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_move_lot(p_lot uuid, p_storage text) TO service_role;


--
-- Name: FUNCTION admin_owner_count(p_excluding uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_owner_count(p_excluding uuid) TO anon;
GRANT ALL ON FUNCTION public.admin_owner_count(p_excluding uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_owner_count(p_excluding uuid) TO service_role;


--
-- Name: FUNCTION admin_pack_seed_order(p_order uuid, p_override_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_pack_seed_order(p_order uuid, p_override_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_pack_seed_order(p_order uuid, p_override_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_pack_seed_order(p_order uuid, p_override_reason text) TO service_role;


--
-- Name: FUNCTION admin_pick_seed_item(p_item uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_pick_seed_item(p_item uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_pick_seed_item(p_item uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_pick_seed_item(p_item uuid) TO service_role;


--
-- Name: FUNCTION admin_pickup_location_overview(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_pickup_location_overview() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_pickup_location_overview() TO authenticated;
GRANT ALL ON FUNCTION public.admin_pickup_location_overview() TO service_role;


--
-- Name: FUNCTION admin_receive_lot(p_product uuid, p_qty numeric, p_internal_lot text, p_supplier text, p_supplier_lot text, p_storage text, p_germination numeric, p_cost_cents integer, p_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_receive_lot(p_product uuid, p_qty numeric, p_internal_lot text, p_supplier text, p_supplier_lot text, p_storage text, p_germination numeric, p_cost_cents integer, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_receive_lot(p_product uuid, p_qty numeric, p_internal_lot text, p_supplier text, p_supplier_lot text, p_storage text, p_germination numeric, p_cost_cents integer, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_receive_lot(p_product uuid, p_qty numeric, p_internal_lot text, p_supplier text, p_supplier_lot text, p_storage text, p_germination numeric, p_cost_cents integer, p_note text) TO service_role;


--
-- Name: FUNCTION admin_release_seed_drop(p_order uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_release_seed_drop(p_order uuid) TO anon;
GRANT ALL ON FUNCTION public.admin_release_seed_drop(p_order uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_release_seed_drop(p_order uuid) TO service_role;


--
-- Name: FUNCTION admin_remove_teammate(p_admin uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_remove_teammate(p_admin uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_remove_teammate(p_admin uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_remove_teammate(p_admin uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_resolve_report(p_report uuid, p_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_resolve_report(p_report uuid, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_resolve_report(p_report uuid, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_resolve_report(p_report uuid, p_note text) TO service_role;


--
-- Name: TABLE listings; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.listings TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.listings TO authenticated;
GRANT ALL ON TABLE public.listings TO service_role;


--
-- Name: COLUMN listings.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.listings TO anon;
GRANT SELECT(id) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.owner_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(owner_id) ON TABLE public.listings TO anon;
GRANT SELECT(owner_id) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.title; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(title) ON TABLE public.listings TO anon;
GRANT SELECT(title) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.description; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(description) ON TABLE public.listings TO anon;
GRANT SELECT(description) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.category; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(category) ON TABLE public.listings TO anon;
GRANT SELECT(category) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.quantity; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(quantity) ON TABLE public.listings TO anon;
GRANT SELECT(quantity) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.weight_estimate; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(weight_estimate) ON TABLE public.listings TO anon;
GRANT SELECT(weight_estimate) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.organic_flag; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(organic_flag) ON TABLE public.listings TO anon;
GRANT SELECT(organic_flag) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.delivery_available; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(delivery_available) ON TABLE public.listings TO anon;
GRANT SELECT(delivery_available) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.photos; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(photos) ON TABLE public.listings TO anon;
GRANT SELECT(photos) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.city; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(city) ON TABLE public.listings TO anon;
GRANT SELECT(city) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.county; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(county) ON TABLE public.listings TO anon;
GRANT SELECT(county) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.state; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(state) ON TABLE public.listings TO anon;
GRANT SELECT(state) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.zip; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(zip) ON TABLE public.listings TO anon;
GRANT SELECT(zip) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(status) ON TABLE public.listings TO anon;
GRANT SELECT(status) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.listings TO anon;
GRANT SELECT(created_at) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.expires_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(expires_at) ON TABLE public.listings TO anon;
GRANT SELECT(expires_at) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.kind; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(kind) ON TABLE public.listings TO anon;
GRANT SELECT(kind) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.fulfilled_by_listing_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(fulfilled_by_listing_id) ON TABLE public.listings TO anon;
GRANT SELECT(fulfilled_by_listing_id) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.market_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(market_id) ON TABLE public.listings TO anon;
GRANT SELECT(market_id) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.listing_type; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(listing_type) ON TABLE public.listings TO anon;
GRANT SELECT(listing_type) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.price_cents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(price_cents) ON TABLE public.listings TO anon;
GRANT SELECT(price_cents) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.currency; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(currency) ON TABLE public.listings TO anon;
GRANT SELECT(currency) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.trade_for; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(trade_for) ON TABLE public.listings TO anon;
GRANT SELECT(trade_for) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.unit; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(unit) ON TABLE public.listings TO anon;
GRANT SELECT(unit) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.inventory_count; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(inventory_count) ON TABLE public.listings TO anon;
GRANT SELECT(inventory_count) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.allow_partial_claim; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(allow_partial_claim) ON TABLE public.listings TO anon;
GRANT SELECT(allow_partial_claim) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.fulfillment_type; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(fulfillment_type) ON TABLE public.listings TO anon;
GRANT SELECT(fulfillment_type) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.payment_status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(payment_status) ON TABLE public.listings TO anon;
GRANT SELECT(payment_status) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.seller_note; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(seller_note) ON TABLE public.listings TO anon;
GRANT SELECT(seller_note) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.buyer_note_required; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(buyer_note_required) ON TABLE public.listings TO anon;
GRANT SELECT(buyer_note_required) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.is_featured; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(is_featured) ON TABLE public.listings TO anon;
GRANT SELECT(is_featured) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.featured_until; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(featured_until) ON TABLE public.listings TO anon;
GRANT SELECT(featured_until) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.view_count; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(view_count) ON TABLE public.listings TO anon;
GRANT SELECT(view_count) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.claim_count; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(claim_count) ON TABLE public.listings TO anon;
GRANT SELECT(claim_count) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.approx_lat; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(approx_lat) ON TABLE public.listings TO anon;
GRANT SELECT(approx_lat) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.approx_lng; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(approx_lng) ON TABLE public.listings TO anon;
GRANT SELECT(approx_lng) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.is_demo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(is_demo) ON TABLE public.listings TO anon;
GRANT SELECT(is_demo) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.market_position; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(market_position) ON TABLE public.listings TO anon;
GRANT SELECT(market_position) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.market_featured; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(market_featured) ON TABLE public.listings TO anon;
GRANT SELECT(market_featured) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.taxonomy_node_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(taxonomy_node_id) ON TABLE public.listings TO anon;
GRANT SELECT(taxonomy_node_id) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.request_options; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(request_options) ON TABLE public.listings TO anon;
GRANT SELECT(request_options) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.allow_custom_request; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(allow_custom_request) ON TABLE public.listings TO anon;
GRANT SELECT(allow_custom_request) ON TABLE public.listings TO authenticated;


--
-- Name: COLUMN listings.screening_status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(screening_status) ON TABLE public.listings TO authenticated;
GRANT SELECT(screening_status) ON TABLE public.listings TO anon;


--
-- Name: COLUMN listings.screening_reason; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(screening_reason) ON TABLE public.listings TO authenticated;
GRANT SELECT(screening_reason) ON TABLE public.listings TO anon;


--
-- Name: FUNCTION admin_resolve_screening(p_listing uuid, p_approve boolean, p_reason text, p_suspend_seller boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_resolve_screening(p_listing uuid, p_approve boolean, p_reason text, p_suspend_seller boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_resolve_screening(p_listing uuid, p_approve boolean, p_reason text, p_suspend_seller boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_resolve_screening(p_listing uuid, p_approve boolean, p_reason text, p_suspend_seller boolean) TO service_role;


--
-- Name: FUNCTION admin_review_ai_action(p_request uuid, p_approve boolean, p_reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_review_ai_action(p_request uuid, p_approve boolean, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.admin_review_ai_action(p_request uuid, p_approve boolean, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_review_ai_action(p_request uuid, p_approve boolean, p_reason text) TO service_role;


--
-- Name: TABLE seller_credentials; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.seller_credentials TO anon;
GRANT ALL ON TABLE public.seller_credentials TO authenticated;
GRANT ALL ON TABLE public.seller_credentials TO service_role;


--
-- Name: FUNCTION admin_review_credential(p_credential uuid, p_action text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_review_credential(p_credential uuid, p_action text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_review_credential(p_credential uuid, p_action text, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_review_credential(p_credential uuid, p_action text, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_revoke_compliance_clearance(p_clearance uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_revoke_compliance_clearance(p_clearance uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_revoke_compliance_clearance(p_clearance uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_revoke_compliance_clearance(p_clearance uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_revoke_grant(p_grant uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_revoke_grant(p_grant uuid, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.admin_revoke_grant(p_grant uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_revoke_grant(p_grant uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_revoke_member(p_member uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_revoke_member(p_member uuid, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.admin_revoke_member(p_member uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_revoke_member(p_member uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_role_is_valid(p_role text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_role_is_valid(p_role text) TO anon;
GRANT ALL ON FUNCTION public.admin_role_is_valid(p_role text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_role_is_valid(p_role text) TO service_role;


--
-- Name: FUNCTION admin_role_permissions(p_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_role_permissions(p_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_role_permissions(p_role text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_role_permissions(p_role text) TO service_role;


--
-- Name: FUNCTION admin_screening_counts(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_screening_counts() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_screening_counts() TO authenticated;
GRANT ALL ON FUNCTION public.admin_screening_counts() TO service_role;


--
-- Name: FUNCTION admin_screening_history(p_listing uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_screening_history(p_listing uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_screening_history(p_listing uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_screening_history(p_listing uuid) TO service_role;


--
-- Name: FUNCTION admin_screening_queue(p_class text, p_state text, p_seller uuid, p_since timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_screening_queue(p_class text, p_state text, p_seller uuid, p_since timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_screening_queue(p_class text, p_state text, p_seller uuid, p_since timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.admin_screening_queue(p_class text, p_state text, p_seller uuid, p_since timestamp with time zone) TO service_role;


--
-- Name: FUNCTION admin_screening_settings(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_screening_settings() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_screening_settings() TO authenticated;
GRANT ALL ON FUNCTION public.admin_screening_settings() TO service_role;


--
-- Name: FUNCTION admin_seed_economics(p_window uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_seed_economics(p_window uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_seed_economics(p_window uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_seed_economics(p_window uuid) TO service_role;


--
-- Name: FUNCTION admin_seed_queue(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_seed_queue() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_seed_queue() TO authenticated;
GRANT ALL ON FUNCTION public.admin_seed_queue() TO service_role;


--
-- Name: FUNCTION admin_seed_substitutes(p_item uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_seed_substitutes(p_item uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_seed_substitutes(p_item uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_seed_substitutes(p_item uuid) TO service_role;


--
-- Name: FUNCTION admin_seed_wave_generate(p_window uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_seed_wave_generate(p_window uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_seed_wave_generate(p_window uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_seed_wave_generate(p_window uuid) TO service_role;


--
-- Name: FUNCTION admin_seed_wave_preview(p_window uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_seed_wave_preview(p_window uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_seed_wave_preview(p_window uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_seed_wave_preview(p_window uuid) TO service_role;


--
-- Name: FUNCTION admin_set_agent(p_agent text, p_status text, p_automation integer, p_provider text, p_model text, p_budget integer, p_fallback_provider text, p_fallback_model text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_agent(p_agent text, p_status text, p_automation integer, p_provider text, p_model text, p_budget integer, p_fallback_provider text, p_fallback_model text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_agent(p_agent text, p_status text, p_automation integer, p_provider text, p_model text, p_budget integer, p_fallback_provider text, p_fallback_model text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_agent(p_agent text, p_status text, p_automation integer, p_provider text, p_model text, p_budget integer, p_fallback_provider text, p_fallback_model text) TO service_role;


--
-- Name: TABLE ai_agents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.ai_agents TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.ai_agents TO authenticated;
GRANT ALL ON TABLE public.ai_agents TO service_role;


--
-- Name: FUNCTION admin_set_agent_authority(p_agent text, p_level text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_agent_authority(p_agent text, p_level text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_agent_authority(p_agent text, p_level text, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_agent_authority(p_agent text, p_level text, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_set_ai_paused(p_paused boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_set_ai_paused(p_paused boolean) TO anon;
GRANT ALL ON FUNCTION public.admin_set_ai_paused(p_paused boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_ai_paused(p_paused boolean) TO service_role;


--
-- Name: FUNCTION admin_set_ai_reads(p_enabled boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_ai_reads(p_enabled boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_ai_reads(p_enabled boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_ai_reads(p_enabled boolean) TO service_role;


--
-- Name: FUNCTION admin_set_listing_status(p_listing uuid, p_status text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_listing_status(p_listing uuid, p_status text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_listing_status(p_listing uuid, p_status text, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_listing_status(p_listing uuid, p_status text, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_set_lot_status(p_lot uuid, p_status text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_lot_status(p_lot uuid, p_status text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_lot_status(p_lot uuid, p_status text, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_lot_status(p_lot uuid, p_status text, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_set_paid_fallback(p_allow boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_paid_fallback(p_allow boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_paid_fallback(p_allow boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_paid_fallback(p_allow boolean) TO service_role;


--
-- Name: FUNCTION admin_set_payments_live(p_enabled boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_payments_live(p_enabled boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_payments_live(p_enabled boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_payments_live(p_enabled boolean) TO service_role;


--
-- Name: TABLE content_screening_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.content_screening_config TO service_role;


--
-- Name: FUNCTION admin_set_screening_config(p_enabled boolean, p_max_per_hour integer, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_screening_config(p_enabled boolean, p_max_per_hour integer, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_screening_config(p_enabled boolean, p_max_per_hour integer, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_screening_config(p_enabled boolean, p_max_per_hour integer, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_set_seed_order_costs(p_order uuid, p_postage integer, p_packaging integer, p_insert integer, p_payment_fee integer, p_other integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_seed_order_costs(p_order uuid, p_postage integer, p_packaging integer, p_insert integer, p_payment_fee integer, p_other integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_seed_order_costs(p_order uuid, p_postage integer, p_packaging integer, p_insert integer, p_payment_fee integer, p_other integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_seed_order_costs(p_order uuid, p_postage integer, p_packaging integer, p_insert integer, p_payment_fee integer, p_other integer) TO service_role;


--
-- Name: FUNCTION admin_set_suspended(p_user uuid, p_suspended boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_suspended(p_user uuid, p_suspended boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_suspended(p_user uuid, p_suspended boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_suspended(p_user uuid, p_suspended boolean) TO service_role;


--
-- Name: FUNCTION admin_set_teammate_role(p_admin uuid, p_role text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_teammate_role(p_admin uuid, p_role text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_teammate_role(p_admin uuid, p_role text, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_teammate_role(p_admin uuid, p_role text, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_ship_seed_order(p_order uuid, p_carrier text, p_tracking text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_ship_seed_order(p_order uuid, p_carrier text, p_tracking text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_ship_seed_order(p_order uuid, p_carrier text, p_tracking text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_ship_seed_order(p_order uuid, p_carrier text, p_tracking text) TO service_role;


--
-- Name: FUNCTION admin_substitute_seed_item(p_item uuid, p_product uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_substitute_seed_item(p_item uuid, p_product uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_substitute_seed_item(p_item uuid, p_product uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_substitute_seed_item(p_item uuid, p_product uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION admin_team_audit(p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_team_audit(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_team_audit(p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_team_audit(p_limit integer) TO service_role;


--
-- Name: FUNCTION admin_team_roles(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_team_roles() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_team_roles() TO authenticated;
GRANT ALL ON FUNCTION public.admin_team_roles() TO service_role;


--
-- Name: FUNCTION admin_team_roster(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_team_roster() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_team_roster() TO authenticated;
GRANT ALL ON FUNCTION public.admin_team_roster() TO service_role;


--
-- Name: FUNCTION admin_upsert_member(p_email text, p_name text, p_role text, p_extra text[], p_denied text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_upsert_member(p_email text, p_name text, p_role text, p_extra text[], p_denied text[]) TO anon;
GRANT ALL ON FUNCTION public.admin_upsert_member(p_email text, p_name text, p_role text, p_extra text[], p_denied text[]) TO authenticated;
GRANT ALL ON FUNCTION public.admin_upsert_member(p_email text, p_name text, p_role text, p_extra text[], p_denied text[]) TO service_role;


--
-- Name: TABLE prohibited_terms; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.prohibited_terms TO service_role;


--
-- Name: FUNCTION admin_upsert_prohibited_term(p_term text, p_action text, p_category text, p_rationale text, p_exempt_if text[], p_active boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_upsert_prohibited_term(p_term text, p_action text, p_category text, p_rationale text, p_exempt_if text[], p_active boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_upsert_prohibited_term(p_term text, p_action text, p_category text, p_rationale text, p_exempt_if text[], p_active boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_upsert_prohibited_term(p_term text, p_action text, p_category text, p_rationale text, p_exempt_if text[], p_active boolean) TO service_role;


--
-- Name: FUNCTION admin_upsert_seed_product(p_id uuid, p_crop text, p_variety text, p_category text, p_sku text, p_supplier text, p_supplier_code text, p_packet_size text, p_barcode text, p_cost_cents integer, p_reorder_threshold integer, p_suggested_reorder integer, p_notes text, p_archived boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_upsert_seed_product(p_id uuid, p_crop text, p_variety text, p_category text, p_sku text, p_supplier text, p_supplier_code text, p_packet_size text, p_barcode text, p_cost_cents integer, p_reorder_threshold integer, p_suggested_reorder integer, p_notes text, p_archived boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_upsert_seed_product(p_id uuid, p_crop text, p_variety text, p_category text, p_sku text, p_supplier text, p_supplier_code text, p_packet_size text, p_barcode text, p_cost_cents integer, p_reorder_threshold integer, p_suggested_reorder integer, p_notes text, p_archived boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_upsert_seed_product(p_id uuid, p_crop text, p_variety text, p_category text, p_sku text, p_supplier text, p_supplier_code text, p_packet_size text, p_barcode text, p_cost_cents integer, p_reorder_threshold integer, p_suggested_reorder integer, p_notes text, p_archived boolean) TO service_role;


--
-- Name: FUNCTION admin_user_email(p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_user_email(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_user_email(p_user uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_user_email(p_user uuid) TO service_role;


--
-- Name: FUNCTION ai_agents_no_cycle(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.ai_agents_no_cycle() TO anon;
GRANT ALL ON FUNCTION public.ai_agents_no_cycle() TO authenticated;
GRANT ALL ON FUNCTION public.ai_agents_no_cycle() TO service_role;


--
-- Name: FUNCTION ai_file_action_request(p_agent text, p_action text, p_params jsonb, p_summary text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ai_file_action_request(p_agent text, p_action text, p_params jsonb, p_summary text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ai_file_action_request(p_agent text, p_action text, p_params jsonb, p_summary text, p_reason text) TO service_role;


--
-- Name: FUNCTION ai_reserve_slot(p_uid uuid, p_feature text, p_cap integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ai_reserve_slot(p_uid uuid, p_feature text, p_cap integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ai_reserve_slot(p_uid uuid, p_feature text, p_cap integer) TO service_role;


--
-- Name: FUNCTION ai_usage_increment(p_user uuid, p_feature text, p_cap integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ai_usage_increment(p_user uuid, p_feature text, p_cap integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ai_usage_increment(p_user uuid, p_feature text, p_cap integer) TO service_role;


--
-- Name: FUNCTION billing_activate_bundle(p_market uuid, p_user uuid, p_plan public.market_plan, p_sub_stripe text, p_customer text, p_livemode boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.billing_activate_bundle(p_market uuid, p_user uuid, p_plan public.market_plan, p_sub_stripe text, p_customer text, p_livemode boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.billing_activate_bundle(p_market uuid, p_user uuid, p_plan public.market_plan, p_sub_stripe text, p_customer text, p_livemode boolean) TO service_role;


--
-- Name: FUNCTION billing_grant_promo_credit(p_market uuid, p_session text, p_livemode boolean, p_qty integer, p_source text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.billing_grant_promo_credit(p_market uuid, p_session text, p_livemode boolean, p_qty integer, p_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.billing_grant_promo_credit(p_market uuid, p_session text, p_livemode boolean, p_qty integer, p_source text) TO service_role;


--
-- Name: FUNCTION billing_log_event(p_event text, p_type text, p_livemode boolean, p_market uuid, p_user uuid, p_product text, p_amount integer, p_effect text, p_meta jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.billing_log_event(p_event text, p_type text, p_livemode boolean, p_market uuid, p_user uuid, p_product text, p_amount integer, p_effect text, p_meta jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.billing_log_event(p_event text, p_type text, p_livemode boolean, p_market uuid, p_user uuid, p_product text, p_amount integer, p_effect text, p_meta jsonb) TO service_role;


--
-- Name: FUNCTION billing_pay_seed_seasonal(p_session text, p_livemode boolean, p_sub uuid, p_amount integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.billing_pay_seed_seasonal(p_session text, p_livemode boolean, p_sub uuid, p_amount integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.billing_pay_seed_seasonal(p_session text, p_livemode boolean, p_sub uuid, p_amount integer) TO service_role;


--
-- Name: FUNCTION billing_price_id(p_key text, p_mode text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.billing_price_id(p_key text, p_mode text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.billing_price_id(p_key text, p_mode text) TO authenticated;
GRANT ALL ON FUNCTION public.billing_price_id(p_key text, p_mode text) TO service_role;


--
-- Name: FUNCTION billing_purchase_and_promote(p_session text, p_livemode boolean, p_market uuid, p_listing uuid, p_amount integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.billing_purchase_and_promote(p_session text, p_livemode boolean, p_market uuid, p_listing uuid, p_amount integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.billing_purchase_and_promote(p_session text, p_livemode boolean, p_market uuid, p_listing uuid, p_amount integer) TO service_role;


--
-- Name: FUNCTION billing_refund_promo_credit(p_session text, p_livemode boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.billing_refund_promo_credit(p_session text, p_livemode boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.billing_refund_promo_credit(p_session text, p_livemode boolean) TO service_role;


--
-- Name: FUNCTION blocked_pair(a uuid, b uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.blocked_pair(a uuid, b uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.blocked_pair(a uuid, b uuid) TO service_role;


--
-- Name: FUNCTION can_publish_in_node(p_node_id uuid, p_user uuid, p_jurisdiction text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_publish_in_node(p_node_id uuid, p_user uuid, p_jurisdiction text) TO anon;
GRANT ALL ON FUNCTION public.can_publish_in_node(p_node_id uuid, p_user uuid, p_jurisdiction text) TO authenticated;
GRANT ALL ON FUNCTION public.can_publish_in_node(p_node_id uuid, p_user uuid, p_jurisdiction text) TO service_role;


--
-- Name: FUNCTION cancel_market_order(p_order uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_market_order(p_order uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_market_order(p_order uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_market_order(p_order uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION cart_pickup_locations(p_market uuid, p_listings uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cart_pickup_locations(p_market uuid, p_listings uuid[]) TO anon;
GRANT ALL ON FUNCTION public.cart_pickup_locations(p_market uuid, p_listings uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.cart_pickup_locations(p_market uuid, p_listings uuid[]) TO service_role;


--
-- Name: FUNCTION check_claim_not_blocked(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.check_claim_not_blocked() TO anon;
GRANT ALL ON FUNCTION public.check_claim_not_blocked() TO authenticated;
GRANT ALL ON FUNCTION public.check_claim_not_blocked() TO service_role;


--
-- Name: FUNCTION check_message_not_blocked(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.check_message_not_blocked() TO anon;
GRANT ALL ON FUNCTION public.check_message_not_blocked() TO authenticated;
GRANT ALL ON FUNCTION public.check_message_not_blocked() TO service_role;


--
-- Name: FUNCTION claim_messages_kind_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.claim_messages_kind_guard() TO anon;
GRANT ALL ON FUNCTION public.claim_messages_kind_guard() TO authenticated;
GRANT ALL ON FUNCTION public.claim_messages_kind_guard() TO service_role;


--
-- Name: FUNCTION claim_messages_rate_limit(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.claim_messages_rate_limit() TO anon;
GRANT ALL ON FUNCTION public.claim_messages_rate_limit() TO authenticated;
GRANT ALL ON FUNCTION public.claim_messages_rate_limit() TO service_role;


--
-- Name: FUNCTION claim_status_of(cid uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.claim_status_of(cid uuid) TO anon;
GRANT ALL ON FUNCTION public.claim_status_of(cid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.claim_status_of(cid uuid) TO service_role;


--
-- Name: FUNCTION complete_market_order(p_order uuid, p_record_payment boolean, p_method text, p_amount_cents integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_market_order(p_order uuid, p_record_payment boolean, p_method text, p_amount_cents integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_market_order(p_order uuid, p_record_payment boolean, p_method text, p_amount_cents integer) TO authenticated;
GRANT ALL ON FUNCTION public.complete_market_order(p_order uuid, p_record_payment boolean, p_method text, p_amount_cents integer) TO service_role;


--
-- Name: FUNCTION compliance_reactivate_for_seller(p_seller uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.compliance_reactivate_for_seller(p_seller uuid) TO anon;
GRANT ALL ON FUNCTION public.compliance_reactivate_for_seller(p_seller uuid) TO authenticated;
GRANT ALL ON FUNCTION public.compliance_reactivate_for_seller(p_seller uuid) TO service_role;


--
-- Name: FUNCTION compliance_run_expiry(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.compliance_run_expiry() FROM PUBLIC;
GRANT ALL ON FUNCTION public.compliance_run_expiry() TO service_role;


--
-- Name: FUNCTION confirm_market_order(p_order uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.confirm_market_order(p_order uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_market_order(p_order uuid) TO authenticated;
GRANT ALL ON FUNCTION public.confirm_market_order(p_order uuid) TO service_role;


--
-- Name: FUNCTION create_market_order(p_market uuid, p_items jsonb, p_start timestamp with time zone, p_end timestamp with time zone, p_note text, p_location uuid, p_fulfillment text, p_address uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_market_order(p_market uuid, p_items jsonb, p_start timestamp with time zone, p_end timestamp with time zone, p_note text, p_location uuid, p_fulfillment text, p_address uuid) TO anon;
GRANT ALL ON FUNCTION public.create_market_order(p_market uuid, p_items jsonb, p_start timestamp with time zone, p_end timestamp with time zone, p_note text, p_location uuid, p_fulfillment text, p_address uuid) TO authenticated;
GRANT ALL ON FUNCTION public.create_market_order(p_market uuid, p_items jsonb, p_start timestamp with time zone, p_end timestamp with time zone, p_note text, p_location uuid, p_fulfillment text, p_address uuid) TO service_role;


--
-- Name: FUNCTION decline_market_order(p_order uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.decline_market_order(p_order uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decline_market_order(p_order uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.decline_market_order(p_order uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION delivery_allowed_for_node(p_node uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delivery_allowed_for_node(p_node uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delivery_allowed_for_node(p_node uuid) TO service_role;


--
-- Name: FUNCTION delivery_quote(p_market uuid, p_address uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.delivery_quote(p_market uuid, p_address uuid) TO anon;
GRANT ALL ON FUNCTION public.delivery_quote(p_market uuid, p_address uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delivery_quote(p_market uuid, p_address uuid) TO service_role;


--
-- Name: FUNCTION discard_listing_draft(p_draft uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.discard_listing_draft(p_draft uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.discard_listing_draft(p_draft uuid) TO authenticated;
GRANT ALL ON FUNCTION public.discard_listing_draft(p_draft uuid) TO service_role;


--
-- Name: TABLE compliance_rules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.compliance_rules TO anon;
GRANT ALL ON TABLE public.compliance_rules TO authenticated;
GRANT ALL ON TABLE public.compliance_rules TO service_role;


--
-- Name: FUNCTION effective_compliance_rule(p_node_id uuid, p_jurisdiction text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.effective_compliance_rule(p_node_id uuid, p_jurisdiction text) TO anon;
GRANT ALL ON FUNCTION public.effective_compliance_rule(p_node_id uuid, p_jurisdiction text) TO authenticated;
GRANT ALL ON FUNCTION public.effective_compliance_rule(p_node_id uuid, p_jurisdiction text) TO service_role;


--
-- Name: FUNCTION enforce_delivery_plan(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_delivery_plan() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_delivery_plan() TO service_role;


--
-- Name: FUNCTION enforce_pickup_location_limit(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_pickup_location_limit() TO anon;
GRANT ALL ON FUNCTION public.enforce_pickup_location_limit() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_pickup_location_limit() TO service_role;


--
-- Name: FUNCTION enforce_plan_limit(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_plan_limit() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_plan_limit() TO service_role;


--
-- Name: FUNCTION enforce_plot_plan(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_plot_plan() TO anon;
GRANT ALL ON FUNCTION public.enforce_plot_plan() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_plot_plan() TO service_role;


--
-- Name: FUNCTION enforce_promotion(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_promotion() TO anon;
GRANT ALL ON FUNCTION public.enforce_promotion() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_promotion() TO service_role;


--
-- Name: FUNCTION events_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.events_guard() TO anon;
GRANT ALL ON FUNCTION public.events_guard() TO authenticated;
GRANT ALL ON FUNCTION public.events_guard() TO service_role;


--
-- Name: FUNCTION expire_finished_promotions(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.expire_finished_promotions() FROM PUBLIC;
GRANT ALL ON FUNCTION public.expire_finished_promotions() TO authenticated;
GRANT ALL ON FUNCTION public.expire_finished_promotions() TO service_role;


--
-- Name: FUNCTION generate_seed_drop(p_order uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.generate_seed_drop(p_order uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.generate_seed_drop(p_order uuid) TO service_role;


--
-- Name: FUNCTION generate_seed_subscription_order(p_sub uuid, p_paid boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.generate_seed_subscription_order(p_sub uuid, p_paid boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.generate_seed_subscription_order(p_sub uuid, p_paid boolean) TO service_role;


--
-- Name: FUNCTION gnome_slugify(txt text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gnome_slugify(txt text) TO anon;
GRANT ALL ON FUNCTION public.gnome_slugify(txt text) TO authenticated;
GRANT ALL ON FUNCTION public.gnome_slugify(txt text) TO service_role;


--
-- Name: FUNCTION grow_log_context(p_claim uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.grow_log_context(p_claim uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.grow_log_context(p_claim uuid) TO authenticated;
GRANT ALL ON FUNCTION public.grow_log_context(p_claim uuid) TO service_role;


--
-- Name: FUNCTION handle_claim_status(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_claim_status() TO anon;
GRANT ALL ON FUNCTION public.handle_claim_status() TO authenticated;
GRANT ALL ON FUNCTION public.handle_claim_status() TO service_role;


--
-- Name: FUNCTION handle_new_profile(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_profile() TO anon;
GRANT ALL ON FUNCTION public.handle_new_profile() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_profile() TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION has_claim_on(lid uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.has_claim_on(lid uuid) TO anon;
GRANT ALL ON FUNCTION public.has_claim_on(lid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.has_claim_on(lid uuid) TO service_role;


--
-- Name: FUNCTION haversine_miles(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.haversine_miles(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision) FROM PUBLIC;
GRANT ALL ON FUNCTION public.haversine_miles(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision) TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_admin() TO anon;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION is_claim_party(cid uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_claim_party(cid uuid) TO anon;
GRANT ALL ON FUNCTION public.is_claim_party(cid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_claim_party(cid uuid) TO service_role;


--
-- Name: FUNCTION is_plot_party(p_claim uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_plot_party(p_claim uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_plot_party(p_claim uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_plot_party(p_claim uuid) TO service_role;


--
-- Name: FUNCTION listing_has_verified_credential(p_listing uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.listing_has_verified_credential(p_listing uuid) TO anon;
GRANT ALL ON FUNCTION public.listing_has_verified_credential(p_listing uuid) TO authenticated;
GRANT ALL ON FUNCTION public.listing_has_verified_credential(p_listing uuid) TO service_role;


--
-- Name: FUNCTION listings_before_write(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.listings_before_write() TO anon;
GRANT ALL ON FUNCTION public.listings_before_write() TO authenticated;
GRANT ALL ON FUNCTION public.listings_before_write() TO service_role;


--
-- Name: FUNCTION listings_block_suspended(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.listings_block_suspended() TO anon;
GRANT ALL ON FUNCTION public.listings_block_suspended() TO authenticated;
GRANT ALL ON FUNCTION public.listings_block_suspended() TO service_role;


--
-- Name: FUNCTION listings_enforce_compliance(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.listings_enforce_compliance() TO anon;
GRANT ALL ON FUNCTION public.listings_enforce_compliance() TO authenticated;
GRANT ALL ON FUNCTION public.listings_enforce_compliance() TO service_role;


--
-- Name: FUNCTION listings_fill_taxonomy(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.listings_fill_taxonomy() TO anon;
GRANT ALL ON FUNCTION public.listings_fill_taxonomy() TO authenticated;
GRANT ALL ON FUNCTION public.listings_fill_taxonomy() TO service_role;


--
-- Name: FUNCTION listings_screen_content(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.listings_screen_content() TO anon;
GRANT ALL ON FUNCTION public.listings_screen_content() TO authenticated;
GRANT ALL ON FUNCTION public.listings_screen_content() TO service_role;


--
-- Name: FUNCTION location_available_slots(p_location uuid, p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.location_available_slots(p_location uuid, p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.location_available_slots(p_location uuid, p_days integer) TO anon;
GRANT ALL ON FUNCTION public.location_available_slots(p_location uuid, p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.location_available_slots(p_location uuid, p_days integer) TO service_role;


--
-- Name: FUNCTION mark_order_ready(p_order uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_order_ready(p_order uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_order_ready(p_order uuid) TO authenticated;
GRANT ALL ON FUNCTION public.mark_order_ready(p_order uuid) TO service_role;


--
-- Name: FUNCTION mark_out_for_delivery(p_order uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.mark_out_for_delivery(p_order uuid) TO anon;
GRANT ALL ON FUNCTION public.mark_out_for_delivery(p_order uuid) TO authenticated;
GRANT ALL ON FUNCTION public.mark_out_for_delivery(p_order uuid) TO service_role;


--
-- Name: FUNCTION market_active_listing_count(mid uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.market_active_listing_count(mid uuid) TO anon;
GRANT ALL ON FUNCTION public.market_active_listing_count(mid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.market_active_listing_count(mid uuid) TO service_role;


--
-- Name: FUNCTION market_available_slots(p_market uuid, p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.market_available_slots(p_market uuid, p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.market_available_slots(p_market uuid, p_days integer) TO anon;
GRANT ALL ON FUNCTION public.market_available_slots(p_market uuid, p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.market_available_slots(p_market uuid, p_days integer) TO service_role;


--
-- Name: FUNCTION market_boost_credits_remaining(p_market_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.market_boost_credits_remaining(p_market_id uuid) TO anon;
GRANT ALL ON FUNCTION public.market_boost_credits_remaining(p_market_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.market_boost_credits_remaining(p_market_id uuid) TO service_role;


--
-- Name: FUNCTION market_delivery_origin(p_market uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.market_delivery_origin(p_market uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.market_delivery_origin(p_market uuid) TO service_role;


--
-- Name: FUNCTION market_effective_plan(p_market uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.market_effective_plan(p_market uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.market_effective_plan(p_market uuid) TO service_role;


--
-- Name: FUNCTION market_orders_event_log(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.market_orders_event_log() TO anon;
GRANT ALL ON FUNCTION public.market_orders_event_log() TO authenticated;
GRANT ALL ON FUNCTION public.market_orders_event_log() TO service_role;


--
-- Name: FUNCTION market_pickup_location_allowance(p_market uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.market_pickup_location_allowance(p_market uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.market_pickup_location_allowance(p_market uuid) TO service_role;


--
-- Name: FUNCTION market_pickup_locations_default_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.market_pickup_locations_default_guard() TO anon;
GRANT ALL ON FUNCTION public.market_pickup_locations_default_guard() TO authenticated;
GRANT ALL ON FUNCTION public.market_pickup_locations_default_guard() TO service_role;


--
-- Name: FUNCTION market_promotion_performance(p_market uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.market_promotion_performance(p_market uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.market_promotion_performance(p_market uuid) TO authenticated;
GRANT ALL ON FUNCTION public.market_promotion_performance(p_market uuid) TO service_role;


--
-- Name: FUNCTION market_promotion_status(p_market uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.market_promotion_status(p_market uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.market_promotion_status(p_market uuid) TO authenticated;
GRANT ALL ON FUNCTION public.market_promotion_status(p_market uuid) TO service_role;


--
-- Name: FUNCTION market_purchased_promo_balance(p_market uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.market_purchased_promo_balance(p_market uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.market_purchased_promo_balance(p_market uuid) TO authenticated;
GRANT ALL ON FUNCTION public.market_purchased_promo_balance(p_market uuid) TO service_role;


--
-- Name: FUNCTION markets_plan_change_reconcile(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.markets_plan_change_reconcile() TO anon;
GRANT ALL ON FUNCTION public.markets_plan_change_reconcile() TO authenticated;
GRANT ALL ON FUNCTION public.markets_plan_change_reconcile() TO service_role;


--
-- Name: FUNCTION my_market(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_market() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_market() TO authenticated;
GRANT ALL ON FUNCTION public.my_market() TO service_role;


--
-- Name: FUNCTION my_onboarding_state(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_onboarding_state() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_onboarding_state() TO authenticated;
GRANT ALL ON FUNCTION public.my_onboarding_state() TO service_role;


--
-- Name: TABLE market_pickup_locations; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.market_pickup_locations TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.market_pickup_locations TO authenticated;
GRANT ALL ON TABLE public.market_pickup_locations TO service_role;


--
-- Name: COLUMN market_pickup_locations.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(id) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.market_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(market_id) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(market_id) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.nickname; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(nickname) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(nickname) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.location_type; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(location_type) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(location_type) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.city; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(city) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(city) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.state; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(state) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(state) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.postal_code; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(postal_code) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(postal_code) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.approx_lat; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(approx_lat) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(approx_lat) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.approx_lng; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(approx_lng) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(approx_lng) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.public_address_visible; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(public_address_visible) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(public_address_visible) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.timezone; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(timezone) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(timezone) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.slot_minutes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(slot_minutes) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(slot_minutes) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.lead_time_minutes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(lead_time_minutes) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(lead_time_minutes) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.max_orders_per_slot; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(max_orders_per_slot) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(max_orders_per_slot) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.active; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(active) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(active) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.is_default; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(is_default) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(is_default) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.plan_restricted; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(plan_restricted) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(plan_restricted) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(created_at) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: COLUMN market_pickup_locations.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(updated_at) ON TABLE public.market_pickup_locations TO anon;
GRANT SELECT(updated_at) ON TABLE public.market_pickup_locations TO authenticated;


--
-- Name: FUNCTION my_pickup_locations(p_market uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_pickup_locations(p_market uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_pickup_locations(p_market uuid) TO authenticated;
GRANT ALL ON FUNCTION public.my_pickup_locations(p_market uuid) TO service_role;


--
-- Name: FUNCTION my_plan_entitlements(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.my_plan_entitlements() TO anon;
GRANT ALL ON FUNCTION public.my_plan_entitlements() TO authenticated;
GRANT ALL ON FUNCTION public.my_plan_entitlements() TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN ON TABLE public.profiles TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: COLUMN profiles.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.profiles TO anon;
GRANT SELECT(id) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.name; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(name) ON TABLE public.profiles TO anon;
GRANT SELECT(name),UPDATE(name) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.avatar_url; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(avatar_url) ON TABLE public.profiles TO anon;
GRANT SELECT(avatar_url),UPDATE(avatar_url) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.zip_code; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(zip_code) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.city; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(city) ON TABLE public.profiles TO anon;
GRANT SELECT(city),UPDATE(city) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.county; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(county) ON TABLE public.profiles TO anon;
GRANT SELECT(county),UPDATE(county) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.state; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(state) ON TABLE public.profiles TO anon;
GRANT SELECT(state),UPDATE(state) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.user_type; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(user_type) ON TABLE public.profiles TO anon;
GRANT SELECT(user_type),UPDATE(user_type) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.business_account; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(business_account) ON TABLE public.profiles TO anon;
GRANT SELECT(business_account),UPDATE(business_account) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.business_category; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(business_category) ON TABLE public.profiles TO anon;
GRANT SELECT(business_category),UPDATE(business_category) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.can_post; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(can_post) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.can_claim; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(can_claim) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.can_sponsor; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(can_sponsor) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.can_create_promotions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(can_create_promotions) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.can_offer_delivery; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(can_offer_delivery) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.profiles TO anon;
GRANT SELECT(created_at) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.suspended; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(suspended) ON TABLE public.profiles TO authenticated;


--
-- Name: FUNCTION my_profile(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_profile() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_profile() TO authenticated;
GRANT ALL ON FUNCTION public.my_profile() TO service_role;


--
-- Name: FUNCTION normalize_state(p_state text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.normalize_state(p_state text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.normalize_state(p_state text) TO authenticated;
GRANT ALL ON FUNCTION public.normalize_state(p_state text) TO service_role;


--
-- Name: FUNCTION order_delivery_details(p_order uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.order_delivery_details(p_order uuid) TO anon;
GRANT ALL ON FUNCTION public.order_delivery_details(p_order uuid) TO authenticated;
GRANT ALL ON FUNCTION public.order_delivery_details(p_order uuid) TO service_role;


--
-- Name: FUNCTION order_pickup_details(p_order uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.order_pickup_details(p_order uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.order_pickup_details(p_order uuid) TO authenticated;
GRANT ALL ON FUNCTION public.order_pickup_details(p_order uuid) TO service_role;


--
-- Name: FUNCTION owns_market(mid uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.owns_market(mid uuid) TO anon;
GRANT ALL ON FUNCTION public.owns_market(mid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.owns_market(mid uuid) TO service_role;


--
-- Name: FUNCTION plan_rank(p public.market_plan); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.plan_rank(p public.market_plan) TO anon;
GRANT ALL ON FUNCTION public.plan_rank(p public.market_plan) TO authenticated;
GRANT ALL ON FUNCTION public.plan_rank(p public.market_plan) TO service_role;


--
-- Name: FUNCTION plot_grow_logs_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.plot_grow_logs_guard() TO anon;
GRANT ALL ON FUNCTION public.plot_grow_logs_guard() TO authenticated;
GRANT ALL ON FUNCTION public.plot_grow_logs_guard() TO service_role;


--
-- Name: TABLE seed_drop_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.seed_drop_subscriptions TO authenticated;
GRANT ALL ON TABLE public.seed_drop_subscriptions TO service_role;


--
-- Name: COLUMN seed_drop_subscriptions.user_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(user_id) ON TABLE public.seed_drop_subscriptions TO authenticated;


--
-- Name: COLUMN seed_drop_subscriptions.cadence; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(cadence),UPDATE(cadence) ON TABLE public.seed_drop_subscriptions TO authenticated;


--
-- Name: COLUMN seed_drop_subscriptions.status; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(status) ON TABLE public.seed_drop_subscriptions TO authenticated;


--
-- Name: COLUMN seed_drop_subscriptions.packet_count; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(packet_count),UPDATE(packet_count) ON TABLE public.seed_drop_subscriptions TO authenticated;


--
-- Name: COLUMN seed_drop_subscriptions.ship_name; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(ship_name),UPDATE(ship_name) ON TABLE public.seed_drop_subscriptions TO authenticated;


--
-- Name: COLUMN seed_drop_subscriptions.ship_address_line; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(ship_address_line),UPDATE(ship_address_line) ON TABLE public.seed_drop_subscriptions TO authenticated;


--
-- Name: COLUMN seed_drop_subscriptions.ship_city; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(ship_city),UPDATE(ship_city) ON TABLE public.seed_drop_subscriptions TO authenticated;


--
-- Name: COLUMN seed_drop_subscriptions.ship_state; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(ship_state),UPDATE(ship_state) ON TABLE public.seed_drop_subscriptions TO authenticated;


--
-- Name: COLUMN seed_drop_subscriptions.ship_postal_code; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(ship_postal_code),UPDATE(ship_postal_code) ON TABLE public.seed_drop_subscriptions TO authenticated;


--
-- Name: COLUMN seed_drop_subscriptions.profile_snapshot; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(profile_snapshot) ON TABLE public.seed_drop_subscriptions TO authenticated;


--
-- Name: COLUMN seed_drop_subscriptions.preferences; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(preferences),UPDATE(preferences) ON TABLE public.seed_drop_subscriptions TO authenticated;


--
-- Name: COLUMN seed_drop_subscriptions.exclusions; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(exclusions),UPDATE(exclusions) ON TABLE public.seed_drop_subscriptions TO authenticated;


--
-- Name: COLUMN seed_drop_subscriptions.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(updated_at) ON TABLE public.seed_drop_subscriptions TO authenticated;


--
-- Name: FUNCTION price_from_sub(s public.seed_drop_subscriptions); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.price_from_sub(s public.seed_drop_subscriptions) TO anon;
GRANT ALL ON FUNCTION public.price_from_sub(s public.seed_drop_subscriptions) TO authenticated;
GRANT ALL ON FUNCTION public.price_from_sub(s public.seed_drop_subscriptions) TO service_role;


--
-- Name: FUNCTION promote_listing_purchased(p_listing uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.promote_listing_purchased(p_listing uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.promote_listing_purchased(p_listing uuid) TO authenticated;
GRANT ALL ON FUNCTION public.promote_listing_purchased(p_listing uuid) TO service_role;


--
-- Name: FUNCTION propose_order_time(p_order uuid, p_start timestamp with time zone, p_end timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.propose_order_time(p_order uuid, p_start timestamp with time zone, p_end timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.propose_order_time(p_order uuid, p_start timestamp with time zone, p_end timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.propose_order_time(p_order uuid, p_start timestamp with time zone, p_end timestamp with time zone) TO service_role;


--
-- Name: FUNCTION public_pickup_locations(p_market uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.public_pickup_locations(p_market uuid) TO anon;
GRANT ALL ON FUNCTION public.public_pickup_locations(p_market uuid) TO authenticated;
GRANT ALL ON FUNCTION public.public_pickup_locations(p_market uuid) TO service_role;


--
-- Name: FUNCTION publish_eligibility(p_node_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.publish_eligibility(p_node_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_eligibility(p_node_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.publish_eligibility(p_node_id uuid) TO service_role;


--
-- Name: FUNCTION publish_listing_draft(p_draft uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.publish_listing_draft(p_draft uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_listing_draft(p_draft uuid) TO authenticated;
GRANT ALL ON FUNCTION public.publish_listing_draft(p_draft uuid) TO service_role;


--
-- Name: FUNCTION reconcile_pickup_locations(p_market uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reconcile_pickup_locations(p_market uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconcile_pickup_locations(p_market uuid) TO authenticated;
GRANT ALL ON FUNCTION public.reconcile_pickup_locations(p_market uuid) TO service_role;


--
-- Name: FUNCTION record_sale(p_market uuid, p_listing uuid, p_claim uuid, p_quantity numeric, p_gross_cents integer, p_discount_cents integer, p_fee_cents integer, p_payment_method text, p_buyer_label text, p_notes text, p_source text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_sale(p_market uuid, p_listing uuid, p_claim uuid, p_quantity numeric, p_gross_cents integer, p_discount_cents integer, p_fee_cents integer, p_payment_method text, p_buyer_label text, p_notes text, p_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_sale(p_market uuid, p_listing uuid, p_claim uuid, p_quantity numeric, p_gross_cents integer, p_discount_cents integer, p_fee_cents integer, p_payment_method text, p_buyer_label text, p_notes text, p_source text) TO authenticated;
GRANT ALL ON FUNCTION public.record_sale(p_market uuid, p_listing uuid, p_claim uuid, p_quantity numeric, p_gross_cents integer, p_discount_cents integer, p_fee_cents integer, p_payment_method text, p_buyer_label text, p_notes text, p_source text) TO service_role;


--
-- Name: FUNCTION release_seed_drop_items(p_order uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.release_seed_drop_items(p_order uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_seed_drop_items(p_order uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION respond_order_proposal(p_order uuid, p_accept boolean, p_new_start timestamp with time zone, p_new_end timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.respond_order_proposal(p_order uuid, p_accept boolean, p_new_start timestamp with time zone, p_new_end timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.respond_order_proposal(p_order uuid, p_accept boolean, p_new_start timestamp with time zone, p_new_end timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.respond_order_proposal(p_order uuid, p_accept boolean, p_new_start timestamp with time zone, p_new_end timestamp with time zone) TO service_role;


--
-- Name: FUNCTION save_onboarding_contact(p_first_name text, p_last_name text, p_phone text, p_email text, p_complete boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_onboarding_contact(p_first_name text, p_last_name text, p_phone text, p_email text, p_complete boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_onboarding_contact(p_first_name text, p_last_name text, p_phone text, p_email text, p_complete boolean) TO authenticated;
GRANT ALL ON FUNCTION public.save_onboarding_contact(p_first_name text, p_last_name text, p_phone text, p_email text, p_complete boolean) TO service_role;


--
-- Name: FUNCTION screen_listing_text(p_text text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.screen_listing_text(p_text text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.screen_listing_text(p_text text) TO authenticated;
GRANT ALL ON FUNCTION public.screen_listing_text(p_text text) TO service_role;


--
-- Name: TABLE seed_lots; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.seed_lots TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.seed_lots TO authenticated;
GRANT ALL ON TABLE public.seed_lots TO service_role;


--
-- Name: FUNCTION seed_lot_eligible(l public.seed_lots); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.seed_lot_eligible(l public.seed_lots) TO anon;
GRANT ALL ON FUNCTION public.seed_lot_eligible(l public.seed_lots) TO authenticated;
GRANT ALL ON FUNCTION public.seed_lot_eligible(l public.seed_lots) TO service_role;


--
-- Name: FUNCTION seed_profile_matches(p_preferred_sun text, p_beginner_friendly boolean, p_container_friendly boolean, p_suns text[], p_experiences text[], p_sizes text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.seed_profile_matches(p_preferred_sun text, p_beginner_friendly boolean, p_container_friendly boolean, p_suns text[], p_experiences text[], p_sizes text[]) TO anon;
GRANT ALL ON FUNCTION public.seed_profile_matches(p_preferred_sun text, p_beginner_friendly boolean, p_container_friendly boolean, p_suns text[], p_experiences text[], p_sizes text[]) TO authenticated;
GRANT ALL ON FUNCTION public.seed_profile_matches(p_preferred_sun text, p_beginner_friendly boolean, p_container_friendly boolean, p_suns text[], p_experiences text[], p_sizes text[]) TO service_role;


--
-- Name: FUNCTION seed_recommendations(p_zone integer, p_suns text[], p_experiences text[], p_sizes text[], p_preferences text[], p_exclusions text[], p_limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.seed_recommendations(p_zone integer, p_suns text[], p_experiences text[], p_sizes text[], p_preferences text[], p_exclusions text[], p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.seed_recommendations(p_zone integer, p_suns text[], p_experiences text[], p_sizes text[], p_preferences text[], p_exclusions text[], p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.seed_recommendations(p_zone integer, p_suns text[], p_experiences text[], p_sizes text[], p_preferences text[], p_exclusions text[], p_limit integer) TO service_role;


--
-- Name: FUNCTION seed_sub_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.seed_sub_guard() TO anon;
GRANT ALL ON FUNCTION public.seed_sub_guard() TO authenticated;
GRANT ALL ON FUNCTION public.seed_sub_guard() TO service_role;


--
-- Name: FUNCTION seed_sub_next_window(p_sub uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.seed_sub_next_window(p_sub uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.seed_sub_next_window(p_sub uuid) TO authenticated;
GRANT ALL ON FUNCTION public.seed_sub_next_window(p_sub uuid) TO service_role;


--
-- Name: FUNCTION seller_credentials_audit(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.seller_credentials_audit() TO anon;
GRANT ALL ON FUNCTION public.seller_credentials_audit() TO authenticated;
GRANT ALL ON FUNCTION public.seller_credentials_audit() TO service_role;


--
-- Name: FUNCTION seller_is_cleared(p_seller uuid, p_class text, p_state text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.seller_is_cleared(p_seller uuid, p_class text, p_state text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.seller_is_cleared(p_seller uuid, p_class text, p_state text) TO authenticated;
GRANT ALL ON FUNCTION public.seller_is_cleared(p_seller uuid, p_class text, p_state text) TO service_role;


--
-- Name: FUNCTION seller_jurisdiction(p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.seller_jurisdiction(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.seller_jurisdiction(p_user uuid) TO authenticated;
GRANT ALL ON FUNCTION public.seller_jurisdiction(p_user uuid) TO service_role;


--
-- Name: FUNCTION set_claim_responded_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_claim_responded_at() TO anon;
GRANT ALL ON FUNCTION public.set_claim_responded_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_claim_responded_at() TO service_role;


--
-- Name: FUNCTION set_listing_slug(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_listing_slug() TO anon;
GRANT ALL ON FUNCTION public.set_listing_slug() TO authenticated;
GRANT ALL ON FUNCTION public.set_listing_slug() TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION skip_next_seed_order(p_sub uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.skip_next_seed_order(p_sub uuid) TO anon;
GRANT ALL ON FUNCTION public.skip_next_seed_order(p_sub uuid) TO authenticated;
GRANT ALL ON FUNCTION public.skip_next_seed_order(p_sub uuid) TO service_role;


--
-- Name: FUNCTION skip_onboarding(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.skip_onboarding() FROM PUBLIC;
GRANT ALL ON FUNCTION public.skip_onboarding() TO authenticated;
GRANT ALL ON FUNCTION public.skip_onboarding() TO service_role;


--
-- Name: FUNCTION skip_season_window(p_sub uuid, p_window uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.skip_season_window(p_sub uuid, p_window uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.skip_season_window(p_sub uuid, p_window uuid) TO authenticated;
GRANT ALL ON FUNCTION public.skip_season_window(p_sub uuid, p_window uuid) TO service_role;


--
-- Name: FUNCTION strip_address_spans(p_text text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.strip_address_spans(p_text text) TO anon;
GRANT ALL ON FUNCTION public.strip_address_spans(p_text text) TO authenticated;
GRANT ALL ON FUNCTION public.strip_address_spans(p_text text) TO service_role;


--
-- Name: FUNCTION strip_want_clauses(p_text text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.strip_want_clauses(p_text text) TO anon;
GRANT ALL ON FUNCTION public.strip_want_clauses(p_text text) TO authenticated;
GRANT ALL ON FUNCTION public.strip_want_clauses(p_text text) TO service_role;


--
-- Name: FUNCTION sync_listing_featured(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_listing_featured() TO anon;
GRANT ALL ON FUNCTION public.sync_listing_featured() TO authenticated;
GRANT ALL ON FUNCTION public.sync_listing_featured() TO service_role;


--
-- Name: FUNCTION taxonomy_archive_cascade(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.taxonomy_archive_cascade() TO anon;
GRANT ALL ON FUNCTION public.taxonomy_archive_cascade() TO authenticated;
GRANT ALL ON FUNCTION public.taxonomy_archive_cascade() TO service_role;


--
-- Name: FUNCTION taxonomy_block_delete_in_use(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.taxonomy_block_delete_in_use() TO anon;
GRANT ALL ON FUNCTION public.taxonomy_block_delete_in_use() TO authenticated;
GRANT ALL ON FUNCTION public.taxonomy_block_delete_in_use() TO service_role;


--
-- Name: FUNCTION user_has_paid_plan(p_user uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.user_has_paid_plan(p_user uuid) TO anon;
GRANT ALL ON FUNCTION public.user_has_paid_plan(p_user uuid) TO authenticated;
GRANT ALL ON FUNCTION public.user_has_paid_plan(p_user uuid) TO service_role;


--
-- Name: FUNCTION validate_claim_option(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.validate_claim_option() TO anon;
GRANT ALL ON FUNCTION public.validate_claim_option() TO authenticated;
GRANT ALL ON FUNCTION public.validate_claim_option() TO service_role;


--
-- Name: FUNCTION validate_request_options(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.validate_request_options() TO anon;
GRANT ALL ON FUNCTION public.validate_request_options() TO authenticated;
GRANT ALL ON FUNCTION public.validate_request_options() TO service_role;


--
-- Name: FUNCTION void_sale(p_txn uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.void_sale(p_txn uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.void_sale(p_txn uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.void_sale(p_txn uuid, p_reason text) TO service_role;


--
-- Name: TABLE admin_actions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_actions TO anon;
GRANT ALL ON TABLE public.admin_actions TO authenticated;
GRANT ALL ON TABLE public.admin_actions TO service_role;


--
-- Name: TABLE admin_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.admin_audit_log TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.admin_audit_log TO authenticated;
GRANT ALL ON TABLE public.admin_audit_log TO service_role;


--
-- Name: SEQUENCE admin_audit_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.admin_audit_log_id_seq TO anon;
GRANT ALL ON SEQUENCE public.admin_audit_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.admin_audit_log_id_seq TO service_role;


--
-- Name: TABLE admin_plan_grants; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.admin_plan_grants TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.admin_plan_grants TO authenticated;
GRANT ALL ON TABLE public.admin_plan_grants TO service_role;


--
-- Name: TABLE admins; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admins TO anon;
GRANT ALL ON TABLE public.admins TO authenticated;
GRANT ALL ON TABLE public.admins TO service_role;


--
-- Name: TABLE ai_action_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ai_action_requests TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ai_action_requests TO authenticated;
GRANT ALL ON TABLE public.ai_action_requests TO service_role;


--
-- Name: TABLE ai_chat_messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.ai_chat_messages TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.ai_chat_messages TO authenticated;
GRANT ALL ON TABLE public.ai_chat_messages TO service_role;


--
-- Name: TABLE ai_daily_counter; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_daily_counter TO service_role;


--
-- Name: TABLE ai_room_messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.ai_room_messages TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.ai_room_messages TO authenticated;
GRANT ALL ON TABLE public.ai_room_messages TO service_role;


--
-- Name: SEQUENCE ai_room_messages_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.ai_room_messages_id_seq TO anon;
GRANT ALL ON SEQUENCE public.ai_room_messages_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.ai_room_messages_id_seq TO service_role;


--
-- Name: TABLE ai_rooms; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.ai_rooms TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.ai_rooms TO authenticated;
GRANT ALL ON TABLE public.ai_rooms TO service_role;


--
-- Name: COLUMN ai_rooms.title; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(title) ON TABLE public.ai_rooms TO authenticated;


--
-- Name: COLUMN ai_rooms.status; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(status) ON TABLE public.ai_rooms TO authenticated;


--
-- Name: COLUMN ai_rooms.agent_ids; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(agent_ids) ON TABLE public.ai_rooms TO authenticated;


--
-- Name: COLUMN ai_rooms.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(updated_at) ON TABLE public.ai_rooms TO authenticated;


--
-- Name: TABLE ai_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ai_settings TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ai_settings TO authenticated;
GRANT ALL ON TABLE public.ai_settings TO service_role;


--
-- Name: TABLE ai_usage; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_usage TO anon;
GRANT ALL ON TABLE public.ai_usage TO authenticated;
GRANT ALL ON TABLE public.ai_usage TO service_role;


--
-- Name: TABLE ai_usage_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ai_usage_log TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ai_usage_log TO authenticated;
GRANT ALL ON TABLE public.ai_usage_log TO service_role;


--
-- Name: SEQUENCE ai_usage_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.ai_usage_log_id_seq TO anon;
GRANT ALL ON SEQUENCE public.ai_usage_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.ai_usage_log_id_seq TO service_role;


--
-- Name: TABLE billing_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.billing_config TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.billing_config TO authenticated;
GRANT ALL ON TABLE public.billing_config TO service_role;


--
-- Name: TABLE billing_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.billing_events TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.billing_events TO authenticated;
GRANT ALL ON TABLE public.billing_events TO service_role;


--
-- Name: SEQUENCE billing_events_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.billing_events_id_seq TO anon;
GRANT ALL ON SEQUENCE public.billing_events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.billing_events_id_seq TO service_role;


--
-- Name: TABLE billing_products; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.billing_products TO anon;
GRANT ALL ON TABLE public.billing_products TO authenticated;
GRANT ALL ON TABLE public.billing_products TO service_role;


--
-- Name: TABLE buyer_delivery_addresses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.buyer_delivery_addresses TO authenticated;
GRANT ALL ON TABLE public.buyer_delivery_addresses TO service_role;


--
-- Name: TABLE claim_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.claim_messages TO anon;
GRANT ALL ON TABLE public.claim_messages TO authenticated;
GRANT ALL ON TABLE public.claim_messages TO service_role;


--
-- Name: TABLE claim_reports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.claim_reports TO anon;
GRANT ALL ON TABLE public.claim_reports TO authenticated;
GRANT ALL ON TABLE public.claim_reports TO service_role;


--
-- Name: TABLE claims; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.claims TO anon;
GRANT ALL ON TABLE public.claims TO authenticated;
GRANT ALL ON TABLE public.claims TO service_role;


--
-- Name: TABLE compliance_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.compliance_audit_log TO anon;
GRANT ALL ON TABLE public.compliance_audit_log TO authenticated;
GRANT ALL ON TABLE public.compliance_audit_log TO service_role;


--
-- Name: SEQUENCE compliance_audit_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.compliance_audit_log_id_seq TO anon;
GRANT ALL ON SEQUENCE public.compliance_audit_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.compliance_audit_log_id_seq TO service_role;


--
-- Name: TABLE credential_taxonomy_scope; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.credential_taxonomy_scope TO anon;
GRANT ALL ON TABLE public.credential_taxonomy_scope TO authenticated;
GRANT ALL ON TABLE public.credential_taxonomy_scope TO service_role;


--
-- Name: TABLE device_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.device_tokens TO anon;
GRANT ALL ON TABLE public.device_tokens TO authenticated;
GRANT ALL ON TABLE public.device_tokens TO service_role;


--
-- Name: TABLE events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.events TO anon;
GRANT ALL ON TABLE public.events TO authenticated;
GRANT ALL ON TABLE public.events TO service_role;


--
-- Name: TABLE feedback; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.feedback TO anon;
GRANT ALL ON TABLE public.feedback TO authenticated;
GRANT ALL ON TABLE public.feedback TO service_role;


--
-- Name: TABLE germination_tests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.germination_tests TO anon;
GRANT ALL ON TABLE public.germination_tests TO authenticated;
GRANT ALL ON TABLE public.germination_tests TO service_role;


--
-- Name: TABLE legacy_category_map; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.legacy_category_map TO anon;
GRANT ALL ON TABLE public.legacy_category_map TO authenticated;
GRANT ALL ON TABLE public.legacy_category_map TO service_role;


--
-- Name: TABLE listing_drafts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.listing_drafts TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.listing_drafts TO authenticated;
GRANT ALL ON TABLE public.listing_drafts TO service_role;


--
-- Name: TABLE listing_pickup_locations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.listing_pickup_locations TO anon;
GRANT ALL ON TABLE public.listing_pickup_locations TO authenticated;
GRANT ALL ON TABLE public.listing_pickup_locations TO service_role;


--
-- Name: TABLE listing_promotions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.listing_promotions TO anon;
GRANT ALL ON TABLE public.listing_promotions TO authenticated;
GRANT ALL ON TABLE public.listing_promotions TO service_role;


--
-- Name: TABLE market_delivery_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.market_delivery_settings TO anon;
GRANT ALL ON TABLE public.market_delivery_settings TO authenticated;
GRANT ALL ON TABLE public.market_delivery_settings TO service_role;


--
-- Name: TABLE market_follows; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.market_follows TO anon;
GRANT ALL ON TABLE public.market_follows TO authenticated;
GRANT ALL ON TABLE public.market_follows TO service_role;


--
-- Name: TABLE market_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.market_members TO anon;
GRANT ALL ON TABLE public.market_members TO authenticated;
GRANT ALL ON TABLE public.market_members TO service_role;


--
-- Name: TABLE market_metrics; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.market_metrics TO anon;
GRANT ALL ON TABLE public.market_metrics TO authenticated;
GRANT ALL ON TABLE public.market_metrics TO service_role;


--
-- Name: TABLE market_order_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.market_order_events TO anon;
GRANT ALL ON TABLE public.market_order_events TO authenticated;
GRANT ALL ON TABLE public.market_order_events TO service_role;


--
-- Name: SEQUENCE market_order_events_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.market_order_events_id_seq TO anon;
GRANT ALL ON SEQUENCE public.market_order_events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.market_order_events_id_seq TO service_role;


--
-- Name: TABLE market_order_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.market_order_items TO anon;
GRANT ALL ON TABLE public.market_order_items TO authenticated;
GRANT ALL ON TABLE public.market_order_items TO service_role;


--
-- Name: TABLE market_orders; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.market_orders TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.market_orders TO authenticated;
GRANT ALL ON TABLE public.market_orders TO service_role;


--
-- Name: COLUMN market_orders.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.market_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(market_id) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.buyer_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(buyer_id) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(status) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.requested_start; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(requested_start) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.requested_end; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(requested_end) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.confirmed_start; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(confirmed_start) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.confirmed_end; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(confirmed_end) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.proposed_start; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(proposed_start) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.proposed_end; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(proposed_end) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.timezone; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(timezone) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.subtotal_cents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(subtotal_cents) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.buyer_note; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(buyer_note) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.decline_reason; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(decline_reason) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(updated_at) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.pickup_location_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(pickup_location_id) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.pickup_location_name; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(pickup_location_name) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.pickup_location_type; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(pickup_location_type) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.fulfillment_type; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(fulfillment_type) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.delivery_distance_miles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(delivery_distance_miles) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.delivery_base_fee_cents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(delivery_base_fee_cents) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.delivery_surcharge_cents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(delivery_surcharge_cents) ON TABLE public.market_orders TO authenticated;


--
-- Name: COLUMN market_orders.delivery_fee_cents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(delivery_fee_cents) ON TABLE public.market_orders TO authenticated;


--
-- Name: TABLE market_payment_methods; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.market_payment_methods TO anon;
GRANT ALL ON TABLE public.market_payment_methods TO authenticated;
GRANT ALL ON TABLE public.market_payment_methods TO service_role;


--
-- Name: TABLE market_pickup_exceptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.market_pickup_exceptions TO anon;
GRANT ALL ON TABLE public.market_pickup_exceptions TO authenticated;
GRANT ALL ON TABLE public.market_pickup_exceptions TO service_role;


--
-- Name: TABLE market_pickup_hours; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.market_pickup_hours TO anon;
GRANT ALL ON TABLE public.market_pickup_hours TO authenticated;
GRANT ALL ON TABLE public.market_pickup_hours TO service_role;


--
-- Name: TABLE market_pickup_private; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.market_pickup_private TO anon;
GRANT ALL ON TABLE public.market_pickup_private TO authenticated;
GRANT ALL ON TABLE public.market_pickup_private TO service_role;


--
-- Name: TABLE market_pickup_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.market_pickup_settings TO anon;
GRANT ALL ON TABLE public.market_pickup_settings TO authenticated;
GRANT ALL ON TABLE public.market_pickup_settings TO service_role;


--
-- Name: TABLE market_promotion_credits; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.market_promotion_credits TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.market_promotion_credits TO authenticated;
GRANT ALL ON TABLE public.market_promotion_credits TO service_role;


--
-- Name: TABLE market_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.market_subscriptions TO anon;
GRANT ALL ON TABLE public.market_subscriptions TO authenticated;
GRANT ALL ON TABLE public.market_subscriptions TO service_role;


--
-- Name: TABLE marketplace_taxonomy_nodes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.marketplace_taxonomy_nodes TO anon;
GRANT ALL ON TABLE public.marketplace_taxonomy_nodes TO authenticated;
GRANT ALL ON TABLE public.marketplace_taxonomy_nodes TO service_role;


--
-- Name: TABLE plan_limits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.plan_limits TO anon;
GRANT ALL ON TABLE public.plan_limits TO authenticated;
GRANT ALL ON TABLE public.plan_limits TO service_role;


--
-- Name: TABLE plot_crops; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.plot_crops TO anon;
GRANT ALL ON TABLE public.plot_crops TO authenticated;
GRANT ALL ON TABLE public.plot_crops TO service_role;


--
-- Name: TABLE plot_grow_log_photos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.plot_grow_log_photos TO anon;
GRANT ALL ON TABLE public.plot_grow_log_photos TO authenticated;
GRANT ALL ON TABLE public.plot_grow_log_photos TO service_role;


--
-- Name: TABLE plot_grow_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.plot_grow_logs TO anon;
GRANT ALL ON TABLE public.plot_grow_logs TO authenticated;
GRANT ALL ON TABLE public.plot_grow_logs TO service_role;


--
-- Name: TABLE public_active_promotions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.public_active_promotions TO service_role;
GRANT SELECT ON TABLE public.public_active_promotions TO anon;
GRANT SELECT ON TABLE public.public_active_promotions TO authenticated;


--
-- Name: TABLE public_listings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.public_listings TO service_role;
GRANT SELECT ON TABLE public.public_listings TO anon;
GRANT SELECT ON TABLE public.public_listings TO authenticated;


--
-- Name: TABLE public_markets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.public_markets TO service_role;
GRANT SELECT ON TABLE public.public_markets TO anon;
GRANT SELECT ON TABLE public.public_markets TO authenticated;


--
-- Name: TABLE public_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.public_profiles TO service_role;
GRANT SELECT ON TABLE public.public_profiles TO anon;
GRANT SELECT ON TABLE public.public_profiles TO authenticated;


--
-- Name: TABLE reports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reports TO anon;
GRANT ALL ON TABLE public.reports TO authenticated;
GRANT ALL ON TABLE public.reports TO service_role;


--
-- Name: TABLE seed_inventory_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.seed_inventory_log TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.seed_inventory_log TO authenticated;
GRANT ALL ON TABLE public.seed_inventory_log TO service_role;


--
-- Name: TABLE seed_order_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.seed_order_items TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.seed_order_items TO authenticated;
GRANT ALL ON TABLE public.seed_order_items TO service_role;


--
-- Name: TABLE seed_orders; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.seed_orders TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.seed_orders TO authenticated;
GRANT ALL ON TABLE public.seed_orders TO service_role;


--
-- Name: TABLE seed_products; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.seed_products TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.seed_products TO authenticated;
GRANT ALL ON TABLE public.seed_products TO service_role;


--
-- Name: TABLE seed_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.seed_profiles TO anon;
GRANT ALL ON TABLE public.seed_profiles TO authenticated;
GRANT ALL ON TABLE public.seed_profiles TO service_role;


--
-- Name: TABLE seed_season_windows; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.seed_season_windows TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.seed_season_windows TO authenticated;
GRANT ALL ON TABLE public.seed_season_windows TO service_role;


--
-- Name: TABLE seed_sub_season_skips; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.seed_sub_season_skips TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.seed_sub_season_skips TO authenticated;
GRANT ALL ON TABLE public.seed_sub_season_skips TO service_role;


--
-- Name: TABLE seller_expenses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.seller_expenses TO anon;
GRANT ALL ON TABLE public.seller_expenses TO authenticated;
GRANT ALL ON TABLE public.seller_expenses TO service_role;


--
-- Name: TABLE seller_transactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.seller_transactions TO anon;
GRANT ALL ON TABLE public.seller_transactions TO authenticated;
GRANT ALL ON TABLE public.seller_transactions TO service_role;


--
-- Name: TABLE sponsored_placements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sponsored_placements TO anon;
GRANT ALL ON TABLE public.sponsored_placements TO authenticated;
GRANT ALL ON TABLE public.sponsored_placements TO service_role;


--
-- Name: TABLE storage_locations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.storage_locations TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.storage_locations TO authenticated;
GRANT ALL ON TABLE public.storage_locations TO service_role;


--
-- Name: TABLE stripe_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.stripe_events TO service_role;


--
-- Name: TABLE suppliers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.suppliers TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.suppliers TO authenticated;
GRANT ALL ON TABLE public.suppliers TO service_role;


--
-- Name: TABLE user_blocks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_blocks TO anon;
GRANT ALL ON TABLE public.user_blocks TO authenticated;
GRANT ALL ON TABLE public.user_blocks TO service_role;


--
-- Name: TABLE user_private_contact; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.user_private_contact TO anon;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE public.user_private_contact TO authenticated;
GRANT ALL ON TABLE public.user_private_contact TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict BeDsL5NweNtYFu2ueoJICDhhkmX2FuyoA1eq6ceN9QtOHUbGngbqK9SRal8EQr1

