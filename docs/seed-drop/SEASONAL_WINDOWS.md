# Seasonal Windows — operations reference

`seed_season_windows` row anatomy:

| field | meaning |
|---|---|
| season_code / year | EARLY_SEASON, SPRING, SUMMER, FALL |
| zone_min–zone_max | USDA zones the row covers (split rows per zone band as ops mature) |
| window_start | earliest date the season is "on" for marketing/eligibility |
| join_cutoff | subscribe ON/BEFORE this date → this season; after → next season |
| generation_date | admin generates the wave (orders + inventory reservations) |
| ship_start–ship_end | target shipping window |

Rules enforced by checks: cutoff ≥ start, generation ≥ cutoff, ship_end ≥
ship_start, one row per (season, year, zone band). RLS: world-readable,
service/owner-managed only (clients cannot touch rows — live-tested).

Admin → More → **Seed Drop Seasons** shows each window with cutoff/generate/
ship dates, wave preview (eligible subscribers, expected packet range
0.75×–1.10× of target counts, current sellable stock, SHORT/OK flag), and the
generate button (`seed_drop.generate` permission). 2026-27 baseline rows are
in place; edit dates with SQL/owner tooling as real logistics firm up.
