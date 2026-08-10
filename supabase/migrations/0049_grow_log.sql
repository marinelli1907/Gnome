-- 0049: Grow Log — a private progress journal on an active plot reservation
-- (plot reservations are claims with claim_type = 'plot_reservation').
--
-- Permissions model (the core of this feature):
--  * grower  = claims.claimer_id  → writes journal ENTRIES, edits/deletes only
--    their own rows (updated_at preserved on edit; authorship immutable)
--  * owner   = plot listing's owner → reads everything, writes OWNER NOTES
--    only; can never modify or delete the grower's history
--  * admins  → read (existing moderation posture)
--  * everyone else → nothing, including photos (private bucket, signed URLs)

-- Party check used by RLS and storage policies.
create or replace function public.is_plot_party(p_claim uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.claims c
    join public.listings l on l.id = c.listing_id
    where c.id = p_claim
      and (c.claimer_id = auth.uid() or l.owner_id = auth.uid())
  );
$$;
revoke all on function public.is_plot_party(uuid) from public, anon;
grant execute on function public.is_plot_party(uuid) to authenticated;

create table if not exists public.plot_grow_logs (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'entry' check (kind in ('entry','owner_note')),
  stage text check (stage is null or stage in
    ('PLOT_PREP','PLANTED','SPROUTED','GROWING','FLOWERING','FRUITING','HARVESTING','FINISHED')),
  title text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pgl_claim_idx on public.plot_grow_logs(claim_id, created_at);

create table if not exists public.plot_grow_log_photos (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.plot_grow_logs(id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index if not exists pglp_log_idx on public.plot_grow_log_photos(log_id);

create table if not exists public.plot_crops (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  taxonomy_node_id uuid references public.marketplace_taxonomy_nodes(id) on delete set null,
  name text not null,
  variety text,
  planted_at date,
  expected_harvest date,
  status text not null default 'growing' check (status in ('planned','growing','harvested','finished')),
  quantity int check (quantity is null or quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pc_claim_idx on public.plot_crops(claim_id);

alter table public.plot_grow_logs enable row level security;
alter table public.plot_grow_log_photos enable row level security;
alter table public.plot_crops enable row level security;

-- Reads: the two parties + admins. Nobody else, full stop.
create policy pgl_select_parties on public.plot_grow_logs
  for select to authenticated
  using (public.is_plot_party(claim_id) or public.is_admin());

-- Entries: only the grower of THAT reservation, always as themself.
create policy pgl_insert_entry on public.plot_grow_logs
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      (kind = 'entry' and exists (
        select 1 from public.claims c
        where c.id = claim_id and c.claimer_id = auth.uid()
          and c.claim_type = 'plot_reservation'))
      or
      (kind = 'owner_note' and exists (
        select 1 from public.claims c
        join public.listings l on l.id = c.listing_id
        where c.id = claim_id and l.owner_id = auth.uid()
          and c.claim_type = 'plot_reservation'))
    )
  );

-- Edit/delete: the author only. The plot owner can NEVER rewrite the grower's
-- history (and vice versa). Authorship and timestamps are immutable.
create policy pgl_update_own on public.plot_grow_logs
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());
create policy pgl_delete_own on public.plot_grow_logs
  for delete to authenticated
  using (author_id = auth.uid());

create or replace function public.plot_grow_logs_guard()
returns trigger language plpgsql as $$
begin
  -- Append-oriented journal: edits may change content, never provenance.
  new.author_id := old.author_id;
  new.claim_id := old.claim_id;
  new.kind := old.kind;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists plot_grow_logs_guard_trg on public.plot_grow_logs;
create trigger plot_grow_logs_guard_trg
  before update on public.plot_grow_logs
  for each row execute function public.plot_grow_logs_guard();

grant select, insert, update, delete on public.plot_grow_logs to authenticated;

create policy pglp_select_parties on public.plot_grow_log_photos
  for select to authenticated
  using (exists (select 1 from public.plot_grow_logs g
                  where g.id = log_id
                    and (public.is_plot_party(g.claim_id) or public.is_admin())));
create policy pglp_insert_author on public.plot_grow_log_photos
  for insert to authenticated
  with check (exists (select 1 from public.plot_grow_logs g
                       where g.id = log_id and g.author_id = auth.uid()));
create policy pglp_delete_author on public.plot_grow_log_photos
  for delete to authenticated
  using (exists (select 1 from public.plot_grow_logs g
                  where g.id = log_id and g.author_id = auth.uid()));
grant select, insert, delete on public.plot_grow_log_photos to authenticated;

-- Crops: grower manages, owner views.
create policy pc_select_parties on public.plot_crops
  for select to authenticated
  using (public.is_plot_party(claim_id) or public.is_admin());
create policy pc_grower_write on public.plot_crops
  for all to authenticated
  using (exists (select 1 from public.claims c
                  where c.id = claim_id and c.claimer_id = auth.uid()))
  with check (exists (select 1 from public.claims c
                       where c.id = claim_id and c.claimer_id = auth.uid()
                         and c.claim_type = 'plot_reservation'));
grant select, insert, update, delete on public.plot_crops to authenticated;

-- Private photo bucket. Path convention: <claim_id>/<file>. Only the two plot
-- parties can touch a folder, and only via signed URLs in the app.
insert into storage.buckets (id, name, public)
values ('grow-log', 'grow-log', false)
on conflict (id) do update set public = false;

create policy grow_log_select_parties on storage.objects
  for select to authenticated
  using (bucket_id = 'grow-log'
         and public.is_plot_party(((storage.foldername(name))[1])::uuid));
create policy grow_log_insert_parties on storage.objects
  for insert to authenticated
  with check (bucket_id = 'grow-log'
              and public.is_plot_party(((storage.foldername(name))[1])::uuid));
create policy grow_log_delete_parties on storage.objects
  for delete to authenticated
  using (bucket_id = 'grow-log'
         and public.is_plot_party(((storage.foldername(name))[1])::uuid));

-- Read-only structured context for Ask Gnome ("how is my plot doing?").
-- The AI can read this; nothing lets it write the journal.
create or replace function public.grow_log_context(p_claim uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  if not public.is_plot_party(p_claim) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
    'crops', coalesce((select jsonb_agg(jsonb_build_object(
                'name', c.name, 'variety', c.variety, 'planted_at', c.planted_at,
                'status', c.status,
                'taxonomy_path', (select n.path from public.marketplace_taxonomy_nodes n
                                   where n.id = c.taxonomy_node_id)))
              from public.plot_crops c where c.claim_id = p_claim), '[]'::jsonb),
    'current_stage', (select g.stage from public.plot_grow_logs g
                       where g.claim_id = p_claim and g.stage is not null
                       order by g.created_at desc limit 1),
    'days_since_planted', (select (current_date - min(c.planted_at))
                            from public.plot_crops c
                            where c.claim_id = p_claim and c.planted_at is not null),
    'last_update', (select max(g.created_at) from public.plot_grow_logs g
                     where g.claim_id = p_claim),
    'photo_count', (select count(*) from public.plot_grow_log_photos ph
                     join public.plot_grow_logs g on g.id = ph.log_id
                     where g.claim_id = p_claim),
    'recent_entries', coalesce((select jsonb_agg(e) from (
        select jsonb_build_object('date', g.created_at::date, 'stage', g.stage,
                                  'kind', g.kind, 'title', g.title, 'notes', g.notes) e
          from public.plot_grow_logs g
         where g.claim_id = p_claim
         order by g.created_at desc limit 5) sub), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke all on function public.grow_log_context(uuid) from public, anon;
grant execute on function public.grow_log_context(uuid) to authenticated;
