# Supabase setup

## Apply the schema

Run [`migrations/0001_init.sql`](./migrations/0001_init.sql) once against a fresh
project, either via the dashboard **SQL Editor**, or with the Supabase CLI:

```bash
supabase link --project-ref <ref>
supabase db push
```

It creates:

- **Tables:** `profiles` (1:1 with `auth.users`), `listings`, `claims`, `events`.
- **Enums:** `listing_status` (active, claimed, completed, expired, removed),
  `claim_status` (pending, approved, declined, cancelled),
  `user_type` (neighbor, grower, farm, business, market, municipality).
- **Storage bucket:** `listing-images` (public read; authenticated write;
  owner-scoped update/delete).
- **Triggers:**
  - `on_auth_user_created` → auto-creates a `profiles` row on sign-up.
  - `on_claim_status_change` → when a claim is approved, marks the listing
    `claimed` and auto-declines the other pending claims; reopens the listing if
    an approved claim is later cancelled/declined.
- **RLS** (enabled on every table):
  - Anyone can read **active** listings; owners can read their own in any state.
  - Only the owner can edit/delete a listing.
  - Only the listing owner can approve/decline a claim.
  - Only the claimant can cancel their own claim.
  - Profiles are world-readable; you can only write your own.

## Auth

Enable **Email** and **Google** providers (Apple later). For local testing,
disable email confirmation under **Auth → Settings**.

## Auto-expiration

Listings carry `expires_at` (default `now() + 7 days`). The app already filters
to `status = 'active' AND expires_at > now()`, so expired listings disappear
from Browse automatically. To also flip their `status` to `expired` for
reporting, schedule the sweep with pg_cron:

```sql
create extension if not exists pg_cron;
select cron.schedule(
  'expire-listings', '*/15 * * * *',
  $$update public.listings set status = 'expired'
      where status = 'active' and expires_at <= now()$$
);
```

## Push notifications (P1)

Device tokens are stored in `device_tokens` (created by
[`migrations/0002_push.sql`](./migrations/0002_push.sql)). Delivery is handled by
the `notify` Edge Function in [`functions/notify`](./functions/notify), which the
app invokes after a claim or an approval. Deploy it with:

```bash
supabase functions deploy notify
```

It uses the service-role key (auto-injected as `SUPABASE_SERVICE_ROLE_KEY`) so
push tokens are never exposed to clients.
