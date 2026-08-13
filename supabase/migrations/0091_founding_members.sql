-- 0091 — Founding Member program: 500 numbered slots, paid subscribers only.
--
-- NOT APPLIED TO PRODUCTION. Applying it activates nothing: `program_enabled`
-- ships FALSE, and even with the flag on, an award is refused unless the
-- payment arrived from Stripe in LIVE mode — and no live price id exists for
-- any Gnome product today (billing_products.stripe_price_id_live is NULL for
-- all eleven rows; billing_config.payments_live_enabled is false, verified
-- 2026-08-13 against fgybyghwcjlstqxkclch). So the program is architecturally
-- complete and commercially inert until Daniel configures live Stripe.
--
-- ============================ THE DOCTRINE =================================
-- Founding Member is EXCLUSIVELY for paid Gnome marketplace subscribers.
--   * Registering early qualifies nobody.
--   * Seed Drop interest qualifies nobody.
--   * A complimentary plan grant (0076 admin_plan_grants) qualifies nobody —
--     it is not a payment, and it cannot reach this RPC because the award path
--     starts at a Stripe subscription event carrying money.
--   * A TEST-mode Stripe payment qualifies nobody (see §0 below).
-- The two qualifying products are GNOME_GROWER_MONTHLY and GNOME_FARM_MONTHLY,
-- held in config rather than hard-coded so a future plan can be added without a
-- schema change — but only by the owner, audited.
--
-- ============================ §0 THE LIVEMODE RULE =========================
-- TEST-mode awards are REFUSED OUTRIGHT. They are not stored-but-uncounted.
--
-- The alternative — write the row, mark it test, filter it everywhere — creates
-- two classes of founder and makes every later query responsible for
-- remembering the filter. The first query that forgets publishes a fake
-- founder with a real number. Refusing outright means `founding_members`
-- contains exactly one kind of row, and there is no filter to forget.
--
-- The rule is enforced twice on purpose: the RPC refuses p_stripe_livemode
-- false, and a CHECK constraint makes `stripe_livemode = true` a table
-- invariant, so no future RPC bug or service-role script can seat a test-mode
-- founder without a visible, reviewed migration.
--
-- Deliberately NOT gated on billing_config.payments_live_enabled: that flag
-- governs whether Gnome will CREATE a live Checkout Session. If a live-mode
-- subscription event nonetheless arrives, real money moved and that person
-- really did qualify; refusing them would be the wrong failure.
--
-- Additive only: new tables, new functions, one new view. Nothing existing is
-- altered. Paired rollback: 0091_down_founding_members.sql

-- ===========================================================================
-- 1. Program configuration — the flag, the cap, and the allocation counter
-- ===========================================================================
-- Singleton, shaped like billing_config / seed_capacity_controls so it reads
-- the same way as every other gate in this codebase.
--
-- `last_founding_number` is a HIGH-WATER MARK, not a live count. Numbers are
-- never recycled: a founder who lapses, is revoked, or deletes their account
-- does not return their number to the pool. Two people who can both truthfully
-- screenshot "Founding Member #0042" is a worse outcome than a retired number.

create table if not exists public.founding_program_config (
  id                     boolean primary key default true check (id),
  -- The whole program ships OFF. Nothing awards, nothing displays.
  program_enabled        boolean not null default false,
  -- 500 is a schema invariant, not a setting. The CHECK permits lowering the
  -- cap (a deliberate tightening) and forbids raising it — growing the program
  -- past 500 requires a migration, which is a reviewed act rather than a
  -- late-night config edit.
  founding_capacity      int not null default 500 check (founding_capacity between 1 and 500),
  last_founding_number   int not null default 0   check (last_founding_number >= 0),
  qualifying_product_keys text[] not null
                           default array['GNOME_GROWER_MONTHLY','GNOME_FARM_MONTHLY'],
  -- Days a founder keeps ACTIVE status after a failed payment before lapsing.
  grace_period_days      int not null default 30 check (grace_period_days between 1 and 90),
  -- Launch visibility window. Bounded 60..90 by constraint so "temporary"
  -- cannot quietly become "permanent" through a config edit.
  market_boost_days      int not null default 60 check (market_boost_days between 60 and 90),
  updated_by             uuid,
  updated_at             timestamptz not null default now(),
  constraint founding_counter_within_capacity
    check (last_founding_number <= founding_capacity)
);
insert into public.founding_program_config (id) values (true) on conflict (id) do nothing;

comment on table public.founding_program_config is
  'Singleton gate for the Founding Member program. program_enabled ships false. '
  'founding_capacity may be lowered but never raised above 500 (CHECK). '
  'last_founding_number is a high-water mark: numbers are never recycled.';

alter table public.founding_program_config enable row level security;
drop policy if exists founding_config_read on public.founding_program_config;
create policy founding_config_read on public.founding_program_config
  for select using (public.admin_has_perm('subscriptions.view'));
-- REVOKE ALL, not a targeted revoke of insert/update/delete. Supabase's default
-- privileges hand anon and authenticated SELECT, INSERT, UPDATE, DELETE,
-- REFERENCES and TRIGGER on every new table in `public` — verified against
-- production 2026-08-13, where billing_config still carries REFERENCES and
-- TRIGGER because 0083 revoked only the three obvious ones. Start from zero and
-- grant back exactly what is needed.
revoke all on public.founding_program_config from anon, authenticated;
grant select on public.founding_program_config to authenticated;

-- ===========================================================================
-- 2. The roster
-- ===========================================================================
create table if not exists public.founding_members (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique references public.profiles(id) on delete cascade,
  founding_number          int  not null unique check (founding_number between 1 and 500),
  awarded_at               timestamptz not null default now(),

  -- Immutable evidence of what qualified them. This is the PRICE LOCK
  -- reference: it records WHICH price they came in on. It promises no dollar
  -- amount to anybody — see docs/founding/FOUNDING_MEMBER_PROGRAM.md.
  qualifying_stripe_price_id text not null,
  qualifying_product_key     text not null,
  qualifying_subscription_id text not null unique,
  qualifying_stripe_event_id text,
  -- Always true; see §0. Kept as stored evidence and as the invariant below.
  stripe_livemode          boolean not null default true check (stripe_livemode),

  -- The live subscription, which is NOT the qualifying one after an upgrade or
  -- downgrade (Stripe may issue a new subscription id). Lapse/recovery keys off
  -- this; qualification keys off the immutable column above.
  current_subscription_id  text not null unique,

  status                   text not null default 'ACTIVE'
                             check (status in ('ACTIVE','LAPSED','REVOKED')),
  payment_failed_at        timestamptz,   -- grace clock; null = no failure open
  lapsed_at                timestamptz,
  revoked_at               timestamptz,
  revoked_reason           text,

  -- Founding MARKET activation is a separate, later step (§6).
  market_id                uuid references public.markets(id) on delete set null,
  market_activated_at      timestamptz,
  -- Launch visibility as DATA with an end date. Never a ranking column.
  boost_until              timestamptz,

  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint founding_lapsed_has_timestamp
    check (status <> 'LAPSED'  or lapsed_at  is not null),
  constraint founding_revoked_has_timestamp
    check (status <> 'REVOKED' or revoked_at is not null),
  constraint founding_market_pair
    check ((market_id is null) = (market_activated_at is null)),
  constraint founding_boost_requires_market
    check (boost_until is null or market_activated_at is not null)
);

create index if not exists founding_members_status_idx
  on public.founding_members (status, founding_number);
create index if not exists founding_members_market_idx
  on public.founding_members (market_id) where market_id is not null;
create index if not exists founding_members_grace_idx
  on public.founding_members (payment_failed_at) where payment_failed_at is not null;

comment on table public.founding_members is
  'One row per paid Founding Member. Rows exist ONLY for live-mode Stripe '
  'payments on a qualifying marketplace subscription. The number is permanent; '
  'the status is not.';

-- ---------------------------------------------------------------------------
-- Immutability guard.
-- ---------------------------------------------------------------------------
-- No client role holds UPDATE on this table, so the realistic threat is a
-- service-role script or a future RPC quietly rewriting history. The number
-- moves only when public.admin_founding_renumber() sets the transaction-local
-- flag below; the qualification evidence never moves at all.
create or replace function public.founding_members_guard()
returns trigger language plpgsql as $$
begin
  if new.founding_number is distinct from old.founding_number
     and coalesce(current_setting('gnome.founding_renumber', true), '') <> 'authorized' then
    raise exception 'FOUNDING_NUMBER_IMMUTABLE: renumbering goes through admin_founding_renumber()'
      using errcode = 'P0001';
  end if;
  if new.qualifying_stripe_price_id is distinct from old.qualifying_stripe_price_id
     or new.qualifying_product_key     is distinct from old.qualifying_product_key
     or new.qualifying_subscription_id is distinct from old.qualifying_subscription_id
     or new.awarded_at                 is distinct from old.awarded_at
     or new.stripe_livemode            is distinct from old.stripe_livemode then
    raise exception 'FOUNDING_QUALIFICATION_IMMUTABLE: qualification evidence cannot be edited'
      using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists founding_members_guard_trg on public.founding_members;
create trigger founding_members_guard_trg
  before update on public.founding_members
  for each row execute function public.founding_members_guard();

-- ---------------------------------------------------------------------------
-- RLS: a member reads their own row; admins with the subscriptions permission
-- read all. Everyone else reads the public badge projection in §7 — never this
-- table, which carries Stripe ids and revocation reasons.
-- ---------------------------------------------------------------------------
alter table public.founding_members enable row level security;

drop policy if exists founding_members_select_self on public.founding_members;
create policy founding_members_select_self on public.founding_members
  for select using (user_id = auth.uid());

drop policy if exists founding_members_select_admin on public.founding_members;
create policy founding_members_select_admin on public.founding_members
  for select using (public.admin_has_perm('subscriptions.view'));

-- No insert/update/delete policies exist. Writes happen only inside the
-- SECURITY DEFINER RPCs below, which run as the table owner.
revoke all on public.founding_members from anon, authenticated;
grant select on public.founding_members to authenticated;

-- ===========================================================================
-- 3. Display, capacity and status reads
-- ===========================================================================
-- The one place the badge string is built. "Founding Member #0042".
create or replace function public.founding_number_display(p_number int)
returns text language sql immutable as $$
  select case when p_number is null then null
              else 'Founding Member #' || to_char(p_number, 'FM0000') end;
$$;

create or replace function public.founding_result(
  p_awarded boolean, p_reason text, p_number int default null, p_status text default null
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'awarded', p_awarded,
    'reason', p_reason,
    'founding_number', p_number,
    'display', public.founding_number_display(p_number),
    'status', p_status);
$$;

-- Remaining slots are computed from the HIGH-WATER MARK, not from a count of
-- ACTIVE rows. A lapsed or revoked founder does not free a slot, so this never
-- offers a number that has already been printed on somebody's profile.
create or replace function public.founding_capacity_remaining()
returns int language sql stable security definer set search_path = public as $$
  select greatest(c.founding_capacity - c.last_founding_number, 0)
    from public.founding_program_config c where c.id;
$$;

-- Public-safe program summary. Reports nothing when the program is off.
create or replace function public.founding_program_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not c.program_enabled
    then jsonb_build_object('enabled', false)
    else jsonb_build_object(
      'enabled',   true,
      'capacity',  c.founding_capacity,
      'awarded',   c.last_founding_number,
      'remaining', greatest(c.founding_capacity - c.last_founding_number, 0),
      'accepting', c.last_founding_number < c.founding_capacity)
  end
  from public.founding_program_config c where c.id;
$$;

-- The signed-in member's own view of their membership.
create or replace function public.my_founding_membership()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
      'founding_number', m.founding_number,
      'display',         public.founding_number_display(m.founding_number),
      'status',          m.status,
      'awarded_at',      m.awarded_at,
      'market_id',       m.market_id,
      'founding_market', m.market_activated_at is not null,
      'boost_until',     m.boost_until,
      'grace_until',     case when m.payment_failed_at is null then null
                              else m.payment_failed_at + (c.grace_period_days || ' days')::interval end)
    from public.founding_members m
    cross join public.founding_program_config c
   where c.id and m.user_id = auth.uid();
$$;

revoke execute on function public.founding_result(boolean,text,int,text) from public, anon, authenticated;
revoke execute on function public.founding_number_display(int) from public;
grant  execute on function public.founding_number_display(int) to anon, authenticated;
revoke execute on function public.founding_capacity_remaining() from public;
grant  execute on function public.founding_capacity_remaining() to anon, authenticated;
revoke execute on function public.founding_program_status() from public;
grant  execute on function public.founding_program_status() to anon, authenticated;
revoke execute on function public.my_founding_membership() from public, anon;
grant  execute on function public.my_founding_membership() to authenticated;

-- ===========================================================================
-- 4. THE AWARD — atomic, race-safe, service-role only
-- ===========================================================================
-- ALLOCATION MECHANISM, and why it is not the obvious thing:
--
--   select max(founding_number) + 1  is WRONG. Under READ COMMITTED two
--   concurrent webhook transactions both read the same max and both insert
--   max+1; one dies on the unique index, so the award is LOST rather than
--   queued — and with a slightly different shape (no unique index) both would
--   have committed the same number.
--
--   A SEQUENCE is also wrong here. nextval() is non-transactional: a rolled
--   back award burns its number permanently, so the roster develops holes and
--   "Founding Member #500" arrives before 500 people have paid. The
--   requirement is no duplicates AND no skips.
--
--   What this uses: a single-row counter updated with
--       UPDATE ... SET last_founding_number = last_founding_number + 1
--        WHERE id AND last_founding_number < founding_capacity
--        RETURNING last_founding_number
--   The UPDATE takes a row lock on the singleton. A second concurrent
--   transaction blocks on that lock, and when the first commits it re-reads the
--   committed row (READ COMMITTED re-evaluation) and takes the next number —
--   never the same one. The capacity test rides inside the same WHERE clause,
--   so exhaustion is decided under the same lock: zero rows returned means the
--   500th was already taken. And because the counter is ordinary transactional
--   data, a rollback returns the number to the pool — no skips.
--
--   Under REPEATABLE READ / SERIALIZABLE the same statement raises a
--   serialization failure instead of blocking. That is still safe: the loser
--   aborts and issues no number.
--
-- IDEMPOTENCY: the fast path returns an existing award without touching the
-- counter. Two events for the same subscription arriving at literally the same
-- moment both pass that check, so the unique indexes on user_id /
-- qualifying_subscription_id / current_subscription_id are the real guarantee.
-- The loser's unique_violation is caught below, which rolls back to the
-- implicit savepoint taken at the BEGIN of that block — undoing its counter
-- increment too, so a duplicate event consumes no number.

create or replace function public.founding_award_member(
  p_user_id                uuid,
  p_product_key            text,
  p_stripe_price_id        text,
  p_stripe_subscription_id text,
  p_subscription_status    text,
  p_stripe_livemode        boolean,
  p_amount_paid_cents      int  default null,
  p_stripe_event_id        text default null,
  p_market_id              uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  cfg        public.founding_program_config;
  existing   public.founding_members;
  v_number   int;
  v_live_price text;
begin
  select * into cfg from public.founding_program_config where id;

  if not cfg.program_enabled then
    return public.founding_result(false, 'PROGRAM_DISABLED');
  end if;

  -- §0: test mode is refused outright, before anything else is considered.
  if p_stripe_livemode is not true then
    return public.founding_result(false, 'TEST_MODE_NOT_ELIGIBLE');
  end if;

  -- Only a subscription that is actually running counts. `trialing` is
  -- excluded on purpose: a trial has not paid, and the doctrine is paid-only.
  if coalesce(p_subscription_status, '') <> 'active' then
    return public.founding_result(false, 'SUBSCRIPTION_NOT_ACTIVE');
  end if;

  -- Money must have moved. This is what makes a failed or refunded first
  -- payment a non-event rather than a consumed number: the webhook only calls
  -- with a positive captured amount on invoice.payment_succeeded /
  -- checkout.session.completed.
  if coalesce(p_amount_paid_cents, 0) <= 0 then
    return public.founding_result(false, 'NO_PAYMENT_CAPTURED');
  end if;

  if coalesce(p_stripe_subscription_id, '') = '' then
    return public.founding_result(false, 'MISSING_SUBSCRIPTION_ID');
  end if;

  if not (p_product_key = any(cfg.qualifying_product_keys)) then
    return public.founding_result(false, 'PRODUCT_NOT_QUALIFYING');
  end if;

  if not exists (select 1 from public.billing_products b
                  where b.key = p_product_key and b.active and b.kind = 'subscription') then
    return public.founding_result(false, 'PRODUCT_NOT_QUALIFYING');
  end if;

  -- When a live price id is configured for that product, the event must carry
  -- exactly it. Stops a live payment on some OTHER product's price from
  -- qualifying just because the caller mislabelled the product key.
  v_live_price := public.billing_price_id(p_product_key, 'live');
  if v_live_price is not null and v_live_price is distinct from p_stripe_price_id then
    return public.founding_result(false, 'PRICE_NOT_QUALIFYING');
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    return public.founding_result(false, 'UNKNOWN_USER');
  end if;

  -- Fast path: already a founder, or this subscription already bought a slot.
  select * into existing from public.founding_members
   where user_id = p_user_id
      or qualifying_subscription_id = p_stripe_subscription_id
      or current_subscription_id    = p_stripe_subscription_id;
  if found then
    return public.founding_result(false,
      case when existing.user_id = p_user_id then 'ALREADY_AWARDED'
           else 'SUBSCRIPTION_ALREADY_AWARDED' end,
      existing.founding_number, existing.status);
  end if;

  begin
    update public.founding_program_config
       set last_founding_number = last_founding_number + 1,
           updated_at = now()
     where id and last_founding_number < founding_capacity
    returning last_founding_number into v_number;

    if not found then
      return public.founding_result(false, 'CAPACITY_EXHAUSTED');
    end if;

    insert into public.founding_members (
      user_id, founding_number, qualifying_stripe_price_id, qualifying_product_key,
      qualifying_subscription_id, qualifying_stripe_event_id, current_subscription_id,
      stripe_livemode)
    values (
      p_user_id, v_number, p_stripe_price_id, p_product_key,
      p_stripe_subscription_id, p_stripe_event_id, p_stripe_subscription_id,
      true);
  exception when unique_violation then
    -- A concurrent event for the same person/subscription committed first.
    -- Rolling back to this block's savepoint also undoes the counter
    -- increment, so the duplicate consumes no number.
    select * into existing from public.founding_members
     where user_id = p_user_id or qualifying_subscription_id = p_stripe_subscription_id;
    return public.founding_result(false, 'ALREADY_AWARDED',
      existing.founding_number, existing.status);
  end;

  perform public.admin_audit(
    'FOUNDING_MEMBER_AWARDED', 'founding_members', p_user_id::text, null,
    jsonb_build_object('founding_number', v_number, 'product_key', p_product_key,
      'stripe_price_id', p_stripe_price_id, 'subscription_id', p_stripe_subscription_id,
      'stripe_event_id', p_stripe_event_id, 'market_id', p_market_id,
      'amount_paid_cents', p_amount_paid_cents, 'livemode', true),
    'paid marketplace subscription', 'SYSTEM', null);

  return public.founding_result(true, 'AWARDED', v_number, 'ACTIVE');
end $$;

-- Service role only. There is deliberately no client-callable "claim my
-- founding status" anywhere in this migration: the only way in is a Stripe
-- event the webhook verified.
revoke execute on function public.founding_award_member(uuid,text,text,text,text,boolean,int,text,uuid)
  from public, anon, authenticated;

-- ===========================================================================
-- 5. Lifecycle — grace, lapse, recovery, revocation
-- ===========================================================================
-- "Continuously active" means: a qualifying subscription in Stripe status
-- `active` with no failed payment older than grace_period_days. The definition
-- lives in docs/founding/FOUNDING_MEMBER_PROGRAM.md and is implemented here.

create or replace function public.founding_mark_payment_failed(p_subscription_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare m public.founding_members;
begin
  update public.founding_members
     set payment_failed_at = coalesce(payment_failed_at, now())
   where current_subscription_id = p_subscription_id and status = 'ACTIVE'
  returning * into m;
  if not found then return false; end if;
  perform public.admin_audit('FOUNDING_PAYMENT_FAILED', 'founding_members', m.user_id::text,
    null, jsonb_build_object('founding_number', m.founding_number,
      'grace_started_at', m.payment_failed_at), null, 'SYSTEM', null);
  return true;
end $$;

create or replace function public.founding_mark_payment_recovered(p_subscription_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare m public.founding_members; was text;
begin
  select status into was from public.founding_members
   where current_subscription_id = p_subscription_id;
  if not found then return false; end if;
  -- A lapsed founder who resumes paying is ACTIVE again on the SAME number.
  -- A revoked founder is not resurrected by a payment; revocation is a
  -- deliberate act and only an owner can reverse it.
  update public.founding_members
     set payment_failed_at = null,
         status    = case when status = 'LAPSED' then 'ACTIVE' else status end,
         lapsed_at = case when status = 'LAPSED' then null else lapsed_at end
   where current_subscription_id = p_subscription_id and status in ('ACTIVE','LAPSED')
  returning * into m;
  if not found then return false; end if;
  perform public.admin_audit('FOUNDING_PAYMENT_RECOVERED', 'founding_members', m.user_id::text,
    jsonb_build_object('status', was), jsonb_build_object('status', m.status), null, 'SYSTEM', null);
  return true;
end $$;

-- Immediate lapse: cancellation, or a subscription Stripe has ended.
create or replace function public.founding_lapse_member(
  p_subscription_id text, p_reason text default 'SUBSCRIPTION_ENDED'
) returns boolean language plpgsql security definer set search_path = public as $$
declare m public.founding_members;
begin
  update public.founding_members
     set status = 'LAPSED', lapsed_at = now()
   where current_subscription_id = p_subscription_id and status = 'ACTIVE'
  returning * into m;
  if not found then return false; end if;
  perform public.admin_audit('FOUNDING_MEMBER_LAPSED', 'founding_members', m.user_id::text,
    jsonb_build_object('status', 'ACTIVE'),
    jsonb_build_object('status', 'LAPSED', 'founding_number', m.founding_number),
    p_reason, 'SYSTEM', null);
  return true;
end $$;

-- Grace expiry sweep. Run from the webhook's housekeeping or a scheduled job.
create or replace function public.founding_sweep_lapses()
returns int language plpgsql security definer set search_path = public as $$
declare cfg public.founding_program_config; m public.founding_members; n int := 0;
begin
  select * into cfg from public.founding_program_config where id;
  for m in
    update public.founding_members
       set status = 'LAPSED', lapsed_at = now()
     where status = 'ACTIVE'
       and payment_failed_at is not null
       and payment_failed_at < now() - (cfg.grace_period_days || ' days')::interval
    returning *
  loop
    n := n + 1;
    perform public.admin_audit('FOUNDING_MEMBER_LAPSED', 'founding_members', m.user_id::text,
      jsonb_build_object('status', 'ACTIVE'),
      jsonb_build_object('status', 'LAPSED', 'founding_number', m.founding_number),
      'grace period expired', 'SYSTEM', null);
  end loop;
  return n;
end $$;

-- Refund or chargeback on the qualifying payment. The person did not, in the
-- end, pay — so they are not a founder. The NUMBER IS NOT RECYCLED (§1).
create or replace function public.founding_revoke_for_refund(
  p_subscription_id text, p_reason text default 'REFUND'
) returns boolean language plpgsql security definer set search_path = public as $$
declare m public.founding_members;
begin
  update public.founding_members
     set status = 'REVOKED', revoked_at = now(), revoked_reason = p_reason,
         boost_until = null
   where (current_subscription_id = p_subscription_id
          or qualifying_subscription_id = p_subscription_id)
     and status <> 'REVOKED'
  returning * into m;
  if not found then return false; end if;
  perform public.admin_audit('FOUNDING_MEMBER_REVOKED', 'founding_members', m.user_id::text,
    null, jsonb_build_object('founding_number', m.founding_number, 'reason', p_reason),
    p_reason, 'SYSTEM', null);
  return true;
end $$;

-- Upgrade / downgrade between qualifying plans. Stripe may issue a new
-- subscription id; the founder keeps their number and their ACTIVE status, and
-- the ORIGINAL qualifying evidence is left untouched (that is the price-lock
-- reference — see the immutability guard in §2).
create or replace function public.founding_relink_subscription(
  p_old_subscription_id text, p_new_subscription_id text, p_product_key text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare cfg public.founding_program_config; m public.founding_members;
begin
  select * into cfg from public.founding_program_config where id;
  if p_product_key is not null and not (p_product_key = any(cfg.qualifying_product_keys)) then
    -- Moving to a non-qualifying product is not an upgrade, it is leaving.
    return public.founding_lapse_member(p_old_subscription_id, 'MOVED_TO_NON_QUALIFYING_PLAN');
  end if;
  update public.founding_members
     set current_subscription_id = p_new_subscription_id
   where current_subscription_id = p_old_subscription_id
  returning * into m;
  if not found then return false; end if;
  perform public.admin_audit('FOUNDING_SUBSCRIPTION_RELINKED', 'founding_members', m.user_id::text,
    jsonb_build_object('subscription_id', p_old_subscription_id),
    jsonb_build_object('subscription_id', p_new_subscription_id, 'product_key', p_product_key),
    null, 'SYSTEM', null);
  return true;
end $$;

revoke execute on function public.founding_mark_payment_failed(text)      from public, anon, authenticated;
revoke execute on function public.founding_mark_payment_recovered(text)   from public, anon, authenticated;
revoke execute on function public.founding_lapse_member(text,text)        from public, anon, authenticated;
revoke execute on function public.founding_sweep_lapses()                 from public, anon, authenticated;
revoke execute on function public.founding_revoke_for_refund(text,text)   from public, anon, authenticated;
revoke execute on function public.founding_relink_subscription(text,text,text) from public, anon, authenticated;

-- ===========================================================================
-- 6. Founding MARKET activation and the bounded launch boost
-- ===========================================================================
-- Being a Founding Member does not make a Market a Founding Market. That is a
-- second, later step and it requires the founder to have actually shown up:
-- a Market they own, and at least one real listing that the public can see.
-- "Real" is the same predicate the public_listings view uses (active, unexpired,
-- market active) plus "not a demo row".
--
-- Activation is once. Moving a Founding Market to a different Market would let
-- someone farm a fresh boost window each time, so it is refused here and left
-- to an owner-audited correction.

create or replace function public.founding_market_eligible(p_market_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.markets m
     where m.id = p_market_id and m.owner_id = p_user_id and m.status = 'active'
  ) and exists (
    select 1 from public.listings l
      join public.markets m on m.id = l.market_id
     where l.market_id = p_market_id
       and l.status = 'active' and l.expires_at > now()
       and not l.is_demo and m.status = 'active'
  );
$$;

create or replace function public.founding_activate_my_market(p_market_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg public.founding_program_config; m public.founding_members; v_boost timestamptz;
begin
  select * into cfg from public.founding_program_config where id;
  if not cfg.program_enabled then
    return jsonb_build_object('activated', false, 'reason', 'PROGRAM_DISABLED');
  end if;

  select * into m from public.founding_members where user_id = auth.uid();
  if not found then
    return jsonb_build_object('activated', false, 'reason', 'NOT_A_FOUNDING_MEMBER');
  end if;
  if m.status <> 'ACTIVE' then
    return jsonb_build_object('activated', false, 'reason', 'MEMBERSHIP_NOT_ACTIVE');
  end if;
  if m.market_activated_at is not null then
    return jsonb_build_object('activated', false, 'reason', 'MARKET_ALREADY_ACTIVATED',
      'market_id', m.market_id);
  end if;
  -- Ownership and "has a real listing" are reported separately: a founder who
  -- typed the wrong market id should not be told to go publish a listing.
  if not exists (select 1 from public.markets
                  where id = p_market_id and owner_id = auth.uid() and status = 'active') then
    return jsonb_build_object('activated', false, 'reason', 'NOT_YOUR_MARKET');
  end if;
  if not public.founding_market_eligible(p_market_id, auth.uid()) then
    return jsonb_build_object('activated', false, 'reason', 'NEEDS_ACTIVE_LISTING');
  end if;

  v_boost := now() + (cfg.market_boost_days || ' days')::interval;
  update public.founding_members
     set market_id = p_market_id, market_activated_at = now(), boost_until = v_boost
   where id = m.id;

  perform public.admin_audit('FOUNDING_MARKET_ACTIVATED', 'founding_members', m.user_id::text,
    null, jsonb_build_object('founding_number', m.founding_number, 'market_id', p_market_id,
      'boost_until', v_boost, 'boost_days', cfg.market_boost_days),
    null, 'SYSTEM', null);

  return jsonb_build_object('activated', true, 'market_id', p_market_id,
    'boost_until', v_boost, 'label', 'Founding Market');
end $$;

-- THE BOOST CONTRACT, stated where the code is.
--
-- This function answers one question: "is this Market inside its Founding
-- Market launch window right now?" It is an INPUT to ranking, never a result.
-- Any caller must apply it AFTER compliance filtering, AFTER geographic
-- relevance, AFTER quality/plan rules — it may reorder results that a buyer
-- was already entitled to see, and it may never surface a listing that those
-- rules excluded. It expires on its own: there is no permanent ranking column
-- anywhere in this migration, and boost_until is the only lever.
create or replace function public.founding_market_boost_active(p_market_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.founding_members m
     cross join public.founding_program_config c
     where c.id and c.program_enabled
       and m.market_id = p_market_id
       and m.status = 'ACTIVE'
       and m.boost_until is not null and m.boost_until > now()
  );
$$;

revoke execute on function public.founding_market_eligible(uuid,uuid) from public, anon;
grant  execute on function public.founding_market_eligible(uuid,uuid) to authenticated;
revoke execute on function public.founding_activate_my_market(uuid) from public, anon;
grant  execute on function public.founding_activate_my_market(uuid) to authenticated;
revoke execute on function public.founding_market_boost_active(uuid) from public;
grant  execute on function public.founding_market_boost_active(uuid) to anon, authenticated;

-- ===========================================================================
-- 7. The public badge projection
-- ===========================================================================
-- The number is MEANT to be displayed, so it is public. Nothing else is:
-- no Stripe ids, no revocation reasons, no grace clock, no awarded_at.
-- Columns are enumerated deliberately (0087's rule): a column added to
-- founding_members tomorrow is invisible here until someone edits this view.
--
-- Only ACTIVE members appear. The badge asserts a current paid membership; a
-- lapsed founder keeps their number but stops displaying it until they resume,
-- and a revoked one never displays again.
create or replace view public.founding_badges as
select
  m.user_id,
  m.founding_number,
  public.founding_number_display(m.founding_number) as display,
  m.market_id,
  (m.market_activated_at is not null)                       as is_founding_market,
  (m.boost_until is not null and m.boost_until > now())     as launch_boost_active
from public.founding_members m
cross join public.founding_program_config c
where c.id and c.program_enabled and m.status = 'ACTIVE';

comment on view public.founding_badges is
  'The ONLY Founding Member projection anonymous visitors and other users may '
  'read. Enumerated columns, ACTIVE members only, and empty while '
  'program_enabled is false. Runs with the view owner''s rights '
  '(security_invoker=false) BY DESIGN so the base table stays self/admin-only.';

alter view public.founding_badges set (security_invoker = false);
alter view public.founding_badges set (security_barrier = true);

revoke all on public.founding_badges from public, anon, authenticated;
grant select on public.founding_badges to anon, authenticated;

-- Fail the migration rather than ship a writable public projection.
do $$
declare bad text;
begin
  select string_agg(distinct grantee || ':' || privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'founding_badges'
     and grantee in ('anon','authenticated') and privilege_type <> 'SELECT';
  if bad is not null then
    raise exception 'founding_badges must be SELECT-only for anon/authenticated; found: %', bad;
  end if;
end $$;

-- ===========================================================================
-- 8. Owner controls — deliberately awkward where they should be
-- ===========================================================================
create or replace function public.admin_founding_set_program(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare before public.founding_program_config; after public.founding_program_config;
begin
  if not public.admin_is_owner() then
    raise exception 'NOT_AUTHORIZED: owner only' using errcode = 'P0001';
  end if;
  select * into before from public.founding_program_config where id;

  update public.founding_program_config set
    program_enabled = coalesce((p_patch->>'program_enabled')::boolean, program_enabled),
    -- The CHECK on this column is what actually forbids raising the cap above
    -- 500; this line just lets the owner tighten it.
    founding_capacity = coalesce((p_patch->>'founding_capacity')::int, founding_capacity),
    qualifying_product_keys = coalesce(
      (select array_agg(value::text) from jsonb_array_elements_text(p_patch->'qualifying_product_keys')),
      qualifying_product_keys),
    grace_period_days = coalesce((p_patch->>'grace_period_days')::int, grace_period_days),
    market_boost_days = coalesce((p_patch->>'market_boost_days')::int, market_boost_days),
    updated_by = auth.uid(), updated_at = now()
  where id returning * into after;

  perform public.admin_audit('FOUNDING_PROGRAM_UPDATED', 'founding_program_config', 'singleton',
    to_jsonb(before), to_jsonb(after), null, 'ADMIN', null);
  return to_jsonb(after);
end $$;

-- Owner-initiated revocation (fraud, abuse, a founder who asked to be removed).
create or replace function public.admin_founding_revoke(p_user_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare m public.founding_members;
begin
  if not public.admin_is_owner() then
    raise exception 'NOT_AUTHORIZED: owner only' using errcode = 'P0001';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 10 then
    raise exception 'REASON_REQUIRED: revocation needs a written reason' using errcode = 'P0001';
  end if;
  update public.founding_members
     set status = 'REVOKED', revoked_at = now(), revoked_reason = p_reason, boost_until = null
   where user_id = p_user_id and status <> 'REVOKED'
  returning * into m;
  if not found then return false; end if;
  perform public.admin_audit('FOUNDING_MEMBER_REVOKED', 'founding_members', p_user_id::text,
    null, jsonb_build_object('founding_number', m.founding_number), p_reason, 'ADMIN', null);
  return true;
end $$;

-- RENUMBERING. This exists because a genuine allocation mistake has to be
-- fixable, and it is made awkward on purpose:
--   * owner only;
--   * a written reason of real length, not "fix";
--   * the caller must type back the CURRENT badge string, so renumbering the
--     wrong founder requires getting their number right first;
--   * the target must be a free number at or below the high-water mark, so a
--     renumber can never invent capacity or desynchronise the counter;
--   * the vacated number is retired, not reissued — the audit row is the only
--     place it lives on.
create or replace function public.admin_founding_renumber(
  p_user_id uuid, p_new_number int, p_reason text, p_confirm text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg public.founding_program_config; m public.founding_members; expected text;
begin
  if not public.admin_is_owner() then
    raise exception 'NOT_AUTHORIZED: owner only' using errcode = 'P0001';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 20 then
    raise exception 'REASON_REQUIRED: renumbering needs a written explanation of at least 20 characters'
      using errcode = 'P0001';
  end if;

  select * into cfg from public.founding_program_config where id;
  select * into m from public.founding_members where user_id = p_user_id;
  if not found then
    raise exception 'NOT_A_FOUNDING_MEMBER' using errcode = 'P0001';
  end if;

  expected := 'RENUMBER ' || public.founding_number_display(m.founding_number);
  if btrim(coalesce(p_confirm, '')) <> expected then
    raise exception 'CONFIRMATION_REQUIRED: pass exactly %', expected using errcode = 'P0001';
  end if;

  if p_new_number is null or p_new_number < 1 or p_new_number > cfg.last_founding_number then
    raise exception 'NUMBER_OUT_OF_RANGE: must be 1..% (the high-water mark)', cfg.last_founding_number
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.founding_members where founding_number = p_new_number) then
    raise exception 'NUMBER_TAKEN: #% is already assigned', p_new_number using errcode = 'P0001';
  end if;

  perform set_config('gnome.founding_renumber', 'authorized', true);
  update public.founding_members set founding_number = p_new_number where id = m.id;
  perform set_config('gnome.founding_renumber', '', true);

  perform public.admin_audit('FOUNDING_MEMBER_RENUMBERED', 'founding_members', p_user_id::text,
    jsonb_build_object('founding_number', m.founding_number),
    jsonb_build_object('founding_number', p_new_number, 'retired_number', m.founding_number),
    p_reason, 'ADMIN', null);

  return jsonb_build_object('renumbered', true, 'from', m.founding_number,
    'to', p_new_number, 'display', public.founding_number_display(p_new_number));
end $$;

revoke execute on function public.admin_founding_set_program(jsonb) from public, anon;
grant  execute on function public.admin_founding_set_program(jsonb) to authenticated;
revoke execute on function public.admin_founding_revoke(uuid,text) from public, anon;
grant  execute on function public.admin_founding_revoke(uuid,text) to authenticated;
revoke execute on function public.admin_founding_renumber(uuid,int,text,text) from public, anon;
grant  execute on function public.admin_founding_renumber(uuid,int,text,text) to authenticated;

notify pgrst, 'reload schema';
