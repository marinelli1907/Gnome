# 30 — Zordy Grow-Along: Crop Projects, Weather, and Seed-to-Sale

**Status: FUTURE RELEASE SPECIFICATION.** This capability is not included in
the current app-store release, does not open Seed Drop ordering, and does not
authorize fulfillment in any state. It must remain behind the existing Seed
Drop/compliance gates until its own implementation and release gates pass.

## Product promise

Each fulfilled Seed Drop gives the subscriber a private Zordy Grow-Along
workspace. Every variety in the Drop becomes its own **Crop Project** so Zordy
can help the customer grow that specific crop from packet to harvest without
mixing its schedule, photos, or advice with another crop.

When a crop is ready, Zordy can turn the Crop Project into a **draft** Gnome
listing. The customer must review and publish it through the normal marketplace
rules.

Suggested customer line:

> Grow it with Zordy. Sell it with Gnome.

## Entitlement boundary

Zordy Grow-Along is a Seed Drop care entitlement, not a seller-plan grant.

- Access is tied to the authenticated customer, the paid/fulfilled Seed Drop,
  and the varieties actually included in that order.
- It does not grant Pro or Farm, increase listing allowances, unlock Market QR
  tools, or provide unrelated seller-plan AI features.
- Deterministic schedules and reminders should not consume an AI message.
- Adaptive check-ins, photo review, and crop-specific chat may have a separate
  configurable allowance. The exact allowance is an owner pricing decision and
  must not be hard-coded into customer copy before approval.
- A completed season becomes read-only history. It must not disappear when the
  active care period ends.

## Commercial paths and customer segments

Seed Drop and seller plans are independent entitlements that can be packaged
together. The customer must have three clear paths:

1. **Marketplace only** — keep the current Free, Pro, or Farm plan and receive
   no seeds. Existing seller-plan prices and benefits do not change merely
   because Seed Drop exists.
2. **Seller + Seed Drop bundle** — subscribe to Pro or Farm and add the
   corresponding seasonal Drop at a bundled member price. The account receives
   both entitlements, but the physical Drop and digital seller plan retain
   separate billing/audit records.
3. **Seed Drop only** — subscribe to or order seeds without buying Pro or Farm.
   This customer receives order management and the scoped Grow-Along for those
   seeds, but no paid seller-plan benefits.

A Seed-only customer may keep their account private and must not be required to
create a public Market, publish a listing, or present themselves as a seller.
Their marketplace plan remains Free unless they independently upgrade.

The backend should derive, expose to authorized analytics/admin surfaces, and
measure at least these segments without duplicating entitlement truth:

- `FREE_ONLY`;
- `PRO_ONLY`;
- `FARM_ONLY`;
- `SEED_ONLY`;
- `PRO_SEED_BUNDLE`;
- `FARM_SEED_BUNDLE`.

`SEED_ONLY` is a first-class acquisition cohort, not an unclassified Free user.
Track its conversion through first Crop Project, first confirmed harvest, first
Market setup, first published harvest listing, and first Pro/Farm upgrade.

Conversion prompts must be contextual and optional. At harvest, Gnome may offer
to create a Market or explain how Pro/Farm helps a regular seller, but Seed-only
customers keep their Grow-Along and order history if they decline. No dark
patterns, reduced care, or forced seller setup.

Exact bundle and standalone Drop prices remain an owner decision until supplier,
postage, packaging, labor, payment-fee, AI, and weather-provider costs are
replaced with verified inputs. Customer-facing copy must show the true billing
cadence and cannot disguise per-Drop physical charges as a single app-store
subscription price.

## Experience hierarchy

### Seed Drop workspace

The workspace represents one seasonal Drop and contains:

- order and delivery status;
- a **Today with Zordy** summary across all active Crop Projects;
- weather notices relevant to the customer's active crops;
- upcoming tasks and overdue check-ins;
- links to each Crop Project;
- harvest and listing progress.

The Today view groups related work. A customer with eight varieties should not
receive eight near-identical notifications.

### Crop Project

Create one Crop Project per fulfilled `seed_order_item` / variety. The project
is grounded in the exact catalog product and supplier-labeled packet the
customer received.

Each project contains:

- crop and variety;
- packet and Drop provenance;
- planting environment and approximate location;
- planned or confirmed sowing date;
- current growth stage;
- deterministic care timeline;
- crop-specific Zordy conversation;
- check-ins, photos, notes, and completed tasks;
- weather adjustments and their source timestamps;
- estimated harvest window, when supported by approved catalog data;
- **List my harvest** action when the customer confirms readiness.

Conversation and media stay isolated by Crop Project. Advice or a photo from a
tomato project must never be silently reused as evidence for basil.

## Project states

The initial state machine is:

1. `NOT_STARTED` — packet received; no planting date selected.
2. `SAVE_FOR_LATER` — outside the suitable sowing window or intentionally held.
3. `READY_TO_SOW` — deterministic rules say the crop is in its planting window.
4. `SOWN` — customer confirms sowing.
5. `GERMINATED` — customer confirms emergence.
6. `THINNING` — optional stage when approved crop guidance calls for it.
7. `TRANSPLANT_READY` — optional stage for indoor starts/transplants.
8. `GROWING` — active care and observation.
9. `HARVEST_WINDOW` — supported maturity data and customer observations indicate
   harvest may be approaching.
10. `HARVESTED` — customer confirms a harvest.
11. `ARCHIVED` — care period closed; history remains readable.

`PAUSED` and `CROP_FAILED` are customer-confirmed terminal/holding states that
retain history and allow the customer to record what happened.

Zordy may recommend a transition, but only the customer can confirm a real-world
event such as sowing, germination, transplanting, crop loss, or harvest.

## Deterministic schedule first

The backend creates the baseline timeline from approved data, including:

- `seed_products.sow_months` and zone-adjusted sowing rules;
- `days_to_germination` and `days_to_maturity`, when present;
- sowing depth, spacing, sun, and container compatibility;
- the customer's location/zone, garden setup, and confirmed planting date;
- the actual shipped variety and approved guidance sources.

Zordy explains and personalizes that schedule. It does not invent missing seed
facts or convert a rough estimate into a promise. If maturity data is absent,
the experience says timing varies and asks the customer to watch for approved
crop-specific signs instead of generating a date.

Typical tasks include sowing, germination check, thinning, transplant review,
watering/scouting, issue check, and harvest review. Fertilizer or treatment
advice appears only when supported by approved guidance and never replaces a
label, local extension guidance, or professional diagnosis.

## Weather-aware care

Weather data comes from a selected weather provider, not from model memory or a
Zordy guess. The system stores or displays provider provenance and the forecast
timestamp and fails visibly when data is unavailable or stale.

The first supported triggers are:

- frost or near-freezing risk;
- extreme heat;
- heavy rain or prolonged wet conditions;
- strong wind;
- high humidity when it materially changes disease/scouting advice;
- a harvest-before-storm suggestion.

A deterministic crop/stage rule engine decides whether a forecast matters to a
specific Crop Project. Zordy turns that result into plain-language guidance and
may propose moving a task. Weather never silently changes a confirmed planting
date, completion record, or project stage.

Privacy requirements:

- ask for approximate growing location; a street address is not required;
- send the minimum location precision required for the forecast;
- do not expose an address or exact coordinates to another user;
- disclose the weather provider and retention behavior before activation;
- keep weather alerts opt-in, with quiet hours and a digest option;
- distinguish forecast guidance from emergency or guaranteed crop protection.

## Check-ins and Zordy actions

The customer can record:

- a photo;
- current stage;
- germination result or rough success rate;
- observed issues;
- task completion;
- free-form notes;
- harvest quantity and date.

Within a Crop Project, Zordy may:

- explain today's approved tasks;
- ask a short stage-specific check-in;
- interpret a weather rule already produced by the backend;
- compare current notes/photos with prior check-ins;
- suggest troubleshooting steps with uncertainty stated;
- suggest when to inspect for harvest readiness;
- draft harvest listing fields from confirmed project data.

Zordy must not claim certainty from a photo, prescribe unsafe chemical use,
guarantee yield, or mark a physical task complete on the customer's behalf.

## Harvest-to-listing handoff

After the customer confirms a harvest, **List my harvest** creates a marketplace
listing draft with only supported facts prefilled:

- crop and variety from the Crop Project;
- optional harvest date confirmed by the customer;
- eligible category/listing type;
- an editable description grounded in approved product and project data;
- customer-approved photos from that project.

The customer must supply or approve quantity, unit, price/trade/share choice,
pickup details, availability, description, and photos before publishing.

The handoff must preserve all existing marketplace controls:

- never auto-publish;
- never bypass the customer's listing allowance or seller-plan entitlement;
- run the normal restricted-item and compliance prompts;
- do not assert organic, pesticide-free, inspected, certified, or other claims
  unless the seller independently supplies permitted evidence;
- do not guarantee legality or food safety;
- keep the source Crop Project link private and use it only for customer history
  and aggregate product analytics.

## Future data model

No migration is authorized by this document. The implementation should prefer
additive tables and the existing private-data/RLS patterns:

| Structure | Purpose |
|---|---|
| `seed_grow_workspaces` | One private workspace per user + seasonal order/Drop. |
| `seed_crop_projects` | One project per fulfilled order item/variety, with current state and planting dates. |
| `seed_crop_events` | Append-only customer confirmations, check-ins, stage changes, and harvest events. |
| `seed_crop_tasks` | Deterministic scheduled tasks, completion, and reschedule history. |
| `seed_crop_weather_alerts` | Minimal provider/rule evidence for alerts; avoid retaining unnecessary raw location history. |
| `seed_crop_media` | Private project media with signed-URL access and owner-only RLS. |

Listing drafts may gain a nullable private `source_seed_crop_project_id`. The
foreign key must never make private order or location data publicly readable.

Ownership and access rules:

- customers can read and update only their own projects through constrained
  columns/RPCs;
- service jobs can write deterministic tasks and weather alerts only;
- Zordy can read the current project context and propose drafts, but cannot
  mutate compliance, seed-lot, order, payment, entitlement, or physical-event
  truth;
- admin support access is permission-gated and audited;
- media remains private unless the customer explicitly selects it for a public
  listing.

## Job and notification behavior

The scheduler must be idempotent. Re-running a daily task or weather job cannot
create duplicate tasks, alerts, or notifications.

Default notification behavior is event-based, not daily nagging:

- meaningful weather warning;
- a time-sensitive planting or transplant window;
- a requested check-in;
- harvest review becoming relevant.

An optional daily check-in can be offered, but must be off until the customer
chooses it. Push behavior must be proven on physical iOS and Android devices;
the emulator is not proof.

## Required screens on app and web

Both customer surfaces must support the same account and project state:

1. Seed Drop workspace / Today with Zordy.
2. Crop Project list.
3. Crop Project detail and timeline.
4. Check-in and private photo upload.
5. Weather alert detail with source/time.
6. Crop-specific Zordy conversation.
7. Harvest confirmation.
8. Harvest listing draft review and handoff to the normal publish flow.
9. Notification, location, and privacy controls.

The web and app can use platform-appropriate layouts, but neither may expose a
capability or entitlement that the other surface cannot honor server-side.

## Acceptance criteria

This feature is not release-ready until all of the following pass:

1. Every fulfilled order item creates exactly one idempotent Crop Project.
2. The project can use only the actual shipped variety and approved guidance.
3. Crop chat, tasks, photos, and memory do not leak into another project/user.
4. Real-world stage changes require customer confirmation.
5. Missing agronomy data produces honest uncertainty, not invented facts.
6. Weather alerts identify provider/time, handle stale data, and are relevant to
   the project's crop and stage.
7. Location precision, consent, retention, quiet hours, and alert preferences
   pass privacy tests.
8. The Seed Drop entitlement cannot grant Pro/Farm or increase allowances.
9. A harvested crop creates a draft only; publishing still runs allowance and
   restricted-item/compliance gates.
10. Replayed jobs and webhook/events do not duplicate projects, tasks, alerts,
    or listing drafts.
11. Project media is private until explicitly selected for a public listing.
12. Physical-device notification tests pass on iOS and Android.
13. AI usage and weather-provider cost remain within the approved unit economics.

## Explicit non-goals

- No automatic planting, watering, treatment, harvest, or listing publication.
- No yield, germination, weather, sale, or income guarantee.
- No delivery dispatch or multi-stand route optimization in this release.
- No universal unlimited Zordy subscription.
- No decision here bundles Pro/Farm with Seed Drop or changes seller-plan terms.
- No weather provider is selected by this document.
- No Seed Drop purchase path, live payment activation, migration, or current
  store-binary change is authorized.

## Release gates

Before implementation reaches customers, Daniel must separately approve:

1. Grow-Along pricing and included AI limits.
2. Weather provider, cost, privacy language, and location precision.
3. Crop-rule and approved-guidance ownership/review process.
4. Database migration and RLS/security test plan.
5. App/web UX and notification defaults.
6. Updated unit economics and support burden.
7. Limited-state Seed Drop fulfillment activation under the existing compliance
   allowlist.
8. A future store release containing the new screens.
9. Any live-payment activation through the existing owner-controlled process.
