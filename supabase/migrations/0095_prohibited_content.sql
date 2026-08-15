-- 0095 — stop prohibited goods being listed, at the moment of publish.
--
-- NOT APPLIED. Declared in migrations/UNAPPLIED.txt.
--
-- What exists today: a compliance FRAMEWORK with nothing in it. The
-- `prohibited` flag on taxonomy nodes is set on zero nodes, `compliance_rules`
-- has zero rows, and nothing reads a listing's title or description. There is
-- no cannabis category to choose, but that is not a control — "Homegrown
-- flower, $40, local pickup" posted under Produce goes live today, and the only
-- backstop is a neighbor reporting it afterwards.
--
-- This adds the missing control: a screening pass that runs server-side inside
-- the same transaction as the write, so it cannot be skipped by using a
-- different client, the REST API, or an AI draft.
--
-- DESIGN NOTES, because the tempting version of this is wrong:
--
--  * Two outcomes, not one. BLOCK is for things Gnome will never carry
--    (controlled substances, weapons, prescription drugs). REVIEW is for things
--    that are lawful in some places or some forms and need a human to look
--    (raw milk, home-canned goods, alcohol, CBD). Blocking everything ambiguous
--    trains people to rephrase until it passes, which is worse than a queue.
--
--  * Word boundaries, not substrings. "weed" must not fire on "seaweed" or
--    "weeding", and "pot" must not fire on "potato" or "pot of basil" — that
--    last one is a real listing on a gardening app. Every term is matched on a
--    boundary, and the seeds below were chosen with that in mind.
--
--  * This is a floor, not a ceiling. Term matching catches the careless, never
--    the determined — someone will always find a spelling. It exists so the
--    obvious case cannot happen by accident, and so REVIEW builds the human
--    queue that catches the rest. It is deliberately paired with reports and
--    admin takedown, which already exist.

create table if not exists public.prohibited_terms (
  id            uuid primary key default gen_random_uuid(),
  term          text not null,
  -- BLOCK: refuse the write. REVIEW: allow it, but hold the listing for a human.
  action        text not null default 'REVIEW' check (action in ('BLOCK','REVIEW')),
  category      text not null,
  -- Why this term is here, in words an admin can read in the queue.
  rationale     text,
  -- Regex is opt-in: most entries are plain words matched on a boundary.
  is_regex      boolean not null default false,
  active        boolean not null default true,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (term, category)
);
create index if not exists prohibited_terms_active_idx on public.prohibited_terms (active) where active;

comment on table public.prohibited_terms is
  'Screening list applied to listing title/description at write time. BLOCK refuses; '
  'REVIEW publishes nothing until an admin clears it. A floor, not a guarantee.';

-- Seeds. Deliberately conservative on BLOCK and generous on REVIEW.
insert into public.prohibited_terms (term, action, category, rationale) values
  -- Controlled substances. Federally illegal to ship, and Gnome has no path to
  -- carry them lawfully in any state, so these are absolute.
  ('marijuana','BLOCK','controlled-substance','Federally controlled; no lawful path on this platform'),
  ('cannabis','BLOCK','controlled-substance','Federally controlled'),
  ('thc','BLOCK','controlled-substance','Psychoactive cannabis derivative'),
  ('psilocybin','BLOCK','controlled-substance','Controlled substance'),
  ('magic mushroom','BLOCK','controlled-substance','Controlled substance'),
  ('shrooms','BLOCK','controlled-substance','Controlled substance'),
  ('cocaine','BLOCK','controlled-substance','Controlled substance'),
  ('heroin','BLOCK','controlled-substance','Controlled substance'),
  ('meth','BLOCK','controlled-substance','Controlled substance'),
  ('fentanyl','BLOCK','controlled-substance','Controlled substance'),
  ('lsd','BLOCK','controlled-substance','Controlled substance'),
  ('kratom','REVIEW','controlled-substance','Banned in several states; needs a human read'),
  -- Cannabis-adjacent but lawful in forms and places: a hemp grower is a
  -- legitimate seller, so this is a queue rather than a wall.
  ('cbd','REVIEW','regulated','Lawful in some forms/states; FDA restricts ingestible claims'),
  ('hemp','REVIEW','regulated','Lawful as fiber/seed; verify it is not a THC product'),
  ('delta-8','BLOCK','controlled-substance','Intoxicating cannabinoid; unsettled legality'),
  ('delta 8','BLOCK','controlled-substance','Intoxicating cannabinoid'),

  -- Prescription and animal drugs.
  ('adderall','BLOCK','prescription','Prescription-only'),
  ('xanax','BLOCK','prescription','Prescription-only'),
  ('oxycodone','BLOCK','prescription','Prescription-only'),
  ('percocet','BLOCK','prescription','Prescription-only'),
  ('vicodin','BLOCK','prescription','Prescription-only'),
  ('ivermectin','REVIEW','prescription','Veterinary/prescription; not a food item'),
  ('antibiotic','REVIEW','prescription','Prescription-only in most forms'),
  ('insulin','BLOCK','prescription','Prescription-only; resale is unsafe'),

  -- Weapons.
  ('firearm','BLOCK','weapon','Not carried; regulated transfer'),
  ('handgun','BLOCK','weapon','Not carried'),
  ('rifle','BLOCK','weapon','Not carried'),
  ('shotgun','BLOCK','weapon','Not carried'),
  ('ammunition','BLOCK','weapon','Not carried'),
  ('ammo','BLOCK','weapon','Not carried'),
  ('silencer','BLOCK','weapon','Not carried'),
  ('explosive','BLOCK','weapon','Not carried'),

  -- Age-restricted. Lawful to sell WITH a licence Gnome does not verify, so
  -- they queue rather than block outright.
  ('tobacco','REVIEW','age-restricted','Licensed sale only'),
  ('nicotine','REVIEW','age-restricted','Licensed sale only'),
  ('vape','REVIEW','age-restricted','Licensed sale only'),
  ('e-cigarette','REVIEW','age-restricted','Licensed sale only'),
  ('moonshine','BLOCK','age-restricted','Unlicensed distilled spirits'),
  ('liquor','REVIEW','age-restricted','Licensed sale only'),
  ('whiskey','REVIEW','age-restricted','Licensed sale only'),
  ('vodka','REVIEW','age-restricted','Licensed sale only'),
  ('beer','REVIEW','age-restricted','Licensed sale only'),
  ('wine','REVIEW','age-restricted','Licensed sale only; note homemade wine is still regulated'),
  ('hard cider','REVIEW','age-restricted','Licensed sale only'),

  -- Food-safety items that are lawful in some states and not others. These are
  -- the ones a real produce marketplace will actually meet, so the queue
  -- matters more here than anywhere else.
  ('raw milk','REVIEW','food-safety','Legality varies sharply by state'),
  ('raw cheese','REVIEW','food-safety','Aging requirements vary by state'),
  ('home canned','REVIEW','food-safety','Cottage food rules vary; low-acid canning is high risk'),
  ('home-canned','REVIEW','food-safety','Cottage food rules vary'),
  ('canned meat','REVIEW','food-safety','High botulism risk; usually prohibited'),
  ('wild mushroom','REVIEW','food-safety','Foraged mushrooms need identification'),
  ('foraged','REVIEW','food-safety','Needs provenance and identification'),
  ('unpasteurized','REVIEW','food-safety','Varies by state and product'),

  -- Live animals and animal welfare.
  ('puppy','REVIEW','animal','Live animal sale; rules vary and welfare risk is high'),
  ('kitten','REVIEW','animal','Live animal sale'),
  ('livestock','REVIEW','animal','Live animal sale; transport rules apply'),

  -- Human tissue and counterfeits.
  ('breast milk','BLOCK','human-tissue','Not carried; screening cannot be verified'),
  ('counterfeit','BLOCK','ip','Counterfeit goods'),
  ('replica rolex','BLOCK','ip','Counterfeit goods')
on conflict (term, category) do nothing;

-- Boundary-matched screening. Returns the worst outcome plus what fired, so the
-- admin queue can show a reason rather than a mystery.
create or replace function public.screen_listing_text(p_text text)
returns table(action text, term text, category text, rationale text)
language sql stable security definer set search_path = public as $$
  select t.action, t.term, t.category, t.rationale
    from public.prohibited_terms t
   where t.active
     and case
           when t.is_regex then p_text ~* t.term
           -- \m and \M are Postgres word boundaries: 'weed' will not match
           -- 'seaweed', and 'pot' will not match 'potato'.
           --
           -- Boundaries do not stem, though, so a bare 'puppy' misses
           -- "Puppies" — which is how anyone would actually write the listing.
           -- Plain terms therefore also match a simple plural, including the
           -- y->ies form. Still bounded, so 'potato(es)' cannot reach 'pot'.
           else p_text ~* (
             '\m' ||
             case when t.term ~ 'y$'
                  then regexp_replace(
                         regexp_replace(t.term, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'),
                         'y$', '(y|ies)')
                  else regexp_replace(t.term, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '(s|es)?'
             end || '\M')
         end
   order by case t.action when 'BLOCK' then 0 else 1 end, length(t.term) desc;
$$;
revoke all on function public.screen_listing_text(text) from public, anon;
grant execute on function public.screen_listing_text(text) to authenticated, service_role;

alter table public.listings
  add column if not exists screening_status text not null default 'CLEAR',
  add column if not exists screening_reason text,
  add column if not exists screened_at      timestamptz;
do $$ begin
  alter table public.listings add constraint listings_screening_chk
    check (screening_status in ('CLEAR','REVIEW','BLOCKED'));
exception when duplicate_object then null; end $$;

-- The control itself. A trigger, not application code, because the listing can
-- be written from the mobile app, the web app, the REST API or a published AI
-- draft — and all four must be screened by the same rule.
create or replace function public.listings_screen_content() returns trigger
language plpgsql security definer set search_path = public as $$
declare hit record; blob text;
begin
  blob := coalesce(new.title,'') || ' ' || coalesce(new.description,'') || ' '
       || coalesce(new.trade_for,'') || ' ' || coalesce(new.category,'');

  select * into hit from public.screen_listing_text(blob) limit 1;

  if hit.action = 'BLOCK' then
    -- Refusing the write is the point: a blocked listing must never exist, not
    -- even briefly, and must never be recoverable by editing the status.
    raise exception 'PROHIBITED_ITEM: % (%). Gnome cannot carry this. %',
      hit.term, hit.category, coalesce(hit.rationale,'')
      using errcode = 'P0001';
  elsif hit.action = 'REVIEW' then
    new.screening_status := 'REVIEW';
    new.screening_reason := hit.term || ' (' || hit.category || ')';
    new.screened_at := now();
    -- Held, not published. `paused` already means "exists but not public"
    -- (0045), so the browse feeds need no change to respect this.
    if new.status = 'active' then new.status := 'paused'; end if;
  else
    new.screening_status := 'CLEAR';
    new.screening_reason := null;
    new.screened_at := now();
  end if;

  -- A taxonomy node explicitly marked prohibited is refused regardless of words.
  if new.taxonomy_node_id is not null
     and exists (select 1 from public.marketplace_taxonomy_nodes n
                  where n.id = new.taxonomy_node_id and n.prohibited) then
    raise exception 'PROHIBITED_CATEGORY: this category cannot be listed on Gnome'
      using errcode = 'P0001';
  end if;

  return new;
end $$;

drop trigger if exists listings_screen_content_trg on public.listings;
create trigger listings_screen_content_trg
  before insert or update of title, description, trade_for, category, taxonomy_node_id
  on public.listings for each row execute function public.listings_screen_content();

-- Admin queue + decision.
create or replace function public.admin_screening_queue()
returns table(
  id uuid, title text, description text, owner_id uuid, owner_name text,
  screening_reason text, city text, state text, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select l.id, l.title, l.description, l.owner_id, p.name,
         l.screening_reason, l.city, l.state, l.created_at
    from public.listings l
    left join public.profiles p on p.id = l.owner_id
   where l.screening_status = 'REVIEW'
     and (public.admin_has_perm('listings.moderate') or public.admin_is_owner())
   order by l.created_at;
$$;
revoke all on function public.admin_screening_queue() from public, anon;
grant execute on function public.admin_screening_queue() to authenticated;

create or replace function public.admin_resolve_screening(
  p_listing uuid, p_approve boolean, p_reason text default null
) returns public.listings
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_row public.listings;
begin
  if not (public.admin_has_perm('listings.moderate') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select to_jsonb(t) into v_old from public.listings t where t.id = p_listing;
  if v_old is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  -- Clearing sets CLEAR so the trigger does not re-hold it on the next edit;
  -- the admin decision is the record of why.
  update public.listings
     set screening_status = case when p_approve then 'CLEAR' else 'BLOCKED' end,
         status = case when p_approve then 'active' else 'removed' end,
         screening_reason = coalesce(p_reason, screening_reason)
   where id = p_listing returning * into v_row;

  perform public.admin_audit(
    case when p_approve then 'listing.screening.approve' else 'listing.screening.reject' end,
    'listings', p_listing::text, v_old, to_jsonb(v_row), p_reason, 'admin', null);
  return v_row;
end $$;
revoke all on function public.admin_resolve_screening(uuid,boolean,text) from public, anon;
grant execute on function public.admin_resolve_screening(uuid,boolean,text) to authenticated;

create or replace function public.admin_upsert_prohibited_term(
  p_term text, p_action text, p_category text, p_rationale text default null,
  p_active boolean default true
) returns public.prohibited_terms
language plpgsql security definer set search_path = public as $$
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

  insert into public.prohibited_terms as t (term, action, category, rationale, active, created_by)
  values (lower(btrim(p_term)), p_action, p_category, p_rationale, p_active, auth.uid())
  on conflict (term, category) do update
    set action = excluded.action, rationale = coalesce(excluded.rationale, t.rationale),
        active = excluded.active, updated_at = now()
  returning * into v_row;

  perform public.admin_audit('compliance.term.upsert', 'prohibited_terms', v_row.id::text,
                             v_old, to_jsonb(v_row), p_rationale, 'admin', null);
  return v_row;
end $$;
revoke all on function public.admin_upsert_prohibited_term(text,text,text,text,boolean) from public, anon;
grant execute on function public.admin_upsert_prohibited_term(text,text,text,text,boolean) to authenticated;

alter table public.prohibited_terms enable row level security;
do $$ begin
  create policy prohibited_terms_admin_read on public.prohibited_terms
    for select using (public.admin_has_perm('compliance.view') or public.admin_is_owner());
exception when duplicate_object then null; end $$;

-- The 0087 lesson: revoke from the ROLES by name, then assert it.
revoke all on public.prohibited_terms from public, anon, authenticated;

do $$
declare bad text;
begin
  select string_agg(distinct grantee||':'||privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where table_schema='public' and table_name='prohibited_terms'
     and grantee in ('anon','authenticated');
  if bad is not null then
    raise exception 'prohibited_terms must not be client-readable: %', bad;
  end if;
end $$;

notify pgrst, 'reload schema';
