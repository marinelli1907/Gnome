# Complimentary Subscriptions

`admin_plan_grants` is an INDEPENDENT entitlement source: never a
`PATCH plan=...`, never fake Stripe. Grants and Stripe do not touch each
other's lifecycles.

Resolution (`market_effective_plan`): sponsor base plan wins outright; else
the highest of {base Stripe plan, best ACTIVE unexpired grant}. Expiry is
computed from timestamps at read time (no cron). Sources reported as
free / stripe / complimentary / sponsor.

Proven behaviors: Neighbor+Grower comp → grower (comp) → expiry → Neighbor.
Paid Grower + Farm comp → farm (comp); revoke → paid grower (stripe), the
Stripe column untouched. Pickup locations over a fallen cap go
plan_restricted (reconcile), never deleted.

RPCs (audited, permission-gated): `admin_grant_plan(market, plan, expires,
reason, note)` (reason required — e.g. "Founding Grower"; a program label,
not a plan), `admin_modify_grant`, `admin_revoke_grant`. Audit rows carry
old/new effective plan.
