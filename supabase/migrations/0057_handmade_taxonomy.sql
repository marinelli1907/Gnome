-- 0057: marketplace categories for handmade goods.
-- Applied through the SQL editor without a schema_migrations row. These IDs and
-- attributes are the production-observed rows, restored as an idempotent seed.

insert into public.marketplace_taxonomy_nodes
  (id, parent_id, name, slug, path, depth, display_order, search_synonyms, icon,
   requires_compliance_review, compliance_classification)
values
  ('6e2a23f3-34d8-4761-846b-39ef25d7209b', null, 'Handmade & Home',
   'handmade-home', 'handmade-home', 0, 15,
   array['handmade','homemade','craft','artisan'], '🧼',
   false, 'GENERALLY_UNRESTRICTED')
on conflict (path) do update set
  name = excluded.name,
  display_order = excluded.display_order,
  search_synonyms = excluded.search_synonyms,
  icon = excluded.icon,
  requires_compliance_review = excluded.requires_compliance_review,
  compliance_classification = excluded.compliance_classification,
  active = true,
  archived_at = null,
  updated_at = now();

insert into public.marketplace_taxonomy_nodes
  (id, parent_id, name, slug, path, depth, display_order, search_synonyms,
   requires_compliance_review, compliance_classification)
values
  ('2d382f16-5b41-41da-8d45-e9a2b429fcf2',
   (select id from public.marketplace_taxonomy_nodes where path = 'handmade-home'),
   'Soap', 'soap', 'handmade-home/soap', 1, 1,
   array['bar soap','handmade soap','lye soap','goat milk soap'],
   true, 'REVIEW_REQUIRED'),
  ('0d59c792-777f-4900-8f83-5965565f41d8',
   (select id from public.marketplace_taxonomy_nodes where path = 'handmade-home'),
   'Bath & Body', 'bath-body', 'handmade-home/bath-body', 1, 2,
   array['bath bombs','bath fizzies','sugar scrub','body butter','lip balm','salve'],
   true, 'REVIEW_REQUIRED'),
  ('69c0281d-0cf6-4dcd-b8bf-ca2336db56d1',
   (select id from public.marketplace_taxonomy_nodes where path = 'handmade-home'),
   'Candles', 'candles', 'handmade-home/candles', 1, 3,
   array['soy candle','beeswax candle','wax melts'],
   false, 'GENERALLY_UNRESTRICTED'),
  ('429feb77-6f45-4869-bf63-ef1fa2a0438a',
   (select id from public.marketplace_taxonomy_nodes where path = 'handmade-home'),
   'Gift Baskets', 'gift-baskets', 'handmade-home/gift-baskets', 1, 4,
   array['gift box','gift basket','hamper','care package'],
   false, 'GENERALLY_UNRESTRICTED')
on conflict (path) do update set
  parent_id = excluded.parent_id,
  name = excluded.name,
  display_order = excluded.display_order,
  search_synonyms = excluded.search_synonyms,
  requires_compliance_review = excluded.requires_compliance_review,
  compliance_classification = excluded.compliance_classification,
  active = true,
  archived_at = null,
  updated_at = now();
