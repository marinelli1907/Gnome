# Gnome — launch checklist

> **SUPERSEDED FOR THE 1.1.0 STORE LAUNCH.** This checklist is a 2026-08-03
> web-launch runbook and still contains useful historical notes, but it is not
> the source of truth for the current Android/iOS submission. Use
> `docs/release/RELEASE_BOARD.md`, `docs/release/GOOGLE_PLAY_PACKAGE.md`,
> `docs/release/APP_STORE_PACKAGE.md`, and
> `docs/launch/CREDENTIAL_HANDOFFS.md` for launch gating.

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

## Legacy web-auth items to re-check before relying on this runbook

1. **Auth → Emails → Magic Link template: add the 6-digit code.**
   The default template only sends a link. Add a line like
   `Your sign-in code: {{ .Token }}` (keep the link too — the site accepts both;
   the code path is what the Sell/Planner UI shows first).

2. **Auth → URL Configuration.**
   - Site URL should be `https://gnomefarmersmarket.com`.
   - Additional redirect URLs should include `https://gnomefarmersmarket.com/**`
     and, for the current mobile OAuth/password-reset flow,
     `gnome://auth-callback`.
   - This file's old "localhost" finding is historical; confirm the dashboard
     directly before treating URL configuration as launch-ready.

3. **Auth → SMTP: set up custom SMTP before real users.**
   Built-in Supabase mail is ~2 emails/hour and team-members-only — fine for
   your own testing, dead on arrival for launch. Hostinger SMTP or Resend
   free tier both work.

## App-store auth status (updated 2026-08-20)

4. **Auth → Providers: Google and Apple are enabled.**
   Verified with the same `/auth/v1/settings` request shape the app uses
   (including the public Supabase anon `apikey` header): Google `true`, Apple
   `true`, `mailer_autoconfirm=true`, `disable_signup=false`. Real OAuth and
   password-reset round trips still need device proof after confirming
   `gnome://auth-callback` is in Supabase Auth redirect URLs.

## Historical Stripe note — do not use as current launch instructions

The old 2026-08-06 Payment Link switch-on note is superseded. Current pricing
truth is the 0126 three-tier model in `docs/MONETIZATION.md`: Free, Pro
(`grower`), and Farm (`farm`), with live charging intentionally disabled and
Stripe still in TEST mode. Android exposes no in-app digital purchase UI for
v1.1 (D1); iOS/web $0.99 overage remains a deliberate, separately documented
review risk. Do not re-enable legacy Payment Links or resurrect Boost/Max/Farm
$99 launch copy from this checklist.

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

Admin dashboards, analytics UIs, or new in-app payment flows.
