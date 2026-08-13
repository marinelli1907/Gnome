-- 0087 — remove the world-readable `profiles` footgun.
--
-- NOT YET APPLIED TO PRODUCTION. Apply only with owner approval; see
-- docs/security/PROFILE_VISIBILITY.md for the rollback and the one behavioural
-- check to run afterwards (PostgREST view embedding).
--
-- ============================ THE PROBLEM ==================================
-- 0001 shipped `profiles_select_all ... USING (true)`: every row of `profiles`
-- is readable by every signed-in user AND by anonymous visitors. Column-level
-- grants (0058 etc.) narrow WHICH columns, but the blanket row policy means
-- anything that is granted is public, and it is easy for a future column to be
-- granted by a broad `grant select on public.profiles` and silently go public.
--
-- Concretely, today anon + authenticated can read these for EVERY user:
--   can_post, can_claim, can_sponsor, can_create_promotions,
--   can_offer_delivery, suspended
-- Those are entitlement/moderation flags — administrative state, not profile
-- content. Nothing in the apps consumes them for other users; they are selected
-- only because the shared TypeScript `Profile` type lists them.
--
-- ============================ THE FIX =======================================
-- Rows:    `profiles` becomes owner-or-admin readable. No blanket policy.
-- Columns: other users read an EXPLICIT projection, `public_profiles`, which
--          enumerates its columns. `select *` is deliberately not used, so a
--          column added to `profiles` tomorrow is invisible here until someone
--          edits this view on purpose.
-- Grants:  the administrative columns lose their anon/authenticated SELECT
--          grant outright (defence in depth: even if a future migration
--          re-adds a permissive row policy, those columns stay unreadable).
--
-- Owner self-reads keep working two ways: directly (the owner policy) and via
-- the existing SECURITY DEFINER `my_profile()` RPC.
-- Admin reads keep working through `is_admin()`, which already gates the
-- moderation surfaces.
--
-- Additive and reversible: no column is dropped, no data is moved, and 0087_
-- down_profiles_public_projection.sql restores the previous behaviour exactly.

-- ---------------------------------------------------------------------------
-- 1. The explicit public projection.
-- ---------------------------------------------------------------------------
-- A plain (security-definer) view: it reads `profiles` as its owner, so it is
-- unaffected by the row policies below — that is precisely how other users get
-- the public fields without being able to touch the table.
create or replace view public.public_profiles as
select
  p.id,
  p.name,               -- public display name, "First L."
  p.avatar_url,
  p.city,
  p.county,
  p.state,
  p.user_type,
  p.business_account,
  p.business_category,
  p.created_at
from public.profiles p;

comment on view public.public_profiles is
  'The ONLY profile projection other users and anonymous visitors may read. Columns are enumerated on purpose: never use select *, so a new column on profiles is not exposed automatically. Excludes administrative flags (can_*, suspended), onboarding state, and anything from user_private_contact. Runs with the view owner''s rights (security_invoker=false) BY DESIGN — that is what lets it serve public fields while the base table stays owner/admin-only.';

-- EXPLICIT, not inherited from a default. The safety of this projection rests
-- on the view executing with its OWNER's rights rather than the caller's:
--   * the view is owned by `postgres`, which also owns `profiles`;
--   * `profiles` has RLS enabled but NOT forced (relforcerowsecurity = false),
--     so the owner is not subject to the row policies;
--   * therefore the view can return the ten public columns for every row even
--     though the caller can read none of the base table.
-- Setting this explicitly means a future change to the PostgreSQL default (or
-- someone copying this file) cannot silently flip the behaviour. If the view
-- ever became security_invoker=true, it would return zero rows for other users
-- — a visible failure, not a silent leak.
alter view public.public_profiles set (security_invoker = false);
alter view public.public_profiles set (security_barrier = true);

revoke all on public.public_profiles from public;
grant select on public.public_profiles to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Row policies: owner or admin. The blanket policy goes away.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_all" on public.profiles;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

-- Admins keep the read they already need for moderation; `is_admin()` is the
-- same helper that gates admin_users membership elsewhere.
drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Administrative columns: harden the anonymous surface.
-- ---------------------------------------------------------------------------
-- Column grants are ROLE-wide, not row-scoped, and Gnome's admins authenticate
-- as `authenticated` like everyone else — revoking these from `authenticated`
-- would break the admin moderation screens (web AdminClient reads
-- id,name,suspended; admin/App.tsx reads suspended + user_type).
--
-- The row policy above is what actually confines them: a non-admin gets ZERO
-- rows for anybody else, so they cannot read another user's flags at all, and
-- reading the flags on their OWN row is harmless and expected.
--
-- `anon` is never an admin, so revoking there is free hardening: two
-- independent controls (no rows, and no column) instead of one.
revoke select (can_post, can_claim, can_sponsor, can_create_promotions,
               can_offer_delivery, suspended)
  on public.profiles from anon;

-- `onboarding_completed_at` was never granted to anon; my_onboarding_state()
-- is the only reader. Belt and braces in case a future grant is broad.
revoke select (onboarding_completed_at) on public.profiles from anon;

-- ---------------------------------------------------------------------------
-- 4. Keep future columns closed by default.
-- ---------------------------------------------------------------------------
-- anon/authenticated intentionally hold NO table-level SELECT on profiles —
-- only the column-level grants listed in 0001/0058. Column grants do not extend
-- to columns added later, so a new column is unreadable until granted on
-- purpose. This makes that invariant explicit and self-documenting.
do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'profiles'
      and privilege_type = 'SELECT' and grantee in ('anon', 'authenticated')
  ) then
    raise exception 'profiles has a TABLE-level SELECT grant for anon/authenticated; future columns would be exposed automatically. Grant per-column instead.';
  end if;
end $$;
