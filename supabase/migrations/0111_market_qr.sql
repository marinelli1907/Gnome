-- Gnome — durable Market QR identity and premium QR toolkit entitlement.
--
-- THE RULE THAT SHAPES EVERYTHING HERE
-- A printed QR must never stop working. Farm-stand signs, egg cartons, and one day a small gnome
-- holding the seller's code — none of those can be re-printed because a seller renamed their
-- Market or let a subscription lapse. So the SUBSCRIPTION gates the premium TOOLKIT (issuing the
-- identity, exporting branded assets), and it never gates RESOLUTION. resolve_market_qr() answers
-- for any market the public is allowed to see, forever.
--
-- IDENTITY
-- One durable opaque code per market — /q/<code> — resolving at scan time to the market's CURRENT
-- public slug. The code is 16 hex chars from gen_random_bytes: non-sequential, and encodes
-- nothing (no email, no ids, no tokens — a scanner learns only what the public market page shows).
-- markets.slug is client-immutable already (write-revoked since 0087-era hardening), so readable
-- links survive rename today; the redirect layer adds opacity, scan analytics, and freedom to
-- evolve the /market route without re-printing anything.
--
-- WHY A TABLE AND NOT A COLUMN ON markets
-- markets carries privileged column-level grants, and this repo has shipped three outages from
-- columns added to column-granted tables. A separate table sidesteps the trap entirely and gives
-- the scan ledger a natural home.
--
-- Run after 0110. Idempotent.

create table if not exists public.market_qr (
  -- 16 hex chars carved from a v4 UUID: non-sequential, meaningless, and extension-free —
  -- gen_random_bytes would drag in pgcrypto, which a fresh local build does not have.
  code       text primary key default left(replace(gen_random_uuid()::text, '-', ''), 16)
               check (code ~ '^[0-9a-f]{16}$'),
  market_id  uuid not null unique references public.markets (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

comment on table public.market_qr is
  'One durable QR identity per market. Never rotated by rename, plan change or regeneration of the printable asset — changing a code is a deliberate exceptional operation with no casual path.';

-- Scan ledger: deliberately nothing but what, which market, and when. No IP, no user agent, no
-- location, no scanner identity — future analytics get counts and timing, not people.
create table if not exists public.market_qr_scans (
  id          bigint generated always as identity primary key,
  code        text not null references public.market_qr (code) on delete cascade,
  market_id   uuid not null,
  occurred_at timestamptz not null default now()
);
create index if not exists market_qr_scans_code_idx on public.market_qr_scans (code, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Public resolution — intentionally anon-callable
-- ---------------------------------------------------------------------------
-- Respects the same visibility rule as the public market pages: only status='active' markets
-- resolve. A suspended or removed market's QR answers nothing — durable identity is not immunity
-- from moderation. A successful resolution logs one scan row.
create or replace function public.resolve_market_qr(p_code text)
returns table (slug text, name text)
language plpgsql volatile security definer set search_path = public
as $$
declare q record;
begin
  select mq.code, mq.market_id, m.slug, m.name, m.status
    into q
    from public.market_qr mq
    join public.markets m on m.id = mq.market_id
   where mq.code = lower(btrim(p_code));
  if q.code is null or q.status <> 'active' then return; end if;

  insert into public.market_qr_scans (code, market_id) values (q.code, q.market_id);

  slug := q.slug; name := q.name;
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- The seller's own QR
-- ---------------------------------------------------------------------------
-- Issuance is the enforcement point: the durable identity is CREATED only for a seller whose
-- effective plan carries qr_tools. Once it exists it is returned regardless of plan — a
-- downgraded seller keeps seeing the code their printed signs carry, with entitled=false telling
-- the client to lock the premium export tools around it. (A QR of a public URL can always be
-- drawn by anyone; what the subscription actually sells is the issued identity, the branded
-- asset toolkit, and the analytics that hang off the durable code.)
create or replace function public.my_market_qr()
returns table (
  code      text,       -- null when none exists and the plan cannot issue one
  entitled  boolean,    -- qr_tools on the seller's effective plan, resolved server-side
  slug      text,
  market_name text
)
language plpgsql volatile security definer set search_path = public
as $$
declare m record; eff record; tools boolean;
begin
  if auth.uid() is null then return; end if;
  select mk.id, mk.slug, mk.name into m from public.markets mk where mk.owner_id = auth.uid() limit 1;
  if m.id is null then return; end if;

  select ep.plan into eff from public.market_effective_plan(m.id) ep;
  select coalesce(pl.qr_tools, false) into tools
    from public.plan_limits pl where pl.plan = coalesce(eff.plan, 'free');

  select mq.code into code from public.market_qr mq where mq.market_id = m.id;
  if code is null and tools then
    insert into public.market_qr (market_id) values (m.id) returning market_qr.code into code;
  end if;

  entitled := tools;
  slug := m.slug;
  market_name := m.name;
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- Admin visibility and recovery
-- ---------------------------------------------------------------------------
-- Reports the identity and scan counts. Recovery of the printable ASSET is client-side
-- regeneration from this same durable code — deliberately, there is no "rotate code" here at all,
-- so recreating an image can never silently mean changing the destination printed on someone's
-- packaging.
create or replace function public.admin_market_qr(p_market uuid)
returns table (
  code text, created_at timestamptz, entitled boolean,
  market_slug text, scans_total int, scans_30d int
)
language plpgsql stable security definer set search_path = public
as $$
declare eff record;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = 'P0001'; end if;

  select mq.code, mq.created_at into code, created_at
    from public.market_qr mq where mq.market_id = p_market;
  select m.slug into market_slug from public.markets m where m.id = p_market;

  select ep.plan into eff from public.market_effective_plan(p_market) ep;
  select coalesce(pl.qr_tools, false) into entitled
    from public.plan_limits pl where pl.plan = coalesce(eff.plan, 'free');

  select count(*)::int,
         count(*) filter (where s.occurred_at > now() - interval '30 days')::int
    into scans_total, scans_30d
    from public.market_qr_scans s where s.market_id = p_market;

  return next;
end $$;

-- ---------------------------------------------------------------------------
-- Grants — RPCs only, tables closed, asserted both directions
-- ---------------------------------------------------------------------------
alter table public.market_qr       enable row level security;
alter table public.market_qr_scans enable row level security;
revoke all on public.market_qr       from anon, authenticated;
revoke all on public.market_qr_scans from anon, authenticated;

revoke execute on function public.resolve_market_qr(text) from public;
revoke execute on function public.my_market_qr()          from public, anon;
revoke execute on function public.admin_market_qr(uuid)   from public, anon;

grant execute on function public.resolve_market_qr(text) to anon, authenticated;  -- public on purpose
grant execute on function public.my_market_qr()           to authenticated;
grant execute on function public.admin_market_qr(uuid)    to authenticated;        -- is_admin() inside

do $$
begin
  if not has_function_privilege('anon', 'public.resolve_market_qr(text)', 'execute') then
    raise exception '0111: the public QR resolver is not publicly callable — every printed QR would 404.';
  end if;
  if has_function_privilege('anon', 'public.my_market_qr()', 'execute')
     or has_function_privilege('anon', 'public.admin_market_qr(uuid)', 'execute') then
    raise exception '0111: anon can reach a seller or admin QR RPC.';
  end if;
  if not has_function_privilege('authenticated', 'public.my_market_qr()', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_market_qr(uuid)', 'execute') then
    raise exception '0111: the 0106 grant trap again — an RPC this feature depends on is unreachable.';
  end if;
  if has_table_privilege('authenticated', 'public.market_qr', 'select')
     or has_table_privilege('authenticated', 'public.market_qr_scans', 'select') then
    raise exception '0111: QR tables are directly readable by clients; access is RPC-only by design.';
  end if;
end $$;

notify pgrst, 'reload schema';
