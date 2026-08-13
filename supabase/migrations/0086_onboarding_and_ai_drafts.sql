-- 0086 — Conversational onboarding + the AI tab's memory and "arms".
--
-- THREE additions, all additive and owner-scoped:
--
--  1. user_private_contact — real name / phone / contact email.
--     `profiles` is WORLD-READABLE (`profiles_select_all ... using (true)` from
--     0001), so contact details must NEVER live there. This table is owner-only
--     with no world-read policy; `profiles.name` stays the public display name
--     ("First L."), which is all other neighbors ever see.
--
--  2. profiles.onboarding_completed_at — lets the app route a new account into
--     the gnome onboarding chat exactly once, and never block them again.
--
--  3. listing_drafts — the AI's only "arm". Photo analysis writes DRAFTS here;
--     nothing is ever published without the owner approving it. Publishing goes
--     through a normal INSERT into `listings`, so the existing
--     `listings_enforce_plan_limit` trigger and every other listing trigger
--     still apply — a draft can never smuggle a listing past the plan cap.
--
--  Plus ai_chat_messages so the AI tab keeps a real conversation history.

-- ---------------------------------------------------------------------------
-- 1. Private contact details (owner-only; never world-readable).
-- ---------------------------------------------------------------------------
create table if not exists public.user_private_contact (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  first_name    text,
  last_name     text,
  phone_e164    text,
  contact_email text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.user_private_contact enable row level security;

drop policy if exists user_private_contact_own on public.user_private_contact;
create policy user_private_contact_own on public.user_private_contact
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.user_private_contact is
  'Owner-only contact details. Deliberately separate from the world-readable profiles table so a real name, phone, or email is never exposed to other users.';

-- ---------------------------------------------------------------------------
-- 2. Onboarding state on the profile.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. AI listing drafts — approve / edit / discard, never auto-published.
-- ---------------------------------------------------------------------------
create table if not exists public.listing_drafts (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references auth.users(id) on delete cascade,
  market_id            uuid references public.markets(id) on delete cascade,
  batch_id             uuid,                       -- groups one bulk upload
  source               text not null default 'ai_photo',
  status               text not null default 'pending'
                         check (status in ('pending', 'published', 'discarded')),
  -- Everything the AI generated; the owner may edit any of it before publishing.
  title                text,
  description          text,
  category             text,
  taxonomy_node_id     uuid references public.marketplace_taxonomy_nodes(id),
  listing_type         listing_type not null default 'sale',
  price_cents          integer check (price_cents is null or price_cents >= 0),
  unit                 text,
  quantity             text,
  photos               text[] not null default '{}',
  -- AI provenance so the review UI can show confidence and flag risky items.
  ai_confidence        numeric,
  ai_candidate_name    text,
  ai_alternatives      text[] not null default '{}',
  ai_seller_questions  text[] not null default '{}',
  compliance_attention boolean not null default false,
  published_listing_id uuid references public.listings(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists listing_drafts_owner_status_idx
  on public.listing_drafts (owner_id, status, created_at desc);
create index if not exists listing_drafts_batch_idx
  on public.listing_drafts (batch_id);

alter table public.listing_drafts enable row level security;

-- The owner may read/update/delete their own drafts. INSERT is service-role
-- only (the edge function writes them) so a client can't fabricate AI output.
drop policy if exists listing_drafts_select_own on public.listing_drafts;
create policy listing_drafts_select_own on public.listing_drafts
  for select using (auth.uid() = owner_id);

drop policy if exists listing_drafts_update_own on public.listing_drafts;
create policy listing_drafts_update_own on public.listing_drafts
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists listing_drafts_delete_own on public.listing_drafts;
create policy listing_drafts_delete_own on public.listing_drafts
  for delete using (auth.uid() = owner_id);

comment on table public.listing_drafts is
  'AI-generated listing drafts awaiting owner approval. Inserted by the edge function (service role) only; publishing goes through a normal listings INSERT so all plan-limit and validation triggers still apply.';

-- ---------------------------------------------------------------------------
-- 4. AI tab conversation history (owner-only).
-- ---------------------------------------------------------------------------
create table if not exists public.ai_chat_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_chat_messages_user_idx
  on public.ai_chat_messages (user_id, created_at);

alter table public.ai_chat_messages enable row level security;

drop policy if exists ai_chat_messages_own on public.ai_chat_messages;
create policy ai_chat_messages_own on public.ai_chat_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Save onboarding answers. Server-side validation: the conversational layer
-- extracts fields, but only values that pass THESE checks are ever stored, and
-- the public display name is derived here ("First L.") rather than by the model.
create or replace function public.save_onboarding_contact(
  p_first_name text default null,
  p_last_name  text default null,
  p_phone      text default null,
  p_email      text default null,
  p_complete   boolean default false
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  fn     text;
  ln     text;
  ph     text;
  em     text;
  display text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  fn := nullif(btrim(coalesce(p_first_name, '')), '');
  ln := nullif(btrim(coalesce(p_last_name, '')), '');
  em := lower(nullif(btrim(coalesce(p_email, '')), ''));
  -- Keep digits (and a leading +) only; store E.164-ish or reject.
  ph := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');

  if fn is not null and length(fn) > 60 then raise exception 'FIRST_NAME_TOO_LONG'; end if;
  if ln is not null and length(ln) > 60 then raise exception 'LAST_NAME_TOO_LONG'; end if;
  if em is not null and em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_EMAIL';
  end if;
  if ph is not null and length(regexp_replace(ph, '[^0-9]', '', 'g')) not between 7 and 15 then
    raise exception 'INVALID_PHONE';
  end if;

  insert into public.user_private_contact as c (user_id, first_name, last_name, phone_e164, contact_email)
  values (uid, fn, ln, ph, em)
  on conflict (user_id) do update set
    first_name    = coalesce(excluded.first_name,    c.first_name),
    last_name     = coalesce(excluded.last_name,     c.last_name),
    phone_e164    = coalesce(excluded.phone_e164,    c.phone_e164),
    contact_email = coalesce(excluded.contact_email, c.contact_email),
    updated_at    = now();

  -- Public display name = "First L." — never the full last name.
  select c.first_name, c.last_name into fn, ln
    from public.user_private_contact c where c.user_id = uid;
  if fn is not null then
    display := fn || case when ln is not null and ln <> '' then ' ' || upper(left(ln, 1)) || '.' else '' end;
    update public.profiles set name = display where id = uid;
  end if;

  if p_complete then
    update public.profiles set onboarding_completed_at = now()
    where id = uid and onboarding_completed_at is null;
  end if;

  return public.my_onboarding_state();
end;
$$;

-- What the app needs to decide whether to show onboarding, and to prefill.
create or replace function public.my_onboarding_state()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r   record;
  p   record;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into r from public.user_private_contact where user_id = uid;
  select onboarding_completed_at, name into p from public.profiles where id = uid;
  return jsonb_build_object(
    'completed',     p.onboarding_completed_at is not null,
    'display_name',  p.name,
    'first_name',    r.first_name,
    'last_name',     r.last_name,
    'phone',         r.phone_e164,
    'contact_email', r.contact_email,
    'missing', (
      select coalesce(jsonb_agg(k), '[]'::jsonb) from (
        select 'first_name' as k where r.first_name is null
        union all select 'last_name' where r.last_name is null
        union all select 'contact_email' where r.contact_email is null
      ) m
    )
  );
end;
$$;

-- Skip onboarding without answering (never trap a user in a chat).
create or replace function public.skip_onboarding()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  update public.profiles set onboarding_completed_at = now()
  where id = uid and onboarding_completed_at is null;
  return public.my_onboarding_state();
end;
$$;

-- Publish one draft as a real listing. Ownership is re-checked here, and the
-- INSERT goes through every existing listings trigger (plan cap, normalization,
-- taxonomy autofill), so this cannot bypass entitlements.
create or replace function public.publish_listing_draft(p_draft uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  d   public.listing_drafts;
  mkt uuid;
  new_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  select * into d from public.listing_drafts where id = p_draft;
  if d.id is null then raise exception 'DRAFT_NOT_FOUND'; end if;
  if d.owner_id <> uid then raise exception 'NOT_YOUR_DRAFT'; end if;
  if d.status <> 'pending' then raise exception 'DRAFT_ALREADY_%', d.status; end if;
  if coalesce(btrim(d.title), '') = '' then raise exception 'DRAFT_TITLE_REQUIRED'; end if;

  select id into mkt from public.markets where owner_id = uid limit 1;

  insert into public.listings (
    owner_id, market_id, title, description, category, taxonomy_node_id,
    listing_type, price_cents, unit, quantity, photos, status, expires_at
  ) values (
    uid, coalesce(d.market_id, mkt), btrim(d.title), d.description,
    coalesce(nullif(btrim(coalesce(d.category, '')), ''), 'produce'),
    d.taxonomy_node_id, d.listing_type,
    case when d.listing_type = 'sale' then d.price_cents else null end,
    d.unit, d.quantity, d.photos, 'active', now() + interval '30 days'
  ) returning id into new_id;

  update public.listing_drafts
     set status = 'published', published_listing_id = new_id, updated_at = now()
   where id = p_draft;

  return new_id;
end;
$$;

create or replace function public.discard_listing_draft(p_draft uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  update public.listing_drafts
     set status = 'discarded', updated_at = now()
   where id = p_draft and owner_id = uid and status = 'pending';
  if not found then raise exception 'DRAFT_NOT_FOUND'; end if;
end;
$$;

revoke all on function public.save_onboarding_contact(text, text, text, text, boolean) from public, anon;
revoke all on function public.my_onboarding_state() from public, anon;
revoke all on function public.skip_onboarding() from public, anon;
revoke all on function public.publish_listing_draft(uuid) from public, anon;
revoke all on function public.discard_listing_draft(uuid) from public, anon;

grant execute on function public.save_onboarding_contact(text, text, text, text, boolean) to authenticated;
grant execute on function public.my_onboarding_state() to authenticated;
grant execute on function public.skip_onboarding() to authenticated;
grant execute on function public.publish_listing_draft(uuid) to authenticated;
grant execute on function public.discard_listing_draft(uuid) to authenticated;
