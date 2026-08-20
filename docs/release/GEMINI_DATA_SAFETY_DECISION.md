# Gemini Data Safety release decision

Status: **OWNER ACTION REQUIRED**  
Audit date: 2026-08-20  
Source audited: `codex/gnome-launch-finish-20260819`

This is the short Play Data Safety decision record for §4.3b. It is based on
current source code and the current Gemini API Additional Terms of Service
(`https://ai.google.dev/gemini-api/terms`, effective 2026-03-23, last updated
2026-04-28; re-checked live from Google on 2026-08-20).

## Current code behavior

Gemini is the first provider for every AI feature. OpenAI and Anthropic are
present in the adapter, but only run when `ai_settings.allow_paid_fallback` is
true, `AI_PAID_FALLBACK_DISCLOSED=true`, and those keys exist. The release
posture recorded elsewhere is `allow_paid_fallback=false`, so Google Gemini is
the provider that matters for Play.

User inputs that can be sent to Gemini:

- Ask Gnome: the user's chat turns, current page path, and the user's own Market
  name, plan, active-listing count, latest Seed Drop order status, and seed item
  agronomy details if present.
- Gnome AI chat: the user's chat turns, city/county/state-derived market
  context, their Market name/plan/listing count, pending draft count, and
  aggregate local listing/Wanted category counts.
- Garden Planner: a server-coarsened city/state-style location string, the last
  12 turns, and an optional plant photo. Street-address and exact-coordinate
  values in the location field are rejected or reduced before prompt assembly;
  street-address and coordinate shapes in forwarded turns are redacted.
- AI listing/photo drafting: user-selected listing photos or source images as
  base64, plus schema prompts and selected listing type.
- Market import: up to 4 source photos/screenshots and optional pasted seller
  text.
- Onboarding: the user's chat turns with email and phone redacted; first/last
  names can still appear because names are collected conversationally.
- Admin Boardroom / AI health: admin-entered text, aggregate admin data packs,
  or a literal ping.

Photos can be sent. Listing/source photos, plant photos, and import screenshots
are sent in memory to the model. The code comments and client paths indicate
these are re-encoded/EXIF-stripped before upload on the main app/web paths, and
the AI functions do not store the raw source images.

Listing text can be sent. Market import forwards pasted seller material; chat
features forward the user's own typed turns. AI-generated assistant replies in
the Gnome AI tab are stored in `ai_chat_messages`; `ai_usage_log` stores
metadata only.

Location information can be sent. Garden Planner now coarsens the location
field before provider calls: city/state-style text remains, ZIP codes are
removed, comma-separated street addresses are reduced to city/state when
possible, and exact coordinates or uncoarsenable street-address strings are
rejected. Gnome AI market context uses city/county/state. Ask Gnome's prompt
mentions approximate public locations, but does not send exact coordinates.

Personal information is only partially stripped. Onboarding redacts email and
phone before provider calls and does not send stored contact values. Garden
Planner redacts street-address and coordinate shapes from forwarded turns, but
there is no universal redactor for arbitrary names or other personal details in
chat. Stored Stripe ids, auth tokens, push tokens, permit documents, and exact
coordinates are not sent by the audited AI prompts.

Free users can invoke Gemini. Free users can use Ask Gnome, Garden Planner,
Gnome AI chat, market import with a smaller run cap, and legacy/free draft
flows where still exposed. Photo drafting in `gnome-assistant` and
`analyze-listing-photo` requires an effective paid/non-free Market plan.

## Vendor terms impact

Under Google's Gemini API terms, Unpaid Services include unpaid Gemini API
quota. For Unpaid Services, Google says it uses submitted content and generated
responses to provide, improve, and develop Google products and machine learning
technologies; human reviewers may read, annotate, and process API input and
output; and Google says not to submit sensitive, confidential, or personal
information.

For Paid Services through a Cloud Project with an active billing account, Google
says it does not use prompts, associated files, or responses to improve its
products, and processes prompts/responses under Google's Data Processing
Addendum, with limited logging for abuse/safety/security and legal compliance.

## Play declaration

If Gnome ships on the unpaid Gemini API tier:

- Declare **Shared = Yes** with Google for photos/videos submitted to AI,
  user-generated AI/chat/listing/source text, name where users provide it in
  onboarding/chat, and approximate location.
- Purpose: App functionality.
- Linked to user: yes, because calls are authenticated and Gnome logs user ids
  in first-party AI metadata/conversation tables.
- Tracking: no, based on current code audit.

If Daniel moves the Gemini API key to a paid, billing-enabled Cloud Project
before final submission:

- Keep the same data as **collected/processed for app functionality**, but the
  Google AI provider can be treated as a processor/service provider rather than
  a third-party sharing recipient for product-improvement use, assuming the
  paid-tier configuration is verified in production.

Declaring AI data as not shared while using unpaid Gemini API quota is not an
accurate Play Data Safety position.

## Required fixes or owner decisions

1. Owner decision: use paid Gemini API for launch, or declare Shared = Yes for
   the data categories above.
2. Completed in working tree: Garden Planner location is validated/coarsened
   server-side and planner turns redact street-address/coordinate shapes before
   Gemini prompt assembly (`supabase/tests/garden_planner_privacy.test.mjs`).
3. Recommended privacy hardening: set and document a retention window for
   `ai_chat_messages`.
4. Completed in working tree: OpenAI/Anthropic fallback now requires
   `AI_PAID_FALLBACK_DISCLOSED=true` in addition to `allow_paid_fallback`, and
   `supabase/tests/ai_provider_disclosure.test.mjs` pins that coupling. If that
   env flag is ever enabled, update the Privacy Policy before deployment.
