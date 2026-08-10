-- 0050: repoint market_orders.buyer_id at profiles(id), matching
-- claims.claimer_id. Same cascade semantics (profiles cascades from
-- auth.users), but it gives PostgREST the relationship the buyer-name embed
-- (`buyer:profiles!market_orders_buyer_id_fkey(name)`) needs — with the FK on
-- auth.users the seller order board 400s trying to join profiles.
alter table public.market_orders
  drop constraint market_orders_buyer_id_fkey;
alter table public.market_orders
  add constraint market_orders_buyer_id_fkey
  foreign key (buyer_id) references public.profiles(id) on delete cascade;
