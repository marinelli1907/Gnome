-- Gnome — DB-enforced 7-day auto-expire. Run after 0017.
-- Until now expiry was filter-only (app + public views hide rows past
-- expires_at); this sweep makes listing status converge to 'expired' in the DB
-- so counts, dashboards, and any consumer that forgets the filter stay honest.
-- The sweep is idempotent and cheap (partial match on status='active').
--
-- pg_cron: available on hosted Supabase. If `create extension` is refused in
-- your environment, enable it once via Dashboard → Database → Extensions and
-- re-run this migration.

create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'gnome-expire-listings') then
    perform cron.schedule(
      'gnome-expire-listings',
      '*/15 * * * *',
      $sweep$
        update public.listings
           set status = 'expired'
         where status = 'active' and expires_at <= now()
      $sweep$
    );
  end if;
end
$$;
