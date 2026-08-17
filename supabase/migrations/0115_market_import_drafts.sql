-- 0115: turn an approved market-import extraction into normal listing drafts, safely.
--
-- create_import_drafts(p_import_id, p_candidates) is the trusted middle of the import flow:
--
--   AI extraction (market-import, writes nothing)
--     → seller reviews and SELECTS candidates
--       → this function validates everything AGAIN and creates listing_drafts rows
--         → the existing review/edit/publish flow takes over, unchanged.
--
-- The security model carries straight over from the extraction contract:
--   * the caller's identity comes from auth.uid(); the seller's own Market is resolved here —
--     there is no owner or market parameter to abuse;
--   * candidates are strict field bags: unknown keys (taxonomy_node_id, owner_id,
--     publish_immediately, …) are REJECTED, not ignored — client data is untrusted even when it
--     started life in Gnome's own AI function;
--   * taxonomy is mapped server-side against the real tree; an uncertain mapping produces a
--     draft with no node (seller picks the category in review) rather than a confident wrong one;
--   * drafts consume ZERO publish allowance — that is the point: a Free seller can import an
--     entire 17-product stand today and decide which 3 to publish. Publication still runs the
--     untouched canonical gate (publish_listing_draft → listings INSERT → allowance, screening,
--     compliance, suspension triggers).
--
-- Idempotency: (owner_id, import_request_id, import_candidate_index) is UNIQUE; re-submitting
-- the same approved batch — double-tap, mobile timeout retry, concurrent duplicate — inserts
-- nothing new and reports what already exists. Validation failures raise BEFORE any insert, so
-- a batch either lands whole or not at all.

alter table public.listing_drafts
  add column if not exists import_request_id     uuid,
  add column if not exists import_candidate_index integer,
  add column if not exists duplicate_listing_id  uuid references public.listings(id) on delete set null,
  add column if not exists import_meta           jsonb;

comment on column public.listing_drafts.import_request_id is
  'market-import extraction request this draft came from; pairs with import_candidate_index for idempotency.';
comment on column public.listing_drafts.duplicate_listing_id is
  'A listing already in the seller''s Market that looks like the same product — advisory, for the review UI to offer "update existing" instead of a silent duplicate.';
comment on column public.listing_drafts.import_meta is
  'Small validated bag from the extraction (availability, pickup, location_text, seller_notes, per-field confidence). Never the raw AI response.';

create unique index if not exists listing_drafts_import_idem_idx
  on public.listing_drafts (owner_id, import_request_id, import_candidate_index)
  where import_request_id is not null;

create or replace function public.create_import_drafts(p_import_id uuid, p_candidates jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  uid          uuid := auth.uid();
  mkt          uuid;
  n            int;
  i            int;
  c            jsonb;
  k            text;
  -- per-candidate validated values
  v_name       text;
  v_variety    text;
  v_type       text;
  v_price      int;
  v_unit       text;
  v_terms      text[];
  best_node    uuid;
  best_path    text;
  best_score   int;
  dup_id       uuid;
  created_ids  uuid[] := '{}';
  results      jsonb := '[]'::jsonb;
  dup_notes    jsonb := '[]'::jsonb;
  n_created    int := 0;
  n_existing   int := 0;
  pending_cnt  int;
  usage        record;
  sale_selected int := 0;
  allowed_keys constant text[] := array[
    'product_name','variety','category_terms','listing_type','price_cents','unit','quantity',
    'availability','pickup','location_text','description','seller_notes',
    'compliance_attention_required'];
  allowed_units constant text[] := array[
    'lb','oz','each','bunch','dozen','half-dozen','jar','basket','pint','quart',
    'bag','loaf','head','ear','peck','half-peck','bushel','half-bushel','flat','stem',''];
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_import_id is null then raise exception 'IMPORT_ID_REQUIRED'; end if;

  -- The seller's OWN Market, resolved here. No parameter exists to point elsewhere.
  select id into mkt from public.markets where owner_id = uid limit 1;
  if mkt is null then raise exception 'NO_MARKET' using hint = 'Post once to create your Market first.'; end if;

  -- Anti-abuse: drafts are free, storage is not infinite. 40 per request (the extraction
  -- contract's own ceiling) and a pending-import backlog cap well above honest use.
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'BAD_CANDIDATES' using hint = 'candidates must be an array';
  end if;
  n := jsonb_array_length(p_candidates);
  if n = 0 then raise exception 'NO_CANDIDATES'; end if;
  if n > 40 then raise exception 'TOO_MANY_CANDIDATES' using hint = format('%s > 40', n); end if;

  select count(*)::int into pending_cnt from public.listing_drafts
   where owner_id = uid and status = 'pending' and source = 'market_import';
  if pending_cnt + n > 200 then
    raise exception 'IMPORT_DRAFTS_LIMIT'
      using hint = 'Too many pending imported drafts — publish or discard some first.';
  end if;

  -- ---- PASS 1: validate every candidate before anything is written --------
  for i in 0 .. n - 1 loop
    c := p_candidates -> i;
    if jsonb_typeof(c) <> 'object' then
      raise exception 'BAD_CANDIDATE' using hint = format('candidates[%s] is not an object', i);
    end if;
    for k in select jsonb_object_keys(c) loop
      if not (k = any (allowed_keys)) then
        raise exception 'UNKNOWN_FIELD' using hint = format('candidates[%s].%s', i, k);
      end if;
    end loop;

    v_name := nullif(btrim(coalesce(c ->> 'product_name', '')), '');
    if v_name is null or length(v_name) > 80 then
      raise exception 'BAD_PRODUCT_NAME' using hint = format('candidates[%s]', i);
    end if;

    v_type := coalesce(c ->> 'listing_type', 'sale');
    if v_type not in ('sale', 'free', 'trade', 'wanted') then
      raise exception 'BAD_LISTING_TYPE' using hint = format('candidates[%s]: %s', i, v_type);
    end if;

    if c ? 'price_cents' and jsonb_typeof(c -> 'price_cents') <> 'null' then
      if jsonb_typeof(c -> 'price_cents') <> 'number' then
        raise exception 'BAD_PRICE' using hint = format('candidates[%s]', i);
      end if;
      v_price := (c ->> 'price_cents')::numeric::int;
      if (c ->> 'price_cents')::numeric <> v_price or v_price < 0 or v_price > 100000 then
        raise exception 'BAD_PRICE' using hint = format('candidates[%s]', i);
      end if;
    end if;

    v_unit := lower(btrim(coalesce(c ->> 'unit', '')));
    if not (v_unit = any (allowed_units)) then
      raise exception 'BAD_UNIT' using hint = format('candidates[%s]: %s', i, v_unit);
    end if;

    if length(coalesce(c ->> 'variety', '')) > 80
       or length(coalesce(c ->> 'quantity', '')) > 160
       or length(coalesce(c ->> 'availability', '')) > 160
       or length(coalesce(c ->> 'pickup', '')) > 160
       or length(coalesce(c ->> 'location_text', '')) > 160
       or length(coalesce(c ->> 'description', '')) > 600
       or length(coalesce(c ->> 'seller_notes', '')) > 600 then
      raise exception 'FIELD_TOO_LONG' using hint = format('candidates[%s]', i);
    end if;
    if c ? 'compliance_attention_required'
       and jsonb_typeof(c -> 'compliance_attention_required') not in ('boolean', 'null') then
      raise exception 'BAD_COMPLIANCE_FLAG' using hint = format('candidates[%s]', i);
    end if;
    if c ? 'category_terms' and jsonb_typeof(c -> 'category_terms') not in ('array', 'null') then
      raise exception 'BAD_CATEGORY_TERMS' using hint = format('candidates[%s]', i);
    end if;
  end loop;

  -- ---- PASS 2: map taxonomy, flag duplicates, insert ----------------------
  for i in 0 .. n - 1 loop
    c := p_candidates -> i;
    v_name    := btrim(c ->> 'product_name');
    v_variety := btrim(coalesce(c ->> 'variety', ''));
    v_type    := coalesce(c ->> 'listing_type', 'sale');
    v_price   := case when c ? 'price_cents' and jsonb_typeof(c -> 'price_cents') = 'number'
                      then (c ->> 'price_cents')::numeric::int end;
    v_unit    := lower(btrim(coalesce(c ->> 'unit', '')));
    if v_type = 'sale' then sale_selected := sale_selected + 1; end if;

    -- Search terms: the candidate's own words. The MODEL never supplies node ids.
    select coalesce(array_agg(lower(t)), '{}') into v_terms
      from (
        select v_name as t
        union all select v_variety where v_variety <> ''
        union all select btrim(x.value) from jsonb_array_elements_text(coalesce(c -> 'category_terms', '[]'::jsonb)) x
                   where btrim(x.value) <> '' limit 8
      ) s where t is not null and t <> '';

    -- Best node by the same scoring the vision functions use: exact hit 3, substring 1.
    -- Only an EXACT hit (score >= 3) earns a stored node; anything weaker leaves the node
    -- NULL and the category for the seller to confirm in review.
    select n2.id, n2.path, n2.score into best_node, best_path, best_score
      from (
        select tn.id, tn.path,
               (select coalesce(sum(case
                   when lower(tn.name) = term or term = any (select lower(s2) from unnest(coalesce(tn.search_synonyms, '{}')) s2)
                     then 3
                   when lower(tn.name) like '%' || term || '%'
                     or exists (select 1 from unnest(coalesce(tn.search_synonyms, '{}')) s3
                                 where lower(s3) like '%' || term || '%' or term like '%' || lower(s3) || '%')
                     then 1
                   else 0 end), 0)
                  from unnest(v_terms) term)::int as score
          from public.marketplace_taxonomy_nodes tn
         where tn.active
      ) n2
     where n2.score > 0
     order by n2.score desc
     limit 1;

    if best_score is null or best_score < 3 then
      best_node := null;
    end if;

    -- V1 duplicate signal: same Market, live-ish listing, same normalized name — or the same
    -- taxonomy node when the variety does not tell them apart. Advisory only; nothing is
    -- overwritten and nothing is skipped.
    select l.id into dup_id
      from public.listings l
     where l.market_id = mkt
       and l.status in ('active', 'paused')
       and ( lower(btrim(l.title)) = lower(v_name)
             or ( best_node is not null and l.taxonomy_node_id = best_node
                  and (v_variety = '' or position(lower(v_variety) in lower(coalesce(l.title, ''))) > 0) ) )
     order by l.created_at desc
     limit 1;

    insert into public.listing_drafts (
      owner_id, market_id, batch_id, source, status,
      title, description, category, taxonomy_node_id, listing_type,
      price_cents, unit, quantity, photos,
      ai_candidate_name, compliance_attention,
      import_request_id, import_candidate_index, duplicate_listing_id, import_meta
    ) values (
      uid, mkt, p_import_id, 'market_import', 'pending',
      v_name,
      nullif(btrim(coalesce(c ->> 'description', '')), ''),
      case when best_path is not null and best_score >= 3 then split_part(best_path, '/', 1) end,
      best_node, v_type::listing_type,
      case when v_type = 'sale' then v_price end,
      nullif(v_unit, ''), nullif(btrim(coalesce(c ->> 'quantity', '')), ''),
      '{}',                                       -- NEVER the source screenshot: listing photos
                                                  -- are a separate, seller-chosen concept.
      case when v_variety <> '' then v_name || ' (' || v_variety || ')' else v_name end,
      coalesce((c ->> 'compliance_attention_required')::boolean, false),
      p_import_id, i, dup_id,
      jsonb_strip_nulls(jsonb_build_object(
        'variety',       nullif(v_variety, ''),
        'availability',  nullif(btrim(coalesce(c ->> 'availability', '')), ''),
        'pickup',        nullif(btrim(coalesce(c ->> 'pickup', '')), ''),
        'location_text', nullif(btrim(coalesce(c ->> 'location_text', '')), ''),
        'seller_notes',  nullif(btrim(coalesce(c ->> 'seller_notes', '')), '')))
    )
    on conflict (owner_id, import_request_id, import_candidate_index) where import_request_id is not null
    do nothing;

    if found then
      n_created := n_created + 1;
    else
      n_existing := n_existing + 1;
    end if;

    if dup_id is not null then
      dup_notes := dup_notes || jsonb_build_object(
        'candidate_index', i, 'product_name', v_name, 'existing_listing_id', dup_id);
    end if;
    best_node := null; best_path := null; best_score := null; dup_id := null; v_price := null;
  end loop;

  -- Plan-aware answer for the UI: how the selected Sell drafts compare to the allowance.
  -- Informational only — nothing here blocks or reserves anything.
  select * into usage from public.market_allowance_usage(mkt);

  -- Best-effort analytics: one event row answers "how is import converting" without a new
  -- system. A missing profile row or similar must never fail the seller's draft creation.
  begin
    insert into public.events (user_id, event_type, metadata) values (uid, 'market_import_drafts', jsonb_build_object(
      'import_request_id', p_import_id, 'candidates', n, 'created', n_created,
      'already_existed', n_existing, 'duplicates_flagged', jsonb_array_length(dup_notes),
      'plan', usage.plan));
  exception when others then null;
  end;

  return jsonb_build_object(
    'import_request_id', p_import_id,
    'candidates', n,
    'drafts_created', n_created,
    'drafts_already_existed', n_existing,
    'draft_ids', (select coalesce(jsonb_agg(d.id order by d.import_candidate_index), '[]'::jsonb)
                    from public.listing_drafts d
                   where d.owner_id = uid and d.import_request_id = p_import_id),
    'duplicates', dup_notes,
    'allowance', jsonb_build_object(
      'plan', usage.plan,
      'publishes_allowed', usage.publishes_allowed,
      'publishes_used', usage.publishes_used,
      'publishes_remaining', usage.publishes_remaining,
      'sale_candidates_selected', sale_selected,
      'exceeds_included_allowance',
        usage.publishes_remaining is not null and sale_selected > usage.publishes_remaining));
end;
$$;

revoke all on function public.create_import_drafts(uuid, jsonb) from public, anon;
grant execute on function public.create_import_drafts(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
