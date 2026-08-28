-- 0056: Seed Drop — greenhouse, multi-select answers, and an editable
-- recommendation preview.
--
-- Every question that has options is now multi-answer. Zone stays single
-- because it's one fact about where you live (derived from ZIP), not a
-- preference. Legacy singular columns are kept and mirrored so the existing
-- engine, admin views and any in-flight orders keep working.

alter table public.seed_profiles
  add column if not exists suns text[] not null default '{}',
  add column if not exists experiences text[] not null default '{}',
  add column if not exists packet_count int;

-- Backfill the arrays from the single-value columns.
update public.seed_profiles
   set suns = case when coalesce(sun, '') <> '' then array[sun] else '{}' end
 where suns = '{}';
update public.seed_profiles
   set experiences = case when coalesce(experience, '') <> '' then array[experience] else '{}' end
 where experiences = '{}';

-- ---------------------------------------------------------------------------
-- Shared matcher: one definition of "does this product suit this profile", so
-- the preview a buyer sees and the box the engine actually packs can never
-- disagree.
create or replace function public.seed_profile_matches(
  p_preferred_sun text, p_beginner_friendly boolean, p_container_friendly boolean,
  p_suns text[], p_experiences text[], p_sizes text[]
) returns boolean
language sql immutable as $$
  select
    -- Sun: no answer (or "unsure") means no filter. 'full' also accepts
    -- partial-sun crops, which tolerate more light than they need.
    (coalesce(array_length(p_suns, 1), 0) = 0
       or 'unsure' = any(p_suns)
       or p_preferred_sun = 'any'
       or p_preferred_sun = any(p_suns)
       or ('full' = any(p_suns) and p_preferred_sun = 'partial'))
  and
    -- Experience: only restrict to beginner-friendly when first-timer is the
    -- ONLY thing selected. Someone who is a first-timer AND experienced with
    -- something else doesn't need training wheels.
    (coalesce(array_length(p_experiences, 1), 0) = 0
       or p_experiences <> array['first_time']
       or p_beginner_friendly)
  and
    -- Space: container-only growers get container-friendly crops. A
    -- greenhouse or any in-ground bed lifts that restriction.
    (coalesce(array_length(p_sizes, 1), 0) = 0
       or not (p_sizes <@ array['windowsill','containers'])
       or p_container_friendly);
$$;

-- ---------------------------------------------------------------------------
-- What Gnome would pick, WITHOUT reserving anything: the buyer sees this,
-- then adds/removes/swaps before paying. Only in-season, in-stock, eligible
-- lots appear, so a recommendation can never point at seed we don't have.
create or replace function public.seed_recommendations(
  p_zone int default 6,
  p_suns text[] default '{}',
  p_experiences text[] default '{}',
  p_sizes text[] default '{}',
  p_preferences text[] default '{}',
  p_exclusions text[] default '{}',
  p_limit int default 24
) returns table(
  product_id uuid, crop text, variety text, category text, description text,
  days_to_maturity int, packet_seed_count int, beginner_friendly boolean,
  container_friendly boolean, preferred_sun text, in_stock int,
  recommended boolean, why text
)
language plpgsql stable security definer set search_path = public as $$
declare month0 int; shift int;
begin
  shift  := case when p_zone >= 8 then 1 when p_zone <= 4 then -1 else 0 end;
  month0 := ((extract(month from now())::int - 1 - shift) % 12 + 12) % 12 + 1;

  return query
  with avail as (
    select p.id, p.crop, p.variety, p.category, p.description,
           p.days_to_maturity, p.packet_seed_count, p.beginner_friendly,
           p.container_friendly, p.preferred_sun, p.tags,
           sum(l.current_qty)::int as qty,
           max(coalesce(l.germination_pct, 85)) as germ
      from public.seed_products p
      join public.seed_lots l on l.seed_product_id = p.id
     where p.active and public.seed_lot_eligible(l) and l.current_qty > 0
     group by p.id
  ), scored as (
    select a.*,
           (lower(a.crop) = any(p_preferences)
            or lower(a.category) = any(p_preferences)
            or exists (select 1 from unnest(a.tags) t where lower(t) = any(p_preferences))) as preferred,
           (a.sow_months_ok) as in_season
      from (select av.*, (select p2.sow_months @> array[month0]
                            from public.seed_products p2 where p2.id = av.id) as sow_months_ok
              from avail av) a
     where not (lower(a.crop) = any(p_exclusions))
       and not (lower(a.category) = any(p_exclusions))
       and public.seed_profile_matches(a.preferred_sun, a.beginner_friendly,
                                       a.container_friendly, p_suns, p_experiences, p_sizes)
  )
  select s.id, s.crop, s.variety, s.category, s.description,
         s.days_to_maturity, s.packet_seed_count, s.beginner_friendly,
         s.container_friendly, s.preferred_sun, s.qty,
         -- "recommended" = what Gnome would choose on its own; everything else
         -- is still offered so the buyer can overrule us.
         (s.in_season and s.qty > 0) as recommended,
         concat_ws(' · ',
           case when s.in_season then 'in season now' else 'out of season for your zone' end,
           case when s.preferred then 'matches what you picked' end,
           case when s.beginner_friendly then 'easy to grow' end,
           s.germ || '% germination')
    from scored s
   order by (s.in_season and s.qty > 0) desc, s.preferred desc, s.germ desc, s.crop
   limit greatest(1, least(p_limit, 60));
end $$;
grant execute on function public.seed_recommendations(int, text[], text[], text[], text[], text[], int)
  to anon, authenticated;