-- 0085: structured request options for Wanted + Plot listings.
--
-- Wanted listings: the poster may optionally list acceptable variants
-- ("Pie pumpkins", "Any variety"). Plot listings: the grower may list the
-- crops they're willing to grow. Both are the SAME shape — a small list of
-- choices attached to the listing — so they share one column:
--   listings.request_options  jsonb  [{ "node_id": uuid|null, "label": text }]
--   listings.allow_custom_request  boolean  (plots/wanted: allow "Something else")
-- A responder's structured choice lands on their claim:
--   claims.selected_option_label / selected_taxonomy_node_id / is_custom_option
--
-- Backward compatible: request_options NULL → the existing free-text flow.
-- Security: only the LISTING OWNER edits request_options (existing listings
-- RLS already restricts UPDATE to owner). A responder's selection is validated
-- server-side against the listing's options; taxonomy ids must be real+active;
-- custom text is ordinary untrusted input. No RLS changed.

alter table public.listings
  add column if not exists request_options jsonb,
  add column if not exists allow_custom_request boolean not null default true;

alter table public.claims
  add column if not exists selected_option_label text,
  add column if not exists selected_taxonomy_node_id uuid references public.marketplace_taxonomy_nodes(id),
  add column if not exists is_custom_option boolean not null default false;

-- ---- validate the OWNER's option list (taxonomy ids real+active, sane size)
create or replace function public.validate_request_options()
returns trigger language plpgsql security definer set search_path = public as $$
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

drop trigger if exists validate_request_options on public.listings;
create trigger validate_request_options
  before insert or update of request_options on public.listings
  for each row execute function public.validate_request_options();

-- ---- validate the RESPONDER's structured choice against the listing
create or replace function public.validate_claim_option()
returns trigger language plpgsql security definer set search_path = public as $$
declare l public.listings; v_match boolean;
begin
  -- Nothing structured provided → legacy free-text path, allow.
  if new.selected_option_label is null and new.selected_taxonomy_node_id is null
     and not new.is_custom_option then
    return new;
  end if;
  select * into l from public.listings where id = new.listing_id;
  if l is null then return new; end if;

  -- taxonomy id (if provided) must be real + active
  if new.selected_taxonomy_node_id is not null
     and not exists (select 1 from public.marketplace_taxonomy_nodes
                     where id = new.selected_taxonomy_node_id and active) then
    raise exception 'CLAIM_TAXONOMY_INVALID' using errcode='P0001';
  end if;

  -- "Something else" is only allowed when the listing permits custom requests
  if new.is_custom_option then
    if l.request_options is not null and not coalesce(l.allow_custom_request, true) then
      raise exception 'CUSTOM_REQUEST_NOT_ALLOWED' using errcode='P0001';
    end if;
    return new;
  end if;

  -- A named option must be one the listing actually offers (match by node id,
  -- else by case-insensitive label).
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

drop trigger if exists validate_claim_option on public.claims;
create trigger validate_claim_option
  before insert or update of selected_option_label, selected_taxonomy_node_id, is_custom_option on public.claims
  for each row execute function public.validate_claim_option();

notify pgrst, 'reload schema';
