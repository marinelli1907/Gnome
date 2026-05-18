# Gnome — Surplus Produce Exchange (v1.0 PRD)

**Status:** PRD shipped 2026-05-18. Code: not started.
**Owner:** Daniel Marinelli / Boone Systems LLC
**Wedge author:** Vanth (consulting AI)

## Vision

Vanth's framing: not "Amazon for vegetables" — solving "my zucchini exploded and I have 40." Neighborly, chaotic, seasonal, human. Hyperlocal one-zipcode-at-a-time.

## Problem

Home gardeners overproduce. Tomatoes, zucchini, herbs, fruit — way more than one household consumes. Currently rots, gets thrown out, or awkwardly given to friends/coworkers. Meanwhile neighbors a block away would happily pay (or trade) for fresh-picked produce.

## Wedge

Surplus produce exchange. Limited geographic scope (one zipcode at launch — Richmond Heights, OH 44143, since that's Daniel's). NOT a marketplace, NOT a delivery service. A bulletin board for "I have extra X, come grab it" + "I want X this week."

## v1.0 Feature Set (everything else deferred)

- User registration (Apple + Google + Email)
- Profile (name, photo, neighborhood — verified via address)
- Post a "have" listing: photo, name (zucchini / cherry tomatoes / basil / etc), quantity, "free" or "$" price, "porch pickup" or "I'll deliver", available until date
- Post a "want" listing: same fields, "looking for X this week"
- Map view of nearby listings (zipcode-radius)
- Push notification when someone posts what you "want"
- In-app DM between users (for pickup arrangements)
- "Mark as picked up" — closes the listing
- Trust signals: previous transactions count, reviewing system (light)

## Explicitly Deferred (v2+)

- AI plant advice
- Garden mapping
- Hyperlocal community feed (newsfeed, events, etc.)
- Weather integration
- Multi-zipcode expansion (until 50+ active users in one zipcode)

## Tech Stack

- React Native + Expo
- Supabase (auth + DB + realtime + storage for photos)
- Cloudflare R2 (image storage, cheaper than Supabase storage)
- Maps: react-native-maps + Google Maps API (free tier)
- Push: Expo push notifications (free tier covers thousands of devices)

## Backend Schema (high level)

- `users` (id, email, name, photo_url, zipcode, verified_address, created_at)
- `listings` (id, user_id, type IN (have, want), produce_name, quantity, price_cents, pickup_method, available_until, photo_url, status IN (active, closed, expired), location_geog)
- `messages` (id, listing_id, sender_id, recipient_id, body, created_at)
- `transactions` (id, listing_id, completer_id, completed_at)
- `reviews` (id, transaction_id, rater_id, rated_id, rating, comment)

## Launch Plan (per Vanth — validate before code)

1. Fake-listing test on Facebook/Nextdoor in Richmond Heights for one weekend. Post 5 "I have surplus X" + 3 "I want Y" posts. Track DM volume.
2. If 10+ unprompted DMs → wedge validated, proceed to MVP. If < 5 → defer further.
3. MVP target: 50 active users in 44143 zipcode before opening a second zipcode.

## Success Metrics

- Week 1: 10 sign-ups, 5 listings posted, 1 completed transaction
- Month 1: 30 sign-ups, 20 active listings, 10 completed transactions
- Month 3: 50+ active users in 44143, expansion to second zipcode greenlit

## Risks (ranked per Vanth)

1. Scope creep — sticking to surplus exchange only
2. Two-sided marketplace cold-start — Daniel personally posts the first 20 listings to seed
3. Daniel's bandwidth — Gnome is gated on Rally Bingo / 1Way shipping first

## Gate

Don't start coding Gnome until BOTH (a) Rally Bingo OR 1Way ships TestFlight publicly AND (b) the fake-listing validation passes.

## Status

PRD shipped 2026-05-18. Code: not started. Next action: fake-listing validation weekend.
