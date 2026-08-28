-- Claim reservation integrity suite (run on a throwaway migrated DB).

\set ON_ERROR_STOP on
set client_min_messages = warning;

create temporary table _t (n int, name text, ok boolean, detail text);
create sequence if not exists _tn start 1;
create or replace function pg_temp.ck(p_name text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin insert into _t values (nextval('_tn')::int, p_name, coalesce(p_ok, false), p_detail); end $$;

create or replace function pg_temp.ck_raises(p_name text, p_sql text, p_fragment text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform pg_temp.ck(p_name, false, 'expected an exception, none raised');
  exception when others then
    perform pg_temp.ck(p_name, position(p_fragment in sqlerrm) > 0,
                       format('got: %s', left(sqlerrm, 120)));
  end;
end $$;

do $$
declare
  seller uuid := '01280000-0000-0000-0000-000000000001';
  buyer_a uuid := '01280000-0000-0000-0000-000000000002';
  buyer_b uuid := '01280000-0000-0000-0000-000000000003';
  market uuid := '01280000-1111-0000-0000-000000000001';
  listing uuid := '01280000-2222-0000-0000-000000000001';
  claim_a uuid := '01280000-3333-0000-0000-000000000001';
  claim_b uuid := '01280000-3333-0000-0000-000000000002';
  inv int;
  status text;
  n int;
begin
  insert into auth.users (id,email,email_confirmed_at,phone,phone_confirmed_at) values
    (seller,'claim-seller@test.invalid',now(),'+15550001001',now()),
    (buyer_a,'claim-a@test.invalid',now(),'+15550001002',now()),
    (buyer_b,'claim-b@test.invalid',now(),'+15550001003',now())
  on conflict (id) do update set
    email_confirmed_at=excluded.email_confirmed_at,
    phone=excluded.phone,
    phone_confirmed_at=excluded.phone_confirmed_at;
  insert into auth.identities (provider_id,user_id,identity_data,provider)
  select u.id::text,u.id,
         jsonb_build_object('sub',u.id::text,'email',u.email,'email_verified',true),
         'email'
  from auth.users u
  where u.id in (seller,buyer_a,buyer_b)
  on conflict (provider_id,provider) do update set
    identity_data=excluded.identity_data;
  insert into public.profiles (id, name) values
    (seller, 'Dana Seller'), (buyer_a, 'A Buyer'), (buyer_b, 'B Buyer')
  on conflict (id) do nothing;
  insert into public.account_policy_acceptances
    (user_id,terms_version,privacy_version,marketplace_rules_version,age_policy_version,age_confirmed_18)
  select u.id,v.terms_version,v.privacy_version,v.marketplace_rules_version,v.age_policy_version,true
  from (values (seller),(buyer_a),(buyer_b)) u(id)
  cross join public.account_policy_versions v
  where v.id
  on conflict (user_id) do update set
    terms_version=excluded.terms_version,
    privacy_version=excluded.privacy_version,
    marketplace_rules_version=excluded.marketplace_rules_version,
    age_policy_version=excluded.age_policy_version,
    age_confirmed_18=true;
  insert into public.markets (id, owner_id, name, plan, status)
  values (market, seller, 'Dana Market', 'free', 'active')
  on conflict (id) do nothing;

  insert into public.listings
    (id, owner_id, market_id, title, category, listing_type, status, price_cents, unit, inventory_count, expires_at)
  values
    (listing, seller, market, 'Reservation Zucchini', 'vegetables', 'sale',
     'active', 200, 'each', 8, now() + interval '7 days')
  on conflict (id) do update set inventory_count = 8, status = 'active';

  insert into public.claims
    (id, listing_id, claimer_id, status, claim_type, quantity_requested,
     agreed_price_cents, payment_status, payment_method)
  values
    (claim_a, listing, buyer_a, 'pending', 'purchase_request', 6, 1200, 'external', 'venmo'),
    (claim_b, listing, buyer_b, 'pending', 'purchase_request', 5, 1000, 'external', 'cash')
  on conflict (listing_id, claimer_id) do update
    set status = excluded.status,
        claim_type = excluded.claim_type,
        quantity_requested = excluded.quantity_requested,
        agreed_price_cents = excluded.agreed_price_cents,
        payment_status = excluded.payment_status,
        payment_method = excluded.payment_method;

  select inventory_count, listings.status::text into inv, status
  from public.listings where id = listing;
  perform pg_temp.ck('pending requests do not consume inventory',
    inv = 8 and status = 'active', format('inv=%s status=%s', inv, status));

  update public.claims set status = 'approved' where id = claim_a;
  select inventory_count, listings.status::text into inv, status
  from public.listings where id = listing;
  perform pg_temp.ck('approval reserves requested quantity and keeps listing active',
    inv = 2 and status = 'active', format('inv=%s status=%s', inv, status));

  perform pg_temp.ck_raises('oversell approval is refused',
    format('update public.claims set status = %L where id = %L', 'approved', claim_b),
    'INSUFFICIENT_INVENTORY');
  select inventory_count into inv from public.listings where id = listing;
  perform pg_temp.ck('failed oversell leaves inventory unchanged', inv = 2, inv::text);

  update public.claims set status = 'cancelled' where id = claim_a;
  select inventory_count, listings.status::text into inv, status
  from public.listings where id = listing;
  perform pg_temp.ck('cancellation releases reserved inventory',
    inv = 8 and status = 'active', format('inv=%s status=%s', inv, status));

  update public.claims set status = 'pending' where id = claim_a;
  update public.claims set status = 'approved' where id = claim_a;
  update public.claims set status = 'completed' where id = claim_a;
  select count(*) into n
  from public.seller_transactions
  where claim_id = claim_a
    and seller_transactions.status = 'completed'
    and quantity = 6
    and gross_cents = 1200
    and payment_method = 'venmo';
  perform pg_temp.ck('completion writes one off-platform seller ledger row', n = 1, n::text);

  update public.claims set status = 'completed' where id = claim_a;
  select count(*) into n
  from public.seller_transactions
  where claim_id = claim_a and seller_transactions.status = 'completed';
  perform pg_temp.ck('completion is idempotent for seller ledger', n = 1, n::text);
end $$;

select case when ok then 'PASS' else 'FAIL' end as result, n, name, detail
from _t
order by n;

do $$
declare fails int;
begin
  select count(*) into fails from _t where not ok;
  if fails > 0 then raise exception '% claim reservation checks failed', fails; end if;
end $$;
