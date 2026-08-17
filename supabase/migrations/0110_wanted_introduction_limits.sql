-- Gnome — daily Wanted introduction limits, per plan.
--
-- THE UNIT BEING METERED
-- One seller initiating contact with one unique Wanted post. Not messages: once the introduction
-- exists, the conversation flows freely under the ordinary chat rules. The entitlement ladder is
-- plan_limits.wanted_intros_per_day, seeded in 0104: free 1, grower 5, farm 15, sponsor NULL
-- (unlimited — an entitlement statement, not an exemption from abuse controls).
--
-- WHY THERE IS NO NEW TABLE
-- The durable introduction record already exists. A Wanted response IS a claim with
-- claim_type='wanted_response', and claims carries UNIQUE (listing_id, claimer_id) — so "the same
-- seller cannot consume quota twice on the same post" is already a structural property, not a rule
-- to add. This migration adds the GATE, the day boundary, and the read RPCs; the ledger is the
-- claims table itself.
--
-- WHAT DOES AND DOES NOT CONSUME
--   consumes   the first successful INSERT of a claim on a wanted listing
--   free       buyer replies; follow-up messages; REVIVING a declined/cancelled/expired claim
--              (the client's 23505-revive path is an UPDATE, and the gate fires on INSERT only);
--              viewing, saving, drafting; any attempt the server rejects — consumption is the row
--              itself, so an aborted insert consumes nothing by construction
--   also free  responding to a Wanted post by PUBLISHING a Share Free listing (the fulfilledBy
--              flow). That creates no conversation — the buyer initiates any chat that follows,
--              and buyer-initiated contact is never metered.
--
-- DAY BOUNDARY
-- Calendar day in America/New_York, the project's standing convention (0104's Free month boundary
-- and create_market_order's cutoffs both use ET). One helper owns it so the trigger, the seller
-- RPC and the admin RPC can never disagree about "today".
--
-- Run after 0109. Idempotent.

-- ---------------------------------------------------------------------------
-- 1. The day boundary — one definition, used everywhere
-- ---------------------------------------------------------------------------
create or replace function public.wanted_day_start()
returns timestamptz
language sql stable
as $$
  select date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York';
$$;

comment on function public.wanted_day_start() is
  'Start of the current Wanted-introduction day: midnight America/New_York, the project timezone convention. Every consumer of "today" must call this.';

-- ---------------------------------------------------------------------------
-- 2. Plan attribution for analytics
-- ---------------------------------------------------------------------------
-- Stamped by the gate at introduction time, so "introductions by plan" is answerable historically
-- even after the seller changes plans. claims uses TABLE-level grants (verified against
-- production), so a new column is covered by the existing grant — this is not the listings
-- column-grant trap.
alter table public.claims
  add column if not exists claimer_plan_at_time public.market_plan;

comment on column public.claims.claimer_plan_at_time is
  'Effective plan of the claimer when a wanted_response was created. Set by the gate; null for other claim types and legacy rows.';

-- ---------------------------------------------------------------------------
-- 3. The gate
-- ---------------------------------------------------------------------------
create or replace function public.enforce_wanted_introduction()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  l         record;
  eff       record;
  allowed   int;
  used      int;
  hour_used int;
  existing  public.claim_status;
  day0      timestamptz;
  -- Anti-abuse ceiling, deliberately separate from the subscription entitlement: a legitimate
  -- Farm seller can answer many leads in a day, but no account answers thirty DISTINCT requests
  -- inside one hour by hand. Applies to every plan, unlimited included.
  hourly_cap constant int := 30;
begin
  -- The gate is keyed on the LISTING'S type, never on the claim_type the client sent — otherwise
  -- submitting claim_type='claim' against a Wanted post would walk straight past the meter.
  select li.id, li.owner_id, li.status, li.expires_at, li.listing_type
    into l from public.listings li where li.id = new.listing_id;
  if l.id is null then
    raise exception 'WANTED_NOT_AVAILABLE: That request is no longer open.' using errcode = 'P0001';
  end if;
  if l.listing_type <> 'wanted' then return new; end if;

  -- Normalize for the same reason the gate keys on the listing: the row that becomes the durable
  -- introduction record must say what it is regardless of what the client called it.
  new.claim_type := 'wanted_response';

  if l.status <> 'active' or l.expires_at <= now() then
    raise exception 'WANTED_NOT_AVAILABLE: That request is no longer open.' using errcode = 'P0001';
  end if;

  -- Already-contacted pre-check, with a deliberate carve-out. An ACTIVE relationship answers with
  -- the stable code so the client opens the existing conversation. A declined/cancelled/expired
  -- row falls through to the UNIQUE constraint's 23505 instead, because the mobile client's
  -- revive path depends on receiving exactly that error to re-open the old row — an UPDATE,
  -- which this INSERT gate correctly never meters.
  select c.status into existing from public.claims c
   where c.listing_id = new.listing_id and c.claimer_id = new.claimer_id;
  if existing is not null then
    if existing in ('declined','cancelled','expired') then
      -- Let the UNIQUE constraint answer with 23505 so the client's revive path can re-open the
      -- old row. Returning here also SKIPS the quota checks below on purpose: the relationship
      -- already exists and its introduction was already spent, so re-opening it is never a new
      -- introduction — a Free seller at 1/1 who was declined must still be able to revive today.
      -- No row can be created on this path; the constraint fires unconditionally.
      return new;
    end if;
    raise exception 'WANTED_ALREADY_CONTACTED: You’ve already responded to this request — open the conversation to keep talking.'
      using errcode = 'P0001';
  end if;

  -- Serialize this seller's introductions. Without the lock, two simultaneous requests both count
  -- the same "used" and both pass a one-slot allowance. With it, the second waits, recounts, and
  -- is refused. Transaction-scoped, self-releasing.
  perform pg_advisory_xact_lock(hashtextextended('wanted_intro:' || new.claimer_id::text, 0));

  select count(*)::int into hour_used from public.claims c
   where c.claimer_id = new.claimer_id and c.claim_type = 'wanted_response'
     and c.created_at > now() - interval '1 hour';
  if hour_used >= hourly_cap then
    raise exception 'RATE_LIMITED: You’ve reached out about % requests in the last hour, which is the most we allow at once. Try again in a little while.',
      hour_used using errcode = 'P0001';
  end if;

  -- Effective plan through the claimer's market — the same resolver every other entitlement uses,
  -- so complimentary grants and FOUNDING3-style promotional subscriptions land on the right rung
  -- automatically. No market resolves to the free rung rather than to unlimited.
  select ep.plan into eff
    from public.markets m
    cross join lateral public.market_effective_plan(m.id) ep
   where m.owner_id = new.claimer_id
   limit 1;
  new.claimer_plan_at_time := coalesce(eff.plan, 'free');

  select pl.wanted_intros_per_day into allowed
    from public.plan_limits pl where pl.plan = coalesce(eff.plan, 'free');

  -- NULL = unlimited: nothing to spend, but the row is still the measurement.
  if allowed is null then return new; end if;

  day0 := public.wanted_day_start();
  select count(*)::int into used from public.claims c
   where c.claimer_id = new.claimer_id and c.claim_type = 'wanted_response'
     and c.created_at >= day0;

  if used >= allowed then
    raise exception 'WANTED_INTRO_LIMIT_REACHED: You’ve used today’s % Wanted response%. You can respond to more tomorrow, and your existing conversations stay open.',
      allowed, case when allowed = 1 then '' else 's' end
      using errcode = 'P0001',
            hint = format('used %s of %s; resets %s', used, allowed, day0 + interval '1 day');
  end if;

  return new;
end $$;

drop trigger if exists claims_wanted_introduction_gate on public.claims;
create trigger claims_wanted_introduction_gate
  before insert on public.claims
  for each row execute function public.enforce_wanted_introduction();

-- ---------------------------------------------------------------------------
-- 4. The seller's own view
-- ---------------------------------------------------------------------------
-- Focused RPC rather than another widening of my_listing_allowance: Wanted has its own period
-- (daily, not the billing period) and no paid-overage concept — used IS actual, there is no $0.99
-- Wanted purchase. Pinned to auth.uid(); no parameter exists to read another seller.
create or replace function public.my_wanted_allowance()
returns table (
  plan          public.market_plan,
  display_name  text,
  allowed       int,          -- null = unlimited
  used_today    int,          -- also the ACTUAL count: no paid-overage split exists for Wanted
  remaining     int,          -- null = unlimited, never negative
  resets_at     timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
declare eff record; day0 timestamptz;
begin
  if auth.uid() is null then return; end if;

  select ep.plan into eff
    from public.markets m
    cross join lateral public.market_effective_plan(m.id) ep
   where m.owner_id = auth.uid()
   limit 1;

  plan := coalesce(eff.plan, 'free');
  select pl.display_name, pl.wanted_intros_per_day into display_name, allowed
    from public.plan_limits pl where pl.plan = coalesce(eff.plan, 'free');
  display_name := coalesce(display_name, initcap(plan::text));

  day0 := public.wanted_day_start();
  select count(*)::int into used_today from public.claims c
   where c.claimer_id = auth.uid() and c.claim_type = 'wanted_response'
     and c.created_at >= day0;

  remaining := case when allowed is null then null else greatest(0, allowed - used_today) end;
  resets_at := day0 + interval '1 day';
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Admin visibility
-- ---------------------------------------------------------------------------
-- Wanted-post identity and timing only — never chat content. Entitlement usage is not a reason to
-- read anyone's messages.
create or replace function public.admin_wanted_usage(p_user uuid)
returns table (
  user_id        uuid,
  email          text,
  plan           public.market_plan,
  display_name   text,
  allowed        int,
  used_today     int,
  remaining      int,
  hit_limit_today boolean,
  lifetime_intros int,
  recent         jsonb        -- [{title, created_at, status}] latest 10, no message content
)
language plpgsql stable security definer set search_path = public
as $$
declare eff record; day0 timestamptz;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = 'P0001'; end if;

  user_id := p_user;
  select au.email::text into email from auth.users au where au.id = p_user;

  select ep.plan into eff
    from public.markets m
    cross join lateral public.market_effective_plan(m.id) ep
   where m.owner_id = p_user
   limit 1;
  plan := coalesce(eff.plan, 'free');
  select pl.display_name, pl.wanted_intros_per_day into display_name, allowed
    from public.plan_limits pl where pl.plan = coalesce(eff.plan, 'free');
  display_name := coalesce(display_name, initcap(plan::text));

  day0 := public.wanted_day_start();
  select count(*)::int into used_today from public.claims c
   where c.claimer_id = p_user and c.claim_type = 'wanted_response' and c.created_at >= day0;
  select count(*)::int into lifetime_intros from public.claims c
   where c.claimer_id = p_user and c.claim_type = 'wanted_response';

  remaining := case when allowed is null then null else greatest(0, allowed - used_today) end;
  hit_limit_today := allowed is not null and used_today >= allowed;

  select coalesce(jsonb_agg(jsonb_build_object(
           'title', li.title, 'created_at', c.created_at, 'status', c.status)
           order by c.created_at desc), '[]'::jsonb)
    into recent
    from (select * from public.claims c2
           where c2.claimer_id = p_user and c2.claim_type = 'wanted_response'
           order by c2.created_at desc limit 10) c
    join public.listings li on li.id = c.listing_id;

  return next;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants — explicit in both directions, with the lesson of 0106/0109 applied
-- ---------------------------------------------------------------------------
revoke execute on function public.enforce_wanted_introduction() from public, anon, authenticated;
revoke execute on function public.wanted_day_start()            from public, anon;
revoke execute on function public.my_wanted_allowance()         from public, anon;
revoke execute on function public.admin_wanted_usage(uuid)      from public, anon;

grant execute on function public.my_wanted_allowance()    to authenticated;
grant execute on function public.admin_wanted_usage(uuid) to authenticated;  -- is_admin() inside is the gate

do $$
begin
  if not has_function_privilege('authenticated', 'public.my_wanted_allowance()', 'execute') then
    raise exception '0110: sellers cannot read their own Wanted allowance.';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_wanted_usage(uuid)', 'execute') then
    raise exception '0110: the admin app cannot reach admin_wanted_usage — the 0106 grant trap again.';
  end if;
  if has_function_privilege('anon', 'public.my_wanted_allowance()', 'execute')
     or has_function_privilege('anon', 'public.admin_wanted_usage(uuid)', 'execute') then
    raise exception '0110: anon can execute a Wanted RPC.';
  end if;
  if has_function_privilege('authenticated', 'public.enforce_wanted_introduction()', 'execute') then
    raise exception '0110: the gate trigger function is directly executable by clients.';
  end if;
end $$;

notify pgrst, 'reload schema';
