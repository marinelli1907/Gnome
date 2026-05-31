-- Gnome — V1.2 Claim-Scoped Pickup Chat. Run after 0001–0003 on the live project.
-- NOT global DMs: a thread exists ONLY between the listing owner and the
-- approved claimant of a single claim. claim_id IS the thread (no threads table).
--
-- Lifecycle:
--   claim pending/declined  -> no chat (no read, no write)
--   claim approved          -> read + write
--   claim completed         -> read-only history
--   claim expired/cancelled/declined -> writes blocked (rows preserved)

-- ---------------------------------------------------------------------------
-- Claim status gains 'completed' (pickup done -> chat read-only) and 'expired'.
-- (0001 created claim_status as pending/approved/declined/cancelled.) Policies
-- below compare status::text so the newly-added value is never referenced as an
-- enum literal in the same transaction it's added (avoids Postgres's
-- "unsafe use of new value of enum type" restriction).
-- ---------------------------------------------------------------------------
alter type claim_status add value if not exists 'completed';
alter type claim_status add value if not exists 'expired';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.claim_messages (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references public.claims (id) on delete cascade,
  sender_id   uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now(),
  reported_at timestamptz
);

create index if not exists claim_messages_thread_idx on public.claim_messages (claim_id, created_at);
create index if not exists claim_messages_sender_idx on public.claim_messages (sender_id);

create table if not exists public.claim_reports (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references public.claims (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists claim_reports_claim_idx on public.claim_reports (claim_id);

-- ---------------------------------------------------------------------------
-- Helper: is auth.uid() a party (owner or claimant) to this claim, and what is
-- the claim's status? SECURITY DEFINER so RLS policies can consult claims and
-- listings regardless of the caller's own row visibility.
-- ---------------------------------------------------------------------------
create or replace function public.is_claim_party(cid uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1
    from public.claims c
    join public.listings l on l.id = c.listing_id
    where c.id = cid
      and (auth.uid() = c.claimer_id or auth.uid() = l.owner_id)
  );
$$;

create or replace function public.claim_status_of(cid uuid)
returns claim_status
language sql
security definer set search_path = public
stable
as $$
  select status from public.claims where id = cid;
$$;

-- ---------------------------------------------------------------------------
-- Rate limit: max 30 messages per claim per sender per rolling hour.
-- ---------------------------------------------------------------------------
create or replace function public.claim_messages_rate_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  cnt integer;
begin
  select count(*) into cnt
    from public.claim_messages
    where claim_id = new.claim_id
      and sender_id = new.sender_id
      and created_at > now() - interval '1 hour';
  if cnt >= 30 then
    raise exception 'rate limit exceeded: max 30 messages per claim per hour';
  end if;
  return new;
end;
$$;

drop trigger if exists claim_messages_rate_limit on public.claim_messages;
create trigger claim_messages_rate_limit
  before insert on public.claim_messages
  for each row execute function public.claim_messages_rate_limit();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.claim_messages enable row level security;
alter table public.claim_reports  enable row level security;

-- Read: a party can read once the claim is approved or completed.
drop policy if exists "claim_messages_select_party" on public.claim_messages;
create policy "claim_messages_select_party" on public.claim_messages
  for select using (
    public.is_claim_party(claim_id)
    and public.claim_status_of(claim_id)::text in ('approved', 'completed')
  );

-- Write: only a party, only as themselves, and only while the claim is approved.
drop policy if exists "claim_messages_insert_party" on public.claim_messages;
create policy "claim_messages_insert_party" on public.claim_messages
  for insert with check (
    sender_id = auth.uid()
    and public.is_claim_party(claim_id)
    and public.claim_status_of(claim_id) = 'approved'
  );

-- Reports: either party may file; reporter must be themselves. No read policy
-- (RLS on + no SELECT policy = nobody reads via the API; reviewed server-side).
drop policy if exists "claim_reports_insert_party" on public.claim_reports;
create policy "claim_reports_insert_party" on public.claim_reports
  for insert with check (
    reporter_id = auth.uid()
    and public.is_claim_party(claim_id)
  );
