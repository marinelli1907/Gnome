# Gnome 🍅

Hyperlocal surplus-produce sharing network — *"Facebook Marketplace for free
garden overflow."* Built by Boone Systems LLC.

The whole product is one loop:

> **"I have extra tomatoes"** → Post · **"I need tomatoes"** → Browse · **"I'll take them"** → Claim → owner approves.

No payments, no messaging, no marketplace, no auctions. Free sharing between neighbors.

- **Stack:** Expo / React Native + Supabase (Auth, Postgres, Storage)
- **App:** [`expo/`](./expo) — single mobile app, single account type, no role-selection screen
- **Schema:** [`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql)
- **Bundle id:** `app.boonesystems.gnome` · **Org:** Boone Systems LLC

---

## Quick start

```bash
cd expo
npm install                 # .npmrc pins legacy-peer-deps (RN 0.81 / React 19)
cp .env.example .env        # then fill in your Supabase URL + anon key
npx expo start              # press i (iOS), a (Android), or w (web)
```

The app **launches and browses without credentials** — it shows a "Connect
Supabase" state until `.env` is filled in. Posting and claiming require an
account.

## Connect Supabase (one-time, ~5 min)

1. Create a project at [supabase.com](https://supabase.com) (org: Boone Systems LLC).
2. **SQL Editor → New query →** paste [`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql) → **Run.**
   This creates the `profiles`, `listings`, `claims`, `events` tables, the
   `listing-images` storage bucket, all RLS policies, and the new-user /
   claim-status triggers.
3. **Auth → Providers:** enable **Email** (and **Google** when ready — Apple later).
   For fastest testing, disable "Confirm email" under Auth → Settings.
4. **Project Settings → API:** copy the **Project URL** and the **anon public**
   key into `expo/.env`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-public-key>
   ```
5. Restart Expo (`npx expo start -c`). Sign up, post a listing, and the loop persists.

See [`supabase/README.md`](./supabase/README.md) for details and the optional
push-notification Edge Function.

## Scripts

| Command | What |
|---|---|
| `npm start` | Expo dev server |
| `npm run ios` / `android` / `web` | Launch on a platform |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `expo lint` |
| `npx expo export --platform all` | Production JS bundle (build verification) |

## V1 scope (locked)

**In:** sign up · create listing + photos (max 5) · browse nearby (radius
filter: Near Me / 5 / 10 / 25 / 50 mi) · claim · owner approve/decline · 7-day
auto-expiry · trust signals (Member Since, Posts Shared, Claims Completed) ·
push notifications.

**V1.1 — Wanted posts:** alongside "I have extra" (offer), neighbors can post
"I'm looking for" (wanted). Same feed, filter **All / Available / Wanted**.
Tapping **I Have This** on a Wanted post creates a normal Offer linked back via
`fulfilled_by_listing_id`; the wanted owner then claims that offer through the
existing claim→approve flow. A new offer fires category+radius matching that
notifies relevant wanted owners (one-way). Wanted posts expire after 30 days.
Schema lives in `supabase/migrations/0003_wanted_posts.sql`.

**V1.2 — Claim-scoped pickup chat:** once a claim is **approved**, the listing
owner and that claimant get a **Message** button opening a private thread tied to
the claim (`claim_id` is the thread — not global DMs). Writable while approved,
**read-only** once the pickup is completed; pending/declined/cancelled show no
chat. Each message pushes the other party. Safety: a "Report conversation"
action, a fixed "pickup details only" guidance line, 500-char limit, and rate
limits (client 1/2s, server 30/claim/hour). RLS restricts read+write to the two
parties only. Schema: `supabase/migrations/0004_pickup_chat.sql`.

**Categories (hard-coded):** Vegetables, Fruit, Herbs, Eggs, Seeds, Plants,
Flowers, Compost, Honey, Farm Fresh, Other.

**Explicitly NOT in V1:** checkout, Stripe, marketplace, seller plans, AI
assistant, taxes, messaging, delivery, auctions, payments, admin portal.

The schema also carries **future-proofing** columns that are *not* surfaced in
V1 (account `user_type`, capability flags `can_post`/`can_claim`/`can_sponsor`/
`can_create_promotions`, business fields, territory geography, and an `events`
analytics table). Future features gate off **capability flags**, never off
`user_type`.
