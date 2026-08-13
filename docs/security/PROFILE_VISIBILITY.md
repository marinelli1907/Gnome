# Profile visibility — column classification and the 0087 change

**Status: migration 0087 is written and tested but NOT applied to production.**
Apply only with owner approval. Rollback:
`supabase/migrations/0087_down_profiles_public_projection.sql`.

## The problem

`0001_init.sql` shipped `profiles_select_all ... USING (true)`. Every row of
`profiles` is readable by every signed-in user *and* by anonymous visitors.
Column-level grants narrow *which* columns, but the blanket row policy means
anything granted is effectively public, and one broad
`grant select on public.profiles` in a future migration would silently make
every new column public too.

## Column classification (production, before 0087)

| Column | Class | Readable by others today? |
|---|---|---|
| `id` | Public (required) | yes — it is the join key for listings/claims |
| `name` | Public | yes — the derived "First L." display name |
| `avatar_url` | Public | yes |
| `city`, `county`, `state` | Public (coarse location) | yes — powers nearby search |
| `user_type` | Public | yes |
| `business_account`, `business_category` | Public | yes — a storefront signal |
| `created_at` | Public | yes — "member since" |
| `can_post`, `can_claim`, `can_sponsor`, `can_create_promotions`, `can_offer_delivery` | **Administrative (entitlement)** | **yes — the real leak** |
| `suspended` | **Administrative (moderation)** | **yes — the real leak** |
| `zip_code` | Owner-only | no — SELECT revoked in 0058 |
| `onboarding_completed_at` | Internal | no — never granted |

Everything on the "must not leak" list that people usually worry about is
already **not in this table**: email and full name live in `auth.users` /
`user_private_contact`, phone in `user_private_contact`, exact coordinates on
`listings` (revoked), Stripe ids on `market_subscriptions`, push tokens in their
own table. `id` is a Supabase auth uuid and is public by necessity — it is the
foreign key every listing and claim joins on — but it is not a credential.

So the concrete exposure was the **six administrative flags**, plus the
structural risk that any future column becomes public by default.

## What 0087 does

1. **Rows** — `profiles_select_all` is dropped. Replaced by
   `profiles_select_own` (`auth.uid() = id`) and `profiles_select_admin`
   (`is_admin()`). A non-admin now reads **zero rows** for anybody else.
2. **Columns for others** — a new `public_profiles` view enumerates the ten
   public columns explicitly. `select *` is deliberately not used, so a column
   added to `profiles` tomorrow is invisible until someone edits the view.
3. **Anonymous hardening** — the six administrative columns and
   `onboarding_completed_at` lose their `anon` SELECT grant outright.

### Why the flags are still granted to `authenticated`

Column grants are **role-wide, not row-scoped**, and Gnome's admins authenticate
as `authenticated` like everyone else. Revoking `suspended` from `authenticated`
would break the moderation screens (`web/app/admin/AdminClient.tsx` reads
`id,name,suspended`; `admin/App.tsx` reads `suspended`, `user_type`). The row
policy is what confines them: a non-admin gets no rows for another user, so the
flags are unreachable regardless of the grant. Reading the flags on *your own*
row is harmless. `anon` is never an admin, so revoking there is free hardening —
two independent controls instead of one.

## Owner / admin / public read paths after 0087

| Who | Path | Sees |
|---|---|---|
| Owner | `profiles` directly, or `my_profile()` (SECURITY DEFINER) | their full row incl. `zip_code` and flags |
| Owner | `my_onboarding_state()` | their private contact details |
| Admin | `profiles` directly (`is_admin()` policy) | all rows, all granted columns |
| Another user | `public_profiles` | the ten public columns only |
| Anonymous | `public_profiles` | the ten public columns only |

## Tests

`supabase/tests/run_rls_tests.sh` — creates a throwaway local database, builds a
Supabase-shaped harness (anon/authenticated/service_role roles, `auth.uid()`
from the JWT claim), applies the real migration statements, and asserts:

- the pre-0087 blanket policy **did** expose other rows (baseline);
- owner reads own profile and own private contact;
- cross-user profile read → 0 rows; cross-user contact read → 0 rows;
- anonymous direct read → 0 rows, but the public projection still works;
- the projection returns exactly its ten-column allowlist;
- **a newly added `profiles` column does not appear in the projection** and is
  not readable by `anon`;
- contact data is unreachable through a join from the projection;
- a non-admin cannot read another user's `can_*`/`suspended`;
- an owner can still read their own capability flags;
- an admin can still read `id,name,suspended` (moderation regression guard).

## App changes that ship with this

- `expo/lib/db.ts` — one `PUBLIC_PROFILE_FIELDS` constant; every
  `owner:profiles(...)` / `claimer:profiles(...)` embed now reads
  `public_profiles`, and the administrative flags are gone from the payload.
- `expo/types/index.ts` — new `PublicProfile` type; `Listing.owner` and
  `Claim.claimer` use it, so the type system stops admin state reaching a public
  surface. `useMyProfile()` still returns the full `Profile`.
- `expo/scripts/e2e-loop.mjs` — reads capability defaults via `my_profile()`.
- Web and admin reads are self-reads or admin reads and are unchanged.

## ⚠️ The one thing to verify right after applying

PostgREST must resolve the embed `listings → public_profiles`. Views are
embeddable (PostgREST infers the relationship from the view's source FK), but
this has **not** been exercised against this project because the migration is
unapplied. Immediately after applying 0087, load Browse and one claim thread.

If an embed fails, in order of preference:
1. hint the column instead of the constraint —
   `claimer:public_profiles!claimer_id(...)`;
2. fall back to `profiles` for that one embed and rely on the row policy;
3. `0087_down_profiles_public_projection.sql` and re-plan.
