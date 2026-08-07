# Gnome — launch checklist

## SMTP (auth email) — ONE PASTE FROM DONE (2026-08-07)

Supabase → Auth → Emails → SMTP Settings is staged with these values
(no secrets in this file; the password lives only in Daniel's hands and,
already, in /var/www/1way-backend/.env on the VPS as MAIL_PASSWORD):

- Sender email:  marinelli1907@outlook.com
- Sender name:   Gnome Farmers Market
- Host:          smtp-mail.outlook.com
- Port:          587 (STARTTLS)
- Username:      marinelli1907@outlook.com
- Password:      ← Daniel pastes, then Save changes
- Reply address: same as sender (Outlook personal has no separate reply-to
  mailbox; replies land in the Outlook inbox)

After saving, the auth mail rate limit rises to 30/hr (adjustable) and
truly-external addresses can sign up. Verify with any non-team email.

**Deliverability upgrade (recommended before real growth):** a domain
mailbox — Hostinger includes free mailboxes with gnomefarmersmarket.com
(hPanel → Emails → create hello@gnomefarmersmarket.com, then host
smtp.hostinger.com:587) — gives SPF/DKIM alignment and a branded sender.
Personal Outlook works at low volume but is the weakest link for spam
placement, and Microsoft has been tightening basic-auth SMTP.

Updated 2026-08-03. Code for everything below is DONE, deployed, and live at
https://gnomefarmersmarket.com (sell + AI garden planner shipped; see git log).
What remains is Supabase **dashboard** configuration that has no API — each item
is a few minutes in https://supabase.com/dashboard/project/fgybyghwcjlstqxkclch.

## Blockers (web sign-in doesn't complete until these are set)

1. **Auth → Emails → Magic Link template: add the 6-digit code.**
   The default template only sends a link. Add a line like
   `Your sign-in code: {{ .Token }}` (keep the link too — the site accepts both;
   the code path is what the Sell/Planner UI shows first).

2. **Auth → URL Configuration.**
   - Site URL: `https://gnomefarmersmarket.com` (currently `http://localhost:3000` —
     verified live: magic links redirect to localhost today).
   - Additional redirect URLs: `https://gnomefarmersmarket.com/**`

3. **Auth → SMTP: set up custom SMTP before real users.**
   Built-in Supabase mail is ~2 emails/hour and team-members-only — fine for
   your own testing, dead on arrival for launch. Hostinger SMTP or Resend
   free tier both work.

## Blockers (app store build)

4. **Auth → Providers: enable Google and Apple.**
   Verified via `/auth/v1/settings`: both are currently **disabled**, so the
   sign-in buttons built in beta-prep #1/#2 fail server-side. Client IDs/secrets
   per BETA_PREP.md.

## Revenue switch-on (Stripe) — ARMED, awaiting first live checkout (2026-08-06)

Everything is configured: Payment Links live on /pricing (Grower + Farm +
Boost), secrets set (restricted rk_ key + whsec, correct format), the single
live endpoint `gnome-plan-sync` active. Verified in the Stripe dashboard:
**zero deliveries and zero payments ever** — the 400s in the function logs
were arming probes with fake signatures (expected), not failed Stripe
deliveries. So the whsec has never been exercised against a real signed
event; it cannot be verified without one.

First-transaction smoke test (optional, ~$0.30 net cost): buy the $4.99
Boost yourself from My Market, confirm the webhook logs 200 and
`listing_promotions` gets a row, then refund the payment in Stripe
(fees aren't returned on refund). If it 400s, the function logs the
secret's shape + Stripe's error (Edge Function logs) — then re-copy the
signing secret from the endpoint page into the Supabase
`STRIPE_WEBHOOK_SECRET` secret and resend the event from Stripe.

## Done (verified live 2026-08-03)

- Web **Sell flow** (`/sell`): email-code/magic-link sign-in, photo upload,
  ✨ AI draft, listing insert under RLS with market attachment.
- Web **AI Garden Planner** (`/garden`): zone- and date-aware chat,
  sign-in-gated (cost gate). Function `garden-planner` v1 deployed
  (claude-sonnet-5); smoke-tested — correct Zone 6b / August answer.
- App **Garden Planner** screen (`expo/app/garden.tsx`) + home-screen banner.
- `draft-listing` v3 deployed, key set, verified end-to-end (200 in logs).
- Homepage v2, marketplace browse, Seed Drop — live earlier.

## Post-launch manual smoke test (10 min, needs a phone + real email)

1. `/sell` → sign in with a personal email → post a listing with a photo using
   the ✨ AI draft → confirm it appears on the homepage and in the app.
2. `/garden` → ask "what should I plant right now?" → answer mentions your town's zone.
3. App: tap the Garden Planner banner → same question works signed in.

## Deliberately NOT in scope (CTO "Vanth" gate — M10 full)

Admin dashboards, analytics UIs, in-app payment flows beyond Payment Links.
(M10-lite — Stripe Payment Links + webhook — shipped 2026-08-05.)
