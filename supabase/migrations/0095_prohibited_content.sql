-- 0095 — stop prohibited goods being listed, at the moment of publish.
--
-- What exists today: a compliance FRAMEWORK with nothing in it. The `prohibited`
-- flag on taxonomy nodes is set on zero nodes, `compliance_rules` has zero rows,
-- and nothing reads a listing's title or description. "Homegrown flower, $40,
-- local pickup" posted under Produce goes live, and a neighbor reporting it
-- afterwards is the only control.
--
-- This is the FIRST layer, not a claim that prohibited content is impossible.
-- Reports, admin takedown and user suspension stay exactly as they are; a
-- euphemism with no listed word still gets through, and the test suite asserts
-- that so nobody mistakes this for content moderation.
--
-- FOUR DESIGN DECISIONS, because the naive version of each is wrong:
--
--  1. Two outcomes. BLOCK refuses the write for what Gnome will never carry.
--     REVIEW saves it UNPUBLISHED for a human — right for raw milk, home-canned
--     goods, eggs and alcohol, which are lawful in some states and forms.
--     Blocking everything ambiguous teaches people to reword until it passes.
--
--  2. Word boundaries, never substrings. On a gardening app the naive filter
--     blocks potatoes ("pot"), seaweed ("weed") and a potted basil. Every term
--     matches on a boundary, with simple plural handling, and the suite tests
--     those exact phrases.
--
--  3. Addresses are not product text. "Rifle Range Road" is a street, not a
--     firearm. Address-shaped spans are removed before screening, and pickup
--     instructions are never scanned at all — they are private logistics, not a
--     product description.
--
--  4. Exemptions, because one word can be two products. Hemp is REVIEW as a
--     consumable but hemp ROPE is cordage. Terms carry an exempt_if list so the
--     legitimate phrasing passes without weakening the term itself.

-- ===========================================================================
-- Kill switch + rule storage
-- ===========================================================================
create table if not exists public.content_screening_config (
  id                 boolean primary key default true check (id),
  -- Owner-only. Off means listings write unscreened — an incident lever, not a
  -- setting to leave flipped.
  screening_enabled  boolean not null default true,
  -- Abuse control: how many listings one account may create per hour. Plan
  -- limits already cap ACTIVE listings; this caps the RATE, which is what a
  -- script abuses. NULL disables the check.
  max_listings_per_hour int default 20 check (max_listings_per_hour is null or max_listings_per_hour > 0),
  disabled_reason    text,
  updated_by         uuid references public.profiles(id),
  updated_at         timestamptz not null default now()
);
insert into public.content_screening_config (id) values (true) on conflict (id) do nothing;

create table if not exists public.prohibited_terms (
  id            uuid primary key default gen_random_uuid(),
  term          text not null,
  action        text not null default 'REVIEW' check (action in ('BLOCK','REVIEW')),
  category      text not null,
  rationale     text,
  -- Phrases that mean this term is a different, allowed product.
  -- 'hemp' fires, 'hemp rope' does not.
  exempt_if     text[] not null default '{}',
  is_regex      boolean not null default false,
  active        boolean not null default true,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (term, category)
);
create index if not exists prohibited_terms_active_idx on public.prohibited_terms (active) where active;

comment on table public.prohibited_terms is
  'First-layer screening applied to listing title/description/trade_for at write '
  'time. BLOCK refuses the write; REVIEW holds the listing unpublished for a human. '
  'Not a guarantee — reports and takedown remain the backstop.';

-- ===========================================================================
-- Seeds — Daniel''s classification, 2026-08-13
-- ===========================================================================
insert into public.prohibited_terms (term, action, category, rationale, exempt_if) values
  -- ---- BLOCK: controlled substances -------------------------------------
  ('marijuana','BLOCK','controlled-substance','Federally controlled','{}'),
  ('cannabis','BLOCK','controlled-substance','Federally controlled','{"cannabis seed","cannabis seeds","cannabis plant","cannabis plants"}'),
  ('thc','BLOCK','controlled-substance','Psychoactive cannabinoid','{}'),
  ('delta-8','BLOCK','controlled-substance','Intoxicating cannabinoid','{}'),
  ('delta 8','BLOCK','controlled-substance','Intoxicating cannabinoid','{}'),
  ('delta-9','BLOCK','controlled-substance','Intoxicating cannabinoid','{}'),
  ('delta 9','BLOCK','controlled-substance','Intoxicating cannabinoid','{}'),
  ('edible gummies','BLOCK','controlled-substance','Common THC edible phrasing','{}'),
  ('cocaine','BLOCK','controlled-substance','Illegal controlled drug','{}'),
  ('heroin','BLOCK','controlled-substance','Illegal controlled drug','{}'),
  ('fentanyl','BLOCK','controlled-substance','Illegal controlled drug','{}'),
  ('methamphetamine','BLOCK','controlled-substance','Illegal controlled drug','{}'),
  ('psilocybin','BLOCK','controlled-substance','Illegal controlled drug','{}'),
  ('magic mushroom','BLOCK','controlled-substance','Illegal controlled drug','{}'),
  ('shrooms','BLOCK','controlled-substance','Illegal controlled drug','{}'),
  ('lsd','BLOCK','controlled-substance','Illegal controlled drug','{}'),
  ('mdma','BLOCK','controlled-substance','Illegal controlled drug','{}'),
  ('ketamine','BLOCK','controlled-substance','Illegal controlled drug','{}'),
  ('kratom','BLOCK','controlled-substance','Banned in several states','{}'),

  -- ---- BLOCK: prescription drugs ----------------------------------------
  ('prescription','BLOCK','prescription','Prescription-only medicines cannot be resold','{}'),
  ('adderall','BLOCK','prescription','Prescription-only','{}'),
  ('xanax','BLOCK','prescription','Prescription-only','{}'),
  ('oxycodone','BLOCK','prescription','Prescription-only','{}'),
  ('percocet','BLOCK','prescription','Prescription-only','{}'),
  ('vicodin','BLOCK','prescription','Prescription-only','{}'),
  ('insulin','BLOCK','prescription','Prescription-only','{}'),
  ('ivermectin','BLOCK','prescription','Prescription/veterinary drug','{}'),
  ('amoxicillin','BLOCK','prescription','Prescription-only','{}'),

  -- ---- BLOCK: weapons ----------------------------------------------------
  ('firearm','BLOCK','weapon','Regulated transfer; not carried','{}'),
  ('handgun','BLOCK','weapon','Not carried','{}'),
  ('shotgun','BLOCK','weapon','Not carried','{}'),
  ('rifle','BLOCK','weapon','Not carried','{}'),
  ('ammunition','BLOCK','weapon','Not carried','{}'),
  ('ammo','BLOCK','weapon','Not carried','{}'),
  ('silencer','BLOCK','weapon','Not carried','{}'),
  ('explosive','BLOCK','weapon','Not carried','{}'),
  ('dynamite','BLOCK','weapon','Not carried','{}'),

  -- ---- BLOCK: tobacco, nicotine, vapes -----------------------------------
  ('tobacco','BLOCK','age-restricted','Licensed sale only; not carried','{}'),
  ('nicotine','BLOCK','age-restricted','Licensed sale only; not carried','{}'),
  ('vape','BLOCK','age-restricted','Licensed sale only; not carried','{}'),
  ('e-cigarette','BLOCK','age-restricted','Licensed sale only; not carried','{}'),
  ('cigarette','BLOCK','age-restricted','Licensed sale only; not carried','{}'),
  ('cigar','BLOCK','age-restricted','Licensed sale only; not carried','{}'),

  -- ---- BLOCK: human remains and bodily fluids ----------------------------
  ('breast milk','BLOCK','human-tissue','Screening cannot be verified','{}'),
  ('human remains','BLOCK','human-tissue','Not carried','{}'),
  ('human bone','BLOCK','human-tissue','Not carried','{}'),
  ('blood plasma','BLOCK','human-tissue','Not carried','{}'),

  -- ---- BLOCK: sexual content and services --------------------------------
  ('pornographic','BLOCK','adult','Not permitted','{}'),
  ('pornography','BLOCK','adult','Not permitted','{}'),
  ('escort service','BLOCK','adult','Not permitted','{}'),
  ('sexual service','BLOCK','adult','Not permitted','{}'),
  ('nude photo','BLOCK','adult','Not permitted','{}'),

  -- ---- BLOCK: counterfeit and stolen -------------------------------------
  ('counterfeit','BLOCK','ip','Counterfeit goods','{}'),
  ('knockoff','BLOCK','ip','Counterfeit goods','{}'),
  ('replica rolex','BLOCK','ip','Counterfeit goods','{}'),
  ('stolen','BLOCK','stolen','Stolen goods','{"stolen from my garden","someone stolen"}'),

  -- ---- REVIEW: hemp / CBD / cannabis seed --------------------------------
  -- Hemp rope is cordage, not a consumable. The exemption is what lets the
  -- term stay strict without blocking a legitimate fiber listing.
  ('hemp','REVIEW','regulated','Lawful as fiber/seed; confirm it is not a THC product',
     '{"hemp rope","hemp twine","hemp cord","hemp fabric","hemp fiber","hemp cloth","hemp string"}'),
  ('cbd','REVIEW','regulated','Lawful in some forms/states; FDA restricts ingestible claims','{}'),
  ('cannabis seed','REVIEW','regulated','Seed/plant legality varies by state','{}'),
  ('hemp seed','REVIEW','regulated','Seed legality varies by state','{}'),

  -- ---- REVIEW: alcohol ----------------------------------------------------
  ('alcohol','REVIEW','age-restricted','Licensed sale only','{"rubbing alcohol"}'),
  ('moonshine','REVIEW','age-restricted','Unlicensed distillation is illegal; needs a human read','{}'),
  ('liquor','REVIEW','age-restricted','Licensed sale only','{}'),
  ('whiskey','REVIEW','age-restricted','Licensed sale only','{}'),
  ('vodka','REVIEW','age-restricted','Licensed sale only','{}'),
  ('beer','REVIEW','age-restricted','Licensed sale only','{"root beer","beer bread","ginger beer"}'),
  ('wine','REVIEW','age-restricted','Licensed sale only','{"wine cap","wine barrel planter","dandelion wine recipe"}'),
  ('hard cider','REVIEW','age-restricted','Licensed sale only','{}'),
  ('mead','REVIEW','age-restricted','Licensed sale only','{}'),

  -- ---- REVIEW: food safety ------------------------------------------------
  ('raw milk','REVIEW','food-safety','Legality varies sharply by state','{}'),
  ('unpasteurized','REVIEW','food-safety','Varies by state and product','{}'),
  ('raw cheese','REVIEW','food-safety','Aging requirements vary by state','{}'),
  ('home canned','REVIEW','food-safety','Cottage-food rules vary; low-acid canning is high risk','{}'),
  ('home-canned','REVIEW','food-safety','Cottage-food rules vary','{}'),
  ('canned meat','REVIEW','food-safety','High botulism risk','{}'),
  ('fermented','REVIEW','food-safety','Acidified/fermented foods are regulated','{}'),
  ('kombucha','REVIEW','food-safety','Fermented beverage; alcohol content varies','{}'),
  ('eggs','REVIEW','food-safety','Temperature-controlled; state egg rules vary','{"egg carton","eggplant"}'),
  ('meat','REVIEW','food-safety','Requires inspected processing in most states','{"meaty","meat grinder"}'),
  ('poultry','REVIEW','food-safety','Requires inspected processing','{}'),
  ('chicken','REVIEW','food-safety','Live bird or meat both need a look','{"chicken manure","chicken coop","chicken wire","chicken feed"}'),
  ('beef','REVIEW','food-safety','Requires inspected processing','{}'),
  ('pork','REVIEW','food-safety','Requires inspected processing','{}'),
  ('fish','REVIEW','food-safety','Temperature-controlled; harvest rules vary','{"fish emulsion","fish fertilizer"}'),
  ('shellfish','REVIEW','food-safety','Harvest certification required','{}'),
  ('wild mushroom','REVIEW','food-safety','Foraged mushrooms need identification','{}'),
  ('foraged','REVIEW','food-safety','Needs provenance and identification','{}'),

  -- ---- REVIEW: live animals ------------------------------------------------
  ('puppy','REVIEW','animal','Live animal sale; welfare and state rules','{}'),
  ('kitten','REVIEW','animal','Live animal sale','{}'),
  ('livestock','REVIEW','animal','Live animal sale; transport rules','{}'),
  ('goat','REVIEW','animal','Live animal sale','{"goat manure","goat milk soap"}'),
  ('rabbit','REVIEW','animal','Live animal sale','{"rabbit manure"}'),

  -- ---- REVIEW: agricultural chemicals ---------------------------------------
  ('pesticide','REVIEW','agchem','Registered-product and applicator rules','{}'),
  ('herbicide','REVIEW','agchem','Registered-product rules','{}'),
  ('roundup','REVIEW','agchem','Registered pesticide','{}'),
  ('glyphosate','REVIEW','agchem','Registered pesticide','{}'),
  ('fungicide','REVIEW','agchem','Registered-product rules','{}'),
  ('fertilizer','REVIEW','agchem','State registration/labeling rules',
     '{"fish fertilizer","seaweed fertilizer","kelp fertilizer","organic fertilizer tea",
       "compost","manure","worm casting","leaf mold","bone meal","blood meal"}'),

  -- ---- REVIEW: health claims -------------------------------------------------
  ('cures','REVIEW','health-claim','Health-treatment claim','{}'),
  ('treats cancer','REVIEW','health-claim','Health-treatment claim','{}'),
  ('medicinal','REVIEW','health-claim','Health-treatment claim','{}'),
  ('remedy','REVIEW','health-claim','Health-treatment claim','{}'),
  ('heals','REVIEW','health-claim','Health-treatment claim','{}'),

  -- ---- REVIEW: brand/IP ------------------------------------------------------
  ('rolex','REVIEW','ip','Protected brand','{}'),
  ('louis vuitton','REVIEW','ip','Protected brand','{}'),
  ('nike','REVIEW','ip','Protected brand','{}'),
  ('disney','REVIEW','ip','Protected brand','{}')
on conflict (term, category) do update
  set action = excluded.action, rationale = excluded.rationale,
      exempt_if = excluded.exempt_if, updated_at = now();

-- ===========================================================================
-- Screening
-- ===========================================================================
-- Addresses are logistics, not product text. A listing whose pickup is on
-- Rifle Range Road is not a firearm listing, so street-shaped spans are removed
-- before any term is tested.
create or replace function public.strip_address_spans(p_text text)
returns text language sql immutable set search_path = pg_catalog, public as $$
  select regexp_replace(
           coalesce(p_text, ''),
           -- "<number?> <words> <street-suffix>" plus common unit/box forms.
           '(\m\d{1,6}\s+)?([A-Za-z''.-]+\s+){0,3}\m(st|street|rd|road|ave|avenue|blvd|boulevard|ln|lane|dr|drive|ct|court|cir|circle|way|pkwy|parkway|hwy|highway|ter|terrace|pl|place|trail|trl|route|rte)\M\.?',
           ' ', 'gi');
$$;

create or replace function public.screen_listing_text(p_text text)
returns table(action text, term text, category text, rationale text)
language sql stable security definer set search_path = pg_catalog, public as $$
  with cleaned as (select public.strip_address_spans(p_text) as t)
  select p.action, p.term, p.category, p.rationale
    from public.prohibited_terms p, cleaned c
   where p.active
     -- An exemption phrase means this term describes a different, allowed
     -- product in this listing: 'hemp' fires, 'hemp rope' does not.
     and not exists (
       select 1 from unnest(p.exempt_if) as ex
        where c.t ~* ('\m' || regexp_replace(ex, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\M'))
     and case
           when p.is_regex then c.t ~* p.term
           -- \m and \M are word boundaries, so 'pot' misses 'potato' and 'weed'
           -- misses 'seaweed'. Boundaries do not stem, so a simple plural
           -- (including y->ies) is matched too or 'puppy' would miss "Puppies".
           else c.t ~* (
             '\m' ||
             case when p.term ~ 'y$'
                  then regexp_replace(regexp_replace(p.term,'([.^$*+?()\[\]{}|\\])','\\\1','g'),'y$','(y|ies)')
                  else regexp_replace(p.term,'([.^$*+?()\[\]{}|\\])','\\\1','g') || '(s|es)?'
             end || '\M')
         end
   order by case p.action when 'BLOCK' then 0 else 1 end, length(p.term) desc;
$$;
revoke all on function public.screen_listing_text(text) from public, anon;
grant execute on function public.screen_listing_text(text) to authenticated, service_role;

alter table public.listings
  add column if not exists screening_status text not null default 'CLEAR',
  add column if not exists screening_reason text,
  add column if not exists screening_term   text,
  add column if not exists screening_category text,
  add column if not exists screened_at      timestamptz;
do $$ begin
  alter table public.listings add constraint listings_screening_chk
    check (screening_status in ('CLEAR','REVIEW','BLOCKED','APPROVED'));
exception when duplicate_object then null; end $$;

-- The control itself. A trigger, not application code: a listing can be written
-- from the mobile app, the web app, the REST API, an AI draft, an edit, a
-- relist or a bulk publish, and every one of those paths must meet this rule.
create or replace function public.listings_screen_content() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare hit record; blob text; cfg public.content_screening_config; made int;
begin
  select * into cfg from public.content_screening_config where id;

  -- Rate limit before screening: a script posting hundreds of listings is abuse
  -- whether or not the words are clean. Plan limits cap ACTIVE listings; this
  -- caps the rate. Admins are exempt so moderation work is never throttled.
  if tg_op = 'INSERT' and cfg.max_listings_per_hour is not null
     and not public.is_admin() then
    select count(*) into made from public.listings
     where owner_id = new.owner_id and created_at > now() - interval '1 hour';
    if made >= cfg.max_listings_per_hour then
      raise exception 'RATE_LIMITED: that is a lot of listings at once. Try again in a little while.'
        using errcode = 'P0001';
    end if;
  end if;

  if not coalesce(cfg.screening_enabled, true) then
    return new;   -- owner-only kill switch
  end if;

  -- Pickup instructions and address fields are deliberately NOT part of this.
  -- They are private logistics, not a product description.
  --
  -- Two different blobs, because what you OFFER and what you WANT are not the
  -- same claim. The production audit made this concrete: of five listings that
  -- matched "eggs", only two were selling eggs — the rest were trading basil,
  -- zucchini and pumpkins FOR eggs. Holding those would tax the most ordinary
  -- exchange on a neighborhood produce app.
  --
  --   BLOCK  screens everything, including trade_for and Wanted posts. Asking
  --          to buy a handgun is not better than selling one.
  --   REVIEW screens only what the person is OFFERING: title + description on
  --          an offer. A Wanted post is a request, not a sale.
  blob := coalesce(new.title,'') || ' ' || coalesce(new.description,'') || ' '
       || coalesce(new.trade_for,'');

  select * into hit from public.screen_listing_text(blob)
   where action = 'BLOCK' limit 1;

  if hit.term is null and coalesce(new.kind,'offer') <> 'wanted' then
    select * into hit from public.screen_listing_text(
             coalesce(new.title,'') || ' ' || coalesce(new.description,''))
     where action = 'REVIEW' limit 1;
  end if;

  if hit.action = 'BLOCK' then
    -- The message is what a person reads, so it is written for them. Clients
    -- match on the PROHIBITED_ITEM prefix and may substitute their own copy.
    raise exception 'PROHIBITED_ITEM: Gnome can''t carry this one. "%" falls under % , which we don''t allow. If you think that''s wrong, edit the wording or contact support.',
      hit.term, replace(hit.category,'-',' ')
      using errcode = 'P0001';
  elsif hit.action = 'REVIEW' then
    new.screening_status   := 'REVIEW';
    new.screening_term     := hit.term;
    new.screening_category := hit.category;
    new.screening_reason   := hit.rationale;
    new.screened_at        := now();
    -- Held, not published. `paused` already means "exists but not public"
    -- (0045), so every browse feed respects this with no change.
    if new.status = 'active' then new.status := 'paused'; end if;
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

drop trigger if exists listings_screen_content_trg on public.listings;
-- Fires on INSERT and on any edit to the screened fields, so republishing or
-- editing a clean listing into a prohibited one is caught. An admin approval
-- sets screening_status directly and is not in the trigger's column list, so
-- clearing a listing does not immediately re-hold it.
create trigger listings_screen_content_trg
  before insert or update of title, description, trade_for, taxonomy_node_id
  on public.listings for each row execute function public.listings_screen_content();

-- ===========================================================================
-- Admin moderation queue
-- ===========================================================================
create or replace function public.admin_screening_queue()
returns table(
  listing_id uuid, title text, description text, listing_status text,
  seller_id uuid, seller_name text, seller_suspended boolean,
  matched_term text, matched_category text, reason text,
  city text, state text, created_at timestamptz, screened_at timestamptz
)
language sql stable security definer set search_path = pg_catalog, public as $$
  select l.id, l.title, l.description, l.status,
         l.owner_id, p.name, p.suspended,
         l.screening_term, l.screening_category, l.screening_reason,
         l.city, l.state, l.created_at, l.screened_at
    from public.listings l
    left join public.profiles p on p.id = l.owner_id
   where l.screening_status = 'REVIEW'
     and (public.admin_has_perm('listings.moderate') or public.admin_is_owner())
   order by l.created_at;
$$;
revoke all on function public.admin_screening_queue() from public, anon;
grant execute on function public.admin_screening_queue() to authenticated;

-- Full history for one listing: every screening decision ever made on it.
create or replace function public.admin_screening_history(p_listing uuid)
returns table(action text, reason text, actor uuid, actor_type text, at timestamptz)
language sql stable security definer set search_path = pg_catalog, public as $$
  select a.action, a.reason, a.actor, a.actor_type, a.created_at
    from public.admin_audit_log a
   where a.resource_type = 'listings' and a.resource_id = p_listing::text
     and (public.admin_has_perm('listings.moderate') or public.admin_is_owner())
   order by a.created_at desc;
$$;
revoke all on function public.admin_screening_history(uuid) from public, anon;
grant execute on function public.admin_screening_history(uuid) to authenticated;

-- Approve, reject, and optionally suspend the seller — one audited call, so the
-- queue does not need three round trips to act on an obvious abuser.
create or replace function public.admin_resolve_screening(
  p_listing uuid, p_approve boolean, p_reason text default null,
  p_suspend_seller boolean default false
) returns public.listings
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_old jsonb; v_row public.listings; v_owner uuid;
begin
  if not (public.admin_has_perm('listings.moderate') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select to_jsonb(t), t.owner_id into v_old, v_owner from public.listings t where t.id = p_listing;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  -- APPROVED, not CLEAR: the decision stays visible, and the trigger's column
  -- list excludes screening_status so this does not re-trigger.
  update public.listings
     set screening_status = case when p_approve then 'APPROVED' else 'BLOCKED' end,
         status = case when p_approve then 'active' else 'removed' end,
         screening_reason = coalesce(p_reason, screening_reason)
   where id = p_listing returning * into v_row;

  perform public.admin_audit(
    case when p_approve then 'listing.screening.approve' else 'listing.screening.reject' end,
    'listings', p_listing::text, v_old, to_jsonb(v_row), p_reason, 'admin', null);

  if p_suspend_seller and v_owner is not null then
    perform public.admin_set_suspended(v_owner, true);
  end if;
  return v_row;
end $$;
revoke all on function public.admin_resolve_screening(uuid,boolean,text,boolean) from public, anon;
grant execute on function public.admin_resolve_screening(uuid,boolean,text,boolean) to authenticated;

create or replace function public.admin_upsert_prohibited_term(
  p_term text, p_action text, p_category text, p_rationale text default null,
  p_exempt_if text[] default '{}', p_active boolean default true
) returns public.prohibited_terms
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.prohibited_terms; v_old jsonb;
begin
  if not (public.admin_has_perm('compliance.rules_manage') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_action not in ('BLOCK','REVIEW') then
    raise exception 'INVALID_ACTION' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.prohibited_terms t
   where t.term = lower(btrim(p_term)) and t.category = p_category;

  insert into public.prohibited_terms as t
    (term, action, category, rationale, exempt_if, active, created_by)
  values (lower(btrim(p_term)), p_action, p_category, p_rationale,
          coalesce(p_exempt_if,'{}'), p_active, auth.uid())
  on conflict (term, category) do update
    set action = excluded.action, rationale = coalesce(excluded.rationale, t.rationale),
        exempt_if = excluded.exempt_if, active = excluded.active, updated_at = now()
  returning * into v_row;

  perform public.admin_audit('compliance.term.upsert', 'prohibited_terms', v_row.id::text,
                             v_old, to_jsonb(v_row), p_rationale, 'admin', null);
  return v_row;
end $$;
revoke all on function public.admin_upsert_prohibited_term(text,text,text,text,text[],boolean) from public, anon;
grant execute on function public.admin_upsert_prohibited_term(text,text,text,text,text[],boolean) to authenticated;

-- Kill switch. Owner-only and audited: turning screening off is an incident
-- decision, not a preference.
create or replace function public.admin_set_screening_config(
  p_enabled boolean default null, p_max_per_hour int default null, p_reason text default null
) returns public.content_screening_config
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_old jsonb; v_row public.content_screening_config;
begin
  if not public.admin_is_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.content_screening_config t where t.id;
  update public.content_screening_config
     set screening_enabled = coalesce(p_enabled, screening_enabled),
         max_listings_per_hour = coalesce(p_max_per_hour, max_listings_per_hour),
         disabled_reason = case when p_enabled is false then p_reason else null end,
         updated_by = auth.uid(), updated_at = now()
   where id returning * into v_row;
  perform public.admin_audit('compliance.screening.config', 'content_screening_config',
                             'singleton', v_old, to_jsonb(v_row), p_reason, 'admin', null);
  return v_row;
end $$;
revoke all on function public.admin_set_screening_config(boolean,int,text) from public, anon;
grant execute on function public.admin_set_screening_config(boolean,int,text) to authenticated;

-- ===========================================================================
-- Grants — the 0087 lesson: revoke from the ROLES by name, then assert it.
-- ===========================================================================
alter table public.prohibited_terms enable row level security;
alter table public.content_screening_config enable row level security;
revoke all on public.prohibited_terms, public.content_screening_config
  from public, anon, authenticated;

do $$
declare bad text;
begin
  select string_agg(distinct table_name||':'||grantee||':'||privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where table_schema='public' and table_name in ('prohibited_terms','content_screening_config')
     and grantee in ('anon','authenticated');
  if bad is not null then
    raise exception 'screening tables must not be client-readable: %', bad;
  end if;
end $$;

notify pgrst, 'reload schema';
