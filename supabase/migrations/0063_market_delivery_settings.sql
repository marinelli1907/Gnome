-- Gnome — per-Market delivery settings (2026-08-10).
--
-- Every Market can now say whether it delivers, how far, and what it costs.
-- Timing models a Market can offer (any combination):
--   · same-day  — order by a cutoff time, delivered that day
--   · next-day  — order by a cutoff time, delivered the next day
--   · scheduled — order by a given weekday, seller delivers on chosen weekdays
--
-- Plan tiering (enforced by trigger, not UI):
--   Free (Neighbor): deliver on/off · radius up to 15 mi · one flat fee.
--   Paid (Grower/Farm/Sponsor): any radius up to 100 mi, distance surcharge
--     ("over N miles costs extra"), and all timing models above.
--
-- Privacy: nothing here is address data — radius + fees + cutoffs only.
-- The table is world-readable (buyers need it to decide), owner-writable.

create table if not exists public.market_delivery_settings (
  market_id uuid primary key references public.markets(id) on delete cascade,
  enabled boolean not null default false,

  -- Coverage + cost (free tier: radius ≤ 15, flat fee only)
  radius_miles numeric(5,1) check (radius_miles > 0 and radius_miles <= 100),
  flat_fee_cents integer not null default 0 check (flat_fee_cents >= 0),
  -- Paid: beyond this many miles the surcharge applies on top of the flat fee.
  surcharge_after_miles numeric(5,1) check (surcharge_after_miles > 0),
  surcharge_fee_cents integer check (surcharge_fee_cents >= 0),

  -- Timing (paid only; any combination)
  same_day boolean not null default false,
  same_day_cutoff time,
  next_day boolean not null default false,
  next_day_cutoff time,
  scheduled boolean not null default false,
  order_by_dow smallint check (order_by_dow between 0 and 6),   -- 0 = Sunday
  delivery_dows smallint[] not null default '{}',

  tz text not null default 'America/New_York',
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A surcharge needs both halves; scheduled needs the order-by day.
  constraint delivery_surcharge_pair check (
    (surcharge_after_miles is null) = (surcharge_fee_cents is null)
  ),
  constraint delivery_scheduled_shape check (
    not scheduled or (order_by_dow is not null and cardinality(delivery_dows) > 0)
  ),
  constraint delivery_dows_valid check (
    delivery_dows <@ array[0,1,2,3,4,5,6]::smallint[]
  )
);

alter table public.market_delivery_settings enable row level security;

-- Buyers read everyone's; owners write their own.
drop policy if exists delivery_settings_read on public.market_delivery_settings;
create policy delivery_settings_read on public.market_delivery_settings
  for select using (true);

drop policy if exists delivery_settings_write on public.market_delivery_settings;
create policy delivery_settings_write on public.market_delivery_settings
  for all using (
    exists (select 1 from public.markets m
             where m.id = market_id and m.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.markets m
             where m.id = market_id and m.owner_id = auth.uid())
  );

grant select on public.market_delivery_settings to anon, authenticated;
grant insert, update, delete on public.market_delivery_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Plan gate: free tier keeps on/off + radius (≤15) + flat fee; everything
-- else needs a paid plan. BEFORE trigger so the UI can't out-run the backend.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_delivery_plan()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  pl market_plan;
begin
  select m.plan into pl from public.markets m where m.id = new.market_id;

  if pl is null or pl = 'free' then
    if new.radius_miles is not null and new.radius_miles > 15 then
      raise exception 'DELIVERY_PLAN_LIMIT:radius:Free Markets deliver up to 15 miles. Upgrade to go farther.'
        using errcode = 'P0001';
    end if;
    if new.surcharge_after_miles is not null
       or new.same_day or new.next_day or new.scheduled then
      raise exception 'DELIVERY_PLAN_LIMIT:features:Distance surcharges and delivery scheduling are Grower & Farm features.'
        using errcode = 'P0001';
    end if;
  end if;

  -- Cutoffs only mean something with their mode on; keep rows self-consistent.
  if not new.same_day then new.same_day_cutoff := null; end if;
  if not new.next_day then new.next_day_cutoff := null; end if;
  if not new.scheduled then new.order_by_dow := null; new.delivery_dows := '{}'; end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists delivery_settings_plan_gate on public.market_delivery_settings;
create trigger delivery_settings_plan_gate
  before insert or update on public.market_delivery_settings
  for each row execute function public.enforce_delivery_plan();

notify pgrst, 'reload schema';
