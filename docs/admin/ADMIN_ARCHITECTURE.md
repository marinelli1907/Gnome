# Gnome Admin — Architecture

Two products, one backend:
- **Gnome** (`expo/`, bundle `app.boonesystems.gnome`) — consumers.
- **Gnome Admin** (`admin/`, bundle `app.boonesystems.gnome.admin`) — internal
  operating app. Separate Expo project; shares Supabase project, auth
  identities, and the REST/RPC surface. No service keys in any client.

Auth flow: Supabase sign-in → `admin_me()` membership lookup → active row
required. Non-members see "You don't have access to Gnome Admin" and no
privileged data loads (everything below is server-checked; route hiding is
cosmetic only). Revocation (`admin_users.status`) takes effect on the next
backend call — `is_admin()` and `admin_has_perm()` read live membership.

Tables: `admin_users` (membership, role, permission overrides),
`admin_audit_log` (append-only; no client write grants, admins cannot edit),
`admin_plan_grants`, `ai_*` (see docs/ai/). All privileged mutations are
SECURITY DEFINER RPCs that check `admin_has_perm()` and write audit rows.

MFA/Face ID: NOT yet wired. The architecture point for it is the Gnome Admin
sign-in + a re-auth check before owner-level RPCs; until then owner-risk
operations rely on role gating + strong confirm dialogs. (Honest gap.)
