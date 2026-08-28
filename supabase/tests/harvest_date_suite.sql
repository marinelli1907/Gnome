\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_true(p_label text, p_value boolean)
returns void language plpgsql as $$
begin
  if p_value is not true then
    raise exception 'FAIL: %', p_label;
  end if;
  raise notice 'PASS: %', p_label;
end;
$$;

select pg_temp.assert_true('harvest_date is nullable date with no default',
  (select data_type='date' and is_nullable='YES' and column_default is null
   from information_schema.columns
   where table_schema='public' and table_name='listings' and column_name='harvest_date'));

select pg_temp.assert_true('harvest_date has explicit client column grants',
  has_column_privilege('anon','public.listings','harvest_date','select')
  and has_column_privilege('authenticated','public.listings','harvest_date','select')
  and has_column_privilege('authenticated','public.listings','harvest_date','insert')
  and has_column_privilege('authenticated','public.listings','harvest_date','update'));

select pg_temp.assert_true('public_listings exposes harvest_date at the end',
  (select ordinal_position=(select max(ordinal_position)
                            from information_schema.columns
                            where table_schema='public' and table_name='public_listings')
   from information_schema.columns
   where table_schema='public' and table_name='public_listings' and column_name='harvest_date'));

select pg_temp.assert_true('existing active listing and inventory survive both repairs',
  (select status='active'::public.listing_status
          and inventory_count=17
          and harvest_date is null
   from public.listings
   where id='30000000-0000-0000-0000-000000000901'));

select pg_temp.assert_true('existing active listing remains on the public view',
  exists(select 1 from public.public_listings
         where id='30000000-0000-0000-0000-000000000901'));

select pg_temp.assert_true('payments remain disabled',
  not exists(select 1 from public.billing_config where payments_live_enabled));

rollback;
