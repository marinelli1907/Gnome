-- 0041: search synonyms + legacy category mapping + listing backfill.
-- Applied to production 2026-08-10 as 'taxonomy_synonyms_and_backfill'.
-- This file is reconstructed from the live database state (the original was
-- applied via the migration API without being committed); the data below is
-- exactly what production contains.

-- Search aliases live ON the node (search_synonyms text[]), so search can
-- resolve "hamburger" -> Ground Beef without any client-side alias list.
update public.marketplace_taxonomy_nodes set search_synonyms = case path
  when 'baked-goods/bread'                    then array['sourdough','loaf','homemade bread']
  when 'eggs/chicken'                         then array['farm eggs','fresh eggs','backyard eggs','pasture eggs']
  when 'fishing-and-bait/crayfish'            then array['crawdads','crawfish','crawdaddy','mudbugs']
  when 'fishing-and-bait/minnows'             then array['bait fish','baitfish','shiners','fatheads']
  when 'fishing-and-bait/nightcrawlers-worms' then array['worms','worm','nightcrawler','night crawlers','fishing worms','bait worms','red wigglers']
  when 'garden-goods/compost'                 then array['humus','black gold','worm castings']
  when 'honey-and-syrups/honey/raw-honey'     then array['raw honey','local honey','unfiltered honey']
  when 'honey-and-syrups/syrups/maple-syrup'  then array['maple','pure maple','maple sirup']
  when 'meat/beef/ground-beef'                then array['hamburger','hamburger meat','mince','minced beef','ground chuck','burger']
  when 'meat/chicken/whole'                   then array['whole bird','roaster','fryer']
  when 'meat/pork/bacon'                      then array['streaky bacon','side pork']
  when 'pet/cat/treats'                       then array['cat treats','kitty treats']
  when 'pet/dog/bakery'                       then array['dog cookies','pupcakes','dog birthday cake']
  when 'pet/dog/bones-chews'                  then array['dog bones','bully sticks','chews','rawhide']
  when 'pet/dog/treats'                       then array['dog biscuits','dog treats','milk bones','puppy treats']
  when 'pet/fish/live-feed'                   then array['live fish food','brine shrimp']
  when 'pet/snake/live-feed'                  then array['feeder mice','feeder rats','live feed','feeder rodents']
  when 'plants/vegetable-starts'              then array['seedlings','starts','transplants','plant starts']
  when 'preserves-and-pantry/jam'             then array['preserves','fruit spread']
  when 'vegetables/greens'                    then array['salad greens','mixed greens','mesclun','collards','swiss chard']
  when 'vegetables/peppers/jalapeno'          then array['jalapeno','hot pepper','chili']
  when 'vegetables/tomatoes/cherry'           then array['cherry tomato','snacking tomato']
  when 'vegetables/tomatoes/roma'             then array['roma','plum tomato','sauce tomato','paste tomato']
  when 'vegetables/zucchini'                  then array['courgette','summer squash']
  when 'wood-firewood/firewood'               then array['fire wood','cord wood','seasoned wood','split wood']
  else search_synonyms end
where path in (
  'baked-goods/bread','eggs/chicken','fishing-and-bait/crayfish','fishing-and-bait/minnows',
  'fishing-and-bait/nightcrawlers-worms','garden-goods/compost','honey-and-syrups/honey/raw-honey',
  'honey-and-syrups/syrups/maple-syrup','meat/beef/ground-beef','meat/chicken/whole','meat/pork/bacon',
  'pet/cat/treats','pet/dog/bakery','pet/dog/bones-chews','pet/dog/treats','pet/fish/live-feed',
  'pet/snake/live-feed','plants/vegetable-starts','preserves-and-pantry/jam','vegetables/greens',
  'vegetables/peppers/jalapeno','vegetables/tomatoes/cherry','vegetables/tomatoes/roma',
  'vegetables/zucchini','wood-firewood/firewood'
);

-- Map the old flat `listings.category` values onto the tree so existing
-- listings resolve to a node without their owners doing anything.
create table if not exists public.legacy_category_map (
  legacy_category text primary key,
  taxonomy_path   text not null references public.marketplace_taxonomy_nodes(path)
);
alter table public.legacy_category_map enable row level security;
create policy legacy_map_select on public.legacy_category_map
  for select to anon, authenticated using (true);
grant select on public.legacy_category_map to anon, authenticated;

insert into public.legacy_category_map (legacy_category, taxonomy_path) values
  ('vegetables','vegetables'), ('fruit','fruit'), ('herbs','herbs'), ('eggs','eggs'),
  ('seeds','seeds'), ('plants','plants'), ('flowers','flowers'),
  ('compost','garden-goods/compost'), ('honey','honey-and-syrups/honey'),
  ('farm_fresh','preserves-and-pantry'), ('supplies','garden-goods'),
  ('decor','garden-goods/decor'), ('wood','wood-firewood'), ('meat','meat'),
  ('pet_treats','pet'), ('other','vegetables/other')
on conflict (legacy_category) do nothing;

-- Backfill: every listing with a legacy category gets its node pointer.
update public.listings l
   set taxonomy_node_id = n.id
  from public.legacy_category_map m
  join public.marketplace_taxonomy_nodes n on n.path = m.taxonomy_path
 where l.taxonomy_node_id is null
   and l.category = m.legacy_category;
