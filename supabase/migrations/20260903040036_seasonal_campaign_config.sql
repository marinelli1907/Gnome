-- Seasonal Discovery campaign configuration.
--
-- This is intentionally a small read-only client surface, not a campaign CMS.
-- Rendering remains in shipped clients; copy and matching inputs can be changed
-- remotely after those clients support schema_version 1.

create table public.seasonal_campaigns (
  campaign_id text primary key,
  schema_version smallint not null default 1,
  enabled boolean not null default false,
  priority integer not null default 0,
  starts_on date not null,
  ends_on date not null,
  title text not null,
  subtitle text not null,
  icon_key text not null,
  keywords text[] not null default '{}',
  taxonomy_targets text[] not null default '{}',
  seller_prompt text not null,
  zordy_context text not null,
  search_chips jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint seasonal_campaign_id_format check (
    char_length(campaign_id) between 1 and 64
    and campaign_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  constraint seasonal_campaign_schema_supported check (schema_version = 1),
  constraint seasonal_campaign_priority_bounds check (priority between -1000 and 1000),
  constraint seasonal_campaign_date_order check (
    starts_on <= ends_on and ends_on - starts_on <= 370
  ),
  constraint seasonal_campaign_title_bounds check (
    char_length(title) between 1 and 80
    and btrim(title) = title
    and title !~ '[[:cntrl:]]'
    and title !~ '[<>]'
    and title !~* '(https?|mailto|javascript|data):|www[.]'
  ),
  constraint seasonal_campaign_subtitle_bounds check (
    char_length(subtitle) between 1 and 160
    and btrim(subtitle) = subtitle
    and subtitle !~ '[[:cntrl:]]'
    and subtitle !~ '[<>]'
    and subtitle !~* '(https?|mailto|javascript|data):|www[.]'
  ),
  constraint seasonal_campaign_icon_supported check (
    icon_key in ('leaf', 'sprout', 'sun', 'snowflake', 'gift', 'harvest')
  ),
  constraint seasonal_campaign_keyword_count check (cardinality(keywords) <= 24),
  constraint seasonal_campaign_taxonomy_count check (cardinality(taxonomy_targets) <= 24),
  constraint seasonal_campaign_has_matcher check (
    cardinality(keywords) + cardinality(taxonomy_targets) > 0
  ),
  constraint seasonal_campaign_seller_prompt_bounds check (
    char_length(seller_prompt) between 1 and 240
    and btrim(seller_prompt) = seller_prompt
    and seller_prompt !~ '[[:cntrl:]]'
    and seller_prompt !~ '[<>]'
    and seller_prompt !~* '(https?|mailto|javascript|data):|www[.]'
  ),
  constraint seasonal_campaign_zordy_context_bounds check (
    char_length(zordy_context) between 1 and 600
    and btrim(zordy_context) = zordy_context
    and zordy_context !~ '[[:cntrl:]]'
    and zordy_context !~ '[<>]'
    and zordy_context !~* '(https?|mailto|javascript|data):|www[.]'
  ),
  constraint seasonal_campaign_search_chips_shape check (
    jsonb_typeof(search_chips) = 'array'
    and jsonb_array_length(search_chips) <= 4
  )
);

comment on table public.seasonal_campaigns is
  'Validated, remotely configurable Seasonal Discovery campaigns. Clients have read-only access to enabled rows.';

create or replace function public.validate_seasonal_campaign_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_value text;
  v_chip jsonb;
  v_label text;
  v_query text;
  v_seen text[] := '{}';
begin
  foreach v_value in array new.keywords loop
    if v_value is null
       or char_length(v_value) not between 1 and 40
       or btrim(v_value) <> v_value
       or v_value ~ '[[:cntrl:]]'
       or v_value ~ '[<>]'
       or v_value ~* '(https?|mailto|javascript|data):|www[.]' then
      raise exception 'SEASONAL_INVALID_KEYWORD' using errcode = '23514';
    end if;

    if lower(v_value) = any(v_seen) then
      raise exception 'SEASONAL_DUPLICATE_KEYWORD' using errcode = '23514';
    end if;
    v_seen := array_append(v_seen, lower(v_value));
  end loop;

  v_seen := '{}';
  foreach v_value in array new.taxonomy_targets loop
    if v_value is null
       or char_length(v_value) not between 1 and 160
       or btrim(v_value) <> v_value
       or v_value !~ '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$' then
      raise exception 'SEASONAL_INVALID_TAXONOMY_TARGET' using errcode = '23514';
    end if;

    if v_value = any(v_seen) then
      raise exception 'SEASONAL_DUPLICATE_TAXONOMY_TARGET' using errcode = '23514';
    end if;

    if not exists (
      select 1
        from public.marketplace_taxonomy_nodes t
       where t.path = v_value
         and t.active
         and t.archived_at is null
    ) then
      raise exception 'SEASONAL_UNKNOWN_TAXONOMY_TARGET' using errcode = '23514';
    end if;
    v_seen := array_append(v_seen, v_value);
  end loop;

  v_seen := '{}';
  for v_chip in select value from jsonb_array_elements(new.search_chips) loop
    if jsonb_typeof(v_chip) <> 'object'
       or coalesce(
            (select array_agg(key order by key) from jsonb_object_keys(v_chip) keys(key)),
            '{}'::text[]
          )
          <> array['label', 'query']::text[]
       or jsonb_typeof(v_chip -> 'label') is distinct from 'string'
       or jsonb_typeof(v_chip -> 'query') is distinct from 'string' then
      raise exception 'SEASONAL_INVALID_SEARCH_CHIP' using errcode = '23514';
    end if;

    v_label := v_chip ->> 'label';
    v_query := v_chip ->> 'query';
    if char_length(v_label) not between 1 and 32
       or char_length(v_query) not between 1 and 64
       or btrim(v_label) <> v_label
       or btrim(v_query) <> v_query
       or v_label ~ '[[:cntrl:]]'
       or v_query ~ '[[:cntrl:]]'
       or v_label ~ '[<>]'
       or v_query ~ '[<>]'
       or v_label ~* '(https?|mailto|javascript|data):|www[.]'
       or v_query ~* '(https?|mailto|javascript|data):|www[.]' then
      raise exception 'SEASONAL_INVALID_SEARCH_CHIP' using errcode = '23514';
    end if;

    if lower(v_query) = any(v_seen) then
      raise exception 'SEASONAL_DUPLICATE_SEARCH_CHIP' using errcode = '23514';
    end if;
    v_seen := array_append(v_seen, lower(v_query));
  end loop;

  return new;
end;
$$;

revoke all on function public.validate_seasonal_campaign_row() from public, anon, authenticated;

create trigger seasonal_campaign_validate
  before insert or update on public.seasonal_campaigns
  for each row execute function public.validate_seasonal_campaign_row();

create trigger seasonal_campaign_set_updated_at
  before update on public.seasonal_campaigns
  for each row execute function public.set_updated_at();

create index seasonal_campaigns_active_lookup_idx
  on public.seasonal_campaigns (starts_on, ends_on, priority desc, campaign_id)
  where enabled;

alter table public.seasonal_campaigns enable row level security;

create policy seasonal_campaigns_read_enabled
  on public.seasonal_campaigns
  for select
  to anon, authenticated
  using (enabled);

create policy seasonal_campaigns_service_read
  on public.seasonal_campaigns
  for select
  to service_role
  using (true);

revoke all on table public.seasonal_campaigns from public, anon, authenticated, service_role;
grant select on table public.seasonal_campaigns to anon, authenticated;
grant select on table public.seasonal_campaigns to service_role;

-- Seed only. The owner enables this remotely after approved production mobile
-- builds contain the renderer and pass QA. Reapplying this insert cannot enable
-- or overwrite a campaign that has since been edited.
insert into public.seasonal_campaigns (
  campaign_id,
  schema_version,
  enabled,
  priority,
  starts_on,
  ends_on,
  title,
  subtitle,
  icon_key,
  keywords,
  taxonomy_targets,
  seller_prompt,
  zordy_context,
  search_chips
)
values (
  'fall-harvest-2026',
  1,
  false,
  100,
  date '2026-09-01',
  date '2026-10-31',
  'Fall harvest',
  'Fresh finds for crisp days and neighborhood tables.',
  'harvest',
  array[
    'apple', 'apples', 'pumpkin', 'pumpkins', 'squash', 'tomato', 'tomatoes',
    'pepper', 'peppers', 'honey', 'preserves', 'flower', 'flowers', 'gourd', 'gourds'
  ],
  array[
    'fruit/apples',
    'vegetables/squash',
    'vegetables/tomatoes',
    'vegetables/peppers',
    'honey-and-syrups',
    'preserves-and-pantry',
    'flowers',
    'garden-goods/decor'
  ],
  'Harvest season is here. List what is ready at your stand so nearby shoppers can find it.',
  'When relevant, use this campaign as optional seasonal context: fall harvest timing, storage, listing preparation, and local selling ideas.',
  '[{"label":"Apples","query":"apples"},{"label":"Pumpkins","query":"pumpkins"},{"label":"Preserves","query":"preserves"},{"label":"Fall decor","query":"fall decor"}]'::jsonb
)
on conflict (campaign_id) do nothing;
