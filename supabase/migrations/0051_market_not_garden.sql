-- 0051: a storefront is a Market, not a garden.
--
-- "Garden" dates from when Gnome sold only produce. The taxonomy round added
-- meat, eggs, live bait, pet food, and firewood — a butcher does not have a
-- garden. Everything else in the product already says Market (the table, the
-- web nav, the pickup flow), so this aligns the default name with the domain
-- language instead of inventing new vocabulary.
--
-- Slugs are deliberately NOT touched: they are stable public identifiers and
-- rewriting them would break every shared storefront link.

alter table public.markets alter column name set default 'My Market';

create or replace function public.handle_new_profile()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  mid uuid := gen_random_uuid();
  nm  text := coalesce(nullif(trim(new.name), ''), 'Neighbor') || '''s Market';
begin
  insert into public.markets (id, owner_id, name, slug)
  values (mid, new.id, nm, public.gnome_slugify(nm) || '-' || substr(mid::text, 1, 8));

  insert into public.market_members (market_id, user_id, role)
  values (mid, new.id, 'owner')
  on conflict (market_id, user_id) do nothing;

  insert into public.events (event_type, user_id, metadata)
  values ('market_created', new.id, jsonb_build_object('market_id', mid));

  return new;
end;
$$;

-- Backfill ONLY names that are still the machine-generated default — i.e. the
-- exact string the old trigger would have produced, or the old column default.
-- A name the owner actually typed is their words and is never rewritten.
update public.markets m
   set name = regexp_replace(m.name, '''s Garden$', '''s Market')
  from public.profiles p
 where p.id = m.owner_id
   and m.name = coalesce(nullif(trim(p.name), ''), 'Neighbor') || '''s Garden';

update public.markets set name = 'My Market' where name = 'My Garden';
