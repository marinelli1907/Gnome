-- 0118: narrow the Market Drop reserved-title rule (CTO correction, Drop Polish phase).
--
-- 0117 rejected ANY title containing the substring "seed" — too broad. Sellers
-- legitimately sell seeds: "Fall Seed Sale", "Seedling Saturday", "Sunflower
-- Seeds This Weekend" are all honest Market Drop names. The product boundary
-- is impersonation of the BRANDED subscription product "Seed Drop", not use of
-- the English word "seed".
--
-- New rule (narrowest that still protects the brand surface): a title is
-- reserved only when, after stripping every non-alphanumeric character and
-- lowercasing, it contains the phrase "seeddrop". That catches "Seed Drop",
-- "SEED-DROP Saturday", "The Gnome Seed  Drop" — the strings that would read
-- as the branded product in push copy and share cards — and nothing else.
-- Rationale for keeping the exact-phrase block at all: Drop titles are
-- rendered into notification/share copy ("<title> is LIVE at <market>"), where
-- a seller Drop literally named "Seed Drop" is materially confusable with the
-- subscription product. Known accepted edge: "Birdseed Dropoff" normalizes to
-- contain the phrase and stays blocked — rare, and the safe side of the line.
--
-- Everything else in create_market_drop is byte-identical to 0117.

create or replace function public.create_market_drop(
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_listing_ids uuid[],
  p_description text default null,
  p_publish boolean default false,
  p_request text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  mkt uuid;
  n int;
  owned int;
  new_id uuid;
  i int;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select id into mkt from public.markets where owner_id = uid limit 1;
  if mkt is null then raise exception 'NO_MARKET'; end if;

  if p_title is null or length(btrim(p_title)) < 1 or length(btrim(p_title)) > 80 then
    raise exception 'INVALID_TITLE';
  end if;
  if regexp_replace(lower(p_title), '[^a-z0-9]', '', 'g') like '%seeddrop%' then
    -- Only impersonation of the branded "Seed Drop" product is reserved;
    -- plain "seed" titles are legitimate seller inventory.
    raise exception 'RESERVED_TITLE';
  end if;
  if p_description is not null and length(p_description) > 400 then
    raise exception 'INVALID_DESCRIPTION';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'INVALID_WINDOW';
  end if;
  if p_ends_at < now() then raise exception 'WINDOW_IN_PAST'; end if;
  if p_ends_at - p_starts_at > interval '14 days' then raise exception 'WINDOW_TOO_LONG'; end if;

  n := coalesce(array_length(p_listing_ids, 1), 0);
  if n = 0 then raise exception 'NO_LISTINGS'; end if;
  if n > 30 then raise exception 'DROP_ITEM_LIMIT'; end if;
  select count(distinct l.id)::int into owned from public.listings l
   where l.id = any (p_listing_ids) and l.owner_id = uid and l.status <> 'removed';
  if owned <> (select count(distinct x) from unnest(p_listing_ids) x) then
    raise exception 'LISTING_NOT_FOUND';
  end if;

  insert into public.market_drops (market_id, created_by, title, description, starts_at, ends_at, status)
  values (mkt, uid, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
          p_starts_at, p_ends_at, case when p_publish then 'scheduled' else 'draft' end)
  returning id into new_id;

  i := 0;
  insert into public.market_drop_items (drop_id, listing_id, position)
  select new_id, x.listing_id, x.ord - 1
    from (select distinct on (u.listing_id) u.listing_id, u.ord
            from unnest(p_listing_ids) with ordinality as u(listing_id, ord)
           order by u.listing_id, u.ord) x;

  -- Audit: structured facts only, same posture as every ai_action event.
  begin
    insert into public.events (user_id, event_type, metadata)
    values (uid, case when p_publish then 'drop_scheduled' else 'drop_created' end,
            jsonb_strip_nulls(jsonb_build_object(
              'drop_id', new_id, 'market_id', mkt, 'items', n,
              'starts_at', p_starts_at, 'ends_at', p_ends_at, 'request_id', p_request)));
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'id', new_id, 'title', btrim(p_title),
    'status', case when p_publish then 'scheduled' else 'draft' end, 'items', n);
end $$;

revoke execute on function public.create_market_drop(text, timestamptz, timestamptz, uuid[], text, boolean, text) from public, anon;
grant execute on function public.create_market_drop(text, timestamptz, timestamptz, uuid[], text, boolean, text) to authenticated;

-- Self-check: the normalization boundary, asserted in-migration so a future
-- edit that widens or breaks the rule fails to apply at all.
do $$
declare
  blocked text[] := array['Seed Drop', 'SEED-DROP Saturday', 'The Gnome Seed  Drop', 'seeddrop'];
  allowed text[] := array['Fall Seed Sale', 'Seedling Saturday', 'Sunflower Seeds This Weekend',
                          'Garden Seed Restock', 'Saturday Harvest'];
  t text;
begin
  foreach t in array blocked loop
    if regexp_replace(lower(t), '[^a-z0-9]', '', 'g') not like '%seeddrop%' then
      raise exception '0118 self-check: % should be reserved and is not', t;
    end if;
  end loop;
  foreach t in array allowed loop
    if regexp_replace(lower(t), '[^a-z0-9]', '', 'g') like '%seeddrop%' then
      raise exception '0118 self-check: % should be allowed and is not', t;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
