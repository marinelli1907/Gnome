-- 0089 — Seed Drop V1, Phase 0: compliance and operational foundations.
--
-- NOT APPLIED TO PRODUCTION. Declared in migrations/UNAPPLIED.txt. Applying it
-- activates nothing: every gate below ships OFF, the state allowlist is seeded
-- EMPTY, and `seed_drop_checkout_enabled` is false. Seed Drop sells nowhere
-- until Daniel explicitly flips gates through the audited admin RPCs.
--
-- Design source: docs/seed-drop/17-database-plan.md, with the locked product
-- decisions from Daniel's 2026-08-13 directive taking precedence where they
-- differ (four frequencies, four selection modes, 48-hour holds, Homestead
-- naming, an explicit supplier-credential ledger).
--
-- The load-bearing rule, stated once: eligibility is decided at
--   supplier x labeled entity x packet/lot x destination state x date
-- and it FAILS CLOSED. A state being "cleared" never clears a packet whose
-- labeled entity lacks that state's credential.
--
-- Additive only: new tables, new columns, widened check constraints, replaced
-- function bodies. No drops, no type rewrites, no destructive backfills.
-- Paired rollback: 0089_down_seed_drop_compliance_foundation.sql

-- ===========================================================================
-- 1. Supplier credentials — the ledger the eligibility rule reads
-- ===========================================================================
-- A credential belongs to the LEGAL ENTITY PRINTED ON THE PACKET, which is not
-- always the brand a buyer recognises. `labeled_entity` is therefore mandatory
-- and separate from `supplier_id`: a distributor may ship packets labeled by
-- three different entities, and only the labeled entity's credential counts.

create table if not exists public.seed_supplier_credentials (
  id                    uuid primary key default gen_random_uuid(),
  supplier_id           uuid not null references public.suppliers(id) on delete restrict,
  labeled_entity        text not null,
  issuing_state         text not null check (issuing_state ~ '^[A-Z]{2}$'),
  credential_type       text not null check (credential_type in
                          ('SEED_LABELER_PERMIT','SEED_DEALER_LICENSE',
                           'SEED_DISTRIBUTOR_REGISTRATION','SEED_SELLER_REGISTRATION',
                           'EXEMPTION_ON_RECORD','OTHER')),
  credential_number     text,
  effective_date        date,
  expiration_date       date,
  -- Verification is a human act with a citable source. UNVERIFIED is the
  -- default precisely so that a freshly typed row grants nothing.
  verification_status   text not null default 'UNVERIFIED' check (verification_status in
                          ('UNVERIFIED','VERIFIED','EXPIRED','REVOKED','NOT_APPLICABLE')),
  verification_source   text,
  document_id           uuid,   -- FK added in §4 once seed_lot_documents exists
  verified_date         date,
  verified_by           uuid references public.profiles(id),
  applicable_packet_lines text[] not null default '{}',  -- empty = all lines of this entity
  applicable_states     text[] not null default '{}',    -- empty = issuing_state only
  renewal_status        text not null default 'CURRENT' check (renewal_status in
                          ('CURRENT','RENEWAL_DUE','RENEWAL_SUBMITTED','LAPSED')),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (supplier_id, labeled_entity, issuing_state, credential_type)
);
create index if not exists ssc_entity_state_idx
  on public.seed_supplier_credentials (labeled_entity, issuing_state)
  where verification_status = 'VERIFIED';

comment on table public.seed_supplier_credentials is
  'Per-labeled-entity, per-state seed credentials. Fail-closed: only a VERIFIED, '
  'unexpired row authorises shipping that entity''s packets into that state.';

-- The single predicate every other check funnels through. Stable + definer so
-- RLS on the ledger never widens who can *read* it, only who can *rely* on it.
create or replace function public.seed_supplier_credential_ok(
  p_labeled_entity text, p_state text, p_packet_line text default null,
  p_on date default null
) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.seed_supplier_credentials c
     where c.labeled_entity = p_labeled_entity
       and c.verification_status = 'VERIFIED'
       and (c.issuing_state = p_state or p_state = any(c.applicable_states))
       and (c.effective_date  is null or c.effective_date  <= coalesce(p_on, current_date))
       and (c.expiration_date is null or c.expiration_date >= coalesce(p_on, current_date))
       and (cardinality(c.applicable_packet_lines) = 0
            or p_packet_line is null
            or p_packet_line = any(c.applicable_packet_lines))
  );
$$;

-- ===========================================================================
-- 2. State clearance — the ALLOWLIST
-- ===========================================================================
-- Two separate booleans on purpose. `status` is the research conclusion;
-- `enabled_for_checkout` is Daniel's deliberate act. Research alone never
-- opens a state — that is the whole point of the directive's
-- "Do not hard-code the research matrix as legal truth".

create table if not exists public.seed_state_clearance (
  state                     text primary key check (state ~ '^[A-Z]{2}$'),
  status                    text not null default 'AGENCY_CONFIRMATION_REQUIRED'
                              check (status in ('CLEARED','REGISTRATION_REQUIRED',
                                     'AGENCY_CONFIRMATION_REQUIRED','BLOCKED')),
  effective_date            date,
  review_by                 date,
  expires_on                date,
  official_source           text,
  source_refs               jsonb not null default '[]'::jsonb,
  verified_date             date,
  verified_by               uuid references public.profiles(id),
  applicable_product_classes text[] not null default '{}',  -- empty = all classes
  gnome_registration_required boolean not null default false,
  gnome_registration_ref    text,
  supplier_credential_required boolean not null default true,
  notes                     text,
  -- DEFAULT FALSE is the safety property of this whole migration.
  enabled_for_checkout      boolean not null default false,
  enabled_by                uuid references public.profiles(id),
  enabled_at                timestamptz,
  updated_at                timestamptz not null default now()
);

comment on table public.seed_state_clearance is
  'Destination-state allowlist. A state ships ONLY when a row exists with '
  'status=CLEARED AND enabled_for_checkout=true AND (no unmet registration) '
  'AND the date window is open. Seeded EMPTY: an empty table ships nowhere.';

-- Address classes V1 does not serve at all, independent of any clearance row.
create or replace function public.seed_destination_supported(p_state text)
returns boolean language sql immutable as $$
  select p_state is not null
     and p_state ~ '^[A-Z]{2}$'
     -- contiguous 48 only: no AK/HI, no territories, no military addresses
     and p_state not in ('AK','HI','PR','VI','GU','AS','MP','UM',
                         'AA','AE','AP','DC');
$$;

-- ===========================================================================
-- 3. Capacity, gates and kill switches (singleton, billing_config shape)
-- ===========================================================================
create table if not exists public.seed_capacity_controls (
  id                          boolean primary key default true check (id),
  -- master gates, all closed
  seed_drop_enabled           boolean not null default false,
  seed_drop_checkout_enabled  boolean not null default false,
  ohio_pilot_enabled          boolean not null default false,
  interstate_enabled          boolean not null default false,
  enrollment_mode             text not null default 'CLOSED'
                                check (enrollment_mode in ('OPEN','WAITLIST','CLOSED')),
  custom_sizes_enabled        boolean not null default true,
  -- caps: NULL means "no cap", which is only reachable deliberately
  max_active_subscribers      int check (max_active_subscribers is null or max_active_subscribers >= 0),
  max_new_subscribers_per_day int check (max_new_subscribers_per_day is null or max_new_subscribers_per_day >= 0),
  max_packets_per_period      int check (max_packets_per_period is null or max_packets_per_period >= 0),
  max_custom_size             int not null default 20 check (max_custom_size between 4 and 20),
  per_state_caps              jsonb not null default '{}'::jsonb,
  seasonal_window_open        boolean not null default false,
  -- operational pauses; any true closes ordering
  supplier_outage             boolean not null default false,
  carrier_outage              boolean not null default false,
  recall_pause                boolean not null default false,
  emergency_pause             boolean not null default false,
  pause_reason                text,
  -- reservation policy (directive: 48-hour approval hold)
  reservation_ttl_minutes     int not null default 2880
                                check (reservation_ttl_minutes between 60 and 10080),
  payment_recovery_minutes    int not null default 120
                                check (payment_recovery_minutes between 15 and 1440),
  updated_by                  uuid references public.profiles(id),
  updated_at                  timestamptz not null default now()
);
insert into public.seed_capacity_controls (id) values (true) on conflict (id) do nothing;

-- One place that answers "is Seed Drop ordering open at all right now?".
create or replace function public.seed_ordering_open()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'open', c.seed_drop_enabled and c.seed_drop_checkout_enabled
            and c.enrollment_mode = 'OPEN'
            and not (c.supplier_outage or c.carrier_outage
                     or c.recall_pause or c.emergency_pause),
    'waitlist_enabled', c.enrollment_mode = 'WAITLIST',
    'reason', case
        when not c.seed_drop_enabled          then 'NOT_LAUNCHED'
        when not c.seed_drop_checkout_enabled then 'CHECKOUT_DISABLED'
        when c.emergency_pause                then 'EMERGENCY_PAUSE'
        when c.recall_pause                   then 'RECALL_PAUSE'
        when c.supplier_outage                then 'SUPPLIER_OUTAGE'
        when c.carrier_outage                 then 'CARRIER_OUTAGE'
        when c.enrollment_mode <> 'OPEN'      then c.enrollment_mode
        else 'OPEN' end)
  from public.seed_capacity_controls c where c.id;
$$;

-- ===========================================================================
-- 4. Inventory: lots, products, documents, purchase orders
-- ===========================================================================
alter table public.seed_products
  add column if not exists brand                    text,
  add column if not exists ship_states_allowed      text[],
  add column if not exists ship_states_excluded     text[] not null default '{}',
  add column if not exists regulatory_class         text not null default 'STANDARD_VEGETABLE',
  add column if not exists regulatory_notes         text,
  add column if not exists packet_seed_count_source text,
  add column if not exists packet_coverage_note     text,
  add column if not exists guidance_sources         jsonb not null default '[]'::jsonb,
  add column if not exists guidance_review_status   text not null default 'DRAFT';

do $$ begin
  alter table public.seed_products add constraint seed_products_regulatory_class_chk
    check (regulatory_class in ('STANDARD_VEGETABLE','HERB','FLOWER','RESTRICTED',
                                'PROHIBITED','BULB_OR_PLANTING_STOCK'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.seed_products add constraint seed_products_guidance_review_chk
    check (guidance_review_status in ('DRAFT','ADMIN_APPROVED'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.seed_products add constraint seed_products_seed_count_source_chk
    check (packet_seed_count_source is null or packet_seed_count_source in
      ('SUPPLIER_STATED','WEIGHT_CALC','SAMPLE_COUNT','CATALOG_DEFAULT','LEGACY_ASSUMED_25'));
exception when duplicate_object then null; end $$;

-- `packet_seed_count int NOT NULL DEFAULT 25` asserted a fact about every
-- packet that nobody ever measured. Relax it so "unknown" is representable,
-- and label the existing rows honestly instead of rewriting or zeroing them:
-- a 25 that was never verified becomes LEGACY_ASSUMED_25, not 0, not NULL.
update public.seed_products
   set packet_seed_count_source = case when packet_seed_count = 25
                                       then 'LEGACY_ASSUMED_25' else 'CATALOG_DEFAULT' end
 where packet_seed_count_source is null;
alter table public.seed_products alter column packet_seed_count drop default;
alter table public.seed_products alter column packet_seed_count drop not null;

-- Bulbs, sets, tubers and other planting stock are OUT of Seed Drop V1
-- (garlic included) until the "Bulbs and Planting Stock Compliance" roadmap
-- item clears them. This makes the exclusion structural, not a copy decision.
create or replace function public.seed_product_sellable_v1(p public.seed_products)
returns boolean language sql immutable as $$
  select p.active and not p.archived
     and p.regulatory_class not in ('PROHIBITED','BULB_OR_PLANTING_STOCK');
$$;

alter table public.seed_lots
  add column if not exists supplier_id              uuid references public.suppliers(id),
  add column if not exists labeled_entity           text,
  add column if not exists original_packet_name     text,
  add column if not exists packet_weight_grams      numeric check (packet_weight_grams is null or packet_weight_grams > 0),
  add column if not exists seed_count_exact         int check (seed_count_exact is null or seed_count_exact > 0),
  add column if not exists seed_count_estimated     int check (seed_count_estimated is null or seed_count_estimated > 0),
  add column if not exists seed_count_source        text,
  add column if not exists seed_count_confidence    text,
  add column if not exists sell_by_date             date,
  add column if not exists treatment                text not null default 'UNKNOWN',
  add column if not exists treatment_notes          text,
  add column if not exists organic_claim            text not null default 'UNKNOWN',
  add column if not exists organic_cert_ref         text,
  add column if not exists country_of_origin        text,
  add column if not exists storage_location_id      uuid references public.storage_locations(id),
  add column if not exists purchase_order_id        uuid,
  add column if not exists recall_status            text not null default 'NONE',
  add column if not exists recall_ref               text,
  add column if not exists qty_damaged              numeric not null default 0 check (qty_damaged   >= 0),
  add column if not exists qty_recalled             numeric not null default 0 check (qty_recalled  >= 0),
  add column if not exists qty_expired              numeric not null default 0 check (qty_expired   >= 0),
  add column if not exists compliance_review_required boolean not null default false;

do $$ begin
  alter table public.seed_lots add constraint seed_lots_treatment_chk
    check (treatment in ('UNTREATED','FUNGICIDE_TREATED','PELLETED','PRIMED','INOCULATED','UNKNOWN'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.seed_lots add constraint seed_lots_organic_claim_chk
    check (organic_claim in ('CERTIFIED_ORGANIC','OMRI_LISTED','UNTREATED_CONVENTIONAL',
                             'CONVENTIONAL','UNKNOWN'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.seed_lots add constraint seed_lots_recall_status_chk
    check (recall_status in ('NONE','SUPPLIER_RECALL','INTERNAL_RECALL','RESOLVED'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.seed_lots add constraint seed_lots_seed_count_source_chk
    check (seed_count_source is null or seed_count_source in
      ('SUPPLIER_STATED','WEIGHT_CALC','SAMPLE_COUNT','CATALOG_DEFAULT'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.seed_lots add constraint seed_lots_seed_count_confidence_chk
    check (seed_count_confidence is null or seed_count_confidence in ('HIGH','MEDIUM','LOW'));
exception when duplicate_object then null; end $$;

-- Widen the lot status value set (additive: no existing value is removed).
do $$
declare con text;
begin
  select conname into con from pg_constraint
   where conrelid = 'public.seed_lots'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%status%quarantined%' limit 1;
  if con is not null then
    execute format('alter table public.seed_lots drop constraint %I', con);
  end if;
  begin
    alter table public.seed_lots add constraint seed_lots_status_chk
      check (status in ('fresh','active','aging','quarantined','depleted','recalled','expired'));
  exception when duplicate_object then null; end;
end $$;

create table if not exists public.seed_purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  supplier_id    uuid not null references public.suppliers(id),
  po_number      text not null,
  status         text not null default 'ORDERED' check (status in
                   ('DRAFT','ORDERED','PARTIAL','RECEIVED','CANCELLED')),
  ordered_at     date, expected_at date, received_at date,
  subtotal_cents int, shipping_cents int, tax_cents int, total_cents int,
  notes          text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (supplier_id, po_number)
);
do $$ begin
  alter table public.seed_lots add constraint seed_lots_purchase_order_fk
    foreign key (purchase_order_id) references public.seed_purchase_orders(id);
exception when duplicate_object then null; end $$;

create table if not exists public.seed_lot_documents (
  id                uuid primary key default gen_random_uuid(),
  lot_id            uuid references public.seed_lots(id) on delete cascade,
  seed_product_id   uuid references public.seed_products(id) on delete cascade,
  purchase_order_id uuid references public.seed_purchase_orders(id) on delete cascade,
  credential_id     uuid references public.seed_supplier_credentials(id) on delete cascade,
  kind              text not null check (kind in ('LABEL_IMAGE','SUPPLIER_DOC','COA',
                      'GERM_TEST_REPORT','PO_DOCUMENT','CREDENTIAL_DOCUMENT','OTHER')),
  storage_path      text not null,
  uploaded_by       uuid not null references public.profiles(id),
  notes             text,
  created_at        timestamptz not null default now(),
  check (lot_id is not null or seed_product_id is not null
         or purchase_order_id is not null or credential_id is not null)
);
do $$ begin
  alter table public.seed_supplier_credentials add constraint ssc_document_fk
    foreign key (document_id) references public.seed_lot_documents(id) on delete set null;
exception when duplicate_object then null; end $$;

-- Private bucket; reads are short-lived signed URLs only (0043 compliance-docs
-- pattern). Guarded so the file also runs on a database without Supabase
-- storage installed (the local migration-test harness).
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('seed-lot-docs', 'seed-lot-docs', false)
    on conflict (id) do nothing;
  end if;
end $$;

-- ===========================================================================
-- 5. Reservations — 48-hour holds, atomic and idempotent
-- ===========================================================================
create table if not exists public.seed_packet_reservations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  subscription_id  uuid references public.seed_drop_subscriptions(id) on delete set null,
  order_id         uuid references public.seed_orders(id) on delete set null,
  seed_product_id  uuid not null references public.seed_products(id),
  lot_id           uuid not null references public.seed_lots(id),
  qty_packets      int not null default 1 check (qty_packets > 0),
  status           text not null default 'HELD' check (status in
                     ('HELD','CONVERTED','RELEASED','EXPIRED','PAYMENT_PENDING')),
  expires_at       timestamptz not null,
  payment_deadline timestamptz,
  release_reason   text,
  checkout_ref     text,
  idempotency_key  text,
  created_at       timestamptz not null default now(),
  released_at      timestamptz
);
create index if not exists spr_expiry_idx on public.seed_packet_reservations (expires_at)
  where status in ('HELD','PAYMENT_PENDING');
create index if not exists spr_user_idx on public.seed_packet_reservations (user_id);
create unique index if not exists spr_idem_idx on public.seed_packet_reservations (idempotency_key)
  where idempotency_key is not null;

-- Reserve: ONE guarded decrement, exactly as the 0028 engine does. The
-- `current_qty >= qty` predicate in the UPDATE is what makes concurrent
-- callers safe without an advisory lock — the loser updates zero rows.
create or replace function public.reserve_seed_packets(
  p_user uuid, p_product uuid, p_lot uuid, p_qty int,
  p_subscription uuid default null, p_idempotency_key text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ttl int; v_ok int;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'BAD_QTY' using errcode='P0001'; end if;

  if p_idempotency_key is not null then
    select id into v_id from public.seed_packet_reservations
     where idempotency_key = p_idempotency_key;
    if v_id is not null then return v_id; end if;   -- replay: no second decrement
  end if;

  select reservation_ttl_minutes into v_ttl from public.seed_capacity_controls where id;

  update public.seed_lots
     set current_qty = current_qty - p_qty, updated_at = now()
   where id = p_lot and current_qty >= p_qty;
  get diagnostics v_ok = row_count;
  if v_ok = 0 then raise exception 'INSUFFICIENT_INVENTORY' using errcode='P0001'; end if;

  insert into public.seed_packet_reservations
    (user_id, subscription_id, seed_product_id, lot_id, qty_packets,
     expires_at, idempotency_key)
  values (p_user, p_subscription, p_product, p_lot, p_qty,
          now() + make_interval(mins => coalesce(v_ttl, 2880)), p_idempotency_key)
  returning id into v_id;

  insert into public.seed_inventory_log (lot_id, delta, reason, actor)
  values (p_lot, -p_qty, 'reserved:'||v_id::text, p_user);
  return v_id;
end $$;
revoke all on function public.reserve_seed_packets(uuid,uuid,uuid,int,uuid,text) from public, anon, authenticated;

-- Release: the mirror image, guarded by the status transition so a double-fired
-- expiry job (or a release racing an expiry) restores stock exactly once.
create or replace function public.release_seed_reservation(
  p_reservation uuid, p_reason text default 'released', p_new_status text default 'RELEASED'
) returns boolean
language plpgsql security definer set search_path = public as $$
declare r public.seed_packet_reservations; v_ok int;
begin
  if p_new_status not in ('RELEASED','EXPIRED') then
    raise exception 'BAD_RELEASE_STATUS' using errcode='P0001';
  end if;
  update public.seed_packet_reservations
     set status = p_new_status, released_at = now(), release_reason = p_reason
   where id = p_reservation and status in ('HELD','PAYMENT_PENDING')
  returning * into r;
  get diagnostics v_ok = row_count;
  if v_ok = 0 then return false; end if;          -- already settled: no-op

  update public.seed_lots set current_qty = current_qty + r.qty_packets, updated_at = now()
   where id = r.lot_id;
  insert into public.seed_inventory_log (lot_id, delta, reason, actor)
  values (r.lot_id, r.qty_packets, p_new_status||':'||p_reservation::text, r.user_id);
  return true;
end $$;
revoke all on function public.release_seed_reservation(uuid,text,text) from public, anon, authenticated;

-- Conversion NEVER decrements again — the packets left `current_qty` at hold.
create or replace function public.convert_seed_reservation(p_reservation uuid, p_order uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_ok int;
begin
  update public.seed_packet_reservations
     set status = 'CONVERTED', order_id = p_order
   where id = p_reservation and status in ('HELD','PAYMENT_PENDING');
  get diagnostics v_ok = row_count;
  return v_ok = 1;
end $$;
revoke all on function public.convert_seed_reservation(uuid,uuid) from public, anon, authenticated;

-- Payment failure gets a short, explicit recovery window instead of an
-- indefinite pending_payment hold on stock.
create or replace function public.mark_seed_reservation_payment_pending(p_reservation uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_grace int; v_ok int;
begin
  select payment_recovery_minutes into v_grace from public.seed_capacity_controls where id;
  update public.seed_packet_reservations
     set status = 'PAYMENT_PENDING',
         payment_deadline = now() + make_interval(mins => coalesce(v_grace, 120))
   where id = p_reservation and status = 'HELD';
  get diagnostics v_ok = row_count;
  return v_ok = 1;
end $$;
revoke all on function public.mark_seed_reservation_payment_pending(uuid) from public, anon, authenticated;

create or replace function public.expire_seed_reservations()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select id from public.seed_packet_reservations
     where (status = 'HELD' and expires_at <= now())
        or (status = 'PAYMENT_PENDING' and payment_deadline <= now())
     for update skip locked
  loop
    if public.release_seed_reservation(r.id, 'ttl_expired', 'EXPIRED') then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.expire_seed_reservations() from public, anon, authenticated;

-- ===========================================================================
-- 6. Drop configuration — Patio 4 / Garden 8 / Homestead 12 / Build Your Drop
-- ===========================================================================
alter table public.seed_drop_subscriptions
  add column if not exists size_tier       text not null default 'SIZE_8',
  add column if not exists drop_size       int  not null default 8,
  add column if not exists frequency       text not null default 'SEASONAL',
  add column if not exists control_mode    text not null default 'SURPRISE_ME',
  add column if not exists auto_substitution boolean not null default false,
  add column if not exists paused_at       timestamptz,
  add column if not exists cancelled_at    timestamptz;

do $$ begin
  alter table public.seed_drop_subscriptions add constraint sds_size_tier_chk
    check (size_tier in ('SIZE_4','SIZE_8','SIZE_12','CUSTOM'));
exception when duplicate_object then null; end $$;
do $$ begin
  -- The tier and the number must agree; CUSTOM is the only free range, 4..20.
  alter table public.seed_drop_subscriptions add constraint sds_size_agreement_chk
    check ((size_tier = 'SIZE_4'  and drop_size = 4)
        or (size_tier = 'SIZE_8'  and drop_size = 8)
        or (size_tier = 'SIZE_12' and drop_size = 12)
        or (size_tier = 'CUSTOM'  and drop_size between 4 and 20));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.seed_drop_subscriptions add constraint sds_frequency_chk
    check (frequency in ('MONTHLY','EVERY_OTHER_MONTH','SEASONAL','ONE_TIME'));
exception when duplicate_object then null; end $$;
do $$ begin
  -- Daniel's four control modes, in his words:
  --   SURPRISE_ME     = "Surprise Me"
  --   LET_ME_APPROVE  = "Let Me Approve"
  --   BUILD_WITH_ME   = "Build It With Me"
  --   CHOOSE_THEN_ADD = "Choose for Me, Then Add More"
  alter table public.seed_drop_subscriptions add constraint sds_control_mode_chk
    check (control_mode in ('SURPRISE_ME','LET_ME_APPROVE','BUILD_WITH_ME','CHOOSE_THEN_ADD'));
exception when duplicate_object then null; end $$;

-- `drop_size` is authoritative; `packet_count` (read by the live engine)
-- becomes a synced mirror so there is exactly one number to reason about.
create or replace function public.seed_sub_sync_drop_size()
returns trigger language plpgsql as $$
begin
  if new.drop_size is not null then new.packet_count := new.drop_size; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists seed_sub_sync_drop_size_trg on public.seed_drop_subscriptions;
create trigger seed_sub_sync_drop_size_trg
  before insert or update on public.seed_drop_subscriptions
  for each row execute function public.seed_sub_sync_drop_size();

-- Human-facing names live in one place so the app and admin never drift.
create or replace function public.seed_drop_tier_label(p_tier text, p_size int)
returns text language sql immutable as $$
  select case p_tier
    when 'SIZE_4'  then 'Patio Drop'
    when 'SIZE_8'  then 'Garden Drop'
    when 'SIZE_12' then 'Homestead Drop'
    when 'CUSTOM'  then 'Build Your Drop (' || coalesce(p_size, 0) || ' packets)'
    else 'Drop' end;
$$;

-- ===========================================================================
-- 7. The eligibility decision: supplier x entity x lot x state x date
-- ===========================================================================
create or replace function public.seed_ship_state_allowed(
  p_state text, p_product uuid default null, p_lot uuid default null,
  p_on date default null
) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  c public.seed_state_clearance;
  pr public.seed_products;
  lt public.seed_lots;
  on_date date := coalesce(p_on, current_date);
  caps public.seed_capacity_controls;
begin
  if not public.seed_destination_supported(p_state) then return false; end if;

  select * into caps from public.seed_capacity_controls where id;
  if caps is null or not caps.seed_drop_enabled then return false; end if;
  -- Ohio pilot: while interstate is off, OH is the only destination at all.
  if not caps.interstate_enabled then
    if p_state <> 'OH' then return false; end if;
    if not caps.ohio_pilot_enabled then return false; end if;
  end if;

  select * into c from public.seed_state_clearance where state = p_state;
  if c is null then return false; end if;                       -- missing row = closed
  if c.status <> 'CLEARED' then return false; end if;
  if not c.enabled_for_checkout then return false; end if;      -- research never opens a state
  if c.effective_date is not null and c.effective_date > on_date then return false; end if;
  if c.expires_on     is not null and c.expires_on     < on_date then return false; end if;
  if c.gnome_registration_required and coalesce(btrim(c.gnome_registration_ref), '') = ''
    then return false; end if;

  if p_product is not null then
    select * into pr from public.seed_products where id = p_product;
    if pr is null or not public.seed_product_sellable_v1(pr) then return false; end if;
    if pr.ship_states_allowed is not null
       and not (p_state = any(pr.ship_states_allowed)) then return false; end if;
    if p_state = any(pr.ship_states_excluded) then return false; end if;
    if cardinality(c.applicable_product_classes) > 0
       and not (pr.regulatory_class = any(c.applicable_product_classes)) then return false; end if;
  end if;

  if p_lot is not null then
    select * into lt from public.seed_lots where id = p_lot;
    if lt is null then return false; end if;
    if lt.status in ('recalled','expired','quarantined','depleted') then return false; end if;
    if lt.recall_status in ('SUPPLIER_RECALL','INTERNAL_RECALL') then return false; end if;
    if lt.compliance_review_required then return false; end if;
    if lt.sell_by_date is not null and lt.sell_by_date < on_date then return false; end if;
    -- The credential check that a state-level clearance must never bypass.
    if c.supplier_credential_required then
      if coalesce(btrim(lt.labeled_entity), '') = '' then return false; end if;
      if not public.seed_supplier_credential_ok(lt.labeled_entity, p_state, null, on_date)
        then return false; end if;
    end if;
  end if;

  return true;
end $$;

-- A lot missing any compliance-critical fact can never be picked by the
-- engine: unknown is not the same as fine.
create or replace function public.seed_lot_compliance_complete(l public.seed_lots)
returns boolean language sql immutable as $$
  select coalesce(btrim(l.labeled_entity), '') <> ''
     and l.treatment      <> 'UNKNOWN'
     and l.organic_claim  <> 'UNKNOWN'
     and l.country_of_origin is not null
     and l.sell_by_date   is not null
     and l.recall_status   = 'NONE';
$$;

create or replace function public.seed_lot_set_review_flag()
returns trigger language plpgsql as $$
begin
  new.compliance_review_required := not public.seed_lot_compliance_complete(new);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists seed_lot_review_flag_trg on public.seed_lots;
create trigger seed_lot_review_flag_trg
  before insert or update on public.seed_lots
  for each row execute function public.seed_lot_set_review_flag();

-- ===========================================================================
-- 8. Order lifecycle — states beyond `shipped`
-- ===========================================================================
do $$
declare con text;
begin
  select conname into con from pg_constraint
   where conrelid = 'public.seed_orders'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%status%' limit 1;
  if con is not null then
    execute format('alter table public.seed_orders drop constraint %I', con);
  end if;
  begin
    alter table public.seed_orders add constraint seed_orders_status_chk
      check (status in ('pending_payment','paid','reserved','picked','packed','shipped',
                        'delivered','delivery_issue','missing_packet','damaged_packet',
                        'replacement_pending','replacement_shipped','refunded','recalled',
                        'compliance_blocked','cancelled','needs_review'));
  exception when duplicate_object then null; end;
end $$;
alter table public.seed_orders
  add column if not exists lifecycle_note      text,
  add column if not exists compliance_block_reason text,
  add column if not exists ship_state          text,
  add column if not exists delivered_at        timestamptz;

-- ===========================================================================
-- 9. RLS + grants. Default posture: read for admins, writes only via RPC.
-- ===========================================================================
alter table public.seed_supplier_credentials enable row level security;
alter table public.seed_state_clearance      enable row level security;
alter table public.seed_capacity_controls    enable row level security;
alter table public.seed_packet_reservations  enable row level security;
alter table public.seed_purchase_orders      enable row level security;
alter table public.seed_lot_documents        enable row level security;

do $$ begin
  create policy ssc_admin_read on public.seed_supplier_credentials
    for select using (public.admin_has_perm('inventory.view') or public.admin_is_owner());
exception when duplicate_object then null; end $$;
do $$ begin
  -- Clearance is public-readable on purpose: the signup form must be able to
  -- say "we don't ship to your state yet" before anyone signs in. It carries
  -- no personal or confidential data.
  create policy ssc_state_public_read on public.seed_state_clearance
    for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy scc_admin_read on public.seed_capacity_controls
    for select using (public.admin_has_perm('seed_drop.view') or public.admin_is_owner());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy spr_own_read on public.seed_packet_reservations
    for select using (user_id = auth.uid()
                      or public.admin_has_perm('seed_drop.view') or public.admin_is_owner());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy spo_admin_read on public.seed_purchase_orders
    for select using (public.admin_has_perm('inventory.view') or public.admin_is_owner());
exception when duplicate_object then null; end $$;
do $$ begin
  -- Regulatory documents never leave the admin boundary; files are fetched by
  -- signed URL, never by a public object path.
  create policy sld_admin_read on public.seed_lot_documents
    for select using (public.admin_has_perm('inventory.view') or public.admin_is_owner());
exception when duplicate_object then null; end $$;

-- The 0087 lesson, applied pre-emptively: Supabase's default privileges grant
-- anon/authenticated ALL on every new table, and `revoke ... from public` does
-- NOT remove a role grant. Revoke from the ROLES by name.
revoke all on public.seed_supplier_credentials, public.seed_state_clearance,
              public.seed_capacity_controls,    public.seed_packet_reservations,
              public.seed_purchase_orders,      public.seed_lot_documents
  from public, anon, authenticated;
grant select on public.seed_state_clearance to anon, authenticated;
grant select on public.seed_packet_reservations to authenticated;

do $$ begin
  if to_regclass('storage.objects') is not null then
    execute $p$
      create policy seed_lot_docs_admin_all on storage.objects
        for all using (bucket_id = 'seed-lot-docs'
                       and (public.admin_has_perm('inventory.view') or public.admin_is_owner()))
        with check (bucket_id = 'seed-lot-docs'
                    and (public.admin_has_perm('inventory.edit') or public.admin_is_owner()))
    $p$;
  end if;
exception when duplicate_object then null; end $$;

-- Guard: none of the six new tables may be writable by a client role. This
-- fails the migration rather than shipping the 0087 hole again.
do $$
declare bad text;
begin
  select string_agg(distinct table_name||':'||grantee||':'||privilege_type, ', ')
    into bad
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('seed_supplier_credentials','seed_state_clearance',
                        'seed_capacity_controls','seed_packet_reservations',
                        'seed_purchase_orders','seed_lot_documents')
     and grantee in ('anon','authenticated')
     and privilege_type <> 'SELECT';
  if bad is not null then
    raise exception 'Seed Drop Phase 0 tables must be SELECT-only for client roles: %', bad;
  end if;
end $$;

-- ===========================================================================
-- 10. Audited admin writes (every one of them goes through admin_audit)
-- ===========================================================================
create or replace function public.admin_set_state_clearance(
  p_state text, p_status text, p_enabled boolean default null,
  p_official_source text default null, p_sources jsonb default null,
  p_registration_ref text default null, p_notes text default null,
  p_review_by date default null
) returns public.seed_state_clearance
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_row public.seed_state_clearance;
begin
  if not (public.admin_has_perm('compliance.rules_manage') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode='P0001';
  end if;
  if not public.seed_destination_supported(p_state) then
    raise exception 'UNSUPPORTED_DESTINATION' using errcode='P0001';
  end if;
  -- Enabling for checkout requires the conclusion to actually be CLEARED.
  if coalesce(p_enabled, false) and p_status <> 'CLEARED' then
    raise exception 'CANNOT_ENABLE_UNCLEARED_STATE' using errcode='P0001';
  end if;

  select to_jsonb(t) into v_old from public.seed_state_clearance t where state = p_state;

  insert into public.seed_state_clearance as s
    (state, status, official_source, source_refs, gnome_registration_ref,
     notes, review_by, verified_date, verified_by, enabled_for_checkout,
     enabled_by, enabled_at, updated_at)
  values (p_state, p_status, p_official_source, coalesce(p_sources, '[]'::jsonb),
          p_registration_ref, p_notes, p_review_by, current_date, auth.uid(),
          coalesce(p_enabled, false), case when coalesce(p_enabled,false) then auth.uid() end,
          case when coalesce(p_enabled,false) then now() end, now())
  on conflict (state) do update set
    status = excluded.status,
    official_source = coalesce(excluded.official_source, s.official_source),
    source_refs = coalesce(excluded.source_refs, s.source_refs),
    gnome_registration_ref = coalesce(excluded.gnome_registration_ref, s.gnome_registration_ref),
    notes = coalesce(excluded.notes, s.notes),
    review_by = coalesce(excluded.review_by, s.review_by),
    verified_date = current_date, verified_by = auth.uid(),
    enabled_for_checkout = coalesce(p_enabled, s.enabled_for_checkout),
    enabled_by = case when coalesce(p_enabled, s.enabled_for_checkout) then auth.uid() else s.enabled_by end,
    enabled_at = case when coalesce(p_enabled, s.enabled_for_checkout) then now() else s.enabled_at end,
    updated_at = now()
  returning * into v_row;

  perform public.admin_audit('seed.state_clearance.set', 'seed_state_clearance', p_state,
                             v_old, to_jsonb(v_row), p_notes, 'admin', null);
  return v_row;
end $$;
revoke all on function public.admin_set_state_clearance(text,text,boolean,text,jsonb,text,text,date) from public, anon;
grant execute on function public.admin_set_state_clearance(text,text,boolean,text,jsonb,text,text,date) to authenticated;

create or replace function public.admin_set_supplier_credential(
  p_supplier uuid, p_labeled_entity text, p_state text, p_type text,
  p_number text default null, p_effective date default null, p_expires date default null,
  p_verification_status text default 'UNVERIFIED', p_source text default null,
  p_packet_lines text[] default '{}', p_states text[] default '{}', p_notes text default null
) returns public.seed_supplier_credentials
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_row public.seed_supplier_credentials;
begin
  if not (public.admin_has_perm('compliance.rules_manage') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode='P0001';
  end if;
  -- A credential may only be marked VERIFIED with a citable source; this is
  -- the line the AI can never cross because it cannot reach this RPC at all.
  if p_verification_status = 'VERIFIED' and coalesce(btrim(p_source), '') = '' then
    raise exception 'VERIFICATION_REQUIRES_SOURCE' using errcode='P0001';
  end if;

  select to_jsonb(t) into v_old from public.seed_supplier_credentials t
   where supplier_id = p_supplier and labeled_entity = p_labeled_entity
     and issuing_state = p_state and credential_type = p_type;

  insert into public.seed_supplier_credentials as c
    (supplier_id, labeled_entity, issuing_state, credential_type, credential_number,
     effective_date, expiration_date, verification_status, verification_source,
     verified_date, verified_by, applicable_packet_lines, applicable_states, notes)
  values (p_supplier, p_labeled_entity, p_state, p_type, p_number,
          p_effective, p_expires, p_verification_status, p_source,
          case when p_verification_status = 'VERIFIED' then current_date end, auth.uid(),
          coalesce(p_packet_lines,'{}'), coalesce(p_states,'{}'), p_notes)
  on conflict (supplier_id, labeled_entity, issuing_state, credential_type) do update set
    credential_number = coalesce(excluded.credential_number, c.credential_number),
    effective_date = coalesce(excluded.effective_date, c.effective_date),
    expiration_date = coalesce(excluded.expiration_date, c.expiration_date),
    verification_status = excluded.verification_status,
    verification_source = coalesce(excluded.verification_source, c.verification_source),
    verified_date = case when excluded.verification_status = 'VERIFIED' then current_date else c.verified_date end,
    verified_by = auth.uid(),
    applicable_packet_lines = excluded.applicable_packet_lines,
    applicable_states = excluded.applicable_states,
    notes = coalesce(excluded.notes, c.notes),
    updated_at = now()
  returning * into v_row;

  perform public.admin_audit('seed.supplier_credential.set', 'seed_supplier_credentials',
                             v_row.id::text, v_old, to_jsonb(v_row), p_notes, 'admin', null);
  return v_row;
end $$;
revoke all on function public.admin_set_supplier_credential(uuid,text,text,text,text,date,date,text,text,text[],text[],text) from public, anon;
grant execute on function public.admin_set_supplier_credential(uuid,text,text,text,text,date,date,text,text,text[],text[],text) to authenticated;

create or replace function public.admin_set_seed_capacity(p_patch jsonb)
returns public.seed_capacity_controls
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_row public.seed_capacity_controls;
begin
  if not (public.admin_has_perm('seed_drop.manage') or public.admin_is_owner()) then
    raise exception 'NOT_AUTHORIZED' using errcode='P0001';
  end if;
  select to_jsonb(t) into v_old from public.seed_capacity_controls t where id;

  update public.seed_capacity_controls c set
    seed_drop_enabled           = coalesce((p_patch->>'seed_drop_enabled')::boolean, c.seed_drop_enabled),
    seed_drop_checkout_enabled  = coalesce((p_patch->>'seed_drop_checkout_enabled')::boolean, c.seed_drop_checkout_enabled),
    ohio_pilot_enabled          = coalesce((p_patch->>'ohio_pilot_enabled')::boolean, c.ohio_pilot_enabled),
    interstate_enabled          = coalesce((p_patch->>'interstate_enabled')::boolean, c.interstate_enabled),
    enrollment_mode             = coalesce(p_patch->>'enrollment_mode', c.enrollment_mode),
    custom_sizes_enabled        = coalesce((p_patch->>'custom_sizes_enabled')::boolean, c.custom_sizes_enabled),
    max_active_subscribers      = coalesce((p_patch->>'max_active_subscribers')::int, c.max_active_subscribers),
    max_new_subscribers_per_day = coalesce((p_patch->>'max_new_subscribers_per_day')::int, c.max_new_subscribers_per_day),
    max_packets_per_period      = coalesce((p_patch->>'max_packets_per_period')::int, c.max_packets_per_period),
    max_custom_size             = coalesce((p_patch->>'max_custom_size')::int, c.max_custom_size),
    per_state_caps              = coalesce(p_patch->'per_state_caps', c.per_state_caps),
    seasonal_window_open        = coalesce((p_patch->>'seasonal_window_open')::boolean, c.seasonal_window_open),
    supplier_outage             = coalesce((p_patch->>'supplier_outage')::boolean, c.supplier_outage),
    carrier_outage              = coalesce((p_patch->>'carrier_outage')::boolean, c.carrier_outage),
    recall_pause                = coalesce((p_patch->>'recall_pause')::boolean, c.recall_pause),
    emergency_pause             = coalesce((p_patch->>'emergency_pause')::boolean, c.emergency_pause),
    pause_reason                = coalesce(p_patch->>'pause_reason', c.pause_reason),
    reservation_ttl_minutes     = coalesce((p_patch->>'reservation_ttl_minutes')::int, c.reservation_ttl_minutes),
    payment_recovery_minutes    = coalesce((p_patch->>'payment_recovery_minutes')::int, c.payment_recovery_minutes),
    updated_by = auth.uid(), updated_at = now()
  where c.id returning * into v_row;

  perform public.admin_audit('seed.capacity.set', 'seed_capacity_controls', 'singleton',
                             v_old, to_jsonb(v_row), p_patch->>'pause_reason', 'admin', null);
  return v_row;
end $$;
revoke all on function public.admin_set_seed_capacity(jsonb) from public, anon;
grant execute on function public.admin_set_seed_capacity(jsonb) to authenticated;

-- ===========================================================================
-- 11. Rollback sketch (full script: 0089_down_…sql)
--   drop the six new tables + their functions, restore the prior check
--   constraints on seed_lots.status / seed_orders.status, and re-assert
--   seed_products.packet_seed_count NOT NULL DEFAULT 25.
-- ===========================================================================
notify pgrst, 'reload schema';
