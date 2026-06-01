-- Gnome — M3 Request Flows, per "Market Architecture v2" §20. Run after 0001–0006.
-- Additive; reuses the existing claims engine (insert -> owner approve/decline ->
-- chat-on-approve + the approve->listing-claimed + sibling-auto-decline trigger).
-- Payments stay OFFLINE — no payment processing anywhere.
--
-- The four buyer flows all become CLAIMS, distinguished by claim_type:
--   claim            — Free "Claim"
--   trade_offer      — Trade "Offer Trade" (trade_offer_text = what they'll trade)
--   purchase_request — Sale "Request to Buy" (agreed_price_cents snapshot,
--                      payment_status='external' — settled in person)
--   wanted_response  — Wanted "I Have This" (a neighbor has what was requested)

alter table public.claims
  add column if not exists claim_type text not null default 'claim'
    check (claim_type in ('claim','trade_offer','purchase_request','wanted_response')),
  add column if not exists quantity_requested integer,
  add column if not exists buyer_note          text,
  add column if not exists trade_offer_text     text,
  add column if not exists agreed_price_cents   integer,
  add column if not exists payment_status       listing_payment_status not null default 'none';

create index if not exists claims_type_idx on public.claims (claim_type);

-- Existing claims were free claims (the ADD ... DEFAULT already set them, this is
-- explicit/safe and idempotent).
update public.claims set claim_type = 'claim' where claim_type is null;

-- Integrity: a trade offer must say what's offered; a purchase request must carry
-- a non-negative snapshot price; quantity_requested (when set) must be > 0.
-- (Existing 'claim' rows satisfy all of these.)
alter table public.claims drop constraint if exists claims_trade_offer_chk;
alter table public.claims add constraint claims_trade_offer_chk
  check (claim_type <> 'trade_offer' or (trade_offer_text is not null and length(btrim(trade_offer_text)) > 0));

alter table public.claims drop constraint if exists claims_purchase_price_chk;
alter table public.claims add constraint claims_purchase_price_chk
  check (claim_type <> 'purchase_request' or (agreed_price_cents is not null and agreed_price_cents >= 0));

alter table public.claims drop constraint if exists claims_qty_requested_chk;
alter table public.claims add constraint claims_qty_requested_chk
  check (quantity_requested is null or quantity_requested > 0);

-- No RLS / trigger changes: claims_insert_claimer (self-claim blocked),
-- claims_select_involved, claims_update_involved, the approve->claimed +
-- sibling-decline trigger, and unique(listing_id, claimer_id) all carry over.
