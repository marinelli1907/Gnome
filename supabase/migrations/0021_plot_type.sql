-- Gnome — M11 Phase 1 "Reserve a Plot", part 1 of 2. Run after 0001–0020.
--
-- Adds the 'plot' listing type: a pro grower offers a piece of their garden;
-- a buyer reserves it and picks the crop; the grower grows it. Payments stay
-- OFFLINE in Phase 1 (arranged in person, like every Gnome sale) — escrow via
-- Stripe Connect is the Phase 2 spec in docs/PLOTS.md, gated on CTO review.
--
-- Postgres rule: an enum value added by ALTER TYPE cannot be *used* in the
-- same transaction it was added in, so this migration does nothing else.
-- 0022_plot_reservations.sql (separate transaction) wires up the machinery.

alter type public.listing_type add value if not exists 'plot';
