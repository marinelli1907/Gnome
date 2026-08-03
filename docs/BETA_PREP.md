# Beta Prep — branch `feat/beta-prep`

Beta-readiness work, code-complete on this branch (expo + web typecheck pass;
expo lint clean apart from 4 pre-existing warnings). **Nothing here was run
against the live DB or deployed.** Below: what shipped, the migrations to apply,
and the manual steps only you can do.

> ⚠️ **Apply migrations 0014–0018 BEFORE shipping the app build or deploying the
> web app.** The app and site select new columns (e.g. `public_markets.verified_email`
> from 0015); until the migration is applied, `rest()` returns empty and market
> pages / featured sections render blank (they degrade, they don't crash). Same
> migrations-first discipline as M8/0012.

## Migrations to apply (in order)
```bash
supabase db push     # applies 0014 … 0018
```
- **0014_realtime_chat** — adds `claim_messages` to the `supabase_realtime` publication (RLS already scopes it to the two parties).
- **0015_trust_verified_email** — recreates `public_markets` with a `verified_email` boolean (owner's Auth email confirmed). Only the boolean is exposed; no `auth.users` data leaks.
- **0016_user_blocks** — `user_blocks` table + RLS + BEFORE-INSERT triggers that block claims/messages between a blocked pair (both directions). `blocked_pair()` EXECUTE is revoked from anon/authenticated so the block graph can't be probed via RPC.
- **0017_feedback** — write-only `feedback` table (reviewed server-side, like `reports`).
- **0018_auto_expire_cron** — pg_cron job flips `active`→`expired` every 15 min so DB status matches the app/view filters. If `create extension pg_cron` is refused, enable it once in Dashboard → Database → Extensions and re-run.

---

## 1. Google + Apple sign-in
**Code:** `providers/AuthProvider.tsx` (`signInWithGoogle` via `expo-web-browser`
+ PKCE; `signInWithApple` via `expo-apple-authentication` + nonce +
`signInWithIdToken`), `app/sign-in.tsx` (Google button + native Apple button,
iOS-only, availability-gated), `lib/supabase.ts` (PKCE), `app.json`
(`usesAppleSignIn`, `expo-apple-authentication` plugin). Profile + default market
still come from the existing signup trigger; Apple's first-authorization name is
persisted to the profile.

**You must:**
1. **Google:** create OAuth creds in Google Cloud (redirect
   `https://<REF>.supabase.co/auth/v1/callback`) → enable Google in Supabase Auth
   → add `gnome://auth-callback` to Auth → URL Configuration → Redirect URLs.
2. **Apple:** enable "Sign in with Apple" for the App ID in the Apple Developer
   portal; enable the Apple provider in Supabase Auth (Services ID + key). Apple
   sign-in only appears on a real iOS build (needs the native module).
3. Test on a **dev/standalone build** (both providers need the `gnome://` scheme,
   which resolves in a dev/standalone build, not Expo Go).

## 2. EAS / TestFlight
**Code:** `expo/eas.json` (dev/preview/production). `app.json`
`extra.eas.projectId` is still empty — `eas init` fills it.
```bash
cd expo && npx eas-cli@latest login && eas init
eas build --profile preview   --platform ios    # internal, or:
eas build --profile production --platform ios
eas submit --profile production --platform ios   # needs Apple Developer acct
```

## 3. Push deep-links
**Code:** `lib/useNotificationRouting.ts` (wired in `app/_layout.tsx`, gated on
fonts-loaded so cold-start taps don't fire before the navigator mounts). Taps
route: `message`/`approved` → chat, `claim` → My Gnome, `wanted_matched` →
listing. `notify` already sends the `data` payload. Needs a dev/standalone build
(push doesn't work in Expo Go).

## 4. Realtime chat
**Code:** `lib/db.ts` `useClaimMessagesRealtime` (used in `app/chat/[claimId].tsx`);
15s poll kept as fallback. Needs 0014 applied.

## 5. Block user + feedback + Settings
**Code:** `app/settings.tsx` (new — feedback box, blocked-neighbor management,
account/sign-out), linked from `app/(tabs)/profile.tsx`. Block/unblock +
feedback hooks in `lib/db.ts`; Block actions on `app/listing/[id].tsx` and
`app/market/[id].tsx`; blocked owners are filtered from browse/map/featured;
the `notify` function skips blocked pairs on wanted-matches. Needs 0016/0017.

## 6. Verified-email trust badge
**Code:** app `components/Reputation.tsx` + `useMarketReputation`; web
`lib/gnome.ts` + `app/market/[slug]/page.tsx`. Needs **0015 applied first**
(see the warning at the top).

## 7. Share links → public website
**Code:** `lib/links.ts` (`listingShareUrl`/`marketShareUrl` →
`https://gnomefarmersmarket.com/...`); Share actions on listing + market pages.
URLs match the web routes (`/listing/[slug]-[id]`, `/market/[slug]`).

## 8. Seed listings (empty-marketplace fix)
**Code:** `supabase/seed/seed_listings.mjs` — 16 NE-Ohio listings across all four
types, idempotent by (owner, title), `--reset` supported. Batch insert
intentionally seeds all 16 into the owner's market (the 0008 plan-limit trigger
can't see same-command rows, so the free cap doesn't block the batch). **Not
run** — writes to the live DB with the service-role key.
```bash
cd supabase/seed && npm install
export SUPABASE_URL="https://<REF>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service_role key>"
export SEED_OWNER_EMAIL="<an existing Gnome account>"
node seed_listings.mjs            # or: node seed_listings.mjs --reset
```

## 9. AI listing drafts — "snap a photo, we write the listing"
**Code:** `supabase/functions/draft-listing/index.ts` (Claude `claude-opus-5`,
vision + structured JSON output, effort=low for speed; refuses gracefully),
`expo/lib/ai.ts`, ✨ button on `app/(tabs)/post.tsx` (appears once a photo is
added; fills only empty fields; logs `ai_draft_used`). This is the OfferUp-beating
seller UX: photo → title/category/description (+ price for sales) in seconds.

**You must:**
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # console.anthropic.com
supabase functions deploy draft-listing
```
Cost note: ~1 vision call per draft on claude-opus-5 (input-heavy, ~cents per
draft); verify_jwt is ON so only signed-in users can trigger it.

---

### Deliberately NOT built (CTO scope-lock)
Stripe/paid boosts, admin/moderation dashboards, and analytics UIs — payments
stay offline; those are gated on the M10 "Vanth" spec.
