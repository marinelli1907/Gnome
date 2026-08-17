-- 0124: §13 payment hardening + rebuild reproducibility.
--
-- From an 11-agent audit (8 independent sweeps + 3 adversarial reviewers).
-- Every change below is hardening or reproducibility: no pricing changes, no
-- allowance changes, no new payment features, and live payments stay OFF.
--
--   1. RECOVERED PHANTOM OBJECTS. plan_rank, admin_plan_grants and
--      market_effective_plan are referenced by migrations but created by NONE
--      of them — they exist in production only from out-of-tree work. Every
--      clean rebuild therefore fails (0081 onward), and 14 test runners paper
--      over it with a naive one-column stub that ignores complimentary plan
--      grants, so the whole allowance harness has been proving metering
--      against a resolver production does not use. Recovered here verbatim
--      from production (pg_get_functiondef), guarded so production no-ops.
--   2. STRIPE_LIVEMODE TRUTH (§13 backlog item 1). listing_publish_
--      authorizations had no record of which Stripe mode minted a payment.
--      Column added, backfilled false — safe because production has never
--      taken a live payment (payments_live_enabled=false, stripe_mode='test',
--      every live Stripe id NULL) — and a trigger now refuses to CONSUME an
--      authorization whose mode disagrees with the platform's current mode,
--      so a test payment can never fund a live action or vice versa. The
--      value is stamped server-side only; no client input reaches it.
--   3. STALE PENDING RECONCILIATION (§13 backlog item 2). The status ladder
--      always defined 'expired' but nothing ever wrote it, so abandoned
--      checkouts accumulated as 'pending' forever. A bounded sweep now
--      expires them WITHOUT deleting financial audit truth (paid, consumed
--      and refunded rows are never touched).
--   4. CANONICAL PRODUCT SEEDING. The paid-publishing SKUs
--      (GNOME_LISTING_PUBLISH / GNOME_LISTING_RENEWAL / GNOME_SPONSOR_MONTHLY)
--      were created only by hand-applying SQL printed by scripts/
--      stripe_setup.mjs, so a rebuilt environment had no $0.99 products at
--      all. Seeded idempotently with amounts and currency ONLY — Stripe
--      product/price ids stay NULL because they are per-environment runtime
--      configuration and must never live in a schema migration.
--   5. GRANT HARDENING. billing_products (the table checkout reads the price
--      from) granted INSERT and UPDATE to anon and authenticated; only RLS
--      stood between a client and its own price. listing_overage_required
--      was executable by authenticated, an IDOR letting any signed-in user
--      read any market's allowance posture. Both revoked; neither is used by
--      a client (checkout calls the RPC with the service role).
--   6. 0123 FOLLOW-UP. The lifecycle guard attached a market when one was
--      missing but never checked a SUPPLIED market_id belonged to the owner,
--      so a crafted insert could bill a Sell publish to a foreign market —
--      free against an unlimited plan. Now refused.

-- ---------------------------------------------------------------------------
-- 1. Recovered phantom objects (no-ops in production; make rebuilds possible)
-- ---------------------------------------------------------------------------
create or replace function public.plan_rank(p public.market_plan)
returns integer language sql immutable as $function$
  select case p when 'free' then 0 when 'grower' then 1 when 'farm' then 2 when 'sponsor' then 3 end;
$function$;

create table if not exists public.admin_plan_grants (
  id            uuid primary key default gen_random_uuid(),
  market_id     uuid not null,
  user_id       uuid not null,
  plan          public.market_plan not null,
  starts_at     timestamptz not null default now(),
  expires_at    timestamptz,
  status        text not null default 'ACTIVE',
  reason        text not null,
  internal_note text,
  granted_by    uuid,
  created_at    timestamptz not null default now(),
  modified_by   uuid,
  modified_at   timestamptz,
  revoked_by    uuid,
  revoked_at    timestamptz
);
-- Admin-only data: RLS on with no client policy, and no client grants. Definer
-- functions (market_effective_plan) read it regardless; clients cannot.
alter table public.admin_plan_grants enable row level security;
revoke all on public.admin_plan_grants from anon, authenticated;

create or replace function public.market_effective_plan(p_market uuid)
returns table(plan public.market_plan, source text, grant_id uuid, grant_expires timestamptz)
language sql stable security definer set search_path to 'public' as $function$
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
$function$;

-- ---------------------------------------------------------------------------
-- 2. stripe_livemode truth on payment authorizations
-- ---------------------------------------------------------------------------
alter table public.listing_publish_authorizations
  add column if not exists stripe_livemode boolean not null default false;

comment on column public.listing_publish_authorizations.stripe_livemode is
  'Which Stripe mode minted this authorization. Stamped server-side at '
  'creation from the resolved key mode and re-stamped by the webhook from '
  'event.livemode. NEVER read from client input.';

-- Existing rows are provably test-mode: the live gate has never been on and no
-- live Stripe id has ever been written. The default already set them false;
-- this states the intent explicitly for the ledger.
update public.listing_publish_authorizations set stripe_livemode = false
 where stripe_livemode is distinct from false;

-- A test-mode payment must never fund a live action, or the reverse. The check
-- lands at CONSUMPTION (not creation) so a mode flip cannot retroactively
-- invalidate money already banked — it simply stops the wrong-mode credit
-- being spent.
create or replace function public.authorization_mode_guard()
returns trigger language plpgsql as $$
declare
  v_live boolean;
begin
  if new.status = 'consumed' and old.status is distinct from 'consumed' then
    select payments_live_enabled into v_live from public.billing_config limit 1;
    if new.stripe_livemode is distinct from coalesce(v_live, false) then
      raise exception 'AUTHORIZATION_MODE_MISMATCH'
        using hint = 'this authorization was minted in the other Stripe mode';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists authorization_mode_guard_trg on public.listing_publish_authorizations;
create trigger authorization_mode_guard_trg
  before update on public.listing_publish_authorizations
  for each row execute function public.authorization_mode_guard();

-- ---------------------------------------------------------------------------
-- 3. Stale pending reconciliation (audit truth preserved)
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_publish_authorizations(
  p_older_than interval default interval '24 hours')
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  -- ONLY pending rows age out. paid / consumed / refunded are financial truth
  -- and are never rewritten, never deleted.
  with stale as (
    update public.listing_publish_authorizations
       set status = 'expired'
     where status = 'pending'
       and created_at < now() - p_older_than
    returning 1
  )
  select count(*) into n from stale;

  if n > 0 then
    begin
      insert into public.events (event_type, metadata)
      values ('publish_authorizations_expired', jsonb_build_object('count', n));
    exception when others then null;
    end;
  end if;
  return n;
end $$;

revoke execute on function public.expire_stale_publish_authorizations(interval) from public, anon, authenticated;

-- Hourly sweep. Same guarded, re-runnable shape as the 0120 drop-alert job.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'gnome-expire-stale-authorizations') then
      perform cron.schedule('gnome-expire-stale-authorizations', '17 * * * *',
                            $job$select public.expire_stale_publish_authorizations();$job$);
    end if;
  else
    raise notice '0124: pg_cron unavailable here; no schedule registered';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Canonical product seeding — keys/amounts only, never Stripe ids
-- ---------------------------------------------------------------------------
insert into public.billing_products (key, kind, description, unit_amount_cents, currency, active) values
  ('GNOME_LISTING_PUBLISH', 'one_time',
   'Publish one additional listing beyond the monthly allowance', 99, 'usd', true),
  ('GNOME_LISTING_RENEWAL', 'one_time',
   'Renew one expired listing for a further 7 days', 99, 'usd', true),
  ('GNOME_SPONSOR_MONTHLY', 'subscription',
   'Farm plan (internal enum sponsor), monthly', 9900, 'usd', true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Grant hardening
-- ---------------------------------------------------------------------------
-- billing_products is the server's price authority. Clients read it; only the
-- admin path writes it. (RLS already gated writes — this removes the standing
-- privilege so RLS is no longer the only thing between a client and its price.)
--
-- REVOKE ALL, not `revoke insert, update`: production granted these at COLUMN
-- level (key, active, unit_amount_cents, stripe_price_id_test/live), and a
-- table-level revoke of a privilege does not necessarily clear the per-column
-- entries — the same per-column trap 0104 hit. ALL clears both, and the
-- self-check below asserts the end state in information_schema rather than
-- trusting the statement.
revoke all on public.billing_products from anon, authenticated;
grant select on public.billing_products to anon, authenticated;

-- IDOR: any signed-in user could read any market's allowance/overage posture
-- by id. Only billing-checkout calls this, and it calls it with the service
-- role. my_overage_required() remains the client-facing, self-scoped RPC.
revoke execute on function public.listing_overage_required(uuid, uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. 0123 follow-up: a supplied market must belong to the owner
-- ---------------------------------------------------------------------------
create or replace function public.listing_lifecycle_guard()
returns trigger language plpgsql as $$
declare
  v_market uuid;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.expires_at := null;
    -- 0124: a crafted insert could name someone ELSE's market and bill the
    -- publish there — free against an unlimited plan, and it injected a live
    -- listing into a storefront its owner does not control.
    if new.market_id is not null and not exists (
      select 1 from public.markets m
       where m.id = new.market_id and m.owner_id = new.owner_id
    ) then
      raise exception 'FOREIGN_MARKET';
    end if;
    if new.listing_type = 'sale' and new.market_id is null then
      select id into v_market from public.markets
       where owner_id = new.owner_id limit 1;
      if v_market is null then
        raise exception 'NO_MARKET';
      end if;
      new.market_id := v_market;
    end if;
    return new;
  end if;

  new.listing_type := old.listing_type;
  new.kind := old.kind;
  new.market_id := old.market_id;

  if old.status is distinct from 'active' and new.status = 'active' then
    new.expires_at := case new.listing_type
      when 'wanted' then now() + interval '30 days'
      when 'plot'   then now() + interval '45 days'
      else               now() + interval '7 days'
    end;
  elsif new.expires_at is distinct from old.expires_at then
    new.expires_at := old.expires_at;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regproc('public.market_effective_plan') is null then
    raise exception '0124 self-check: market_effective_plan missing';
  end if;
  -- Resolution is only assertable where a market exists: the function
  -- legitimately returns zero rows for an unknown id (its base CTE is empty),
  -- and a freshly rebuilt database has no markets at all.
  if exists (select 1 from public.markets) then
    if (select count(*) from public.market_effective_plan(
          (select id from public.markets limit 1))) <> 1 then
      raise exception '0124 self-check: market_effective_plan does not resolve';
    end if;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public'
                    and table_name = 'listing_publish_authorizations'
                    and column_name = 'stripe_livemode') then
    raise exception '0124 self-check: stripe_livemode column missing';
  end if;
  if exists (select 1 from public.listing_publish_authorizations where stripe_livemode is null) then
    raise exception '0124 self-check: stripe_livemode left NULL';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'authorization_mode_guard_trg') then
    raise exception '0124 self-check: authorization mode guard missing';
  end if;
  if (select count(*) from public.billing_products
       where key in ('GNOME_LISTING_PUBLISH','GNOME_LISTING_RENEWAL','GNOME_SPONSOR_MONTHLY')) <> 3 then
    raise exception '0124 self-check: canonical overage products not seeded';
  end if;
  -- Assert the END STATE, including per-column entries: has_table_privilege
  -- alone would miss a lingering column grant.
  if exists (
    select 1 from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'billing_products'
       and grantee in ('anon', 'authenticated')
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception '0124 self-check: billing_products still has client write column-privileges';
  end if;
  if has_table_privilege('authenticated', 'public.billing_products', 'update')
     or has_table_privilege('anon', 'public.billing_products', 'insert') then
    raise exception '0124 self-check: billing_products still client-writable';
  end if;
  if not has_table_privilege('authenticated', 'public.billing_products', 'select') then
    raise exception '0124 self-check: billing_products lost its client SELECT';
  end if;
  if has_function_privilege('authenticated', 'public.listing_overage_required(uuid, uuid)', 'execute') then
    raise exception '0124 self-check: listing_overage_required still client-executable';
  end if;
  -- The live gate is NOT touched by this migration and must still be off.
  -- Guarded on the table existing: 0083 is one of the migrations that cannot
  -- apply in a clean rebuild yet, so billing_config is absent there.
  if to_regclass('public.billing_config') is not null then
    if (select payments_live_enabled from public.billing_config limit 1) is distinct from false then
      raise exception '0124 self-check: payments_live_enabled is not false';
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
