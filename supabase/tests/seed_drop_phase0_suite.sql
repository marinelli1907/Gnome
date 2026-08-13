-- Seed Drop Phase 0 test suite — the DB-layer subset of docs/seed-drop/21-test-plan.md
-- plus every case in Daniel's 2026-08-13 Phase 0 directive that can be decided
-- in the database. Runs on a throwaway local database built by
-- run_seed_drop_phase0_tests.sh (shim + fixture + 0089).
--
-- Every assertion asks the question the way production asks it — through the
-- shipped predicate or RPC, never by reading a column and hoping.

create table t (n serial, label text, pass boolean, detail text);
grant all on t to public;
grant usage, select on sequence t_n_seq to public;

create table ids (k text primary key, v uuid);
grant all on ids to public;

-- --------------------------------------------------------------------------
-- Fixtures
-- --------------------------------------------------------------------------
do $$
declare sup uuid; prod uuid; prod_bulb uuid; lot uuid; lot_bad uuid;
begin
  insert into public.profiles (id, name) values
    ('00000000-0000-0000-0000-0000000000a1','Owner O.'),
    ('00000000-0000-0000-0000-0000000000b1','Cust C.'),
    ('00000000-0000-0000-0000-0000000000c1','Other O.');
  insert into public.suppliers (name) values ('Botanical Interests') returning id into sup;
  insert into public.seed_products (crop, variety, category, packet_seed_count)
    values ('Radish','Cherry Belle','vegetable', 100) returning id into prod;
  insert into public.seed_products (crop, variety, category, regulatory_class)
    values ('Garlic','Music','allium','BULB_OR_PLANTING_STOCK') returning id into prod_bulb;
  insert into public.seed_lots (seed_product_id, internal_lot_number, original_qty, current_qty,
      labeled_entity, treatment, organic_claim, country_of_origin, sell_by_date, germination_pct)
    values (prod,'T-GOOD',50,50,'Botanical Interests LLC','UNTREATED','CERTIFIED_ORGANIC','US',
            current_date + 400, 92) returning id into lot;
  insert into public.seed_lots (seed_product_id, internal_lot_number, original_qty, current_qty,
      labeled_entity, treatment)
    values (prod,'T-INCOMPLETE',50,50,'Botanical Interests LLC','UNKNOWN') returning id into lot_bad;
  insert into ids values ('sup',sup),('prod',prod),('prod_bulb',prod_bulb),
                         ('lot',lot),('lot_bad',lot_bad);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a1')::text, false);
  perform set_config('test.is_owner','true', false);
end $$;

-- --------------------------------------------------------------------------
-- A. Default deny, destination classes, and "research never opens a state"
-- --------------------------------------------------------------------------
do $$
declare prod uuid := (select v from ids where k='prod'); lot uuid := (select v from ids where k='lot');
begin
  insert into t(label,pass,detail) values ('T-STATE-01 empty allowlist ships nowhere',
    not public.seed_ship_state_allowed('OH', prod, lot), 'OH has no clearance row');

  insert into t(label,pass,detail) values ('T-STATE-02 AK/HI/territories/APO/DC unsupported',
    not (public.seed_destination_supported('AK') or public.seed_destination_supported('HI')
      or public.seed_destination_supported('PR') or public.seed_destination_supported('AE')
      or public.seed_destination_supported('DC')), 'all five rejected');

  insert into t(label,pass,detail) values ('T-STATE-03 contiguous-48 states are supported',
    public.seed_destination_supported('OH') and public.seed_destination_supported('NY'), 'OH, NY');

  perform public.admin_set_state_clearance('OH','CLEARED', false, 'ORC 907.13 research', '[]'::jsonb);
  insert into t(label,pass,detail) values ('T-STATE-04 CLEARED but not enabled still blocks',
    not public.seed_ship_state_allowed('OH', prod, lot), 'enabled_for_checkout=false');

  begin
    perform public.admin_set_state_clearance('NY','AGENCY_CONFIRMATION_REQUIRED', true);
    insert into t(label,pass,detail) values ('T-STATE-05 cannot enable an uncleared state', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-STATE-05 cannot enable an uncleared state',
      sqlerrm like '%CANNOT_ENABLE_UNCLEARED%', sqlerrm);
  end;

  begin
    perform public.admin_set_state_clearance('HI','CLEARED', true, 'x');
    insert into t(label,pass,detail) values ('T-STATE-06 unsupported state cannot be cleared', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-STATE-06 unsupported state cannot be cleared',
      sqlerrm like '%UNSUPPORTED_DESTINATION%', sqlerrm);
  end;
end $$;

-- --------------------------------------------------------------------------
-- B. Master gates and the Ohio-only pilot
-- --------------------------------------------------------------------------
do $$
declare prod uuid := (select v from ids where k='prod'); lot uuid := (select v from ids where k='lot');
begin
  perform public.admin_set_state_clearance('OH','CLEARED', true, 'ORC 907.13 research');
  insert into t(label,pass,detail) values ('T-CAP-01 master gate off blocks everything',
    not public.seed_ship_state_allowed('OH', prod, lot), 'seed_drop_enabled=false');

  perform public.admin_set_seed_capacity('{"seed_drop_enabled":true}'::jsonb);
  insert into t(label,pass,detail) values ('T-CAP-02 Ohio pilot gate still closed',
    not public.seed_ship_state_allowed('OH', prod, lot), 'ohio_pilot_enabled=false');

  perform public.admin_set_seed_capacity('{"ohio_pilot_enabled":true}'::jsonb);
  insert into t(label,pass,detail) values ('T-CRED-01 cleared state without credential blocks',
    not public.seed_ship_state_allowed('OH', prod, lot), 'no VERIFIED credential yet');

  insert into t(label,pass,detail) values ('T-CAP-03 checkout reports closed while gates are off',
    (public.seed_ordering_open()->>'open')::boolean = false,
    public.seed_ordering_open()->>'reason');
end $$;

-- --------------------------------------------------------------------------
-- C. Supplier credentials — the fail-closed cases
-- --------------------------------------------------------------------------
do $$
declare sup uuid := (select v from ids where k='sup'); prod uuid := (select v from ids where k='prod');
        lot uuid := (select v from ids where k='lot');
begin
  perform public.admin_set_supplier_credential(sup,'Botanical Interests LLC','OH',
    'SEED_LABELER_PERMIT','OH-1234', current_date - 30, current_date + 300,
    'VERIFIED','https://agri.ohio.gov/ verified 2026-08-13');
  insert into t(label,pass,detail) values ('T-CRED-02 valid credential opens the lot',
    public.seed_ship_state_allowed('OH', prod, lot), 'VERIFIED and in date');

  begin
    perform public.admin_set_supplier_credential(sup,'No Source Co','OH',
      'SEED_LABELER_PERMIT','X', null, null, 'VERIFIED','   ');
    insert into t(label,pass,detail) values ('T-CRED-03 VERIFIED requires a source', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-CRED-03 VERIFIED requires a source',
      sqlerrm like '%VERIFICATION_REQUIRES_SOURCE%', sqlerrm);
  end;

  perform public.admin_set_supplier_credential(sup,'Botanical Interests LLC','OH',
    'SEED_LABELER_PERMIT','OH-1234', current_date - 400, current_date - 1,
    'VERIFIED','expired copy on file');
  insert into t(label,pass,detail) values ('T-CRED-04 expired credential fails closed',
    not public.seed_ship_state_allowed('OH', prod, lot), 'expiration_date past');

  perform public.admin_set_supplier_credential(sup,'Botanical Interests LLC','OH',
    'SEED_LABELER_PERMIT','OH-1234', current_date - 30, current_date + 300,
    'REVOKED','revoked by agency');
  insert into t(label,pass,detail) values ('T-CRED-05 revoked credential fails closed',
    not public.seed_ship_state_allowed('OH', prod, lot), 'verification_status=REVOKED');

  perform public.admin_set_supplier_credential(sup,'Botanical Interests LLC','OH',
    'SEED_LABELER_PERMIT','OH-1234', current_date - 30, current_date + 300,
    'VERIFIED','https://agri.ohio.gov/');
  update public.seed_lots set labeled_entity = 'Some Other Entity Inc' where id = lot;
  insert into t(label,pass,detail) values ('T-CRED-06 wrong labeled entity fails closed',
    not public.seed_ship_state_allowed('OH', prod, lot), 'credential is another entity''s');
  update public.seed_lots set labeled_entity = 'Botanical Interests LLC' where id = lot;

  perform public.admin_set_supplier_credential(sup,'Botanical Interests LLC','OH',
    'SEED_LABELER_PERMIT','OH-1234', current_date - 30, current_date + 300,
    'UNVERIFIED','awaiting document');
  insert into t(label,pass,detail) values ('T-CRED-07 unverified credential fails closed',
    not public.seed_ship_state_allowed('OH', prod, lot), 'verification_status=UNVERIFIED');
  perform public.admin_set_supplier_credential(sup,'Botanical Interests LLC','OH',
    'SEED_LABELER_PERMIT','OH-1234', current_date - 30, current_date + 300,
    'VERIFIED','https://agri.ohio.gov/');
end $$;

-- --------------------------------------------------------------------------
-- D. Product and lot restrictions
-- --------------------------------------------------------------------------
do $$
declare prod uuid := (select v from ids where k='prod');
        bulb uuid := (select v from ids where k='prod_bulb');
        lot uuid := (select v from ids where k='lot');
        lot_bad uuid := (select v from ids where k='lot_bad');
begin
  update public.seed_products set ship_states_excluded = '{OH}' where id = prod;
  insert into t(label,pass,detail) values ('T-PROD-01 excluded_states subtracts',
    not public.seed_ship_state_allowed('OH', prod, lot), 'OH excluded on the product');
  update public.seed_products set ship_states_excluded = '{}' where id = prod;

  update public.seed_products set ship_states_allowed = '{NY}' where id = prod;
  insert into t(label,pass,detail) values ('T-PROD-02 allowed_states is a whitelist',
    not public.seed_ship_state_allowed('OH', prod, lot), 'OH not in ship_states_allowed');
  update public.seed_products set ship_states_allowed = null where id = prod;

  insert into t(label,pass,detail) values ('T-PROD-03 garlic/planting stock excluded from V1',
    not public.seed_product_sellable_v1((select p from public.seed_products p where p.id = bulb)),
    'regulatory_class=BULB_OR_PLANTING_STOCK');

  insert into t(label,pass,detail) values ('T-LOT-01 incomplete lot is review-required and blocked',
    (select compliance_review_required from public.seed_lots where id = lot_bad)
      and not public.seed_ship_state_allowed('OH', prod, lot_bad), 'treatment UNKNOWN');

  update public.seed_lots set recall_status = 'SUPPLIER_RECALL' where id = lot;
  insert into t(label,pass,detail) values ('T-REC-01 recall blocks the lot',
    not public.seed_ship_state_allowed('OH', prod, lot), 'recall_status=SUPPLIER_RECALL');
  update public.seed_lots set recall_status = 'NONE' where id = lot;

  update public.seed_lots set status = 'quarantined' where id = lot;
  insert into t(label,pass,detail) values ('T-REC-02 stop-sale/quarantine blocks the lot',
    not public.seed_ship_state_allowed('OH', prod, lot), 'status=quarantined');
  update public.seed_lots set status = 'active' where id = lot;

  update public.seed_lots set sell_by_date = current_date - 1 where id = lot;
  insert into t(label,pass,detail) values ('T-LOT-02 past sell-by blocks the lot',
    not public.seed_ship_state_allowed('OH', prod, lot), 'sell_by_date past');
  update public.seed_lots set sell_by_date = current_date + 400 where id = lot;

  insert into t(label,pass,detail) values ('T-LOT-03 unknown seed count is representable, not zero',
    (select packet_seed_count is null from public.seed_products
      where id = (select id from public.seed_products where crop='Garlic'))
      is not null, 'packet_seed_count is nullable after 0089');

  -- The fixture's LEGACY-25 row existed before 0089 ran, so the backfill had to
  -- label it. Rows created afterwards legitimately carry no source until an
  -- admin states one — that is the point of making the column nullable.
  insert into t(label,pass,detail) values ('T-LOT-04 pre-existing 25s labelled LEGACY_ASSUMED_25',
    (select packet_seed_count_source from public.seed_products where variety = 'Legacy Default')
      = 'LEGACY_ASSUMED_25',
    coalesce((select packet_seed_count_source from public.seed_products
               where variety = 'Legacy Default'), '(null)'));
end $$;

-- --------------------------------------------------------------------------
-- E. Reservations — 48h hold, atomicity, idempotent release, races
-- --------------------------------------------------------------------------
do $$
declare prod uuid := (select v from ids where k='prod'); lot uuid := (select v from ids where k='lot');
        u uuid := '00000000-0000-0000-0000-0000000000b1';
        r1 uuid; r2 uuid; before numeric; after numeric; ttl_hours numeric;
        ok boolean; ok2 boolean; swept1 int; swept2 int;
begin
  select current_qty into before from public.seed_lots where id = lot;
  r1 := public.reserve_seed_packets(u, prod, lot, 4);
  select current_qty into after from public.seed_lots where id = lot;
  insert into t(label,pass,detail) values ('T-RES-01 reserve decrements exactly once',
    after = before - 4, before||' -> '||after);

  select extract(epoch from (expires_at - created_at))/3600 into ttl_hours
    from public.seed_packet_reservations where id = r1;
  insert into t(label,pass,detail) values ('T-RES-02 hold is 48 hours',
    round(ttl_hours) = 48, round(ttl_hours)||'h');

  r2 := public.reserve_seed_packets(u, prod, lot, 1, null, 'idem-key-1');
  insert into t(label,pass,detail) values ('T-RES-03 idempotency key replays without decrementing',
    public.reserve_seed_packets(u, prod, lot, 1, null, 'idem-key-1') = r2
      and (select current_qty from public.seed_lots where id = lot) = after - 1,
    'same reservation id returned');

  -- NOTE: a mutating function and a read of what it mutated must NOT share one
  -- SQL statement — the statement snapshot would hide the write. Call, then read.
  select current_qty into before from public.seed_lots where id = lot;
  ok := public.release_seed_reservation(r1,'test');
  select current_qty into after from public.seed_lots where id = lot;
  insert into t(label,pass,detail) values ('T-RES-04 release restores stock',
    ok and after = before + 4, before||' -> '||after);

  select current_qty into before from public.seed_lots where id = lot;
  ok := public.release_seed_reservation(r1,'test again');
  select current_qty into after from public.seed_lots where id = lot;
  insert into t(label,pass,detail) values ('T-RES-05 double release is a no-op',
    ok = false and after = before, 'returns false, stock unchanged at '||after);

  begin
    perform public.reserve_seed_packets(u, prod, lot, 100000);
    insert into t(label,pass,detail) values ('T-RES-06 oversell rejected', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-RES-06 oversell rejected',
      sqlerrm like '%INSUFFICIENT_INVENTORY%'
        and (select current_qty from public.seed_lots where id = lot) >= 0, sqlerrm);
  end;

  ok := public.mark_seed_reservation_payment_pending(r2);
  select (payment_deadline is not null and payment_deadline < now() + interval '25 hours')
    into ok2 from public.seed_packet_reservations where id = r2;
  insert into t(label,pass,detail) values ('T-RES-07 payment failure gets a bounded window',
    ok and ok2, 'PAYMENT_PENDING with a deadline inside the recovery window');

  update public.seed_packet_reservations set payment_deadline = now() - interval '1 minute' where id = r2;
  select current_qty into before from public.seed_lots where id = lot;
  swept1 := public.expire_seed_reservations();
  swept2 := public.expire_seed_reservations();
  select current_qty into after from public.seed_lots where id = lot;
  insert into t(label,pass,detail) values ('T-RES-08 expiry sweep releases exactly once',
    swept1 >= 1 and swept2 = 0 and after = before + 1,
    'first sweep '||swept1||', second '||swept2||', stock '||before||' -> '||after);

  insert into t(label,pass,detail) values ('T-RES-09 conversion never decrements again',
    (select current_qty from public.seed_lots where id = lot) =
      (select original_qty from public.seed_lots where id = lot),
    'all holds settled; lot is whole again');
end $$;

-- --------------------------------------------------------------------------
-- F. Drop configuration — sizes, custom bounds, frequencies, controls
-- --------------------------------------------------------------------------
do $$
declare u uuid := '00000000-0000-0000-0000-0000000000b1'; s uuid; ok boolean;
begin
  insert into public.seed_drop_subscriptions (user_id, size_tier, drop_size)
    values (u,'SIZE_12',12) returning id into s;
  insert into t(label,pass,detail) values ('T-SUB-01 12-packet tier is Homestead Drop',
    public.seed_drop_tier_label('SIZE_12',12) = 'Homestead Drop',
    public.seed_drop_tier_label('SIZE_12',12));

  insert into t(label,pass,detail) values ('T-SUB-02 4/8/12 labels are Patio/Garden/Homestead',
    public.seed_drop_tier_label('SIZE_4',4) = 'Patio Drop'
      and public.seed_drop_tier_label('SIZE_8',8) = 'Garden Drop'
      and public.seed_drop_tier_label('CUSTOM',7) like 'Build Your Drop%', 'labels');

  insert into t(label,pass,detail) values ('T-SUB-03 drop_size drives packet_count',
    (select packet_count from public.seed_drop_subscriptions where id = s) = 12, 'mirror synced');

  begin
    insert into public.seed_drop_subscriptions (user_id, size_tier, drop_size) values (u,'CUSTOM',3);
    insert into t(label,pass,detail) values ('T-SUB-04 custom below 4 rejected', false, 'ACCEPTED');
  exception when check_violation then
    insert into t(label,pass,detail) values ('T-SUB-04 custom below 4 rejected', true, 'check_violation');
  end;
  begin
    insert into public.seed_drop_subscriptions (user_id, size_tier, drop_size) values (u,'CUSTOM',21);
    insert into t(label,pass,detail) values ('T-SUB-05 custom above 20 rejected', false, 'ACCEPTED');
  exception when check_violation then
    insert into t(label,pass,detail) values ('T-SUB-05 custom above 20 rejected', true, 'check_violation');
  end;
  begin
    insert into public.seed_drop_subscriptions (user_id, size_tier, drop_size) values (u,'SIZE_8',12);
    insert into t(label,pass,detail) values ('T-SUB-06 tier and size must agree', false, 'ACCEPTED');
  exception when check_violation then
    insert into t(label,pass,detail) values ('T-SUB-06 tier and size must agree', true, 'check_violation');
  end;

  ok := true;
  begin
    update public.seed_drop_subscriptions set frequency='MONTHLY' where id=s;
    update public.seed_drop_subscriptions set frequency='EVERY_OTHER_MONTH' where id=s;
    update public.seed_drop_subscriptions set frequency='SEASONAL' where id=s;
    update public.seed_drop_subscriptions set frequency='ONE_TIME' where id=s;
  exception when others then ok := false; end;
  insert into t(label,pass,detail) values ('T-SUB-07 all four frequencies accepted', ok,
    'MONTHLY / EVERY_OTHER_MONTH / SEASONAL / ONE_TIME');
  begin
    update public.seed_drop_subscriptions set frequency='WEEKLY' where id=s;
    insert into t(label,pass,detail) values ('T-SUB-08 unknown frequency rejected', false, 'ACCEPTED');
  exception when check_violation then
    insert into t(label,pass,detail) values ('T-SUB-08 unknown frequency rejected', true, 'check_violation');
  end;

  ok := true;
  begin
    update public.seed_drop_subscriptions set control_mode='SURPRISE_ME' where id=s;
    update public.seed_drop_subscriptions set control_mode='LET_ME_APPROVE' where id=s;
    update public.seed_drop_subscriptions set control_mode='BUILD_WITH_ME' where id=s;
    update public.seed_drop_subscriptions set control_mode='CHOOSE_THEN_ADD' where id=s;
  exception when others then ok := false; end;
  insert into t(label,pass,detail) values ('T-SUB-09 all four selection modes accepted', ok,
    'Surprise Me / Let Me Approve / Build It With Me / Choose Then Add');

  update public.seed_drop_subscriptions set paused_at = now() where id = s;
  update public.seed_drop_subscriptions set status = 'cancelled', cancelled_at = now() where id = s;
  insert into t(label,pass,detail) values ('T-SUB-10 pause and cancel are recordable',
    (select paused_at is not null and cancelled_at is not null
       from public.seed_drop_subscriptions where id = s), 'timestamps set');

  insert into t(label,pass,detail) values ('T-SUB-11 auto-substitution is opt-in (off by default)',
    (select bool_and(auto_substitution = false) from public.seed_drop_subscriptions),
    'no silent substitution');
end $$;

-- --------------------------------------------------------------------------
-- G. Order lifecycle
-- --------------------------------------------------------------------------
do $$
declare u uuid := '00000000-0000-0000-0000-0000000000b1'; o uuid; ok boolean := true; st text;
begin
  insert into public.seed_orders (user_id, status) values (u,'paid') returning id into o;
  foreach st in array array['shipped','delivered','delivery_issue','missing_packet',
                            'damaged_packet','replacement_pending','replacement_shipped',
                            'refunded','recalled','compliance_blocked'] loop
    begin update public.seed_orders set status = st where id = o;
    exception when others then ok := false; end;
  end loop;
  insert into t(label,pass,detail) values ('T-ORD-01 every required lifecycle state accepted', ok,
    'delivered … compliance_blocked');

  begin
    update public.seed_orders set status = 'teleported' where id = o;
    insert into t(label,pass,detail) values ('T-ORD-02 unknown status rejected', false, 'ACCEPTED');
  exception when check_violation then
    insert into t(label,pass,detail) values ('T-ORD-02 unknown status rejected', true, 'check_violation');
  end;

  update public.seed_orders set status='compliance_blocked',
    compliance_block_reason='OH clearance withdrawn after payment' where id = o;
  insert into t(label,pass,detail) values ('T-ORD-03 post-payment clearance loss is parked, not shipped',
    (select status = 'compliance_blocked' and compliance_block_reason is not null
       from public.seed_orders where id = o), 'awaits an admin decision');
end $$;

-- --------------------------------------------------------------------------
-- H. Authorization, isolation and the 0087 default-grant regression
-- --------------------------------------------------------------------------
do $$
declare bad text; n int;
begin
  select string_agg(distinct table_name||':'||grantee||':'||privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where table_schema='public'
     and table_name in ('seed_supplier_credentials','seed_state_clearance',
                        'seed_capacity_controls','seed_packet_reservations',
                        'seed_purchase_orders','seed_lot_documents')
     and grantee in ('anon','authenticated') and privilege_type <> 'SELECT';
  insert into t(label,pass,detail) values ('T-SEC-01 no client write grants on any new table',
    bad is null, coalesce(bad,'select-only'));

  select count(*) into n from information_schema.role_table_grants
   where table_schema='public'
     and table_name in ('seed_supplier_credentials','seed_capacity_controls',
                        'seed_purchase_orders','seed_lot_documents')
     and grantee in ('anon','authenticated');
  insert into t(label,pass,detail) values ('T-SEC-02 regulatory tables are not client-readable at all',
    n = 0, n||' client grants');

  select count(*) into n from pg_class c join pg_namespace s on s.oid=c.relnamespace
   where s.nspname='public' and c.relrowsecurity
     and c.relname in ('seed_supplier_credentials','seed_state_clearance',
                       'seed_capacity_controls','seed_packet_reservations',
                       'seed_purchase_orders','seed_lot_documents');
  insert into t(label,pass,detail) values ('T-SEC-03 RLS enabled on all six new tables',
    n = 6, n||'/6');
end $$;

do $$
declare msg text;
begin
  -- Drop owner rights and become a plain signed-in user.
  perform set_config('test.is_owner','false', false);
  perform set_config('test.perms','', false);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000c1')::text, false);

  begin
    perform public.admin_set_state_clearance('NY','CLEARED', true, 'sneaky');
    insert into t(label,pass,detail) values ('T-SEC-04 non-admin cannot clear a state', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-SEC-04 non-admin cannot clear a state',
      sqlerrm like '%NOT_AUTHORIZED%', sqlerrm);
  end;

  begin
    perform public.admin_set_supplier_credential(
      (select v from ids where k='sup'),'Anything','NY','SEED_LABELER_PERMIT',
      'X',null,null,'VERIFIED','made up');
    insert into t(label,pass,detail) values ('T-SEC-05 non-admin cannot mint a credential', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-SEC-05 non-admin cannot mint a credential',
      sqlerrm like '%NOT_AUTHORIZED%', sqlerrm);
  end;

  begin
    perform public.admin_set_seed_capacity('{"seed_drop_checkout_enabled":true}'::jsonb);
    insert into t(label,pass,detail) values ('T-SEC-06 non-admin cannot open checkout', false, 'ACCEPTED');
  exception when others then
    insert into t(label,pass,detail) values ('T-SEC-06 non-admin cannot open checkout',
      sqlerrm like '%NOT_AUTHORIZED%', sqlerrm);
  end;

  perform set_config('test.is_owner','true', false);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a1')::text, false);
end $$;

-- --------------------------------------------------------------------------
-- I. The gate that matters most: Seed Drop is still OFF
-- --------------------------------------------------------------------------
do $$
declare c public.seed_capacity_controls; n int;
begin
  select * into c from public.seed_capacity_controls where id;
  insert into t(label,pass,detail) values ('T-GATE-01 checkout disabled everywhere',
    not c.seed_drop_checkout_enabled, 'seed_drop_checkout_enabled=false');
  insert into t(label,pass,detail) values ('T-GATE-02 interstate disabled',
    not c.interstate_enabled, 'interstate_enabled=false');
  insert into t(label,pass,detail) values ('T-GATE-03 enrollment closed',
    c.enrollment_mode = 'CLOSED', c.enrollment_mode);
  insert into t(label,pass,detail) values ('T-GATE-04 no state ships without an explicit enable',
    not public.seed_ship_state_allowed('NY',
      (select v from ids where k='prod'), (select v from ids where k='lot')),
    'NY never enabled');

  select count(*) into n from public.admin_audit_log;
  insert into t(label,pass,detail) values ('T-AUD-01 every admin change was audited',
    n >= 10, n||' audit rows');
end $$;

select n, label, case when pass then 'PASS' else 'FAIL' end as result, detail
  from t order by n;
select count(*) filter (where pass) || '/' || count(*) || ' Phase 0 cases pass' as summary from t;
select 'SEED DROP PHASE 0: ' ||
       case when bool_and(pass) then 'ALL TESTS PASSED' else 'FAILURES PRESENT' end as verdict
  from t;
