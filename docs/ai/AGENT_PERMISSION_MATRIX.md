# Agent Permission Matrix (initial)

Agent        | Status    | L | Tools
gnome_hq     | read_only | 1 | daily summary, business health, pickups/deliveries, compliance queue, low inventory, comps, security alerts, approval-request
operations   | read_only | 1 | daily summary, pickups/deliveries, market orders, approval-request
compliance   | read_only | 1 | compliance queue, credential context, approval-request
security     | read_only | 1 | security alerts, daily summary, approval-request
inventory/support/marketplace/finance/growth/marketing/plots/seeds
             | disabled  | 1 | scoped single-tool sets (configured, not enabled)

Tool names are data (`ai_agents.permissions`); execution paths for writes go
exclusively through the approval queue. Changing an agent to automation L3
requires OWNER/SUPER_ADMIN.
