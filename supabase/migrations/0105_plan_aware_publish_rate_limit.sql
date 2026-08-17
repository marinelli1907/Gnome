-- Gnome — make the hourly publishing limiter plan-aware.
--
-- THE CONFLICT THIS RESOLVES
-- content_screening_config.max_listings_per_hour is a single global ceiling (20) applied to every
-- listing a seller creates. 0104 sells Max on 40 monthly publishes and Farm on unlimited, so the
-- limiter now contradicts the product: a Max seller doing one honest bulk upload is refused at 20
-- with a spam message, having spent only half their entitlement. The limiter was correct when
-- every plan capped active listings at 25; it is wrong now.
--
-- The fix is a ceiling per plan, not the removal of a ceiling. Anti-abuse survives — it just stops
-- being the binding constraint for people who paid for volume.
--
--     Free  10/hour     Pro  30/hour     Max  60/hour     Farm  120/hour
--
-- Max's 60 is deliberately above its 40 monthly publishes so a seller can list a whole month's
-- inventory in one working session, which is the actual complaint. Farm stays unlimited MONTHLY
-- while remaining subject to an hourly abuse ceiling, because "unlimited" was never meant to mean
-- "may script ten thousand rows".
--
-- WHY NON-SELL TYPES KEEP THE OLD GLOBAL LIMIT
-- The new ceilings are expressed in SELL publishes. Scoping the limiter to Sell alone would leave
-- Share Free, Trade and Wanted with NO hourly limit at all, which is a spam regression — those are
-- exactly the free-to-post types an abuser would reach for. So this migration splits the check in
-- two: Sell gets the plan-aware ceiling, everything else keeps the existing global one, counted
-- over its own rows.
--
-- Screening itself is untouched. The prohibited-content match, the compliance-class resolution,
-- the REVIEW downgrade to 'paused', the taxonomy prohibition and the state normalisation are all
-- reproduced verbatim from the deployed definition. Only the rate-limit block above them changes.
--
-- Run after 0104. Idempotent.

alter table public.plan_limits
  add column if not exists max_sale_publishes_per_hour int;

comment on column public.plan_limits.max_sale_publishes_per_hour is
  'Hourly anti-abuse ceiling on Sell publishes. NULL falls back to content_screening_config.max_listings_per_hour. Deliberately set ABOVE the monthly allowance so it never becomes the binding limit for a paying seller.';

update public.plan_limits set max_sale_publishes_per_hour =  10 where plan = 'free';
update public.plan_limits set max_sale_publishes_per_hour =  30 where plan = 'grower';   -- Pro
update public.plan_limits set max_sale_publishes_per_hour =  60 where plan = 'farm';     -- Max
update public.plan_limits set max_sale_publishes_per_hour = 120 where plan = 'sponsor';  -- Farm

-- Guard the invariant that motivated this migration: an hourly ceiling at or below the monthly
-- allowance re-creates the exact contradiction being fixed here.
do $$
declare bad text;
begin
  select string_agg(plan::text, ', ') into bad
  from public.plan_limits
  where monthly_publish_allowance is not null
    and max_sale_publishes_per_hour is not null
    and max_sale_publishes_per_hour < monthly_publish_allowance;
  if bad is not null then
    raise exception
      '0105: plan(s) % have an hourly Sell ceiling below their monthly allowance, so the limiter '
      'would refuse publishes the plan promises. Raise max_sale_publishes_per_hour.', bad;
  end if;
end $$;

create or replace function public.listings_screen_content()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $fn$
declare hit record; blob text; cfg public.content_screening_config; made int;
        v_class text; cls public.compliance_classes; v_state text;
        oldest timestamptz; wait_min int;
        v_plan public.market_plan; cap_hr int;
begin
  select * into cfg from public.content_screening_config where id;

  -- ---- hourly abuse ceiling, now plan-aware for Sell -----------------------
  if tg_op = 'INSERT' and not public.is_admin() then
    if public.listing_type_spends_allowance(new.listing_type) then
      -- Sell: resolve the seller's ceiling, counting only their Sell listings so a busy Share Free
      -- day cannot eat the allowance they paid for.
      if new.market_id is not null then
        select ep.plan into v_plan from public.market_effective_plan(new.market_id) ep;
      end if;
      if v_plan is not null then
        select pl.max_sale_publishes_per_hour into cap_hr
          from public.plan_limits pl where pl.plan = v_plan;
      end if;
      cap_hr := coalesce(cap_hr, cfg.max_listings_per_hour);

      if cap_hr is not null then
        select count(*), min(created_at) into made, oldest from public.listings
         where owner_id = new.owner_id
           and listing_type = 'sale'
           and created_at > now() - interval '1 hour';
        if made >= cap_hr then
          wait_min := greatest(1, ceil(extract(epoch from (oldest + interval '1 hour' - now())) / 60))::int;
          raise exception
            'RATE_LIMITED: You have published % listings in the last hour, which is the most we allow at once. You can publish again in about % minute%.',
            made, wait_min, case when wait_min = 1 then '' else 's' end
            using errcode = 'P0001';
        end if;
      end if;

    elsif cfg.max_listings_per_hour is not null then
      -- Everything else keeps the original global ceiling, counted over its own rows.
      select count(*), min(created_at) into made, oldest from public.listings
       where owner_id = new.owner_id
         and listing_type <> 'sale'
         and created_at > now() - interval '1 hour';
      if made >= cfg.max_listings_per_hour then
        wait_min := greatest(1, ceil(extract(epoch from (oldest + interval '1 hour' - now())) / 60))::int;
        raise exception
          'RATE_LIMITED: You have posted % listings in the last hour, which is the most we allow. You can post again in about % minute%.',
          made, wait_min, case when wait_min = 1 then '' else 's' end
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- ---- screening below is reproduced verbatim from the deployed definition --
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
end $fn$;

notify pgrst, 'reload schema';
