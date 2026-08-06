# Gnome — launch checklist

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

## Revenue switch-on (Stripe — ~30 min, all in the Stripe dashboard)

The whole monetization pipeline is deployed and waiting on four Stripe values:

1. Create two subscription products: **Grower $9.99/mo**, **Farm $29.99/mo**
   (one-off **Boost $4.99** optional). Create a **Payment Link** for each.
2. Add a webhook endpoint →
   `https://fgybyghwcjlstqxkclch.supabase.co/functions/v1/stripe-webhook`
   with events `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
3. `supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRICE_GROWER=price_... STRIPE_PRICE_FARM=price_...`
4. Put the two Payment Link URLs in `web/.env.local`
   (`NEXT_PUBLIC_STRIPE_LINK_GROWER/_FARM`) and redeploy the web.

Then: /pricing upgrade buttons check out via Stripe; the webhook flips
`markets.plan` (raising listing caps + monthly boost credits + full AI
allowance automatically); cancellation downgrades to free. Seed Drop links
(NEXT_PUBLIC_SEED_LINK_*) are a separate 10 minutes while you're in there.

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

## Deliberately NOT in scope (CTO "Vanth" gate — M10)

Stripe/paid boosts, admin dashboards, analytics UIs. Payments stay offline.
