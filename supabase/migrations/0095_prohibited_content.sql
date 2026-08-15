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

-- In a trade clause, what follows "for" is what the person WANTS, not what they
-- are offering. "Trade fresh basil for eggs" is a basil listing. Only applied to
-- the REVIEW pass: BLOCK still reads the whole text, because asking to buy a
-- handgun is not better than selling one.
--
-- Anchored on a trade verb so it stays narrow — "Fresh eggs for $5" keeps its
-- eggs, because "eggs" sits before the "for" and nothing is stripped ahead of it.
create or replace function public.strip_want_clauses(p_text text)
returns text language sql immutable set search_path = pg_catalog, public as $fn$
  -- In a trade clause, what follows "for" is what the person WANTS. So when the
  -- text reads like a trade at all, drop every "for ..." span and keep the rest:
  -- "Trade fresh basil for eggs" keeps only the basil, and "Trade fresh eggs for
  -- basil" keeps the eggs. Without a trade verb nothing is touched, so
  -- "Fresh eggs for $5" is untouched and still reads as eggs.
  select case
    when coalesce(p_text,'') ~* '\m(trade|trading|swap|swapping|exchange|barter|bartering)\M'
      then regexp_replace(p_text, '\mfor\M[^.!?;]*', ' ', 'gi')
    else coalesce(p_text,'')
  end;
$fn$;

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
-- ===========================================================================
-- Seller-level clearance: approve the SELLER once, not every listing forever
-- ===========================================================================
-- Eggs are the most common backyard listing there is. Reviewing each one
-- individually would mean approving the same person weekly for years. Instead a
-- review approves a seller for a (class, state) pair, and their later listings
-- of that class clear automatically until something material changes.

create table if not exists public.compliance_classes (
  compliance_class text primary key,
  label            text not null,
  -- Bumping this invalidates every clearance in the class at once: the admin
  -- changed the rule, so prior approvals no longer describe current policy.
  rule_version     int  not null default 1,
  requires_clearance boolean not null default true,
  -- Shown to the seller. Their words, not a database error.
  customer_message text not null,
  active           boolean not null default true,
  updated_at       timestamptz not null default now()
);

insert into public.compliance_classes (compliance_class, label, customer_message) values
  ('eggs','Eggs','Egg sales require a quick compliance review in your area. Your listing has been saved but is not public yet.'),
  ('food-safety','Temperature-controlled or preserved food','This kind of food needs a quick compliance review in your area. Your listing has been saved but is not public yet.'),
  ('regulated','Hemp / CBD','This product needs a quick compliance review in your area. Your listing has been saved but is not public yet.'),
  ('age-restricted','Alcohol','Alcohol sales need a quick compliance review in your area. Your listing has been saved but is not public yet.'),
  ('animal','Live animals','Live animal listings need a quick review. Your listing has been saved but is not public yet.'),
  ('agchem','Agricultural chemicals','This product needs a quick compliance review. Your listing has been saved but is not public yet.'),
  ('health-claim','Health claims','A listing that mentions treating or curing something needs a quick review. Your listing has been saved but is not public yet.'),
  ('ip','Brand names','A listing using a protected brand name needs a quick review. Your listing has been saved but is not public yet.')
on conflict (compliance_class) do update set label = excluded.label,
  customer_message = excluded.customer_message, updated_at = now();

create table if not exists public.seller_compliance_clearances (
  id                uuid primary key default gen_random_uuid(),
  seller_id         uuid not null references public.profiles(id) on delete cascade,
  compliance_class  text not null references public.compliance_classes(compliance_class),
  -- Clearance is per STATE: the rule that made it lawful is a state rule, so
  -- moving states means the question has not been answered yet.
  state             text not null,
  -- The rule this decision was made under. A bump means re-review.
  rule_version      int  not null,
  -- Optional: some states require a permit, some do not. When present, its
  -- expiry ends the clearance.
  credential_id     uuid references public.seller_credentials(id) on delete set null,
  status            text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED')),
  source_listing_id uuid,
  granted_by        uuid references public.profiles(id),
  granted_at        timestamptz not null default now(),
  reason            text,
  revoked_by        uuid references public.profiles(id),
  revoked_at        timestamptz,
  notes             text
);
create unique index if not exists scc_one_active
  on public.seller_compliance_clearances (seller_id, compliance_class, state)
  where status = 'ACTIVE';

comment on table public.seller_compliance_clearances is
  'A review approves a SELLER for a class in a state under a rule version. Later '
  'listings of that class clear automatically until the credential expires, the '
  'seller moves state, the class changes, or the rule version is bumped.';

-- State is the axis a clearance is granted on, so it has to mean exactly one
-- thing. Production has no constraint on listings.state today: the values happen
-- to be clean ("OH"), but "Ohio", " oh " and "" would all be accepted, and a
-- clearance keyed on one spelling would silently miss another.
--
-- Resolution is server-side and total: trim, fold case, and map full names to
-- the USPS code. Anything unrecognised returns NULL rather than a guess, and a
-- NULL state can never satisfy a clearance — so an unknown location fails
-- closed into review instead of quietly publishing.
create or replace function public.normalize_state(p_state text)
returns text language sql immutable set search_path = pg_catalog, public as $fn$
  select case
    when coalesce(btrim(p_state),'') = '' then null
    when upper(btrim(p_state)) ~ '^[A-Z]{2}$'
      and upper(btrim(p_state)) in (
        'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
        'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
        'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC')
      then upper(btrim(p_state))
    else (select code from (values
      ('alabama','AL'),('alaska','AK'),('arizona','AZ'),('arkansas','AR'),('california','CA'),
      ('colorado','CO'),('connecticut','CT'),('delaware','DE'),('florida','FL'),('georgia','GA'),
      ('hawaii','HI'),('idaho','ID'),('illinois','IL'),('indiana','IN'),('iowa','IA'),
      ('kansas','KS'),('kentucky','KY'),('louisiana','LA'),('maine','ME'),('maryland','MD'),
      ('massachusetts','MA'),('michigan','MI'),('minnesota','MN'),('mississippi','MS'),
      ('missouri','MO'),('montana','MT'),('nebraska','NE'),('nevada','NV'),('new hampshire','NH'),
      ('new jersey','NJ'),('new mexico','NM'),('new york','NY'),('north carolina','NC'),
      ('north dakota','ND'),('ohio','OH'),('oklahoma','OK'),('oregon','OR'),('pennsylvania','PA'),
      ('rhode island','RI'),('south carolina','SC'),('south dakota','SD'),('tennessee','TN'),
      ('texas','TX'),('utah','UT'),('vermont','VT'),('virginia','VA'),('washington','WA'),
      ('west virginia','WV'),('wisconsin','WI'),('wyoming','WY'),('district of columbia','DC')
    ) as m(name, code)
    where m.name = lower(regexp_replace(btrim(p_state), '\s+', ' ', 'g')))
  end;
$fn$;
revoke all on function public.normalize_state(text) from public, anon;
grant execute on function public.normalize_state(text) to authenticated, service_role;

-- Is this seller cleared to list this class in this state, right now?
create or replace function public.seller_is_cleared(
  p_seller uuid, p_class text, p_state text
) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $fn$
  select exists (
    select 1
      from public.seller_compliance_clearances c
      join public.compliance_classes k on k.compliance_class = c.compliance_class
      left join public.seller_credentials sc on sc.id = c.credential_id
     where c.seller_id = p_seller
       and c.compliance_class = p_class
       -- Both sides normalized, and a NULL never matches: an unknown location
       -- must fail closed into review, not inherit somebody's clearance.
       and public.normalize_state(c.state) is not null
       and public.normalize_state(c.state) = public.normalize_state(p_state)
       and c.status = 'ACTIVE'
       -- the rule has not been rewritten since the decision
       and c.rule_version = k.rule_version
       -- and any credential it rested on is still good
       and (c.credential_id is null
            -- credential_status is an enum with UPPERCASE labels
            or (sc.status = 'APPROVED'
                and (sc.expiration_date is null or sc.expiration_date >= current_date)))
  );
$fn$;
revoke all on function public.seller_is_cleared(uuid,text,text) from public, anon;
grant execute on function public.seller_is_cleared(uuid,text,text) to authenticated, service_role;

-- Taxonomy is the primary signal; keywords are the backup for someone filing
-- eggs under "Crafts". A node carries its class directly.
alter table public.marketplace_taxonomy_nodes
  add column if not exists compliance_class text references public.compliance_classes(compliance_class);
update public.marketplace_taxonomy_nodes set compliance_class = 'eggs' where slug = 'eggs';
update public.marketplace_taxonomy_nodes set compliance_class = 'food-safety'
 where slug in ('meat','preserves-and-pantry','mushrooms') and compliance_class is null;

create or replace function public.listings_screen_content() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare hit record; blob text; cfg public.content_screening_config; made int;
        v_class text; cls public.compliance_classes; v_state text;
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

  -- BLOCK reads everything, including trade_for and Wanted posts.
  select * into hit from public.screen_listing_text(blob)
   where action = 'BLOCK' limit 1;

  -- Authoritative state: the listing's own, else the seller's profile. Resolved
  -- once, server-side, so no client spelling reaches the clearance comparison.
  v_state := public.normalize_state(new.state);
  if v_state is null then
    select public.normalize_state(pr.state) into v_state
      from public.profiles pr where pr.id = new.owner_id;
  end if;
  if new.state is not null and public.normalize_state(new.state) is not null then
    new.state := public.normalize_state(new.state);   -- store it normalized
  end if;

  if hit.term is null and coalesce(new.kind,'offer') <> 'wanted' then
    -- TAXONOMY FIRST. The category the seller picked is a stronger signal than
    -- any word, and it is what lets an egg seller be cleared once rather than
    -- reviewed forever.
    select n.compliance_class into v_class
      from public.marketplace_taxonomy_nodes n
     where n.id = new.taxonomy_node_id and n.compliance_class is not null;

    -- KEYWORDS AS BACKUP, for eggs deliberately filed under "Crafts". Want
    -- clauses are stripped first, so "Trade fresh basil for eggs" reads as the
    -- basil listing it is.
    if v_class is null then
      select * into hit from public.screen_listing_text(
               public.strip_want_clauses(
                 coalesce(new.title,'') || ' ' || coalesce(new.description,'')))
       where action = 'REVIEW' limit 1;
      v_class := hit.category;
    end if;
  end if;

  if hit.action = 'BLOCK' then
    -- The message is what a person reads, so it is written for them. Clients
    -- match on the PROHIBITED_ITEM prefix and may substitute their own copy.
    raise exception 'PROHIBITED_ITEM: Gnome can''t carry this one. "%" falls under % , which we don''t allow. If you think that''s wrong, edit the wording or contact support.',
      hit.term, replace(hit.category,'-',' ')
      using errcode = 'P0001';
  elsif v_class is not null then
    select * into cls from public.compliance_classes
     where compliance_class = v_class and active;

    -- Already cleared for this class, in this state, under the current rule,
    -- with a credential that has not expired? Then it simply publishes. This is
    -- the difference between reviewing a seller once and reviewing their eggs
    -- every week forever.
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
      -- Held, not published. `paused` already means "exists but not public"
      -- (0045), so every browse feed respects this with no change.
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
  select l.id, l.title, l.description, l.status::text,
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
returns table(action text, reason text, actor_id uuid, actor_type text, at timestamptz)
language sql stable security definer set search_path = pg_catalog, public as $$
  select a.action, a.reason, a.actor_id, a.actor_type, a.created_at
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
         status = (case when p_approve then 'active' else 'removed' end)::listing_status,
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

-- Approving a listing can also clear the seller, which is the whole point: one
-- review, then their later egg listings publish on their own.
create or replace function public.admin_grant_compliance_clearance(
  p_seller uuid, p_class text, p_state text, p_reason text,
  p_credential uuid default null, p_listing uuid default null
) returns public.seller_compliance_clearances
language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare v_row public.seller_compliance_clearances; v_ver int;
begin
  if not (public.admin_has_perm('compliance.rules_manage')
          or public.admin_has_perm('listings.moderate') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select rule_version into v_ver from public.compliance_classes where compliance_class = p_class;
  if v_ver is null then raise exception 'UNKNOWN_CLASS' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason),'') = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- Supersede rather than stack, so "is this seller cleared" has one answer.
  if public.normalize_state(p_state) is null then
    raise exception 'UNKNOWN_STATE: %', p_state using errcode = 'P0001';
  end if;

  update public.seller_compliance_clearances
     set status = 'REVOKED', revoked_by = auth.uid(), revoked_at = now(),
         notes = coalesce(notes,'') || ' superseded'
   where seller_id = p_seller and compliance_class = p_class
     and public.normalize_state(state) = public.normalize_state(p_state)
     and status = 'ACTIVE';

  insert into public.seller_compliance_clearances
    (seller_id, compliance_class, state, rule_version, credential_id,
     source_listing_id, granted_by, reason)
  values (p_seller, p_class, public.normalize_state(p_state), v_ver, p_credential,
          p_listing, auth.uid(), p_reason)
  returning * into v_row;

  -- Seller, listing, state, rule version, reviewer, decision, reason, timestamp
  -- all land in one audit row.
  perform public.admin_audit('compliance.clearance.grant', 'seller_compliance_clearances',
    v_row.id::text, null, to_jsonb(v_row), p_reason, 'admin', null);
  return v_row;
end $fn$;
revoke all on function public.admin_grant_compliance_clearance(uuid,text,text,text,uuid,uuid) from public, anon;
grant execute on function public.admin_grant_compliance_clearance(uuid,text,text,text,uuid,uuid) to authenticated;

create or replace function public.admin_revoke_compliance_clearance(
  p_clearance uuid, p_reason text
) returns public.seller_compliance_clearances
language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare v_old jsonb; v_row public.seller_compliance_clearances;
begin
  if not (public.admin_has_perm('compliance.rules_manage') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.seller_compliance_clearances t where t.id = p_clearance;
  update public.seller_compliance_clearances
     set status = 'REVOKED', revoked_by = auth.uid(), revoked_at = now(), notes = p_reason
   where id = p_clearance returning * into v_row;
  perform public.admin_audit('compliance.clearance.revoke', 'seller_compliance_clearances',
    p_clearance::text, v_old, to_jsonb(v_row), p_reason, 'admin', null);
  return v_row;
end $fn$;
revoke all on function public.admin_revoke_compliance_clearance(uuid,text) from public, anon;
grant execute on function public.admin_revoke_compliance_clearance(uuid,text) to authenticated;

-- Bumping a class's rule version invalidates every clearance in it at once.
create or replace function public.admin_bump_compliance_rule(p_class text, p_reason text)
returns public.compliance_classes
language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare v_old jsonb; v_row public.compliance_classes;
begin
  if not (public.admin_has_perm('compliance.rules_manage') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.compliance_classes t where t.compliance_class = p_class;
  update public.compliance_classes set rule_version = rule_version + 1, updated_at = now()
   where compliance_class = p_class returning * into v_row;
  perform public.admin_audit('compliance.rule.bump', 'compliance_classes', p_class,
                             v_old, to_jsonb(v_row), p_reason, 'admin', null);
  return v_row;
end $fn$;
revoke all on function public.admin_bump_compliance_rule(text,text) from public, anon;
grant execute on function public.admin_bump_compliance_rule(text,text) to authenticated;

alter table public.seller_compliance_clearances enable row level security;
alter table public.compliance_classes enable row level security;
revoke all on public.seller_compliance_clearances, public.compliance_classes
  from public, anon, authenticated;

alter table public.prohibited_terms enable row level security;
alter table public.content_screening_config enable row level security;
revoke all on public.prohibited_terms, public.content_screening_config
  from public, anon, authenticated;

do $$
declare bad text;
begin
  select string_agg(distinct table_name||':'||grantee||':'||privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where table_schema='public' and table_name in ('prohibited_terms','content_screening_config','seller_compliance_clearances','compliance_classes')
     and grantee in ('anon','authenticated');
  if bad is not null then
    raise exception 'screening tables must not be client-readable: %', bad;
  end if;
end $$;

notify pgrst, 'reload schema';
