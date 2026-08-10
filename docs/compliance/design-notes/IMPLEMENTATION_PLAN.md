# Implementation plan (research output, for reference)
 — CONSOLIDATED IMPLEMENTATION PLAN

## 0. Reconciliation decisions (conflicts between design agents, resolved)

| # | Conflict | Resolution |
|---|---|---|
| R1 | **Both taxonomy and compliance agents numbered their migration `0038`.** On disk only `0038_compliance_credentials.sql` exists (written this session). | **Taxonomy lands first.** Renumber: `0038_taxonomy.sql` (new) → `0039_compliance_credentials.sql` (rename the existing on-disk file) → `0040_profile_zip_privacy.sql`. **⚠️ DECISION GATE:** confirm `0038_compliance_credentials.sql` has **not been applied to the live Supabase DB** before renumbering. If it *has* been applied, keep it at 0038 and land taxonomy as 0039 with an ALTER path instead (see R2). Migrations `0018–0037` on disk are unchanged; note there is no `0029` (gap already exists). |
| R2 | **Two different taxonomy table names:** taxonomy agent → `marketplace_taxonomy_nodes` (rich); compliance agent → placeholder `taxonomy_nodes` (id+parent_id). | **Adopt `marketplace_taxonomy_nodes` as the single table.** Delete the placeholder-create from the compliance migration; it references `marketplace_taxonomy_nodes` instead. |
| R3 | **`listings.taxonomy_node_id` added by both.** | Added **once** by the taxonomy migration (`on delete restrict`). Compliance migration must **not** re-add (guard with `if not exists` regardless). |
| R4 | **Redundant compliance policy:** taxonomy node columns (`requires_compliance_review`, `compliance_classification`, `minimum_plan_tier`, `local_pickup_only`, `prohibited`, `required_listing_fields`) **vs** compliance agent's separate `compliance_rules` table (most-restrictive-wins). | **Drop the separate `compliance_rules` table.** The node columns are the single source of per-node policy. The gate function (`compliance_publish_reason`) walks ancestors over those columns with most-restrictive-wins. This is the "best single design" — one place to declare policy, no drift. |
| R5 | **Credential column name:** app-surface → `owner_id`; compliance → `seller_id`; app-surface `kind` enum vs compliance richer model. | **Canonical: `seller_credentials.seller_id`** (compliance agent). Keep a `kind` text column (values align to `compliance_classification`) so the app's `complianceFor(nodeId)` maps cleanly. App code must use `seller_id`, not `owner_id`. |
| R6 | **Classification vocabulary drift** across research (`cottage_food`, `credential_required_regulated`, `REGULATED_LICENSE_REQUIRED`, `movement_restricted_pickup_default`, …). | **Canonical `compliance_classification` = the 5-value status** (`generally_unrestricted`, `conditional`, `regulated`, `review_required`, `prohibited`). Enforcement mechanics are **separate boolean/enum columns** (`requires_credential`, `requires_attestation`, `minimum_plan_tier`, `local_pickup_only`, `ohio_only`, `prohibited`). Research's granular strings become **seed values of `required_listing_fields` + the mechanic columns**, not the classification. |
| R7 | **`listing_status` needs `'draft'`** (compliance agent) so "save without publishing" works; publish gate only blocks transition *into* `active`. | Adopt. `alter type listing_status add value 'draft'` in the compliance migration (safe inside Supabase's txn since the value isn't used mid-migration). |
| R8 | Storage bucket name: compliance agent `compliance-docs`; app-surface `seller-credentials`. | **Adopt `compliance-docs`** (compliance agent's private-bucket design is more complete: forced non-public, admin-only delete, signed-URL-only reads). App code uploads to `compliance-docs/<seller_id>/<credential_id>/<file>`. |

Everything below reflects these resolutions.

---

## 1. Final taxonomy schema + seed (migration `0038_taxonomy.sql`)

Use the **taxonomy-schema agent's design verbatim** (`marketplace_taxonomy_nodes`, `taxonomy_node_kind` enum, `taxonomy_validate()` trigger deriving depth+kind, `taxonomy_id_by_path()`, unique slug indexes, GIN synonym index, RLS: public reads active/non-archived, `is_admin()` writes) with these confirmations:

- **Node policy columns are canonical (R4/R6):** `requires_compliance_review bool`, `compliance_classification text` (constrained to the 5 statuses — add a `check` per R6), `minimum_plan_tier market_plan`, `local_pickup_only bool`, `shipping_policy text check in ('allowed','local_only','prohibited')`, `prohibited bool`, `required_listing_fields jsonb`, `applicable_jurisdictions text[]`. **Add** `requires_credential bool default false`, `requires_attestation bool default false`, `ohio_only bool default false` (folds in R6's enforcement axis; `ohio_only` distinguishes cottage-food Ohio-only from live-bait local-pickup-only).
- **Add the 5-value check:** `check (compliance_classification is null or compliance_classification in ('generally_unrestricted','conditional','regulated','review_required','prohibited'))`.
- **`listings.taxonomy_node_id`** added here, `uuid references marketplace_taxonomy_nodes(id) on delete restrict`, nullable, indexed. `listings.category` (text, NOT NULL) untouched (rollback-safe).
- **Seed:** the taxonomy agent's full `_tax_seed` temp-table + idempotent insert loop, extended so the branch-level `UPDATE`s also set `compliance_classification` (5-value), `requires_credential`, `requires_attestation`, `ohio_only`, and `minimum_plan_tier` per Deliverable-1 Matrix A. Concretely, add/adjust these branch updates:
  - `meat%` → classification `regulated`, `requires_credential`, `local_pickup_only`, `minimum_plan_tier='grower'`, `shipping_policy='prohibited'`; `meat/*/shares` and `meat/rabbit` → `review_required`; `meat/poultry%` → `conditional`; `meat` has no wild-game node (venison stays out — if added later, `prohibited=true`).
  - `farm-fresh%` → `review_required`, `requires_credential`, `local_pickup_only`, `minimum_plan_tier='grower'`; `farm-fresh/milk/raw-milk` → `prohibited=true`.
  - `baked-goods%` → `conditional`, `requires_attestation`, `ohio_only`; **split** `baked-goods/pastries` filled variants and PHF pies to `regulated`+`requires_credential` (Home Bakery) — seed a `baked-goods/pies/cream-custard` and `baked-goods/pastries/filled` product type.
  - `preserves-pantry%` → `conditional`, `requires_attestation`, `ohio_only`; route `salsa`/`pickles` to a `regulated`+`requires_credential` acidified sub-node.
  - `honey-syrups/honey/infused-honey` → `conditional`, `ohio_only`; `honey-syrups/*` others → `generally_unrestricted`, `requires_attestation`; add `honey-syrups/other-syrups` (non-maple/sorghum/apple) → `regulated`+`requires_credential`+`minimum_plan_tier='grower'`.
  - `eggs/chicken` → `conditional`, `requires_attestation`, `local_pickup_only`; `eggs/duck|quail|goose` → `review_required`.
  - `seeds%` → `regulated`/`conditional`, `requires_attestation` (credential for self-labeled); add native-seed screen flag.
  - `plants/trees-shrubs%`, `plants/*perennials` → `regulated`, `requires_credential`, `minimum_plan_tier='grower'`, `local_pickup_only`; `plants/vegetable-starts%`, `plants/*annuals` → `review_required` (annual-starts open question).
  - `fishing-bait/live-bait/minnows` and any crayfish/hellgrammite nodes → `regulated`, `requires_credential`, `local_pickup_only`, `minimum_plan_tier='grower'`; add `prohibited_species` note for red swamp crayfish; `nightcrawlers/red-worms/crickets/wax-worms` → `generally_unrestricted`; add `fishing-bait/live-bait/leeches` + `fishing-bait/preserved-bait` → `review_required`.
  - `wood/firewood%` → `conditional`, `requires_attestation`, `local_pickup_only`, **`minimum_plan_tier=NULL`** (never paywalled).
  - `pet/%food|%feed|%treats`, `pet/*/dog-chews` (edible) → `regulated`, `requires_credential`, `minimum_plan_tier='grower'`; `pet/*/mealworms`, feeder insects → `generally_unrestricted`; live feeder rodents/birds/rabbits → `conditional`+`local_pickup_only`; native reptiles (if added) → `review_required`.
  - `garden-goods/compost-soil%` → `conditional`, `requires_attestation`; add a `garden-goods/fertilizer` node → `regulated`+`requires_credential` (guaranteed-analysis lane); `garden-goods/supplies-tools%`, `garden-goods/decor%`, `flowers/cut-flowers%`, `flowers/dried-flowers%`, `wood/mulch-chips` (processed) → `generally_unrestricted`.
- **Run order inside 0038:** create table + enum + trigger + `taxonomy_id_by_path` + RLS → alter listings → seed (temp table + branch UPDATEs + insert loop) → backfill (map the 16 flat `category` ids by slug-path; `other` stays NULL). Backfill is the taxonomy agent's Section 3 CTE.

**Reparenting caveat (carried forward):** the cycle guard blocks moving a node under its own descendant but does not recompute descendant `depth` on a subtree move. Restrict admin reparenting to same-depth parents, or add a recursive depth recompute — follow-up, not needed for seed/backfill.

---

## 2. Compliance schema + RLS + storage + gate + trigger + automation (migration `0039_compliance_credentials.sql` — the renamed on-disk file, edited)

Keep the compliance-schema agent's design **except** the R2/R3/R4 edits:

**Tables**
- `seller_credentials` (canonical): `id uuid pk`, `seller_id uuid not null` (pinned to `auth.uid()` by trigger), `kind text` (aligns to `compliance_classification`/regulator, e.g. `home_bakery`, `nursery_dealer`, `commercial_feed`, `bait_dealer`, `food_processing`, `retail_food`, `egg_registration`, `seed_labeler`), `status` enum (`pending|approved|denied|revoked|renewal_required|expired`), `file_path text` (in `compliance-docs`), `credential_number text`, `issued_at`, `expires_at`, `reviewed_by`, `reviewed_at`, `denial_reason`, `admin_notes`, timestamps.
- `credential_taxonomy_scope` (category-scoped approval): `credential_id → seller_credentials`, `node_id → marketplace_taxonomy_nodes`. An APPROVED credential authorizes a node only if a scope row matches that node **or an ancestor** (approving beans never unlocks raw milk).
- **DROP** the separate `compliance_rules` table (R4) and **DROP** the placeholder `taxonomy_nodes` create (R2).

**Gate (reads node columns + ancestor walk; most-restrictive-wins)**
- `public.compliance_publish_reason(p_node_id uuid, p_market_id uuid default null) returns text` — SECURITY DEFINER, `search_path=public`. Walks `p_node_id` + ancestors via a recursive CTE over `marketplace_taxonomy_nodes`. Aggregates: highest classification rank, any `prohibited`, highest `minimum_plan_tier`, any `requires_credential`, any `local_pickup_only`/`ohio_only`. Returns `'OK'` or a code: `PROHIBITED`, `NOT_AUTHENTICATED`, `PLAN_TOO_LOW`, `PAID_PLAN_REQUIRED`, `CREDENTIAL_REQUIRED`, `REVIEW_REQUIRED`. Plan derives from `markets.plan` (the caller's `p_market_id`, else strongest owned market); "paid" = `grower`+. `CREDENTIAL_REQUIRED` clears only when the caller has an APPROVED, non-expired `seller_credentials` row whose `credential_taxonomy_scope` covers the node or an ancestor.
- `public.can_publish_in_node(p_node_id, p_market_id) returns boolean` — thin `= 'OK'` wrapper. Both `revoke execute from anon; grant to authenticated`.

**Enforcement triggers**
- `listings_compliance_guard()` BEFORE INSERT/UPDATE on `listings`: passes freely unless `NEW.status='active'` on a real (re)publish; `is_admin()` bypasses for remediation; drafts always allowed; else `raise` with the reason code from `compliance_publish_reason(NEW.taxonomy_node_id, NEW.market_id)`.
- `seller_credentials_guard()` BEFORE INSERT/UPDATE: only `is_admin()` may move a credential into `approved|denied|revoked` or write `reviewed_by/reviewed_at/denial_reason/admin_notes`; pins `seller_id = auth.uid()` on insert. (RLS handles ownership/visibility; trigger handles column-level transition authority.)

**RLS**
- `seller_credentials`: owner selects/inserts own; owner cannot self-approve (trigger); admin selects/updates all (`is_admin()`), pattern from `0024`.
- `credential_taxonomy_scope`: readable by owner of the parent credential + admin; writable by admin.

**Private storage**
- Bucket `compliance-docs` — `public=false` (forced on conflict), 15 MB limit, mimes `image/jpeg,png,webp,heic,application/pdf`. Path `<seller_id>/<credential_id>/<file>`. Policies key on `(storage.foldername(name))[1] = auth.uid()::text`: SELECT = owner or `is_admin()`; INSERT/UPDATE = owner within own folder; DELETE = **admin only** (audit evidence). No anon/public policy → signed URLs are the only read path.

**Automation (pg_cron, like `0018`)**
- `compliance_expire_sweep()` scheduled hourly (`gnome-compliance-sweep`): APPROVED→`renewal_required` within 30 days of expiry; APPROVED/`renewal_required`→`expired` past expiry; **pause** active regulated listings the owner can no longer back (`status→'draft'`, stamp `compliance_paused_at`/`compliance_pause_reason`); **auto-re-activate** those exact rows once a valid APPROVED credential + paid plan return, no forced re-review. Sweep re-implements the credential check inline keyed on `l.owner_id` (cron has no JWT).

**Migration hygiene:** `alter type listing_status add value 'draft'` (R7). Guarded enum creation; `execute` revoked from `anon`; `is_admin()` re-checked inside definer code (matches 0024/0031/0032).

---

## 3. Profile ZIP privacy (migration `0040_profile_zip_privacy.sql`)

App-surface agent's Area-G design, unchanged except numbering:
- `REVOKE SELECT (zip_code) ON public.profiles FROM anon, authenticated;`
- `public.my_profile() RETURNS profiles LANGUAGE sql SECURITY DEFINER` → `select * from public.profiles where id = auth.uid()`; `grant execute to authenticated`.
- Optional `public_profile(uuid)` / view exposing only `id,name,avatar_url,city,state,created_at`.

---

## 4. Ordered file-by-file task list (mobile + web)

Do backend migrations (0038→0039→0040) first; they are prerequisites for everything below.

### Phase 1 — shared taxonomy source of truth
1. **`expo/constants/categories.ts`** (rewrite, additive): keep existing `CATEGORIES`/`categoryFor`; add `TaxNode` type, `TAXONOMY` tree, and helpers `flattenTaxonomy()`, `taxPath(id)`, `complianceFor(id)` (nearest-ancestor compliance), `childrenOf(id|null)`, `subtreeLeafIds(id)`, plus `SEARCH_ALIASES` + `resolveSearch(term)`. `complianceFor` returns the 5-value classification + mechanic flags mirrored from the node seed.
2. **`web/lib/categories.ts`** — byte-for-byte mirror of #1 (its header mandates lock-step).

### Phase 2 — browse taxonomy drilldown + filters + search
3. **`expo/lib/db.ts`** — extend `BrowseFilters` (`search`, `categoryPath`, `minPrice`, `maxPrice`, `availability`, `followingOnly`, `verifiedOnly`, `sort`); rework `useListings` (subtree `.in('category', subtreeLeafIds(...))`, search via `resolveSearch` + `.or(title/description ilike)`, price via `price_cents`, availability via `inventory_count`, verified via `market:markets(verified)` in `LISTING_SELECT`, sort switch); apply the same to `useFeaturedListings`. **Dependency flag:** "Following" filter needs a `market_follows`/`user_follows` table — defer or add a migration; do not block the rest.
4. **`expo/app/(tabs)/index.tsx`** — replace the flat category chip row with a drilldown (`childrenOf` chips + `taxPath` breadcrumb), add search `TextInput`, sort segmented control, and a "More filters" sheet (price/availability/following/verified). Reuse existing `chip`/`chipActive` styles.

### Phase 3 — seller compliance flow (create)
5. **`expo/lib/db.ts`** — add `useMyCredentials(uid)`, `useUploadCredential(uid)` (upload to `compliance-docs/<uid>/…` then insert `seller_credentials` `status:'pending'`, `seller_id` = uid), and extend `useCreateListing` with a `status` param (`'draft'` supported) + a client-side guard mirroring the DB gate (`complianceFor(category)` + plan + valid credential → throw typed `COMPLIANCE_REQUIRED`/`COMPLIANCE_UPGRADE`). Use `seller_id` (R5).
6. **`expo/app/(tabs)/post.tsx`** — compute `complianceFor(category)` on category change; read `useMyMarket` (plan) + `useMyCredentials`; branch: free user → upgrade CTA (`/upgrade`); paid-no-credential → "Upload Credential" (`/credential?kind=…`) + allow "Save as draft"; paid-with-credential → normal publish; add a compliance note line.
7. **`expo/app/credential.tsx`** (new) — params `kind`; file/photo picker (reuse `expo/lib/images.ts` `pickImages`), preview, submit → `useUploadCredential`; show existing-row status (pending/denied/resubmit + `denial_reason`).
8. **`expo/app/_layout.tsx`** — register `credential.tsx` (and `profile/edit.tsx`) in the Stack (modal, after line 107).

### Phase 4 — admin Compliance Center (web)
9. **`web/app/admin/AdminClient.tsx`** — extend `Tab` with `'compliance'`; add a queue segmented control (pending/approved/denied/expiring); load `seller_credentials` with `owner:profiles` join; actions `approveCredential`/`denyCredential`/`revokeCredential`/`requestResubmission` (each writes an `admin_actions` audit row via existing `audit()`); signed-URL fetch (`compliance-docs`.createSignedUrl(path,60)) to view the doc. Reuse `.mm-row`/`.mm-btns`/note-input patterns. (Admin RLS + audit reuse land in migration 0039.)

### Phase 5 — auth deep link, legal links, profile editor, ZIP fix
10. **`expo/providers/AuthProvider.tsx`** — add the `expo-linking` listener in the auth effect: on `gnome://auth-callback?code=…` call `supabase.auth.exchangeCodeForSession(code)` and set `recoveryMode` only for recovery-type links; guard so the Google OAuth callback (which consumes its own code via `openAuthSessionAsync`) is not double-handled. This closes the only gap in the already-built password-reset flow.
11. **`expo/app/sign-in.tsx`** — add Terms/Privacy footer (`${WEB_BASE}/terms`, `/privacy`) shown in signup/sign-in modes; import `Linking`.
12. **`expo/app/settings.tsx`** — add a "Legal" section linking `/terms` and `/privacy`; import `Linking`.
13. **`expo/app/profile/edit.tsx`** (new) — port web `AccountView`: name, avatar (reuse image upload), city, state (default OH), zip (5-digit + privacy note), read-only hardiness-zone chip (new `expo/lib/hardiness.ts` ZIP→zone map or a `zone_for_zip` RPC). Load via `my_profile()` RPC (ZIP readable post-revoke).
14. **`expo/lib/db.ts`** — widen `useUpdateProfile` to `{name?,city?,state?,zip_code?,avatar_url?}`; add `useMyFullProfile(uid)` calling `.rpc('my_profile')`.
15. **`expo/app/(tabs)/profile.tsx`** — add "Edit profile" link → `/profile/edit`; read owner ZIP via `useMyFullProfile`.
16. **`web/app/login/LoginClient.tsx`** — line 27: replace the `select('...,zip_code,...')` with `.rpc('my_profile')` for the owner's ZIP (save path via UPDATE is unaffected). This query would otherwise error `42501` after the column revoke.
17. **Harden cross-user profile embeds** (won't error, but silently drop ZIP — make intentional): `expo/lib/db.ts` `LISTING_SELECT`, `useMyClaims`, `useFeaturedListings`, `useClaimThread`, `useIncomingClaims` — replace `profiles(*)`/`claimer:profiles(*)` with explicit safe column lists (`id,name,avatar_url,city,state,created_at`), using the existing `useMyBlocks` safe-list as the template. Update `expo/types/index.ts` `Profile` so cross-user shape no longer implies `zip_code`.

---

## 5. Items that CANNOT be completed without a physical device or the user's OAuth/Apple credentials — flagged

- **Password-reset deep link end-to-end verification (task 10):** the code change is doable, but confirming that tapping the `gnome://auth-callback` email link opens the app and enters recovery mode **requires a physical device / simulator with the built app** and a real reset email. Cannot be verified headlessly here.
- **Supabase dashboard redirect-URL config:** adding `gnome://auth-callback` to the allowed Redirect URLs is a **dashboard action (user's Supabase credentials)**, not code.
- **Google / Apple auth providers (app):** enabling Google/Apple sign-in requires the **user's OAuth client IDs / Apple Developer credentials** and dashboard/native config — out of scope for code alone.
- **EAS build + on-device plot/compliance UI pass:** producing an installable build and walking the new Sell/credential/profile screens needs **EAS credentials and a device/simulator**.
- **First live Stripe checkout / paid-plan gate verification:** confirming the `minimum_plan_tier` gate against a *real* paid market requires a **live Stripe checkout** (user's payment/Stripe config) — the gate logic is testable with a seeded paid market, but the real-money path is not.
- **Applying migrations to the live (auto-pausing) Supabase project** and running the seed/backfill: requires the **user's Supabase project access**; also confirm R1 (whether `0038_compliance_credentials.sql` was already applied) before renumbering.
- **`admins` membership** for exercising the Admin Compliance Center: requires an **admin row for the tester's account** (user action).

---

## 6. Suggested commit sequence

1. `0038_taxonomy.sql` (table + trigger + RLS + listings FK + seed + backfill).
2. Rename/rewrite `0038_compliance_credentials.sql` → `0039_compliance_credentials.sql` (drop placeholder taxonomy + `compliance_rules`; point gate at `marketplace_taxonomy_nodes` node columns; `seller_id`; `compliance-docs` bucket; cron).
3. `0040_profile_zip_privacy.sql`.
4. Phase-1 shared `categories.ts` (both copies) — one commit, kept in lock-step.
5. Phases 2→5 as feature commits, each on the `claude/gnome-continuation-052a2b` branch (not `main`).

All migrations are additive and rollback-safe: `listings.category` (text) is never touched; `taxonomy_node_id` is nullable; ZIP revoke is reversible with a re-GRANT.

*End of Deliverable 2.*

---

Key flags for your attention, restated plainly: (1) confirm `supabase/migrations/0038_compliance_credentials.sql` has **not** been applied to the live DB before renumbering it to 0039 — it is on disk from this session; (2) the two design agents used different taxonomy table names, reconciled to `marketplace_taxonomy_nodes`; (3) all 26 LEGAL/AGENCY REVIEW items are preserved unresolved in Deliverable 1's register; (4) dairy has **no research cluster** yet — the taxonomy seed flags it and raw milk is hard-blocked, but full Ohio dairy research must be commissioned; (5) the device/OAuth/Stripe/Supabase-dashboard items in §5 of Deliverable 2 cannot be finished in this headless session.
