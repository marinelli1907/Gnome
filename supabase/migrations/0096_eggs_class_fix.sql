-- Found by testing 0095 against production, not locally.
--
-- 0095 seeded the `eggs` term under category `food-safety`. Taxonomy-classified
-- egg listings were fine — the eggs node carries compliance_class 'eggs'. But an
-- egg listing caught by the TEXT backup (no taxonomy node, which is the common
-- case) took its class from the term's category, so it came out as 'food-safety'.
--
-- Two consequences, both wrong:
--   1. The seller saw the generic "this kind of food needs a review" message
--      instead of the egg-specific one Daniel signed off on.
--   2. Approving that listing would have granted the seller a `food-safety`
--      clearance — which then auto-clears raw milk, home-canned goods and cured
--      meat from the same seller. A clearance must not be broader than the
--      review that earned it.
--
-- The term's category is the class. Give eggs its own.

update public.prohibited_terms
   set category = 'eggs', updated_at = now()
 where term = 'eggs' and category = 'food-safety';

-- No clearance had been granted under the wrong class (production had zero at
-- the time of this fix), so there is nothing to re-key. Assert that, rather than
-- trusting it: if any exist, this migration must not pretend the fix is complete.
do $$
declare n int;
begin
  select count(*) into n from public.seller_compliance_clearances
   where compliance_class = 'food-safety' and status = 'ACTIVE';
  if n > 0 then
    raise exception
      'ABORT: % active food-safety clearance(s) predate the eggs split and must be reviewed by hand', n;
  end if;
end $$;

notify pgrst, 'reload schema';
