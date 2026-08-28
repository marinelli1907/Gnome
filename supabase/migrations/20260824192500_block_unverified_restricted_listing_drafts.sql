-- Block unverified regulated/review-required products before a listing row is
-- created, even if a client tries to save it as paused. The mobile app now
-- blocks this in UI, but the database remains the launch gate for old clients,
-- web clients, imports, and direct API writes.

begin;

create or replace function public.listings_enforce_compliance()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  verdict record;
  restricted boolean := false;
begin
  if new.taxonomy_node_id is null then return new; end if;
  if public.is_admin() then return new; end if;

  select exists (
    select 1
      from public.compliance_rules r
      join public.marketplace_taxonomy_nodes rn on rn.id = r.taxonomy_node_id
      join public.marketplace_taxonomy_nodes ln on ln.id = new.taxonomy_node_id
     where r.classification in ('REGULATED','REVIEW_REQUIRED')
       and (ln.path = rn.path or ln.path like rn.path || '/%')
  ) into restricted;

  -- Ordinary paused drafts in unrestricted categories are still allowed. For
  -- restricted categories, "paused" must not be a way to create an unverified
  -- product listing first and ask questions later.
  if new.status is distinct from 'active'::public.listing_status and not restricted then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'active'::public.listing_status
     and new.status = 'active'::public.listing_status
     and old.taxonomy_node_id is not distinct from new.taxonomy_node_id then
    return new;  -- already-live listing being edited in place; not a publish
  end if;

  select * into verdict from public.can_publish_in_node(new.taxonomy_node_id, new.owner_id);
  if verdict.allowed then return new; end if;

  raise exception 'COMPLIANCE_BLOCKED:%:%', verdict.reason, coalesce(verdict.message, '')
    using errcode = 'P0001';
end $$;

drop trigger if exists listings_compliance_gate on public.listings;
create trigger listings_compliance_gate
  before insert or update on public.listings
  for each row execute function public.listings_enforce_compliance();

commit;
