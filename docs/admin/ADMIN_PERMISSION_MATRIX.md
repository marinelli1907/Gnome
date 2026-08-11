# Admin Permission Matrix

Authorization = granular permissions, resolved server-side:
`effective = admin_role_permissions(role) ∪ extra_permissions − denied_permissions`
`'*'` = wildcard (OWNER, SUPER_ADMIN). Check: `admin_has_perm('ns.perm')`.

Namespaces: users.*, markets.*, listings.*, orders.*, pickups.*, delivery.*,
compliance.*, inventory.*, seed_drop.*, plots.*, finance.*, support.*,
marketing.*, taxonomy.*, subscriptions.*, admins.*, ai.*, system.* —
full list in `admin_role_permissions()` (0075).

Role presets (defaults, overridable per member):
OWNER/SUPER_ADMIN `*` · OPERATIONS_ADMIN (ops+moderation, NO compliance
approval, NO admin team, NO comp grants) · COMPLIANCE_ADMIN (compliance.*
incl. documents; no finance/admins) · INVENTORY_FULFILLMENT ·
SUPPORT_MODERATOR (no permits/finance/grants) · ACCOUNTING_FINANCE (no permit
docs) · MARKETING_GROWTH · READ_ONLY (view-only everywhere it may look).

Owner-protected (OWNER/SUPER_ADMIN only): creating/modifying/revoking
OWNER/SUPER_ADMIN members, sponsor comp grants, AI automation level 3,
risk-3 AI approvals.
