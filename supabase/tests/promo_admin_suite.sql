-- Promo admin surface: the three 0106 RPCs as the admin UI actually calls them, and the
-- eligibility regression that must survive any amount of admin UI work.
--
-- The admin console is NOT the security boundary — promo_validate inside billing-checkout is.
-- So the assertions that matter most here are the last block: after every create/edit/toggle this
-- suite performs, FOUNDING3 + Pro must still validate and FOUNDING3 + Max/Farm must still be
-- refused. If an admin-surface change ever flips those, the console has leaked into the boundary.
--
-- Run against a THROWAWAY database (0104-0109 applied).

\set ON_ERROR_STOP on
set client_min_messages = warning;

create temporary table _pa (n int, name text, ok boolean, detail text);
create sequence if not exists _pan start 1;
create or replace function pg_temp.ck(a text, b boolean, c text default '')
returns void language plpgsql as $$ begin insert into _pa values (nextval('_pan')::int,a,b,c); end $$;

-- Expect an admin_upsert_promo_campaign payload to be REFUSED by the server.
create or replace function pg_temp.ck_upsert_fails(p_name text, p_payload jsonb)
returns void language plpgsql as $$
begin
  begin
    perform public.admin_upsert_promo_campaign(p_payload);
    perform pg_temp.ck(p_name, false, 'server accepted it');
  exception when others then
    perform pg_temp.ck(p_name, true, left(sqlerrm, 60));
  end;
end $$;

-- Admin identity for the passthrough half; flipped off again for the security half.
create or replace function public.is_admin() returns boolean language sql stable as $f$ select true $f$;

-- ---- FOUNDING3 as the console first sees it -------------------------------
do $$
declare c record;
begin
  select * into c from public.admin_promo_campaigns() where code = 'FOUNDING3';
  perform pg_temp.ck('FOUNDING3 is listed', c.code = 'FOUNDING3');
  perform pg_temp.ck('FOUNDING3 applies to grower (customer-facing Pro)',
                     c.applicable_plans = array['grower']::public.market_plan[],
                     array_to_string(c.applicable_plans, ','));
  perform pg_temp.ck('FOUNDING3 is 100 percent', c.discount_type = 'percent' and c.discount_percent = 100);
  perform pg_temp.ck('FOUNDING3 repeats for 3 months', c.duration = 'repeating' and c.duration_in_months = 3);
  perform pg_temp.ck('FOUNDING3 is active', c.active);
  perform pg_temp.ck('FOUNDING3 starts with 0 redemptions', c.redeemed = 0, c.redeemed::text);
  -- The one Stripe fact an admin operationally needs: an unconfigured campaign cannot be redeemed
  -- (promo_validate answers NOT_CONFIGURED), and the console must be able to say so.
  perform pg_temp.ck('configured=false until a Stripe promotion code is wired', c.configured = false);
end $$;

-- ---- create / edit / toggle lifecycle -------------------------------------
do $$
declare cid uuid; c record; n int;
begin
  -- Create. Lowercase code on purpose: the server, not the UI, owns normalization.
  cid := public.admin_upsert_promo_campaign(jsonb_build_object(
    'code','summer10','campaign_name','Summer tenner','active',true,
    'applicable_plans',jsonb_build_array('grower','farm'),
    'discount_type','percent','discount_percent',10,'duration','once',
    'max_redemptions',100,'max_redemptions_per_user',1,'new_customers_only',true,
    'internal_notes','suite fixture'));
  select * into c from public.admin_promo_campaigns() where id = cid;
  perform pg_temp.ck('create: code is normalized to upper case server-side', c.code = 'SUMMER10', c.code);
  perform pg_temp.ck('create: plans land as given', c.applicable_plans = array['grower','farm']::public.market_plan[]);
  perform pg_temp.ck('create: new-customer flag persists', c.new_customers_only);

  -- Edit by id: full payload, changed name and percent.
  perform public.admin_upsert_promo_campaign(jsonb_build_object(
    'id',cid,'code','SUMMER10','campaign_name','Summer 15','active',true,
    'applicable_plans',jsonb_build_array('grower','farm'),
    'discount_type','percent','discount_percent',15,'duration','once',
    'max_redemptions',100,'max_redemptions_per_user',1,'new_customers_only',true));
  select * into c from public.admin_promo_campaigns() where id = cid;
  perform pg_temp.ck('edit: same row updated, not duplicated',
                     (select count(*) from public.promotion_campaigns where code='SUMMER10') = 1);
  perform pg_temp.ck('edit: values changed', c.campaign_name = 'Summer 15' and c.discount_percent = 15);

  -- Deactivate = full payload with active=false. A partial {id,active} payload is pinned as a
  -- REFUSAL below, so the UI's resend-everything behaviour is contract, not superstition.
  perform public.admin_upsert_promo_campaign(jsonb_build_object(
    'id',cid,'code','SUMMER10','campaign_name','Summer 15','active',false,
    'applicable_plans',jsonb_build_array('grower','farm'),
    'discount_type','percent','discount_percent',15,'duration','once',
    'max_redemptions',100,'max_redemptions_per_user',1,'new_customers_only',true));
  select * into c from public.admin_promo_campaigns() where id = cid;
  perform pg_temp.ck('deactivate: active=false lands', c.active = false);

  -- Reactivate.
  perform public.admin_upsert_promo_campaign(jsonb_build_object(
    'id',cid,'code','SUMMER10','campaign_name','Summer 15','active',true,
    'applicable_plans',jsonb_build_array('grower','farm'),
    'discount_type','percent','discount_percent',15,'duration','once',
    'max_redemptions',100,'max_redemptions_per_user',1,'new_customers_only',true));
  perform pg_temp.ck('reactivate: active=true lands',
                     (select active from public.promotion_campaigns where id = cid));

  -- Every audited write left a row.
  select count(*)::int into n from public.admin_audit_log
   where action = 'promo_campaign_upsert' and resource_id = cid::text;
  perform pg_temp.ck('every upsert is audited', n = 4, n::text);
end $$;

-- ---- server rejections the form must surface, not pre-empt ----------------
do $$
begin
  perform pg_temp.ck_upsert_fails('percent above 100 is refused', jsonb_build_object(
    'code','BAD1','campaign_name','x','discount_type','percent','discount_percent',150,'duration','once'));
  perform pg_temp.ck_upsert_fails('negative amount is refused', jsonb_build_object(
    'code','BAD2','campaign_name','x','discount_type','amount','discount_amount_cents',-500,'duration','once'));
  perform pg_temp.ck_upsert_fails('end date before start date is refused', jsonb_build_object(
    'code','BAD3','campaign_name','x','discount_type','percent','discount_percent',10,'duration','once',
    'starts_at','2026-09-01T00:00:00Z','expires_at','2026-08-01T00:00:00Z'));
  perform pg_temp.ck_upsert_fails('unknown plan value is refused', jsonb_build_object(
    'code','BAD4','campaign_name','x','discount_type','percent','discount_percent',10,'duration','once',
    'applicable_plans',jsonb_build_array('platinum')));
  perform pg_temp.ck_upsert_fails('repeating without a month count is refused', jsonb_build_object(
    'code','BAD5','campaign_name','x','discount_type','percent','discount_percent',10,'duration','repeating'));
  perform pg_temp.ck_upsert_fails('negative redemption limit is refused', jsonb_build_object(
    'code','BAD6','campaign_name','x','discount_type','percent','discount_percent',10,'duration','once',
    'max_redemptions',-5));
  -- The full-payload contract: toggling active with a partial payload must fail loudly rather
  -- than null out the discount.
  perform pg_temp.ck_upsert_fails('partial payload toggle is refused, not silently destructive',
    jsonb_build_object('id',(select id from public.promotion_campaigns where code='SUMMER10'),
                       'code','SUMMER10','campaign_name','Summer 15','active',false));
end $$;

-- ---- redemption history ---------------------------------------------------
do $$
declare camp uuid; u1 uuid := '00000000-0000-0000-0000-0000000000a1';
        u2 uuid := '00000000-0000-0000-0000-0000000000a2'; m uuid; r record; c record; n int;
begin
  select id into camp from public.promotion_campaigns where code = 'FOUNDING3';
  insert into auth.users (id, email) values (u1,'first@example.com'), (u2,'second@example.com')
    on conflict do nothing;
  insert into public.markets (owner_id, plan) values (u1,'grower') returning id into m;

  perform public.record_promo_redemption(camp, u1, m, 'grower', 'cs_pa_1', 'sub_pa_1', 'cus_pa_1', 999);
  perform public.record_promo_redemption(camp, u2, null, 'grower', 'cs_pa_2', 'sub_pa_2', 'cus_pa_2', 999);
  update public.promotion_redemptions set status = 'cancelled', cancelled_at = now()
   where stripe_session_id = 'cs_pa_2';

  select count(*)::int into n from public.admin_promo_redemptions(camp);
  perform pg_temp.ck('redemption history lists both rows', n = 2, n::text);
  select * into r from public.admin_promo_redemptions(camp) where email = 'first@example.com';
  perform pg_temp.ck('history carries user, plan and status',
                     r.plan = 'grower' and r.status = 'redeemed' and r.amount_discounted_cents = 999);

  -- Counts are the SERVER's: redeemed excludes the cancellation, cancelled counts it.
  select * into c from public.admin_promo_campaigns() where id = camp;
  perform pg_temp.ck('campaign counts come back computed: redeemed=1', c.redeemed = 1, c.redeemed::text);
  perform pg_temp.ck('campaign counts come back computed: cancelled=1', c.cancelled = 1, c.cancelled::text);

  -- Editing and deactivating must never touch history.
  perform public.admin_upsert_promo_campaign(jsonb_build_object(
    'id',camp,'code','FOUNDING3','campaign_name','Founding Seller — first 3 months free','active',false,
    'applicable_plans',jsonb_build_array('grower'),
    'discount_type','percent','discount_percent',100,'duration','repeating','duration_in_months',3,
    'max_redemptions_per_user',1,'new_customers_only',false));
  select count(*)::int into n from public.promotion_redemptions where campaign_id = camp;
  perform pg_temp.ck('deactivating a campaign preserves its redemption history', n = 2, n::text);

  -- Deactivation blocks NEW redemptions at the boundary that matters.
  update public.promotion_campaigns set stripe_promotion_code_id = 'promo_pa_test' where id = camp;
  select * into r from public.promo_validate('FOUNDING3','grower',u2);
  perform pg_temp.ck('deactivated campaign refuses new redemptions (INVALID_CODE)',
                     r.ok = false and r.reason = 'INVALID_CODE', r.reason);

  -- Restore active for the regression block.
  perform public.admin_upsert_promo_campaign(jsonb_build_object(
    'id',camp,'code','FOUNDING3','campaign_name','Founding Seller — first 3 months free','active',true,
    'applicable_plans',jsonb_build_array('grower'),
    'discount_type','percent','discount_percent',100,'duration','repeating','duration_in_months',3,
    'max_redemptions_per_user',1,'new_customers_only',false));
end $$;

-- ---- THE ELIGIBILITY REGRESSION -------------------------------------------
-- After everything the console just did: Pro yes, Max no, Farm no. billing-checkout calls
-- promo_validate with exactly these arguments before any Stripe session exists.
do $$
declare u uuid := '00000000-0000-0000-0000-0000000000a3'; v record;
begin
  insert into auth.users (id) values (u) on conflict do nothing;
  select * into v from public.promo_validate('FOUNDING3','grower',u);
  perform pg_temp.ck('REGRESSION: FOUNDING3 + Pro (grower) still validates', v.ok, v.reason);
  select * into v from public.promo_validate('FOUNDING3','farm',u);
  perform pg_temp.ck('REGRESSION: FOUNDING3 + Max (farm) still refused',
                     v.ok = false and v.reason = 'WRONG_PLAN', v.reason);
  select * into v from public.promo_validate('FOUNDING3','sponsor',u);
  perform pg_temp.ck('REGRESSION: FOUNDING3 + Farm (sponsor) still refused',
                     v.ok = false and v.reason = 'WRONG_PLAN', v.reason);
end $$;

-- ---- security: non-admin --------------------------------------------------
create or replace function public.is_admin() returns boolean language sql stable as $f$ select false $f$;

do $$
declare hit boolean;
begin
  begin
    perform * from public.admin_promo_campaigns(); hit := true;
  exception when others then
    perform pg_temp.ck('non-admin cannot list campaigns', position('admin only' in sqlerrm) > 0, sqlerrm);
    hit := false;
  end;
  if hit then perform pg_temp.ck('non-admin cannot list campaigns', false, 'no exception'); end if;

  begin
    perform * from public.admin_promo_redemptions(gen_random_uuid()); hit := true;
  exception when others then
    perform pg_temp.ck('non-admin cannot list redemptions', position('admin only' in sqlerrm) > 0, sqlerrm);
    hit := false;
  end;
  if hit then perform pg_temp.ck('non-admin cannot list redemptions', false, 'no exception'); end if;

  begin
    perform public.admin_upsert_promo_campaign(jsonb_build_object(
      'code','SNEAKY','campaign_name','x','discount_type','percent','discount_percent',100,'duration','forever'));
    hit := true;
  exception when others then
    perform pg_temp.ck('non-admin cannot upsert a campaign', position('admin only' in sqlerrm) > 0, sqlerrm);
    hit := false;
  end;
  if hit then perform pg_temp.ck('non-admin cannot upsert a campaign', false, 'no exception'); end if;

  perform pg_temp.ck('authenticated can EXECUTE the RPCs (is_admin is the gate, per 0109)',
    has_function_privilege('authenticated','public.admin_promo_campaigns()','execute')
    and has_function_privilege('authenticated','public.admin_upsert_promo_campaign(jsonb)','execute'));
  perform pg_temp.ck('anon cannot execute any of the three',
    not has_function_privilege('anon','public.admin_promo_campaigns()','execute')
    and not has_function_privilege('anon','public.admin_promo_redemptions(uuid)','execute')
    and not has_function_privilege('anon','public.admin_upsert_promo_campaign(jsonb)','execute'));
  perform pg_temp.ck('clients cannot read promotion_campaigns directly',
    not has_table_privilege('authenticated','public.promotion_campaigns','select'));
  perform pg_temp.ck('promo_validate remains client-unreachable (no enumeration oracle)',
    not has_function_privilege('authenticated','public.promo_validate(text, public.market_plan, uuid)','execute'));
end $$;

\echo ''
select format('%s  %-64s %s', lpad(n::text,3,' '), name, case when ok then 'PASS' else 'FAIL  '||detail end)
from _pa order by n;
\echo ''
select format('promo admin suite: %s/%s passed', count(*) filter (where ok), count(*)) from _pa;
do $$ declare bad int; begin select count(*) into bad from _pa where not ok;
  if bad > 0 then raise exception '% failed', bad; end if; end $$;
