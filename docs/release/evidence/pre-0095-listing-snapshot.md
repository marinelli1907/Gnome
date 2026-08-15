# Pre-0095 listing snapshot — 2026-08-13

Baseline captured immediately before migration `0095_prohibited_content` was
applied, so any change to an existing listing could be attributed.

**Correction on method:** this was first captured as a PERMANENT table,
`public._pre0095_snapshot`. That was itself an undocumented change to
production. The data is preserved here and the table was dropped after
verification. Snapshots belong in the repo, not in the production schema.

## Composition — 28 listings

| | |
|---|---|
| Demo fixtures (`is_demo = true`) | **27** |
| Real user listings | **1** — "Basil", a `wanted` post by `3e64f6d5` (Daniel) |
| Status spread | `active`, `claimed`, `expired` |
| **In backfill scope** (active + offer + not demo) | **0** |

## The two egg listings

Both belong to `d0000002`, a demo fixture, and both are `expired`:

| Title | Owner | Kind | Status | State | Taxonomy |
|---|---|---|---|---|---|
| Fresh eggs 🥚 | d0000002 (demo) | offer | expired | OH | preserves-and-pantry |
| Pasture-raised eggs | d0000002 (demo) | offer | expired | NULL | eggs |

They are outside the backfill scope twice over — demo content, and not active.
No compliance clearance was granted to a fake seller.

`public_listings` already filters `is_demo`, so demo content never appears in
production marketplace results.
