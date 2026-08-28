-- 0044: server-side publish enforcement + expiry/reactivation automation.
-- Applied to production 2026-08-10 as 'compliance_publish_trigger_and_automation'.
-- Reconstructed from the live database state.

-- The client is advisory; THIS is the enforcement. Publishing (INSERT active or
-- UPDATE into active / into a new node) re-runs the gate server-side. Admins
-- bypass. Editing an already-live listing in place is not a publish.
create or replace function public.listings_enforce_compliance()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  verdict record;
begin
  if new.taxonomy_node_id is null then return new; end if;
  if new.status is distinct from 'active'::public.listing_status then return new; end if;
  if tg_op = 'UPDATE'
     and old.status = 'active'::public.listing_status
     and old.taxonomy_node_id is not distinct from new.taxonomy_node_id then
    return new;  -- already-live listing being edited in place; not a publish
  end if;
  if public.is_admin() then return new; end if;

  select * into verdict from public.can_publish_in_node(new.taxonomy_node_id, new.owner_id);
  if verdict.allowed then return new; end if;

  raise exception 'COMPLIANCE_BLOCKED:%:%', verdict.reason, coalesce(verdict.message, '')
    using errcode = 'P0001';
end $$;

drop trigger if exists listings_compliance_gate on public.listings;
create trigger listings_compliance_gate
  before insert or update on public.listings
  for each row execute function public.listings_enforce_compliance();

-- Daily sweep: expire overdue credentials, then pause (never delete) any active
-- listing whose seller can no longer publish in its node.
create or replace function public.compliance_run_expiry()
returns table(expired_credentials integer, paused_listings integer)
language plpgsql security definer set search_path = public as $$
declare exp_count int := 0; paused int := 0;
begin
  with expiring as (
    update public.seller_credentials
       set status = 'EXPIRED', updated_at = now()
     where status = 'APPROVED'
       and expiration_date is not null
       and expiration_date < current_date
    returning id, seller_id
  )
  select count(*) into exp_count from expiring;

  with candidates as (
    select l.id
      from public.listings l
     where l.status = 'active'
       and l.taxonomy_node_id is not null
       and exists (
         select 1 from public.compliance_rules r
         join public.marketplace_taxonomy_nodes rn on rn.id = r.taxonomy_node_id
         join public.marketplace_taxonomy_nodes ln on ln.id = l.taxonomy_node_id
         where r.classification in ('REGULATED','REVIEW_REQUIRED')
           and (ln.path = rn.path or ln.path like rn.path || '/%')
       )
       and not (select allowed from public.can_publish_in_node(l.taxonomy_node_id, l.owner_id))
  ), paused_rows as (
    update public.listings l
       set status = 'paused'::public.listing_status
      from candidates c
     where l.id = c.id
    returning l.id
  )
  select count(*) into paused from paused_rows;

  return query select exp_count, paused;
end $$;
revoke all on function public.compliance_run_expiry() from public, anon, authenticated;

-- When a seller renews a credential or resubscribes, resume their paused
-- listings that now pass the gate — no re-review, nothing recreated.
create or replace function public.compliance_reactivate_for_seller(p_seller uuid default auth.uid())
returns integer
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if p_seller is null or (p_seller <> auth.uid() and not public.is_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  with resumable as (
    select l.id from public.listings l
     where l.owner_id = p_seller
       and l.status = 'paused'
       and l.taxonomy_node_id is not null
       and (select allowed from public.can_publish_in_node(l.taxonomy_node_id, p_seller))
  ), done as (
    update public.listings l set status = 'active'::public.listing_status
      from resumable r where l.id = r.id returning l.id
  )
  select count(*) into n from done;
  return n;
end $$;
