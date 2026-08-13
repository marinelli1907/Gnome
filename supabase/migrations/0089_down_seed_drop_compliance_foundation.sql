-- Rollback for 0089_seed_drop_compliance_foundation.sql.
--
-- 0089 is additive, so this is a clean reversal PROVIDED no customer data has
-- been written through the new tables yet — which is guaranteed while Seed Drop
-- checkout is disabled. If reservations exist, release them before running this
-- (select public.expire_seed_reservations();) so lot quantities settle first.

drop trigger if exists seed_lot_review_flag_trg      on public.seed_lots;
drop trigger if exists seed_sub_sync_drop_size_trg   on public.seed_drop_subscriptions;

do $$ begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists seed_lot_docs_admin_all on storage.objects;
  end if;
end $$;

drop function if exists public.admin_set_seed_capacity(jsonb);
drop function if exists public.admin_set_supplier_credential(uuid,text,text,text,text,date,date,text,text,text[],text[],text);
drop function if exists public.admin_set_state_clearance(text,text,boolean,text,jsonb,text,text,date);
drop function if exists public.expire_seed_reservations();
drop function if exists public.mark_seed_reservation_payment_pending(uuid);
drop function if exists public.convert_seed_reservation(uuid,uuid);
drop function if exists public.release_seed_reservation(uuid,text,text);
drop function if exists public.reserve_seed_packets(uuid,uuid,uuid,int,uuid,text);
drop function if exists public.seed_ship_state_allowed(text,uuid,uuid,date);
drop function if exists public.seed_lot_set_review_flag();
drop function if exists public.seed_lot_compliance_complete(public.seed_lots);
drop function if exists public.seed_supplier_credential_ok(text,text,text,date);
drop function if exists public.seed_product_sellable_v1(public.seed_products);
drop function if exists public.seed_drop_tier_label(text,int);
drop function if exists public.seed_ordering_open();
drop function if exists public.seed_destination_supported(text);

alter table if exists public.seed_lots drop constraint if exists seed_lots_purchase_order_fk;
alter table if exists public.seed_supplier_credentials drop constraint if exists ssc_document_fk;

drop table if exists public.seed_lot_documents;
drop table if exists public.seed_packet_reservations;
drop table if exists public.seed_purchase_orders;
drop table if exists public.seed_supplier_credentials;
drop table if exists public.seed_capacity_controls;
drop table if exists public.seed_state_clearance;

alter table public.seed_drop_subscriptions
  drop constraint if exists sds_control_mode_chk,
  drop constraint if exists sds_frequency_chk,
  drop constraint if exists sds_size_agreement_chk,
  drop constraint if exists sds_size_tier_chk;
alter table public.seed_drop_subscriptions
  drop column if exists cancelled_at,
  drop column if exists paused_at,
  drop column if exists auto_substitution,
  drop column if exists control_mode,
  drop column if exists frequency,
  drop column if exists drop_size,
  drop column if exists size_tier;

alter table public.seed_orders
  drop column if exists delivered_at,
  drop column if exists ship_state,
  drop column if exists compliance_block_reason,
  drop column if exists lifecycle_note;
alter table public.seed_orders drop constraint if exists seed_orders_status_chk;

alter table public.seed_lots
  drop constraint if exists seed_lots_seed_count_confidence_chk,
  drop constraint if exists seed_lots_seed_count_source_chk,
  drop constraint if exists seed_lots_recall_status_chk,
  drop constraint if exists seed_lots_organic_claim_chk,
  drop constraint if exists seed_lots_treatment_chk,
  drop constraint if exists seed_lots_status_chk;
alter table public.seed_lots
  drop column if exists compliance_review_required,
  drop column if exists qty_expired, drop column if exists qty_recalled,
  drop column if exists qty_damaged, drop column if exists recall_ref,
  drop column if exists recall_status, drop column if exists purchase_order_id,
  drop column if exists storage_location_id, drop column if exists country_of_origin,
  drop column if exists organic_cert_ref, drop column if exists organic_claim,
  drop column if exists treatment_notes, drop column if exists treatment,
  drop column if exists sell_by_date, drop column if exists seed_count_confidence,
  drop column if exists seed_count_source, drop column if exists seed_count_estimated,
  drop column if exists seed_count_exact, drop column if exists packet_weight_grams,
  drop column if exists original_packet_name, drop column if exists labeled_entity,
  drop column if exists supplier_id;
alter table public.seed_lots add constraint seed_lots_status_check
  check (status in ('fresh','active','aging','quarantined','depleted'));

-- Restore the pre-0089 packet_seed_count contract. Any row left NULL by
-- Phase 0 editing is set back to the historical assumption of 25 so the
-- NOT NULL can be re-asserted; this is the one place the rollback writes data,
-- and it is deliberately the same value the old default asserted.
update public.seed_products set packet_seed_count = 25 where packet_seed_count is null;
alter table public.seed_products alter column packet_seed_count set default 25;
alter table public.seed_products alter column packet_seed_count set not null;

alter table public.seed_products
  drop constraint if exists seed_products_seed_count_source_chk,
  drop constraint if exists seed_products_guidance_review_chk,
  drop constraint if exists seed_products_regulatory_class_chk;
alter table public.seed_products
  drop column if exists guidance_review_status, drop column if exists guidance_sources,
  drop column if exists packet_coverage_note,   drop column if exists packet_seed_count_source,
  drop column if exists regulatory_notes,       drop column if exists regulatory_class,
  drop column if exists ship_states_excluded,   drop column if exists ship_states_allowed,
  drop column if exists brand;

do $$ begin
  if to_regclass('storage.buckets') is not null then
    delete from storage.buckets where id = 'seed-lot-docs';
  end if;
end $$;

notify pgrst, 'reload schema';
