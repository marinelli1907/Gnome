-- Gnome — monthly listing PUBLISH allowance model. Replaces the active-listing cap.
--
-- WHAT CHANGED CONCEPTUALLY
-- Until now a plan granted N simultaneously-active listings: enforce_plan_limit() counted rows
-- with status='active' and refused the insert past the cap. Expiry therefore GAVE CAPACITY BACK,
-- because an expired row stopped counting. The new model counts PUBLISH EVENTS inside an
-- allowance period, so expiry returns nothing — a seller who published their twenty listings has
-- spent their twenty publishes even after all twenty expire.
--
-- That is a semantic inversion, not a tuning change, so the old counter is retired rather than
-- re-parameterised. max_active_listings is LEFT IN PLACE and left populated: several readers still
-- select it (my_plan_entitlements, usePlanLimits, gnome-assistant, admin_commercial_overview) and
-- breaking them here would be a much larger blast radius than this migration wants. It simply
-- stops being the gate. A follow-up retires the column once every reader is moved.
--
-- WHY A LEDGER AND NOT A COUNTER COLUMN
-- The existing add-on precedent (markets.extra_pickup_locations) is a mutable integer, and it has
-- a live bug: stripe-webhook SETS it rather than adding, and writes 0 when the PLAN subscription
-- cancels — so cancelling Grower silently destroys a separately-purchased add-on. An append-only
-- ledger has no column for a webhook to zero and no value for a plan change to overwrite, which
-- makes "a subscription change can never delete paid history" a property of the shape rather than
-- a rule somebody has to remember. Refunds are compensating rows, never edits, exactly as
-- market_promotion_credits already does it.
--
-- WHY NO NEW COLUMNS ON public.listings
-- listings uses per-COLUMN grants. A column added here would start with NO grant, and one
-- ungranted column anywhere in a PostgREST select list returns 42501 for the whole query — the
-- trap that broke Browse in 0085/0092 and the screening columns in 0095. Everything this model
-- needs is derivable from the ledger, so listings gains no columns at all. Only its DEFAULT
-- changes.
--
-- Run after 0103. Idempotent; 0104_down reverses it.

-- ---------------------------------------------------------------------------
-- 1. Plan configuration
-- ---------------------------------------------------------------------------
-- NULL means unlimited throughout, matching the existing max_active_listings convention so the
-- two generations of columns read the same way.
--
-- display_name is the customer-facing name and is DELIBERATELY not the enum value. The owner's
-- final structure renames the tiers without touching market_plan, because those values are written
-- into markets.plan, market_subscriptions.plan, plan_limits.plan and admin_plan_grants.plan, and a
-- renaming migration would rewrite live billing rows for a cosmetic gain. The mapping is therefore
-- deliberately counter-intuitive and must not be "corrected" by a later reader:
--
--     enum 'farm'    displays as "Max"   ($29.99)
--     enum 'sponsor' displays as "Farm"  ($99.00)
--
-- Read display_name. Never render the enum value to a customer.
alter table public.plan_limits
  add column if not exists display_name                text,
  add column if not exists monthly_publish_allowance   int,
  add column if not exists included_renewals_per_period int,
  add column if not exists wanted_intros_per_day       int,
  add column if not exists qr_tools                    boolean not null default false,
  add column if not exists listing_lifetime_days       int not null default 7;

comment on column public.plan_limits.display_name is
  'Customer-facing plan name. NOT the enum value: farm displays as "Max", sponsor as "Farm".';
comment on column public.plan_limits.monthly_publish_allowance is
  'New listing publishes included per allowance period. NULL = unlimited. Expiry does not refund.';
comment on column public.plan_limits.included_renewals_per_period is
  'Free renewals per allowance period. NULL = unlimited. Does not consume a publish.';
comment on column public.plan_limits.max_active_listings is
  'RETIRED as an enforcement gate by 0104 — kept populated only for legacy readers.';

update public.plan_limits set
  display_name                 = 'Free',
  monthly_publish_allowance    = 3,
  included_renewals_per_period = 0,
  wanted_intros_per_day        = 1,
  qr_tools                     = false,
  listing_lifetime_days        = 7
where plan = 'free';

update public.plan_limits set
  display_name                 = 'Pro',
  monthly_publish_allowance    = 20,
  included_renewals_per_period = 3,
  wanted_intros_per_day        = 5,
  qr_tools                     = true,
  listing_lifetime_days        = 7
where plan = 'grower';

update public.plan_limits set
  display_name                 = 'Max',
  monthly_publish_allowance    = 40,
  included_renewals_per_period = 10,
  wanted_intros_per_day        = 15,
  qr_tools                     = true,
  listing_lifetime_days        = 7
where plan = 'farm';

update public.plan_limits set
  display_name                 = 'Farm',
  monthly_publish_allowance    = null,   -- unlimited
  included_renewals_per_period = null,   -- unlimited
  wanted_intros_per_day        = null,   -- unlimited, still subject to abuse controls
  qr_tools                     = true,
  listing_lifetime_days        = 7
where plan = 'sponsor';

-- ---------------------------------------------------------------------------
-- 2. Sell becomes the database-level default post type
-- ---------------------------------------------------------------------------
-- The canonical default lived here, not only in the UI: the column defaulted to 'free', so any
-- insert that omitted a type produced a Share Free listing. "Sell" is the enum value 'sale'.
-- The enum's own sort order is NOT touched — Postgres cannot reorder without recreating the type,
-- and display order is an application concern.
alter table public.listings alter column listing_type set default 'sale'::listing_type;

-- ---------------------------------------------------------------------------
-- 3. Which post types spend allowance
-- ---------------------------------------------------------------------------
-- Owner decision 2026-08-16: ONLY 'sale'. Share Free, Trade, Wanted and Offer a Plot stay free and
-- uncapped, so nobody is ever charged to give something away. Wanted is separately governed by the
-- per-day introduction ladder, which is why it must not also spend a publish.
--
-- A function, not a hardcoded literal, so the rule has exactly one home.
create or replace function public.listing_type_spends_allowance(p_type public.listing_type)
returns boolean
language sql immutable
as $$ select p_type = 'sale'::public.listing_type; $$;

comment on function public.listing_type_spends_allowance(public.listing_type) is
  'Only Sell listings consume publish allowance. Changing this changes monetization — see 0104.';

-- ---------------------------------------------------------------------------
-- 4. The allowance period
-- ---------------------------------------------------------------------------
-- Paid plans use the Stripe subscription period so the allowance resets exactly when the customer
-- is billed. Free has no subscription, so it uses the calendar month in a FIXED server timezone —
-- America/New_York, matching the tz-aware ordering cutoffs already used by create_market_order.
-- Client clocks are never consulted.
create or replace function public.market_allowance_period(p_market uuid)
returns table (period_start timestamptz, period_end timestamptz, source text)
language plpgsql stable security definer set search_path = public
as $$
declare
  s record;
begin
  select ms.current_period_start, ms.current_period_end
    into s
    from public.market_subscriptions ms
   where ms.market_id = p_market
     and ms.kind = 'plan'
     and ms.status in ('active','trialing','past_due')
     and ms.current_period_start is not null
     and ms.current_period_end   is not null
     and ms.current_period_start <= now()
     and ms.current_period_end   >  now()
   order by ms.current_period_start desc
   limit 1;

  if found then
    period_start := s.current_period_start;
    period_end   := s.current_period_end;
    source       := 'subscription';
    return next;
    return;
  end if;

  -- Calendar month, America/New_York, resolved server-side.
  period_start := date_trunc('month', now() at time zone 'America/New_York')
                    at time zone 'America/New_York';
  period_end   := period_start + interval '1 month';
  source       := 'calendar_month';
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Paid authorizations — one $0.99 payment authorizes exactly one action
-- ---------------------------------------------------------------------------
-- Deliberately NOT a reusable credit balance. A payment authorizes "publish a listing" or "renew
-- listing Z" and is consumed once. status is a one-way ladder pending -> paid -> consumed, so a
-- replayed webhook or a double-clicked client cannot buy one action and take two.
--
-- stripe_session_id is UNIQUE: that single constraint is what makes webhook retries idempotent,
-- the same mechanism market_promotion_credits already relies on.
create table if not exists public.listing_publish_authorizations (
  id                        uuid primary key default gen_random_uuid(),
  market_id                 uuid not null references public.markets (id) on delete cascade,
  -- NULL for a new publish (the listing does not exist yet at payment time); set for a renewal,
  -- and stamped at consumption time for a publish.
  --
  -- DEFERRABLE INITIALLY DEFERRED is load-bearing: the allowance trigger stamps this during
  -- BEFORE INSERT on listings, when the listing row does not exist yet. An immediate FK would
  -- reject every first publish. Deferring validates at commit, by which time it does.
  listing_id                uuid references public.listings (id) on delete set null
                              deferrable initially deferred,
  intent                    text not null check (intent in ('publish','renewal')),
  amount_cents              int  not null check (amount_cents >= 0),
  currency                  text not null default 'usd',
  stripe_session_id         text unique,
  stripe_payment_intent_id  text,
  status                    text not null default 'pending'
                              check (status in ('pending','paid','consumed','refunded','expired')),
  created_at                timestamptz not null default now(),
  paid_at                   timestamptz,
  consumed_at               timestamptz,
  refunded_at               timestamptz,
  created_by                uuid default auth.uid()
);

create index if not exists lpa_market_status_idx
  on public.listing_publish_authorizations (market_id, intent, status);
create index if not exists lpa_listing_idx
  on public.listing_publish_authorizations (listing_id);

-- ---------------------------------------------------------------------------
-- 6. The append-only usage ledger
-- ---------------------------------------------------------------------------
-- One row per publish or renewal that actually happened. Usage is COUNTED from here, never stored
-- as a running total, so there is no counter for a plan change or a webhook to clobber.
--
-- period_start is stamped at write time. That is what makes plan-switch farming inert: rows are
-- bound to the period they were spent in, so flipping plans to obtain a fresh period does not
-- erase the rows already recorded against the old one.
create table if not exists public.listing_publish_events (
  id               uuid primary key default gen_random_uuid(),
  market_id        uuid not null references public.markets (id) on delete cascade,
  -- Deferred for the same reason as on listing_publish_authorizations: this row is written from a
  -- BEFORE INSERT trigger on listings, before the listing itself exists.
  listing_id       uuid references public.listings (id) on delete set null
                     deferrable initially deferred,
  kind             text not null check (kind in ('publish','renewal')),
  funded           text not null check (funded in ('included','paid','unlimited','admin_grant')),
  period_start     timestamptz not null,
  period_source    text not null check (period_source in ('subscription','calendar_month')),
  plan_at_time     public.market_plan,
  authorization_id uuid references public.listing_publish_authorizations (id) on delete set null,
  occurred_at      timestamptz not null default now(),
  actor            uuid default auth.uid()
);

create index if not exists lpe_market_period_idx
  on public.listing_publish_events (market_id, period_start, kind, funded);
create index if not exists lpe_listing_idx
  on public.listing_publish_events (listing_id, kind);

-- A paid authorization may be spent exactly once, enforced in the database rather than in code.
create unique index if not exists lpe_authorization_once
  on public.listing_publish_events (authorization_id)
  where authorization_id is not null;

comment on table public.listing_publish_events is
  'Append-only. Never UPDATE or DELETE: corrections are compensating rows, as in market_promotion_credits.';

-- ---------------------------------------------------------------------------
-- 7. Usage and remaining allowance
-- ---------------------------------------------------------------------------
create or replace function public.market_allowance_usage(p_market uuid)
returns table (
  plan                     public.market_plan,
  display_name             text,
  period_start             timestamptz,
  period_end               timestamptz,
  period_source            text,
  publishes_allowed        int,     -- null = unlimited
  publishes_used           int,
  publishes_remaining      int,     -- null = unlimited
  renewals_allowed         int,     -- null = unlimited
  renewals_used            int,
  renewals_remaining       int,     -- null = unlimited
  paid_publishes           int,
  paid_renewals            int,
  paid_cents               int,
  listing_lifetime_days    int,
  qr_tools                 boolean,
  wanted_intros_per_day    int
)
language plpgsql stable security definer set search_path = public
as $$
declare
  eff  record;
  per   record;
  lim   record;
begin
  select ep.plan into eff from public.market_effective_plan(p_market) ep;
  if eff.plan is null then return; end if;

  select * into per from public.market_allowance_period(p_market);
  select pl.* into lim from public.plan_limits pl where pl.plan = eff.plan;

  plan                  := eff.plan;
  display_name          := coalesce(lim.display_name, eff.plan::text);
  period_start          := per.period_start;
  period_end            := per.period_end;
  period_source         := per.source;
  publishes_allowed     := lim.monthly_publish_allowance;
  renewals_allowed      := lim.included_renewals_per_period;
  listing_lifetime_days := coalesce(lim.listing_lifetime_days, 7);
  qr_tools              := coalesce(lim.qr_tools, false);
  wanted_intros_per_day := lim.wanted_intros_per_day;

  -- Only INCLUDED usage counts against an allowance. Paid and admin-granted rows are recorded for
  -- accounting but must never reduce what the plan itself owes the seller.
  -- Every reference below is table-qualified: this function's OUT parameters share names with
  -- listing_publish_events columns (period_start above all), and an unqualified reference resolves
  -- to the PL/pgSQL variable, which silently compares the column to itself.
  select
    count(*) filter (where e.kind = 'publish' and e.funded = 'included'),
    count(*) filter (where e.kind = 'renewal' and e.funded = 'included')
  into publishes_used, renewals_used
  from public.listing_publish_events e
  where e.market_id = p_market and e.period_start = per.period_start;

  -- Paid totals are lifetime, not per-period: they are historical transactions, not credits.
  select
    count(*) filter (where e.kind = 'publish' and e.funded = 'paid'),
    count(*) filter (where e.kind = 'renewal' and e.funded = 'paid')
  into paid_publishes, paid_renewals
  from public.listing_publish_events e
  where e.market_id = p_market;

  select coalesce(sum(a.amount_cents), 0)::int into paid_cents
  from public.listing_publish_authorizations a
  where a.market_id = p_market and a.status in ('paid','consumed');

  publishes_remaining := case when publishes_allowed is null then null
                              else greatest(0, publishes_allowed - publishes_used) end;
  renewals_remaining  := case when renewals_allowed  is null then null
                              else greatest(0, renewals_allowed  - renewals_used)  end;
  return next;
end $$;

-- The seller's own view. Pinned to auth.uid() via their market, so a caller can never read
-- another market's usage by passing an id.
--
-- The column list is spelled out rather than `setof record`: PostgREST cannot call a record-
-- returning function without a runtime column definition, so `setof record` would compile here and
-- then fail from every client.
create or replace function public.my_listing_allowance()
returns table (
  plan                     public.market_plan,
  display_name             text,
  period_start             timestamptz,
  period_end               timestamptz,
  period_source            text,
  publishes_allowed        int,
  publishes_used           int,
  publishes_remaining      int,
  renewals_allowed         int,
  renewals_used            int,
  renewals_remaining       int,
  paid_publishes           int,
  paid_renewals            int,
  paid_cents               int,
  listing_lifetime_days    int,
  qr_tools                 boolean,
  wanted_intros_per_day    int
)
language plpgsql stable security definer set search_path = public
as $$
declare m uuid;
begin
  select id into m from public.markets where owner_id = auth.uid() limit 1;
  if m is null then return; end if;
  return query select * from public.market_allowance_usage(m);
end $$;

-- ---------------------------------------------------------------------------
-- 8. The gate
-- ---------------------------------------------------------------------------
-- Replaces enforce_plan_limit's active-count check. Fires on INSERT *and* on the transition into
-- 'active', which also closes an existing hole: the old trigger was BEFORE INSERT only, so
-- flipping a paused listing back to active bypassed the cap entirely.
--
-- publish vs renewal is derived, not flagged: if this listing has ever been published before, an
-- activation is a renewal. A caller therefore cannot mislabel a new listing as a renewal to reach
-- the cheaper allowance.
create or replace function public.enforce_publish_allowance()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  eff       record;
  per       record;
  lim       record;
  v_kind    text;
  used      int;
  allowed   int;
  auth_row  public.listing_publish_authorizations;
begin
  -- Only activations matter.
  if new.status <> 'active' or new.market_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' then return new; end if;

  -- Owner decision: only Sell spends allowance.
  if not public.listing_type_spends_allowance(new.listing_type) then return new; end if;

  select ep.plan into eff from public.market_effective_plan(new.market_id) ep;
  if eff.plan is null then return new; end if;

  select * into per from public.market_allowance_period(new.market_id);
  select pl.* into lim from public.plan_limits pl where pl.plan = eff.plan;

  v_kind := case
    when exists (select 1 from public.listing_publish_events e
                  where e.listing_id = new.id and e.kind = 'publish')
    then 'renewal' else 'publish' end;

  allowed := case when v_kind = 'publish'
                  then lim.monthly_publish_allowance
                  else lim.included_renewals_per_period end;

  -- Unlimited tier: record the event for analytics, spend nothing.
  if allowed is null then
    insert into public.listing_publish_events
      (market_id, listing_id, kind, funded, period_start, period_source, plan_at_time)
    values (new.market_id, new.id, v_kind, 'unlimited', per.period_start, per.source, eff.plan);
    return new;
  end if;

  select count(*)::int into used
  from public.listing_publish_events
  where market_id = new.market_id
    and period_start = per.period_start
    and kind = v_kind
    and funded = 'included';

  if used < allowed then
    insert into public.listing_publish_events
      (market_id, listing_id, kind, funded, period_start, period_source, plan_at_time)
    values (new.market_id, new.id, v_kind, 'included', per.period_start, per.source, eff.plan);
    return new;
  end if;

  -- Allowance spent. Look for a paid authorization for this exact intent. Locked so two concurrent
  -- publishes cannot consume the same payment.
  select * into auth_row
  from public.listing_publish_authorizations
  where market_id = new.market_id
    and intent = v_kind
    and status = 'paid'
    and (listing_id is null or listing_id = new.id)
  order by (listing_id = new.id) desc nulls last, paid_at asc
  limit 1
  for update skip locked;

  if found then
    update public.listing_publish_authorizations
       set status = 'consumed', consumed_at = now(), listing_id = new.id
     where id = auth_row.id;

    insert into public.listing_publish_events
      (market_id, listing_id, kind, funded, period_start, period_source, plan_at_time, authorization_id)
    values (new.market_id, new.id, v_kind, 'paid', per.period_start, per.source, eff.plan, auth_row.id);
    return new;
  end if;

  -- Structured refusal so the client can offer "pay $0.99" or "upgrade" instead of a dead end.
  raise exception 'PUBLISH_ALLOWANCE_EXHAUSTED'
    using errcode = 'P0001',
          hint = format('%s allowance of %s spent for plan %s in period starting %s',
                        v_kind, allowed, eff.plan, per.period_start);
end $$;

drop trigger if exists trg_enforce_publish_allowance on public.listings;
create trigger trg_enforce_publish_allowance
  before insert or update of status on public.listings
  for each row execute function public.enforce_publish_allowance();

-- Retire the old active-count gate. The FUNCTION enforce_plan_limit() is deliberately left defined
-- so 0104_down can re-attach it without resurrecting its body.
--
-- The trigger is named listings_enforce_plan_limit — verified against production, not guessed. A
-- wrong name here fails silently and catastrophically: the old active-count cap keeps firing
-- underneath the new model, so a Free seller is refused at 5 ACTIVE listings by a rule that no
-- longer exists in the product, with an error message naming a limit nobody was told about. The
-- assertion below turns that silent failure into a loud one.
drop trigger if exists listings_enforce_plan_limit on public.listings;

do $$
begin
  if exists (
    select 1 from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.listings'::regclass
      and not t.tgisinternal
      and p.proname = 'enforce_plan_limit'
  ) then
    raise exception
      '0104: the old active-count cap is still attached to public.listings under an unexpected '
      'trigger name. Find it (select tgname from pg_trigger where tgrelid=''public.listings''::regclass) '
      'and drop it here, or the retired cap will keep refusing publishes underneath the new model.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Renewal
-- ---------------------------------------------------------------------------
-- Renewal republishes the SAME listing for a fresh lifetime measured from now, never extended from
-- a stale expires_at (which would hand out odd durations for a listing that expired weeks ago).
--
-- Compliance is deliberately NOT bypassed: the activation runs through the same screening and
-- suspension triggers as any other publish, because this sets status and lets those fire rather
-- than writing around them.
create or replace function public.renew_listing(p_listing uuid)
returns table (ok boolean, expires_at timestamptz, funded text)
language plpgsql security definer set search_path = public
as $$
declare
  l    public.listings;
  days int;
  ev   record;
begin
  select * into l from public.listings where id = p_listing for update;
  if not found then raise exception 'LISTING_NOT_FOUND' using errcode = 'P0001'; end if;

  if not exists (select 1 from public.markets m
                  where m.id = l.market_id and m.owner_id = auth.uid()) then
    raise exception 'NOT_YOUR_LISTING' using errcode = 'P0001';
  end if;

  select coalesce(pl.listing_lifetime_days, 7) into days
  from public.market_effective_plan(l.market_id) ep
  join public.plan_limits pl on pl.plan = ep.plan;

  -- The allowance trigger decides included vs paid vs refuse as the status flips to active.
  update public.listings
     set status = 'active', expires_at = now() + make_interval(days => coalesce(days, 7))
   where id = p_listing;

  select e.funded into ev
  from public.listing_publish_events e
  where e.listing_id = p_listing
  order by e.occurred_at desc limit 1;

  ok := true;
  expires_at := now() + make_interval(days => coalesce(days, 7));
  funded := coalesce(ev.funded, 'included');
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Security
-- ---------------------------------------------------------------------------
alter table public.listing_publish_authorizations enable row level security;
alter table public.listing_publish_events         enable row level security;

-- Sellers read their own rows and write NOTHING. Every write is made by a definer function or the
-- webhook via service_role, so a user cannot grant themselves an authorization or forge a ledger
-- row that would fake an allowance.
drop policy if exists lpa_owner_read on public.listing_publish_authorizations;
create policy lpa_owner_read on public.listing_publish_authorizations
  for select using (public.owns_market(market_id));
drop policy if exists lpa_admin_read on public.listing_publish_authorizations;
create policy lpa_admin_read on public.listing_publish_authorizations
  for select using (public.is_admin());

drop policy if exists lpe_owner_read on public.listing_publish_events;
create policy lpe_owner_read on public.listing_publish_events
  for select using (public.owns_market(market_id));
drop policy if exists lpe_admin_read on public.listing_publish_events;
create policy lpe_admin_read on public.listing_publish_events
  for select using (public.is_admin());

-- Belt and braces: RLS does not apply to SECURITY DEFINER functions, so the grants below are what
-- actually stop a direct PostgREST write.
revoke insert, update, delete, truncate on public.listing_publish_authorizations from anon, authenticated;
revoke insert, update, delete, truncate on public.listing_publish_events         from anon, authenticated;
grant select on public.listing_publish_authorizations to authenticated;
grant select on public.listing_publish_events         to authenticated;

revoke execute on function public.market_allowance_usage(uuid)   from public, anon;
revoke execute on function public.market_allowance_period(uuid)  from public, anon;
revoke execute on function public.renew_listing(uuid)            from public, anon;
grant  execute on function public.my_listing_allowance()         to authenticated;
grant  execute on function public.renew_listing(uuid)            to authenticated;

notify pgrst, 'reload schema';
