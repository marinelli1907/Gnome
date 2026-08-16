-- Gnome — admin-managed promotion campaigns, and the server-side gate for $0.99 publishing.
--
-- WHY GNOME AND NOT STRIPE DECIDES ELIGIBILITY
-- Stripe cannot express "this coupon is only for the Pro plan". Verified against the account on
-- 2026-08-16: creating a coupon with applies_to[products][0] returns 200 with applies_to absent
-- from the response and still absent on retrieve, and a raw curl behaves identically — the
-- parameter is accepted and silently dropped. FOUNDING3 is therefore an UNRESTRICTED 100%-off
-- coupon at the Stripe layer, and anything that lets a customer attach it to a checkout session
-- attaches it to any plan, handing out Max at $29.99 and Farm at $99 for nothing.
--
-- So eligibility lives here. billing-checkout resolves a code through promo_validate() BEFORE it
-- builds a session, and only then passes the corresponding Stripe promotion code as a server-chosen
-- discount. The session is created with allow_promotion_codes:false so the customer cannot type a
-- code into Stripe's own UI and bypass this table entirely.
--
-- Run after 0105. Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Campaigns
-- ---------------------------------------------------------------------------
-- Generic on purpose. FOUNDING3 is the first campaign, not the shape of the system: nothing below
-- names it, and a second campaign needs a row, not a migration.
create table if not exists public.promotion_campaigns (
  id                       uuid primary key default gen_random_uuid(),
  -- Stored upper-case and compared upper-case, so 'founding3' and ' FOUNDING3 ' are the same code.
  code                     text not null unique check (code = upper(code) and code ~ '^[A-Z0-9_-]{3,40}$'),
  campaign_name            text not null,
  active                   boolean not null default true,

  -- Empty array = every subscription plan. Otherwise the exact internal enum values, NOT the
  -- customer-facing names: FOUNDING3 is {grower}, which is customer-facing "Pro".
  applicable_plans         public.market_plan[] not null default '{}',

  discount_type            text not null check (discount_type in ('percent','amount')),
  discount_percent         numeric check (discount_percent is null or (discount_percent > 0 and discount_percent <= 100)),
  discount_amount_cents    int    check (discount_amount_cents is null or discount_amount_cents > 0),

  duration                 text not null check (duration in ('once','repeating','forever')),
  duration_in_months       int check (duration_in_months is null or duration_in_months > 0),

  starts_at                timestamptz,
  expires_at               timestamptz,
  max_redemptions          int check (max_redemptions is null or max_redemptions > 0),
  max_redemptions_per_user int not null default 1 check (max_redemptions_per_user > 0),
  new_customers_only       boolean not null default false,

  -- Stripe supplies the discount mechanics only. Null until the setup script has run for that mode.
  stripe_coupon_id         text,
  stripe_promotion_code_id text,
  stripe_promotion_code_id_test text,
  stripe_promotion_code_id_live text,

  internal_notes           text,
  created_by               uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- A percent campaign with no percent, or an amount campaign with no amount, would validate as
  -- eligible and then produce a discount of nothing. Refuse the row instead.
  constraint promo_discount_coherent check (
    (discount_type = 'percent' and discount_percent is not null and discount_amount_cents is null) or
    (discount_type = 'amount'  and discount_amount_cents is not null and discount_percent is null)
  ),
  -- 'repeating' without a month count is Stripe-invalid and would fail at session creation.
  constraint promo_duration_coherent check (
    (duration = 'repeating' and duration_in_months is not null) or
    (duration <> 'repeating' and duration_in_months is null)
  ),
  constraint promo_window_coherent check (starts_at is null or expires_at is null or expires_at > starts_at)
);

comment on column public.promotion_campaigns.applicable_plans is
  'Internal market_plan values, NOT customer-facing names. FOUNDING3 is {grower} = customer-facing "Pro". Empty = all plans.';

-- ---------------------------------------------------------------------------
-- 2. Redemptions
-- ---------------------------------------------------------------------------
-- One row per accepted redemption. This is the durable record the reporting reads and the
-- duplicate check consults, so it is written by the webhook when Stripe confirms — not
-- optimistically at checkout, which would let an abandoned session burn a redemption.
create table if not exists public.promotion_redemptions (
  id                    uuid primary key default gen_random_uuid(),
  campaign_id           uuid not null references public.promotion_campaigns (id) on delete restrict,
  user_id               uuid not null references auth.users (id) on delete cascade,
  market_id             uuid references public.markets (id) on delete set null,
  plan                  public.market_plan,

  -- The idempotency anchor. A replayed webhook carries the same session id and loses the insert.
  stripe_session_id     text unique,
  stripe_subscription_id text,
  stripe_customer_id    text,

  status                text not null default 'redeemed'
                          check (status in ('redeemed','converted','cancelled','refunded')),
  amount_discounted_cents int,
  redeemed_at           timestamptz not null default now(),
  -- Set when the first non-promotional invoice is paid: the conversion signal the campaign
  -- reporting is actually for.
  converted_at          timestamptz,
  cancelled_at          timestamptz
);

create index if not exists promo_redemptions_campaign_idx on public.promotion_redemptions (campaign_id, status);
create index if not exists promo_redemptions_user_idx     on public.promotion_redemptions (user_id, campaign_id);

-- ---------------------------------------------------------------------------
-- 3. Validation — the single gate every checkout must pass through
-- ---------------------------------------------------------------------------
-- Returns a decision plus a machine-readable reason, rather than raising: billing-checkout needs to
-- tell the seller WHY a code was refused, and an exception would collapse eight distinct refusals
-- into one 500.
--
-- Counting redemptions here rather than trusting a stored counter means a cancelled or refunded
-- redemption frees its slot automatically, and there is no counter to drift.
create or replace function public.promo_validate(
  p_code text,
  p_plan public.market_plan,
  p_user uuid
)
returns table (
  ok            boolean,
  reason        text,
  campaign_id   uuid,
  campaign_name text,
  stripe_promotion_code_id text
)
language plpgsql stable security definer set search_path = public
as $$
declare
  c public.promotion_campaigns;
  used_total int;
  used_user  int;
  has_sub    boolean;
begin
  ok := false; campaign_id := null; campaign_name := null; stripe_promotion_code_id := null;

  if p_code is null or btrim(p_code) = '' then
    reason := 'NO_CODE'; return next; return;
  end if;

  select * into c from public.promotion_campaigns
   where code = upper(btrim(p_code));

  if not found then
    -- Deliberately the same reason as inactive: a probing client should not be able to enumerate
    -- which codes exist by comparing error messages.
    reason := 'INVALID_CODE'; return next; return;
  end if;

  campaign_id := c.id; campaign_name := c.campaign_name;

  if not c.active then
    reason := 'INVALID_CODE'; return next; return;
  end if;
  if c.starts_at is not null and now() < c.starts_at then
    reason := 'NOT_STARTED'; return next; return;
  end if;
  if c.expires_at is not null and now() >= c.expires_at then
    reason := 'EXPIRED'; return next; return;
  end if;

  -- Plan eligibility. This is the check Stripe cannot make.
  if array_length(c.applicable_plans, 1) is not null
     and not (p_plan = any (c.applicable_plans)) then
    reason := 'WRONG_PLAN'; return next; return;
  end if;

  if c.max_redemptions is not null then
    select count(*)::int into used_total from public.promotion_redemptions r
     where r.campaign_id = c.id and r.status in ('redeemed','converted');
    if used_total >= c.max_redemptions then
      reason := 'FULLY_REDEEMED'; return next; return;
    end if;
  end if;

  select count(*)::int into used_user from public.promotion_redemptions r
   where r.campaign_id = c.id and r.user_id = p_user and r.status in ('redeemed','converted');
  if used_user >= c.max_redemptions_per_user then
    reason := 'ALREADY_REDEEMED'; return next; return;
  end if;

  if c.new_customers_only then
    select exists (
      select 1 from public.market_subscriptions ms
       join public.markets m on m.id = ms.market_id
      where m.owner_id = p_user and ms.kind = 'plan'
        and ms.status in ('active','trialing','past_due','canceled','cancelled')
    ) into has_sub;
    if has_sub then
      reason := 'NOT_NEW_CUSTOMER'; return next; return;
    end if;
  end if;

  stripe_promotion_code_id := c.stripe_promotion_code_id;
  if stripe_promotion_code_id is null then
    -- Eligible in Gnome but unusable at Stripe. Refuse rather than silently charging full price.
    reason := 'NOT_CONFIGURED'; return next; return;
  end if;

  ok := true; reason := 'OK'; return next;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Does this seller actually need to pay?
-- ---------------------------------------------------------------------------
-- Guards against charging someone who still has free allowance. A client could otherwise call
-- checkout directly and be billed $0.99 for something they were entitled to; the refusal below is
-- as much a consumer-protection check as a security one.
--
-- Also resolves publish-vs-renewal server-side using the same rule the 0104 trigger uses — the
-- listing's own history — so the client cannot claim "renewal" to reach a different allowance.
create or replace function public.listing_overage_required(
  p_market uuid,
  p_listing uuid default null
)
returns table (required boolean, intent text, reason text, product_key text)
language plpgsql stable security definer set search_path = public
as $$
declare
  u     record;
  v_kind text;
begin
  select * into u from public.market_allowance_usage(p_market);
  if u.plan is null then
    required := false; intent := null; reason := 'NO_MARKET'; product_key := null; return next; return;
  end if;

  v_kind := case
    when p_listing is not null and exists (
      select 1 from public.listing_publish_events e
       where e.listing_id = p_listing and e.kind = 'publish')
    then 'renewal' else 'publish' end;
  intent := v_kind;
  product_key := case when v_kind = 'renewal' then 'GNOME_LISTING_RENEWAL' else 'GNOME_LISTING_PUBLISH' end;

  if v_kind = 'publish' then
    if u.publishes_allowed is null then
      required := false; reason := 'UNLIMITED'; return next; return;
    end if;
    if u.publishes_remaining > 0 then
      required := false; reason := 'ALLOWANCE_REMAINING'; return next; return;
    end if;
  else
    if u.renewals_allowed is null then
      required := false; reason := 'UNLIMITED'; return next; return;
    end if;
    if u.renewals_remaining > 0 then
      required := false; reason := 'ALLOWANCE_REMAINING'; return next; return;
    end if;
  end if;

  -- Already paid and not yet spent: send them back to publishing, not to Stripe again. This is what
  -- stops a double purchase when a seller returns from a completed checkout and retries.
  if exists (
    select 1 from public.listing_publish_authorizations a
     where a.market_id = p_market and a.intent = v_kind and a.status = 'paid'
       and (a.listing_id is null or a.listing_id = p_listing)
  ) then
    required := false; reason := 'ALREADY_AUTHORIZED'; return next; return;
  end if;

  required := true; reason := 'ALLOWANCE_EXHAUSTED'; return next;
end $$;

-- The seller's own view of the above, pinned to their market.
create or replace function public.my_overage_required(p_listing uuid default null)
returns table (required boolean, intent text, reason text, product_key text)
language plpgsql stable security definer set search_path = public
as $$
declare m uuid;
begin
  select id into m from public.markets where owner_id = auth.uid() limit 1;
  if m is null then return; end if;
  return query select * from public.listing_overage_required(m, p_listing);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Authorization lifecycle
-- ---------------------------------------------------------------------------
-- Creating the pending row at checkout time, keyed on the Stripe session, is what makes a delayed
-- webhook safe: the row already exists when Stripe confirms, so confirmation is an UPDATE of a
-- known row rather than an INSERT that might race a retry.
create or replace function public.create_publish_authorization(
  p_market uuid, p_intent text, p_listing uuid, p_session text, p_amount_cents int
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if p_intent not in ('publish','renewal') then
    raise exception 'BAD_INTENT' using errcode = 'P0001';
  end if;

  insert into public.listing_publish_authorizations
    (market_id, listing_id, intent, amount_cents, stripe_session_id, status)
  values (p_market, p_listing, p_intent, p_amount_cents, p_session, 'pending')
  on conflict (stripe_session_id) do update set market_id = excluded.market_id
  returning id into v_id;
  return v_id;
end $$;

-- Called by the webhook on checkout.session.completed. Idempotent by construction: the WHERE clause
-- only matches a row still pending, so a replay updates nothing and reports false.
create or replace function public.mark_authorization_paid(
  p_session text, p_payment_intent text default null
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  update public.listing_publish_authorizations
     set status = 'paid', paid_at = now(),
         stripe_payment_intent_id = coalesce(p_payment_intent, stripe_payment_intent_id)
   where stripe_session_id = p_session and status = 'pending';
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Redemption recording (webhook)
-- ---------------------------------------------------------------------------
create or replace function public.record_promo_redemption(
  p_campaign uuid, p_user uuid, p_market uuid, p_plan public.market_plan,
  p_session text, p_subscription text, p_customer text, p_discount_cents int
)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.promotion_redemptions
    (campaign_id, user_id, market_id, plan, stripe_session_id,
     stripe_subscription_id, stripe_customer_id, amount_discounted_cents)
  values (p_campaign, p_user, p_market, p_plan, p_session, p_subscription, p_customer, p_discount_cents)
  on conflict (stripe_session_id) do nothing;
  return found;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Admin surface
-- ---------------------------------------------------------------------------
-- Never returns stripe ids to a client; the admin app has no use for them and they are the one
-- field that would let a console leak the discount mechanics.
create or replace function public.admin_promo_campaigns()
returns table (
  id uuid, code text, campaign_name text, active boolean,
  applicable_plans public.market_plan[], discount_type text,
  discount_percent numeric, discount_amount_cents int,
  duration text, duration_in_months int,
  starts_at timestamptz, expires_at timestamptz,
  max_redemptions int, max_redemptions_per_user int, new_customers_only boolean,
  redeemed int, converted int, cancelled int,
  revenue_after_promo_cents bigint,
  configured boolean, internal_notes text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = 'P0001'; end if;
  return query
    select c.id, c.code, c.campaign_name, c.active, c.applicable_plans, c.discount_type,
           c.discount_percent, c.discount_amount_cents, c.duration, c.duration_in_months,
           c.starts_at, c.expires_at, c.max_redemptions, c.max_redemptions_per_user,
           c.new_customers_only,
           count(r.*) filter (where r.status in ('redeemed','converted'))::int,
           count(r.*) filter (where r.status = 'converted')::int,
           count(r.*) filter (where r.status = 'cancelled')::int,
           coalesce(sum(r.amount_discounted_cents) filter (where r.status = 'converted'), 0)::bigint,
           c.stripe_promotion_code_id is not null,
           c.internal_notes, c.created_at
      from public.promotion_campaigns c
      left join public.promotion_redemptions r on r.campaign_id = c.id
     group by c.id
     order by c.created_at desc;
end $$;

create or replace function public.admin_promo_redemptions(p_campaign uuid)
returns table (
  user_id uuid, email text, market_id uuid, plan public.market_plan,
  status text, redeemed_at timestamptz, converted_at timestamptz, cancelled_at timestamptz,
  amount_discounted_cents int
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = 'P0001'; end if;
  return query
    select r.user_id, au.email::text, r.market_id, r.plan, r.status,
           r.redeemed_at, r.converted_at, r.cancelled_at, r.amount_discounted_cents
      from public.promotion_redemptions r
      left join auth.users au on au.id = r.user_id
     where r.campaign_id = p_campaign
     order by r.redeemed_at desc;
end $$;

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

  -- admin_audit_log, not admin_actions: 0094 made the former the append-only convention, and its
  -- columns are actor_id/resource_type/resource_id — the older table's admin_id/target_* shape is
  -- a different table with a confusingly similar purpose.
  insert into public.admin_audit_log (actor_id, actor_type, action, resource_type, resource_id, new_state)
  values (auth.uid(), 'admin', 'promo_campaign_upsert', 'promotion_campaign', v_id::text, p_payload);

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Security
-- ---------------------------------------------------------------------------
-- Campaign configuration is admin-only and redemption history is nobody's business but the
-- admin's. A seller never reads these tables directly — they learn a code is valid only by the
-- accept/refuse answer billing-checkout gives them, which is also why promo_validate returns the
-- same INVALID_CODE for missing and inactive codes: comparing error messages must not enumerate
-- which campaigns exist.
alter table public.promotion_campaigns   enable row level security;
alter table public.promotion_redemptions enable row level security;

drop policy if exists promo_campaigns_admin on public.promotion_campaigns;
create policy promo_campaigns_admin on public.promotion_campaigns
  for select using (public.is_admin());

drop policy if exists promo_redemptions_admin on public.promotion_redemptions;
create policy promo_redemptions_admin on public.promotion_redemptions
  for select using (public.is_admin());
drop policy if exists promo_redemptions_own on public.promotion_redemptions;
create policy promo_redemptions_own on public.promotion_redemptions
  for select using (user_id = auth.uid());

revoke all on public.promotion_campaigns   from anon, authenticated;
revoke all on public.promotion_redemptions from anon, authenticated;
grant select on public.promotion_redemptions to authenticated;

-- promo_validate is deliberately NOT callable by a client. Letting a seller call it directly turns
-- it into an oracle for brute-forcing codes; billing-checkout calls it with service_role after it
-- has established who the caller is.
revoke execute on function public.promo_validate(text, public.market_plan, uuid) from public, anon, authenticated;
revoke execute on function public.listing_overage_required(uuid, uuid)          from public, anon;
revoke execute on function public.create_publish_authorization(uuid, text, uuid, text, int) from public, anon, authenticated;
revoke execute on function public.mark_authorization_paid(text, text)           from public, anon, authenticated;
revoke execute on function public.record_promo_redemption(uuid, uuid, uuid, public.market_plan, text, text, text, int) from public, anon, authenticated;
revoke execute on function public.admin_promo_campaigns()                       from public, anon;
revoke execute on function public.admin_promo_redemptions(uuid)                 from public, anon;
revoke execute on function public.admin_upsert_promo_campaign(jsonb)            from public, anon;

grant execute on function public.my_overage_required(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. FOUNDING3 — the first campaign, seeded as data
-- ---------------------------------------------------------------------------
-- applicable_plans is {grower}: customer-facing Pro. Max is `farm` and Farm is `sponsor`, and
-- neither is listed, so promo_validate answers WRONG_PLAN for both.
--
-- The Stripe promotion code id is left NULL here and populated per mode from the setup script's
-- output, because the same migration runs against test and live.
insert into public.promotion_campaigns
  (code, campaign_name, active, applicable_plans, discount_type, discount_percent,
   duration, duration_in_months, max_redemptions_per_user, new_customers_only, internal_notes)
values
  ('FOUNDING3', 'Founding Seller — first 3 months free', true, array['grower']::public.market_plan[],
   'percent', 100, 'repeating', 3, 1, false,
   'Distributed directly to selected early sellers; deliberately not advertised in the Gnome UI.')
on conflict (code) do nothing;

notify pgrst, 'reload schema';
