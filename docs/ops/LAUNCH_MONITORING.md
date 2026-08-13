# Gnome Launch Monitoring

What can actually be watched at launch, with the exact query or screen for each
signal — and an honest list of what cannot be watched at all. Everything below
was checked against the live project `fgybyghwcjlstqxkclch` on 2026-08-13; no
metric is listed as observable because the code "looks like" it logs something.

Rule for this document: if a number is not in a table or a log stream today, it
is marked **NOT OBSERVABLE** and the gap is written down. Do not invent a query
against a column that does not exist.

---

## 1. Where the signal actually lives

Five surfaces, each with a different reach and a different retention.

### 1.1 `public.events` — product analytics
`id, user_id, event_type, listing_id, metadata jsonb, created_at`. Durable, no
retention limit. Three constraints matter more than the schema:

- **No admin read path.** The only SELECT policy is `events_select_self`
  (`auth.uid() = user_id`). There is no `is_admin()` policy and no admin RPC
  that aggregates events. **Every events query in this document must be run in
  the Supabase SQL editor** (Dashboard → SQL Editor, which runs as `postgres`
  and bypasses RLS). The Gnome Admin app cannot show event counts, and adding a
  chart to it would require a new SECURITY DEFINER RPC first.
- **`events_guard` clamps anonymous writes.** For callers whose JWT role is
  `anon`, the trigger (a) rejects any `event_type` outside a 15-name allowlist,
  (b) rejects metadata over 512 bytes, (c) **force-nulls `user_id` and
  `listing_id`**, and (d) raises `EVENT_RATE_LIMITED` past 300 anonymous rows
  per minute.
- **Every web event is anonymous.** `web/lib/analytics.ts` posts to the REST
  endpoint with the anon key in both `apikey` and `Authorization`, even for a
  signed-in visitor. So the JWT role is always `anon`, and **no `web_*` event
  can ever be attributed to a user**. Confirmed in the data: all 46 `web_*`
  rows have `user_id IS NULL`.

The allowlisted web events (from `events_guard`) are exactly:
`web_zip_search`, `web_browse_location_set`, `web_reserve_started`,
`web_reserve_submitted`, `web_listing_published`, `web_gnome_opened`,
`web_gnome_quick_action`, `web_gnome_message`, `web_seed_profile_started`,
`web_seed_profile_completed`, `web_seed_checkout_started`, `web_sale_recorded`,
`web_expense_recorded`, `web_market_customized`, `web_market_reordered`.
**A new `logWeb()` call with a name not on that list is silently dropped** —
the insert 500s and `logWeb` swallows it. Adding web instrumentation means
editing `events_guard` too.

Mobile (`expo/lib/db.ts` → `logEvent`) writes under the user's own session, so
`user_id` is populated wherever the call site passes it. Some do not
(`seed_drop_tapped` passes `{}`), so `count(user_id)` and `count(*)` differ per
event type by design.

`market_created` is written by a database trigger (`handle_new_profile`), not
by a client, so it is complete and always carries `user_id`.

### 1.2 Supabase logs — `query_logs` / Dashboard → Logs
Sources present on this project: `edge_logs` (API gateway), `postgres_logs`,
`postgrest_logs`, `function_logs` (console output from edge functions),
`function_edge_logs` (per-invocation status codes), `auth_logs`,
`auth_audit_logs`, `storage_logs`, `pgbouncer_logs`.

**Hard limit: the `query_logs` API caps any window at 24 hours**, and Supabase
log retention itself is a rolling buffer that depends on the project plan
(1 day on Free). Treat every log-based metric as *only* answering "is it broken
right now" — never "what happened on launch day". Anything needed beyond the
window must be copied into a durable table or a spreadsheet the same day.
This is the single biggest observability gap in the stack.

### 1.3 Operational tables — durable, queryable, admin-visible
`admin_audit_log` (45 rows; every admin RPC writes here via `admin_audit()`),
`compliance_audit_log`, `market_order_events`, `seed_inventory_log`,
`ai_usage_log`, `billing_events`, `stripe_events`, `admin_actions` (legacy,
superseded by `admin_audit_log`).

### 1.4 The Gnome Admin app (`admin/App.tsx`)
Four tabs: **Home / Fulfill / AI HQ / More**.

| Screen | RPC | Shows |
| --- | --- | --- |
| Home | `admin_daily_brief()` | users, active markets, live listings, orders/pickups/deliveries today, pending credentials, expiring credentials 30d, low seed lots, seed orders needing review + to pack, open reports, plan mix, MRR, comp grants, AI pending approvals, AI spend today, AI writes-paused flag |
| AI HQ | `admin_ai_provider_stats()`, `ai_usage_log`, `ai_settings`, `ai_action_requests` | per-provider calls/fails/cost today, last success + last failure, pending AI approvals, pause switches |
| More → Support | `reports` where `resolved_at is null` | open user reports, resolve button |
| More → Billing Health | `admin_billing_health()` | payments_live flag, stripe mode, per-product test/live price readiness, last event, last test + live payment, 30d event counts |
| More → Commercial | `admin_commercial_overview()` | plan mix, source mix, live MRR, seed subscribers, promotions, growers near cap, and a separate `test` block |
| More → Audit | `admin_audit_log` (last 50) | admin/AI/system actions |
| More → Listings / Markets / Users | `admin_listings_search`, `admin_markets_overview`, profile search | moderation |

The Admin app is the right tool for *state* (queues, counts, health). It is
**not** an analytics tool: it cannot read `events`, and it has no time series.

### 1.5 Off-Supabase surfaces
- **The website is not on Supabase.** `web/` is a standalone Next.js build on
  the Hostinger VPS `147.79.75.242`, run by PM2 as app `gnome-web` on
  `127.0.0.1:3007` behind nginx for `gnomefarmersmarket.com`. Page views, route
  hits, and 4xx/5xx from the site live in nginx access/error logs on that box
  and in `pm2 logs gnome-web` — **not** in any Supabase log stream.
- **Stripe Dashboard** is the durable record for payments and webhook
  deliveries; Supabase function logs for `stripe-webhook` roll off in 24h.
- **App Store Connect / Google Play Console** are the only crash surfaces.

---

## 2. Metric by metric

Each entry: **(a)** observable today, **(b)** exactly how, **(c)** what is
missing. Unless stated otherwise, SQL runs in the **Supabase SQL editor**.

### 2.1 Signups — OBSERVABLE
Both `auth.users` and `public.profiles` (a trigger creates the profile), so
either works; `auth.users` also carries confirmation and sign-in state.

```sql
select date_trunc('hour', created_at) as hour,
       count(*)                                          as signups,
       count(*) filter (where email_confirmed_at is not null) as confirmed,
       count(*) filter (where last_sign_in_at is not null)     as signed_in
from auth.users
where created_at > now() - interval '72 hours'
group by 1 order by 1 desc;
```

Admin app Home shows the lifetime `users` count only. `auth_logs` additionally
shows `/signup` and `/token` outcomes but only for 24h.

### 2.2 Onboarding completion — OBSERVABLE, with a caveat that changes the number
`profiles.onboarding_completed_at` is set by **both** the conversational finish
and `skip_onboarding()`. Counting non-null timestamps therefore counts skips as
completions. The honest split uses `user_private_contact`, which only the real
flow fills:

```sql
select
  count(*)                                                          as users,
  count(*) filter (where p.onboarding_completed_at is not null)     as reached_end,
  count(*) filter (where p.onboarding_completed_at is not null
                     and c.first_name is not null
                     and c.contact_email is not null)               as completed_with_contact,
  count(*) filter (where p.onboarding_completed_at is not null
                     and (c.first_name is null or c.contact_email is null)) as skipped_or_partial,
  count(*) filter (where p.onboarding_completed_at is null)         as never_started_or_dropped
from public.profiles p
left join public.user_private_contact c on c.user_id = p.id;
```

The AI side of onboarding is separately visible as
`ai_usage_log where feature = 'onboarding'`. **Gap:** there is no per-step
funnel — a user who abandons mid-conversation is indistinguishable from one who
never opened it.

### 2.3 Market creation — OBSERVABLE
Every profile gets a market from `handle_new_profile`, which also writes a
`market_created` event, so the two agree.

```sql
select date_trunc('day', created_at) as day, count(*) as markets
from public.markets
where created_at > now() - interval '30 days'
group by 1 order by 1 desc;
```

Admin app Home shows `active_markets`.

### 2.4 Listing creation — OBSERVABLE
Ground truth is the table; the events give the surface it came from.

```sql
select date_trunc('day', created_at) as day,
       listing_type, count(*) as n
from public.listings
where created_at > now() - interval '7 days' and coalesce(is_demo, false) = false
group by 1, 2 order by 1 desc, 3 desc;

-- which client
select event_type, count(*) from public.events
where event_type like 'listing_created%' or event_type = 'web_listing_published'
group by 1 order by 2 desc;
```

### 2.5 Listing failures — PARTIALLY OBSERVABLE (24h only, and web logs nothing)
Server-side rejections raise named exceptions that land in `postgres_logs`:
`PLAN_LIMIT_REACHED` (`enforce_plan_limit`), `PLOTS_REQUIRE_PLAN`
(`enforce_plot_plan`), `COMPLIANCE_BLOCKED:<reason>`
(`listings_enforce_compliance`), plus draft errors `NOT_YOUR_DRAFT` /
`DRAFT_NOT_PENDING`. All confirmed present in the live log.

```sql
-- query_logs, window <= 24h
select event_message, count(*) as n, max(timestamp) as last_seen
from logs
where source = 'postgres_logs'
  and log_attributes['parsed.sql_state_code'] = 'P0001'
group by 1 order by n desc;
```

Durable partial: mobile writes a `plan_limit_hit` event.

```sql
select date_trunc('day', created_at) as day, count(*)
from public.events where event_type = 'plan_limit_hit'
group by 1 order by 1 desc;
```

**Gaps.** `web/app/sell/SellClient.tsx` calls `logWeb('listing_published')`
only on success — a failed web post produces no event at all, only a
`postgres_logs` line that expires in 24h. Client-side validation failures
(before the insert) are invisible everywhere. Photo-upload failures to Storage
are invisible unless they reach `storage_logs`.

### 2.6 Claims — OBSERVABLE

```sql
select status, count(*) as n,
       count(*) filter (where created_at > now() - interval '24 hours') as last_24h
from public.claims group by 1 order by 2 desc;
```

`claims.status` enum: `pending, approved, declined, cancelled, completed,
expired`. Events `listing_claim_started` / `listing_claim_approved` /
`claim_declined` mirror the mobile path.

### 2.7 Messages — OBSERVABLE

```sql
select date_trunc('day', created_at) as day,
       count(*) as messages,
       count(distinct claim_id) as threads,
       count(distinct sender_id) as senders
from public.claim_messages
where created_at > now() - interval '7 days'
group by 1 order by 1 desc;
```

`claim_messages.reported_at` flags a reported message. `claim_messages_rate_limit`
raises on flooding; that rejection is only in `postgres_logs` (24h).

### 2.8 Completed exchanges — OBSERVABLE
Three separate notions of "completed" — report them separately, never summed.

```sql
select
  (select count(*) from public.claims        where status = 'completed')  as claims_completed,
  (select count(*) from public.market_orders where status = 'COMPLETED')  as orders_completed,
  (select count(*) from public.seller_transactions)                        as sales_recorded;
```

`market_order_events` gives the full status trail per order (old → new status,
actor, reason) and is the place to look when an order stalls.

### 2.9 Paid subscription attempts — PARTIALLY OBSERVABLE (24h only)
There is **no attempts table**. The only record of "someone pressed buy" is the
edge-function invocation.

```sql
-- query_logs, window <= 24h
select log_attributes['response.status_code'] as status, count(*) as n, max(timestamp) as last_seen
from logs
where source = 'function_edge_logs'
  and log_attributes['request.pathname'] = '/functions/v1/billing-checkout'
group by 1 order by n desc;
```

**Gap:** an abandoned Stripe Checkout leaves nothing durable in Gnome. Stripe
Dashboard → Payments → *incomplete* sessions is the only lasting record, and it
is external.

### 2.10 Paid subscription success / failure — OBSERVABLE (durable)

```sql
select livemode, type, count(*) as n, sum(amount_cents) as cents, max(created_at) as last
from public.billing_events
group by 1, 2 order by 1 desc, 3 desc;

select id, type, livemode, received_at from public.stripe_events
order by received_at desc limit 20;

select plan, kind, status, stripe_livemode, count(*)
from public.market_subscriptions group by 1,2,3,4;
```

Admin app → More → Billing Health renders `admin_billing_health()`, which is
the fastest read: `payments_live_enabled`, per-product `test_ready` /
`live_ready`, last event, last test payment, last live payment, 30d counts.

**State as of writing (verified):** `billing_config.payments_live_enabled =
false`; `stripe_events` holds 15 rows, **all `livemode = false`**;
`billing_events` holds 10 rows, all test. Any `livemode = true` row appearing
is the first real money and should be treated as an event, not a metric.

### 2.11 Founding Member count — **NOT OBSERVABLE TODAY** (schema exists, unapplied)
Nothing named "founding" exists in the **live** database. Verified against the
applied-migration list: the newest migration in production is
`profiles_public_projection` (0087). `supabase/migrations/0091_founding_members.sql`
is in the working tree but **not applied**, so `founding_members` and
`founding_program_config` do not exist and no query against them will run.

The only "founding" things live today are copy and free text: `"$12 founding
intro"` on `web/app/seeds/SeedProfileClient.tsx` (Seed Drop pricing copy), and
the grant reason `"Founding Grower"` typed by the Admin app's comp-grant
buttons. The nearest proxy — **not** a Founding Member count:

```sql
select count(*) as founding_grower_comps
from public.admin_plan_grants
where status = 'ACTIVE' and reason ilike '%founding%';
```

**Once 0091 is applied**, and only then, this becomes the metric — read
`founding_program_config` first, because the program ships with
`program_enabled = false` and a zero count is the *correct* reading while it is
off:

```sql
select program_enabled, founding_capacity, last_founding_number,
       greatest(founding_capacity - last_founding_number, 0) as remaining
from public.founding_program_config;

select status, count(*) as n, min(founding_number) as lowest, max(founding_number) as highest
from public.founding_members group by 1 order by 2 desc;
```

Award and lifecycle activity is durable in `admin_audit_log` — no extra
instrumentation needed:

```sql
select action, count(*) as n, max(created_at) as last
from public.admin_audit_log
where action like 'FOUNDING\_%'
group by 1 order by 2 desc;
```

Actions written by 0091: `FOUNDING_MEMBER_AWARDED`, `FOUNDING_PAYMENT_FAILED`,
`FOUNDING_PAYMENT_RECOVERED`, `FOUNDING_MEMBER_LAPSED`,
`FOUNDING_MEMBER_REVOKED`, `FOUNDING_SUBSCRIPTION_RELINKED`,
`FOUNDING_MARKET_ACTIVATED`, `FOUNDING_MEMBER_RENUMBERED`,
`FOUNDING_PROGRAM_UPDATED`.

### 2.12 Founding numbering errors — **NOT OBSERVABLE TODAY** (same reason)
No numbering exists in production, so no duplicate, gap, or over-cap can be
detected. Note that 0091 makes most of these errors *impossible* rather than
merely visible — `founding_number` carries a `unique` constraint and a
`check (between 1 and 500)`, `user_id` and both subscription ids are unique, and
the counter is a high-water mark advanced by a conditional UPDATE. That is the
right design; the monitoring below is a tripwire for the cases a constraint
cannot catch (a counter that drifts from the roster, or a hole left by a revoke).

**Once 0091 is applied:**

```sql
select
  (select count(*)                  from public.founding_members)                    as rows_total,
  (select count(distinct founding_number) from public.founding_members)              as distinct_numbers,
  (select max(founding_number)      from public.founding_members)                    as highest_awarded,
  (select last_founding_number      from public.founding_program_config)             as counter,
  (select founding_capacity         from public.founding_program_config)             as capacity;
```

Read it as: `rows_total = distinct_numbers` (else a duplicate slipped past the
unique index — impossible, investigate the database itself);
`highest_awarded <= counter` (the counter is a high-water mark, so it may lead
the roster after a revoke, but must never trail it); `counter <= capacity`.
`rows_total < counter` is expected after any revoke — numbers are never
recycled — so do **not** alert on a gap alone.

Rejections from the guard trigger (`FOUNDING_NUMBER_IMMUTABLE`,
`FOUNDING_QUALIFICATION_IMMUTABLE`) raise `P0001` and appear in `postgres_logs`
under the §2.5 query, for 24 hours only.

### 2.13 Gnome AI errors — OBSERVABLE (durable)
`ai_usage_log` is written by every AI edge function on both the success and the
failure path.

```sql
select feature, provider, model,
       count(*) as calls,
       count(*) filter (where not success) as fails,
       round(100.0 * count(*) filter (where not success) / count(*), 1) as fail_pct,
       round(avg(duration_ms)) as avg_ms,
       sum(estimated_cost_cents) as est_cents,
       max(created_at) as last_call
from public.ai_usage_log
where created_at > now() - interval '24 hours'
group by 1,2,3 order by fails desc, calls desc;
```

Feature → function map (from the function sources):
`assistant` = `ask-gnome` + `gnome-assistant` chat; `listing_assistant` =
`analyze-listing-photo` + `gnome-assistant` photo path; `draft` =
`draft-listing`; `planner` = `garden-planner`; `onboarding` =
`gnome-onboarding`; `boardroom` = `boardroom`; `health` = `ai-health`.

A failure row with `provider IS NULL` means the call died before a provider was
selected — that is the no-credentials / no-credits shape (5 such rows exist
from the pre-Gemini period). Admin app → AI HQ shows the same data live.

Console-level detail (stack traces, provider error text) is in `function_logs`
for 24h:

```sql
select log_attributes['level'] as lvl, substring(event_message, 1, 200) as msg, count(*) as n
from logs
where source = 'function_logs' and log_attributes['level'] in ('error','warning')
group by 1,2 order by n desc;
```

### 2.14 Photo-draft errors — OBSERVABLE, but two functions share one feature name
`analyze-listing-photo` and the photo branch of `gnome-assistant` both write
`feature = 'listing_assistant'`, so the feature alone cannot separate them.
Split by image count, and confirm against the per-function status codes.

```sql
select date_trunc('hour', created_at) as hour,
       count(*) as photo_calls,
       count(*) filter (where not success) as fails
from public.ai_usage_log
where feature = 'listing_assistant' and coalesce(images, 0) > 0
  and created_at > now() - interval '48 hours'
group by 1 order by 1 desc;
```

```sql
-- query_logs, 24h: which function, which status
select log_attributes['request.pathname'] as fn,
       log_attributes['response.status_code'] as status, count(*) as n
from logs
where source = 'function_edge_logs'
  and log_attributes['request.pathname'] in
      ('/functions/v1/analyze-listing-photo','/functions/v1/gnome-assistant','/functions/v1/draft-listing')
group by 1,2 order by n desc;
```

Drafts that were produced but never published are durable in `listing_drafts`
(`status`, `published_listing_id`) — a rising count of unpublished drafts is a
usability signal, not an error.

### 2.15 Password-reset errors — PARTIALLY OBSERVABLE (24h only, no durable record)
Nothing about auth mail is stored in `public`. The only surface is `auth_logs`.

```sql
-- query_logs, window <= 24h
select log_attributes['path'] as path,
       log_attributes['status'] as status,
       log_attributes['level'] as level,
       substring(event_message, 1, 200) as msg,
       count(*) as n
from logs
where source in ('auth_logs','auth_audit_logs')
  and (log_attributes['level'] = 'error' or log_attributes['status'] >= '400')
group by 1,2,3,4 order by n desc;
```

Recovery attempts should appear as `path = '/recover'` and `/verify` — that is
GoTrue's route naming, but **unverified here**: no password reset has ever been
exercised on this project, and the only paths present in the current window are
`/user`, `/signup`, `/token`, `/settings`. Run one real reset before launch so
the path is known rather than assumed. SMTP delivery failures surface as
`level = 'error'` on the same paths; the one auth error in the current window is
an unrelated `error finding user: Scan error on column "confirmation_token"`,
which is worth understanding before launch since it sits on the confirm path.
**Gaps:** (1) 24h
retention; (2) a mail that Outlook accepts and then spam-files is a *success*
here and a failure for the user — the only detection is the user telling you;
(3) `docs/LAUNCH.md` still lists custom SMTP and the magic-link `{{ .Token }}`
template as open dashboard items — confirm those before counting reset failures
as a code problem. Dashboard → Auth → Rate Limits is worth a look the same day,
since a hit limit looks identical to a broken mailer from the user's side.

### 2.16 Account-deletion errors — PARTIALLY OBSERVABLE (24h only)
`supabase/functions/delete-account/index.ts` returns 500 with a message on any
failure and writes nothing to a table. By design the function deletes the
profile, so a *successful* deletion also erases its own trace.

```sql
-- query_logs, window <= 24h
select log_attributes['response.status_code'] as status, count(*) as n, max(timestamp) as last_seen
from logs
where source = 'function_edge_logs'
  and log_attributes['request.pathname'] = '/functions/v1/delete-account'
group by 1 order by n desc;
```

Indirect durable check — deletion is meant to remove markets, credentials and
storage folders too, so orphans mean a partial failure:

```sql
select 'orphan markets' as kind, count(*) from public.markets m
  where not exists (select 1 from public.profiles p where p.id = m.owner_id)
union all
select 'orphan listings', count(*) from public.listings l
  where not exists (select 1 from public.profiles p where p.id = l.owner_id)
union all
select 'orphan credentials', count(*) from public.seller_credentials c
  where not exists (select 1 from public.profiles p where p.id = c.seller_id);
```

**What would be needed:** an `admin_audit_log` row (`ACCOUNT_DELETED`, actor
`SYSTEM`, resource = the user id) written by the function before it deletes.
That would survive the deletion and cost one insert.

### 2.17 Reports — OBSERVABLE (durable)

```sql
select target_type, coalesce(status, 'open') as status, count(*) as n,
       min(created_at) as oldest_open
from public.reports
where resolved_at is null
group by 1,2 order by 3 desc;

select count(*) as reported_messages from public.claim_messages where reported_at is not null;
select count(*) as claim_reports from public.claim_reports;
```

Admin app → More → Support lists open reports and resolves them
(`admin_resolve_report` sets `resolved_at`, `status='resolved'`, and writes
`REPORT_RESOLVED` to `admin_audit_log`). `admin_daily_brief().open_reports`
counts `resolved_at is null`. **Note:** `claim_reports` has no admin screen —
it must be checked with SQL.

### 2.18 Compliance queue — OBSERVABLE (durable)

```sql
select status, count(*) as n, min(submitted_at) as oldest
from public.seller_credentials group by 1 order by 2 desc;

select count(*) as expiring_30d
from public.seller_credentials
where status = 'APPROVED' and expiration_date is not null
  and expiration_date < current_date + 30;

select action, actor_role, count(*), max(created_at)
from public.compliance_audit_log
where created_at > now() - interval '7 days'
group by 1,2 order by 3 desc;
```

`credential_status` enum: `NOT_SUBMITTED, PENDING, APPROVED, DENIED, EXPIRED,
RENEWAL_REQUIRED, REVOKED`. Admin app Home surfaces `pending_compliance` and
`expiring_credentials_30d` under "Needs your attention".

### 2.19 Webhook failures — OBSERVABLE (mixed durability)
Durable: a delivered, signature-valid event always inserts into
`stripe_events`. Absence of an expected row *is* the failure signal.

```sql
select id, type, livemode, received_at from public.stripe_events
order by received_at desc limit 20;

-- a paid checkout that produced no downstream effect
select se.id, se.type, se.received_at
from public.stripe_events se
left join public.billing_events be on be.stripe_event_id = se.id
where se.type in ('checkout.session.completed','invoice.paid')
  and be.id is null
order by se.received_at desc;
```

Live (24h):

```sql
select log_attributes['response.status_code'] as status, count(*) as n, max(timestamp) as last_seen
from logs
where source = 'function_edge_logs'
  and log_attributes['request.pathname'] = '/functions/v1/stripe-webhook'
group by 1 order by n desc;
```

A 400 from this function means signature verification failed; the function
logs `signature verification failed against N configured secret(s)` to
`function_logs`. Nine 400s exist in the current window from arming probes with
fake signatures — expected, per `docs/LAUNCH.md`. **On launch day, any 400 that
correlates with a real Stripe delivery is a P1.** Stripe Dashboard → Developers
→ Webhooks is the durable, authoritative delivery record; check it there, not
here, for anything older than a day.

### 2.20 RLS / permission errors — OBSERVABLE (24h only) — *and currently firing*

```sql
-- query_logs, window <= 24h
select log_attributes['parsed.sql_state_code'] as code,
       log_attributes['parsed.user_name']      as db_user,
       event_message,
       count(*) as n, max(timestamp) as last_seen
from logs
where source = 'postgres_logs'
  and log_attributes['parsed.error_severity'] = 'ERROR'
  and (log_attributes['parsed.sql_state_code'] = '42501'
       or event_message ilike '%row-level security%')
group by 1,2,3 order by n desc;
```

Two shapes, and they mean different things:
- `42501 permission denied for table X` — a **GRANT** problem. The client asked
  for a column the role cannot select. This is not RLS and no policy will fix
  it.
- `42501 new row violates row-level security policy for "X"` — a **policy**
  problem on a write.

A standing audit of which columns a normal user may read (run any time, no log
window):

```sql
select c.table_name, c.column_name
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('listings','profiles')
  and not has_column_privilege('authenticated', 'public.' || c.table_name, c.column_name, 'SELECT')
order by 1, 2;
```

> **This query currently returns `listings.request_options`,
> `listings.allow_custom_request`, `listings.slug`, `listings.lat`,
> `listings.lng`.** `lat`/`lng`/`slug` are deliberately withheld. The first two
> are not — they are selected by the mobile client and are producing live
> failures. See §6.

### 2.21 Crash reports — **NOT OBSERVABLE** in this stack
There is no crash reporter. Verified: no `sentry`, `bugsnag`, or `crashlytics`
dependency in `expo/package.json`, `web/package.json`, or `admin/package.json`,
and no error-boundary reporting hook. A native crash produces **no signal
anywhere in Supabase**.

The only surfaces are external and delayed by hours to a day:
- App Store Connect → your app → Analytics/Metrics → **Crashes**
- Google Play Console → Quality → **Android vitals** → Crashes & ANRs

**What would be needed:** `sentry-expo` (or equivalent) in the Expo app plus a
`window.onerror` reporter on the web build. Until then, a JavaScript exception
that white-screens a user is invisible; the closest proxy is a sudden drop in
the mobile event stream (§2.4/§2.6) with no matching drop in `edge_logs`
traffic.

### 2.22 Seed Drop route attempts — PARTIALLY OBSERVABLE
Seed Drop ships as **Coming Soon** — no price, no date, no purchase — so the
useful measure is *demand pressure*: how many people tried to get to it.

Durable, in-app:

```sql
select event_type, count(*) as n, max(created_at) as last_seen
from public.events
where event_type in ('seed_drop_tapped','web_seed_profile_started',
                     'web_seed_profile_completed','web_seed_checkout_started')
group by 1 order by 2 desc;
```

Those four event types are **historical only as of this round.** The Coming Soon
conversion removed both emitters: the rewritten `web/app/seeds/page.tsx`
contains no `logWeb` call, and `seed_drop_tapped` is gone from
`expo/app/(tabs)/index.tsx`. The query above will therefore keep returning the
46 pre-existing rows and never grow — **a flat number here means "not
instrumented", not "no interest".**

This is the one place where turning a feature off also turned its only demand
signal off, and demand is precisely what a Coming Soon page exists to measure.
The cheap fix, for whichever lane owns those two files: fire
`logWeb('seed_profile_started')` on mount of the Coming Soon page and
`logEvent('seed_drop_tapped')` on the mobile entry point. `web_seed_profile_started`
is already on the `events_guard` allowlist, so reusing that name needs **no
migration** — a new name would silently fail. Until that lands, treat Seed Drop
interest as measurable only from nginx (below).

Also durable, and the hard stop for the Coming Soon promise:

```sql
select count(*) as seed_orders,
       count(*) filter (where stripe_livemode) as live_orders,
       max(created_at) as last
from public.seed_orders;
select count(*) as seed_subscriptions from public.seed_drop_subscriptions;
```

`seed_drop_subscriptions` is currently **0 rows** and `seed_orders` holds 1
test row. Any live-mode seed order during launch is a Coming-Soon violation and
a rollback trigger (§5).

Raw route hits to `https://gnomefarmersmarket.com/seeds` — including bounces
that never fire an event — are **only** in nginx on the VPS:

```bash
ssh root@147.79.75.242 "grep -c ' /seeds' /var/log/nginx/access.log"
ssh root@147.79.75.242 "grep ' /seeds' /var/log/nginx/access.log | tail -50"
```

### 2.23 Geographic distribution — OBSERVABLE
Two independent views: where accounts *say* they are, and where requests come
from.

```sql
select coalesce(state,'?') as state, coalesce(city,'?') as city,
       count(*) filter (where src = 'profile')  as profiles,
       count(*) filter (where src = 'market')   as markets,
       count(*) filter (where src = 'listing')  as active_listings
from (
  select 'profile' as src, state, city from public.profiles
  union all select 'market',  state, city from public.markets  where status = 'active'
  union all select 'listing', state, city from public.listings where status = 'active'
) g
group by 1,2 order by 3 desc, 5 desc;
```

Most rows are currently `?` — city/state are only filled when a user sets a
location, so read this as coverage of *known* locations, not of users.

Request-level geography, 24h, from the Cloudflare edge (covers signed-out
traffic the tables cannot see):

```sql
select log_attributes['request.cf.country']    as country,
       log_attributes['request.cf.region']     as region,
       log_attributes['request.cf.city']       as city,
       log_attributes['request.cf.postalCode'] as postal,
       count(*) as requests
from logs
where source = 'edge_logs'
group by 1,2,3,4 order by 5 desc limit 30;
```

### 2.24 Empty-result searches — **NOT OBSERVABLE**
No search event records a result count anywhere.
- Web: `logWeb('zip_search', { q })` fires on submit with the query text only.
  `BrowseClient` then filters listings **client-side** by radius and logs
  nothing about how many survived.
- Mobile: `useListings` applies the radius filter in the client and emits no
  search event at all.

A weak proxy for *geocode* failure (not for zero results) — a ZIP search with
no `web_browse_location_set` behind it:

```sql
select s.created_at, s.metadata->>'q' as query
from public.events s
where s.event_type = 'web_zip_search'
  and not exists (
    select 1 from public.events b
    where b.event_type = 'web_browse_location_set'
      and b.created_at between s.created_at and s.created_at + interval '2 minutes')
order by s.created_at desc;
```

**What would be needed:** add `results` (and `radius`) to the metadata of a new
`web_browse_results` event — which also requires adding that name to
`events_guard`'s allowlist in a migration, and the equivalent `logEvent` call in
`expo/lib/db.ts`. This is the single highest-value instrumentation gap for a
hyperlocal marketplace: "someone searched their town and Gnome was empty" is
the exact failure launch needs to see, and today it is invisible.

---

## 3. Launch-day checklist

Run top to bottom. Anything unchecked is a launch blocker until it is
explained.

**T-1 day — configuration**
- [ ] `select payments_live_enabled, stripe_mode from public.billing_config;`
      → confirm this matches the intended launch posture.
- [ ] `select key, stripe_price_id_test is not null as test_ready,
      stripe_price_id_live is not null as live_ready from public.billing_products
      order by key;` → confirm no product exposes a price it cannot charge.
- [ ] Admin app → More → Billing Health opens and renders.
- [ ] Supabase Dashboard → Auth → URL Configuration: Site URL is
      `https://gnomefarmersmarket.com`, redirects include `/**`.
      (`docs/LAUNCH.md` records this as an open item — verify, do not assume.)
- [ ] Supabase Dashboard → Auth → Emails: magic-link template contains the
      `{{ .Token }}` code line; custom SMTP saved and a test mail received at a
      non-team address.
- [ ] Supabase Dashboard → Auth → Providers: Google and Apple enabled if the
      app build ships those buttons.
- [ ] The permission audit in §2.20 returns **only** `lat`, `lng`, `slug`.
- [ ] Supabase Dashboard → Advisors → Security: read the list.
      `public.legacy_category_map` currently has **RLS disabled** — decide and
      record whether that is intentional before launch (it is a 16-row lookup
      table, but the anon key can read and write it as things stand).
- [ ] Seed Drop is Coming Soon on every surface: no price, no date, no
      purchase button on `/seeds` or in the app.
- [ ] `select count(*) from public.listings where is_demo;` → know the number
      before launch so it can be subtracted from every listing count after.

**T-0 morning — baseline (write these numbers down; the log window will not
remember them)**
- [ ] Run §4 Pulse A and save the output with a timestamp.
- [ ] `select count(*) from auth.users;` and `select count(*) from public.listings;`
- [ ] Admin app Home → screenshot the Daily Brief.
- [ ] Confirm `stripe_events` has zero `livemode = true` rows.
- [ ] `ssh root@147.79.75.242 "pm2 describe gnome-web | head -20"` → app online,
      restart count noted.
- [ ] Load `https://gnomefarmersmarket.com` and `/browse` signed out; load the
      mobile app signed in and open Browse. Both must show listings.

**T-0 launch hour**
- [ ] Post the announcement.
- [ ] Watch §4 Pulse B every 15 minutes for the first two hours.
- [ ] Keep the Supabase Logs tab open on `postgres_logs` filtered to ERROR.

---

## 4. The pulse queries

Two saved queries. Pulse A is the durable daily snapshot (run it and **save the
result outside the database** — a dated row in a spreadsheet — because the log
half of the picture disappears in 24h). Pulse B is the fast "is anything on
fire" check.

**Pulse A — daily snapshot (SQL editor):**

```sql
select
  now()                                                                          as at,
  (select count(*) from auth.users)                                              as users_total,
  (select count(*) from auth.users where created_at > now() - interval '24 hours') as users_24h,
  (select count(*) from public.profiles where onboarding_completed_at is not null) as onboarding_reached_end,
  (select count(*) from public.markets where status = 'active')                   as markets_active,
  (select count(*) from public.listings
     where status = 'active' and expires_at > now() and coalesce(is_demo,false) = false) as listings_live,
  (select count(*) from public.listings where created_at > now() - interval '24 hours') as listings_24h,
  (select count(*) from public.claims where created_at > now() - interval '24 hours')   as claims_24h,
  (select count(*) from public.claim_messages where created_at > now() - interval '24 hours') as messages_24h,
  (select count(*) from public.claims where status = 'completed')                 as claims_completed,
  (select count(*) from public.market_orders where status = 'COMPLETED')          as orders_completed,
  (select count(*) from public.reports where resolved_at is null)                 as reports_open,
  (select count(*) from public.seller_credentials where status = 'PENDING')       as compliance_pending,
  (select count(*) from public.ai_usage_log
     where created_at > now() - interval '24 hours' and not success)              as ai_fails_24h,
  (select coalesce(sum(estimated_cost_cents),0) from public.ai_usage_log
     where created_at > now() - interval '24 hours')                              as ai_cents_24h,
  (select count(*) from public.stripe_events where livemode)                      as stripe_live_events,
  (select count(*) from public.billing_events where livemode)                     as billing_live_events,
  (select count(*) from public.seed_orders)                                       as seed_orders,
  (select count(*) from public.seed_drop_subscriptions)                           as seed_subscriptions;
```

**Pulse B — error sweep (`query_logs`, 24h window):**

```sql
select source,
       log_attributes['parsed.sql_state_code'] as pg_code,
       log_attributes['response.status_code']  as http_status,
       log_attributes['parsed.user_name']      as db_user,
       substring(event_message, 1, 140)        as msg,
       count(*)                                as n,
       max(timestamp)                          as last_seen
from logs
where (source = 'postgres_logs'      and log_attributes['parsed.error_severity'] in ('ERROR','FATAL','PANIC'))
   or (source = 'function_edge_logs' and log_attributes['response.status_code'] >= '400')
   or (source = 'function_logs'      and log_attributes['level'] = 'error')
   or (source = 'auth_logs'          and log_attributes['level'] = 'error')
group by 1,2,3,4,5 order by n desc limit 40;
```

Read `db_user` before reacting: `authenticator` is real client traffic through
PostgREST, `postgres` is someone typing in the SQL editor. Do not coalesce these
columns into one — ClickHouse `Map` access returns `''` rather than `NULL` for a
missing key, so `coalesce()` never falls through and the HTTP status silently
disappears.

---

## 5. First 72 hours — monitoring schedule

Times are local. The schedule is built for one part-time operator, so it front-
loads attention and thins out fast. The non-negotiable is the **daily Pulse A
snapshot saved outside the database** — without it, launch week leaves no
record once the 24h log window rolls.

**Day 0 (launch day)**

| When | What | Where |
| --- | --- | --- |
| Launch hour, then every 15 min for 2h | Pulse B error sweep; `postgres_logs` ERROR list; `function_edge_logs` non-200 | query_logs |
| Launch hour, then hourly | Signups (§2.1) and listings created (§2.4) — is anything arriving at all? | SQL editor |
| +1h | Sign up as a brand-new user on a phone that has never run the app: complete onboarding, post a listing, claim someone else's, send a message. This end-to-end pass finds what no query will. | manual |
| Every 2h | Admin app Home → Needs your attention (reports, compliance, AI approvals) | Admin app |
| Every 2h | AI failure rate (§2.13) | SQL editor / AI HQ |
| Any Stripe activity | `stripe_events` + `billing_events` livemode rows; Stripe Dashboard → Webhooks delivery list | SQL + Stripe |
| End of day | **Pulse A → save to the launch log** | SQL editor |

**Day 1**

| When | What |
| --- | --- |
| ~08:00 | Pulse A → save. Compare every number to Day 0. |
| ~08:15 | Pulse B error sweep. Anything new since yesterday gets a name. |
| ~08:30 | Onboarding split (§2.2) — is the skip rate climbing? |
| ~12:00 | Admin app Home; open reports and compliance queue |
| ~12:15 | Empty-search proxy (§2.24) and geography (§2.23) — is Gnome empty where people are looking? |
| ~18:00 | Pulse B; AI failure rate; claims + messages 24h |
| ~21:00 | Pulse A → save |

**Day 2**

| When | What |
| --- | --- |
| ~08:00 | Pulse A → save; Pulse B |
| ~12:00 | Admin app Home; reports; compliance |
| ~18:00 | Pulse B; funnel read: signups → onboarding → listing → claim → message → completed |
| ~21:00 | Pulse A → save; decide whether to drop to once-daily from Day 3 |

**Throughout, the three questions the numbers must answer**
1. Are people arriving? (signups, `edge_logs` volume)
2. Are they getting through? (onboarding split, listings created vs. §2.5
   failures, claims, messages)
3. Is anything failing silently? (Pulse B, AI fail %, RLS/permission audit,
   webhook 400s)

---

## 6. Rollback triggers

Roll back — or flip the specific kill switch — on any of these. Each names the
observation, not a feeling.

**Immediate rollback of the release**
1. **Permission audit regression.** §2.20's column-privilege query returns any
   column beyond `lat`, `lng`, `slug` for `listings`, or any newly-ungranted
   column on `profiles`, **and** `postgres_logs` shows matching `42501` errors
   from `authenticator`. Users are being shown an empty or broken app.
2. **Signup or sign-in floor.** Two consecutive hourly checks with new users
   arriving (`edge_logs` traffic present) but zero rows added to `auth.users`,
   or `auth_logs` showing `status >= 400` on `/token` or `/signup` as the
   majority of attempts.
3. **Listing creation floor.** More `P0001` listing rejections than successful
   `listings` inserts over any two-hour window — the post flow is rejecting
   people who are trying.
4. **A live Stripe charge while `payments_live_enabled = false`.** Any
   `stripe_events` or `billing_events` row with `livemode = true` that was not
   deliberately initiated. Stop, refund in Stripe, then investigate.
5. **Seed Drop Coming-Soon violation.** Any new row in `seed_orders` or
   `seed_drop_subscriptions`, or any `/seeds` surface showing a price, a date,
   or a purchase control. Seed Drop must not be able to take money.
6. **Data exposure.** Supabase Advisors reports a new table with RLS disabled,
   or the `profiles` guard in migration 0087 raises (a table-level SELECT grant
   reappeared). Treat as security, not availability.
7. **Founding numbering inconsistency** — *only applicable once 0091 is applied
   and `program_enabled` is true.* §2.12's check shows
   `rows_total <> distinct_numbers`, `highest_awarded > counter`, or
   `counter > capacity`. A wrong founding number is a promise broken in public
   and cannot be quietly corrected later; stop awarding
   (`admin_founding_set_program` → `program_enabled = false`) before doing
   anything else.

**Feature kill switch, not a full rollback**
8. **AI failure rate > 25% over 30+ calls in an hour**, or `provider IS NULL`
   failures reappearing (credentials/credits gone) → Admin app → AI HQ →
   pause AI writes (`admin_set_ai_paused`). The rest of the app keeps working;
   AI degrades to unavailable.
9. **AI spend anomaly** — `ai_cents_24h` more than 5x the Day-0 baseline → same
   switch.
10. **Webhook 400s correlating with real Stripe deliveries** (Stripe Dashboard
    shows failed deliveries, not just the arming probes) → set
    `payments_live_enabled = false` via `admin_set_payments_live(false)`, fix the
    signing secret, replay from Stripe. Do not roll back the app.
11. **Report or compliance flood** — open reports rising faster than they can be
    resolved, or any report alleging a safety issue → moderate first
    (`admin_set_listing_status`, `admin_set_suspended`), then decide.

**Explicitly NOT a rollback trigger**
- Zero activity. Launch-day silence is a marketing problem, not a defect. Check
  §2.23 and §2.24 before touching code.
- The nine historical `stripe-webhook` 400s in the log window — those are the
  documented arming probes with fake signatures.
- `postgres_logs` errors with `db_user = 'postgres'` — those are someone (or
  some agent) typing SQL in the editor, not users hitting the app.

---

## 7. Known gaps and one live blocker

**Live blocker found while writing this document (2026-08-13).**
`public.listings` grants column-level SELECT to `anon`/`authenticated`, and
**`request_options` and `allow_custom_request` were never added to that grant**
(migration 0085/0088 added the columns; 0088 updated the `public_listings` view
but not the base-table grant). `expo/lib/db.ts` line 85 includes both columns in
`LISTING_FIELDS`, which every listing read uses. Verified three ways:

- **Grant state (definitive, no log window involved):**
  `has_column_privilege('authenticated','public.listings','request_options','SELECT')`
  → `false`; same for `allow_custom_request`. Both are also `false` for `anon`.
- **Code path (definitive):** `expo/lib/db.ts` line 85 ends `LISTING_FIELDS`
  with `'request_options,allow_custom_request'`, and that constant is the select
  list for `useListings`, `useListing`, `useMyListings` and the claim joins.
  Those two facts alone are sufficient — every mobile listing read asks for a
  column the role cannot read, which PostgREST returns as an error, not as a
  null.
- **Corroborating (log window, 24h):** `postgres_logs` shows ~100 ×
  `42501 permission denied for table listings` from db user `authenticator`,
  and the failing PostgREST statements name `request_options` /
  `allow_custom_request`. The statement shapes are the browse feed (`listings`
  filtered by `approx_lat`/`approx_lng`), the claims list (`claims → listings`)
  and promotions (`listing_promotions → listings`). Caveat: this count may
  include traffic from other agents working the same project today, so treat it
  as corroboration of the shape, not as a user-impact measurement.

Effect: the mobile app's browse feed, listing detail, my-listings, claims list
and promotions reads all fail for signed-in users. This is not a monitoring
gap — it is a functional outage that monitoring found. **It is outside this
lane's owned files; it needs the lane that owns `supabase/migrations/` (a new
`0090_*` migration granting SELECT on those two columns) or the lane that owns
`expo/lib/db.ts` (drop them from `LISTING_FIELDS`).** Whichever fix lands, §2.20's
column-privilege audit is the verification, and a manual Browse-tab load on a
real device is the acceptance test — do not sign this off from SQL alone.

**Instrumentation gaps, ranked by launch value**
1. **Empty-result searches (§2.24)** — no result count is logged anywhere. For
   a hyperlocal marketplace this is the most important missing metric.
2. **Crash reporting (§2.21)** — nothing at all; a white-screen is invisible.
3. **Web listing failures (§2.5)** — the web sell flow logs success only.
4. **24-hour log retention (§1.2)** — every log-derived metric evaporates
   daily. Mitigated only by saving Pulse A by hand.
5. **Account deletion (§2.16)** — no audit row survives the deletion.
6. **Subscription attempts (§2.9)** — abandoned checkouts exist only in Stripe.
7. **`events` has no admin read path (§1.1)** — all product analytics require
   the SQL editor; none of it can reach the Admin app without a new RPC.
8. **Founding Member (§2.11/§2.12)** — `0091_founding_members.sql` exists in the
   tree but is **not applied**, so nothing is countable yet. When it is applied,
   the metrics come free from `founding_program_config`, `founding_members` and
   `admin_audit_log`; no new instrumentation is needed.

**Regression introduced this round (worth fixing before launch, not after)**
Converting Seed Drop to Coming Soon removed the only two demand signals it had
(§2.22): `web/app/seeds/page.tsx` no longer calls `logWeb`, and
`seed_drop_tapped` is gone from `expo/app/(tabs)/index.tsx`. A Coming Soon page
whose interest cannot be counted is a page that will be argued about instead of
measured. Reuse `web_seed_profile_started` — already allowlisted, no migration.

---

## 8. Provenance

Every "OBSERVABLE" verdict in this document was checked by running the query
against project `fgybyghwcjlstqxkclch` on 2026-08-13, not by reading code.
Table and column names came from `information_schema`; function bodies from
`pg_get_functiondef`; log field names from `mapKeys(log_attributes)` on live
rows; applied-migration state from the migration list (newest applied: 0087
`profiles_public_projection`). The Pulse A and Pulse B queries in §4 were both
executed successfully as written.

Three things in this document were **not** verified and are labelled where they
appear: the `/recover` auth path (no password reset has ever run on this
project), the nginx commands in §2.22 (the VPS was not accessed from here), and
anything described as taking effect "once 0091 is applied".
