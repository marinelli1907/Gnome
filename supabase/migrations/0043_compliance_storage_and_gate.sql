-- 0043: private permit storage + the authoritative publish gate.
-- Applied to production 2026-08-10 as 'compliance_storage_and_gate'.
-- Reconstructed from the live database state (bucket, policies, and function
-- bodies below match production exactly).

-- Private bucket: permit documents are NEVER public. Reads happen through
-- short-lived signed URLs, and only the owner (their auth.uid() folder) or an
-- admin can create one.
insert into storage.buckets (id, name, public)
values ('compliance-docs', 'compliance-docs', false)
on conflict (id) do update set public = false;

create policy compliance_docs_select_own_or_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'compliance-docs'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create policy compliance_docs_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'compliance-docs'
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy compliance_docs_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'compliance-docs'
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy compliance_docs_delete_own_or_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'compliance-docs'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- Nearest-ancestor rule resolution: a rule on meat/ covers meat/beef/ground-beef
-- unless a more specific rule exists. Most specific (longest path) wins.
create or replace function public.effective_compliance_rule(p_node_id uuid, p_jurisdiction text default 'US-OH')
returns public.compliance_rules
language sql stable security definer set search_path = public as $$
  with target as (select path from public.marketplace_taxonomy_nodes where id = p_node_id)
  select r.*
    from public.compliance_rules r
    join public.marketplace_taxonomy_nodes n on n.id = r.taxonomy_node_id
    join target t on t.path = n.path or t.path like n.path || '/%'
   where r.jurisdiction = p_jurisdiction
     and r.review_status <> 'SUPERSEDED'
   order by length(n.path) desc   -- most specific rule wins
   limit 1;
$$;

create or replace function public.user_has_paid_plan(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.markets m
     where m.owner_id = p_user and m.plan <> 'free'::public.market_plan
  );
$$;

-- THE publish gate. SECURITY DEFINER so it can weigh credentials/rules the
-- caller can't read directly; the BEFORE trigger on listings (0044) makes it
-- unbypassable no matter what client talks to the API.
-- (Body as applied in production; extended additively by 0046.)
create or replace function public.can_publish_in_node(
  p_node_id uuid,
  p_user uuid default auth.uid(),
  p_jurisdiction text default 'US-OH'
) returns table(allowed boolean, reason text, message text)
language plpgsql stable security definer set search_path = public as $$
declare
  r public.compliance_rules;
  node public.marketplace_taxonomy_nodes;
  cred_count int;
begin
  if p_user is null then
    return query select false, 'NOT_SIGNED_IN', 'Sign in to publish a listing.'; return;
  end if;
  select * into node from public.marketplace_taxonomy_nodes where id = p_node_id;
  if node is null then
    return query select true, 'NO_NODE', 'No category selected.'; return;
  end if;
  if node.prohibited then
    return query select false, 'PROHIBITED', 'This kind of item cannot be sold on Gnome.'; return;
  end if;

  select * into r from public.effective_compliance_rule(p_node_id, p_jurisdiction);

  if r is null or r.classification = 'GENERALLY_UNRESTRICTED' then
    return query select true, 'UNRESTRICTED', null::text; return;
  end if;

  if r.classification = 'PROHIBITED' then
    return query select false, 'PROHIBITED',
      coalesce(r.notes, 'This kind of item cannot be sold on Gnome.'); return;
  end if;

  if r.classification = 'CONDITIONAL' then
    return query select true, 'CONDITIONAL', r.seller_attestation; return;
  end if;

  if r.minimum_plan <> 'free' and not public.user_has_paid_plan(p_user) then
    return query select false, 'PLAN_REQUIRED',
      'Selling this type of product requires a paid Gnome seller plan and regulatory verification.';
    return;
  end if;

  select count(*) into cred_count
    from public.seller_credentials c
    join public.credential_taxonomy_scope s on s.credential_id = c.id
    join public.marketplace_taxonomy_nodes sn on sn.id = s.taxonomy_node_id
   where c.seller_id = p_user
     and c.status = 'APPROVED'
     and (c.expiration_date is null or c.expiration_date >= current_date)
     and (node.path = sn.path or node.path like sn.path || '/%');

  if cred_count > 0 then
    return query select true, 'CREDENTIAL_OK', null::text; return;
  end if;

  if exists (
    select 1 from public.seller_credentials c
    join public.credential_taxonomy_scope s on s.credential_id = c.id
    join public.marketplace_taxonomy_nodes sn on sn.id = s.taxonomy_node_id
    where c.seller_id = p_user and c.status = 'PENDING'
      and (node.path = sn.path or node.path like sn.path || '/%')
  ) then
    return query select false, 'CREDENTIAL_PENDING',
      'Your documentation for this category is being reviewed. You can save a draft, but it cannot be published yet.';
    return;
  end if;

  if exists (
    select 1 from public.seller_credentials c
    join public.credential_taxonomy_scope s on s.credential_id = c.id
    join public.marketplace_taxonomy_nodes sn on sn.id = s.taxonomy_node_id
    where c.seller_id = p_user and c.status in ('EXPIRED','RENEWAL_REQUIRED')
      and (node.path = sn.path or node.path like sn.path || '/%')
  ) then
    return query select false, 'CREDENTIAL_EXPIRED',
      'Your credential for this category expired. Renew it to reactivate these listings.';
    return;
  end if;

  return query select false, 'CREDENTIAL_REQUIRED',
    coalesce('This product requires additional verification' ||
             case when r.credential_requirement is not null
                  then ' (' || r.credential_requirement || ')' else '' end || '.',
             'This product requires additional verification.');
end $$;
