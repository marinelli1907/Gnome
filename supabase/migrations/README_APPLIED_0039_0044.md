# Migrations 0039–0044 (taxonomy + compliance)

These were applied to production (project `fgybyghwcjlstqxkclch`) via the
Supabase migration API on 2026-08-10 and are recorded in the database's own
migration history under these names:

| File / DB name | What it does |
|---|---|
| `0039_marketplace_taxonomy.sql` (`marketplace_taxonomy`) | `marketplace_taxonomy_nodes` adjacency table, RLS, `listings.taxonomy_node_id`, in-use delete guard, archive cascade |
| `0040_marketplace_taxonomy_seed.sql` (`marketplace_taxonomy_seed`) | Seeds 308 nodes (15 categories → 150 subcategories → 143 product types) |
| `0041_taxonomy_synonyms_and_backfill.sql` (`taxonomy_synonyms_and_backfill`) | Search aliases + `legacy_category_map` + backfill of existing listings |
| `0042_compliance_core.sql` (`compliance_core`) | `compliance_rules`, `seller_credentials`, `credential_taxonomy_scope`, RLS |
| `0043_compliance_storage_and_gate.sql` (`compliance_storage_and_gate`) | Private `compliance-docs` bucket + policies, `effective_compliance_rule`, `user_has_paid_plan`, `can_publish_in_node` |
| `0044_compliance_trigger_automation.sql` (`compliance_publish_trigger_and_automation`) | `listings_compliance_gate` trigger, `compliance_run_expiry`, `compliance_reactivate_for_seller` |
| `0045_listing_status_paused.sql` (`listing_status_paused`) | Adds `paused` to `listing_status` (own migration — a new enum label cannot be used in the transaction that adds it) |

The `.sql` files in this directory are the authoritative source going forward.
`docs/compliance/design-notes/compliance-schema-design-proposal.sql` is an
alternative design that was **never applied** — kept for reference only. Do not
run it; it collides with the applied schema.
