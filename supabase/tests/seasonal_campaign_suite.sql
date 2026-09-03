\set ON_ERROR_STOP on

do $$
declare
  v_enabled boolean;
  v_rls boolean;
  v_index text;
  v_guard text;
begin
  select enabled into v_enabled
    from public.seasonal_campaigns
   where campaign_id = 'fall-harvest-2026';
  if v_enabled is distinct from false then
    raise exception 'production seed must be disabled';
  end if;

  select relrowsecurity into v_rls
    from pg_class
   where oid = 'public.seasonal_campaigns'::regclass;
  if not v_rls then raise exception 'seasonal campaigns RLS is not enabled'; end if;

  if exists (
    select 1
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'seasonal_campaigns'
       and grantee in ('anon', 'authenticated', 'service_role')
       and privilege_type <> 'SELECT'
  ) then
    raise exception 'a client role has seasonal campaign write privileges';
  end if;

  select indexdef into v_index
    from pg_indexes
   where schemaname = 'public'
     and indexname = 'seasonal_campaigns_active_lookup_idx';
  if v_index is null or v_index not like '%WHERE enabled%' then
    raise exception 'enabled/date/priority lookup index missing';
  end if;

  select pg_get_functiondef('public.events_guard()'::regprocedure) into v_guard;
  if v_guard not like '%listing_viewed%'
     or v_guard not like '%pg_advisory_xact_lock%'
     or v_guard not like '%30 minutes%'
     or v_guard not like '%EVENT_METADATA_TOO_LARGE%'
     or v_guard not like '%EVENT_RATE_LIMITED%' then
    raise exception 'analytics migration weakened the existing event guard';
  end if;
end $$;

set role anon;
select set_config('request.jwt.claims','{"role":"anon"}',false);
do $$
begin
  if (select count(*) from public.seasonal_campaigns) <> 0 then
    raise exception 'anon saw a disabled campaign';
  end if;
  begin
    insert into public.seasonal_campaigns (
      campaign_id,starts_on,ends_on,title,subtitle,icon_key,keywords,
      taxonomy_targets,seller_prompt,zordy_context
    ) values (
      'client-write',current_date,current_date,'Bad','Bad','leaf',array['bad'],
      '{}','Bad','Bad'
    );
    raise exception 'anon unexpectedly inserted a campaign';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.seasonal_campaigns set title = 'Changed';
    raise exception 'anon unexpectedly updated a campaign';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.seasonal_campaigns;
    raise exception 'anon unexpectedly deleted a campaign';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-4000-8000-000000000001"}',false);
do $$
begin
  if (select count(*) from public.seasonal_campaigns) <> 0 then
    raise exception 'authenticated client saw a disabled campaign';
  end if;
  begin
    update public.seasonal_campaigns set enabled = true;
    raise exception 'authenticated client unexpectedly updated a campaign';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

update public.seasonal_campaigns
   set enabled = true
 where campaign_id = 'fall-harvest-2026';

set role service_role;
do $$
begin
  if (select count(*) from public.seasonal_campaigns) <> 1 then
    raise exception 'Edge Function service role cannot read enabled campaign';
  end if;
  begin
    update public.seasonal_campaigns set title = 'Edge write';
    raise exception 'Edge Function service role unexpectedly updated campaign';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set role anon;
select set_config('request.jwt.claims','{"role":"anon"}',false);
do $$
begin
  if (select count(*) from public.seasonal_campaigns) <> 1 then
    raise exception 'anon did not see exactly the enabled campaign';
  end if;
end $$;
reset role;

do $$
begin
  begin
    update public.seasonal_campaigns set title = repeat('x', 81)
     where campaign_id = 'fall-harvest-2026';
    raise exception 'title maximum was not enforced';
  exception when check_violation then null;
  end;
  begin
    update public.seasonal_campaigns set schema_version = 2
     where campaign_id = 'fall-harvest-2026';
    raise exception 'schema version was not enforced';
  exception when check_violation then null;
  end;
  begin
    update public.seasonal_campaigns set icon_key = 'remote-svg'
     where campaign_id = 'fall-harvest-2026';
    raise exception 'icon allowlist was not enforced';
  exception when check_violation then null;
  end;
  begin
    update public.seasonal_campaigns
       set keywords = array_fill('valid'::text, array[25])
     where campaign_id = 'fall-harvest-2026';
    raise exception 'keyword maximum was not enforced';
  exception when check_violation then null;
  end;
  begin
    update public.seasonal_campaigns
       set search_chips = '[{"label":"1","query":"1"},{"label":"2","query":"2"},{"label":"3","query":"3"},{"label":"4","query":"4"},{"label":"5","query":"5"}]'::jsonb
     where campaign_id = 'fall-harvest-2026';
    raise exception 'search chip maximum was not enforced';
  exception when check_violation then null;
  end;
  begin
    update public.seasonal_campaigns
       set taxonomy_targets = array['vegetables/not-a-real-node']
     where campaign_id = 'fall-harvest-2026';
    raise exception 'unknown taxonomy target was not rejected';
  exception when check_violation then null;
  end;
  begin
    update public.seasonal_campaigns
       set search_chips = '[{"label":"Corn","query":"corn","href":"/bad"}]'::jsonb
     where campaign_id = 'fall-harvest-2026';
    raise exception 'unexpected search chip fields were not rejected';
  exception when check_violation then null;
  end;
  begin
    update public.seasonal_campaigns
       set search_chips = '[{}]'::jsonb
     where campaign_id = 'fall-harvest-2026';
    raise exception 'missing search chip fields were not rejected';
  exception when check_violation then null;
  end;
  begin
    update public.seasonal_campaigns
       set keywords = array[null::text]
     where campaign_id = 'fall-harvest-2026';
    raise exception 'null keyword was not rejected';
  exception when check_violation then null;
  end;
  begin
    update public.seasonal_campaigns
       set title = '<b>Remote markup</b>'
     where campaign_id = 'fall-harvest-2026';
    raise exception 'remote markup was not rejected';
  exception when check_violation then null;
  end;
  begin
    update public.seasonal_campaigns
       set zordy_context = 'Visit https://example.com for instructions.'
     where campaign_id = 'fall-harvest-2026';
    raise exception 'remote link was not rejected';
  exception when check_violation then null;
  end;
end $$;

set role anon;
select set_config('request.jwt.claims','{"role":"anon"}',false);
insert into public.events(event_type, metadata) values
  ('seasonal_section_viewed', '{"campaign_id":"fall-harvest-2026"}'),
  ('seasonal_listing_clicked', '{"campaign_id":"fall-harvest-2026"}'),
  ('seasonal_seller_cta_clicked', '{"campaign_id":"fall-harvest-2026"}'),
  ('seasonal_search_chip_clicked', '{"campaign_id":"fall-harvest-2026"}'),
  ('web_seasonal_section_viewed', '{"campaign_id":"fall-harvest-2026"}'),
  ('web_seasonal_listing_clicked', '{"campaign_id":"fall-harvest-2026"}'),
  ('web_seasonal_seller_cta_clicked', '{"campaign_id":"fall-harvest-2026"}'),
  ('web_seasonal_search_chip_clicked', '{"campaign_id":"fall-harvest-2026"}');

do $$
begin
  begin
    insert into public.events(event_type) values ('seasonal_not_allowed');
    raise exception 'unexpected seasonal event passed the allowlist';
  exception when others then
    if sqlerrm not like '%EVENT_NOT_ALLOWED%' then raise; end if;
  end;
  begin
    insert into public.events(event_type,metadata)
    values ('seasonal_section_viewed', jsonb_build_object('too_large', repeat('x', 600)));
    raise exception 'oversized event metadata was accepted';
  exception when others then
    if sqlerrm not like '%EVENT_METADATA_TOO_LARGE%' then raise; end if;
  end;
end $$;
reset role;

\echo 'Seasonal campaign database contract suite: PASS'
