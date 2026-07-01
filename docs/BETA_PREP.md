# Beta Prep — branch `feat/beta-prep`

Four beta-readiness items, all code-complete on this branch (typecheck passes).
Nothing here was run against the live DB or deployed. Below is what each change
does and the **manual steps only you can do** to finish wiring them.

---

## 1. Google sign-in

**Code:** `providers/AuthProvider.tsx` (`signInWithGoogle`), `lib/supabase.ts`
(PKCE flow), `app/sign-in.tsx` ("Continue with Google" button). Uses the native
system browser (`expo-web-browser`) and exchanges the returned PKCE code for a
session. The existing `on_auth_user_created` trigger creates the profile +
default market, same as email signup.

**You must:**
1. **Google Cloud Console** → create OAuth credentials (Web application). Add
   authorized redirect URI: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`.
2. **Supabase Dashboard → Authentication → Providers → Google** → enable, paste
   the Client ID + Client Secret.
3. **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs** →
   add `gnome://auth-callback`.
4. Test on a **dev/standalone build** (the `gnome://` scheme resolves there; in
   Expo Go the redirect uses an `exp://` URL, which also works for dev but a dev
   build is the real test).

_Apple sign-in was not built_ — it needs the `expo-apple-authentication` native
module + an Apple Developer "Sign in with Apple" capability, so it requires a
native build. It's the natural follow-up (and is required for App Store review
if you offer Google). Say the word and I'll add it.

## 2. EAS / TestFlight build

**Code:** `expo/eas.json` (development / preview / production profiles).
`app.json` `extra.eas.projectId` is still empty — `eas init` fills it.

**You must (from `expo/`):**
```bash
npx eas-cli@latest login
eas init                 # writes projectId into app.json
eas build --profile preview --platform ios      # quick internal build, or:
eas build --profile production --platform ios
eas submit  --profile production --platform ios  # needs an Apple Developer acct
```

## 3. Push deep-links

**Code:** `lib/useNotificationRouting.ts`, wired in `app/_layout.tsx`. Tapping a
push now routes: `message`/`approved` → the pickup chat, `claim` → My Gnome
(requests), `wanted_matched` → the matching listing. The `notify` Edge Function
already attaches the needed `data` payload — no function change required.

**You must:** nothing extra beyond having push working, which needs a
**dev/standalone build** (remote push doesn't work in Expo Go on SDK 53+).

## 4. Realtime chat

**Code:** `lib/db.ts` (`useClaimMessagesRealtime`), used in `app/chat/[claimId].tsx`.
Chat now updates instantly via Supabase Realtime; the old 5s poll is kept as a
15s fallback. RLS on `claim_messages` scopes the stream to the two parties.

**You must:** apply the migration so the table is in the Realtime publication:
```bash
supabase db push          # applies 0014_realtime_chat.sql
# or paste 0014 into the SQL editor
```

## 5. Seed listings (empty-marketplace fix)

**Code:** `supabase/seed/seed_listings.mjs` — 16 realistic Free/Sale/Trade/Wanted
listings around Richmond Heights / Mayfield / Mentor. Idempotent by
(owner, title). **Not run** — it writes to the live DB with the service-role key.

**You must:**
```bash
cd supabase/seed && npm install
export SUPABASE_URL="https://<PROJECT_REF>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service_role key from Settings → API>"
export SEED_OWNER_EMAIL="<an existing Gnome account email>"
node seed_listings.mjs            # or: node seed_listings.mjs --reset
```

---

### Not in scope (respecting the "payments offline / don't run ahead" rules)
Stripe/paid boosts, admin/moderation dashboard, and analytics dashboards were
left alone — they're on the CTO NEVER-list or gated on the M10 payments spec.
Verified-email trust badge and block-user are small optional follow-ups.
