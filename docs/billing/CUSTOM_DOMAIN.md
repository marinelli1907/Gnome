# Custom API Domain — api.gnomefarmersmarket.com

Goal: serve Gnome's public Edge Functions (esp. the Stripe webhook) at
`https://api.gnomefarmersmarket.com/functions/v1/...` **without breaking** the
native `https://fgybyghwcjlstqxkclch.supabase.co` endpoint.

## Support & prerequisites (authoritative)
Supabase custom domains use Cloudflare SSL-for-SaaS and require:
- The project on **Pro plan or higher**, plus the **Custom Domains add-on**
  (paid, ~$10/mo) enabled on project `fgybyghwcjlstqxkclch` — an **owner
  billing action** in the Supabase dashboard (Project Settings → Add-ons).
- The Supabase CLI **authenticated for the Boone Systems org** (a personal
  access token via `supabase login`). The CLI on this Mac is NOT authenticated
  for Gnome, and must NOT use any other account.

Both are owner actions; until they're done, the domain cannot be initiated.

## Why the DNS records are not listed here
The exact records (a CNAME target + one or more TXT verification values) are
**generated per-project by Supabase/Cloudflare at initiation time** — they are
unique and cannot be guessed. This round did **not** fabricate them (per the
round's Part 26). They appear only after `supabase domains create` runs
against the Gnome project.

## Exact procedure (owner, or an authenticated session)
1. Enable the **Custom Domains** add-on on the Gnome project.
2. Initiate the hostname (yields the real DNS records to add):
   ```bash
   supabase domains create --project-ref fgybyghwcjlstqxkclch \
     --custom-hostname api.gnomefarmersmarket.com
   ```
   Copy the **CNAME** and **TXT** records it prints.
3. At the gnomefarmersmarket.com DNS provider, add exactly those records
   (host + target/value as printed; proxy/CDN OFF for the CNAME so
   verification and ACME can complete).
4. Reverify until DNS + certificate are issued:
   ```bash
   supabase domains reverify --project-ref fgybyghwcjlstqxkclch
   ```
5. Activate:
   ```bash
   supabase domains activate --project-ref fgybyghwcjlstqxkclch
   ```
6. **TLS/HTTPS proof (do not mark ready before all pass):** DNS resolves, a
   valid HTTPS certificate exists, an actual HTTPS request to
   `https://api.gnomefarmersmarket.com/functions/v1/notify` (or any function)
   returns, no redirect loop, no mixed content.

The native `*.supabase.co` host keeps working after activation — the custom
domain is additive.

## Client policy (minimum-risk, Part 33)
- Consumer app and Admin auth/database clients **stay on the native
  `*.supabase.co` host** (no rebuild, no regression risk).
- The custom domain initially serves **public function/webhook traffic only**.
- Broader client migration is a later, separately regression-tested step
  (`GNOME_API_BASE_URL` concept) — not done here to avoid unnecessary rebuilds.

## Stripe webhook cutover (safe, Part 30)
Do NOT delete the existing webhook first. When the domain is active:
1. In Stripe (Gnome, **test**), add a NEW endpoint
   `https://api.gnomefarmersmarket.com/functions/v1/stripe-webhook` with the
   required events (checkout.session.completed, customer.subscription.updated,
   customer.subscription.deleted, invoice.paid, invoice.payment_failed,
   charge.refunded).
2. Set its signing secret as **`STRIPE_WEBHOOK_SECRET_TEST`** (the webhook now
   resolves test/live signing secrets independently — v16).
3. Send a test event; confirm signature verification + processing via the
   custom domain (Billing Health → last event).
4. Idempotency holds even if both endpoints briefly receive the same event —
   `stripe_events` is keyed on the Stripe event id.
5. Only then disable/remove the old test endpoint if desired.
