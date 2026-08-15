-- The rate limiter already behaves correctly: it counts only the posting seller's
-- own listings in the last hour, and admins are exempt, so one seller exhausting
-- their allowance cannot affect another and system maintenance costs a seller
-- nothing. Verified against production: seller A was stopped at attempt 21 with
-- the limit at 20, and seller B published straight through.
--
-- What it did not do is tell the seller WHEN they can post again - "try again in
-- a little while" is the kind of message that makes someone retry immediately and
-- get refused again. Compute the actual wait from the oldest listing in the
-- window, since that is the one whose expiry frees a slot.
--
-- This restates listings_screen_content() in full because that is the only way to
-- replace a trigger function. Nothing outside the rate-limit block is changed.

create or replace function public.listings_screen_content() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
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
    return new;   -- owner-only kill switch
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
      new.screening_reason   := 'auto-cleared: seller holds a current clearance';
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

notify pgrst, 'reload schema';
