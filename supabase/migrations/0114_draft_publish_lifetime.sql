-- 0114: publish_listing_draft must use the canonical listing lifetime, not 30 days.
--
-- Found during the market-import reconnaissance and confirmed in production: 0086's publisher
-- inserted every draft-published listing with `expires_at = now() + interval '30 days'`. Under
-- the 0104 model that is a monetization bypass for Sell — every other Sell listing lives
-- plan_limits.listing_lifetime_days (7 today) and then meets the renewal model, while AI-drafted
-- listings quietly got 30 days. The repair gives the publisher the SAME lifetime semantics as a
-- normal publish:
--
--   * sale  → plan lifetime via market_effective_plan + plan_limits, exactly like renew_listing;
--   * other types → expires_at NULL, so the canonical 0006 stamping trigger decides
--     (wanted 30 days, everything else 7) — identical to a direct listings INSERT.
--
-- Nothing else moves: the INSERT still sets status='active', so the publish-allowance trigger,
-- content screening, compliance gates and suspension checks all fire unchanged. Listings already
-- published with the 30-day bug are deliberately NOT rewritten.

create or replace function public.publish_listing_draft(p_draft uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  d   public.listing_drafts;
  mkt uuid;
  days int;
  v_expires timestamptz;
  new_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  select * into d from public.listing_drafts where id = p_draft;
  if d.id is null then raise exception 'DRAFT_NOT_FOUND'; end if;
  if d.owner_id <> uid then raise exception 'NOT_YOUR_DRAFT'; end if;
  if d.status <> 'pending' then raise exception 'DRAFT_ALREADY_%', d.status; end if;
  if coalesce(btrim(d.title), '') = '' then raise exception 'DRAFT_TITLE_REQUIRED'; end if;

  select id into mkt from public.markets where owner_id = uid limit 1;

  if d.listing_type = 'sale' then
    -- The plan's lifetime, resolved the same way renew_listing resolves it.
    select coalesce(pl.listing_lifetime_days, 7) into days
    from public.market_effective_plan(coalesce(d.market_id, mkt)) ep
    join public.plan_limits pl on pl.plan = ep.plan;
    v_expires := now() + make_interval(days => coalesce(days, 7));
  else
    -- Defer to the canonical per-type stamping trigger (0006): wanted 30d, others 7d.
    v_expires := null;
  end if;

  insert into public.listings (
    owner_id, market_id, title, description, category, taxonomy_node_id,
    listing_type, price_cents, unit, quantity, photos, status, expires_at
  ) values (
    uid, coalesce(d.market_id, mkt), btrim(d.title), d.description,
    coalesce(nullif(btrim(coalesce(d.category, '')), ''), 'produce'),
    d.taxonomy_node_id, d.listing_type,
    case when d.listing_type = 'sale' then d.price_cents else null end,
    d.unit, d.quantity, d.photos, 'active', v_expires
  ) returning id into new_id;

  update public.listing_drafts
     set status = 'published', published_listing_id = new_id, updated_at = now()
   where id = p_draft;

  return new_id;
end;
$$;

-- Grants unchanged; re-stated for a faithful fresh replay.
revoke all on function public.publish_listing_draft(uuid) from public, anon;
grant execute on function public.publish_listing_draft(uuid) to authenticated;

notify pgrst, 'reload schema';
